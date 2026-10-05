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
    'plan-history': {
        'mode': 'product-plan-history',
        'report': 'product-plan-history-audit.json',
        'scenarios': (('L6-plan-history', '七份真实计划→全部历史分页→第一份原问题→返回及重新登录找回'),),
        'precondition': 'Fresh synthetic account; seven draft plans created with actual visible controls; no API mutations, fixture faults or providers; history reads leave every original plan unchanged',
    },
    'tracking-units': {
        'mode': 'product-tracking-units',
        'report': 'product-tracking-units-audit.json',
        'scenarios': (('L4-tracking-units', '明确百分比与人民币元→取消保全→真实阈值触发→历史依据→暂停重启'),),
        'precondition': 'Fresh synthetic account; actual header-only CSV template and last closed quarter in yuan; explicit wan preference; all mutations via visible controls; one declared discard decision for the cancelled draft; no fixture faults or providers',
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
    'source-integrity': {
        'mode': 'product-source-integrity',
        'report': 'product-source-integrity-audit.json',
        'scenarios': (
            ('I5-review-scope', '证据范围变化拒绝旧计划→真实重新审阅→新预览恢复'),
            ('I6-dataset-source', '财务输入校验异常拒绝产物→可信历史恢复新修订→新计划'),
        ),
        'precondition': 'Fresh synthetic accounts; visible source/plan creation; explicit temporary owner-bound review-scope or dataset-payload fault; actual application review/revision recovery; no fixture restore, providers, or production fault API',
        'database_fault_injection': True,
    },
    'tracking-integrity': {
        'mode': 'product-tracking-integrity',
        'report': 'product-tracking-integrity-audit.json',
        'scenarios': (
            ('I7-tracking-source', '既有规则遇坏输入不计算不留提醒→可信修订恢复→原规则重读'),
        ),
        'precondition': 'Fresh synthetic account; existing report/watch created through visible UI; one exact owner-bound temporary dataset fault; explicit trusted revision restore creates v2; original rule/report preserved; no providers or production fault API',
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
