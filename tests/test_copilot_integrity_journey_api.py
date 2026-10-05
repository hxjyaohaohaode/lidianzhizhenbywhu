"""Protected in-process API corroboration, explicitly not native UI evidence."""
from copy import deepcopy
import json

from scripts import product_copilot_integrity as scenario
from scripts.native_integrity_faults import damaged_copilot_result, _read_copilot_records
from test_services import ok, thread, message, proposal
from test_copilot_research_inputs import execute_proposal


def test_new_message_bound_research_in_same_thread_does_not_inherit_damaged_report(actor, example):
    data = deepcopy(example)
    data.update(company='同会话完整性合同合成企业（非真实财报）', source_kind='user_provided')
    for index, period in enumerate(data['periods']):
        period.update(period=f'{2023 + index // 4}-Q{index % 4 + 1}', revenue=100000, cost=80000)
    data['periods'][-1]['period'] = '2024-Q4'
    dataset = ok(actor.post('/datasets', json=data), 201)
    t = thread(actor, dataset)

    def create(question, key):
        current = ok(actor.get('/services/threads/' + t['id']))['thread']
        m = ok(message(actor, current, text=question, key=key), 201)['message']
        p = ok(proposal(actor, current, text=question, source_message_id=m['id'],
            request_id=key, use_llm=False, max_calls=0, execution={'depth':'balanced'}), 201)
        assert p['payload']['preview']['max_calls'] == 0
        run = execute_proposal(actor, p)
        p = ok(actor.get('/services/proposals/' + p['id']))
        assert run['result']['readout']['facts'][0]['value'] == .2
        assert run['result']['llm']['state'] == 'not_requested' and run['result']['llm']['calls'] == []
        return p, run

    old_proposal, old = create(scenario.QUERY, 'original-current-report')
    healthy_audit = ok(actor.get('/workspace/runs/' + old['id'] + '/audit'))
    scenario.expect_card_api(ok(actor.get('/services/threads/' + t['id'])), old_proposal, old, available=True)
    store = actor.client.app.state.store
    original = _read_copilot_records(store.db, actor.user['id'], old['id'], old_proposal['id'])
    raw = damaged_copilot_result(original['run']['result'])
    # Declared isolated corruption, never a business API write or UI action.
    with store.transaction() as db:
        db.execute('UPDATE runs SET result=? WHERE id=? AND user_id=?', (raw, old['id'], actor.user['id']))
    damaged = _read_copilot_records(store.db, actor.user['id'], old['id'], old_proposal['id'])
    scenario.expect_fault_audit(healthy_audit, ok(actor.get('/workspace/runs/' + old['id'] + '/audit')))
    scenario.expect_card_api(ok(actor.get('/services/threads/' + t['id'])), old_proposal, old, available=False, raw=raw)
    fresh_proposal, fresh = create(scenario.FRESH_QUERY, 'fresh-independent-report')
    assert fresh['id'] != old['id'] and fresh_proposal['id'] != old_proposal['id']
    loaded = ok(actor.get('/services/threads/' + t['id']))
    scenario.expect_card_api(loaded, old_proposal, old, available=False, raw=raw)
    scenario.expect_card_api(loaded, fresh_proposal, fresh, available=True)
    assert _read_copilot_records(store.db, actor.user['id'], old['id'], old_proposal['id']) == damaged
    assert json.loads(damaged['run']['result'])['readout']['facts'][0]['value'] == 987654321
