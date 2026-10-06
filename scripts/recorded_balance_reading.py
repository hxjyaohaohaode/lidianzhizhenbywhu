"""Read the native balance source rows without equating UI labels to API codes.

This is acceptance-only. The application keeps CNY in its API and may display
the same original amount as Chinese 元. Decimal comparison is independent of
the product formatter; the existing strict reader owns geometry and scrolling.
"""
from __future__ import annotations

from decimal import Decimal
import math
import re
from types import SimpleNamespace

YUAN_TEXT = re.compile(r'([+-]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?'
                       r'(?:[eE][+-]?[0-9]+)?)\s*(?:人民币\s*)?元')


def expect_source_row(path, amount_text, fact, dataset, *, period, key):
    """Bind complete displayed text to the saved raw yuan, never to display_value."""
    assert key in ('assets', 'liabilities')
    payload = dataset['payload']
    assert payload['currency'] == 'CNY' and payload['amount_unit'] == 'yuan'
    source = next(row for row in payload['periods'] if row['period'] == period)
    raw = source[key]
    assert isinstance(raw, (int, float)) and not isinstance(raw, bool) and math.isfinite(raw)
    expected_path = f'periods/{period}/{key}'
    assert fact['id'] == key and fact['period'] == period
    assert fact['value'] == raw and fact['unit'] == 'CNY'
    assert fact['dataset_id'] == dataset['id'] and fact['dataset_version'] == dataset['version']
    assert fact['input_hash'] == dataset['content_hash']
    assert fact['inputs'] == [{'path': expected_path, 'field': key, 'value': raw, 'unit': 'CNY'}]
    assert path.strip() == expected_path, 'Read the exact original quarter and field path.'
    match = YUAN_TEXT.fullmatch(amount_text.strip())
    assert match, 'Source amount must carry the explicit original yuan label, not 万元/亿元/% or an unspecified unit.'
    observed = Decimal(match.group(1).replace(',', ''))
    assert observed == Decimal(str(raw)), 'Displayed source amount differs from the saved raw CNY value.'
    return {'field': key, 'period': period, 'path': expected_path, 'raw_CNY': raw,
            'displayed_source': amount_text.strip(), 'dataset_id': dataset['id'],
            'dataset_version': dataset['version'], 'dataset_hash': dataset['content_hash']}


def read_source_row(page, row, fact, dataset, *, period, key, renderer, message_id,
                    screenshot, observations, emit):
    """Check semantics, then read and capture the whole row inside its real clip.

    The caller has opened its actual disclosure. No style/DOM mutation, forced
    visibility, short text substitute or synthetic scroll coordinates are used.
    """
    # The shared journey also imports FORM_COMPLETION from the general runner.
    # Defer this read-only helper import until that runner is fully initialized.
    try:
        from .product_strategy_journey import _read_groups
    except ImportError:
        from product_strategy_journey import _read_groups
    assert renderer in ('service', 'trace')
    assert isinstance(message_id, str) and message_id
    assert row.count() == 1
    path, amount = row.locator(':scope > code'), row.locator(':scope > span')
    assert path.count() == amount.count() == 1
    path_text, amount_text = path.inner_text().strip(), amount.inner_text().strip()
    bound = expect_source_row(path_text, amount_text, fact, dataset, period=period, key=key)
    start = len(observations.get('complete_text_groups', []))
    label = f'完整阅读{renderer} {period} {key}的原路径、原金额与元单位'

    def frame(name):
        filename = f'ui-current-recorded-balance-source-{renderer}-{key}-{name}.png'
        screenshot(filename, full_page=False)
        return filename

    def step(label, work):
        emit('balance_source_read_started', label=label, message_id=message_id, renderer=renderer)
        result = work()
        emit('balance_source_read_completed', label=label, message_id=message_id, renderer=renderer)
        return result

    probe = SimpleNamespace(page=page, observations=observations, screenshot=frame, step=step)
    _read_groups(probe, [(row, [path_text, amount_text])], label)
    records = observations.get('complete_text_groups', [])
    assert len(records) == start + 1 and records[start]['geometry']['visible']
    assert records[start]['screenshot']
    observations.setdefault('recorded_balance_sources', []).append({**bound,
        'renderer': renderer, 'message_id': message_id, 'reading_index': start,
        'manual_pixel_review': 'pending'})


REPORT_COLUMNS = ['目标季度', '所问指标', '已保存结果', '原输入与公式']
STOCK_FORMULA = '已保存的季度期末存量（标准化为人民币元；累计转单季不差分）'


