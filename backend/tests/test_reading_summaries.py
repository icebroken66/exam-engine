from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import func, select

from app.models import ReaderSnapshot, Source, UsageRecord, LearningEvent
from test_reader import setup


def test_summary_cold_read_empty_saved_and_side_effect_free(client, session_factory):
    course, source, reader_url, snapshot = setup(client)
    url = f"/api/courses/{course['id']}/reading-summaries"
    assert client.get(url).json() == {'courseId': course['id'], 'items': []}
    assert client.put(reader_url, json={'revision': 0, 'snapshot': snapshot}).status_code == 200
    with session_factory() as db:
        row = db.scalar(select(ReaderSnapshot))
        before = (row.updated_at, row.revision, deepcopy(row.snapshot))
        counts = [db.scalar(select(func.count()).select_from(model)) for model in (UsageRecord, LearningEvent)]
        # Parsing failed is independent of reading capability.
        db.get(Source, source['id']).status = 'failed'
        db.commit()
    with patch.object(Path, 'read_bytes', side_effect=AssertionError('summary read original')):
        response = client.get(url)
    assert response.status_code == 200
    item = response.json()['items'][0]
    assert item['sourceId'] == source['id'] and item['page'] == 2 and item['revision'] == 1
    assert item['sha256'] == source['sha256'] and not item['readOnly']
    assert 'annotations' not in response.text and '问题草稿' not in response.text
    with session_factory() as db:
        row = db.scalar(select(ReaderSnapshot))
        assert (row.updated_at, row.revision, row.snapshot) == before
        assert [db.scalar(select(func.count()).select_from(model)) for model in (UsageRecord, LearningEvent)] == counts
    other = client.post('/api/courses', json={'school':'测试', 'name':'空课程'}).json()
    assert client.get(f"/api/courses/{other['id']}/reading-summaries").json()['items'] == []
    assert client.get('/api/courses/missing/reading-summaries').status_code == 404
    client.patch(f"/api/courses/{course['id']}/archive", json={'archived':True})
    assert client.get(url).json()['items'][0]['readOnly']


def test_summary_filters_removed_hash_preview_schema_and_format(client, session_factory):
    course, source, reader_url, snapshot = setup(client)
    client.put(reader_url, json={'revision': 0, 'snapshot': snapshot})
    url = f"/api/courses/{course['id']}/reading-summaries"
    def missing():
        assert client.get(url).json()['items'] == []
    with session_factory() as db:
        row = db.scalar(select(ReaderSnapshot)); row.source_sha256 = 'wrong'; db.commit()
    missing()
    with session_factory() as db:
        row = db.scalar(select(ReaderSnapshot)); row.source_sha256 = source['sha256']; row.preview_version = 'old'; db.commit()
    missing()
    with session_factory() as db:
        row = db.scalar(select(ReaderSnapshot)); row.preview_version = snapshot['document']['previewVersion']
        bad = deepcopy(snapshot); bad['document']['id'] = 'wrong'; row.snapshot = bad; db.commit()
    missing()
    with session_factory() as db:
        row = db.scalar(select(ReaderSnapshot)); row.snapshot = snapshot
        db.get(Source, source['id']).removed_at = datetime.now(timezone.utc); db.commit()
    missing()
    with session_factory() as db:
        db.get(Source, source['id']).removed_at = None
        db.get(Source, source['id']).extension = '.pptx'; db.commit()
    missing()


def test_summary_limit_order_and_single_projection_query(client, session_factory):
    course, source, reader_url, snapshot = setup(client)
    client.put(reader_url, json={'revision': 0, 'snapshot': snapshot})
    with session_factory() as db:
        original = db.get(Source, source['id'])
        for n in range(25):
            digest = str(n).zfill(64)
            added = Source(course_id=course['id'], original_name=f'{n}.pdf', storage_key=f'{n}.pdf',
                           extension='.pdf', media_type='application/pdf', size_bytes=10, sha256=digest)
            db.add(added); db.flush()
            saved = deepcopy(snapshot); saved['document']['id'] = digest
            db.add(ReaderSnapshot(source_id=added.id, source_sha256=digest, preview_version=snapshot['document']['previewVersion'],
                                  snapshot=saved, updated_at=datetime(2026, 11, 23, 0, n, tzinfo=timezone.utc)))
        db.commit()
    from sqlalchemy import event
    statements = []
    engine = session_factory.kw['bind']
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(engine, 'before_cursor_execute', capture)
    try:
        items = client.get(f"/api/courses/{course['id']}/reading-summaries").json()['items']
    finally:
        event.remove(engine, 'before_cursor_execute', capture)
    assert len(items) == 20
    assert [i['updatedAt'] for i in items] == sorted([i['updatedAt'] for i in items], reverse=True)
    assert len(statements) == 2  # course lookup + one bounded projection, no per-source fetch.
    assert all('UPDATE ' not in statement and 'INSERT ' not in statement for statement in statements)


def test_reader_rejects_corrupt_and_encrypted_originals_without_changing_notes(client, session_factory, tmp_path):
    from hashlib import sha256
    from io import BytesIO
    from pypdf import PdfReader, PdfWriter
    course, source, reader_url, snapshot = setup(client)
    client.put(reader_url, json={'revision': 0, 'snapshot': snapshot})
    with session_factory() as db:
        original = db.get(Source, source['id'])
        target = tmp_path / 'uploads' / original.storage_key
        content = target.read_bytes()
    writer = PdfWriter()
    for page in PdfReader(BytesIO(content)).pages:
        writer.add_page(page)
    writer.encrypt('unavailable-password')
    encrypted = BytesIO(); writer.write(encrypted)
    for body in (b'%PDF-1.7\ncorrupt', encrypted.getvalue()):
        target.write_bytes(body)
        with session_factory() as db:
            db.get(Source, source['id']).sha256 = sha256(body).hexdigest(); db.commit()
        assert client.get(reader_url).status_code == 422
        assert client.put(reader_url, json={'revision': 1, 'snapshot': snapshot}).status_code == 422
        assert client.get(f"/api/courses/{course['id']}/reading-summaries").json()['items'] == []
        with session_factory() as db:
            assert db.scalar(select(ReaderSnapshot)).snapshot == snapshot
