"""Raw review corruption stays local to its saved owner/report/claim binding."""
import pytest

from conftest import Actor
from test_business_provenance import action, ok
from test_claim_review_read_model import corrupt, saved_review, setup_review
from test_provenance_eligibility import claim_chain
from test_services import message, thread
from test_workspace_api import execute, plan


def raw_rows(store):
    return {table: [tuple(row) for row in store.db.execute('SELECT * FROM '+table+' ORDER BY rowid')]
            for table in ('runs', 'workspace_objects', 'agent_artifacts', 'run_events', 'event_integrity')}


def test_healthy_export_review_rows_retain_the_saved_field_order_and_content(factory):
    from server.business_provenance import report_reviews_for_export
    actor, dataset, report, review = setup_review(factory)
    rows, unavailable = report_reviews_for_export(actor.client.app.state.store, actor.user['id'], report['id'])
    assert rows == [review] and unavailable == []
    assert list(rows[0]) == list(review)
    context = ok(actor.get('/runs/'+report['id']+'/export?format=json'))['export_context']
    assert context['human_reviews_at_export'] == [review] and 'unavailable_human_reviews_at_export' not in context


@pytest.mark.parametrize('bad', ['{unclosed-json', '', '{"run_id":'])
def test_malformed_review_cannot_break_other_report_lists_audits_or_exports(factory, bad):
    actor, dataset, report, review = setup_review(factory); store = actor.client.app.state.store
    neighbor = execute(actor, plan(actor, dataset)); foreign = Actor(actor.client)
    foreign_report = execute(foreign, plan(foreign, foreign.dataset()))
    healthy_audit = ok(actor.get('/workspace/runs/'+neighbor['id']+'/audit'))
    healthy_export = actor.get('/runs/'+neighbor['id']+'/export?format=json').content
    corrupt(actor, review, bad, raw=True)
    frozen = raw_rows(store); changes = store.db.total_changes
    reports = ok(actor.get('/workspace/reports'))['items']
    affected = next(row for row in reports if row['id'] == report['id'])
    unaffected = next(row for row in reports if row['id'] == neighbor['id'])
    assert affected['source_impact']['state'] == 'unavailable'
    assert affected['source_impact']['human_review_count'] == 1
    assert 'claim_review_unavailable' in {r['code'] for r in affected['source_impact']['reasons']}
    assert unaffected['source_impact']['state'] == 'current'
    assert ok(actor.get('/workspace/runs/'+neighbor['id']+'/audit')) == healthy_audit
    assert actor.get('/runs/'+neighbor['id']+'/export?format=json').content == healthy_export
    for row in (report, neighbor):
        audit = ok(actor.get('/workspace/runs/'+row['id']+'/audit'))
        assert audit['report_integrity']['valid'] and audit['ledger']['valid']
        assert ok(actor.get('/runs/'+row['id'])) == row
        for format in ('json', 'md'):
            export = actor.get('/runs/'+row['id']+'/export?format='+format)
            assert export.status_code == 200 and (not bad or bad not in export.text)
            if format == 'json' and row['id'] == report['id']:
                context = export.json()['export_context']
                assert context['human_reviews_at_export'] == []
                assert context['unavailable_human_reviews_at_export'][0]['id'] == review['id']
    reviews = ok(actor.get('/workspace/runs/'+report['id']+'/reviews'))
    assert reviews['items'] == [] and reviews['unavailable'][0]['id'] == review['id']
    assert ok(foreign.get('/workspace/reports'))['items'][0]['source_impact']['state'] == 'current'
    assert ok(foreign.get('/workspace/runs/'+foreign_report['id']+'/audit'))['source_impact']['state'] == 'current'
    assert foreign.get('/workspace/runs/'+report['id']+'/audit').status_code == 404
    assert store.db.total_changes == changes and raw_rows(store) == frozen


@pytest.mark.parametrize('key', ['missing-report:missing-claim', 'unbound', ''])
def test_unattributable_broken_orphan_does_not_taint_an_existing_report(factory, key):
    actor, dataset, report, review = setup_review(factory); store = actor.client.app.state.store
    corrupt(actor, review, '{orphan', raw=True)
    with store.transaction() as db:
        db.execute('UPDATE workspace_objects SET natural_key=? WHERE id=?', (key, review['id']))
    frozen = raw_rows(store); changes = store.db.total_changes
    impact = ok(actor.get('/workspace/runs/'+report['id']+'/audit'))['source_impact']
    assert impact['state'] == 'current' and impact['human_review_count'] == 0
    assert ok(actor.get('/workspace/runs/'+report['id']+'/reviews')) == {'items': []}
    context = ok(actor.get('/runs/'+report['id']+'/export?format=json'))['export_context']
    assert context['human_reviews_at_export'] == [] and 'unavailable_human_reviews_at_export' not in context
    assert store.db.total_changes == changes and raw_rows(store) == frozen


def test_selected_unreadable_review_blocks_new_sources_and_keeps_old_actions_watches_readable(factory):
    actor, dataset, report, review, saved, watch = claim_chain(factory)
    store = actor.client.app.state.store
    other_claim = report['result']['llm']['review']['claims'][1]['id']
    healthy = saved_review(actor, report, claim_id=other_claim)
    corrupt(actor, review, '{unreadable-review', raw=True)
    # This endpoint also evaluates rules; complete its one-time receipt first.
    ok(actor.get('/services/tracking'))
    frozen = raw_rows(store); changes = store.db.total_changes
    old = next(row for row in ok(actor.get('/workspace/actions'))['items'] if row['id'] == saved['id'])
    assert old['payload'] == saved['payload'] and old['source_impact']['state'] == 'unavailable'
    old_watch = next(row for row in ok(actor.get('/services/tracking'))['rules'] if row['id'] == watch['id'])
    assert old_watch['payload'] == watch['payload'] and old_watch['source_impact']['state'] == 'unavailable'
    src = {'kind': 'report', 'run_id': report['id'], 'claim_id': review['payload']['claim_id']}
    for historical in (False, True):
        rejected = action(actor, dataset, source_ref={**src, 'allow_historical': historical})
        assert ok(rejected, 409)['error']['code'] == 'SOURCE_INTEGRITY'
    missing = action(actor, dataset, source_ref={**src, 'claim_id': 'no-such-claim'})
    assert ok(missing, 404)['error']['code'] == 'NOT_FOUND'
    assert store.db.total_changes == changes and raw_rows(store) == frozen
    # An independently selected healthy claim remains a usable source.
    independent = ok(action(actor, dataset, source_ref={**src, 'claim_id': other_claim}), 201)
    assert independent['source_impact']['state'] == 'current'
    assert independent['payload']['provenance']['claim_review_hash']
    assert ok(actor.get('/workspace/runs/'+report['id']+'/reviews'))['items'] == [healthy]
    # Both assistant entrypoints also inspect report history through provenance.
    assert actor.post('/workspace/assistant', json={'dataset_id': dataset['id'], 'query': '查看报告'}).status_code == 200
    response = ok(message(actor, thread(actor, dataset), text='查看报告'), 201)['message']['payload']['response']
    assert response['external_calls'] == 0
    assert store.db.execute('SELECT payload FROM workspace_objects WHERE id=?', (review['id'],)).fetchone()[0] == '{unreadable-review'
