"""Pure decision-boundary tests. No browser, listener or UI success claim."""
import pytest
from scripts.product_browser_audit import Probe

MESSAGE='当前输入尚未保存。离开后这些修改将丢失，是否继续？'
class Dialog:
    def __init__(self,type='confirm',message=MESSAGE):
        self.type,self.message=type,message;self.accepted=0;self.dismissed=0
    def accept(self):self.accepted+=1
    def dismiss(self):self.dismissed+=1

def handler(probe,dialog,unexpected):
    if probe.handle_expected_dialog(dialog):return
    unexpected.append(dialog.message);dialog.dismiss()

def test_only_exact_declared_single_confirmation_is_accepted_and_cleaned(tmp_path):
    p=Probe(None,'unused',tmp_path,None);d=Dialog();unexpected=[]
    value=p.with_expected_dialog(dialog_type='confirm',message=MESSAGE,action=lambda:(handler(p,d,unexpected),'continued')[1])
    assert value=='continued' and d.accepted==1 and d.dismissed==0 and not unexpected
    assert p._expected_dialog is None and p.observations['expected_dialogs'][0]['accepted']==1
    observed=p.observations['expected_dialogs'][0]
    assert observed['started_at']<=observed['events'][0]['observed_at']<=observed['events'][0]['accepted_at']<=observed['finished_at']
    assert observed['events'][0]['message_matches'] is True and observed['events'][0]['accepted'] is True
    later=Dialog();handler(p,later,unexpected)
    assert later.accepted==0 and later.dismissed==1

@pytest.mark.parametrize('type,message',[('alert',MESSAGE),('confirm','其他操作确认'),('confirm',MESSAGE+' extra')])
def test_mismatching_actual_dialog_is_dismissed_and_the_task_fails(tmp_path,type,message):
    p=Probe(None,'unused',tmp_path,None);d=Dialog(type,message);unexpected=[]
    with pytest.raises(AssertionError):
        p.with_expected_dialog(dialog_type='confirm',message=MESSAGE,action=lambda:handler(p,d,unexpected))
    assert d.accepted==0 and d.dismissed==1 and unexpected and p._expected_dialog is None


def test_duplicate_confirmation_is_never_accepted_twice(tmp_path):
    p=Probe(None,'unused',tmp_path,None);first,second=Dialog(),Dialog();unexpected=[]
    with pytest.raises(AssertionError):
        p.with_expected_dialog(dialog_type='confirm',message=MESSAGE,action=lambda:[handler(p,d,unexpected) for d in (first,second)])
    assert first.accepted==1 and second.accepted==0 and second.dismissed==1
    assert p._expected_dialog is None and p.observations['expected_dialogs'][0]['seen']==2


def test_missing_dialog_or_failed_action_clears_the_expectation(tmp_path):
    p=Probe(None,'unused',tmp_path,None)
    with pytest.raises(AssertionError):p.with_expected_dialog(dialog_type='confirm',message=MESSAGE,action=lambda:None)
    assert p._expected_dialog is None
    def failed():raise RuntimeError('synthetic action failure')
    with pytest.raises(RuntimeError,match='synthetic action'):
        p.with_expected_dialog(dialog_type='confirm',message=MESSAGE,action=failed)
    assert p._expected_dialog is None


def test_other_requested_decisions_and_nested_scope_are_rejected_before_acceptance(tmp_path):
    p=Probe(None,'unused',tmp_path,None)
    with pytest.raises(ValueError):p.with_expected_dialog(dialog_type='confirm',message='删除所有数据？',action=lambda:None)
    with pytest.raises(RuntimeError,match='nested'):
        p.with_expected_dialog(dialog_type='confirm',message=MESSAGE,
            action=lambda:p.with_expected_dialog(dialog_type='confirm',message=MESSAGE,action=lambda:None))
    assert p._expected_dialog is None
