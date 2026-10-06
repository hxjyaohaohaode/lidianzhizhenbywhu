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
