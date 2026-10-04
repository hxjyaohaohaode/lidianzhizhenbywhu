"""Independent native user-outcome probes; no production or provider calls.

Run only on the authorized GitHub runner against native_acceptance.py's
already-running temporary Uvicorn server on 127.0.0.1:8000. This module never
starts a second server. Alternatively import run_contract_audit and pass the
native flow's temporary DATA_DIR. No bridge, DOM substitution, hash navigation,
page-state injection, application patch, security-header change, or API mutation
is used. Baseline failures are findings and produce a nonzero aggregate exit.

"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import traceback
from datetime import datetime, timezone
from urllib.parse import urlsplit
import uuid

FIXTURE_COMPANY = '独立合同验收合成企业（非真实财报）'
FIXTURE_REVENUE = 100_000
FIXTURE_COST = 80_000
FIXTURE_REVISED_COST = 75_000
FIXTURE_QUARTERS = [f'{2022 + i // 4}-Q{i % 4 + 1}' for i in range(12)]
FORM_TIMEOUT_MS = 10_000
RUN_TIMEOUT_MS = 30_000
SCENARIOS = (
    ('F1-trace-handoff', '历史季度追踪→真实下一步按钮保留问题与企业'),
    ('F2-forecast-units', '预测卡明确毛利率百分数及收入金额单位'),
    ('F3-report-points', '同季度报告毛利率差值明确为百分点'),
)


def now():
    return datetime.now(timezone.utc).isoformat()


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git_identity(root):
    def call(*args):
        return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()
    protected = {}
    for name in ('web', 'server'):
        protected[name] = call('rev-parse', 'HEAD:' + name)
    return {
        'head': call('rev-parse', 'HEAD'),
        'tree': call('rev-parse', 'HEAD^{tree}'),
        'protected_tree_ids': protected,
        'working_tree_status': call('status', '--porcelain=v1'),
        'protected_diff': call('diff', 'HEAD', '--name-only', '--', 'web', 'server'),
        'protected_untracked': call('ls-files', '--others', '--exclude-standard', '--', 'web', 'server'),
        'protected_file_sha256': {name: digest(root / name) for name in call('ls-files', '--', 'web', 'server').splitlines()},
    }


def require_isolated_runner(base_url, data_dir):
    """Do not provide an override for the local browser restriction."""
    if os.getenv('GITHUB_ACTIONS') != 'true':
        raise RuntimeError('Native probes are authorized on the GitHub runner only; not run locally.')
    origin = urlsplit(base_url)
    if base_url.rstrip('/') != 'http://127.0.0.1:8000' or origin.path not in ('', '/'):
        raise ValueError('Only the isolated loopback Uvicorn origin is allowed.')
    if os.getenv('APP_ORIGIN') != base_url.rstrip('/'):
        raise ValueError('APP_ORIGIN must match the native acceptance loopback origin.')
    data_dir = Path(data_dir).resolve()
    temp_root = Path(tempfile.gettempdir()).resolve()
    if not data_dir.is_dir() or temp_root not in data_dir.parents:
        raise ValueError('DATA_DIR must be an existing system temporary directory.')
    if not data_dir.name.startswith('lidian-native-'):
        raise ValueError('DATA_DIR must belong to the independently created/native acceptance fixture.')
    if any(k.endswith('_API_KEY') and v for k, v in os.environ.items()):
        raise ValueError('Provider API keys must be removed from the runner probe process environment.')


def number_text(value):
    """Read one displayed scalar; never implement or borrow financial formulas."""
    found = re.search(r'[-+]?\d[\d,]*(?:\.\d+)?', value)
    return None if found is None else float(found.group().replace(',', ''))


def percentage_display(value, header, expected_ratio):
    shown = number_text(value)
    unit_explicit = '%' in value or '％' in value or '%' in header or '百分比' in header
    return shown is not None and unit_explicit and math.isclose(shown, expected_ratio * 100, abs_tol=0.01)


def points_display(value, header, expected_delta):
    shown = number_text(value)
    unit_explicit = '百分点' in value or '百分点' in header
    return shown is not None and unit_explicit and math.isclose(shown, expected_delta * 100, abs_tol=0.01)


class Probe:
    """All changes go through visible controls; HTTP GETs corroborate results."""
    def __init__(self, page, base_url, directory, submit_form, journal=None):
        self.page = page
        self.base_url = base_url.rstrip('/')
        self.directory = directory
        self.submit_form = submit_form
        self.journal = journal
        self.steps = []
        self.screenshots = []
        self.observations = {}
        self.dataset_id = ''
        self.step_no = 0

    def screenshot(self, suffix):
        name = f'{self.step_no:03d}-{suffix}.png'
        path = self.directory / name
        # Capture the actual viewport before a full-page screenshot can resize
        # or temporarily move the viewport. Both originals remain in evidence.
        self.page.screenshot(path=str(path), full_page=False, timeout=FORM_TIMEOUT_MS)
        self.screenshots.append({'file': name, 'sha256': digest(path), 'kind': 'viewport'})
        full_name = f'{self.step_no:03d}-{suffix}-full.png'
        full_path = self.directory / full_name
        self.page.screenshot(path=str(full_path), full_page=True, timeout=FORM_TIMEOUT_MS)
        self.screenshots.append({'file': full_name, 'sha256': digest(full_path), 'kind': 'full-page'})
        return name

    def step(self, label, action):
        self.step_no += 1
        entry = {'number': self.step_no, 'label': label, 'started_at': now(), 'status': 'running'}
        self.steps.append(entry)
        if self.journal:
            self.journal.emit('probe_step_started', step=self.step_no)
        entry['before'] = self.screenshot('before')
        dump(self.directory / 'steps.json', self.steps)
        try:
            value = action()
            entry['after'] = self.screenshot('after')
            entry['status'] = 'completed'
            return value
        except Exception as exc:
            entry['status'] = 'failed'
            entry['error'] = {'type': type(exc).__name__, 'message': str(exc)}
            try:
                entry['after_failure'] = self.screenshot('after-failure')
            except Exception as screenshot_error:
                entry['evidence_error'] = str(screenshot_error)
            raise
        finally:
            entry['finished_at'] = now()
            if self.journal:
                self.journal.emit('probe_step_finished', step=self.step_no, status=entry['status'])
            dump(self.directory / 'steps.json', self.steps)

    def get(self, path):
        if not path.startswith('/api/') or '://' in path or '..' in path:
            raise ValueError('Corroborating reads must be same-origin API GETs.')
        response = self.page.context.request.get(self.base_url + path, timeout=RUN_TIMEOUT_MS)
        if response.status != 200:
            raise AssertionError(f'Corroborating GET {path}: HTTP {response.status}')
        return response.json()

    def visible(self, selector):
        target = self.page.locator(selector)
        target.wait_for(state='visible', timeout=FORM_TIMEOUT_MS)
        if target.count() != 1:
            raise AssertionError(f'Expected exactly one current DOM control: {selector}; got {target.count()}')
        return target

    def fill(self, selector, value, label=None):
        self.step(label or f'填写 {selector}', lambda: self.visible(selector).fill(str(value)))

    def select(self, selector, value, label=None):
        self.step(label or f'选择 {selector}', lambda: self.visible(selector).select_option(str(value)))

    def click(self, selector, *, after=None, label=None):
        def action():
            self.visible(selector).click()
            if after:
                self.page.locator(after).wait_for(state='visible', timeout=RUN_TIMEOUT_MS)
        self.step(label or f'点击 {selector}', action)

    def submit(self, selector, *, after=None):
        def action():
            self.visible(selector)
            self.submit_form(self.page, selector)
            if after:
                self.page.locator(after).wait_for(state='visible', timeout=RUN_TIMEOUT_MS)
        self.step('提交当前可见表单 ' + selector, action)

    def navigate(self, route):
        """No location/hash mutation: reproduce the actual user's sidebar entry."""
        def action():
            button = self.visible(f'#sidebar button[data-route="{route}"]')
            button.click()
            main = self.page.locator(f'#main[data-page="{route}"]')
            main.wait_for(state='visible', timeout=RUN_TIMEOUT_MS)
            if main.locator('h1').first.inner_text() == '读取未完成':
                raise AssertionError(main.inner_text())
        self.step('真实侧栏进入 ' + route, action)

    def bootstrap(self):
        def landing():
            response = self.page.goto(self.base_url, wait_until='domcontentloaded')
            assert response is not None and response.status == 200
            csp = response.headers.get('content-security-policy', '')
            assert "script-src 'self'" in csp and "'unsafe-eval'" not in csp, csp
            self.observations['landing_csp'] = csp
            self.page.locator('#auth-form').wait_for()
        self.step('原生浏览器访问隔离空服务并读取实际CSP', landing)
        if self.page.locator('[data-intro-skip]').is_visible():
            self.click('[data-intro-skip]', label='通过原开场的进入按钮跳过动画')
        self.click('[data-action="auth-toggle"]', after='#auth-form [name="name"]', label='切换到注册工作区')
        self.fill('#auth-form [name="email"]', 'independent-' + uuid.uuid4().hex + '@test.example')
        self.fill('#auth-form [name="password"]', 'Synthetic-only-audit-password-2026', '填写隔离合成账号密码')
        self.fill('#auth-form [name="name"]', '独立用户结果验收（合成）')
        self.submit('#auth-form', after='#main[data-page="brief"]')
        assert self.get('/api/datasets')['items'] == [], 'Fresh fixture account must contain no datasets.'
        providers = self.get('/api/capabilities')['providers']
        assert not any(p.get('configured') for p in providers), 'Providers must remain unconfigured.'
        self.observations['fixture'] = {
            'synthetic': True, 'company': FIXTURE_COMPANY, 'quarter_count': 12,
            'quarters': FIXTURE_QUARTERS, 'revenue_yuan': FIXTURE_REVENUE,
            'cost_yuan': FIXTURE_COST, 'cash_flow_yuan': 10_000,
            'net_profit_yuan': 5_000, 'amount_unit_import': 'yuan',
            'independent_expected_gross_margin': (FIXTURE_REVENUE - FIXTURE_COST) / FIXTURE_REVENUE,
            'no_provider_configured': True,
        }
        self.navigate('data')
        self.click('#main [data-action="import-dialog"]', after='#import-file-form')
        self.fill('#import-file-form [name="company"]', FIXTURE_COMPANY)
        self.select('#import-file-form [name="amount_unit"]', 'yuan')
        self.select('#import-file-form [name="basis"]', 'standalone_quarter')
        csv = '季度,营业收入,营业成本,经营现金流,净利润,总资产,总负债,期末净资产,期初净资产,库存金额,研发费用\n'
        csv += ''.join(f'{q},{FIXTURE_REVENUE},{FIXTURE_COST},10000,5000,500000,200000,300000,300000,20000,3000\n' for q in FIXTURE_QUARTERS)
        fixture = self.directory / 'synthetic-financial-input.csv'
        fixture.write_bytes(csv.encode('utf-8-sig'))
        self.observations['fixture']['csv_sha256'] = digest(fixture)
        self.step('用真实文件选择控件上传标明合成的CSV', lambda: self.visible('#import-file-form [name="file"]').set_input_files(str(fixture)))
        self.submit('#import-file-form', after='#modal [data-action="commit-stage"]')
        assert self.get('/api/datasets')['items'] == [], 'Import preview must not commit business data.'
        self.step('核对预览原始单位、标准化和未入库状态', lambda: self._check_preview())
        self.click('#modal [data-action="commit-stage"]', after='#dataset-editor[data-version="1"]', label='明确确认保存合成输入')
        rows = self.get('/api/datasets')['items']
        assert len(rows) == 1
        saved = rows[0]
        assert saved['payload']['company'] == FIXTURE_COMPANY
        assert len(saved['payload']['periods']) == 12
        assert all(p['revenue'] == FIXTURE_REVENUE and p['cost'] == FIXTURE_COST for p in saved['payload']['periods'])
        self.dataset_id = saved['id']
        assert self.page.locator('#active-dataset').input_value() == self.dataset_id
        self.observations['fixture']['dataset_id'] = self.dataset_id
        self.navigate('settings')
        self.select('#preferences-form [name="amount_unit"]', 'wan', '明确选择金额显示万元')
        self.submit('#preferences-form', after='#preferences-form')
        assert self.get('/api/auth/me')['user']['preferences']['amount_unit'] == 'wan'

    def _check_preview(self):
        text = self.page.locator('#modal').inner_text()
        assert FIXTURE_COMPANY in text and '尚未写入财务库' in text and '归一化金额：元' in text
        self.observations['preview_text'] = text

    def ask(self, question):
        before = self.page.locator('#assistant-answer .chat-turn').count()
        self.fill('#assistant-query', question, '在当前企业会话填写具体问题：' + question)
        self.submit('#assistant-form')
        self.page.locator('#assistant-answer .chat-turn').nth(before).wait_for(timeout=RUN_TIMEOUT_MS)
        turn = self.page.locator('#assistant-answer .chat-turn').nth(before)
        assert turn.locator('.user-message p').inner_text() == question
        return turn

    def thread(self):
        rows = self.get('/api/services/threads?identity_id=&dataset_id=' + self.dataset_id)['items']
        assert len(rows) == 1, 'Each probe uses exactly one fresh fixture thread.'
        return self.get('/api/services/threads/' + rows[0]['id'])

    def no_external(self):
        calls = []
        for row in self.get('/api/services/threads?identity_id=&dataset_id=' + self.dataset_id)['items']:
            item = self.get('/api/services/threads/' + row['id'])
            calls.extend(m['payload']['response'].get('external_calls', 0) for m in item['messages'])
        for row in self.get('/api/runs')['items']:
            run = self.get('/api/runs/' + row['id'])
            if run.get('result'):
                assert run['result']['llm']['state'] == 'not_requested'
                attempts = run['result'].get('adaptive', {}).get('reflection', {}).get('call_attempts', 0)
                calls.append(attempts)
        assert all(x == 0 for x in calls), calls
        self.observations['external_call_counts'] = calls

    def create_local_report(self, question):
        self.navigate('agents')
        self.fill('#plan-form [name="query"]', question)
        assert not self.page.locator('#use-llm').is_checked()
        self.submit('#plan-form', after='#execute-plan-form')
        assert self.page.locator('#execute-plan-form [name="external_consent"]').count() == 0
        assert '本计划不会调用外部模型' in self.page.locator('#execute-plan-form').inner_text()
        self.submit('#execute-plan-form', after='#run-tab-summary .metric-row')
        anchor = self.page.locator('#main a[href$="export?format=json"]').first
        href = anchor.get_attribute('href')
        match = re.fullmatch(r'/api/runs/([a-zA-Z0-9_-]+)/export\?format=json', href or '')
        assert match, href
        run = self.get('/api/runs/' + match.group(1))
        assert run['state'] in ('succeeded', 'degraded') and run.get('result')
        assert run['result']['llm']['state'] == 'not_requested'
        return run


