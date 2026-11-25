from copy import deepcopy
from pathlib import Path

from sqlalchemy import select

from app.models import ReaderSnapshot, Source, ParseTask

FILE = Path(__file__).parents[2] / "tests/fixtures/reader/mixed.pdf"


def setup(client):
    course = client.post('/api/courses', json={'school': '测试学校', 'name': '阅读测试课程'}).json()
    source = client.post(f"/api/courses/{course['id']}/sources", data={'rights_confirmed': 'true'},
                         files={'file': ('mixed.pdf', FILE.read_bytes(), 'application/pdf')}).json()['source']
    url = f"/api/courses/{course['id']}/sources/{source['id']}/reader"
    meta = client.get(url).json()
    anchor = {'documentId': source['sha256'], 'previewVersion': meta['previewVersion'], 'page': 1,
              'space': 'normalized-top-left', 'precision': 'region', 'regions': [{'x': .1, 'y': .2, 'width': .25, 'height': .15}]}
    snapshot = {'schema': 1, 'document': {'id': source['sha256'], 'name': 'mixed.pdf', 'originalFormat': 'pdf', 'previewFormat': 'pdf',
                'previewVersion': meta['previewVersion'], 'pages': meta['pages']}, 'annotations': [
                    {'id': 'note-1', 'schema': 1, 'kind': 'note', 'text': '服务器笔记', 'anchor': anchor, 'updatedAt': '2026-11-23T00:00:00Z'}],
                'reader': {'page': 2, 'zoom': 1.63, 'scroll': {'x': 0, 'y': 123}, 'selection': None, 'context': anchor,
                           'panelOpen': True, 'draft': '问题草稿'}, 'savedAt': '2026-11-23T00:00:00Z'}
    return course, source, url, snapshot


def test_reader_roundtrip_cas_and_lost_response_retry(client):
    _, _, url, snapshot = setup(client)
    highlight = deepcopy(snapshot['annotations'][0]); highlight.update(id='highlight-1', kind='highlight', color='#ffe04a'); highlight.pop('text')
    ink = deepcopy(highlight); ink.update(id='ink-1', kind='ink', color='#215cbd', width=2, points=[{'x': .1, 'y': .2}, {'x': .3, 'y': .3}])
    snapshot['annotations'].extend([highlight, ink])
    assert client.get(url).json()['revision'] == 0
    assert client.put(url, json={'revision': 0, 'snapshot': snapshot}).json()['revision'] == 1
    # Exact retry after a lost acknowledgement must not make a duplicate revision.
    assert client.put(url, json={'revision': 0, 'snapshot': snapshot}).json()['revision'] == 1
    other = deepcopy(snapshot); other['reader']['draft'] = '另一个窗口'
    assert client.put(url, json={'revision': 0, 'snapshot': other}).status_code == 409
    assert client.get(url).json()['snapshot'] == snapshot
    assert client.put(url, json={'revision': 1, 'snapshot': other}).json()['revision'] == 2
    assert client.get(url).json()['snapshot']['reader']['page'] == 2


def test_reader_rejects_corrupt_and_mismatched_payloads_without_overwrite(client):
    _, _, url, snapshot = setup(client)
    client.put(url, json={'revision': 0, 'snapshot': snapshot})
    bad = []
    for change in [lambda s: s.update(schema=999), lambda s: s['document'].update(id='other'),
                   lambda s: s['reader'].update(page=99), lambda s: s['reader'].update(zoom=0),
                   lambda s: s['annotations'][0]['anchor']['regions'][0].update(x=.9),
                   lambda s: s['annotations'][0].update(color='red'),
                   lambda s: s['document']['pages'][0].update(width=1),
                   lambda s: s['reader'].update(draft='a' * 100001)]:
        s = deepcopy(snapshot); change(s); bad.append(s)
    for s in bad:
        assert client.put(url, json={'revision': 1, 'snapshot': s}).status_code == 422
    assert client.get(url).json()['snapshot'] == snapshot


def test_reader_course_source_isolation_missing_and_changed_file(client, tmp_path, session_factory):
    course, source, url, snapshot = setup(client)
    other = client.post('/api/courses', json={'school': '另一学校', 'name': '另一课程'}).json()
    assert client.get(url.replace(course['id'], other['id'])).status_code == 404
    with session_factory() as db:
        file = tmp_path / 'uploads' / db.get(Source, source['id']).storage_key
    original = file.read_bytes(); file.write_bytes(b'changed')
    assert client.get(url).status_code == 409
    assert client.put(url, json={'revision': 0, 'snapshot': snapshot}).status_code == 409
    file.unlink(); assert client.get(url).status_code == 410
    file.write_bytes(original); assert client.get(url).status_code == 200


def test_reader_archive_remove_restore_and_permanent_course_delete(client, session_factory):
    course, source, url, snapshot = setup(client)
    assert client.put(url, json={'revision': 0, 'snapshot': snapshot}).status_code == 200
    assert client.patch(f"/api/courses/{course['id']}/archive", json={'archived': True}).status_code == 200
    assert client.get(url).json()['readOnly'] is True
    assert client.put(url, json={'revision': 1, 'snapshot': snapshot}).status_code == 409
    client.patch(f"/api/courses/{course['id']}/archive", json={'archived': False})
    from datetime import datetime, timezone
    with session_factory() as db:
        db.get(Source, source['id']).removed_at = datetime.now(timezone.utc); db.commit()
    assert client.get(url).status_code == 404
    with session_factory() as db:
        assert db.scalar(select(ReaderSnapshot)).snapshot == snapshot
        db.get(Source, source['id']).removed_at = None
        for task in db.scalars(select(ParseTask)):
            task.status = 'failed'
        db.commit()
    assert client.get(url).json()['snapshot'] == snapshot
    assert client.request('DELETE', f"/api/courses/{course['id']}", json={'confirmation': course['name']}).status_code == 204
    with session_factory() as db:
        assert db.scalar(select(ReaderSnapshot)) is None
