"""Record the held L9 Linux job without retrying a denied browser download."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ENV_FIELDS = ('GITHUB_SHA', 'GITHUB_EVENT_NAME', 'GITHUB_RUN_ID',
              'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'RUNNER_OS')
ORIGINAL_DENIAL = {
    'head_commit': '80477de95cb4d38b96c1a31c3686ac3233c55504',
    'checked_out_commit': 'cd9dc9290177414991f93feb013c3e4805b6d456',
    'run_id': '37426800700',
    'job_id': '112148191641',
    'job_url': 'https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/actions/runs/37426800700/job/112148191641',
    'observed_at': '2026-10-06T07:13:51.1436028Z',
    'download_status': 403,
    'provider_code': 'AccessDenied',
    'provider_message': "We're sorry, but this service is not available in your location",
    'resource': 'https://cdn.playwright.dev/builds/chromium/1200/chromium-headless-shell-linux.zip',
    'summary_artifact_id': 11395602461,
    'summary_sha256': '1f6362d972987cf1484ff39043cfde770951a8de620f1de510e055cc26fe4304',
}


def write_blocked(out, current, *, commit, tree):
    """The caller supplies this invocation's actual environment and Git identity."""
    if (current.get('GITHUB_JOB') != 'product-strategy-consent'
            or current.get('RUNNER_OS') != 'Linux'
            or current.get('GITHUB_EVENT_NAME') not in ('push', 'pull_request', 'workflow_dispatch')
            or not re.fullmatch('[0-9a-f]{40}', commit)
            or not re.fullmatch('[0-9a-f]{40}', tree)
            or current.get('GITHUB_SHA') != commit
            or not re.fullmatch('[1-9][0-9]*', current.get('GITHUB_RUN_ID', ''))
            or not re.fullmatch('[1-9][0-9]*', current.get('GITHUB_RUN_ATTEMPT', ''))):
        raise ValueError('The access hold belongs only to the identified L9 Linux job.')
    receipt = {
        'schema': 'lidian-native-access-block-v1', 'suite': 'strategy-consent',
        'status': 'blocked', 'complete': False, 'all_checks_passed': False,
        'native_started': False, 'browser_download_attempted': False, 'exit_code': 1,
        'recorded_at': datetime.now(timezone.utc).isoformat(),
        'current_run': {**{k: current[k] for k in ENV_FIELDS},
                        'checked_out_commit': commit, 'tree': tree},
        'original_denial': dict(ORIGINAL_DENIAL),
        'reason': '原L9 Linux浏览器下载被服务商明确地域拒绝；本次保持停止，不重试下载或运行原生验收。',
        'acceptance_limit': '此项受阻，不是通过；其他任务的结果不能代替本项。',
    }
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    path = out / 'product-strategy-consent-access-blocked.json'
    path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return receipt


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('This command records only the hosted L9 Linux access hold.')
    current = {k: os.environ.get(k, '') for k in ENV_FIELDS}
    def git(value):
        return subprocess.check_output(['git', 'rev-parse', value], cwd=ROOT,
                                       text=True, timeout=5).strip()
    receipt = write_blocked(ROOT / 'evidence', current, commit=git('HEAD'), tree=git('HEAD^{tree}'))
    print(receipt['reason'] + receipt['acceptance_limit'], flush=True)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