def probe_handoff(p):
    p.bootstrap()
    old = '2024-Q4营业收入是多少'
    wanted = '2023-Q2经营现金流是多少'
    p.navigate('agents')
    p.fill('#plan-form [name="query"]', old, '先明确保存一份不同期间的旧计划，建立污染检测对照')
    assert not p.page.locator('#use-llm').is_checked()
    p.submit('#plan-form', after='#execute-plan-form')
    assert p.get('/api/runs')['items'] == [], 'Saving old plan must not execute.'
    p.navigate('copilot')
    turn = p.ask(wanted)
    message_id = turn.get_attribute('data-message')
    saved = next(m for m in p.thread()['messages'] if m['id'] == message_id)
    scope = saved['payload']['response']['context']['question_scope']
    assert scope['period'] == '2023-Q2', scope
    region = f'[data-message="{message_id}"] .trace-container .assistant-reply'
    p.click(f'[data-message="{message_id}"] [data-x-action="chat-trace"]', after=region)
    trace = p.visible(region)
    assert '2023-Q2' in trace.inner_text()
    label = p.page.locator('.assistant-fact-head > span').filter(has_text=re.compile(r'^经营现金流$'))
    cash = trace.locator('.assistant-fact').filter(has=label)
    assert cash.count() == 1 and '10,000 元' in cash.inner_text() and '2023-Q2' in cash.inner_text()
    target = f'[data-message="{message_id}"] .trace-container [data-action="assistant-route"][data-route="agents"]'
    button = p.visible(target)
    bound_query = button.get_attribute('data-query')
    assert bound_query and all(term in bound_query for term in (wanted, '2023-Q2', '同比', '经营现金流'))
    assert old not in bound_query and '2024-Q4' not in bound_query
    assert button.get_attribute('data-dataset-id') == p.dataset_id
    p.observations['handoff_source'] = {'old_plan_question': old, 'original_question': wanted, 'expected_question': bound_query, 'expected_quarter': '2023-Q2', 'expected_dataset': p.dataset_id, 'actual_button_text': button.inner_text(), 'actual_button_query': bound_query}
    p.click(target, after='#plan-form', label='点击追踪回答内真正的“按此问题创建诊断计划”，不替换成侧栏跳转')
    actual = {'question': p.page.locator('#plan-form [name="query"]').input_value(), 'dataset': p.page.locator('#plan-form [name="dataset_id"]').input_value(), 'llm_checked': p.page.locator('#use-llm').is_checked()}
    p.observations['handoff_actual'] = actual
    p.no_external()
    assert actual['question'] == bound_query, f'F1 target question lost: expected {bound_query!r}, got {actual["question"]!r}; old control question={old!r}'
    assert wanted in actual['question'] and actual['question'] != old
    assert actual['dataset'] == p.dataset_id and not actual['llm_checked'], actual


