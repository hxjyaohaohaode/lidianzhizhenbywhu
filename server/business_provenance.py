"""Frozen business origins and read-only lifecycle overlays.

References are resolved inside the owner's transaction. Displaying a current impact
never updates a historical object or treats a service lens as account authority.
"""
from __future__ import annotations
from copy import deepcopy
from typing import Literal
from pydantic import Field, model_validator
from .schemas import StorageInteger, StrictModel
from .store import digest, now
from .security import fail
from . import workspace_store as ws
from .identities import resolve_identity, identity_binding


class SourceRef(StrictModel):
    kind: Literal['dataset', 'report', 'copilot', 'insight', 'alert', 'action']
    run_id: str = Field(default='', max_length=80)
    claim_id: str = Field(default='', max_length=80)
    thread_id: str = Field(default='', max_length=80)
    message_id: str = Field(default='', max_length=80)
    source_key: str = Field(default='', max_length=200)
    alert_id: str = Field(default='', max_length=80)
    action_id: str = Field(default='', max_length=80)
    action_version: StorageInteger | None = Field(default=None, ge=1)
    action_hash: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    dataset_version: StorageInteger | None = Field(default=None, ge=1)
    dataset_hash: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    allow_historical: bool = False

    @model_validator(mode='after')
    def exact_reference(self):
        fields={'report':{'run_id','claim_id'},'copilot':{'thread_id','message_id'},
                'insight':{'source_key'},'alert':{'alert_id'},'action':{'action_id'},'dataset':set()}
        required={'report':'run_id','copilot':'thread_id','insight':'source_key','alert':'alert_id','action':'action_id'}
        if self.kind in required and not getattr(self,required[self.kind]):
            raise ValueError('来源缺少对应记录标识')
        if any(getattr(self,key) for key in {'run_id','claim_id','thread_id','message_id','source_key','alert_id','action_id'}-fields[self.kind]):
            raise ValueError('来源标识与来源类型不一致')
        if self.kind=='action' and (self.action_version is None or self.action_hash is None):
            raise ValueError('行动来源必须携带已查看的行动版本和内容指纹')
        if self.kind!='action' and (self.action_version is not None or self.action_hash is not None):
            raise ValueError('行动版本与来源类型不一致')
        return self


