"""Bounded native audit suites and disjoint evidence destinations."""

AUDIT_SUITES = {
    'contract': {
        'mode': 'product-audit',
        'report': 'product-browser-audit.json',
        'scenarios': (
            ('F1-trace-handoff', '历史季度追踪→真实下一步按钮保留问题与企业'),
            ('F2-forecast-units', '预测卡明确毛利率百分数及收入金额单位'),
            ('F3-report-points', '同季度报告毛利率差值明确为百分点'),
        ),
        'precondition': 'Fresh synthetic account, 12 constant closed standalone quarters, yuan import, explicit wan display, no configured providers',
    },
    'first-use': {
        'mode': 'product-first-use',
        'report': 'product-first-use-audit.json',
        'scenarios': (
            ('L1-first-use-report', '空账号→真实模板→万元预览返回修改→历史季度精确交接→本地报告与实际下载'),
        ),
        'precondition': 'Fresh empty synthetic account; actual header-only template; two closed standalone 2024 quarters in wan; missing cash flow; Q1 cost corrected from 9 to 8 wan through file re-selection; no configured providers',
    },
}


def audit_suite(name):
    try:
        return AUDIT_SUITES[name]
    except KeyError as exc:
        raise ValueError('Unknown native product audit suite: ' + str(name)) from exc