# These functions replace only the two outcome probes in the existing harness.
# They are author-independent expectations; fixtures/results retain the original
# constants and all writes still pass through actual visible product controls.

VIEWPORT_GEOMETRY = """el => {
 const r=el.getBoundingClientRect(); let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom),opacity=1;
 for(let n=el;n;n=n.parentElement){const s=getComputedStyle(n);opacity*=Number(s.opacity);if(s.display==='none'||s.visibility==='hidden')return {ratio:0,opacity};if(n!==el){const a=n.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,a.left);right=Math.min(right,a.right);}if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,a.top);bottom=Math.min(bottom,a.bottom);}}}
 return {ratio:r.width&&r.height?Math.max(0,right-left)*Math.max(0,bottom-top)/(r.width*r.height):0,opacity,box:{x:r.x,y:r.y,width:r.width,height:r.height},scrollY};
}"""


def visible_geometry(locator):
    if locator.count() != 1:
        return {'ratio': 0, 'opacity': 0, 'count': locator.count()}
    return locator.evaluate(VIEWPORT_GEOMETRY)  # Read only; never scroll/set style.


def is_in_view(geometry):
    return geometry.get('ratio', 0) >= .95 and geometry.get('opacity', 0) >= .95


def probe_forecast(p):
    p.bootstrap()
    p.navigate('copilot')
    failures = []
    for metric, question, title, expected_raw in (
        ('gross_margin', '预测毛利率并展示回测依据', '毛利率', .2),
        ('revenue', '预测营业收入并展示回测依据', '营业收入', FIXTURE_REVENUE),
    ):
        turn = p.ask(question)
        message_id = turn.get_attribute('data-message')
        card = turn.locator('[data-card-kind="forecast"]')
        card.wait_for(state='visible', timeout=FORM_TIMEOUT_MS)
        assert card.count() == 1, 'The actual response must contain exactly one forecast card.'
        table = card.locator('table').first
        table.wait_for(state='visible', timeout=FORM_TIMEOUT_MS)
        heading = card.locator('h4')
        jump = turn.get_by_role('button', name='查看预测结果', exact=True)
        initial = {'heading': visible_geometry(heading), 'table': visible_geometry(table), 'jump': visible_geometry(jump)}
        # This occurs before ANY locator click/scroll used to reveal the result.
        p.step('记录新答复刚到达的原始视口（不得先自动滚动到卡片）', lambda: None)
        initial_ok = (is_in_view(initial['heading']) and is_in_view(initial['table'])) or is_in_view(initial['jump'])
        if not initial_ok:
            failures.append(f'{metric}: new answer hides both its forecast result and the result-locating button below the initial viewport')
        assert jump.count() == 1, 'A unique real result-locating button is part of this reviewed interaction.'
        assert jump.get_attribute('data-message') == message_id
        p.step('真实点击当前答复的“查看预测结果”', lambda: jump.click())
        after = {'heading': visible_geometry(heading), 'table': visible_geometry(table)}
        assert is_in_view(after['heading']) and is_in_view(after['table']), after
        assert card.evaluate('el => el === document.activeElement'), 'Result navigation must focus the intended forecast card.'
        assert not card.locator('details[open]').count(), 'The readable answer must not depend on opening technical JSON.'
        cells = table.locator('tbody tr').first.locator('td').all_text_contents()
        headers = table.locator('thead').inner_text()
        visible_text = card.inner_text()
        assert len(cells) == 2 and table.locator('tbody tr').count() == 2
        stored = next(m for m in p.thread()['messages'] if m['id'] == message_id)['payload']['response']
        artifact = next(c['data'] for c in stored['cards'] if c['kind'] == 'forecast')
        assert artifact['metric'] == metric and len(artifact['forecast']) == 2
        assert all(math.isclose(v['value'], expected_raw, abs_tol=1e-8) for v in artifact['forecast'])
        unit_ok = percentage_display(cells[1], headers + visible_text, expected_raw) if metric == 'gross_margin' else ('万元' in visible_text and math.isclose(number_text(cells[1]) or 0, 10, abs_tol=.01))
        if title not in visible_text or not unit_ok:
            failures.append(f'{metric}: expected explicit {title} and '+('20%' if metric=='gross_margin' else '10 万元')+f'; row={cells!r}')
        p.observations[metric] = {'independent_expected_raw': expected_raw, 'independent_expected_display': '20%' if metric=='gross_margin' else '10 万元', 'initial_viewport': initial, 'initial_result_discoverable': initial_ok, 'after_real_jump': after, 'message_id': message_id, 'closed_card_text': visible_text, 'row': cells, 'headers': headers, 'stored_metric': artifact['metric'], 'stored_forecast': artifact['forecast'], 'unit_and_scale_correct': unit_ok}
        p.step('核对闭合卡的指标、预测期间与单位', lambda: None)
        p.step('展开实际回测来源和限制作为旁证', lambda: card.locator('summary').filter(has_text='回测、边界与每折结果').click())
    p.no_external()
    assert not failures, 'F2 independent usability/number contract: ' + '; '.join(failures)


