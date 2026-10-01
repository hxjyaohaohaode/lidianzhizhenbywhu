"""Durable, bounded dependency scheduler with explicit adaptation and per-call accounting.

The runtime executes registered Python capabilities only. Model responses can suggest
registered research directions; they cannot execute commands, add URLs, write user
records, raise a budget, or mutate permissions. Pauses occur between ready batches.
"""
from __future__ import annotations
from .clock import utc_today
import asyncio
import copy
import re
import math
import time
from datetime import date, datetime, timezone
from pydantic import ValidationError
from .store import uid, now, digest, encode
from .models import MODEL_VERSION
from .analytics import lineage
from .studio import SYSTEM
from .providers import ModelOutput
from .research_context import CLAIM_CONTRACT_VERSION, project_tools, disclosed_references, omit_tool_details
from .autonomy import node, validate_graph, CAPABILITIES, MODEL_CAPS, REPLAY_CAPABILITIES, execute_local_capability
from .autonomy_contracts import PlannerProposal
from . import workspace_store as ws

FINISHED = {'succeeded', 'degraded', 'failed', 'skipped', 'unknown'}
NOT_DISPATCHED_ERRORS = {'AUTHORIZATION_CHANGED', 'MODEL_AUTHORIZATION_CHANGED',
                         'MODEL_TRANSPORT_BUSY', 'MODEL_CIRCUIT_OPEN'}

class PauseBoundary(Exception):
    """An intentional, durable suspension, not a workflow failure."""


def check_claims(claims, metrics, permitted, *, disclosures=None):
    """Exact reference checks; no claim of semantic truth or numerical reliability."""
    valid = []; rejected = []; seen = set()
    available = {k for k, v in metrics.items() if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)}
    for raw in claims:
        c = dict(raw); reason = None
        m = set(c.get('metric_ids', [])); e = set(c.get('citation_ids', [])); t = set(c.get('tool_reference_ids', []))
        disclosure = (disclosures or {}).get(c.get('agent'), {})
        citations = set(disclosure.get('citation_ids', [])) if disclosures is not None else set(permitted)
        references = disclosure.get('tool_references', {})
        if not (m or e or t): reason = '无指标或证据引用'
        elif not m <= available or not e <= citations or not t <= set(references): reason = '引用不在实际发送或可计算范围'
        elif re.search(r'\d|https?://|<[^>]+>', c['text']): reason = '存在未经数值合同渲染的数字、链接或标记'
        elif c['text'] in seen: reason = '重复解释'
        if reason:
            rejected.append({'agent': c.get('agent', ''), 'reason': reason}); continue
        seen.add(c['text'])
        if t:
            c['tool_references'] = [copy.deepcopy(references[id]) for id in sorted(t)]
        c['id'] = digest(c)[:24]; c['verification'] = 'requires_human_review'; valid.append(c)
    return {'claims': valid, 'rejected_claims': len(rejected), 'rejections': rejected,
            'claim_contract_version': CLAIM_CONTRACT_VERSION,
            'scope': '结构与逐调用引用门禁，不证明语义正确、因果关系或模型独立性'}


