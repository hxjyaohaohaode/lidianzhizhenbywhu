"""Clear only known generated CI outputs, never historical or business data."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform

ROOT=Path(__file__).resolve().parents[1]
REPORTS=('verification.json','full-chain-http.json','native-service-browser.json',
    'native-service-command.json','service-browser-check.json','bridge-service-command.json',
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
