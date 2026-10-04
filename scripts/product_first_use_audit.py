"""Independent L1 first-use outcome; runs only through the native CI audit runner.

Adapted from the reviewed 2026-10-04 outcome draft. All user mutations use
actual visible controls. Corroborating API reads never replace a UI journey.
Importing this module launches no browser, server, or request. L6 is excluded.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import uuid

try:
    from .product_readout_oracles import expect_first_use_readout, expect_reader_first_markdown, observe_text_by_normal_scroll, verify_frozen_report_after_later_input, inspect_human_import_values, read_preview_table
except ImportError:
    from product_readout_oracles import expect_first_use_readout, expect_reader_first_markdown, observe_text_by_normal_scroll, verify_frozen_report_after_later_input, inspect_human_import_values, read_preview_table

REVIEWED_REMOTE = '915cbde3f107b79bc767fad7dde90694a1ef1740'
REVIEWED_WEB = '85d10439febbaafc51b9c10ebfdb28b9ba4c4862'
REVIEWED_SERVER = 'c60d7ef8e7d941389e6d8984b9b6891f1162a811'
FORM_MS = 10_000
RUN_MS = 30_000
COMPANY = '独立L1合成电池企业（非真实财报）'
QUESTION = '2024-Q1毛利率和经营现金流是多少'
PERIODS = ('2024-Q1', '2024-Q2')
HEADERS = ['季度', '营业收入', '营业成本', '净利润', '经营现金流', '总资产', '总负债',
           '期初净资产', '期末净资产', '库存金额', '销量', '产量', '制造费用', '研发费用',
           '碳酸锂价格', '行业波动率']


class OutcomeGap(AssertionError):
    """The operated journey did not achieve its outcome, never an XFAIL pass."""


class HarnessContractError(RuntimeError):
    """Setup/adapter evidence is absent; do not classify as product behavior."""


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical_hash(value):
    # server.store.encode uses these exact serialization options; this is an
    # independent consistency check, not an independent financial calculator.
    body = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(body.encode()).hexdigest()


def require_native_contract(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise HarnessContractError('Local browser execution is restricted; L1 must not run here.')
    if p.base_url != 'http://127.0.0.1:8000' or os.environ.get('APP_ORIGIN') != p.base_url:
        raise HarnessContractError('Use only the already-running isolated native Uvicorn origin.')
    data = Path(data_dir).resolve()
    if not data.is_dir() or Path(tempfile.gettempdir()).resolve() not in data.parents or not data.name.startswith('lidian-native-'):
        raise HarnessContractError('A verified existing native temporary DATA_DIR is required.')
    if any(k.endswith('_API_KEY') and v for k, v in os.environ.items()):
        raise HarnessContractError('Remove provider API keys; this scenario has no external calls.')
    root = Path(repository_root).resolve()
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()
    found = {key: git('rev-parse', ref) for key, ref in {
        'tree': 'HEAD^{tree}', 'web': 'HEAD:web', 'server': 'HEAD:server'}.items()}
    expected = {'web': expected_web_tree, 'server': expected_server_tree}
    if any(not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{40}', value) for value in expected.values()):
        raise HarnessContractError('Explicit full reviewed web/server tree IDs are required.')
    # The CI supplies this round's explicitly reviewed full application pins.
    # Historical baseline constants below describe provenance, not a permanent
    # prohibition on testing an independently reviewed repair.
    if {key: found[key] for key in expected} != expected:
        raise HarnessContractError('Protected application source changed; review and regenerate the control map.')
    if git('diff', 'HEAD', '--name-only', '--', 'web', 'server') or git('ls-files', '--others', '--exclude-standard', '--', 'web', 'server'):
        raise HarnessContractError('Protected source differs from the reviewed tree.')
    p.observations['source_pin'] = {'historical_reviewed_remote': REVIEWED_REMOTE, 'historical_web': REVIEWED_WEB, 'historical_server': REVIEWED_SERVER, 'expected_current': expected, 'actual_head': git('rev-parse', 'HEAD'), **found}


def csv_headers(blob):
    rows = list(csv.reader(io.StringIO(blob.decode('utf-8-sig'))))
    assert rows == [HEADERS], 'Downloaded template must contain exactly the reviewed header and zero data rows.'
    return rows[0]


def synthetic_csv(template_bytes, *, corrected):
    """Fill the actual downloaded header, including all optional fields except cash flow."""
    headers = csv_headers(template_bytes)
    out = io.StringIO(newline='')
    writer = csv.writer(out, lineterminator='\n')
    writer.writerow(headers)
    # Amounts are explicitly 万元. Quantities and lithium price are not scaled.
    writer.writerow(['2024-Q1', '10', '8' if corrected else '9', '0.5', '', '50', '20', '30', '30', '2', '100', '120', '0.2', '0.3', '100000', '0.15'])
    writer.writerow(['2024-Q2', '12', '10', '0.6', '', '55', '22', '30', '33', '2.2', '110', '130', '0.25', '0.35', '110000', '0.16'])
    return out.getvalue().encode('utf-8-sig')


def expect_dataset(data, *, corrected=True):
    assert data['company'] == COMPANY
    assert data['currency'] == 'CNY' and data['amount_unit'] == 'yuan' and data['input_amount_unit'] == 'wan'
    assert data['period_basis'] == 'standalone_quarter'
    assert data['verification'] == 'unverified_user_input' and data['source_kind'] == 'user_provided'
    assert data['source_url'] == '', 'Synthetic input must not acquire a fabricated source URL.'
    assert [row['period'] for row in data['periods']] == list(PERIODS)
    for row, revenue, cost, volume, lithium in zip(data['periods'], [100000, 120000], [80000 if corrected else 90000, 100000], [100, 110], [100000, 110000]):
        assert row['revenue'] == revenue and row['cost'] == cost
        assert row['cash_flow'] is None, 'Missing optional cash flow is not zero.'
        assert row['sales_volume'] == volume and row['lithium_price'] == lithium


def expect_handoff_query(query):
    """Validate the actual source-bound handoff; never repair it by retyping."""
    assert isinstance(query, str)
    match = re.fullmatch('核查范围：2024-Q1，同比，(.+)。\n当前目标：' + re.escape(QUESTION), query)
    assert match, 'Original historical question or explicit scope envelope changed.'
    topics = match.group(1).split('、')
    assert len(topics) == len(set(topics))
    assert {'毛利率', '经营现金流'} <= set(topics) <= {'毛利率', '经营现金流', '经营现金收入比'}
    assert query.count(QUESTION) == 1 and '2024-Q2' not in query
    return query


def expect_report(run, saved, *, approved_query):
    r, s = run['result'], run['snapshot']
    assert run['state'] in ('succeeded', 'degraded'), run['state']
    assert run['dataset_id'] == saved['id'] and r['dataset_id'] == saved['id']
    expect_handoff_query(approved_query)
    assert r['query'] == approved_query, 'Report must preserve the actual approved handoff query, including its scope envelope.'
    assert r['dataset_version'] == saved['version'] == 1
    assert r['dataset_hash'] == saved['content_hash'] == canonical_hash(saved['payload'])
    assert r['snapshot_hash'] == canonical_hash(s)
    assert s['dataset'] == saved['payload'], 'Full original input snapshot remains frozen.'
    assert r['analysis']['current_period'] == '2024-Q1'
    assert r['research_scope']['period'] == '2024-Q1'
    assert r['analysis']['metrics']['cash_ratio'] is None
    assert math.isclose(r['analysis']['metrics']['gross_margin'], .2, abs_tol=1e-12)
    assert r['llm']['state'] == 'not_requested' and r['llm']['calls'] == []
    assert r['llm']['review']['claims'] == [], 'No fixture expert prose may masquerade as a model response.'
    assert r['citations'] == [], 'No financial or web source was supplied.'
    assert r['quality']['as_of'] == s['analysis_as_of']
    assert re.fullmatch(r'\d{4}-\d{2}-\d{2}', r['quality']['as_of'])
    # Input analysis date is frozen at approval. Actual report creation may
    # validly cross UTC midnight; record both dates without forcing equality.
    assert re.match(r'\d{4}-\d{2}-\d{2}T', r['created_at'])
    assert r['quality']['field_coverage']['missing'] == ['cash_flow']
    margin = next(x for x in r['lineage'] if x['id'] == 'gross_margin')
    cash = next(x for x in r['lineage'] if x['id'] == 'cash_ratio')
    assert margin['formula'] == '(收入−成本)/收入' and margin['period'] == '2024-Q1'
    assert [(x['path'], x['value'], x['unit']) for x in margin['inputs']] == [
        ('periods/2024-Q1/revenue', 100000, 'CNY'), ('periods/2024-Q1/cost', 80000, 'CNY')]
    assert cash['value'] is None and cash['status'] == 'missing'
    assert cash['inputs'][0]['value'] is None
    assert r['warnings'] and r['limitations']


def expect_integrity(audit):
    assert audit['report_integrity']['valid'] is True, audit['report_integrity']
    assert audit['report_integrity']['format'] == 'studio'
    assert audit['ledger']['valid'] is True and audit['data_hash_valid'] is True
    assert audit['snapshot_hash_valid'] is True and audit['report_hash_valid'] is True
    assert audit['artifacts'] and all(x['integrity_valid'] and x['event_anchor_valid'] for x in audit['artifacts'])


def markdown_json_blocks(text):
    return [json.loads(body) for _, body in re.findall(r'^(`{3,})json\n(.*?)\n\1\s*$', text, flags=re.MULTILINE | re.DOTALL)]


def expect_downloads(json_bytes, md_bytes, run, saved, events, *, approved_query):
    exported = json.loads(json_bytes.decode('utf-8'))
    for key, value in run['result'].items():
        assert exported[key] == value, 'JSON export silently changed persisted field: ' + key
    assert exported['execution_events'] == events
    context = exported['export_context']
    assert context['run_id'] == run['id'] and context['execution_state'] == run['state']
    assert context['identity'] == run['snapshot']['identity']
    assert context['human_reviews_at_export'] == [] and context['assessment_at_export'] is None
    md = md_bytes.decode('utf-8')
    # Markdown escapes prose punctuation. Parse the actual fenced JSON values,
    # rather than stripping arbitrary punctuation or only checking download events.
    blocks = markdown_json_blocks(md)
    assert run['result']['analysis'] in blocks and run['result']['lineage'] in blocks
    assert events in blocks
    for phrase in ('单位', 'CNY', '2024-Q1', '100000', '80000', '数据哈希', '快照哈希', '没有匹配证据', '结构门禁与引用关联不等于事实核验'):
        # '单位' is represented by CNY in base lineage, not a prose heading.
        if phrase == '单位':
            assert '"unit": "CNY"' in md
        else:
            assert phrase in md, phrase
    assert saved['content_hash'] in md and run['result']['snapshot_hash'] in md
    literal_md = re.sub(r'\\([\\`*_{}\[\]()#+.!|~-])', r'\1', md)
    assert run['result']['created_at'] in literal_md
    assert approved_query.replace('\n', ' ') in literal_md
    assert 'not\\_requested' in md
    expect_report(run, saved, approved_query=approved_query)
    return {'json_bytes': len(json_bytes), 'markdown_bytes': len(md_bytes), 'parsed_markdown_json_blocks': len(blocks)}


def download_visible(p, locator, filename, label):
    target = Path(p.directory) / filename
    def action():
        assert locator.count() == 1 and locator.is_visible()
        with p.page.expect_download(timeout=RUN_MS) as info:
            locator.click()
        result = info.value
        assert result.failure() is None
        result.save_as(str(target))
        assert target.is_file() and target.stat().st_size > 0
        p.record_artifact(target, kind='download')
    p.step(label, action)
    content = target.read_bytes()  # Open the actual downloaded bytes.
    p.observations.setdefault('opened_downloads', []).append({'file': target.name, 'sha256': sha256(target), 'bytes': len(content)})
    return content


def open_detail(p, scope, summary, label):
    detail = scope.locator('details').filter(has=p.page.get_by_text(summary, exact=True))
    assert detail.count() == 1, 'A unique reviewed disclosure is required: ' + summary
    if detail.get_attribute('open') is None:
        p.step(label, lambda: detail.locator('summary').click())
    return detail


def register_empty_workspace(p):
    def landing():
        response = p.page.goto(p.base_url, wait_until='domcontentloaded')
        assert response is not None and response.status == 200
        csp = response.headers.get('content-security-policy', '')
        assert "script-src 'self'" in csp and "'unsafe-eval'" not in csp
        p.observations['landing_csp'] = csp
        p.page.locator('#auth-form').wait_for(state='visible', timeout=FORM_MS)
    p.step('新浏览器上下文访问原生隔离服务', landing)
    if p.page.locator('[data-intro-skip]').is_visible():
        p.click('[data-intro-skip]', label='通过原开场的真实进入按钮继续')
    p.click('[data-action="auth-toggle"]', after='#auth-form [name="name"]')
    p.fill('#auth-form [name="email"]', 'l1-' + uuid.uuid4().hex + '@test.example', '填写隔离合成账号邮箱')
    p.fill('#auth-form [name="password"]', 'Synthetic-only-L1-password-2026', '填写仅此隔离测试使用的密码')
    p.fill('#auth-form [name="name"]', 'L1独立合成用户')
    p.submit('#auth-form', after='#main[data-page="brief"]')
    assert p.get('/api/datasets')['items'] == []
    assert p.get('/api/runs')['items'] == []
    assert not any(x['configured'] for x in p.get('/api/capabilities')['providers'])
    text = p.visible('#main').inner_text()
    assert '建立你的研究底稿' in text and '准备企业经营数据' in text
    p.step('核对真实空工作台，不展示样例数值或完成结论', lambda: None)


def inspect_import_preview(p, corrected):
    modal = p.visible('#modal')
    text = modal.inner_text()
    assert COMPANY in text and '尚未写入财务库' in text and '归一化金额：元' in text
    assert '文件金额单位：万元' in text and '2 个已结束季度' in text
    assert '经营现金流' in text and '缺失字段保持空值' in text
    assert '0 项结构警告' in text and '字段与来源提示' in text and '未独立核验' in text
    for period in PERIODS:
        assert any(period in row and '经营现金流' in row for row in modal.locator('tr').all_inner_texts()), 'Each incomplete quarter must be identified.'
    inspect_human_import_values(p, corrected=corrected)
    detail = open_detail(p, modal, '查看标准化后的完整数据', '展开实际预览的归一化输入')
    parsed = json.loads(detail.locator('pre.json-view').inner_text())
    expect_dataset(parsed, corrected=corrected)
    body = detail.locator('pre.json-view')
    for needle in ['\"input_amount_unit\": \"wan\"', '\"period_basis\": \"standalone_quarter\"', '\"period\": \"2024-Q1\"', '\"revenue\": 100000', '\"cost\": ' + ('80000' if corrected else '90000'), '\"cash_flow\": null']:
        observe_text_by_normal_scroll(p, body, needle, ('修正后' if corrected else '原文件') + '预览完整数值 ' + needle)
    assert p.get('/api/datasets')['items'] == []
    assert p.get('/api/runs')['items'] == []
    p.observations.setdefault('import_previews', []).append({'corrected': corrected, 'normalized': parsed})



def preview_zero_without_committing(p, template, original_run):
    # Additional synthetic preview only; the main 9->8, null and frozen-report
    # narrative/files remain exactly as previously reviewed.
    rows = list(csv.reader(io.StringIO(synthetic_csv(template, corrected=True).decode('utf-8-sig'))))
    rows[1][3] = '0'          # Q1 net profit is real zero; Q1 cash flow stays blank.
    rows[2][4] = '0'          # Q2 cash flow is a supplied zero, not missing.
    rows[2][3] = '0.000029'   # 0.29 yuan shown in explicitly chosen wan, no binary tail.
    output = io.StringIO(newline=''); csv.writer(output, lineterminator='\n').writerows(rows)
    path = Path(p.directory) / 'L1-zero-only-preview.csv'; path.write_bytes(output.getvalue().encode('utf-8-sig'))
    p.record_artifact(path, kind='synthetic-input')
    before = p.get('/api/datasets')['items']; assert len(before)==1 and before[0]['version']==2
    p.navigate('data')
    p.click('#main [data-action="import-dialog"]', after='#import-file-form')
    p.select('#import-file-form [name="target_id"]', '', '明确这是额外新文件预览，不修订原数据')
    p.fill('#import-file-form [name="company"]', COMPANY)
    p.select('#import-file-form [name="amount_unit"]', 'wan')
    p.select('#import-file-form [name="basis"]', 'standalone_quarter')
    p.step('选择仅用于0与缺失核对的合成文件', lambda: p.visible('#import-file-form [name="file"]').set_input_files(str(path)))
    p.submit('#import-file-form', after='#modal section.import-readable')
    section = p.visible('#modal section.import-readable')
    first = section.locator('details[data-preview-period="2024-Q1"]')
    second = section.locator('details[data-preview-period="2024-Q2"]')
    read_preview_table(p, first.locator(':scope > .preview-values'), [
        ('cost',['营业成本','8','万元']),('cash_flow',['经营现金流','未提供','万元']),('net_profit',['净利润','0','万元']),
    ], '额外预览Q1明确0与未提供不同')
    p.step('实际打开Q2核对已提供0和小金额', lambda: second.locator(':scope > summary').click())
    read_preview_table(p, second.locator(':scope > .preview-values'), [
        ('cash_flow',['经营现金流','0','万元']),('net_profit',['净利润','0.000029','万元']),
    ], '额外预览Q2已提供0与0.29元的万元展示')
    p.click('#modal [data-action="close-modal"]', label='通过真实关闭按钮放弃额外预览，不点击确认保存')
    after = p.get('/api/datasets')['items']; assert after==before, 'A preview/cancel must not mutate current financial data.'
    old = p.get('/api/runs/'+original_run['id'])
    assert old['result']==original_run['result'] and old['snapshot']==original_run['snapshot']
    p.observations['zero_preview_cancelled_without_commit']={'source_file':path.name,'sha256':sha256(path),'Q1_cash_flow':None,'Q1_net_profit':0,'Q2_cash_flow':0,'Q2_net_profit_CNY':.29,'current_dataset_revision':2,'actual_close_control':True,'data_and_report_unchanged':True}
    p.no_external()


def l1_new_user_report(p, *, repository_root, data_dir, expected_web_tree, expected_server_tree):
    """Standalone first-use scenario; never call the 12-quarter Probe.bootstrap."""
    require_native_contract(p, repository_root=repository_root, data_dir=data_dir, expected_web_tree=expected_web_tree, expected_server_tree=expected_server_tree)
    register_empty_workspace(p)
    p.click('#main [data-action="import-dialog"]', after='#import-file-form')
    template = download_visible(p, p.visible('#import-file-form a[href="/api/import/template"]'), 'opened-header-only-template.csv', '下载并打开真实空白CSV模板')
    csv_headers(template)
    initial = Path(p.directory) / 'L1-synthetic-first.csv'
    corrected = Path(p.directory) / 'L1-synthetic-corrected.csv'
    initial.write_bytes(synthetic_csv(template, corrected=False))
    corrected.write_bytes(synthetic_csv(template, corrected=True))
    p.record_artifact(initial, kind='synthetic-input')
    p.record_artifact(corrected, kind='synthetic-input')
    p.observations['fixture'] = {'synthetic': True, 'company': COMPANY,
        'quarters': list(PERIODS), 'amount_unit_import': 'wan',
        'independent_expected_gross_margin': .2, 'expected_cash_flow': None,
        'initial_q1_cost_wan': 9, 'corrected_q1_cost_wan': 8,
        'no_provider_configured': True, 'setup': 'visible_controls_only'}
    def upload(path, *, retained=False):
        if retained:
            actual = {name: p.visible('#import-file-form [name="' + name + '"]').input_value() for name in ('company', 'amount_unit', 'basis', 'target_id', 'merge_mode')}
            assert actual == p.observations['first_import_form_metadata'], 'Returning must preserve non-file context.'
            assert p.visible('#import-file-form [name="file"]').input_value() == ''
            p.step('原生返回后非文件上下文仍完整，无需重填；文件需重新选择', lambda: None)
        else:
            p.fill('#import-file-form [name="company"]', COMPANY)
            p.select('#import-file-form [name="amount_unit"]', 'wan', '明确文件金额单位万元')
            p.select('#import-file-form [name="basis"]', 'standalone_quarter')
            p.observations['first_import_form_metadata'] = {name: p.visible('#import-file-form [name="' + name + '"]').input_value() for name in ('company', 'amount_unit', 'basis', 'target_id', 'merge_mode')}
        p.step('通过真实文件控件选择合成CSV：' + path.name,
               lambda: p.visible('#import-file-form [name="file"]').set_input_files(str(path)))
        p.submit('#import-file-form', after='#modal [data-action="commit-stage"]')
    upload(initial)
    inspect_import_preview(p, False)
    p.click('#modal [data-action="stage-back"]', after='#import-file-form', label='实际返回编辑，不关闭后跳过此步骤')
    # The browser file must be reselected; retained company/unit/basis are tested
    # before any new input can conceal their loss.
    p.observations['file_return_control'] = {'actual_route': 'fresh_file_selection', 'manual_inline_retention_claimed': False,
        'company_after_return': p.visible('#import-file-form [name="company"]').input_value(),
        'amount_unit_after_return': p.visible('#import-file-form [name="amount_unit"]').input_value()}
    upload(corrected, retained=True)
    inspect_import_preview(p, True)
    p.click('#modal [data-action="commit-stage"]', after='#dataset-editor[data-version="1"]', label='核对第二份预览后明确保存')
    rows = p.get('/api/datasets')['items']
    assert len(rows) == 1
    saved = rows[0]
    expect_dataset(saved['payload'])
    p.dataset_id = saved['id']
    assert p.visible('#active-dataset').input_value() == saved['id']
    # Inspect the real import receipt; no invented source receipt is added.
    p.click('#main [data-action="data-revisions"]', after='#modal')
    revision = p.visible('#modal').locator('details').filter(has=p.page.locator('summary').filter(has_text=re.compile(r'^修订 1 ·')))
    assert revision.count() == 1
    p.step('打开修订1及实际导入回执', lambda: revision.locator('summary').first.click())
    receipt_detail = open_detail(p, revision, '本次导入处理回执', '展开文件指纹、单位和确认记录')
    receipt = json.loads(receipt_detail.locator('pre.json-view').inner_text())
    assert receipt['source_kind'] == 'file' and receipt['dataset_version'] == 1
    assert receipt['import_context']['source_file_sha256'] == sha256(corrected)
    assert receipt['import_context']['input_amount_unit'] == 'wan'
    p.observations['import_receipt'] = receipt
    p.click('#modal [data-action="close-modal"]')
    p.navigate('copilot')
    turn = p.ask(QUESTION)
    fact = turn.locator('.fact-tile').filter(has=p.page.get_by_text('毛利率', exact=True))
    assert fact.count() == 1 and re.search(r'20(?:\.00)?%', fact.inner_text()) and '2024-Q1' in fact.inner_text()
    detail = open_detail(p, fact, '计算与来源', '打开历史季度毛利率真实公式和输入路径')
    text = detail.inner_text()
    assert '(收入−成本)/收入' in text and 'periods/2024-Q1/revenue' in text and 'periods/2024-Q1/cost' in text
    assert '100,000' in text and '80,000' in text and 'CNY' in text
    for needle in ['(收入−成本)/收入', '100,000', '80,000', 'CNY']:
        observe_text_by_normal_scroll(p, detail, needle, '真实助手公式与输入 ' + needle)
    cash = turn.locator('.fact-tile').filter(has=p.page.get_by_text('经营现金流', exact=True))
    assert cash.count() == 1 and '2024-Q1' in cash.inner_text() and '缺少可用输入' in cash.inner_text()
    assert not re.search(r'(?<!\d)0(?:\.00)?\s*元', cash.inner_text()), 'Missing cash flow must not display a financial zero.'
    # Reuse the already-reviewed real trace handoff, retaining the original question.
    message_id = turn.get_attribute('data-message')
    p.click(f'[data-message="{message_id}"] [data-x-action="chat-trace"]', after=f'[data-message="{message_id}"] .trace-container .assistant-reply')
    handoff = p.visible(f'[data-message="{message_id}"] .trace-container [data-action="assistant-route"][data-route="agents"]')
    bound_query = handoff.get_attribute('data-query')
    expect_handoff_query(bound_query)
    assert handoff.get_attribute('data-dataset-id') == saved['id']
    p.step('从真实追踪回答进入计划，保留历史季度企业范围', lambda: handoff.click())
    p.visible('#plan-form')
    assert p.visible('#plan-form [name="dataset_id"]').input_value() == saved['id']
    assert p.visible('#plan-form [name="query"]').input_value() == bound_query
    # Continue the actual valid scope-bound query without repairing/retyping it.
    p.observations['question_handoff'] = {'original_question': QUESTION, 'approved_query': bound_query,
        'dataset_id': saved['id'], 'expected_period': '2024-Q1', 'cash_flow_input': None, 'query_retyped_after_handoff': False}
    assert not p.visible('#use-llm').is_checked()
    p.submit('#plan-form', after='#execute-plan-form')
    assert p.visible('#execute-plan-form').locator('[name="external_consent"]').count() == 0
    assert '本计划不会调用外部模型' in p.visible('#execute-plan-form').inner_text()
    assert COMPANY in p.visible('.plan-top').inner_text() and '2024-Q1' in p.visible('.plan-top').inner_text()
    plan_id = p.visible('#execute-plan-form').get_attribute('data-id')
    approval = p.get('/api/workspace/plans/' + plan_id)
    assert approval['payload']['request']['query'] == bound_query
    assert approval['payload']['request']['dataset_id'] == saved['id']
    assert approval['payload']['snapshot']['research_scope']['period'] == '2024-Q1'
    assert approval['payload']['snapshot']['dataset'] == saved['payload']
    assert approval['payload']['snapshot']['dataset']['periods'][0]['cash_flow'] is None
    assert approval['payload']['max_calls'] == 0
    p.submit('#execute-plan-form', after='#run-tab-summary .metric-row')
    anchor = p.visible('#main a[href$="export?format=json"]')
    match = re.fullmatch(r'/api/runs/([A-Za-z0-9_-]+)/export\?format=json', anchor.get_attribute('href') or '')
    assert match
    # IDs are learned from the actually reached report, never used to find it.
    run = p.get('/api/runs/' + match.group(1))
    expect_report(run, saved, approved_query=bound_query)
    readout = expect_first_use_readout(run['result'], saved, receipt, corrected.read_bytes(), corrected.name)
    assert run['snapshot']['input_source'] == readout['input_source']
    section = p.visible('[data-report-readout]')
    p.step('保留新报告刚到达时的问题级答案原视口', lambda: None)
    assert 'periods/2024-Q1/revenue' not in section.inner_text() and 'periods/2024-Q1/cost' not in section.inner_text()
    requested_flow = next(f for f in readout['facts'] if f['id']=='cash_flow')
    target_step = next(item for item in readout['next_steps'] if item['period']=='2024-Q1' and 'cash_flow' in item['fields'])
    for needle in ['本次问题的回答', '营业收入', '营业成本', requested_flow['reason'], corrected.name, '原文件金额单位', '原文件期间口径', target_step['action']]:
        observe_text_by_normal_scroll(p, section, needle, '阅读可交付报告 ' + needle)
    audit = p.get('/api/workspace/runs/' + run['id'] + '/audit')
    expect_integrity(audit)
    assert '本次未授权模型解释' in p.visible('#run-tab-summary').inner_text()
    p.click('#main [data-action="run-tab"][data-tab="agents"]', after='#run-tab-agents')
    quant = p.page.locator('#run-tab-agents [data-action="node-details"][data-id="quant"]:visible')
    assert quant.count() == 1
    p.step('点击实际量化节点查看持久产物', lambda: quant.click())
    inspector = p.visible('#inspector')
    assert '实际执行产物' in inspector.inner_text() and '可核验产物' in inspector.inner_text()
    payloads = []
    artifacts = inspector.locator('details').filter(has=p.page.locator('summary').filter(has_text='可核验产物'))
    assert artifacts.count() > 0
    for index, detail in enumerate(artifacts.all()):
        if detail.get_attribute('open') is None:
            p.step('展开实际节点产物' + str(index + 1), lambda d=detail: d.locator('summary').click())
        assert detail.get_attribute('open') is not None
        body = detail.locator('pre.json-view')
        assert body.count() == 1 and body.is_visible()
        p.step('普通滚动并记录真实节点产物视口截图' + str(index + 1), lambda b=body: b.scroll_into_view_if_needed())
        payloads.append(json.loads(body.inner_text()))
    assert any(x == run['result']['analysis'] for x in payloads)
    p.observations['node_output_evidence'] = {'opened_or_already_open': True, 'rendered_pre_visible': True,
        'ordinary_scroll_and_step_screenshots': True, 'json_matches_saved_analysis': True,
        'human_pixel_readability_review': 'pending_not_proved_by_dom_or_json'}
    p.click('#inspector [data-action="close-inspector"]')
    p.click('#main [data-action="run-tab"][data-tab="rules"]', after='#run-tab-rules')
    margin_rule = p.visible('#run-tab-rules').locator('details').filter(has=p.page.get_by_text('毛利率', exact=True))
    assert margin_rule.count() == 1
    p.step('展开已归档报告的指标血缘', lambda: margin_rule.locator('summary').click())
    assert 'periods/2024-Q1/cost' in margin_rule.inner_text() and '80,000' in margin_rule.inner_text()
    j = download_visible(p, p.visible('#main a[href$="export?format=json"]'), 'opened-report.json', '下载并打开实际完整JSON报告')
    m = download_visible(p, p.visible('#main a[href$="export?format=md"]'), 'opened-report.md', '下载并打开实际Markdown报告')
    p.observations['export_validation'] = expect_downloads(j, m, run, saved, audit['trace'], approved_query=bound_query)
    p.observations['human_report_structure'] = expect_reader_first_markdown(m, file_name=corrected.name, file_hash=sha256(corrected))
    p.observations['report'] = {'run_id': run['id'], 'original_question': QUESTION, 'approved_query': bound_query, 'quarter': '2024-Q1', 'gross_margin': .2, 'cash_flow': None,
        'source_file_sha256': sha256(corrected), 'analysis_as_of': run['snapshot']['analysis_as_of'],
        'report_created_at': run['result']['created_at'], 'analysis_and_creation_dates_equal': run['snapshot']['analysis_as_of'] == run['result']['created_at'][:10],
        'download_content_verification': 'parsed_actual_bytes', 'download_document_readability_review': 'pending_human_review',
        'external_calls': 0, 'live_model_quality': 'not_tested_no_model_requested'}
    verify_frozen_report_after_later_input(p, run, j, m, download_visible)
    preview_zero_without_committing(p, template, run)
    p.no_external()
    return run
