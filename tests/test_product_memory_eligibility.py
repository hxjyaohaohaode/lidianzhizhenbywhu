"""Pure I8 helper contracts; never starts browser, server or socket."""
from copy import deepcopy
from types import SimpleNamespace
import pytest
from scripts.product_first_use_audit import HarnessContractError
from scripts.product_memory_eligibility import memory_preference_withdrawal, unchanged, changed, one


def test_direct_memory_journey_stops_before_local_mutation(tmp_path,monkeypatch):
    monkeypatch.delenv('GITHUB_ACTIONS',raising=False)
    with pytest.raises(HarnessContractError,match='Local browser execution is restricted'):
        memory_preference_withdrawal(SimpleNamespace(),repository_root=tmp_path,data_dir=tmp_path,
            expected_web_tree='a'*40,expected_server_tree='b'*40)


@pytest.mark.parametrize('key',['id','user_id','kind','natural_key','payload','version','created_at','updated_at'])
def test_original_entity_guard_rejects_changes_to_each_saved_field(key):
    old={'id':'id','user_id':'owner','kind':'watch','natural_key':'key','payload':{'threshold':.1},
         'version':1,'created_at':'before','updated_at':'before'}
    row={**deepcopy(old),'source_impact':{'state':'changed'}}
    unchanged(row,old)
    row[key]='different'
    with pytest.raises(AssertionError,match='Saved original changed'):unchanged(row,old)


def test_memory_reason_must_be_non_current_and_explain_the_actual_dependency():
    good={'source_impact':{'state':'changed','reasons':[{'code':'memory_withdrawn','message':'原记忆当前不再适用'}]}}
    assert changed(good)=='原记忆当前不再适用'
    for state in ['current','unknown','unavailable']:
        row=deepcopy(good);row['source_impact']['state']=state
        with pytest.raises(AssertionError):changed(row)
    row=deepcopy(good);row['source_impact']['reasons'][0]['code']='dataset_changed'
    with pytest.raises(AssertionError):changed(row)


def test_exact_saved_id_is_unique_and_not_selected_by_changed_title():
    row={'id':'kept','payload':{'title':'原始问题'}}
    assert one([row,{'id':'other'}],'kept')==row
    for rows in [[],[row,row]]:
        with pytest.raises(AssertionError):one(rows,'kept')
