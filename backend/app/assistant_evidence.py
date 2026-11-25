"""Deterministic, page-only evidence. No OCR, retrieval, URL tools or teacher fields."""
import re
from hashlib import sha256
from pathlib import Path
from pypdf import PdfReader
from .retrieval import search_course_evidence
from .models import EvidenceBlock, Source
from .reader_routes import PREVIEW_VERSION
from . import assistant_workspace as ws

NORMALIZATION = 'unicode-whitespace-remove-v1'
def normalize(text):
    return re.sub(r'\s+', '', text)

def verify_retrieved(db, course_id, item, upload_dir):
    block=db.get(EvidenceBlock,item.get('retrieval_id'))
    source=db.get(Source,item.get('snapshot',{}).get('source_id'))
    if not block or not source or block.source_id!=source.id or source.course_id!=course_id or source.removed_at or source.status not in ('ready','needs_review'):
        ws.fail('retrieval_stale','检索资料已移除或不再可用')
    snap=item['snapshot']
    if source.sha256!=snap.get('source_sha256') or block.content_hash!=snap.get('content_hash') or sha256(block.text.encode()).hexdigest()!=block.content_hash or block.text!=item.get('text') or block.page_number!=snap.get('page'):
        ws.fail('retrieval_stale','检索原文或资料版本已变化')
    binding={'source_id':source.id,'source_sha256':source.sha256,'preview_version':snap.get('preview_version'),'page':snap.get('page')}
    ws.source_content(db,course_id,binding,upload_dir)
    path=Path(upload_dir).resolve()/source.storage_key
    page_text=PdfReader(path).pages[binding['page']-1].extract_text() or ''
    if not normalize(item['text']) or normalize(item['text']) not in normalize(page_text):
        ws.fail('retrieval_stale','检索片段无法在原PDF页复核')
    return {'kind':'document','course_id':course_id,'source_id':source.id,'source_sha256':source.sha256,
            'preview_version':PREVIEW_VERSION,'page':binding['page'],'precision':'page'}

def _retrieved(db,request,upload_dir,start,explicit_evidence):
    query=request.intent['text']
    candidates=search_course_evidence(db,request.course_id,query,limit=3,source_extensions=('.pdf',))
    evidence=[];trace=[];seen=set()
    explicit={(e.get('snapshot',{}).get('source_id'),e.get('snapshot',{}).get('page')) for e in explicit_evidence if not e.get('retrieved') and (e.get('action') or {}).get('kind')=='document'}
    for candidate in candidates:
        key=(candidate.source_id,candidate.page_number)
        if not candidate.page_number:
            trace.append({'source_id':candidate.source_id,'page':None,'score':candidate.score,'included':False,'reason':'no_page_anchor'});continue
        if key in seen or key in explicit:
            trace.append({'source_id':candidate.source_id,'page':candidate.page_number,'score':candidate.score,'included':False,'reason':'duplicate_page'});continue
        seen.add(key)
        block=db.get(EvidenceBlock,candidate.evidence_id);source=db.get(Source,candidate.source_id)
        if not block or not source:
            trace.append({'source_id':candidate.source_id,'page':candidate.page_number,'score':candidate.score,'included':False,'reason':'missing_block'});continue
        item={'retrieved':True,'retrieval_id':block.id,'binding_id':None,'evidence_id':'e'+str(start+len(evidence)+1),
              'kind':'retrieved_pdf_page','title':source.original_name,'text':block.text,'provenance':'verified_course_pdf',
              'normalization':NORMALIZATION,'source_excerpt':block.text,'content_fingerprint':sha256(block.text.encode()).hexdigest(),
              'action':None,'snapshot':{'source_id':source.id,'source_sha256':source.sha256,'preview_version':PREVIEW_VERSION,
                  'page':block.page_number,'content_hash':block.content_hash,'node_title':candidate.node_title,'score':candidate.score}}
        snapshot={**item['snapshot'],'text':item['text'],'kind':item['kind']}
        item['fingerprint']=ws.digest(snapshot)
        try:item['action']=verify_retrieved(db,request.course_id,item,upload_dir)
        except Exception as error:
            from fastapi import HTTPException
            if not isinstance(error,HTTPException):raise
            trace.append({'source_id':candidate.source_id,'page':candidate.page_number,'score':candidate.score,'included':False,'reason':'source_revalidation_failed'});continue
        evidence.append(item);trace.append({'source_id':source.id,'source_name':source.original_name,'page':block.page_number,'score':candidate.score,'included':True,'reason':'course_pdf_match'})
    request.frozen={**request.frozen,'retrieval_trace':trace}
    return evidence