def select_report_by_human_label(p, side, query, version, expected_id):
    select = p.visible(f'#report-compare-form [name="{side}"]')
    options = [{'label': row.inner_text(), 'value': row.get_attribute('value')} for row in select.locator('option').all()]
    matches = [row for row in options if query in row['label'] and '2024-Q4' in row['label'] and re.search(r'数据修订\s*'+str(version)+r'(?!\d)', row['label'])]
    assert len(matches) == 1, f'A person must uniquely distinguish source revision {version} from readable option labels: {options}'
    selected = matches[0]
    assert selected['value'] == expected_id  # Corroboration after choosing by readable content.
    assert re.search(r'\d{2}:\d{2}:\d{2}', selected['label']), selected
    p.step(f'按可读问题、季度、修订{version}选择{side}报告', lambda: select.select_option(label=selected['label']))
    return selected['label']


def check_selection_summary(p, left, right, query):
    sections = p.page.locator('#report-selection-details section')
    assert sections.count() == 2
    for section, run in zip(sections.all(), [left, right]):
        fields = {row.locator('td').nth(0).inner_text(): row.locator('td').nth(1).inner_text() for row in section.locator('tbody tr').all()}
        assert fields.get('研究问题') == query and fields.get('目标季度') == '2024-Q4', fields
        assert fields.get('数据修订') == str(run['result']['dataset_version']), fields
        assert fields.get('报告标识') == run['id'], fields
        assert re.search(r'\d{2}:\d{2}:\d{2}', fields.get('生成时间', '')), fields


