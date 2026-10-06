"""Pure fixture/oracle and route-adapter contracts; no browser/API/server run."""
from copy import deepcopy
import csv
import io
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from scripts import product_experiment_recovery as journey
from scripts.product_first_use_audit import HEADERS, HarnessContractError, canonical_hash


def saved_fixture():
    payload = {'company': journey.COMPANY, 'currency': 'CNY', 'amount_unit': 'yuan',
               'input_amount_unit': 'yuan', 'period_basis': 'standalone_quarter',
               'source_kind': 'user_provided', 'source_url': '',
               'verification': 'unverified_user_input',
               'periods': [{'period': period, 'revenue': 100000, 'cost': 80000,
                            'net_profit': 5000, 'cash_flow': 10000} for period in journey.PERIODS]}
    return {'id': 'synthetic-dataset', 'user_id': 'synthetic-owner', 'version': 1,
            'payload': payload, 'content_hash': canonical_hash(payload)}


def record(kind='scenario', name=None, identifier='synthetic-experiment'):
    data = saved_fixture()
    request = {'dataset_id': data['id'], 'dataset_version': 1, 'dataset_hash': data['content_hash'],
               'kind': kind, 'name': name or journey.SCENARIO_NAME,
               'target_period': '2024-Q4', 'assumptions': journey.ASSUMPTIONS}
    if kind == 'scenario':
        request.update(price_change=.1, cost_change=.05, volume_change=.2, fixed_cost_share=.25)
        result = {'kind': 'scenario', 'period': '2024-Q4',
                  'baseline': {'revenue': 100000, 'cost': 80000, 'gross_margin': .2},
                  'result': {'revenue': 132000, 'cost': 95600, 'fixed_cost': 20000,
                             'variable_cost': 75600, 'gross_profit': 36400,
                             'gross_margin': 36400 / 132000}, 'delta_gross_profit': 16400}
    else:
        request.update(metric='cost', horizon=2)
        result = {'kind': 'forecast', 'metric': 'cost', 'forecast_horizon': 2,
                  'selected': 'last', 'train_end': '2024-Q4', 'excluded_periods': [],
                  'history': [{'period': period, 'value': 80000} for period in journey.PERIODS],
                  'forecast': [{'period': '2025-Q1', 'value': 80000, 'lower': 80000, 'upper': 80000},
                               {'period': '2025-Q2', 'value': 80000, 'lower': None, 'upper': None}],
                  'backtests': [{'mae': 0, 'rmse': 0, 'wape': 0,
                                 'folds': [{'actual': 80000, 'prediction': 80000} for _ in range(8)]}
                                for _ in range(4)]}
    p = {'request': request, 'dataset_id': data['id'], 'dataset_version': 1,
         'dataset_hash': data['content_hash'], 'snapshot': deepcopy(data['payload']),
         'company': journey.COMPANY, 'target_period': '2024-Q4',
         'analysis_as_of': '2026-10-05', 'created_at': '2026-10-05T12:00:00+00:00',
         'result': result, 'creation_request_id': 'request-' + identifier,
         'creation_request_hash': canonical_hash(request)}
    p['creation_payload_hash'] = canonical_hash(p)
    return {'id': identifier, 'user_id': data['user_id'], 'version': 1,
            'natural_key': 'experiment_request:' + p['creation_request_id'],
            'created_at': p['created_at'], 'updated_at': p['created_at'],
            'payload': p, 'experiment_hash': canonical_hash(p)}


def reseal(row):
    """Adverse values can have internally consistent seals; math still matters."""
    p = row['payload']
    p['creation_request_hash'] = canonical_hash(p['request'])
    p['creation_payload_hash'] = canonical_hash({k: v for k, v in p.items() if k != 'creation_payload_hash'})
    row['experiment_hash'] = canonical_hash(p)


def test_csv_preserves_real_template_and_twelve_constant_cost_quarters():
    template = (','.join(HEADERS) + '\n').encode('utf-8-sig')
    reader = csv.DictReader(io.StringIO(journey.fixture_csv(template).decode('utf-8-sig')))
    rows = list(reader)
    assert reader.fieldnames == HEADERS and len(rows) == 12
    assert [row['季度'] for row in rows] == [f'{2022 + n // 4}-Q{n % 4 + 1}' for n in range(12)]
    assert all((r['营业收入'], r['营业成本'], r['净利润'], r['经营现金流']) == ('100000', '80000', '5000', '10000') for r in rows)
    assert all(r['销量'] == r['产量'] == r['制造费用'] == r['碳酸锂价格'] == r['行业波动率'] == '' for r in rows)
    journey.expect_fixture(saved_fixture())


