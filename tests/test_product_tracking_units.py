"""Pure L4 fixture and native-boundary tests. Never opens a browser or server."""
from datetime import date
from copy import deepcopy
import csv
import io
from types import SimpleNamespace

import pytest

from scripts.product_first_use_audit import HEADERS, HarnessContractError
from scripts.product_tracking_units import fixture_csv, frozen, last_closed_quarter, one, tracking_units_outcome


@pytest.mark.parametrize('today,period',[(date(2026,1,1),'2025-Q4'),(date(2026,3,31),'2025-Q4'),
    (date(2026,4,1),'2026-Q1'),(date(2026,7,1),'2026-Q2'),(date(2026,10,5),'2026-Q3'),(date(2026,12,31),'2026-Q3')])
def test_fixture_uses_latest_completed_quarter_not_current_or_future(today,period):
    assert last_closed_quarter(today)==period


def template():
    out=io.StringIO();csv.writer(out).writerow(HEADERS);return out.getvalue().encode('utf-8-sig')


def test_actual_template_header_is_retained_and_optional_values_remain_missing():
    blob=fixture_csv(template(),'2026-Q3')
    reader=csv.DictReader(io.StringIO(blob.decode('utf-8-sig')))
    rows=list(reader);assert reader.fieldnames==HEADERS and len(rows)==1
    expected={'季度':'2026-Q3','营业收入':'100000','营业成本':'80000','净利润':'5000','经营现金流':'12345.67'}
    assert rows[0]=={key:expected.get(key,'') for key in HEADERS}


@pytest.mark.parametrize('bad',[b'period,revenue\n',b'\xef\xbb\xbf'+','.join(HEADERS).encode()+b'\nextra,data\n'])
def test_changed_or_populated_download_is_rejected(bad):
    with pytest.raises(AssertionError,match='header and zero data'):
        fixture_csv(bad,'2026-Q3')


def test_frozen_record_ignores_only_current_impact_and_is_deep_copied():
    old={'id':'saved','version':1,'payload':{'threshold':.25},'source_impact':{'state':'current'}}
    value=frozen(old);assert value=={'id':'saved','version':1,'payload':{'threshold':.25}}
    old['payload']['threshold']=.15;assert value['payload']['threshold']==.25
    assert value!=frozen(old)


def test_record_selection_rejects_missing_and_duplicate_matches():
    assert one([{'id':'original'}],lambda row:row['id']=='original')=={'id':'original'}
    for rows in [[],[{'id':'original'},{'id':'original'}]]:
        with pytest.raises(AssertionError):one(rows,lambda row:row['id']=='original')


def test_direct_l4_entry_rejects_local_environment_before_mutation(tmp_path,monkeypatch):
    monkeypatch.delenv('GITHUB_ACTIONS',raising=False)
    with pytest.raises(HarnessContractError,match='Local browser execution is restricted'):
        tracking_units_outcome(SimpleNamespace(),repository_root=tmp_path,data_dir=tmp_path,
                               expected_web_tree='a'*40,expected_server_tree='b'*40)