def build(db, request, topic, upload_dir, user_provided=()):
    evidence=[]
    for binding in request.intent['binding_ids']:
        original=next((b for b in topic.bindings if b['id']==binding),None)
        if not original:
            ws.fail('context_stale','已确认附件被移除，请重新确认')
        b=ws.resolve_binding(db,request.course_id,topic,original,upload_dir,checking=True)
        action=None;source_excerpt=None;original_text=b['text']
        if b['role']=='document_excerpt':
            source=ws.source_content(db,request.course_id,b,upload_dir)
            selected=normalize(b['text'])
            if not selected or b['precision']=='region':
                ws.fail('visual_unsupported','此附件只有区域位置；尚不支持扫描、图表或图片理解',422)
            text=PdfReader(upload_dir/source.storage_key).pages[b['page']-1].extract_text() or ''
            page=normalize(text)
            if not selected or selected not in page:
                if binding not in user_provided:
                    ws.fail('evidence_unmatched','选文未能匹配PDF原文；可重新取材，或明确作为你提供的文字继续',422)
                provenance='user_provided_text'
            else:
                provenance='verified_source_text'
                offsets=[i for i,char in enumerate(text) if not char.isspace()]
                start=page.index(selected)
                source_excerpt=text[offsets[start]:offsets[start+len(selected)-1]+1]
                b['text']=source_excerpt
                action={'kind':'document','course_id':request.course_id,'source_id':source.id,'source_sha256':source.sha256,'preview_version':b['preview_version'],'page':b['page'],'precision':'page'}
            b.update(provenance=provenance)
        else:
            action={'kind':'task','course_id':request.course_id,'session_id':b['session_id'],'task_id':b['task_id'],'attempt_id':b.get('attempt_id'),'role':b['role'],'task_fingerprint':b['task_fingerprint']}
        snapshot={k:b.get(k) for k in ['id','role','text','source_id','source_sha256','preview_version','page','session_id','task_id','task_fingerprint','attempt_id','content_fingerprint','provenance','image_id','image_sha256','image_version','image_width','image_height','image_correction','image_correction_version','image_original','learning_focus','learning_focus_version']}
        if b.get('image_id'):snapshot['image_present']=True
        snapshot['original_text']=original_text
        snapshot['source_excerpt']=source_excerpt
        evidence.append({'evidence_id':'e'+str(len(evidence)+1),'binding_id':binding,'kind':b['role'],'title':b['title'],'text':b['text'],'provenance':b['provenance'],'normalization':NORMALIZATION,'source_excerpt':source_excerpt,'content_fingerprint':sha256(b['text'].encode()).hexdigest(),'fingerprint':ws.digest(snapshot),'snapshot':snapshot,'action':action})
    evidence.extend(_retrieved(db,request,upload_dir,len(evidence),evidence))
    return evidence

def validate_reply(reply,evidence,student_text=''):
    by_id={e['evidence_id']:e for e in evidence}
    if re.search(r'(?:https?|file|javascript):|[A-Za-z]:[\\/]',reply.reply):
        ws.fail('invalid_citation','回答含未授权网址或文件路径，未发布',502)
    for claim in reply.claims:
        if claim.learning_observation or claim.student_quote:
            supplied=[student_text,*[e['snapshot'].get('text','') for e in evidence if e['kind'] in ('student_work','submitted_answer')],*[e['snapshot'].get('learning_focus','') for e in evidence]]
            if claim.kind!='model_explanation' or not claim.learning_observation.strip() or not claim.student_quote.strip() or not any(claim.student_quote in (text or '') for text in supplied):
                ws.fail('invalid_learning_observation','卡点仅为待确认判断，必须有本轮学生原话依据',502)
        if claim.image_uncertainty and (claim.kind!='model_explanation' or not any(e['snapshot'].get('image_id') for e in evidence)):
            ws.fail('invalid_image_observation','图片疑点必须来自本轮实际图像且不能标为资料证据',502)
        claim_evidence=[by_id[eid] for eid in claim.evidence_ids if eid in by_id]
        if claim.kind=='evidence' and any(e['provenance']=='user_provided_text' for e in claim_evidence):
            ws.fail('invalid_citation','用户提供文字未经资料核验，不能作为资料证据引用',502)
        pages={str(by_id[eid]['snapshot']['page']) for eid in claim.evidence_ids if eid in by_id and by_id[eid]['snapshot'].get('page')}
        mentioned=re.findall(r'第\s*(\d+)\s*页|(?:page|p\.)\s*(\d+)',claim.text,re.IGNORECASE)
        if any((a or b) not in pages for a,b in mentioned):
            ws.fail('invalid_citation','回答含无法核对的页码，未发布',502)
        if claim.text not in reply.reply:
            ws.fail('invalid_citation','回答论断与正文不一致，未发布',502)
        if claim.kind=='model_explanation':
            if claim.evidence_ids or claim.quote:
                ws.fail('invalid_citation','模型补充不能伪装成资料引文',502)
        elif not claim.evidence_ids or not claim.quote:
            ws.fail('invalid_citation','引用缺少证据或引文，未发布',502)
        for identity in claim.evidence_ids:
            e=by_id.get(identity)
            if not e or normalize(claim.quote) not in normalize(e['text']):
                ws.fail('invalid_citation','回答含未知证据或不匹配引文，未发布',502)
    # Require every nonseparator byte to belong to an exact claim. A JSON model
    # may overescape paragraph separators; normalize only those delimiters, never
    # modify claim words, quotes, source IDs or nonseparator text.
    position=0
    separator=re.compile(r'(?:\s|\\n|\\r)*')
    for claim in reply.claims:
        position=separator.match(reply.reply,position).end()
        if not reply.reply.startswith(claim.text,position):
            ws.fail('invalid_citation','回答存在未标明来源范围的段落，未发布',502)
        position+=len(claim.text)
    position=separator.match(reply.reply,position).end()
    if position!=len(reply.reply):
        ws.fail('invalid_citation','回答存在未标明来源范围的段落，未发布',502)
    result=reply.model_dump()
    result['reply']='\n\n'.join(c.text for c in reply.claims)
    return result