@pytest.mark.parametrize('template', [b'period,revenue,cost\n', (','.join(HEADERS) + '\n2024-Q1,1,2\n').encode()])
def test_populated_or_wrong_template_is_rejected(template):
    with pytest.raises(AssertionError): journey.fixture_csv(template)


@pytest.mark.parametrize('kind', ['scenario', 'forecast'])
def test_valid_source_bound_independent_result(kind):
    row = record(kind=kind)
    journey.expect_saved(row, saved_fixture(), name=journey.SCENARIO_NAME, kind=kind)
    journey.expect_exact_recovery(row, deepcopy(row))


@pytest.mark.parametrize('field,value', [('revenue', 13200), ('cost', 80000), ('gross_margin', 27.58),
                                        ('fixed_cost', 24000), ('variable_cost', 72000)])
def test_scenario_oracle_rejects_wrong_math_even_when_seals_match(field, value):
    row = record(); row['payload']['result']['result'][field] = value; reseal(row)
    with pytest.raises(AssertionError):
        journey.expect_saved(row, saved_fixture(), name=journey.SCENARIO_NAME, kind='scenario')


@pytest.mark.parametrize('change', ['revenue_series', 'future_quarter', 'invented_multi_step_band', 'missing_history', 'backtest_nonzero'])
def test_cost_forecast_oracle_rejects_wrong_series_period_units_and_calibration(change):
    row = record(kind='forecast'); result = row['payload']['result']
    if change == 'revenue_series': result['forecast'][0]['value'] = 100000
    elif change == 'future_quarter': result['forecast'][0]['period'] = '2026-Q1'
    elif change == 'invented_multi_step_band': result['forecast'][1]['lower'] = 80000
    elif change == 'missing_history': result['history'].pop()
    else: result['backtests'][0]['mae'] = 1
    reseal(row)
    with pytest.raises(AssertionError):
        journey.expect_saved(row, saved_fixture(), name=journey.SCENARIO_NAME, kind='forecast')


@pytest.mark.parametrize('change', ['owner', 'dataset_version', 'source_hash', 'company', 'target', 'snapshot', 'request_key', 'result_seal'])
def test_saved_oracle_rejects_source_identity_and_integrity_changes(change):
    row = record(); p = row['payload']
    if change == 'owner': row['user_id'] = 'different-owner'
    elif change == 'dataset_version': p['dataset_version'] = 2
    elif change == 'source_hash': p['dataset_hash'] = '0' * 64
    elif change == 'company': p['company'] = 'another company'
    elif change == 'target': p['target_period'] = '2024-Q3'
    elif change == 'snapshot': p['snapshot']['periods'][-1]['cost'] = 75000
    elif change == 'request_key': p['creation_request_id'] = 'another-request'
    else: p['creation_payload_hash'] = '0' * 64
    if change != 'result_seal': reseal(row)
    with pytest.raises(AssertionError):
        journey.expect_saved(row, saved_fixture(), name=journey.SCENARIO_NAME, kind='scenario')


@pytest.mark.parametrize('change', ['id', 'version', 'created_at', 'updated_at', 'result', 'request'])
def test_exact_recovery_rejects_duplicate_or_recomputed_outcome(change):
    original = record(); recovered = deepcopy(original)
    if change in ['id', 'created_at', 'updated_at']: recovered[change] = 'different'
    elif change == 'version': recovered['version'] = 2
    elif change == 'result': recovered['payload']['result']['result']['cost'] = 75000
    else: recovered['payload']['request']['name'] = 'changed'
    with pytest.raises(AssertionError): journey.expect_exact_recovery(original, recovered)


def readout():
    return {'title': '营业成本 · 上一季度', 'legend_unit': '万元',
            'rows': [['2025-Q1', '8', '8 — 8'], ['2025-Q2', '8', '无足够校准 / 多步不提供']],
            'error_unit': 'MAE / RMSE单位：万元；WAPE 在实际值绝对和为 0 时留空。'}


def test_human_cost_readout_with_explicit_units():
    journey.expect_forecast_readout(**readout())


