"""Versioned, bounded projections of approved local outputs for research experts.

References point to archived outputs, never model-supplied numerical values. The
caller records the exact final disclosure after whole-section budget reduction.
"""
from __future__ import annotations
import math
from .store import digest

CLAIM_CONTRACT_VERSION = 'grounded-claims-v2'
TOOL_KEYS = {
    'comparison': ('status', 'reason', 'period', 'comparison', 'period_basis', 'analysis_as_of',
                   'comparability_note', 'comparison_provenance', 'warning', 'limitations'),
    'forecast': ('status', 'reason', 'metric', 'forecast_horizon', 'selected', 'selected_label',
                 'forecast', 'train_end', 'excluded_periods', 'limitations', 'locked_holdout', 'selection', 'approved_assumptions', 'experiment'),
    'sensitivity': ('status', 'reason', 'period', 'baseline', 'result', 'delta_gross_profit',
                    'break_even_volume_multiplier', 'assumptions', 'approved_assumptions', 'formula', 'limitations', 'experiment'),
    'counterevidence': ('status', 'groups', 'conflicting_labels', 'limitation'),
    'gaps': ('status', 'items', 'findings', 'baseline_requirement', 'unavailable_rule_components', 'limitation'),
}


def project_tools(outputs):
    """One adapter defines both model-visible data and its allowed references."""
    result = {}
    for kind, keys in TOOL_KEYS.items():
        value = outputs.get(kind)
        if not isinstance(value, dict):
            continue
        projected = {key: value[key] for key in keys if key in value}
        if kind == 'comparison':
            from .saved_comparisons import METRICS
            projected['items'] = [{'id': item['id'], 'company': item['company'],
                'dataset_version': item['dataset_version'],
                'metrics': {key: item['analysis']['metrics'].get(key) for key in METRICS},
                'warnings': item['analysis'].get('warnings', [])}
                for item in value.get('items', [])[:8]]
        projected['output_hash'] = digest(value)
        projected['references'] = {}
        if value.get('status', 'completed') == 'completed':
            def add(path, number, label, unit, period, *, reference_id=None, **extra):
                if not isinstance(number, (int, float)) or isinstance(number, bool) or not math.isfinite(number):
                    return
                id = reference_id or kind + ':' + path.replace('/', ':')
                projected['references'][id] = {'id': id, 'capability': kind, 'path': path,
                    'value': number, 'label': label, 'unit': unit, 'period': period,
                    'output_hash': projected['output_hash'],
                    'interpretation': 'approved_assumption_scenario' if kind == 'sensitivity' else 'same_period_user_inputs_not_industry_ranking' if kind == 'comparison' else 'statistical_baseline_not_causal', **extra}
                if value.get('experiment'):
                    # Do not duplicate a potentially 2,000-character assumption
                    # note for every number. The full provenance is in the tool.
                    projected['references'][id]['experiment'] = {key: value['experiment'][key]
                        for key in ('id', 'version', 'hash', 'result_hash')}
            if kind == 'sensitivity':
                for key, label in [('revenue', '情景营业收入'), ('cost', '情景营业成本'),
                                   ('gross_profit', '情景毛利额'), ('gross_margin', '情景毛利率')]:
                    add('result/' + key, value.get('result', {}).get(key), label,
                        'ratio' if key == 'gross_margin' else 'yuan', value.get('period'))
                add('delta_gross_profit', value.get('delta_gross_profit'), '情景毛利额变化', 'yuan', value.get('period'))
                add('break_even_volume_multiplier', value.get('break_even_volume_multiplier'), '盈亏平衡销量倍数', 'multiple', value.get('period'))
            elif kind == 'forecast':
                for index, point in enumerate(value.get('forecast', [])[:4]):
                    add(f'forecast/{index}/value', point.get('value'), '统计基线点估计',
                        'ratio' if value.get('metric') == 'gross_margin' else 'yuan', point.get('period'))
            elif kind == 'comparison':
                labels = {'gross_margin': '毛利率', 'cash_ratio': '经营现金收入比', 'leverage': '资产负债率',
                          'revenue_growth': '收入增速', 'net_margin': '净利率'}
                for index, item in enumerate(value.get('items', [])[:8]):
                    for key in METRICS:
                        add(f'items/{index}/analysis/metrics/{key}', item['analysis']['metrics'].get(key),
                            item['company'][:80]+' · '+labels[key], 'ratio',
                            value['period'], dataset_id=item['id'], reference_id='comparison:'+item['id']+':'+key)
        result[kind] = projected
    return result


def disclosed_references(tools):
    return {id: ref for value in tools.values() for id, ref in value.get('references', {}).items()}


def omit_tool_details(tools):
    # Retain the full artifact hash, not a hash of this projection of a projection.
    return {key: {'output_hash': value['output_hash'], 'status': value.get('status', 'completed'),
                  'omitted_detail': '完整工具产物超出上下文预算；请以本地归档为准'}
            for key, value in tools.items()}