def check_comparison(p, left, right, before, after):
    bound = p.page.locator('#report-comparison [data-report-left][data-report-right]')
    bound.wait_for(state='visible', timeout=FORM_TIMEOUT_MS)
    assert bound.count() == 1 and bound.get_attribute('data-report-left') == left and bound.get_attribute('data-report-right') == right
    table = p.page.locator('#report-comparison table').first
    rows = [row.locator('td').all_text_contents() for row in table.locator('tbody tr').all()]
    margin = next(row for row in rows if row[0].strip() == '毛利率')
    header = table.locator('thead').inner_text()
    assert percentage_display(margin[1], header, before) and percentage_display(margin[2], header, after), margin
    assert points_display(margin[3], header, after-before), margin
    text = p.page.locator('#report-comparison').inner_text()
    assert '同季度' in text and '跨季度变化包含期间差异' not in text
    return {'left':left, 'right':right, 'margin_row':margin, 'header':header, 'text':text}


def require_no_comparison(p, reason):
    result = p.page.locator('#report-comparison')
    assert result.locator('table').count() == 0, 'Old comparison numbers remain paired with newly chosen reports.'
    assert result.locator('[data-report-left],[data-report-right]').count() == 0
    assert reason in result.inner_text(), result.inner_text()


def wait_comparison_idle(p):
    # Use the existing CSP-compatible MutationObserver lifecycle helper. It
    # observes the original form; it does not compile a polling predicate.
    from service_browser_check import FORM_COMPLETION
    form = p.page.locator('#report-compare-form').element_handle()
    assert form is not None, 'Original comparison form disappeared.'
    return form.evaluate(FORM_COMPLETION, FORM_TIMEOUT_MS)


