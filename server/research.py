"""Explicit-consent public search. Search snippets are never independently verified facts."""
import json
import os
from .network import PinnedHTTPS,public_addresses,validate_url
from .retrieval import terms
from .store import digest,now

class PublicResearch:
    def __init__(self,allowed_hosts):self.key=os.getenv('TAVILY_API_KEY','');self.allowed_hosts=allowed_hosts
    def status(self):return {'provider':'tavily','configured':bool(self.key and not self.key.startswith('your_')),'connectivity':'not_tested'}
    def search(self,query):
        if not self.status()['configured']:raise ValueError('SEARCH_UNCONFIGURED')
        host='api.tavily.com';conn=PinnedHTTPS(host,public_addresses(host)[0],12)
        body=json.dumps({'query':query,'topic':'general','search_depth':'basic','max_results':5,'include_domains':list(self.allowed_hosts),'include_answer':False,'include_raw_content':False,'include_images':False,'auto_parameters':False,'include_usage':True},ensure_ascii=False).encode()
        try:
            conn.request('POST','/search',body,{'Authorization':f'Bearer {self.key}','Content-Type':'application/json','Accept-Encoding':'identity'})
            response=conn.getresponse();raw=response.read(300001)
            if response.status!=200:raise ValueError('SEARCH_HTTP_'+str(response.status))
            if len(raw)>300000:raise ValueError('SEARCH_RESPONSE_TOO_LARGE')
            result=json.loads(raw)
        finally:conn.close()
        rows=result.get('results',[])
        if not isinstance(rows,list):raise ValueError('SEARCH_SCHEMA_INVALID')
        query_terms=set(terms(query));items=[];rejected=0;seen=set()
        finance=('锂','电池','毛利','财报','利润','收入','营业','现金流','负债','材料','库存','新能源','制造业','财务','经营','行业')
        for item in rows[:20]:
            if not isinstance(item,dict):rejected+=1;continue
            title=item.get('title','');url=item.get('url','');content=item.get('content','')
            if not all(isinstance(v,str) for v in (title,url,content)):rejected+=1;continue
            try:validate_url(url,self.allowed_hosts)
            except ValueError:rejected+=1;continue
            combined=title+' '+content;overlap=query_terms.intersection(terms(combined))
            if url in seen or not any(t in combined for t in finance) or len(overlap)<min(2,len(query_terms)) or len(content)<20:rejected+=1;continue
            seen.add(url);items.append({'title':title[:200],'source_url':url,'text':content[:12000],'content_hash':digest(content[:12000]),'verification':'search_snippet_unverified','matched_terms':sorted(overlap),'retrieved_at':now()})
            if len(items)>=5:break
        usage=result.get('usage',{});credits=usage.get('credits') if isinstance(usage,dict) else None
        return {'items':items,'rejected':rejected,'provider':'tavily','credits_reported':credits if isinstance(credits,(int,float)) and not isinstance(credits,bool) and 0<=credits<100 else None,'query':query,'warning':'搜索片段非全文，也未独立核验；仅返回白名单且相关的候选，需人工确认后加入证据库。'}