class EvidenceRef(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    version: StorageInteger = Field(ge=1)
    content_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    review_version: StorageInteger = Field(ge=0)


def _owned(store, user_id, table, id):
    row=store.owned(table,user_id,id)
    if not row:fail('NOT_FOUND','来源不存在或无访问权限',404)
    return row


def _same_scope(identity_id, dataset_id, source_identity, source_dataset):
    if identity_id != source_identity:
        fail('IDENTITY_SCOPE','来源属于另一服务身份，请在原身份中继续',403)
    if dataset_id and dataset_id != source_dataset:
        fail('DATASET_MISMATCH','来源与所选企业数据不一致',409)


def _citation_evidence(citations):
    # These values are from the frozen source, never filled with a newer live review.
    values={}
    for c in citations:
        id=c.get('document_id')
        if not id:continue
        if id not in values:
            values[id]={'id':id,'version':c.get('document_version'),
                'content_hash':c.get('document_hash'),'review_version':c.get('review_version'),
                'review_hash':c.get('review_hash'),'title':c.get('title',''),
                'source_url':c.get('original_source_url',c.get('url','')),
                'review_state':c.get('review_state'),'company_scope':c.get('company_scope'), 'excerpts':[]}
        if len(values[id]['excerpts'])<8:
            values[id]['excerpts'].append({'text':c.get('excerpt','')[:2000],
                'start':c.get('start'),'end':c.get('end'),'content_hash':c.get('content_hash')})
    return list(values.values())[:20]


def _insight_binding(insight):
    """Age is display context, not a new finding on every midnight boundary."""
    binding={k:deepcopy(v) for k,v in insight.items() if k!='action_id'}
    if binding.get('code')=='stale':
        binding.pop('message',None)
        binding.get('proof',{}).pop('age_days',None)
    return binding


def _comparison_reference(frozen):
    """Bounded numerical receipt, not a replacement for the full historical report."""
    p=frozen['payload'];keys=('identity_id','name','comparison','period','period_basis','analysis_as_of','comparability_note')
    payload={k:deepcopy(p.get(k)) for k in keys}
    payload['members']=[{k:deepcopy(m[k]) for k in ('id','version','hash','company')} for m in p['members']]
    metrics=('gross_margin','cash_ratio','leverage','revenue_growth','net_margin')
    items=[]
    for item in p['result']['items']:
        row={k:deepcopy(item.get(k)) for k in ('id','company','source_kind','dataset_version','dataset_hash')}
        analysis=item['analysis']
        row['analysis']={k:deepcopy(analysis.get(k)) for k in ('current_period','baseline_period','comparison','warnings')}
        row['analysis']['metrics']={k:deepcopy(analysis['metrics'].get(k)) for k in metrics}
        items.append(row)
    payload['result']={'period':p['result']['period'],'items':items,'warning':p['result']['warning']}
    payload['units']={'gross_margin':'ratio','cash_ratio':'ratio','leverage':'ratio','revenue_growth':'ratio','net_margin':'ratio'}
    payload['summary_notice']='仅保留五项指标、可比性说明及来源的归档摘要，不等于完整原报告。缺失值保持为空。'
    return {k:frozen[k] for k in ('id','version','hash')}|{'payload':payload,'projection_hash':digest(payload)}


def resolve_source(store, user_id, identity_id, dataset_id, source_ref=None, *, run_id='', source_key=''):
    """Resolve client IDs to immutable server-owned origin, rejecting stale approval.

    allow_historical acknowledges changed business facts, never bypasses ownership,
    current identity scope, a missing source record or a malformed reference.
    """
    ref=source_ref.model_dump() if isinstance(source_ref,SourceRef) else dict(source_ref or {})
    if run_id and ref and (ref.get('kind')!='report' or ref.get('run_id')!=run_id):
        fail('SOURCE_MISMATCH','运行来源与来源引用不一致',409)
    if source_key and ref and (ref.get('kind')!='insight' or ref.get('source_key')!=source_key):
        fail('SOURCE_MISMATCH','建议来源与来源引用不一致',409)
    if not ref:ref={'kind':'report','run_id':run_id} if run_id else {'kind':'dataset'}
    kind=ref['kind'];extra={};evidence=[];baseline=None;binding=None
    if kind=='report':
        run=_owned(store,user_id,'runs',ref['run_id']);snapshot=run['snapshot'];result=run['result']
        if not result:fail('NOT_READY','来源运行尚未产生报告',409)
        _same_scope(identity_id,dataset_id,(snapshot.get('identity') or {}).get('id',''),run['dataset_id'])
        dataset_id=run['dataset_id'];baseline={'dataset_id':dataset_id,'dataset_version':snapshot.get('dataset_version'),
            'dataset_hash':snapshot.get('dataset_hash'),'company':snapshot['dataset']['company']}
        binding=snapshot.get('studio',{}).get('bindings',{}).get('identity')
        extra={'run_id':run['id'],'report_hash':digest(result),'report_title':result.get('title',''),
            'source_created_at':run['created_at']}
        if snapshot.get('comparison_artifact'):
            extra['comparison_reference']=_comparison_reference(snapshot['comparison_artifact'])
        citations=snapshot.get('citations',[])
        if ref.get('claim_id'):
            claim=next((c for c in result.get('llm',{}).get('review',{}).get('claims',[])
                        if c.get('id',digest(c)[:24])==ref['claim_id']),None)
            if not claim:fail('NOT_FOUND','来源解释不存在于该报告',404)
            review=ws.keyed(store,user_id,'claim_review',run['id']+':'+ref['claim_id'])
            extra.update(claim_id=ref['claim_id'],claim_hash=digest(claim),claim_snapshot=deepcopy(claim),
                claim_review_version=review['version'] if review else 0,
                claim_review_hash=digest(review['payload']) if review else None)
            citations=[c for c in citations if c.get('id') in claim.get('citation_ids',[])]
        evidence=_citation_evidence(citations)
    elif kind=='copilot':
        thread=ws.get(store,user_id,'assistant_thread',ref['thread_id']);tp=thread['payload']
        _same_scope(identity_id,dataset_id,tp.get('identity_id',''),tp.get('dataset_id',''));dataset_id=tp.get('dataset_id','')
        extra={'thread_id':thread['id']}
        if ref.get('message_id'):
            message=store.one('SELECT * FROM copilot_messages WHERE id=? AND user_id=? AND thread_id=?',
                (ref['message_id'],user_id,thread['id']))
            if not message:fail('NOT_FOUND','原问题不属于当前会话',404)
            response=message['payload']['response'];context=response.get('context',{})
            _same_scope(identity_id,dataset_id,(context.get('identity') or {}).get('id',''),context.get('dataset_id',''))
            baseline={'dataset_id':dataset_id,'dataset_version':context.get('dataset_version'),
                'dataset_hash':context.get('dataset_hash')}
            binding=context.get('identity_binding')
            extra.update(source_message_id=message['id'],message_hash=digest(message['payload']),
                source_created_at=message['created_at'],question=message['payload']['question'][:3000])
            evidence=_citation_evidence(response.get('citations',[]))
    elif kind=='alert':
        alert=ws.get(store,user_id,'alert',ref['alert_id']);ap=alert['payload']
        _same_scope(identity_id,dataset_id,ap.get('identity_id',''),ap.get('dataset_id',''));dataset_id=ap.get('dataset_id','')
        baseline={'dataset_id':dataset_id,'dataset_version':ap.get('dataset_version'),
            'dataset_hash':ap.get('dataset_hash')}
        binding=ap.get('identity_binding')
        extra={'alert_id':alert['id'],'alert_hash':digest({k:v for k,v in ap.items() if k not in {'acknowledged','ack_note','acknowledged_at','acknowledgement'}}),
            'rule_id':ap.get('rule_id'),'rule_version':ap.get('rule_version'),'evaluation_revision':ap.get('evaluation_revision'),
            'alert_snapshot':{k:ap.get(k) for k in ('title','value','metric','period','threshold','operator','evaluated_at','reason')}}
    elif kind=='action':
        action=ws.get(store,user_id,'action',ref['action_id']);ap=action['payload']
        if (action['version'],digest(ap))!=(ref.get('action_version'),ref.get('action_hash')):
            fail('SOURCE_CHANGED','已查看的行动版本或内容已经变化，请重新打开行动；不能自动替换为新版',409)
        _same_scope(identity_id,dataset_id,ap.get('identity_id',''),ap.get('dataset_id',''))
        dataset_id=ap.get('dataset_id','');origin=ap.get('provenance') or {}
        if origin.get('schema_version')!=1:origin={}
        baseline={'dataset_id':dataset_id,'dataset_version':origin.get('dataset_version'),
            'dataset_hash':origin.get('dataset_hash'),'company':origin.get('company',ap.get('company',''))}
        binding=deepcopy(origin.get('identity_binding'));evidence=deepcopy(origin.get('evidence',[]))
        inherited={'run_id','report_hash','report_title','source_created_at','claim_id','claim_hash','claim_snapshot',
            'comparison_reference','claim_review_version','claim_review_hash','thread_id','source_message_id','message_hash','proposal_id','question',
            'source_key','insight_hash','insight_binding_hash','insight_snapshot','alert_id','alert_hash','rule_id','rule_version','evaluation_revision','alert_snapshot'}
        extra={k:deepcopy(v) for k,v in origin.items() if k in inherited}
        # Flatten an optional API-created chain; never nest entire actions/histories.
        ancestors=deepcopy(origin.get('action_dependencies',[]))
        if origin.get('action_id'):
            ancestors.append({k:origin.get(k) for k in ('action_id','action_version','action_hash')})
        if len(ancestors)>10:fail('SOURCE_DEPTH_LIMIT','行动来源链已达上限，请从原始报告建立新的跟踪',409)
        extra.update(action_id=action['id'],action_version=action['version'],action_hash=digest(ap),
            action_title=ap.get('title',''),action_acceptance=ap.get('acceptance',''),action_status=ap.get('status'),
            action_dependencies=ancestors)
        completion=deepcopy(origin.get('action_acceptance_evidence',[]))
        done=[h for h in ap.get('history',[]) if h.get('status',h.get('to'))=='done']
        if ap.get('status')=='done' and done:
            fields={'id','version','content_hash','review_version','review_hash','title','source_url','captured_at'}
            completion.extend({k:deepcopy(v) for k,v in e.items() if k in fields}
                for e in done[-1].get('evidence_snapshots',[]))
        # Versions are part of the dedup key: a report and a completion can
        # legitimately cite different reviews of the same document.
        extra['action_acceptance_evidence']=list({digest(e):e for e in completion}.values())
    elif kind=='insight' or source_key:
        from .intelligence import build_insights
        items=build_insights(store,user_id,identity_id=identity_id)['items']
        key=ref.get('source_key') or source_key
        insight=next((i for i in items if i['key']==key),None)
        if insight:
            if dataset_id and dataset_id!=insight['dataset_id']:fail('DATASET_MISMATCH','建议与所选企业数据不一致',409)
            dataset_id=insight['dataset_id'];kind='insight'
            extra={'source_key':key,'insight_hash':digest({k:v for k,v in insight.items() if k!='action_id'}),
                'insight_binding_hash':digest(_insight_binding(insight)),
                'insight_snapshot':{k:v for k,v in insight.items() if k!='action_id'}}
        elif kind=='insight':fail('SOURCE_CHANGED','建议已变化或不属于当前身份，请刷新后重新选择',409)
        else:extra={'unverified_source_key':source_key}  # Legacy keys are labels, not verified insight lineage.
    data=_owned(store,user_id,'datasets',dataset_id) if dataset_id else None
    identity=resolve_identity(store,user_id,identity_id,dataset_id)
    if baseline is None:
        baseline={'dataset_id':dataset_id,'dataset_version':data['version'] if data else None,
            'dataset_hash':data['content_hash'] if data else None}
        binding=identity_binding(identity)
    baseline.setdefault('company',data['payload']['company'] if data else '')
    if ref.get('dataset_version') is not None and ref['dataset_version']!=baseline['dataset_version']:
        fail('SOURCE_CHANGED','选中的来源数据版本已变化，请重新打开来源',409)
    if ref.get('dataset_hash') and ref['dataset_hash']!=baseline['dataset_hash']:
        fail('SOURCE_CHANGED','选中的来源数据指纹已变化，请重新打开来源',409)
    provenance={'schema_version':1,'kind':kind if data or kind!='dataset' else 'manual','captured_at':now(),
        **baseline,'identity_id':identity_id,'identity_binding':binding,'evidence':evidence,
        **extra,'historical_acknowledged':bool(ref.get('allow_historical'))}
    impact=source_impact(store,user_id,provenance)
    if impact['state']!='current' and not ref.get('allow_historical'):
        fail('SOURCE_CHANGED','来源已变化或完整来源不可核验；请重新核对，或明确保留历史依据',409)
    return provenance


def _evidence_changes(store,user_id,snapshots,company):
    from .intelligence import evidence_catalog
    catalog={e['id']:e for e in evidence_catalog(store,user_id)} if snapshots else {}
    reasons=[]
    for snap in snapshots:
        doc=catalog.get(snap['id'])
        code=None;message=''
        if not doc:code='evidence_removed';message='原依据已删除；历史快照仍保留'
        elif snap.get('content_hash') and doc['content_hash']!=snap['content_hash']:
            code='evidence_changed';message='原依据内容已变化'
        elif not doc['eligible'] or doc['review'].get('company') not in ('',company):
            code='evidence_ineligible';message='原依据已被排除、过期或移出企业范围'
        elif (snap.get('version') is not None and doc['version']!=snap['version']) or (snap.get('review_version') is not None and doc['review_version']!=snap['review_version']) or (snap.get('review_hash') and digest(doc['review'])!=snap['review_hash']):
            code='evidence_review_changed';message='原依据或人工审阅版本已变化'
        if code:reasons.append({'code':code,'message':message,'evidence_id':snap['id']})
    return reasons


def source_impact(store,user_id,provenance):
    """Read-only live overlay. Missing legacy provenance is explicitly unknown."""
    if not provenance or provenance.get('schema_version')!=1:
        return {'state':'unknown','reasons':[{'code':'legacy_unknown','message':'旧记录未保存完整来源，无法回填当时依据'}],
            'baseline':None,'current':None}
    p=provenance;reasons=[];unavailable=False;unknown=False
    baseline={'dataset_id':p.get('dataset_id',''),'version':p.get('dataset_version'),'hash':p.get('dataset_hash')}
    d=store.owned('datasets',user_id,p['dataset_id']) if p.get('dataset_id') else None
    current={'dataset_id':d['id'],'version':d['version'],'hash':d['content_hash']} if d else None
    if p.get('dataset_id'):
        if not d:
            reasons.append({'code':'dataset_removed','message':'源企业数据已删除，保留历史依据'});unavailable=True
        elif not p.get('dataset_version') or not p.get('dataset_hash'):
            reasons.append({'code':'baseline_unknown','message':'来源没有完整的数据版本和指纹'});unknown=True
        elif (d['version'],d['content_hash'])!=(p['dataset_version'],p['dataset_hash']):
            reasons.append({'code':'dataset_changed','message':'当前企业数据已修订；历史依据不自动改写'})
    if p.get('identity_id'):
        identity=store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='identity' AND id=?",(user_id,p['identity_id']))
        if not identity or (identity['payload']['dataset_ids'] and p.get('dataset_id') not in identity['payload']['dataset_ids']):
            reasons.append({'code':'identity_unavailable','message':'服务身份已删除或企业已不在当前范围'});unavailable=True
        elif p.get('identity_binding') and identity_binding(identity)!=p['identity_binding']:
            reasons.append({'code':'identity_changed','message':'服务身份设置已变化'})
        elif not p.get('identity_binding'):
            reasons.append({'code':'identity_baseline_unknown','message':'来源未保存当时的身份版本'});unknown=True
    if p.get('run_id'):
        run=store.owned('runs',user_id,p['run_id'])
        if not run:
            reasons.append({'code':'report_removed','message':'原报告已删除；历史来源记录仍保留'});unavailable=True
        elif p.get('report_hash')!=digest(run['result']):
            reasons.append({'code':'report_changed','message':'原报告内容与记录指纹不一致'})
        if run:
            # The report helper deliberately omits run_id in its base provenance,
            # avoiding recursion while rechecking original contextual dependencies.
            extra_codes={'memory_removed','memory_withdrawn','memory_changed','objective_changed',
                'experiment_removed','experiment_changed'}
            if not p.get('claim_id'):extra_codes.add('human_review_disputes')
            report_dependencies=report_impact(store,user_id,run)
            if report_dependencies['state']=='unavailable':unavailable=True
            reasons.extend(r for r in report_dependencies['reasons'] if (r['code'] in extra_codes or r['code'].startswith('comparison_'))
                and r['code'] not in {existing['code'] for existing in reasons})
        if p.get('claim_id'):
            review=ws.keyed(store,user_id,'claim_review',p['run_id']+':'+p['claim_id'])
            if review and review['payload'].get('verdict')=='rejected':
                reasons.append({'code':'claim_rejected','message':'来源解释当前已被人工排除'})
            elif (review['version'] if review else 0)!=p.get('claim_review_version',0):
                reasons.append({'code':'claim_review_changed','message':'来源解释的人工审阅已变化'})
    if p.get('comparison_reference'):
        from .saved_comparisons import current_impact
        reference=p['comparison_reference']
        if digest(reference['payload'])!=reference.get('projection_hash'):
            reasons.append({'code':'comparison_receipt_changed','message':'行动归档的对照摘要校验不一致'});unavailable=True
        else:
            comparison_impact=current_impact(store,user_id,reference)
            existing={(r['code'],r.get('dataset_id')) for r in reasons}
            reasons.extend(r for r in comparison_impact['reasons'] if (r['code'],r.get('dataset_id')) not in existing)
            if comparison_impact['state']=='unavailable':unavailable=True
    if p.get('thread_id'):
        thread=store.one("SELECT id FROM workspace_objects WHERE user_id=? AND kind='assistant_thread' AND id=?",(user_id,p['thread_id']))
        if not thread:
            reasons.append({'code':'thread_removed','message':'来源研究会话已删除；历史来源记录仍保留'});unavailable=True
        elif p.get('source_message_id'):
            message=store.one('SELECT payload FROM copilot_messages WHERE user_id=? AND thread_id=? AND id=?',(user_id,p['thread_id'],p['source_message_id']))
            if not message:
                reasons.append({'code':'message_removed','message':'来源助手回答已删除'});unavailable=True
            elif digest(message['payload'])!=p.get('message_hash'):
                reasons.append({'code':'message_changed','message':'来源助手回答内容指纹已变化'})
    if p.get('source_key') and p.get('insight_hash') and d and not unavailable:
        from .intelligence import build_insights
        insight=next((i for i in build_insights(store,user_id,[d],identity_id=p.get('identity_id',''))['items'] if i['key']==p['source_key']),None)
        expected=p.get('insight_binding_hash') or (digest(_insight_binding(p['insight_snapshot'])) if p.get('insight_snapshot') else None)
        if not insight or (expected and digest(_insight_binding(insight))!=expected):
            reasons.append({'code':'insight_changed','message':'原建议已失效、隐藏或其规则依据已变化'})
    if p.get('alert_id'):
        alert=store.one("SELECT payload FROM workspace_objects WHERE user_id=? AND kind='alert' AND id=?",(user_id,p['alert_id']))
        if not alert:
            reasons.append({'code':'alert_removed','message':'原提醒已归档或删除；历史提醒依据仍保留'});unavailable=True
        elif digest({k:v for k,v in alert['payload'].items() if k not in {'acknowledged','ack_note','acknowledged_at','acknowledgement'}})!=p.get('alert_hash'):
            reasons.append({'code':'alert_changed','message':'原提醒的判定依据已变化'})
    if p.get('rule_id'):
        rule=store.one("SELECT version,payload FROM workspace_objects WHERE user_id=? AND kind='watch' AND id=?",(user_id,p['rule_id']))
        expected=p.get('evaluation_revision') if p.get('evaluation_revision') is not None else p.get('rule_version')
        current_revision=rule['payload'].get('evaluation_revision',rule['version']) if rule else None
        if not rule or current_revision!=expected:
            reasons.append({'code':'rule_changed','message':'提醒对应的跟踪规则已修改或删除；原阈值保持历史值'})
    for dependency in ([p] if p.get('action_id') else [])+p.get('action_dependencies',[]):
        action=store.one("SELECT version,payload FROM workspace_objects WHERE user_id=? AND kind='action' AND id=?",(user_id,dependency['action_id']))
        if not action:
            reasons.append({'code':'action_removed','message':'来源行动已清理；原行动标题、验收标准及依据仍保留','action_id':dependency['action_id']});unavailable=True
        elif action['version']!=dependency.get('action_version') or digest(action['payload'])!=dependency.get('action_hash'):
            reasons.append({'code':'action_changed','message':'来源行动内容或状态已修改；原跟踪阈值不会自动改变','action_id':dependency['action_id']})
    reasons.extend(_evidence_changes(store,user_id,p.get('evidence',[]),p.get('company','')))
    reasons.extend({**r,'dependency':'action_acceptance'} for r in
        _evidence_changes(store,user_id,p.get('action_acceptance_evidence',[]),p.get('company','')))
    changed=any(r['code'] not in {'baseline_unknown','identity_baseline_unknown'} for r in reasons)
    return {'state':'unavailable' if unavailable else 'changed' if changed else 'unknown' if unknown else 'current',
        'reasons':reasons,'baseline':baseline,'current':current}


def assert_source_current(store,user_id,provenance):
    if source_impact(store,user_id,provenance)['state']!='current':
        fail('PROPOSAL_STALE','来源数据、身份或证据已经变化，请重新核对并预览',409)


def evidence_snapshots(store,user_id,company,evidence_ids,evidence_refs=()):
    from .intelligence import evidence_catalog
    refs={r.id:r for r in evidence_refs}
    if len(refs)!=len(evidence_refs) or len(set(evidence_ids))!=len(evidence_ids):
        fail('EVIDENCE_DUPLICATE','同一依据不能重复选择',422)
    if refs and evidence_ids and set(refs)!=set(evidence_ids):
        fail('EVIDENCE_MISMATCH','证据标识与版本选择不一致',422)
    ids=evidence_ids or list(refs)
    catalog={e['id']:e for e in evidence_catalog(store,user_id)}
    result=[]
    for id in ids:
        doc=catalog.get(id)
        if not doc:fail('NOT_FOUND','验收依据不存在或无访问权限',404)
        if not doc['eligible'] or doc['review'].get('company') not in ('',company):
            fail('ACTION_EVIDENCE_SCOPE','关联证据已失效、被排除或不属于该企业，请重新选择',409)
        ref=refs.get(id)
        if ref and (ref.version,ref.content_hash,ref.review_version)!=(doc['version'],doc['content_hash'],doc['review_version']):
            fail('ACTION_EVIDENCE_CHANGED','所选验收依据或审阅版本已变化，请刷新后核对',409)
        text=doc['payload'].get('text','')
        result.append({'id':id,'version':doc['version'],'content_hash':doc['content_hash'],
            'review_version':doc['review_version'],'review_hash':digest(doc['review']),
            'review':deepcopy(doc['review']),'captured_at':now(),'title':doc['payload'].get('title',''),
            'source_url':doc['payload'].get('source_url',''),'text':text[:12000],
            'text_length':len(text),'text_truncated':len(text)>12000})
    return result


def with_source_impact(store,user_id,row):
    out={**row,'object_hash':digest(row['payload']),'source_impact':source_impact(store,user_id,row['payload'].get('provenance'))}
    if row.get('kind')=='action':
        accepted=[h for h in row['payload'].get('history',[]) if h.get('status',h.get('to'))=='done']
        if accepted:
            last=accepted[-1];snapshots=last.get('evidence_snapshots')
            reasons=_evidence_changes(store,user_id,snapshots or [],row['payload'].get('company',''))
            out['acceptance_impact']={'state':'unknown' if snapshots is None else 'changed' if reasons else 'current',
                'accepted_at':last.get('at'),'reasons':reasons,'historical_acceptance_preserved':True}
        else:out['acceptance_impact']=None
    return out


def report_impact(store,user_id,run):
    """Historical report truth and present-day applicability are separate read models."""
    from .clock import utc_today
    snapshot=run['snapshot'];bindings=snapshot.get('studio',{}).get('bindings',{})
    p={'schema_version':1,'kind':'report','dataset_id':run['dataset_id'],
       'dataset_version':snapshot.get('dataset_version'),'dataset_hash':snapshot.get('dataset_hash'),
       'company':snapshot['dataset']['company'],'identity_id':(snapshot.get('identity') or {}).get('id',''),
       'identity_binding':bindings.get('identity'),'evidence':_citation_evidence(snapshot.get('citations',[]))}
    impact=source_impact(store,user_id,p);reasons=impact['reasons']
    for old in snapshot.get('memory',[]):
        memory=store.owned('memories',user_id,old['id'])
        if not memory:reasons.append({'code':'memory_removed','message':'原计划使用的记忆已删除；报告仍保留当时上下文'})
        elif not memory['payload'].get('approved') or (memory['payload'].get('expires_at') and memory['payload']['expires_at']<utc_today().isoformat()):
            reasons.append({'code':'memory_withdrawn','message':'原记忆当前已撤回批准或到期'})
        elif memory['version']!=old.get('version'):
            reasons.append({'code':'memory_changed','message':'原记忆内容或适用范围已有修订'})
    if 'profile_version' in bindings:
        current=ws.keyed(store,user_id,'profile',p['company'])
        if (current['version'] if current else 0)!=bindings['profile_version']:
            reasons.append({'code':'objective_changed','message':'企业研究目标已有修订；原报告仍依据当时目标'})
    experiment=snapshot.get('experiment')
    if experiment:
        current=store.one("SELECT * FROM workspace_objects WHERE user_id=? AND kind='experiment' AND id=?",(user_id,experiment['id']))
        if not current:reasons.append({'code':'experiment_removed','message':'原数学实验已清理；报告保留当时冻结产物'})
        elif current['version']!=experiment['version'] or digest(current['payload'])!=experiment['hash']:
            reasons.append({'code':'experiment_changed','message':'原数学实验记录与批准时的版本不一致'})
    comparison=snapshot.get('comparison_artifact')
    if comparison:
        from .saved_comparisons import current_impact
        comparison_impact=current_impact(store,user_id,comparison)
        reasons.extend(comparison_impact['reasons'])
        if comparison_impact['state']=='unavailable':impact['state']='unavailable'
    reviews=store.all("SELECT payload FROM workspace_objects WHERE user_id=? AND kind='claim_review' AND json_extract(payload,'$.run_id')=?",(user_id,run['id']))
    disputed=sum(r['payload']['verdict']!='accepted' for r in reviews)
    if disputed:reasons.append({'code':'human_review_disputes','message':f'{disputed} 条解释存在人工拒绝或待补证意见；这不自动否定本地数学计算'})
    if impact['state']=='current' and reasons:impact['state']='changed'
    return {**impact,'historical_report_preserved':True,'human_review_count':len(reviews),'human_disputes':disputed}