def probe_report_points(p):
    p.bootstrap()
    query = '2024-Q4毛利率是多少'
    earlier = p.create_local_report(query)
    assert math.isclose(earlier['result']['analysis']['metrics']['gross_margin'], .2, abs_tol=1e-9)
    p.navigate('data')
    rows = p.page.locator('#main #dataset-editor [data-period-row]')
    assert rows.count() == 12 and rows.nth(11).locator('[name="period"]').input_value() == '2024-Q4'
    p.fill('#main #dataset-editor [data-period-row]:nth-child(12) [name="cost"]', FIXTURE_REVISED_COST, '同企业同季度成本80000改为75000，收入保持100000')
    p.submit('#main #dataset-editor', after='#modal [data-action="commit-stage"]')
    p.click('#modal [data-action="commit-stage"]', after='#dataset-editor[data-version="2"]', label='批准本次标准化差异作为新修订')
    revised = p.get('/api/datasets/' + p.dataset_id)
    assert revised['version'] == 2 and revised['payload']['periods'][-1]['revenue'] == FIXTURE_REVENUE and revised['payload']['periods'][-1]['cost'] == FIXTURE_REVISED_COST
    later = p.create_local_report(query)
    assert math.isclose(later['result']['analysis']['metrics']['gross_margin'], .25, abs_tol=1e-9)
    p.navigate('reports')
    p.click('#main [data-action="report-compare-dialog"]', after='#report-compare-form', label='从真实“对比两份报告”入口继续')
    labels = [select_report_by_human_label(p,'left',query,1,earlier['id']),select_report_by_human_label(p,'right',query,2,later['id'])]
    assert labels[0] != labels[1]
    check_selection_summary(p,earlier,later,query)
    p.submit('#report-compare-form', after='#report-comparison table')
    p.observations['comparison'] = check_comparison(p,earlier['id'],later['id'],.2,.25)
    assert p.get('/api/runs/'+earlier['id'])['result'] == earlier['result'], 'Original frozen report changed.'
    api_result = p.get('/api/workspace/reports/compare?left='+earlier['id']+'&right='+later['id'])
    assert math.isclose(next(r for r in api_result['changes'] if r['metric']=='gross_margin')['delta'], .05, abs_tol=1e-9)
    p.step('核对20%→25%=+5个百分点及实际报告绑定',lambda:None)
    select_report_by_human_label(p,'left',query,2,later['id'])
    require_no_comparison(p,'报告选择已改变')
    select_report_by_human_label(p,'right',query,1,earlier['id'])
    require_no_comparison(p,'报告选择已改变')
    check_selection_summary(p,later,earlier,query)
    p.submit('#report-compare-form',after='#report-comparison table')
    p.observations['reverse_comparison'] = check_comparison(p,later['id'],earlier['id'],.25,.2)

    # Hold exactly one actual read response, change the real controls, then
    # release the unmodified server response. This is explicit fault timing,
    # never a synthetic successful business result or a data mutation.
    pattern = '**/api/workspace/reports/compare?*'
    held = []
    def hold(route):
        assert route.request.method == 'GET'
        held.append(route)
    p.page.route(pattern,hold,times=1)
    try:
        with p.page.expect_request(lambda r: '/api/workspace/reports/compare?' in r.url, timeout=FORM_TIMEOUT_MS):
            p.click('#report-compare-form button[type="submit"]',label='明确延迟本次真实比较GET回执')
        assert len(held)==1, 'Expected exactly one held comparison read.'
        require_no_comparison(p,'正在读取')
        select_report_by_human_label(p,'left',query,1,earlier['id'])
        select_report_by_human_label(p,'right',query,2,later['id'])
        require_no_comparison(p,'报告选择已改变')
        request_url=held[0].request.url
        assert 'left='+later['id'] in request_url and 'right='+earlier['id'] in request_url
        def release():
            response=held[0].fetch(timeout=FORM_TIMEOUT_MS)
            assert response.status==200
            payload=response.json()
            assert payload['left']==later['id'] and payload['right']==earlier['id']
            held.pop().fulfill(response=response)
            wait_comparison_idle(p)
        p.step('释放旧选择真实回执，不能覆盖当前新选择',release)
        require_no_comparison(p,'报告选择已改变')
        check_selection_summary(p,earlier,later,query)
        p.observations['delayed_read']={'method':'GET','old_left':later['id'],'old_right':earlier['id'],'released_actual_response':True,'old_result_not_painted_under_new_selection':True}
    finally:
        p.page.unroute(pattern,hold)
        for route in held:
            route.abort('failed')

    # A failed OLD read is also stale: it must not become an error attributed
    # to the new report choice. This is distinct from a current-request error.
    p.page.route(pattern,hold,times=1)
    try:
        with p.page.expect_request(lambda r: '/api/workspace/reports/compare?' in r.url, timeout=FORM_TIMEOUT_MS):
            p.click('#report-compare-form button[type="submit"]',label='延迟原选择读取，准备验证迟到失败边界')
        assert len(held)==1
        select_report_by_human_label(p,'left',query,2,later['id'])
        select_report_by_human_label(p,'right',query,1,earlier['id'])
        require_no_comparison(p,'报告选择已改变')
        def fail_old_read():
            held.pop().abort('failed')
            errors=wait_comparison_idle(p)
            assert not any(text.strip() for text in errors), 'Old read failure was shown as the new selection error.'
        p.step('旧选择请求迟到失败，不污染新选择的错误区',fail_old_read)
        require_no_comparison(p,'报告选择已改变')
        check_selection_summary(p,later,earlier,query)
        p.observations['late_failed_read']={'method':'GET','injected_network_failure':True,'old_result_absent':True,'new_selection_not_given_old_error':True}
    finally:
        p.page.unroute(pattern,hold)
        for route in held:
            route.abort('failed')
    select_report_by_human_label(p,'left',query,1,earlier['id'])
    select_report_by_human_label(p,'right',query,2,later['id'])

    # Abort a single read to exercise a real readable error. No 5xx exemption,
    # fabricated data payload, authentication failure or policy change is used.
    aborted=[]
    def fail_read(route):
        assert route.request.method=='GET'
        aborted.append({'method':'GET','left':earlier['id'],'right':later['id']})
        route.abort('failed')
    p.page.route(pattern,fail_read,times=1)
    try:
        p.click('#report-compare-form button[type="submit"]',label='明确注入一次比较读取断网')
        wait_comparison_idle(p)
        assert len(aborted)==1
        require_no_comparison(p,'本次比较未完成')
        error=p.page.locator('#report-compare-form .form-error')
        assert error.inner_text().strip(), 'Failed comparison needs a visible actionable error.'
        assert error.is_visible()
        check_selection_summary(p,earlier,later,query)
        p.observations['aborted_read']={'injected':aborted,'visible_error':error.inner_text(),'old_result_absent':True}
        p.step('失败后保留选择与可读错误，不展示过期数字',lambda:None)
    finally:
        p.page.unroute(pattern,fail_read)
    p.submit('#report-compare-form',after='#report-comparison table')
    p.observations['retry_comparison']=check_comparison(p,earlier['id'],later['id'],.2,.25)
    p.no_external()


