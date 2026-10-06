"""Source withdrawal/content mismatch must block each not-yet-sent call."""
import pytest
from source_binding_cases import case

CHANGES=('review_scope','dataset_payload','evidence_text','memory_scope','profile_payload','preferences_payload')

@pytest.mark.parametrize('adaptive',[False,True],ids=['ordinary','adaptive'])
@pytest.mark.parametrize('change',CHANGES)
@pytest.mark.parametrize('stage',['before_approval','after_approval','at_first_send','after_first_call'])
def test_every_dispatch_boundary_rechecks_full_source(change,stage,adaptive):
    result=case(change,stage,adaptive)
    assert result['stub_calls']==(1 if stage=='after_first_call' else 0),result
    if stage=='before_approval':assert result['approval_status']==409,result
    else:
        assert result['snapshot_unchanged'],result
        if stage=='at_first_send':assert result['dispatch_events']==0,result

@pytest.mark.parametrize('change',(*CHANGES,'comparison_peer_payload'))
def test_resume_reuses_history_without_new_source_authority(change):
    result=case(change,'resume_after_first',True)
    assert result['stub_calls']==1 and result['reused_checkpoint_count']>=5,result
    assert result['snapshot_unchanged'],result

@pytest.mark.parametrize('stage',['before_approval','after_approval','at_first_send','after_first_call'])
def test_every_comparison_member_must_still_match_its_content_hash(stage):
    result=case('comparison_peer_payload',stage,True)
    assert result['stub_calls']==(1 if stage=='after_first_call' else 0),result
    if stage=='before_approval':assert result['approval_status']==409,result

@pytest.mark.parametrize('adaptive',[False,True],ids=['ordinary','adaptive'])
@pytest.mark.parametrize('change',['dataset_payload','evidence_text','evidence_chunk'])
def test_preview_does_not_freeze_inconsistent_inputs(change,adaptive):
    result=case(change,'before_preview',adaptive)
    assert result['preview_status']==409 and result['stub_calls']==0,result

@pytest.mark.parametrize('adaptive',[False,True],ids=['ordinary','adaptive'])
def test_healthy_sources_remain_usable_without_snapshot_rewrites(adaptive):
    result=case('unchanged','at_first_send',adaptive)
    assert result['stub_calls']==2 and result['snapshot_unchanged'],result
    assert result['report_integrity']['valid'],result

@pytest.mark.parametrize('adaptive',[False,True],ids=['ordinary','adaptive'])
@pytest.mark.parametrize('change',['review_scope','memory_scope','preferences_payload'])
def test_new_preview_can_use_legitimate_current_scope_without_old_source(change,adaptive):
    result=case(change,'before_preview',adaptive)
    assert result['preview_status']==201 and result['approval_status']==202 and result['stub_calls']==2,result
    counts=result['sent_citation_counts'] if change=='review_scope' else result['sent_memory_counts']
    assert counts==[0,0],result


@pytest.mark.parametrize('adaptive',[False,True],ids=['ordinary','adaptive'])
@pytest.mark.parametrize('change',['review_unset','review_global','review_note','review_stance','review_expiry','review_rejected',
                                  'memory_identity','memory_role','memory_text','memory_expiry','memory_approval','evidence_metadata'])
def test_all_scope_and_review_fields_gate_the_next_actual_send(change,adaptive):
    result=case(change,'after_first_call',adaptive)
    assert result['stub_calls']==1 and result['snapshot_unchanged'],result

@pytest.mark.parametrize('adaptive',[False,True],ids=['ordinary','adaptive'])
@pytest.mark.parametrize('change',['identity_permission','identity_payload','plan_context','run_context'])
def test_existing_owner_plan_and_identity_controls_are_not_weakened(change,adaptive):
    result=case(change,'after_approval',adaptive)
    assert result['stub_calls']==0,result

@pytest.mark.parametrize('change',['experiment_payload','comparison_payload'])
def test_existing_saved_artifact_controls_remain_fail_closed(change):
    result=case(change,'resume_after_first',True)
    assert result['stub_calls']==1 and result['snapshot_unchanged'],result


@pytest.mark.parametrize('adaptive',[False,True],ids=['ordinary','adaptive'])
def test_identity_effective_role_is_used_without_rejecting_healthy_preferences(adaptive):
    result=case('identity_healthy','at_first_send',adaptive)
    assert result['stub_calls']==2 and result['snapshot_unchanged'],result

@pytest.mark.parametrize('adaptive',[False,True],ids=['ordinary','adaptive'])
@pytest.mark.parametrize('stage',['before_approval','after_first_call'])
def test_identity_does_not_override_account_memory_revocation(adaptive,stage):
    result=case('identity_preferences',stage,adaptive)
    assert result['stub_calls']==(1 if stage=='after_first_call' else 0),result

@pytest.mark.parametrize('adaptive',[False,True],ids=['ordinary','adaptive'])
@pytest.mark.parametrize('change',['api_dataset','api_review','api_memory','api_profile','api_preferences'])
def test_normal_versioned_user_changes_still_stop_undispatched_work(change,adaptive):
    result=case(change,'after_first_call',adaptive)
    assert result['stub_calls']==1 and result['snapshot_unchanged'],result
