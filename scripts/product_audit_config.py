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
    'memory-eligibility': {
        'mode': 'product-memory-eligibility',
        'report': 'product-memory-eligibility-audit.json',
        'scenarios': (('I8-memory-preference', '批准记忆生成本地报告→真实偏好关闭→新预览排除→旧来源提示与明确历史选择'),),
        'precondition': 'Fresh synthetic account; approved company memory, report, action and watch created by visible UI; actual memory preference withdrawal; new plan excludes memory; trusted frozen history and original records remain unchanged; no database faults or providers',
    },
    'report-export': {
        'mode': 'product-report-export',
        'report': 'product-report-export-audit.json',
        'scenarios': (('I9-report-export', '真实原报告下载→坏产物阻止导出→新建另一份可信报告下载→保留坏历史'),),
        'precondition': 'Fresh synthetic account; visible CSV/plan/report and four real MD/JSON downloads; one declared owner-bound temporary report-artifact fault; no fixture restore; fresh report does not repair or rewrite damaged history; no providers',
        'database_fault_injection': True,
    },
    'question-scope': {
        'mode': 'product-question-scope',
        'report': 'product-question-scope-audit.json',
        'scenarios': (('L7-question-scope', '四个真实问题→准确指标与比较单位→真实身份→刷新及重新登录保留'),),
        'precondition': 'Fresh synthetic account; four questions and a real service identity created through visible controls; actual reload and re-login preserve original messages; no database faults or providers',
    },
    'experiment-recovery': {
        'mode': 'product-experiment-recovery',
        'report': 'product-experiment-recovery-audit.json',
        'scenarios': (('L8-experiment-recovery', '三次真实保存已提交后响应丢失→三次明确找回→保留原来源及新草稿'),),
        'precondition': 'Fresh synthetic account; actual UI saves with three committed POST response-loss injections and three explicit recoveries; six POSTs yield three experiments and three audit events; source v1 to v2 transition and newer draft preserved; no database faults or providers; orphan-manager continuation is outside this suite',
    },
    'strategy-consent': {
        'mode': 'product-strategy-consent',
        'report': 'product-strategy-consent-audit.json',
        'fixture_file': 'strategy-single-synthetic-input.csv',
        'scenarios': (('L9-strategy-consent', '一份输入一份报告→人工同意0→1→0→诚实阻塞激活→中文逐例与冻结历史'),),
        'precondition': 'Fresh synthetic account; one two-quarter financial input and one report with background-only evidence; all mutations through visible controls; explicit consent 0 to 1 to 0; blocked activation with no fabricated UI activation request; readable saved case, browser Back/reload and zero-case replay preserve history; no successful activation, rollback, three-input quality, database faults or providers',
    },
    'report-history': {
        'mode': 'product-report-history',
        'report': 'product-report-history-audit.json',
        'scenarios': (('L10-report-history', '21份实际报告→跨页找回原问题→Back与重登录→跨页冻结结果比较'),),
        'precondition': 'Fresh synthetic account; all21 reports and approvals created through visible controls; visible20-row page boundary; original report/plan objects frozen across Back/reload/relogin and cross-page comparison; separate201-row API storage test is not native evidence; no providers or database faults',
    },
    'late-actions': {
        'mode': 'product-late-actions',
        'report': 'product-late-actions-audit.json',
        'fixture_file': 'late-actions-synthetic-input.csv',
        'scenarios': (('L11-late-actions', '实际删除与刷新迟到保留新输入→自然关闭重开→正常编辑研究提案'),),
        'precondition': 'Fresh synthetic account; native-created evidence and exact target-bound confirmation; delay only delivery of one real successful deletion and four real refresh reads; newer drafts preserved; native research form edit/close/reopen and one current proposal; detached-form refusal remains DOM-test evidence; no providers or database faults',
    },
    'action-evidence': {
        'mode': 'product-action-evidence',
        'report': 'product-action-evidence-audit.json',
        'fixture_file': 'action-evidence-synthetic-financials.csv',
        'scenarios': (('L12-action-evidence', '完整阅读人工审阅与原文→展开保留选择草稿→明确完成→后来审阅不改原历史'),),
        'precondition': 'Fresh synthetic account; all report/action/evidence/review writes through visible UI; exactly one reviewed company source selected and one global unreviewed source left unselected; full long-note/text ranges via native scrolling; later review changes preserve completed action payload/history; no database faults or providers',
    },
    'copilot-integrity': {
        'mode': 'product-copilot-integrity',
        'report': 'product-copilot-integrity-audit.json',
        'scenarios': (('I10-copilot-report-integrity', '真实助手报告→声明单值损坏→历史卡拒绝正常展示与原文阅读→独立新报告→旧坏历史保持'),),
        'precondition': 'Fresh synthetic account; actual assistant message/proposal and explicit zero-call approvals; one declared owner-bound saved-result scalar fault after healthy native reading; real raw disclosure and same-thread fresh report preserve every old damaged row; no fixture restoration or providers',
        'database_fault_injection': True,
    },
    'historical-warning': {
        'mode': 'product-historical-warning',
        'report': 'product-historical-warning-audit.json',
        'scenarios': (('historical-cost-percentage-warning', '真实旧报告范围警示与原金额→原始下载→当前同问拒绝→冻结历史保持'),),
        'precondition': 'Fresh native synthetic registration; separately admitted genuine old API/worker completed-report closure of 49 rows, only outer owner mapping, no queued rows; preparation is not a UI business write or old-account upgrade; current visible list/read/download/refusal/back/reload; no providers or damaged-row injection',
        'legacy_history_preparation': 'historical-cost-percentage-legacy-completed-v1',
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


def audit_artifact_kinds(name):
    configuration = audit_suite(name)
    kinds = ('download', 'synthetic-input')
    if configuration.get('database_fault_injection'):
        kinds += ('fault-injection',)
    scope = configuration.get('legacy_history_preparation')
    if scope:
        if (name != 'historical-warning' or scope != 'historical-cost-percentage-legacy-completed-v1'
                or configuration.get('database_fault_injection')):
            raise ValueError('Historical preparation needs its separate exact suite and scope, without fault admission')
        kinds += ('legacy-history-preparation',)
    return kinds