def run_contract_audit(browser, *, base_url, data_dir, output_dir, repository_root, expected_web_tree, expected_server_tree, report_path=None, submit_form=None):
    """Callable from the existing *native* isolated runner; returns aggregate report.

    Does not terminate an existing browser. Always creates its own fresh contexts.
    Caller must exit nonzero if all_checks_passed is false. An expected-red
    baseline is still FAIL and never emits PASS or an XFAIL success.
    """
    require_isolated_runner(base_url, data_dir)
    root = Path(repository_root).resolve()
    out = Path(output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(root / 'scripts'))
    from acceptance_diagnostics import EventJournal, attach_browser_diagnostics, message_metadata, safe_location
    if submit_form is None:
        from service_browser_check import submit_form as existing_submit_form
        submit_form = existing_submit_form
    identity = git_identity(root)
    expected = {'web': expected_web_tree, 'server': expected_server_tree}
    if any(not re.fullmatch(r'[0-9a-f]{40}', value) for value in expected.values()):
        raise ValueError('Both explicit expected protected tree IDs must be full 40-character Git SHA values.')
    if identity['protected_tree_ids'] != expected or identity['protected_diff'] or identity['protected_untracked']:
        raise RuntimeError("Protected web/server content differs from this run's explicitly reviewed tree IDs. Never silently inherit baseline approval after product edits.")
    report = {'started_at': now(), 'status': 'running', 'all_checks_passed': False, 'transport': 'native Playwright Chromium + actual isolated Uvicorn', 'policy_modified': False, 'bridge_used': False, 'direct_api_mutations_used': False, 'synthetic_only': True, 'repository': str(root), 'expected_protected_tree_ids': expected, 'git': identity, 'browser': browser.version, 'viewport': {'width': 1520, 'height': 1080}, 'timezone_id': 'UTC', 'runner': {k: os.getenv(k, '') for k in ('GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'RUNNER_OS')}, 'scenarios': []}
    report_path = Path(report_path) if report_path else root / 'evidence' / 'product-browser-audit.json'
    dump(report_path, report)
    functions = [probe_handoff, probe_forecast, probe_report_points]
    for (code, name), function in zip(SCENARIOS, functions):
        directory = out / code
        directory.mkdir(exist_ok=True)
        result = {'id': code, 'name': name, 'status': 'running', 'started_at': now(), 'precondition': 'Fresh synthetic account, 12 constant closed standalone quarters, yuan import, explicit wan display, no configured providers', 'screenshots': [], 'js_errors': [], 'http': [], 'external_requests': [], 'unexpected_dialogs': [], 'evidence_errors': []}
        report['scenarios'].append(result)
        journal = EventJournal(directory / 'browser-events.jsonl')
        journal.emit('probe_scenario_started', scenario=code, viewport=report['viewport'])
        context = None
        page = None
        probe = None
        trace_started = False
        video = None
        try:
            context = browser.new_context(viewport=report['viewport'], device_scale_factor=1, timezone_id='UTC', record_video_dir=str(directory / 'video'), record_video_size=report['viewport'])
            context.tracing.start(screenshots=True, snapshots=True, sources=True)
            trace_started = True
            page = context.new_page()
            video = page.video
            page.set_default_timeout(FORM_TIMEOUT_MS)
            attach_browser_diagnostics(page, journal)
            page.on('pageerror', lambda error, row=result: row['js_errors'].append(message_metadata(error)))
            def response_received(response, row=result):
                path = urlsplit(response.url).path
                if path.startswith('/api/'):
                    row['http'].append({'method': response.request.method, 'path': safe_location(response.url), 'status': response.status})
            page.on('response', response_received)
            def request_started(request, row=result):
                url = urlsplit(request.url)
                if url.scheme in ('http', 'https') and (url.scheme, url.netloc) != (urlsplit(base_url).scheme, urlsplit(base_url).netloc):
                    row['external_requests'].append({'method': request.method, 'origin': url.scheme + '://' + url.netloc})
            page.on('request', request_started)
            def unexpected_dialog(dialog, row=result):
                row['unexpected_dialogs'].append({'type': dialog.type, 'message': dialog.message})
                dialog.dismiss()  # Never silently approve a surprise destructive confirmation.
            page.on('dialog', unexpected_dialog)
            probe = Probe(page, base_url, directory, submit_form, journal)
            function(probe)
            assert not result['js_errors'], result['js_errors']
            assert not result['external_requests'], result['external_requests']
            assert not result['unexpected_dialogs'], result['unexpected_dialogs']
            assert not [r for r in result['http'] if r['status'] >= 500], result['http']
            result['status'] = 'passed'
        except AssertionError as exc:
            result['status'] = 'failed'
            result['error'] = {'type': type(exc).__name__, 'message': str(exc)}
        except Exception as exc:
            result['status'] = 'blocked_or_error'
            result['error'] = {'type': type(exc).__name__, 'message': str(exc)}
            result['traceback'] = traceback.format_exc()
        finally:
            if probe is not None:
                result['observations'] = probe.observations
                result['steps'] = probe.steps
                try:
                    probe.screenshot('final-' + result['status'])
                except Exception as exc:
                    result['evidence_errors'].append('final screenshot: ' + str(exc))
                result['screenshots'] = probe.screenshots
            if context is not None:
                if trace_started:
                    try:
                        trace = directory / 'trace.zip'
                        context.tracing.stop(path=str(trace))
                        result['trace'] = {'file': str(trace.relative_to(out)), 'sha256': digest(trace)}
                    except Exception as exc:
                        result['evidence_errors'].append('trace finalization: ' + str(exc))
                try:
                    context.close()  # Playwright finalizes video only on close.
                    if video is not None:
                        video_path = Path(video.path())
                        result['video'] = {'file': str(video_path.relative_to(out)), 'sha256': digest(video_path)}
                except Exception as exc:
                    result['evidence_errors'].append('video/context finalization: ' + str(exc))
            if result['evidence_errors'] and result['status'] == 'passed':
                result['status'] = 'evidence_incomplete'
            result['finished_at'] = now()
            journal.emit('probe_scenario_finished', scenario=code, status=result['status'], evidence_complete=not result['evidence_errors'])
            journal.close()
            result['diagnostic_journal'] = {'file': str((directory / 'browser-events.jsonl').relative_to(out)), 'sha256': digest(directory / 'browser-events.jsonl')}
            dump(directory / 'result.json', result)
            dump(report_path, report)
            print(result['status'].upper(), code, result.get('error', {}).get('message', ''), flush=True)
    report['finished_at'] = now()
    report['all_checks_passed'] = all(r['status'] == 'passed' for r in report['scenarios'])
    report['status'] = 'passed' if report['all_checks_passed'] else 'failed'
    report['git_after'] = git_identity(root)
    if report['git_after']['head'] != identity['head'] or report['git_after']['protected_diff'] or report['git_after']['protected_untracked'] or report['git_after']['protected_tree_ids'] != expected or report['git_after']['protected_file_sha256'] != identity['protected_file_sha256']:
        report['status'] = 'failed'
        report['all_checks_passed'] = False
        report['source_integrity_error'] = 'Product source or checkout changed during audit.'
    dump(report_path, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--out', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--expected-web-tree', required=True)
    parser.add_argument('--expected-server-tree', required=True)
    args = parser.parse_args()
    root = args.repo.resolve()
    out = (args.out or root / 'evidence' / 'product-audit').resolve()
    report_path = (args.report or root / 'evidence' / 'product-browser-audit.json').resolve()
    out.mkdir(parents=True, exist_ok=True)
    initial = {'started_at': now(), 'status': 'not_run', 'all_checks_passed': False,
               'transport': 'native Playwright Chromium + existing isolated Uvicorn',
               'policy_modified': False, 'bridge_used': False, 'scenarios': [],
               'expected_protected_tree_ids': {'web': args.expected_web_tree, 'server': args.expected_server_tree}}
    dump(report_path, initial)
    try:
        # No override: local execution or missing temporary-server provenance is blocked.
        require_isolated_runner('http://127.0.0.1:8000', os.getenv('DATA_DIR', ''))
        identity = git_identity(root)
        expected = initial['expected_protected_tree_ids']
        initial['git'] = identity
        if identity['protected_tree_ids'] != expected or identity['protected_diff'] or identity['protected_untracked']:
            raise RuntimeError("Protected product files are not this run's explicitly reviewed trees.")
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                report = run_contract_audit(browser, base_url='http://127.0.0.1:8000',
                    data_dir=os.environ['DATA_DIR'], output_dir=out, repository_root=root,
                    expected_web_tree=args.expected_web_tree,
                    expected_server_tree=args.expected_server_tree, report_path=report_path)
            finally:
                browser.close()
        return 0 if report['all_checks_passed'] else 1
    except Exception as exc:
        # Startup, policy or integration errors cannot inherit a prior green report.
        current = json.loads(report_path.read_text(encoding='utf-8'))
        current.update(status='blocked_or_error', all_checks_passed=False, finished_at=now(),
                       error={'type': type(exc).__name__, 'message': str(exc)})
        if 'git' in initial:
            current.setdefault('git', initial['git'])
        dump(report_path, current)
        print('BLOCKED_OR_ERROR', type(exc).__name__, str(exc), flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
