"""Clear only known generated CI outputs, never historical or business data."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform

ROOT=Path(__file__).resolve().parents[1]
REPORTS=('verification.json','full-chain-http.json','native-service-browser.json',
    'native-service-command.json','service-browser-check.json','bridge-service-command.json',
    'product-browser-audit.json','product-audit-service-command.json','product-audit-transfer-status.json',
    'product-first-use-audit.json','product-first-use-service-command.json','product-first-use-transfer-status.json',
    'product-integrity-audit.json','product-integrity-service-command.json','product-integrity-transfer-status.json',
    'product-tracking-integrity-audit.json','product-tracking-integrity-service-command.json','product-tracking-integrity-transfer-status.json',
    'product-source-integrity-audit.json','product-source-integrity-service-command.json','product-source-integrity-transfer-status.json',
    'product-comparison-integrity-audit.json','product-comparison-integrity-service-command.json','product-comparison-integrity-transfer-status.json',
    'product-plan-history-audit.json','product-plan-history-service-command.json','product-plan-history-transfer-status.json',
    'product-tracking-units-audit.json','product-tracking-units-service-command.json','product-tracking-units-transfer-status.json',
    'product-memory-eligibility-audit.json','product-memory-eligibility-service-command.json','product-memory-eligibility-transfer-status.json',
    'product-report-export-audit.json','product-report-export-service-command.json','product-report-export-transfer-status.json',
    'product-question-scope-audit.json','product-question-scope-service-command.json','product-question-scope-transfer-status.json',
    'product-experiment-recovery-audit.json','product-experiment-recovery-service-command.json','product-experiment-recovery-transfer-status.json',
    'product-strategy-consent-audit.json','product-strategy-consent-service-command.json','product-strategy-consent-transfer-status.json',
    'product-report-history-audit.json','product-report-history-service-command.json','product-report-history-transfer-status.json',
    'product-late-actions-audit.json','product-late-actions-service-command.json','product-late-actions-transfer-status.json',
    'product-action-evidence-audit.json','product-action-evidence-service-command.json','product-action-evidence-transfer-status.json',
    'product-copilot-integrity-audit.json','product-copilot-integrity-service-command.json','product-copilot-integrity-transfer-status.json',
    'product-historical-warning-audit.json','product-historical-warning-service-command.json','product-historical-warning-transfer-status.json',
    'source-guard.json','pytest.xml','pytest-progress.jsonl')


def prepare(root=ROOT):
    out=root/'evidence';out.mkdir(exist_ok=True)
    targets={out/name for name in REPORTS}
    targets.update(out.glob('ui-current-*.png'))
    targets.update(out.glob('*.log'))
    targets.update(out.glob('*-browser-events.jsonl'))
    targets.update(out.glob('*-process-events.jsonl'))
    removed=[]
    for path in sorted(targets):
        if path.is_file() or path.is_symlink():
            path.unlink();removed.append(path.name)
    receipt={'started_at':datetime.now(timezone.utc).isoformat(),
        'commit':os.getenv('GITHUB_SHA',''),'run_id':os.getenv('GITHUB_RUN_ID',''),
        'run_attempt':os.getenv('GITHUB_RUN_ATTEMPT',''),'platform':platform.platform(),
        'cleared_outputs':removed,
        'boundary':'Only subsequent outputs belong to this attempt. A missing report means that stage produced no result, not that it passed.'}
    (out/'run-context.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return receipt


if __name__=='__main__':print(json.dumps(prepare(),ensure_ascii=False))
