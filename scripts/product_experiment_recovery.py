"""Standalone native experiment recovery journey, awaiting runner integration.

Importing this module opens no browser or server. The host owns its isolated
GitHub native runner, application pins, diagnostics and unchanged 300-second
cap. All mutations use visible controls. The sole declared fault forwards one
real experiment POST once, records its committed response, then aborts only its
delivery to the browser. No fixture writes, synthetic responses or hook retries.

This journey covers three real saves and six explicit form submissions. The
20-receipt capacity and unavailable-scope manager remain separate module/API
evidence. Native orphan deletion is deliberately excluded: its deletion and
end-retry dialogs need a separately reviewed exact-choice runner contract.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import hashlib
import io
import math
import re
from pathlib import Path
from urllib.parse import urlsplit

try:
    from .product_first_use_audit import (
        canonical_hash, csv_headers, download_visible, register_empty_workspace,
        require_native_contract,
    )
    from .product_readout_oracles import observe_text_by_normal_scroll
    from .service_browser_check import FORM_COMPLETION
except ImportError:
    from product_first_use_audit import (
        canonical_hash, csv_headers, download_visible, register_empty_workspace,
        require_native_contract,
    )
    from product_readout_oracles import observe_text_by_normal_scroll
    from service_browser_check import FORM_COMPLETION

COMPANY = '实验恢复合成企业（非真实财报）'
PERIODS = tuple(f'{2022 + i // 4}-Q{i % 4 + 1}' for i in range(12))
TARGET = '2024-Q4'
FORM = '#experiment-form'
EXPERIMENT_PATH = '/api/workspace/experiments'
FORM_MS = 10_000
DISCARD_MESSAGE = '当前输入尚未保存。离开后这些修改将丢失，是否继续？'
UNKNOWN_MESSAGE = '实验保存结果尚未确认。原提交已保留；保持内容不变可再次提交，或刷新后在“待确认的实验提交”中核对原提交。不会自动重发。'
CONFIRMED_MESSAGE = '原提交已确认保存；你当前的新实验输入保持原样。'
SOURCE_READOUT = '原数据修订：1 · 目标季度：2024-Q4'
FORECAST_INPUT_READOUT = '历史输入截至：2024-Q4'
SCENARIO_NAME = '原情景：明确重试确认同一份'
FORECAST_NAME = '原成本预测：明确重试确认同一份'
RELOAD_NAME = '原情景：修订与刷新后核对'
NEW_DRAFT_NAME = '尚未提交的新草稿：不得被旧回执覆盖'
ASSUMPTIONS = '仅用合成输入核对机械计算和恢复行为，不用于真实经营决策。'
SCENARIO_FIELDS = {'price_change': '10', 'cost_change': '5',
                   'volume_change': '20', 'fixed_cost_share': '25'}
# Hand-worked fixture values, independent of production analytics imports.
# 100000 * 1.10 * 1.20 = 132000; 20000 + 60000 * 1.05 * 1.20 = 95600.
SCENARIO_EXPECTED = {
    'revenue': 132000, 'cost': 95600, 'fixed_cost': 20000,
    'variable_cost': 75600, 'gross_profit': 36400,
    'gross_margin': 36400 / 132000,
}
FORECAST_ROWS = [
    ['2025-Q1', '8', '8 — 8'],
    ['2025-Q2', '8', '无足够校准 / 多步不提供'],
]


def fixture_csv(template):
    headers = csv_headers(template)
    values = {'营业收入': '100000', '营业成本': '80000', '净利润': '5000',
              '经营现金流': '10000', '总资产': '500000', '总负债': '200000',
              '期初净资产': '300000', '期末净资产': '300000', '库存金额': '20000',
              '研发费用': '3000'}
    out = io.StringIO(newline='')
    writer = csv.writer(out, lineterminator='\n')
    writer.writerow(headers)
    for period in PERIODS:
        writer.writerow([period if key == '季度' else values.get(key, '') for key in headers])
    return out.getvalue().encode('utf-8-sig')


def expect_fixture(saved):
    data = saved['payload']
    assert saved['version'] == 1 and saved['content_hash'] == canonical_hash(data)
    assert data['company'] == COMPANY and data['currency'] == 'CNY'
    assert data['amount_unit'] == data['input_amount_unit'] == 'yuan'
    assert data['period_basis'] == 'standalone_quarter'
    assert data['source_kind'] == 'user_provided' and data['source_url'] == ''
    assert data['verification'] == 'unverified_user_input'
    assert [row['period'] for row in data['periods']] == list(PERIODS)
    for row in data['periods']:
        assert (row['revenue'], row['cost'], row['net_profit'], row['cash_flow']) == (100000, 80000, 5000, 10000)


def expect_saved(row, saved, *, name, kind):
    """Check source and independent fixture mathematics, never derive from UI."""
    p = row['payload']; request = p['request']; result = p['result']
    assert row['id'] and row['user_id'] == saved['user_id'] and row['version'] == 1
    assert row['experiment_hash'] == canonical_hash(p)
    assert row['natural_key'] == 'experiment_request:' + p['creation_request_id']
    assert p['creation_request_hash'] == canonical_hash(request)
    assert p['creation_payload_hash'] == canonical_hash({k: v for k, v in p.items() if k != 'creation_payload_hash'})
    assert p['dataset_id'] == request['dataset_id'] == saved['id']
    assert p['dataset_version'] == request['dataset_version'] == saved['version'] == 1
    assert p['dataset_hash'] == request['dataset_hash'] == saved['content_hash']
    assert p['snapshot'] == saved['payload'] and p['company'] == COMPANY
    assert p['target_period'] == request['target_period'] == TARGET
    assert request['name'] == name and request['kind'] == result['kind'] == kind
    assert request['assumptions'] == ASSUMPTIONS
    assert re.fullmatch(r'\d{4}-\d{2}-\d{2}', p['analysis_as_of'])
    if kind == 'scenario':
        for key, value in SCENARIO_FIELDS.items():
            assert math.isclose(request[key], float(value) / 100, abs_tol=1e-12)
        assert result['period'] == TARGET
        for key, value in SCENARIO_EXPECTED.items():
            assert math.isclose(result['result'][key], value, abs_tol=1e-8), key
        assert result['baseline']['revenue'] == 100000 and result['baseline']['cost'] == 80000
        assert math.isclose(result['baseline']['gross_margin'], .2, abs_tol=1e-12)
        assert math.isclose(result['delta_gross_profit'], 16400, abs_tol=1e-8)
    else:
        assert request['metric'] == result['metric'] == 'cost'
        assert request['horizon'] == result['forecast_horizon'] == 2
        assert result['selected'] == 'last' and result['train_end'] == TARGET
        assert result['excluded_periods'] == []
        assert result['history'] == [{'period': period, 'value': 80000} for period in PERIODS]
        forecast = result['forecast']
        assert [x['period'] for x in forecast] == ['2025-Q1', '2025-Q2']
        assert [x['value'] for x in forecast] == [80000, 80000]
        assert (forecast[0]['lower'], forecast[0]['upper']) == (80000, 80000)
        assert forecast[1]['lower'] is forecast[1]['upper'] is None
        assert len(result['backtests']) == 4
        for backtest in result['backtests']:
            assert backtest['mae'] == backtest['rmse'] == backtest['wape'] == 0
            assert len(backtest['folds']) == 8
            assert all(f['actual'] == f['prediction'] == 80000 for f in backtest['folds'])


def expect_exact_recovery(original, recovered):
    assert recovered == original, 'Retry must return the exact original ID, version, payload, result and timestamps.'


def expect_forecast_readout(*, title, legend_unit, rows, error_unit):
    assert title == '营业成本 · 上一季度'
    assert legend_unit == '万元', 'The actual forecast chart must expose its amount scale.'
    assert rows == FORECAST_ROWS, 'Cost is 80000 yuan / 8 wan; revenue is a different 100000-yuan series.'
    assert 'MAE / RMSE单位：万元' in error_unit


def expect_source_readout(source, *, forecast_input=None):
    assert source == SOURCE_READOUT, 'Read the archived revision and target from the human-readable source label.'
    if forecast_input is not None:
        assert forecast_input == FORECAST_INPUT_READOUT, 'Read the recorded forecast input period, never infer it from future rows.'


def complete_reading_text(actual, required):
    """Return the entire actual text, never synthesize a shorter value needle."""
    assert isinstance(actual, str) and actual.strip(), 'The complete reading range must contain actual text.'
    assert required and all(isinstance(part, str) and part for part in required)
    for part in required:
        assert part in actual, 'Required reader-facing content is absent: ' + part
    return actual.strip()


def _read_complete_group(p, locator, required, label):
    # textContent follows the same text-node ordering as the existing range
    # geometry observer. The whole observed range must fit unobscured after
    # ordinary scrolling; merely finding its first number is insufficient.
    text = complete_reading_text(locator.text_content(), required)
    observe_text_by_normal_scroll(p, locator, text, label)
    p.observations.setdefault('complete_text_groups', []).append({
        'label': label, 'text': text, 'required': list(required),
        'manual_pixel_review': 'pending',
    })
    return text


def _read_forecast_visible_groups(p, panel, rows):
    # The enclosing panel also contains SVG circle<title> tooltip metadata.
    # Read only explicit rendered groups; historical hover text is not evidence
    # for the future estimates, which must be read from the complete real table.
    _read_complete_group(p, panel.locator('.section-heading'),
        ['营业成本 · 上一季度', FORECAST_INPUT_READOUT],
        '完整阅读成本预测标题与历史输入截至季度')
    _read_complete_group(p, panel.locator('.chart-legend'),
        ['已输入实际值', '未来基线', '万元'],
        '完整阅读实测/预测图例及万元单位')
    _read_complete_group(p, panel.locator('table'),
        ['季度', '点估计', '单步经验误差带', *[cell for row in rows for cell in row]],
        '完整阅读预测表头和两行季度、点估计与误差带')


def expect_trace(posts, faults, originals, final_rows, audit_rows):
    """Reject extra POSTs, duplicate identities, changed retries and rewritten saves."""
    assert len(originals) == len(faults) == len(final_rows) == 3
    assert len(posts) == 6, 'Exactly one original and one explicit retry per experiment.'
    ids = [row['id'] for row in originals]
    assert len(set(ids)) == 3 and set(ids) == {row['id'] for row in final_rows}
    tokens = []
    for index, (fault, original) in enumerate(zip(faults, originals)):
        first, retry = posts[index * 2:index * 2 + 2]
        assert first == retry == fault['request']
        assert fault['upstream_fetches'] == 1 and fault['status'] == 201
        assert fault['response_aborted'] is True
        expect_exact_recovery(original, fault['response'])
        assert first['request_id'] == original['payload']['creation_request_id']
        tokens.append(first['request_id'])
        expect_exact_recovery(original, next(row for row in final_rows if row['id'] == original['id']))
    assert len(set(tokens)) == 3
    experiment_audit = [row for row in audit_rows if row['resource'] == 'experiment']
    assert len(experiment_audit) == 3
    assert {row['resource_id'] for row in experiment_audit} == set(ids)
    assert all(row['action'] == 'created' and row['metadata'] == {'version': 1} for row in experiment_audit)


class CommittedResponseLoss:
    """Only one real forwarded POST; never manufacture/retry a server outcome."""
    def __init__(self, p, label):
        self.p = p
        self.url = p.base_url + EXPERIMENT_PATH
        self.record = {'label': label, 'fault': 'commit_then_abort_response_delivery',
                       'upstream_fetches': 0, 'response_aborted': False}
        self.used = False
        self.handler = self._route

    def _route(self, route):
        request = route.request
        if request.url != self.url or request.method != 'POST':
            route.continue_()
            return
        # A surprising second POST is failed closed, never forwarded/retried.
        if self.used:
            route.abort('failed')
            raise AssertionError('The loss hook received more than one experiment POST.')
        self.used = True
        self.record['request'] = deepcopy(request.post_data_json)
        self.record['upstream_fetches'] += 1
        try:
            response = route.fetch(timeout=FORM_MS, max_redirects=0, max_retries=0)
            self.record['status'] = response.status
            self.record['response'] = response.json()
            assert response.status == 201, 'Only a real committed creation/recovery response may be lost.'
            assert self.record['response']['payload']['creation_request_id'] == self.record['request']['request_id']
        finally:
            # Abort the intercepted request even on an assertion/transport failure;
            # preserve that failure and never synthesize a successful response.
            route.abort('failed')
            self.record['response_aborted'] = True

    def __enter__(self):
        self.p.observations.setdefault('declared_response_losses', []).append(self.record)
        self.p.page.route(self.url, self.handler)
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.p.page.unroute(self.url, self.handler)
        if exc_type is None:
            assert self.used and self.record['upstream_fetches'] == 1
        return False


def _get(p, path, label):
    body = p.get(path)
    p.observations.setdefault('corroborating_gets', []).append({'label': label, 'method': 'GET', 'path': path, 'status': 200, 'response': deepcopy(body)})
    return body


def _form_values(p):
    form = p.visible(FORM)
    names = ['dataset_id', 'target_period', 'name', 'kind', 'assumptions']
    names += list(SCENARIO_FIELDS) if form.locator('[name="kind"]').input_value() == 'scenario' else ['metric', 'horizon']
    return {name: form.locator('[name="' + name + '"]').input_value() for name in names}


def _fill_experiment(p, name, kind):
    def action():
        p.visible(FORM + ' [name="name"]').fill(name)
        p.visible(FORM + ' [name="target_period"]').fill(TARGET)
        p.visible(FORM + ' [name="kind"]').select_option(kind)
        fields = SCENARIO_FIELDS if kind == 'scenario' else {'metric': 'cost', 'horizon': '2'}
        for key, value in fields.items():
            control = p.visible(FORM + ' [name="' + key + '"]')
            if kind == 'scenario': control.fill(value)
            else: control.select_option(value)
        p.visible(FORM + ' [name="assumptions"]').fill(ASSUMPTIONS)
    p.step('通过当前真实表单填写完整参数：' + name, action)
    return _form_values(p)


def _lose_save(p, posts, *, name, kind, saved):
    expected = _fill_experiment(p, name, kind)
    before = len(posts)
    with CommittedResponseLoss(p, name) as loss:
        def action():
            form = p.visible(FORM)
            original_handle = form.element_handle()
            form.get_by_role('button', name='计算并保存实验').click()
            errors = original_handle.evaluate(FORM_COMPLETION, FORM_MS)
            assert any(UNKNOWN_MESSAGE in message for message in errors)
            error = p.visible(FORM + ' .form-error')
            assert UNKNOWN_MESSAGE in error.inner_text() and '不会自动重发' in error.inner_text()
            assert form.get_attribute('data-submitting') == 'false'
            assert form.get_attribute('data-saved') != 'true'
            assert form.get_by_role('button', name='计算并保存实验').is_enabled()
            assert _form_values(p) == expected
        p.step('真实提交已写入，声明仅丢失该响应并核对未知结果提示', action)
    assert len(posts) == before + 1, 'Unknown response must not cause an automatic experiment POST.'
    original = loss.record['response']
    expect_saved(original, saved, name=name, kind=kind)
    expect_exact_recovery(original, _get(p, EXPERIMENT_PATH + '/' + original['id'], name + '：丢响应后GET确认真实已保存'))
    assert _form_values(p) == expected
    error = _read_complete_group(p, p.visible(FORM + ' .form-error'), [UNKNOWN_MESSAGE], '重试前完整阅读未知结果、原提交恢复方式与不会自动重发提示')
    assert len(posts) == before + 1, 'Reading the error must not trigger any experiment POST.'
    p.observations.setdefault('unknown_forms', []).append({'name': name, 'values': expected, 'post_count': len(posts), 'error': error})
    return original, expected


def _retry(p, selector, original, posts, label):
    before = len(posts)
    with p.page.expect_response(lambda response: urlsplit(response.url).path == EXPERIMENT_PATH and response.request.method == 'POST', timeout=FORM_MS) as event:
        p.submit(selector)
    response = event.value
    recovered = response.json()
    assert response.status == 201 and len(posts) == before + 1
    expect_exact_recovery(original, recovered)
    p.observations.setdefault('explicit_recoveries', []).append({'label': label, 'status': response.status, 'response': recovered, 'post_count': len(posts)})


def _read_result(p, original):
    p.page.locator('#main .page-heading').get_by_role('heading', name=original['payload']['request']['name'], exact=True).wait_for(state='visible', timeout=FORM_MS)
    assert p.visible('#main .page-heading h1').inner_text() == original['payload']['request']['name']
    assert COMPANY in p.visible('#main .page-heading').inner_text()
    source = p.visible('#main [data-experiment-source]')
    expect_source_readout(source.inner_text())
    _read_complete_group(p, source, [SOURCE_READOUT], '完整阅读原数据修订1与目标季度2024-Q4')
    if original['payload']['request']['kind'] == 'scenario':
        metrics = p.visible('#main .metric-row')
        values = [row.locator('strong').inner_text() for row in metrics.locator('article.metric').all()]
        labels = [row.locator('span').inner_text() for row in metrics.locator('article.metric').all()]
        units = [row.locator('small').inner_text() for row in metrics.locator('article.metric').all()]
        assert labels == ['假设情景收入', '假设情景毛利率', '毛利额变化']
        assert values == ['13.2', '27.58%', '1.64']
        assert units == ['万元', '基准 20%', '万元 · 机械计算，不是预测']
        _read_complete_group(p, metrics, [*labels, *values, *units], '完整阅读三张情景卡的指标、金额、百分比与单位')
        panel = p.page.locator('#main section.panel').filter(has=p.page.get_by_role('heading', name='敏感性对照', exact=True))
        assert panel.locator('dt').all_text_contents()[:2] == ['固定成本', '变动成本']
        assert panel.locator('dd').all_text_contents()[:2] == ['2 万元', '7.56 万元']
        _read_complete_group(p, panel.locator('dl'), ['固定成本', '2 万元', '变动成本', '7.56 万元'], '完整阅读固定与变动成本的标签、数值及万元单位')
        p.observations.setdefault('human_results', []).append({'kind': 'scenario', 'id': original['id'], 'labels': labels, 'values': values, 'units': units, 'fixed_variable_wan': ['2', '7.56']})
    else:
        panel = p.page.locator('#main > .panel').filter(has=p.page.get_by_role('heading', name='营业成本 · 上一季度', exact=True))
        assert panel.count() == 1
        rows = [row.locator('td').all_text_contents() for row in panel.locator('tbody tr').all()]
        error_unit = p.page.locator('#main p.micro').filter(has_text='MAE / RMSE单位').inner_text()
        expect_forecast_readout(title=panel.locator('h2').inner_text(), legend_unit=panel.locator('.chart-legend small').inner_text(), rows=rows, error_unit=error_unit)
        input_period = panel.locator('[data-experiment-input-period]')
        assert input_period.count() == 1
        expect_source_readout(source.inner_text(), forecast_input=input_period.inner_text())
        _read_forecast_visible_groups(p, panel, rows)
        p.observations.setdefault('human_results', []).append({'kind': 'forecast', 'id': original['id'], 'title': '营业成本 · 上一季度', 'input_period': input_period.inner_text(), 'unit': '万元', 'rows': rows, 'independent_expected_yuan': [80000, 80000]})


def _setup(p):
    register_empty_workspace(p)
    p.navigate('data')
    p.click('#main [data-action="import-dialog"]', after='#import-file-form')
    template = download_visible(p, p.visible('#import-file-form a[href="/api/import/template"]'), 'experiment-header-only.csv', '下载真实空白CSV模板')
    path = Path(p.directory) / 'experiment-recovery-synthetic-12-quarters.csv'
    path.write_bytes(fixture_csv(template))
    artifact = p.record_artifact(path, kind='synthetic-input')
    def fill_import():
        p.visible('#import-file-form [name="company"]').fill(COMPANY)
        p.visible('#import-file-form [name="amount_unit"]').select_option('yuan')
        p.visible('#import-file-form [name="basis"]').select_option('standalone_quarter')
        p.visible('#import-file-form [name="file"]').set_input_files(str(path))
    p.step('填写合成企业、人民币元、单季度并选择真实12季度CSV', fill_import)
    p.submit('#import-file-form', after='#modal [data-action="commit-stage"]')
    modal = p.visible('#modal')
    assert COMPANY in modal.inner_text() and '12 个已结束季度' in modal.inner_text()
    assert '文件金额单位：元' in modal.inner_text() and '尚未写入财务库' in modal.inner_text()
    first = modal.locator('[data-preview-period="2022-Q1"]')
    for key, amount in [('revenue', '100,000'), ('cost', '80,000')]:
        cells = first.locator('[data-preview-field="' + key + '"] td').all_text_contents()
        assert cells[1:] == [amount, '元']
    assert _get(p, '/api/datasets', '确认前仍为空')['items'] == []
    p.click('#modal [data-action="commit-stage"]', after='#dataset-editor[data-version="1"]', label='明确保存已核对的12季度合成输入')
    rows = _get(p, '/api/datasets', '真实导入后的数据集')['items']
    assert len(rows) == 1
    saved = rows[0]; p.dataset_id = saved['id']; expect_fixture(saved)
    revisions = _get(p, '/api/workspace/datasets/' + saved['id'] + '/revisions', '真实文件来源回执')['items']
    assert len(revisions) == 1 and revisions[0]['integrity_valid'] is True
    receipt = revisions[0]['import_receipt']
    assert receipt['integrity_valid'] is True and receipt['content_hash'] == canonical_hash(receipt['payload'])
    source = receipt['payload']['import_context']
    assert source['filename'] == path.name and source['source_file_sha256'] == artifact['sha256'] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert source['source_file_bytes'] == path.stat().st_size
    assert receipt['payload']['dataset_hash'] == saved['content_hash']
    p.navigate('settings')
    p.select('#preferences-form [name="amount_unit"]', 'wan')
    p.submit('#preferences-form')
    assert _get(p, '/api/auth/me', '明确万元显示偏好')['user']['preferences']['amount_unit'] == 'wan'
    p.observations['fixture'] = {'synthetic': True, 'company': COMPANY, 'periods': list(PERIODS), 'revenue_yuan': 100000, 'cost_yuan': 80000, 'dataset': deepcopy(saved), 'source_file': artifact, 'import_receipt': receipt, 'display_unit': 'wan'}
    return saved


def _revise_and_reload(p, saved, posts):
    count = len(posts)
    p.with_expected_dialog(dialog_type='confirm', message=DISCARD_MESSAGE,
                           action=lambda: p.navigate('data'))
    form = p.visible('#dataset-editor[data-version="1"]')
    assert form.get_attribute('data-id') == saved['id']
    row = form.locator('[data-period-row]').filter(has=p.page.locator('[name="period"][value="' + TARGET + '"]'))
    assert row.count() == 1 and row.locator('[name="cost"]').input_value() == '80000'
    p.step('在真实资料编辑器只将2024-Q4成本改为75000元', lambda: row.locator('[name="cost"]').fill('75000'))
    p.submit('#dataset-editor', after='#modal [data-action="commit-stage"]')
    p.click('#modal [data-action="commit-stage"]', after='#dataset-editor[data-version="2"]', label='明确保存当前数据修订2，原实验仍冻结修订1')
    revised = _get(p, '/api/datasets/' + saved['id'], '真实编辑产生修订2')
    assert revised['version'] == 2 and revised['content_hash'] != saved['content_hash']
    assert revised['content_hash'] == canonical_hash(revised['payload'])
    expected_periods = deepcopy(saved['payload']['periods'])
    expected_periods[-1]['cost'] = 75000
    assert revised['payload']['periods'] == expected_periods
    p.navigate('lab')
    def reload():
        response = p.page.reload(wait_until='domcontentloaded')
        assert response is not None and response.status == 200
        p.visible('#main[data-page="lab"] form[data-experiment-retry="true"]')
    # Data commit cleared the old dirty form through the production UI; native
    # reload therefore needs no beforeunload bypass or unstated dialog decision.
    p.step('原生刷新当前实验页，保留此标签页的恢复凭据', reload)
    assert len(posts) == count, 'Revision, navigation and reload must not replay an experiment.'
    return revised


def experiment_recovery_outcome(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    require_native_contract(p, repository_root=repository_root, data_dir=data_dir,
                            expected_web_tree=expected_web_tree, expected_server_tree=expected_server_tree)
    saved = _setup(p)
    posts = []; mutations = []
    def record(request):
        path = urlsplit(request.url).path
        if path.startswith('/api/') and request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            mutations.append({'method': request.method, 'path': path})
        if path == EXPERIMENT_PATH and request.method == 'POST':
            posts.append(deepcopy(request.post_data_json))
    p.page.on('request', record)
    p.observations['experiment_posts'] = posts
    p.observations['journey_mutations_after_import'] = mutations
    originals = []
    try:
        p.navigate('lab')
        for name, kind in [(SCENARIO_NAME, 'scenario'), (FORECAST_NAME, 'forecast')]:
            original, values = _lose_save(p, posts, name=name, kind=kind, saved=saved)
            originals.append(original)
            assert _form_values(p) == values
            _retry(p, FORM, original, posts, name + '：明确重交未改动表单')
            _read_result(p, original)
            p.click('#main [data-route="lab"]', after=FORM, label='通过返回实验室按钮继续')
        original, _ = _lose_save(p, posts, name=RELOAD_NAME, kind='scenario', saved=saved)
        originals.append(original)
        revised = _revise_and_reload(p, saved, posts)
        receipt = p.visible('form[data-experiment-retry="true"]')
        assert receipt.get_attribute('data-request-id') == original['payload']['creation_request_id']
        receipt_required = [RELOAD_NAME, COMPANY, '原数据 v1', TARGET, '售价 10%', '单位变动成本 5%', '销量 20%', '固定成本占比 25%', ASSUMPTIONS, saved['content_hash']]
        _read_complete_group(p, receipt, receipt_required,
            '确认前完整阅读原名称、企业、季度、修订、四项参数、假设说明与指纹')
        assert revised['content_hash'] not in receipt.inner_text()
        p.observations['reloaded_receipt'] = {'text': receipt.inner_text(), 'original_request_id': receipt.get_attribute('data-request-id'), 'current_dataset_version': 2, 'original_dataset_version': 1, 'experiment_posts_before_user_choice': len(posts)}
        _fill_experiment(p, NEW_DRAFT_NAME, 'scenario')
        p.step('明确输入区别于原提交的新售价草稿，不保存', lambda: p.visible(FORM + ' [name="price_change"]').fill('-15'))
        new_draft = _form_values(p)
        selector = 'form[data-experiment-retry="true"]'
        _retry(p, selector, original, posts, '新草稿旁明确点击“确认原提交结果”')
        confirmed = p.visible(selector)
        assert CONFIRMED_MESSAGE in confirmed.inner_text()
        assert confirmed.get_attribute('data-saved') == 'true'
        assert confirmed.locator('button[type="submit"]').count() == 0
        assert _form_values(p) == new_draft
        _read_complete_group(p, confirmed, [CONFIRMED_MESSAGE, '查看这份实验'],
            '完整阅读原提交已确认且当前新草稿保持原样的反馈')
        assert _form_values(p) == new_draft
        p.observations['new_draft_preserved'] = {'before': new_draft, 'after': _form_values(p), 'submitted': False}
        p.step('核对同一原实验已确认且新草稿逐字段保留', lambda: None)
        listing = _get(p, EXPERIMENT_PATH, '最终全账户实验清单')
        assert listing['has_more'] is False and len(listing['items']) == 3
        final_rows = [_get(p, EXPERIMENT_PATH + '/' + row['id'], '最终原实验完整记录') for row in listing['items']]
        audits = _get(p, '/api/sync?after=0&limit=500', '最终真实创建审计')
        assert audits['has_more'] is False
        expect_trace(posts, p.observations['declared_response_losses'], originals, final_rows, audits['items'])
        assert _get(p, '/api/datasets/' + saved['id'], '最终资料仍为明确保存的修订2') == revised
        assert _get(p, '/api/runs', '实验恢复未运行Agent')['items'] == []
        assert _get(p, '/api/workspace/actions', '实验恢复未生成业务行动')['items'] == []
        assert not any(row['configured'] for row in _get(p, '/api/capabilities', '最终无已配置供应商')['providers'])
        assert all(row['method'] != 'DELETE' for row in mutations)
        p.no_external()
        p.observations['experiment_recovery_outcome'] = {
            'ids': [row['id'] for row in originals], 'experiment_post_count': 6,
            'real_upstream_fault_fetches': 3, 'lost_committed_responses': 3,
            'explicit_recoveries': 3, 'saved_experiment_count': 3, 'experiment_creation_audits': 3,
            'original_dataset_version': 1, 'current_dataset_version': 2,
            'original_results_and_timestamps_unchanged': True, 'new_draft_preserved': True,
            'provider_calls': 0, 'native_capacity_20_claimed': False,
            'native_orphan_manager_claimed': False, 'calculation_call_count_instrumented': False,
            'runner_cap_seconds': 300,
        }
    finally:
        p.page.remove_listener('request', record)
