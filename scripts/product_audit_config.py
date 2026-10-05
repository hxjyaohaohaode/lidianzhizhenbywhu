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
    'integrity': {
        'mode': 'product-integrity',
        'report': 'product-integrity-audit.json',
        'scenarios': (
            ('I1-import-integrity', '损坏预览拒绝零写入→真实返回重选→新确认恢复'),
            ('I2-report-integrity', '完整历史仍可比→损坏产物清除旧差异→恢复原字节后重试'),
            ('I3-memory-integrity', '同版本记忆变更→旧报告冻结→行动和跟踪需明确历史选择'),
        ),
        'precondition': 'Fresh synthetic accounts created through visible UI; no providers; explicitly recorded corruption of selected owner-bound rows in the existing disposable CI database only; corruption is not a UI action or a production API',
        'database_fault_injection': True,
    },
    'comparison-integrity': {
        'mode': 'product-comparison-integrity',
        'report': 'product-comparison-integrity-audit.json',
        'scenarios': (
            ('I4-comparison-integrity', '真实两企业对照→坏行动摘要拒绝历史继承→完整原报告重建跟踪'),
        ),
        'precondition': 'One fresh synthetic account; two company inputs and comparison/report/action created through visible UI; one explicit owner-bound temporary action-comparison receipt fault; an exact one-time decision to leave the test draft; no providers or production fault API',
        'database_fault_injection': True,
    },
}


def audit_suite(name):
    try:
        return AUDIT_SUITES[name]
    except KeyError as exc:
        raise ValueError('Unknown native product audit suite: ' + str(name)) from exc
