"""Read-only checks of a report's recorded evidence, not its current relevance.

Studio reports have independently stored outputs and event anchors. New /runs
reports anchor their whole-output digest in the terminal event without creating
studio artifacts. Older /runs records have neither: their context/ledger checks
remain useful but do not independently verify the legacy report's whole output.
These local hashes detect inconsistency, not a database administrator rewriting
all of the evidence, and do not certify the business conclusions.
"""
from __future__ import annotations

from .store import digest
from . import workspace_store as ws


def inspect_report_integrity(store, run):
    snapshot = run['snapshot'] if isinstance(run.get('snapshot'), dict) else {}
    result = run['result'] if isinstance(run.get('result'), dict) else {}
    unpublished = run.get('result') is None and run['state'] not in {'succeeded', 'degraded'}
    artifacts = store.all('SELECT * FROM agent_artifacts WHERE run_id=? ORDER BY created_at,id', (run['id'],))
    trace = store.all('SELECT * FROM run_events WHERE run_id=? ORDER BY seq', (run['id'],))
    ledger = ws.verify_ledger(store, run['id'])
    valid_events = [e for e in trace if isinstance(e['payload'], dict)]
    completed = [e for e in valid_events if e['type'] == 'step_completed']
    # Independent studio markers prevent missing artifacts from silently opting
    # an existing studio report into the weaker, artifact-free legacy contract.
    studio = bool(snapshot.get('studio') or result.get('plan') or result.get('adaptive') or artifacts
                  or any(e['payload'].get('artifact_id') or e['payload'].get('output_hash') for e in completed))
    by_id = {a['id']: a for a in artifacts}
    for artifact in artifacts:
        anchors = [e for e in completed if e['payload'].get('artifact_id') == artifact['id']]
        artifact['integrity_valid'] = artifact['content_hash'] == digest(artifact['payload'])
        artifact['event_anchor_valid'] = (len(anchors) == 1
            and anchors[0]['payload'].get('output_hash') == artifact['content_hash']
            and anchors[0]['payload'].get('node') == artifact['node'])
    final = [a for a in artifacts if a['node'] == 'report']
    report_hash_valid = None if unpublished or not final else bool(len(final) == 1 and result and digest(result) == final[0]['content_hash'])
    snapshot_hash = digest(run.get('snapshot'))
    snapshot_hash_valid = None if unpublished else bool(result and result.get('snapshot_hash') == snapshot_hash)
    data_hash_valid = (isinstance(snapshot.get('dataset'), dict)
                       and digest(snapshot['dataset']) == snapshot.get('dataset_hash'))
    dataset_binding_valid = bool(result and result.get('dataset_id') == run['dataset_id']
        and result.get('dataset_version') == snapshot.get('dataset_version')
        and result.get('dataset_hash') == snapshot.get('dataset_hash'))
    report_steps = [e for e in completed if e['payload'].get('node') == 'report']
    terminal = [e for e in valid_events if e['type'] == run['state'] and e['payload'].get('report_ready') is True]
    if not studio and not unpublished:
        # Presence is intentional: a blank or malformed recorded hash fails,
        # whereas an authentic older terminal event has no such field at all.
        hashes = [e['payload']['report_hash'] for e in terminal if 'report_hash' in e['payload']]
        if hashes:
            report_hash_valid = bool(result and all(h == digest(result) for h in hashes))
    completion_valid = (run['state'] in {'succeeded', 'degraded'} and len(report_steps) == 1
                        and bool(terminal) and terminal[-1]['seq'] > report_steps[0]['seq'])
    failures = []
    if not result: failures.append('report_missing')
    if len(valid_events) != len(trace): failures.append('event_structure')
    if not ledger['valid']: failures.append('event_ledger')
    if snapshot_hash_valid is False: failures.append('snapshot_hash')
    if not data_hash_valid: failures.append('dataset_hash')
    if not dataset_binding_valid: failures.append('dataset_binding')
    if not completion_valid: failures.append('report_completion')
    if report_hash_valid is False: failures.append('report_hash')
    if studio:
        if len(final) != 1: failures.append('final_artifact_missing_or_ambiguous')
        if any(not a['integrity_valid'] for a in artifacts): failures.append('artifact_hash')
        if any(not a['event_anchor_valid'] for a in artifacts): failures.append('artifact_anchor')
        # Check both directions: deleting an artifact must not make the remaining
        # set pass, and an event with an absent/mismatched output is not evidence.
        if any(not isinstance(e['payload'].get('artifact_id'), str)
               or not (a := by_id.get(e['payload'].get('artifact_id')))
               or e['payload'].get('output_hash') != a['content_hash']
               or e['payload'].get('node') != a['node'] for e in completed):
            failures.append('event_artifact')
    return {'report_integrity': {'valid': not failures, 'format': 'studio' if studio else 'legacy',
                                'failures': failures},
            'ledger': ledger, 'artifacts': artifacts, 'trace': trace,
            'snapshot_hash': snapshot_hash, 'snapshot_hash_valid': snapshot_hash_valid,
            'report_hash_valid': report_hash_valid, 'data_hash_valid': data_hash_valid}