@pytest.mark.parametrize('change', ['wrong_metric', 'no_unit', 'yuan_unit', 'revenue_value', 'raw_yuan_value', 'missing_band_note', 'wrong_error_unit'])
def test_human_readout_rejects_plausible_but_wrong_cost_values_and_units(change):
    values = readout()
    if change == 'wrong_metric': values['title'] = '营业收入 · 上一季度'
    elif change == 'no_unit': values['legend_unit'] = ''
    elif change == 'yuan_unit': values['legend_unit'] = '元'
    elif change == 'revenue_value': values['rows'][0][1] = '10'
    elif change == 'raw_yuan_value': values['rows'][0][1] = '80,000'
    elif change == 'missing_band_note': values['rows'][1][2] = '8 — 8'
    else: values['error_unit'] = 'MAE / RMSE单位：百分点'
    with pytest.raises(AssertionError): journey.expect_forecast_readout(**values)


def trace():
    originals = [record(identifier='saved-' + str(i)) for i in range(3)]
    faults = [{'request': {**deepcopy(row['payload']['request']), 'request_id': row['payload']['creation_request_id']},
               'upstream_fetches': 1, 'status': 201, 'response_aborted': True, 'response': deepcopy(row)} for row in originals]
    posts = [deepcopy(fault['request']) for fault in faults for _ in range(2)]
    audits = [{'resource': 'experiment', 'resource_id': row['id'], 'action': 'created', 'metadata': {'version': 1}} for row in originals]
    audits.append({'resource': 'datasets', 'resource_id': 'synthetic-dataset', 'action': 'import_committed', 'metadata': {'revision': 2}})
    return {'posts': posts, 'faults': faults, 'originals': originals, 'final_rows': deepcopy(originals), 'audit_rows': audits}


def test_exact_six_post_three_save_trace_allows_unrelated_dataset_revision_audit():
    journey.expect_trace(**trace())


@pytest.mark.parametrize('change', ['extra_post', 'missing_post', 'changed_retry', 'new_retry_token', 'extra_upstream',
                                  'noncommitted_status', 'unaborted_response', 'extra_record', 'rewritten_original',
                                  'missing_audit', 'extra_audit', 'updated_audit'])
def test_trace_rejects_unintended_replays_and_duplicate_or_rewritten_business_state(change):
    values = trace()
    if change == 'extra_post': values['posts'].append(deepcopy(values['posts'][0]))
    elif change == 'missing_post': values['posts'].pop()
    elif change == 'changed_retry': values['posts'][1]['name'] = 'changed'
    elif change == 'new_retry_token': values['posts'][1]['request_id'] = 'different'
    elif change == 'extra_upstream': values['faults'][0]['upstream_fetches'] = 2
    elif change == 'noncommitted_status': values['faults'][0]['status'] = 409
    elif change == 'unaborted_response': values['faults'][0]['response_aborted'] = False
    elif change == 'extra_record': values['final_rows'].append(record(identifier='duplicate'))
    elif change == 'rewritten_original': values['final_rows'][0]['version'] = 2
    elif change == 'missing_audit': values['audit_rows'].pop(0)
    elif change == 'extra_audit': values['audit_rows'].append(deepcopy(values['audit_rows'][0]))
    else: values['audit_rows'][0]['action'] = 'updated'
    with pytest.raises(AssertionError): journey.expect_trace(**values)


def fake_hook():
    row = record()
    request = {**row['payload']['request'], 'request_id': row['payload']['creation_request_id']}
    p = SimpleNamespace(base_url='http://127.0.0.1:8000', observations={}, page=SimpleNamespace(route=Mock(), unroute=Mock()))
    response = SimpleNamespace(status=201, json=Mock(return_value=row))
    route = SimpleNamespace(request=SimpleNamespace(url=p.base_url + journey.EXPERIMENT_PATH, method='POST', post_data_json=request),
                            fetch=Mock(return_value=response), abort=Mock(), continue_=Mock())
    return p, route, row


def test_loss_adapter_forwards_once_records_real_response_and_aborts_without_retry():
    p, route, row = fake_hook()
    with journey.CommittedResponseLoss(p, 'explicit synthetic loss') as hook:
        hook._route(route)
    route.fetch.assert_called_once_with(timeout=10000, max_redirects=0, max_retries=0)
    route.abort.assert_called_once_with('failed'); route.continue_.assert_not_called()
    assert hook.record['response'] == row and hook.record['response_aborted'] is True
    p.page.route.assert_called_once_with(hook.url, hook.handler)
    p.page.unroute.assert_called_once_with(hook.url, hook.handler)