class AdaptiveRun:
    def __init__(self, worker, run_id):
        self.worker = worker; self.store = worker.store; self.id = run_id
        self.row = self.store.one('SELECT * FROM runs WHERE id=?', (run_id,))
        self.s = self.row['snapshot']; self.st = self.s['studio']; self.r = self.row['payload']
        self.ex = self.st['execution']; self.user_id = self.row['user_id']
        from .connections import scoped_providers
        self.providers = scoped_providers(worker.providers, self.user_id)
        saved = self.store.one('SELECT * FROM adaptive_graphs WHERE run_id=?', (run_id,))
        if not saved or saved['user_id'] != self.user_id:
            raise RuntimeError('GRAPH_OWNERSHIP_MISMATCH')
        self.graph = copy.deepcopy(saved['payload']); self.version = saved['version']
        self.outputs = {}; self.node_states = {}; self.restored = set()
        self.latest_review = 'review'; self.started = time.monotonic()

    def event(self, kind, payload):
        self.worker.event(self.id, kind, payload)

    def graph_update(self, reason):
        self.validate_runtime_graph()
        by_id = {n['id']: n for n in self.graph['nodes']}
        for checkpoint in self.store.all('SELECT * FROM adaptive_checkpoints WHERE run_id=?', (self.id,)):
            n = by_id.get(checkpoint['node_id'])
            if not n or checkpoint['input_hash'] != digest({'snapshot': digest(self.s), 'node': n}):
                raise RuntimeError('CHECKPOINT_NODE_IMMUTABLE')
        with self.store.transaction() as db:
            self.worker.ensure_running(self.id)
            changed = db.execute('UPDATE adaptive_graphs SET payload=?,version=version+1,updated_at=? WHERE run_id=? AND user_id=? AND version=?',
                                 (encode(self.graph), now(), self.id, self.user_id, self.version)).rowcount
            if not changed: raise RuntimeError('GRAPH_CONFLICT')
            self.version += 1
            self.store.event(db, self.id, 'graph_replanned', {'version':self.version, 'reason':reason,
                'nodes':self.graph['nodes'], 'graph_hash':digest(self.graph)})

    def validate_runtime_graph(self):
        validate_graph(self.graph['nodes'], require_mandatory=True)
        approved = self.st['adaptive']
        for key in ('envelope', 'provider_bindings', 'fallback_bindings', 'active_strategy_version', 'policy', 'allowed_dynamic'):
            if self.graph.get(key) != approved.get(key):
                raise RuntimeError('APPROVAL_ENVELOPE_CHANGED')
        if len([n for n in self.graph['nodes'] if n['capability'] == 'revision']) > self.ex['max_revisions']:
            raise RuntimeError('REVISION_BUDGET_CHANGED')

    def pause_guard(self):
        self.worker.ensure_running(self.id)
        c = self.store.one('SELECT status FROM adaptive_controls WHERE run_id=?', (self.id,))
        if c and c['status'] in ('pause_requested', 'paused'):
            with self.store.transaction() as db:
                self.worker.ensure_running(self.id)
                db.execute("UPDATE adaptive_controls SET status='paused',version=version+1,updated_at=? WHERE run_id=?", (now(),self.id))
                db.execute("UPDATE runs SET state='interrupted',error=?,updated_at=? WHERE id=?", ('已在节点边界暂停；已完成步骤不会重复执行',now(),self.id))
                self.store.event(db,self.id,'paused',{'checkpoint_count':len(self.outputs),'no_new_external_calls':True})
            raise PauseBoundary()

    def verify_restore(self):
        from .studio import approved_run_valid
        if not approved_run_valid(self.store, self.row):
            raise RuntimeError('APPROVED_SNAPSHOT_INTEGRITY_FAILED')
        self.validate_runtime_graph()
        if not ws.verify_ledger(self.store, self.id)['valid']:
            raise RuntimeError('CHECKPOINT_EVENT_CHAIN_INVALID')
        if self.version == 1:
            if self.graph != self.st['adaptive']:
                raise RuntimeError('GRAPH_APPROVAL_MISMATCH')
        else:
            anchor = self.store.one("SELECT * FROM run_events WHERE run_id=? AND type='graph_replanned' ORDER BY seq DESC LIMIT 1", (self.id,))
            if not anchor or anchor['payload'].get('version') != self.version or anchor['payload'].get('graph_hash') != digest(self.graph):
                raise RuntimeError('GRAPH_EVENT_ANCHOR_INVALID')
        checkpoints = self.store.all('SELECT * FROM adaptive_checkpoints WHERE run_id=?', (self.id,))
        by_id = {n['id']: n for n in self.graph['nodes']}
        checkpoint_ids = {c['node_id'] for c in checkpoints}
        closed_calls = {}; legacy_no_sends = {}
        for call in self.store.all('SELECT * FROM adaptive_calls WHERE run_id=?', (self.id,)):
            n = by_id.get(call['node_id'])
            anchor = self.store.one("SELECT * FROM run_events WHERE run_id=? AND type='external_dispatch' AND json_extract(payload,'$.call_id')=? ORDER BY seq DESC LIMIT 1", (self.id, call['id']))
            if not n or n['capability'] not in MODEL_CAPS or call['user_id'] != self.user_id or not anchor:
                raise RuntimeError('DISPATCH_LEDGER_INTEGRITY_FAILED')
            dispatch = anchor['payload']
            if any(dispatch.get(k) != call.get(k) for k in ('provider', 'model', 'characters')) or dispatch.get('node') != call['node_id']:
                raise RuntimeError('DISPATCH_LEDGER_INTEGRITY_FAILED')
            for key in ('request_hash', 'memory_ids', 'citation_ids', 'tool_output_hashes', 'tool_references', 'claim_contract_version', 'plan_id', 'plan_fingerprint', 'graph_version'):
                if dispatch.get(key) != call['payload'].get(key):
                    raise RuntimeError('DISPATCH_LEDGER_INTEGRITY_FAILED')
            closure = self.store.one("SELECT * FROM run_events WHERE run_id=? AND type='external_call_closed' AND json_extract(payload,'$.call_id')=? ORDER BY seq DESC LIMIT 1", (self.id, call['id']))
            if not closure and call['payload'].get('dispatched') is False:
                legacy_no_sends.setdefault(call['node_id'], []).append(call)
            if closure:
                if (closure['seq'] <= anchor['seq'] or closure['payload'].get('node') != call['node_id'] or
                    closure['payload'].get('state') != call['state'] or
                    closure['payload'].get('payload_hash') != digest(call['payload'])):
                    raise RuntimeError('CALL_CLOSURE_INTEGRITY_FAILED')
                closed_calls[call['id']] = closure['seq']
            if call['node_id'] not in checkpoint_ids:
                # A lost checkpoint does not erase a persisted dispatch reservation.
                checkpoints.append({'node_id': n['id'], 'capability': n['capability'], 'state': 'running',
                                    'input_hash': digest({'snapshot': digest(self.s), 'node': n})})
                checkpoint_ids.add(call['node_id'])
        for c in checkpoints:
            if c['node_id'] not in by_id: raise RuntimeError('CHECKPOINT_GRAPH_MISMATCH')
            name = c['node_id']; n = by_id[name]
            expected = digest({'snapshot':digest(self.s),'node':n})
            if c['capability'] != n['capability'] or c['input_hash'] != expected:
                raise RuntimeError('CHECKPOINT_INTEGRITY_FAILED')
            if c['state'] not in FINISHED and name in legacy_no_sends:
                raise RuntimeError('CALL_CLOSURE_INTEGRITY_FAILED')
            if c['state'] in FINISHED:
                a = self.store.one('SELECT * FROM agent_artifacts WHERE id=? AND run_id=? AND node=?', (c['artifact_id'],self.id,name))
                anchor = self.store.one("SELECT * FROM run_events WHERE run_id=? AND type='step_completed' AND json_extract(payload,'$.artifact_id')=? ORDER BY seq DESC LIMIT 1", (self.id,c['artifact_id']))
                # Runtime node configuration is immutable after a node starts.
                if not a or not anchor or digest(a['payload']) != a['content_hash'] or anchor['payload'].get('output_hash') != a['content_hash'] or anchor['payload'].get('node') != name or anchor['payload'].get('checkpoint_state') != c['state']:
                    raise RuntimeError('CHECKPOINT_INTEGRITY_FAILED')
                # Old releases had no closure event. Only an independently anchored
                # matching failure can validate legacy no-send disclosure flags.
                for call in legacy_no_sends.get(name, []):
                    result = a['payload']; code = call['payload'].get('error_class')
                    if (call['state'] != 'failed' or call['payload'].get('remote_outcome_known') is not True or
                        code not in NOT_DISPATCHED_ERRORS or not isinstance(result, dict) or
                        result.get('status') not in ('failed', 'blocked') or result.get('call_id') != call['id'] or
                        result.get('error_class') != code):
                        raise RuntimeError('CALL_CLOSURE_INTEGRITY_FAILED')
                self.outputs[name] = a['payload']; self.node_states[name] = c['state']; self.restored.add(name)
                self.event('checkpoint_reused', {'node':name,'artifact_id':a['id'],'output_hash':a['content_hash']})
            elif n['capability'] in MODEL_CAPS:
                reservations = self.store.all('SELECT * FROM adaptive_calls WHERE run_id=? AND node_id=?', (self.id, name))
                if not reservations:
                    # The node started, but no durable dispatch boundary was crossed.
                    self.event('local_checkpoint_recompute', {'node':name,'reason':'未产生外部调用预约，可在重新检查授权后首次执行'})
                    continue
                if all(call['id'] in closed_calls and call['state'] == 'failed' and
                       call['payload'].get('remote_outcome_known') is True for call in reservations):
                    # A reservation is not evidence that bytes reached a provider.
                    # Only event-anchored closure data may establish a known verdict;
                    # unclosed reservations remain conservative and are never retried.
                    last = max(reservations, key=lambda call: closed_calls[call['id']])
                    code = last['payload'].get('error_class')
                    if last['payload'].get('dispatched') is False and code in NOT_DISPATCHED_ERRORS:
                        res = {'status':'blocked' if code == 'AUTHORIZATION_CHANGED' else 'failed',
                               'agent':name,'error_class':code,'call_id':last['id'],
                               'output':{'claims':[],'missing':['外部调用未发送；保留已记录的失败，不自动重试']}}
                        self.record(n, res, 'degraded')
                        self.restored.add(name)
                        self.event('known_call_failure_reused', {'node':name,'call_id':last['id'],
                            'error_class':code,'remote_outcome_known':True,'dispatched':False})
                        continue
                # A dispatch reservation survives crashes. An absent completion is NOT permission to bill again.
                res = {'status':'unknown','agent':name,'error_class':'REMOTE_OUTCOME_UNKNOWN',
                       'output':{'claims':[],'missing':['中断时外部结果未知；没有自动重发，需新计划明确授权重做']}}
                self.record(n, res, 'unknown')
                with self.store.transaction() as db:
                    db.execute("UPDATE adaptive_calls SET state='unknown',updated_at=? WHERE run_id=? AND node_id=? AND state IN ('reserved','sent')",(now(),self.id,name))
                self.event('unknown_call_not_repeated', {'node':name})
            else:
                self.event('local_checkpoint_recompute', {'node':name,'reason':'中断的只读确定性步骤可安全重算'})
        reviews = [n['id'] for n in self.graph['nodes'] if n['capability']=='review' and n['id'] in self.outputs]
        if reviews: self.latest_review = reviews[-1]

    def record(self, n, result, state):
        self.worker.ensure_running(self.id)
        name = n['id']; artifact = uid(); h = digest(result)
        input_hash = digest({'snapshot':digest(self.s),'node':n})
        with self.store.transaction() as db:
            self.worker.ensure_running(self.id)
            previous = self.store.one('SELECT * FROM adaptive_checkpoints WHERE run_id=? AND node_id=?', (self.id, name))
            if previous and (previous['state'] in FINISHED or previous['input_hash'] != input_hash or previous['capability'] != n['capability']):
                raise RuntimeError('CHECKPOINT_IMMUTABLE')
            db.execute('INSERT INTO agent_artifacts VALUES(?,?,?,?,?,?)', (artifact,self.id,name,encode(result),h,now()))
            db.execute('''INSERT INTO adaptive_checkpoints(run_id,node_id,capability,state,input_hash,artifact_id,started_at,finished_at)
                VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(run_id,node_id) DO UPDATE SET state=excluded.state,
                artifact_id=excluded.artifact_id,finished_at=excluded.finished_at''',
                (self.id,name,n['capability'],state,input_hash,artifact,now(),now()))
            self.store.event(db,self.id,'step_completed',{'node':name,'artifact_id':artifact,'output_hash':h,
                'outcome':result.get('status','completed') if isinstance(result,dict) else 'completed',
                'checkpoint_state':state})
        self.outputs[name]=result; self.node_states[name]=state

    def authorization_valid(self, binding):
        from .studio import approved_run_valid
        from .saved_experiments import binding_current
        from .saved_comparisons import current_impact as comparison_impact
        if not approved_run_valid(self.store, self.row):return False
        user=self.store.one('SELECT * FROM users WHERE id=?',(self.user_id,))
        b=self.st['bindings']
        if not binding_current(self.store,self.user_id,b.get('experiment')):return False
        if comparison_impact(self.store,self.user_id,self.s.get('comparison_artifact'))['state']!='current':return False
        if (datetime.now(timezone.utc)-datetime.fromisoformat(self.row['created_at'])).total_seconds()>86400:return False
        if not user or user['version'] != b['user_version']: return False
        from .identities import execution_service_valid
        if not execution_service_valid(self.store,self.user_id,b,self.r,self.worker.providers,binding):return False
        # Frozen input remains available for local report; new external sends require current authorization.
        d=self.store.owned('datasets',self.user_id,self.row['dataset_id'])
        if not d or d['version'] != b['dataset_version'] or d['content_hash'] != b['dataset_hash']:return False
        profile=ws.keyed(self.store,self.user_id,'profile',self.s['dataset']['company'])
        if (profile['version'] if profile else 0) != b['profile_version']:return False
        for m in self.s['memory']:
            if m['id'] not in self.st['packing']['included_memory_ids']:continue
            live=self.store.owned('memories',self.user_id,m['id'])
            if not live or live['version']!=m['version'] or not live['payload']['approved']:return False
            if m.get('payload_hash') and digest(live['payload']) != m['payload_hash']:return False
            expiry=live['payload'].get('expires_at')
            if expiry and expiry<utc_today().isoformat():return False
        for e in b['evidence']:
            live=self.store.owned('evidence',self.user_id,e['id']);review=ws.keyed(self.store,self.user_id,'evidence_review',e['id'])
            if not live or live['content_hash']!=e['hash'] or (review['version'] if review else 0)!=e['review_version']:return False
            if review and (review['payload']['status']=='rejected' or (review['payload'].get('expires_at') and review['payload']['expires_at']<utc_today().isoformat())):return False
        return True

    def reserve_call(self, n, binding, prompt, disclosure):
        with self.store.transaction() as db:
            self.worker.ensure_running(self.id)
            role = n['capability']
            if role not in MODEL_CAPS or n not in self.graph['nodes']:
                return None, 'UNAPPROVED_NODE'
            allowed = [self.graph['provider_bindings'].get(role), *self.graph['fallback_bindings']]
            if binding not in allowed:
                return None, 'UNAPPROVED_PROVIDER'
            prior = self.store.all('SELECT * FROM adaptive_calls WHERE run_id=? AND node_id=? ORDER BY created_at,id', (self.id, n['id']))
            if prior and (any(c['state'] != 'failed' or not re.fullmatch(r'MODEL_HTTP_429(?:_[A-Za-z0-9_]{1,40})?', c['payload'].get('error_class', '')) for c in prior) or any(c['provider'] == binding['id'] for c in prior)):
                return None, 'NODE_ALREADY_DISPATCHED'
            control=db.execute('SELECT status FROM adaptive_controls WHERE run_id=?',(self.id,)).fetchone()
            if not control or control['status']!='active':return None,'PAUSE_REQUESTED'
            ledger=db.execute('SELECT count(*) AS n,coalesce(sum(characters),0) AS chars FROM adaptive_calls WHERE run_id=?',(self.id,)).fetchone()
            envelope=self.graph['envelope']
            if ledger['n']>=envelope['max_calls']:return None,'CALL_BUDGET'
            if len(prompt)>self.worker.settings.max_context_chars or ledger['chars']+len(prompt)>envelope['total_context_chars']:
                return None,'TOTAL_CONTEXT_BUDGET'
            if not self.st['consent'] or not self.authorization_valid(binding):return None,'AUTHORIZATION_CHANGED'
            call_id=uid();at=now()
            metadata={**disclosure,'request_hash':digest(prompt),'plan_id':self.st['plan_id'],
                      'plan_fingerprint':self.st['fingerprint'],'graph_version':self.version,'usage':{}}
            db.execute('INSERT INTO adaptive_calls VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                (call_id,self.id,self.user_id,n['id'],binding['id'],binding['model'],'sent',len(prompt),encode(metadata),at,at))
            self.store.event(db,self.id,'external_dispatch',{'node':n['id'],'agent':n['id'],'call_id':call_id,
                'provider':binding['id'],'model':binding['model'],'characters':len(prompt),**metadata,'consent':True})
            return call_id,None

    def close_call(self, call_id, state, metadata):
        with self.store.transaction() as db:
            # A cancelled/deleted run cannot acquire a late response artefact. A still-existing ledger records uncertainty.
            row=self.store.one('SELECT * FROM adaptive_calls WHERE id=? AND run_id=? AND user_id=?',(call_id,self.id,self.user_id))
            if row:
                payload={**row['payload'],**metadata}
                db.execute('UPDATE adaptive_calls SET state=?,payload=?,updated_at=? WHERE id=?',
                           (state,encode(payload),now(),call_id))
                self.store.event(db,self.id,'external_call_closed',{'node':row['node_id'],'call_id':call_id,
                    'state':state,'payload_hash':digest(payload)})

    async def model(self,n):
        cap=n['capability']; bindings=self.graph['provider_bindings'];role='revision' if cap=='revision' else cap
        binding=bindings.get(role)
        if not binding:return {'agent':n['id'],'status':'unavailable','error_class':'NOT_CONFIGURED','output':{'claims':[],'missing':[]}}
        obj=copy.deepcopy(self.st['context'])
        if self.graph.get('model_proposal'):obj['research_focus']=self.graph['model_proposal']['focus']
        # Summaries derive exclusively from the same approved snapshot. No new data sources.
        tool_results=project_tools(self.outputs)
        if tool_results:obj['approved_tool_results']=tool_results
        if cap=='planner':
            obj={'question':obj['question'],'mode':obj['mode'],'objective':obj['objective'],
                 'available_capabilities':list(CAPABILITIES),'approved_nodes':[x['id'] for x in self.graph['nodes']],
                 'budget':self.graph['envelope'],'evidence_count':len(self.s['citations']),
                 'data_warnings':self.outputs.get('quality',{}).get('findings',[])[:6]}
        if cap in ('analyst','researcher'):
            peers=[dep for dep in n['depends_on'] if dep in ('analyst','researcher')]
            obj['peer_findings']=[c for dep in peers for c in self.outputs.get(dep,{}).get('output',{}).get('claims',[])][:2]
        if cap=='challenger':
            obj['prior_hypotheses']=[c for k,v in self.outputs.items() if k in ('analyst','researcher') for c in v.get('output',{}).get('claims',[])][:2]
        if cap=='revision':
            obj['structural_rejections']=self.outputs[self.latest_review]['rejections'][:8]
            obj['revision_instruction']='仅修复引用/结构不符合的解释，证据不足可返回空claims；不得虚构事实。'
        prompt=encode(obj)
        if len(prompt)>self.worker.settings.max_context_chars:
            # Whole peer hypotheses are expendable; core approved source context is never sliced mid-entry.
            obj.pop('prior_hypotheses',None);prompt=encode(obj)
        if len(prompt)>self.worker.settings.max_context_chars and 'approved_tool_results' in obj:
            obj['approved_tool_results']=omit_tool_details(tool_results);prompt=encode(obj)
        candidates=[binding,*self.graph['fallback_bindings']]
        seen=set()
        for b in candidates:
            if b['id'] in seen:continue
            seen.add(b['id'])
            disclosure={'memory_ids':[m['id'] for m in obj.get('approved_memory',[])],
                        'citation_ids':[c['id'] for c in obj.get('evidence',[])],
                        'tool_output_hashes':{k:digest(v) for k,v in obj.get('approved_tool_results',{}).items()},
                        'tool_references':disclosed_references(obj.get('approved_tool_results',{})),
                        'claim_contract_version':CLAIM_CONTRACT_VERSION}
            call_id,error=self.reserve_call(n,b,prompt,disclosure)
            if not call_id:
                return {'agent':n['id'],'status':'blocked','error_class':error,'output':{'claims':[],'missing':[error]}}
            started=time.monotonic()
            try:
                self.worker.ensure_running(self.id)
                p=self.providers.select(b['id'])
                if not p or not self.authorization_valid(b):
                    self.close_call(call_id,'failed',{'error_class':'AUTHORIZATION_CHANGED','remote_outcome_known':True,'dispatched':False})
                    return {'agent':n['id'],'status':'blocked','error_class':'AUTHORIZATION_CHANGED','call_id':call_id,'output':{'claims':[],'missing':['外部调用前授权已改变']}}
                # A slow DNS/TLS handshake is another revocation boundary. Copy
                # the selected configuration: server providers are shared across
                # concurrent runs, so a callback must never mutate their object.
                from .providers import Provider
                if isinstance(p, Provider):
                    p = copy.copy(p)
                    def dispatch_guard(binding=b):
                        current = self.store.one('SELECT state FROM runs WHERE id=?', (self.id,))
                        return bool(current and current['state']=='running' and self.authorization_valid(binding))
                    p.dispatch_guard = dispatch_guard
                if cap=='planner':
                    if not hasattr(self.providers,'propose'):raise ValueError('PLANNER_UNSUPPORTED')
                    result=await self.providers.propose(p,prompt)
                    proposal=PlannerProposal.model_validate(result['output']).model_dump()
                    output=proposal
                else:
                    result=await self.providers.complete(p,SYSTEM+'\n本次职责：'+CAPABILITIES[cap][1],prompt)
                    output=ModelOutput.model_validate(result['output']).model_dump()
                self.worker.ensure_running(self.id)
                usage=result.get('usage',{})
                usage={k:v for k,v in usage.items() if k in ('prompt_tokens','completion_tokens','total_tokens') and isinstance(v,int) and not isinstance(v,bool) and v>=0}
                self.close_call(call_id,'completed',{'usage':usage,'duration_ms':round((time.monotonic()-started)*1000,2)})
                return {'agent':n['id'],'status':'completed','provider':p.id,'model':p.model,'call_id':call_id,'usage':usage,'output':output}
            except asyncio.CancelledError:
                self.close_call(call_id,'unknown',{'error_class':'CANCELLED_REMOTE_OUTCOME_UNKNOWN'});raise
            except Exception as exc:
                code=str(exc) if re.fullmatch(r'MODEL_[A-Za-z0-9_]{1,100}',str(exc)) else type(exc).__name__
                unknown = not isinstance(exc, (ValueError, ValidationError))
                not_dispatched = isinstance(exc, ValueError) and code in NOT_DISPATCHED_ERRORS
                self.close_call(call_id,'unknown' if unknown else 'failed',{'error_class':code,'remote_outcome_known':not unknown,
                    **({'dispatched':False} if not_dispatched else {}),'duration_ms':round((time.monotonic()-started)*1000,2)})
                self.worker.ensure_running(self.id)
                # Only an acknowledged throttle can use an explicitly approved alternate. Timeouts/unknown outcomes do not.
                if re.fullmatch(r'MODEL_HTTP_429(?:_[A-Za-z0-9_]{1,40})?',code) and len(seen)<len({x['id'] for x in candidates}):
                    self.event('authorized_fallback',{'node':n['id'],'failed_provider':b['id'],'reason':'HTTP_429','counts_toward_budget':True});continue
                return {'agent':n['id'],'status':'unknown' if unknown else 'failed','error_class':code,'call_id':call_id,'output':{'claims':[],'missing':['模型未成功返回；保留本地结果，不伪造解释']}}
        return {'agent':n['id'],'status':'failed','output':{'claims':[],'missing':[]}}

    def local(self,n):
        cap=n['capability'];data=self.s['dataset']
        if cap in REPLAY_CAPABILITIES:
            return execute_local_capability(cap, self.s, self.r, self.ex, self.outputs,
                                            today=date.fromisoformat(self.s.get('analysis_as_of',self.row['created_at'][:10])))
        if cap=='context':return self.st['packing']
        if cap=='review':
            claims=[]
            if n['id']!='review':
                old=self.outputs.get(self.latest_review,{});claims+=old.get('claims',[])
                sources=[n['depends_on'][0]]
            else:sources=[x['id'] for x in self.graph['nodes'] if x['capability'] in {'analyst','researcher','challenger'}]
            for id in sources:
                res=self.outputs.get(id,{})
                claims += [{**c,'agent':id} for c in res.get('output',{}).get('claims',[])]
            disclosures={}
            for agent, output in self.outputs.items():
                call_id=output.get('call_id') if isinstance(output,dict) else None
                if not call_id:continue
                call=self.store.one("SELECT * FROM adaptive_calls WHERE id=? AND run_id=? AND node_id=? AND state='completed'",(call_id,self.id,agent))
                if call:disclosures[agent]=call['payload']
            return check_claims(claims,self.outputs['quant']['metrics'],[],disclosures=disclosures)
        if cap=='reflection':
            review=self.outputs[self.latest_review]
            calls=self.store.all('SELECT * FROM adaptive_calls WHERE run_id=?',(self.id,))
            problems=[{'node':k,'state':v.get('status'),'reason':v.get('reason') or v.get('error_class')} for k,v in self.outputs.items()
                      if isinstance(v,dict) and v.get('status') in ('failed','blocked','unknown','missing','needs_input','insufficient_data')]
            return {'scope':'本次实际执行质量，不是模型准确率或能力自我证明','call_attempts':len(calls),
                    'successful_calls':sum(c['state']=='completed' for c in calls),'context_characters':sum(c['characters'] for c in calls),
                    'restored_nodes':sorted(self.restored),'rejected_claims':review['rejected_claims'],
                    'issues':problems,'data_coverage':self.outputs['quality']['field_coverage'],
                    'graph_revisions':self.version-1,'model_weight_updates':0,'automatic_code_changes':0,
                    'success_criteria':self.st['success_criteria'],'criteria_verification':'需要人工验收，未将自然语言标准标为自动通过'}
        if cap=='report':return self.report()
        raise ValueError('UNKNOWN_LOCAL_CAPABILITY')

    async def execute_node(self,n):
        self.worker.ensure_running(self.id)
        if not n.get('enabled',True):
            self.record(n,{'status':'skipped','reason':n.get('skip_reason','任务不需要')},'skipped')
            self.event('step_skipped',{'node':n['id'],'reason':n.get('skip_reason')});return
        input_hash=digest({'snapshot':digest(self.s),'node':n})
        with self.store.transaction() as db:
            self.worker.ensure_running(self.id)
            previous = self.store.one('SELECT * FROM adaptive_checkpoints WHERE run_id=? AND node_id=?', (self.id, n['id']))
            if previous and (previous['state'] in FINISHED or previous['input_hash'] != input_hash):
                raise RuntimeError('CHECKPOINT_IMMUTABLE')
            db.execute('''INSERT INTO adaptive_checkpoints(run_id,node_id,capability,state,input_hash,artifact_id,started_at,finished_at)
                VALUES(?,?,?,?,?,NULL,?,NULL) ON CONFLICT(run_id,node_id) DO UPDATE SET state='running',started_at=excluded.started_at''',
                (self.id,n['id'],n['capability'],'running',input_hash,now()))
            self.store.event(db,self.id,'step_started',{'node':n['id'],'reason':n.get('reason') or n['purpose'],
                'depends_on':n['depends_on'],'input_hash':input_hash})
        started=time.monotonic()
        try:
            if n['capability'] in MODEL_CAPS:result=await self.model(n)
            else:
                # Yield between local nodes so cancellation/pause requests are observed.
                await asyncio.sleep(0);result=self.local(n)
        except asyncio.CancelledError:raise
        except Exception as exc:
            if n['capability'] in ('quality','quant','review','report','reflection'):raise
            result={'status':'blocked','error_class':type(exc).__name__,'reason':str(exc) if isinstance(exc,ValueError) and n['capability'] in ('forecast','sensitivity') else '能力执行失败；保留明确缺口，不制造补全结果'}
        if result.get('error_class')=='PAUSE_REQUESTED' and not self.store.one('SELECT id FROM adaptive_calls WHERE run_id=? AND node_id=?',(self.id,n['id'])):
            with self.store.transaction() as db:
                db.execute('DELETE FROM adaptive_checkpoints WHERE run_id=? AND node_id=?',(self.id,n['id']))
            return
        state='succeeded' if result.get('status','completed')=='completed' else 'degraded'
        self.record(n,result,state)
        self.event('node_timing',{'node':n['id'],'duration_ms':round((time.monotonic()-started)*1000,2)})

    def adapt(self):
        ids={n['id'] for n in self.graph['nodes']};changes=[]
        def add_local(cap,deps,reason):
            if cap in ids:return
            self.graph['nodes'].append(node(cap,deps,reason=reason));ids.add(cap)
            context=next(n for n in self.graph['nodes'] if n['id']=='context')
            # Context has already been frozen/authorized. Do not mutate a completed checkpoint.
            target=context if 'context' not in self.outputs else next(n for n in self.graph['nodes'] if n['id']=='review')
            if target['id'] not in self.outputs and cap not in target['depends_on']:target['depends_on'].append(cap)
            for specialist in self.graph['nodes']:
                if specialist['capability'] in {'analyst','researcher','challenger'} and specialist['id'] not in self.outputs and cap not in specialist['depends_on']:
                    specialist['depends_on'].append(cap)
            changes.append(reason)
        if self.ex['local_recovery'] and 'quality' in self.outputs:
            if self.outputs['quality']['field_coverage']['missing']:
                add_local('gaps',['quality'],'数据核验发现缺失字段，追加只读缺口补全规划')
        if self.ex['local_recovery'] and 'quality' in self.outputs and 'quant' in self.outputs:
            from .research_gaps import needs_gap_analysis
            if needs_gap_analysis(self.outputs['quality'],self.outputs['quant']):
                add_local('gaps',['quality','quant'],'实际规则存在不可计算项或指定基期缺失，追加具体输入核查')
        if 'evidence' in self.outputs and not self.s['citations']:
            for n in self.graph['nodes']:
                if n['capability']=='researcher' and n['id'] not in self.outputs and n['enabled']:
                    n['enabled']=False;n['skip_reason']='没有可用证据，避免无依据模型调用';changes.append('跳过无证据的行业专家')
        if 'planner' in self.outputs and not self.graph.get('planner_applied'):
            res=self.outputs['planner'];self.graph['planner_applied']=True
            if res.get('status')=='completed':
                proposal=PlannerProposal.model_validate(res['output']).model_dump()
                if self.ex['local_recovery']:
                    for cap in ['counterevidence','gaps','forecast']:
                        if (cap=='gaps' and 'quality' in proposal['focus']) or cap in proposal['focus']:
                            add_local(cap,['quality' if cap in ('gaps','forecast') else 'evidence'],'模型提出在原输入范围追加 '+cap)
                # Only already disclosed specialist/model bindings may be used. A new specialist
                # consumes the SAME cumulative allowance, not an independent or reset budget.
                selected=set(proposal['specialists'])
                if 'researcher' in selected and 'researcher' not in ids and self.s['citations'] and self.graph['provider_bindings'].get('researcher'):
                    if len([x for x in self.graph['nodes'] if x['capability'] in MODEL_CAPS])<self.graph['envelope']['max_calls']:
                        deps=['context','planner',*[c for c in ('forecast','gaps','counterevidence') if c in ids]]
                        self.graph['nodes'].append(node('researcher',deps,reason='模型在原披露角色与预算内请求证据研究'))
                        ids.add('researcher');self.graph['call_ids'].append('researcher')
                        next(x for x in self.graph['nodes'] if x['id']=='review')['depends_on'].append('researcher')
                        critic=next((x for x in self.graph['nodes'] if x['id']=='challenger'),None)
                        if critic:critic['depends_on'].append('researcher')
                for n in self.graph['nodes']:
                    if n['capability'] in ('analyst','researcher','challenger') and n['capability'] not in selected and n['id'] not in self.outputs:
                        n['enabled']=False;n['skip_reason']='规划专家未选择此可选分工，保留工具与复核门禁'
                by_id={n['id']:n for n in self.graph['nodes']}
                if all(k in by_id and k not in self.outputs for k in ('analyst','researcher')):
                    order=proposal['execution_order']
                    if order=='evidence_first':by_id['analyst']['depends_on'].append('researcher')
                    elif order=='analysis_first':by_id['researcher']['depends_on'].append('analyst')
                changes.append('根据限定分工合同配置专家顺序：'+proposal['execution_order'])
                self.graph['model_proposal']=proposal;changes.append('按注册能力和最小调用原则吸收规划建议，未增加权限')
            else:changes.append('模型规划不可用，降级为已批准的本地依赖图')
        reviews=[n for n in self.graph['nodes'] if n['capability']=='review' and n['id'] in self.outputs]
        if reviews:
            latest=reviews[-1]['id'];self.latest_review=latest
            res=self.outputs[latest]
            consumed=len(self.store.all('SELECT id FROM adaptive_calls WHERE run_id=?',(self.id,)))
            rounds=len([n for n in self.graph['nodes'] if n['capability']=='revision'])
            # Exact duplicates are removed locally; paying a model to restate them adds no evidence.
            needs_repair=any(x.get('reason')!='重复解释' for x in res.get('rejections',[]))
            if needs_repair and rounds<self.ex['max_revisions'] and consumed<self.graph['envelope']['max_calls'] and not self.graph.get('handled_'+latest):
                self.graph['handled_'+latest]=True
                rn='revision_'+str(rounds+1);rv='review_'+str(rounds+1)
                self.graph['nodes'] += [node('revision',[latest],id=rn,reason='结构复核未通过，在原授权预算内有限修订'),node('review',[rn],id=rv)]
                next(n for n in self.graph['nodes'] if n['id']=='reflection')['depends_on']=[rv]
                changes.append('追加修订与重新复核，不以模型自评代替门禁')
        if changes:self.graph_update('；'.join(changes))

    def report(self):
        from .saved_experiments import provenance
        from .saved_comparisons import provenance as comparison_provenance
        maths=self.outputs['quant'];review=self.outputs[self.latest_review];data=self.s['dataset']
        def pct(v):return '不可计算' if v is None else f'{v*100:.2f}%'
        findings=[f"{data['company']} · {maths['current_period']}：毛利率{pct(maths['metrics']['gross_margin'])}，经营现金收入比{pct(maths['metrics']['cash_ratio'])}。"]
        if not self.s['citations']:findings.append('没有符合范围的资料；行业事实与支持/反向论据保留为缺口。')
        ledger=self.store.all('SELECT * FROM adaptive_calls WHERE run_id=? ORDER BY created_at,id',(self.id,))
        success=[c for c in ledger if c['state']=='completed'];sent=set();memory=set()
        for c in ledger:
            if c['state'] not in ('reserved',) and c['payload'].get('dispatched') is not False:
                sent.update(c['payload'].get('citation_ids',[]));memory.update(c['payload'].get('memory_ids',[]))
        requested=self.r['use_llm'];state='not_requested' if not requested else 'completed' if ledger and len(success)==len(ledger) else 'partial' if success else 'failed'
        model_nodes=[v for k,v in self.outputs.items() if any(n['id']==k and n['capability'] in MODEL_CAPS for n in self.graph['nodes'])]
        if requested and any(v.get('status') in ('blocked','failed','unknown','unavailable') for v in model_nodes):state='partial' if success else 'failed'
        warnings=list(maths['warnings'])
        if state in ('partial','failed'):warnings.append('模型链路未全部完成；未成功的解释不予生成，规则计算仍可追溯。')
        if any(v.get('status')=='blocked' for v in self.outputs.values()):warnings.append('部分能力未达门槛，查看节点产物与缺口清单。')
        return {'title':data['company']+' · 协同研判','query':self.r['query'],'mode':self.r['mode'],
            'dataset_id':self.row['dataset_id'],'dataset_version':self.s['dataset_version'],'dataset_hash':self.s['dataset_hash'],
            'snapshot_hash':digest(self.s),'research_scope':self.s.get('research_scope'),'experiment':provenance(self.s.get('experiment')),'model_version':MODEL_VERSION,'analysis':maths,'quality':self.outputs['quality'],
            'comparison_artifact':self.s.get('comparison_artifact'),'comparison_provenance':comparison_provenance(self.s.get('comparison_artifact')),
            'findings':findings,'citations':self.s['citations'],'lineage':lineage(data,maths),
            'memory_selected':[{'id':x['id'],'version':x['version']} for x in self.s['memory']],
            'memory_used':[{'id':x['id'],'version':x['version']} for x in self.s['memory'] if x['id'] in memory],
            'citation_ids_sent':sorted(sent),'llm':{'state':state,'review':review,'calls':[
                {'agent':c['node_id'],'status':c['state'],'provider':c['provider'],'model':c['model'],**c['payload']} for c in ledger]},
            'missing':[x for v in model_nodes for x in v.get('output',{}).get('missing',[])],
            'plan':{'id':self.st['plan_id'],'fingerprint':self.st['fingerprint'],'success_criteria':self.st['success_criteria']},
            'adaptive':{'graph_version':self.version,'nodes':self.graph['nodes'],'reflection':self.outputs.get('reflection',{}),
                        'mathematical_outputs':{k:v for k,v in self.outputs.items() if k in ('forecast','sensitivity','counterevidence','gaps','comparison')}},
            'warnings':warnings,'limitations':['规划自适应不等于模型训练或自动修改程序。','回测与情景计算不是已校准的未来概率。','多角色可能使用同一模型；引用合法不证明解释真实。'], 'created_at':now()}

    async def run(self):
        self.verify_restore()
        # Apply any adaptation missed by a crash immediately after checkpoint completion.
        self.adapt()
        while True:
            self.pause_guard()
            todo=[n for n in self.graph['nodes'] if n['id'] not in self.outputs]
            if not todo:break
            ready=[n for n in todo if all(dep in self.outputs for dep in n['depends_on'])]
            if not ready:raise RuntimeError('DAG_DEADLOCK')
            batch=[asyncio.create_task(self.execute_node(n)) for n in ready[:self.ex['parallelism']]]
            try:await asyncio.gather(*batch)
            finally:
                for task in batch:
                    if not task.done():task.cancel()
                await asyncio.gather(*batch,return_exceptions=True)
            self.adapt()
        self.worker.ensure_running(self.id)
        result=self.outputs['report']
        degraded=bool(result['llm']['review']['rejected_claims']) or result['llm']['state'] in ('partial','failed','unavailable') or any(v.get('status') in ('blocked','failed','unknown','insufficient_data') for v in self.outputs.values()) or result['analysis']['gmps']['score'] is None
        terminal='degraded' if degraded else 'succeeded'
        with self.store.transaction() as db:
            if not db.execute("UPDATE runs SET state=?,result=?,error=NULL,updated_at=? WHERE id=? AND state='running'",(terminal,encode(result),now(),self.id)).rowcount:return
            if not db.execute("SELECT 1 FROM messages WHERE run_id=? AND role='assistant'",(self.id,)).fetchone():
                db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',(uid(),self.user_id,self.row['session_id'],self.id,'assistant',encode({'text':'\n'.join(result['findings']),'run_id':self.id}),now()))
            self.store.event(db,self.id,terminal,{'state':terminal,'report_ready':True,'graph_version':self.version,'snapshot_hash':digest(self.s)})
            self.store.audit(db,self.user_id,'runs',self.id,terminal)


async def perform_adaptive(worker,run_id):
    try:await AdaptiveRun(worker,run_id).run()
    except PauseBoundary:return
