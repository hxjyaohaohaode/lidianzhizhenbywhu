"""Owner-isolated persistent lexical index; retrievable does not mean verified true."""
from __future__ import annotations
from .clock import utc_today
import math
import re
from collections import Counter
from datetime import date
from .store import digest

STOP={'的','了','和','是','在','请','分析','情况','企业','诊断','进行','我们','以及','一个','the','and','for','with'}

def terms(text):
    result=re.findall(r'[a-z0-9_]{2,}',text.lower())
    for block in re.findall(r'[\u4e00-\u9fff]+',text):result.extend(block[i:i+2] for i in range(len(block)-1))
    return [t for t in result if t not in STOP]

def retrieve(documents,query,limit=6):
    q=set(terms(query))
    if not q:return []
    chunks=[]
    for doc in documents[:200]:
        text=doc['payload']['text']
        for start in range(0,len(text),900):
            excerpt=text[start:start+1100];token=Counter(terms(excerpt));matches=q.intersection(token)
            if matches:chunks.append((doc,start,excerpt,token,matches))
    if not chunks:return []
    n=len(chunks);df=Counter(t for _,_,_,tokens,_ in chunks for t in q.intersection(tokens))
    average=sum(sum(tokens.values()) for _,_,_,tokens,_ in chunks)/n;ranked=[]
    for doc,start,excerpt,tokens,matches in chunks:
        length=sum(tokens.values());score=0.
        for t in matches:
            idf=math.log(1+(n-df[t]+.5)/(df[t]+.5));tf=tokens[t];score+=idf*(tf*2.2)/(tf+1.2*(.25+.75*length/max(average,1)))
        if len(matches)<min(2,len(q)) or len(matches)/len(q)<.08:continue
        p=doc['payload'];dt=p.get('published_at');age=None
        if dt:
            try:age=(utc_today()-date.fromisoformat(dt)).days
            except ValueError:pass
        ranked.append({'id':f"{doc['id']}:{start}",'document_id':doc['id'],'title':p['title'],'url':p.get('source_url',''),'excerpt':excerpt,'start':start,'end':start+len(excerpt),'content_hash':digest(excerpt),'document_hash':doc['content_hash'],'score':round(score,4),'matched_terms':sorted(matches),'published_at':dt,'age_days':age,'source_kind':p.get('source_kind','user_provided'),'verification':p.get('verification','unverified'),'retrieved_at':p.get('retrieved_at'),'fetched_at':p.get('fetched_at'),'original_source_url':p.get('original_source_url',p.get('source_url','')),'stale':age is None or age>365})
    ranked.sort(key=lambda r:(-r['score'],r['id']));selected=[];per_doc=Counter()
    for row in ranked:
        if per_doc[row['document_id']]>=2:continue
        selected.append(row);per_doc[row['document_id']]+=1
        if len(selected)>=limit:break
    return selected

def retrieve_indexed(store,user,query,limit=6,company=None):
    """Bounded FTS candidates avoid full-corpus reads on the run-submission transaction."""
    tokens=list(dict.fromkeys(terms(query)))[:80]
    if not tokens:return []
    expression='owner : "'+user.replace('"','""')+'" AND terms : ('+' OR '.join('"'+t.replace('"','""')+'"' for t in tokens)+')'
    scope_company = company or ''
    rows=store.all('''SELECT c.id,c.document_id,c.start,c.excerpt,e.content_hash,
        json_object('title',json_extract(e.payload,'$.title'),'source_url',json_extract(e.payload,'$.source_url'),
        'published_at',json_extract(e.payload,'$.published_at'),'source_kind',json_extract(e.payload,'$.source_kind'),
        'verification',json_extract(e.payload,'$.verification'),'retrieved_at',json_extract(e.payload,'$.retrieved_at'),
        'fetched_at',json_extract(e.payload,'$.fetched_at'),'original_source_url',coalesce(json_extract(e.payload,'$.original_source_url'),json_extract(e.payload,'$.source_url'))) AS payload
        FROM evidence_fts f JOIN evidence_chunks c ON c.id=f.chunk_id JOIN evidence e ON e.id=c.document_id
        LEFT JOIN workspace_objects w ON w.kind='evidence_review' AND w.user_id=e.user_id AND w.natural_key=e.id
        WHERE evidence_fts MATCH ? AND c.user_id=? AND e.user_id=?
        AND (coalesce(json_extract(w.payload,'$.company'),'')!='' OR json_extract(w.payload,'$.global_scope')=1)
        AND coalesce(json_extract(w.payload,'$.status'),'unreviewed')!='rejected'
        AND (json_extract(w.payload,'$.expires_at') IS NULL OR json_extract(w.payload,'$.expires_at')>=?)
        AND (?='' OR coalesce(json_extract(w.payload,'$.company'),'') IN ('',?))
        ORDER BY bm25(evidence_fts),c.id LIMIT 48''',(expression,user,user,utc_today().isoformat(),scope_company,scope_company))
    docs=[{'id':x['id'],'content_hash':x['content_hash'],'payload':{**x['payload'],'text':x['excerpt']}} for x in rows]
    by_id={x['id']:x for x in rows};seen=set();per_doc=Counter();candidates=[]
    for item in retrieve(docs,query,48):
        key=item['document_id'];row=by_id[key]
        if key in seen or per_doc[row['document_id']]>=2 or item['start']!=0:continue
        seen.add(key);per_doc[row['document_id']]+=1
        item.update(id=key,document_id=row['document_id'],start=row['start'],end=row['start']+len(row['excerpt']),excerpt=row['excerpt'],content_hash=digest(row['excerpt']),document_hash=row['content_hash'])
        review=store.one("SELECT payload,version FROM workspace_objects WHERE kind='evidence_review' AND user_id=? AND natural_key=?",(user,row['document_id']))
        item.update(stance=review['payload'].get('stance','context') if review else 'context',review_note=review['payload'].get('note','') if review else '',review_version=review['version'] if review else 0,review_state=review['payload']['status'] if review else 'unreviewed',company_scope=review['payload'].get('company','') if review else '')
        candidates.append(item)
        if len(candidates)>=limit:break
    return candidates
