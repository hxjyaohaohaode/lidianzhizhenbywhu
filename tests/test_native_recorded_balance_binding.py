"""Actual offline API objects corroborate the native identity oracle, not pixels."""
from copy import deepcopy

import pytest

from scripts.service_browser_check import assert_copilot_entity_binding
from test_direct_balance_fields import balance_actor, imported
from test_copilot_research_inputs import execute_proposal
from test_services import ok, thread, message, proposal


def test_same_valued_old_message_or_run_cannot_satisfy_the_new_visible_task(balance_actor):
    actor=balance_actor
    dataset,_=imported(actor)
    current=thread(actor,dataset)
    question='2024-Q4总资产、总负债和资产负债率分别是多少'

    def create(key):
        t=ok(actor.get('/services/threads/'+current['id']))['thread']
        m=ok(message(actor,t,text=question,key=key),201)['message']
        loaded=ok(actor.get('/services/threads/'+current['id']))
        assert next(row for row in loaded['messages'] if row['id']==m['id'])=={
            field:m[field] for field in ('id','payload','created_at')}
        p=ok(proposal(actor,t,text=question,source_message_id=m['id'],request_id=key,
            use_llm=False,max_calls=0,execution={'depth':'balanced'}),201)
        plan=ok(actor.get('/workspace/plans/'+p['payload']['plan_id']))
        run=execute_proposal(actor,p)
        saved=ok(actor.get('/services/proposals/'+p['id']))
        return m,saved,plan,run

    old=create('old-same-values')
    new=create('new-visible-task')
    assert old[3]['result']['readout']['facts']==new[3]['result']['readout']['facts']
    ids={'message_id':new[0]['id'],'proposal_id':new[1]['id'],'thread_id':current['id'],
         'dataset_id':dataset['id'],'prior_run_ids':{old[3]['id']}}
    assert_copilot_entity_binding(*new,**ids)

    for position in range(4):
        substituted=list(new);substituted[position]=old[position]
        with pytest.raises(AssertionError):
            assert_copilot_entity_binding(*substituted,**ids)
    for key,value in [('message_id',old[0]['id']),('proposal_id',old[1]['id']),
        ('thread_id','wrong-thread'),('dataset_id','wrong-dataset'),
        ('prior_run_ids',{old[3]['id'],new[3]['id']})]:
        with pytest.raises(AssertionError):
            assert_copilot_entity_binding(*new,**{**ids,key:value})
    called=deepcopy(new)
    called[3]['result']['llm']['calls']=[{'synthetic_unexpected_call':True}]
    with pytest.raises(AssertionError):
        assert_copilot_entity_binding(*called,**ids)