def test_loss_adapter_never_forwards_an_unexpected_second_post():
    p, route, _ = fake_hook()
    with journey.CommittedResponseLoss(p, 'loss') as hook:
        hook._route(route)
        with pytest.raises(AssertionError, match='more than one'): hook._route(route)
    assert route.fetch.call_count == 1 and route.abort.call_count == 2


@pytest.mark.parametrize('failure', ['fetch', 'json', 'status'])
def test_loss_adapter_failure_aborts_and_propagates_without_fallback(failure):
    p, route, _ = fake_hook()
    if failure == 'fetch': route.fetch.side_effect = RuntimeError('upstream failed')
    elif failure == 'json': route.fetch.return_value.json.side_effect = RuntimeError('not JSON')
    else: route.fetch.return_value.status = 500
    with pytest.raises((RuntimeError, AssertionError)):
        with journey.CommittedResponseLoss(p, 'loss') as hook: hook._route(route)
    assert route.fetch.call_count == route.abort.call_count == p.page.unroute.call_count == 1


@pytest.mark.parametrize('method,url', [('GET', 'http://127.0.0.1:8000/api/workspace/experiments'),
                                     ('POST', 'http://127.0.0.1:8000/api/workspace/other')])
def test_loss_adapter_never_fetches_or_aborts_an_unrelated_request(method, url):
    p, route, _ = fake_hook(); route.request.method = method; route.request.url = url
    hook = journey.CommittedResponseLoss(p, 'loss'); hook._route(route)
    route.continue_.assert_called_once_with(); route.fetch.assert_not_called(); route.abort.assert_not_called()


def test_missing_declared_post_fails_and_removes_hook():
    p, _, _ = fake_hook()
    with pytest.raises(AssertionError):
        with journey.CommittedResponseLoss(p, 'unused loss'): pass
    p.page.unroute.assert_called_once()


def test_native_entry_is_denied_locally_before_any_browser_action(tmp_path, monkeypatch):
    monkeypatch.delenv('GITHUB_ACTIONS', raising=False)
    with pytest.raises(HarnessContractError, match='Local browser execution is restricted'):
        journey.experiment_recovery_outcome(SimpleNamespace(), repository_root=tmp_path, data_dir=tmp_path,
                                            expected_web_tree='a' * 40, expected_server_tree='b' * 40)


def test_human_source_labels_bind_original_revision_target_and_input_end():
    journey.expect_source_readout('原数据修订：1 · 目标季度：2024-Q4')
    journey.expect_source_readout('原数据修订：1 · 目标季度：2024-Q4', forecast_input='历史输入截至：2024-Q4')


@pytest.mark.parametrize('source', ['', '原数据修订：2 · 目标季度：2024-Q4',
                                  '原数据修订：1 · 目标季度：2025-Q1',
                                  '原数据修订：1 · 目标季度：未记录',
                                  '原数据修订：1', '{"dataset_version":1,"target_period":"2024-Q4"}'])
def test_source_reader_rejects_current_revision_future_period_missing_or_technical_fallback(source):
    with pytest.raises(AssertionError): journey.expect_source_readout(source)


@pytest.mark.parametrize('input_period', ['', '历史输入截至：2025-Q1', '历史输入截至：未记录', '2024-Q4'])
def test_forecast_reader_requires_explicit_recorded_history_end(input_period):
    with pytest.raises(AssertionError):
        journey.expect_source_readout('原数据修订：1 · 目标季度：2024-Q4', forecast_input=input_period)