def expect_report_rows(question, columns, rows, message, run, dataset, *, period):
    """Independent expectations for the unchanged 500000/200000-yuan fixture.

    Match whole rendered cells, not producer display strings or hidden JSON.
    Block-paragraph blank lines are the only text normalization permitted.
    """
    report, readout = run['result'], run['result']['readout']
    original = message['payload']['question']
    assert original == period + '总资产、总负债和资产负债率分别是多少'
    assert question == report['query'] == f'核查范围：{period}，同比，资产负债率、总资产、总负债。\n当前目标：{original}'
    for scope in (message['payload']['response']['context']['question_scope'], run['snapshot']['research_scope']):
        assert scope['period'] == period
        assert scope['topics'] == ['leverage', 'assets', 'liabilities']
    assert message['payload']['response']['context']['question_scope']['comparison'] == run['snapshot']['comparison'] == 'year_over_year'
    assert run['dataset_id'] == readout['input_source']['dataset_id'] == dataset['id']
    assert run['snapshot']['dataset_version'] == report['dataset_version'] == readout['input_source']['dataset_version'] == dataset['version']
    assert report['dataset_hash'] == readout['input_source']['dataset_hash'] == dataset['content_hash']
    assert run['snapshot']['dataset'] == dataset['payload']
    assert dataset['payload']['amount_unit'] == 'yuan' and dataset['payload']['currency'] == 'CNY'
    source, = [p for p in dataset['payload']['periods'] if p['period'] == period]
    assert source['assets'] == 500000 and source['liabilities'] == 200000
    assert readout['scope_recorded'] is True and readout['period'] == period and readout['amount_unit'] == 'wan'
    fields = [('leverage', '资产负债率', .4, 'ratio', '40%', ['liabilities', 'assets'], '负债/资产'),
              ('assets', '总资产', 500000, 'CNY', '50 万元', ['assets'], STOCK_FORMULA),
              ('liabilities', '总负债', 200000, 'CNY', '20 万元', ['liabilities'], STOCK_FORMULA)]
    facts = readout['facts']
    assert [f['id'] for f in facts] == [f[0] for f in fields], 'Exactly one of each requested fact, in its saved order.'
    expected = []
    for fact, (key, label, value, unit, displayed, inputs, formula) in zip(facts, fields):
        assert fact['label'] == label and fact['period'] == period and fact['unit'] == unit
        assert type(fact['value']) in (int, float) and fact['value'] == value
        assert fact['status'] == 'available' and not fact['reason'] and fact['formula'] == formula
        assert [{k: v[k] for k in ('path', 'field', 'value', 'unit')} for v in fact['inputs']] == [
            {'path': f'periods/{period}/{field}', 'field': field, 'value': source[field], 'unit': 'CNY'} for field in inputs]
        if key != 'leverage': assert fact['period_basis'] == 'quarter_end_stock'
        original = ['总资产：50 万元' if field == 'assets' else '总负债：20 万元' for field in inputs]
        expected.append([period, label, displayed, '\n'.join([*original, formula])])
    assert columns == REPORT_COLUMNS
    normalized = [['\n'.join(line.strip() for line in cell.splitlines() if line.strip()) for cell in row] for row in rows]
    assert normalized == expected, 'Read all complete rows with exact quarter, result, units, inputs and formula.'


def read_report_rows(page, section, message, run, dataset, *, period, proposal_id,
                     screenshot, observations, emit):
    """Capture the original question and all three rows after the source-tail frame.

    The caller has already checked the exact source-message/proposal/plan/new-run
    chain. Reuse its original objects; this reader makes no API requests.
    """
    try:
        from .product_strategy_journey import _read_groups
    except ImportError:
        from product_strategy_journey import _read_groups
    assert section.count() == 1
    question = section.locator(':scope > p.preserve-lines')
    table = section.locator(':scope > .table-scroll > table').first
    rows = table.locator('tbody tr').all()
    cells = [[cell.inner_text().strip() for cell in row.locator('td').all()] for row in rows]
    assert question.count() == 1
    text = question.inner_text().strip()
    expect_report_rows(text, table.locator('thead th').all_text_contents(), cells,
        message, run, dataset, period=period)
    binding = {'message_id': message['id'], 'thread_id': message['thread_id'],
        'proposal_id': proposal_id, 'plan_id': run['snapshot']['studio']['plan_id'], 'run_id': run['id'],
        'dataset_id': dataset['id'], 'dataset_version': dataset['version'], 'dataset_hash': dataset['content_hash']}
    start = len(observations.get('complete_text_groups', []))

    def frame(name):
        filename = f'ui-current-recorded-balance-report-{name}.png'
        screenshot(filename, full_page=False)
        return filename

    def step(label, work):
        emit('balance_report_read_started', label=label, **binding)
        result = work()
        emit('balance_report_read_completed', label=label, **binding)
        return result

    probe = SimpleNamespace(page=page, observations=observations, screenshot=frame, step=step)
    _read_groups(probe, [(question, [text]), (table.locator('thead'), REPORT_COLUMNS)] +
        [(row, values) for row, values in zip(rows, cells)], '完整阅读新报告原问题、指定季度及40%/50万元/20万元完整事实行')
    records = observations.get('complete_text_groups', [])
    assert len(records) == start + 5 and all(r['geometry']['visible'] and r['screenshot'] for r in records[start:])
    observations.setdefault('recorded_balance_reports', []).append({**binding,
        'original_question': message['payload']['question'], 'report_question': text, 'period': period,
        'fact_rows': cells, 'reading_indices': list(range(start, len(records))), 'manual_pixel_review': 'pending'})
