"""Authentic R1 messages retain history but cannot recalculate unsupported accounts."""
import json
from pathlib import Path
from urllib.parse import urlencode

import pytest

from server.historical_question_scope import question_warning
from test_services import ok

FIXTURE=json.loads((Path(__file__).parent/'fixtures/legacy-account-messages-r1.json').read_text())


@pytest.fixture
def captured_account_actor(actor):
    store=actor.client.app.state.store
    with store.transaction() as db:
        for table,rows in FIXTURE['tables'].items():
            for original in rows:
                row={**original,'user_id':actor.user['id']};columns=list(row)
                db.execute('INSERT INTO '+table+'('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',[row[k] for k in columns])
    return actor


def stored(store):
    return {table:[tuple(row) for row in store.db.execute('SELECT * FROM '+table+' ORDER BY rowid')]
            for table in FIXTURE['tables']}


@pytest.mark.parametrize('query',['经营利润是多少','净负债率','净现金流','营业外收入','融资成本','年化净资产收益率'])
def test_original_supported_account_messages_warn_and_refuse_new_trace_without_rewriting(captured_account_actor,monkeypatch,query):
    actor=captured_account_actor;store=actor.client.app.state.store
    case=next(c for c in FIXTURE['cases'] if c['query']==query)
    before=stored(store);changes=store.db.total_changes
    saved=store.one('SELECT * FROM copilot_messages WHERE id=?',(case['message_id'],))
    assert saved['payload']['response']['context']['question_scope']['status']=='supported'
    loaded=ok(actor.get('/services/threads/'+case['thread_id']))
    viewed=next(m for m in loaded['messages'] if m['id']==case['message_id'])
    assert viewed['payload']==saved['payload']
    assert viewed['question_compatibility']['status']=='unsupported_operation'
    assert viewed['question_compatibility']['question']==saved['payload']['question']
    monkeypatch.setattr('server.copilot.assistant_answer',lambda *a,**k:pytest.fail('Unsupported old question must not recalculate'))
    url='/services/threads/'+case['thread_id']+'/messages/'+case['message_id']+'/trace?'+urlencode({'identity_id':'','dataset_id':case['dataset_id']})
    result=ok(actor.get(url),409)['error']
    assert result['code']=='TRACE_QUESTION_UNSUPPORTED' and '原记录未改写' in result['message']
    assert stored(store)==before and store.db.total_changes==changes


@pytest.mark.parametrize('query',['营业收入','经营净现金流','未年化净资产收益率'])
def test_authentic_supported_question_trace_remains_available(captured_account_actor,query):
    actor=captured_account_actor;store=actor.client.app.state.store
    case=next(c for c in FIXTURE['cases'] if c['query']==query)
    before=stored(store);changes=store.db.total_changes
    loaded=ok(actor.get('/services/threads/'+case['thread_id']))
    assert 'question_compatibility' not in next(m for m in loaded['messages'] if m['id']==case['message_id'])
    url='/services/threads/'+case['thread_id']+'/messages/'+case['message_id']+'/trace?'+urlencode({'identity_id':'','dataset_id':case['dataset_id']})
    result=ok(actor.get(url));assert result['facts'] and result['external_calls']==0
    assert stored(store)==before and store.db.total_changes==changes


@pytest.mark.parametrize('question',[
    '营业收入','净利润','经营净现金流','经营性现金流量净额','net operating cash flow',
    '未年化净资产收益率','非年化资产周转率','不要净现金流，只看经营现金流','without net cash flow, revenue only'])
def test_supported_or_negated_wording_is_not_relabelled_by_new_warning(question):
    assert question_warning('2025-Q4 '+question) is None


@pytest.mark.parametrize('question',['营业收入和营业外收入','经营净现金流与净现金流','未年化净资产收益率与年化资产周转率'])
def test_mixed_unsupported_occurrence_is_not_hidden_by_supported_wording(question):
    assert question_warning('2025-Q4 '+question)['status']=='unsupported_operation'