READING_GROUPS = [
    ('假设情景收入13.2万元假设情景毛利率27.58%基准 20%毛利额变化1.64万元 · 机械计算，不是预测',
     ['假设情景收入', '13.2', '万元', '假设情景毛利率', '27.58%', '基准 20%', '毛利额变化', '1.64', '万元 · 机械计算，不是预测']),
    ('固定成本2 万元变动成本7.56 万元盈亏平衡销量倍数0.43 × 基准销量',
     ['固定成本', '2 万元', '变动成本', '7.56 万元']),
    ('营业成本 · 上一季度实测历史与未来基线分开标记，没有风险概率。历史输入截至：2024-Q4统计基线',
     ['营业成本 · 上一季度', '历史输入截至：2024-Q4']),
    ('已输入实际值未来基线万元', ['已输入实际值', '未来基线', '万元']),
    ('季度点估计单步经验误差带2025-Q188 — 82025-Q28无足够校准 / 多步不提供',
     ['季度', '点估计', '单步经验误差带', '2025-Q1', '8 — 8', '2025-Q2', '无足够校准 / 多步不提供']),
    (journey.UNKNOWN_MESSAGE + '\n连接失败。当前输入仍然保留，请核对网络后再试。', [journey.UNKNOWN_MESSAGE]),
    (journey.CONFIRMED_MESSAGE + '查看这份实验', [journey.CONFIRMED_MESSAGE, '查看这份实验']),
]


@pytest.mark.parametrize('actual,required', READING_GROUPS)
def test_complete_reader_gives_geometry_the_entire_actual_group_not_a_value_needle(monkeypatch, actual, required):
    observed = []
    p = SimpleNamespace(observations={})
    locator = SimpleNamespace(text_content=lambda: actual)
    monkeypatch.setattr(journey, 'observe_text_by_normal_scroll',
                        lambda probe, target, text, label: observed.append((probe, target, text, label)))
    returned = journey._read_complete_group(p, locator, required, 'complete group')
    assert returned == actual and observed == [(p, locator, actual, 'complete group')]
    assert p.observations['complete_text_groups'][0]['text'] == actual
    assert p.observations['complete_text_groups'][0]['required'] == required


def receipt_parts():
    return [journey.RELOAD_NAME, journey.COMPANY, '原数据 v1', '2024-Q4',
            '售价 10%', '单位变动成本 5%', '销量 20%', '固定成本占比 25%',
            journey.ASSUMPTIONS, 'a' * 64]


def test_complete_frozen_receipt_includes_every_scope_and_assumption_before_confirmation():
    parts = receipt_parts()
    actual = '\n'.join(parts) + '\n查看已经保存的实验\n确认原提交结果\n结束这次重试'
    assert journey.complete_reading_text(actual, parts) == actual


@pytest.mark.parametrize('missing', range(10))
def test_partial_receipt_name_company_quarter_revision_parameter_note_or_hash_is_rejected(missing):
    parts = receipt_parts()
    actual = '\n'.join(part for index, part in enumerate(parts) if index != missing)
    with pytest.raises(AssertionError): journey.complete_reading_text(actual, parts)


@pytest.mark.parametrize('actual', ['', None, '13.2', '2025-Q1', '实验保存结果尚未确认。原提交已保留；保持内容不变可再次提交'])
def test_partial_unknown_message_and_isolated_scalar_cannot_pass_full_feedback_read(actual):
    with pytest.raises(AssertionError): journey.complete_reading_text(actual, [journey.UNKNOWN_MESSAGE])


def test_forecast_reading_excludes_svg_tooltips_and_covers_complete_visible_groups(monkeypatch):
    texts = {
        '.section-heading': '营业成本 · 上一季度实测历史与未来基线分开标记，没有风险概率。历史输入截至：2024-Q4统计基线',
        '.chart-legend': '已输入实际值未来基线万元',
        'table': '季度点估计单步经验误差带2025-Q188 — 82025-Q28无足够校准 / 多步不提供',
    }
    requested = []; observed = []
    class Panel:
        def locator(self, selector):
            requested.append(selector)
            assert selector in texts, 'Only explicit visible groups belong in this read.'
            return SimpleNamespace(text_content=lambda: texts[selector])
        def text_content(self):
            pytest.fail('The full panel includes hidden SVG circle/title metadata.')
    p = SimpleNamespace(observations={})
    monkeypatch.setattr(journey, 'observe_text_by_normal_scroll',
                        lambda probe, target, text, label: observed.append(text))
    journey._read_forecast_visible_groups(p, Panel(), readout()['rows'])
    assert requested == ['.section-heading', '.chart-legend', 'table']
    assert observed == list(texts.values())
    assert [group['text'] for group in p.observations['complete_text_groups']] == observed
    table_required = p.observations['complete_text_groups'][-1]['required']
    assert table_required == ['季度', '点估计', '单步经验误差带',
                              '2025-Q1', '8', '8 — 8', '2025-Q2', '8', '无足够校准 / 多步不提供']
