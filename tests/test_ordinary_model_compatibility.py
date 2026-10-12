"""400 old-calculator outputs recorded before the recovered boundary revision.

Golden generation used the actual recovered v8 model bytes, SHA256
 d4b98e8b0912dcbc18fa1f6f712b06afcef54d724435237f5095093107f15047.
The recovery baseline tree is 02496dc63abaf765b688b1fd7f2652f9420ae22c.
This is normal-formula compatibility, not empirical model calibration.
"""
import copy
from datetime import date
import hashlib
import json
from pathlib import Path
import random
from server.models import calculate, normalize
from server.schemas import Dataset
from server.store import encode


def test_400_ordinary_results_match_actual_old_calculator_golden():
    seed=json.loads((Path(__file__).parent/'fixtures/synthetic-financial.json').read_text())
    seed['source_kind']='user_provided';rng=random.Random(57);golden=hashlib.sha256();count=0
    for index in range(200):
        value=copy.deepcopy(seed)
        for period in value['periods']:
            for key in sorted(period):
                if isinstance(period[key],(int,float)) and not isinstance(period[key],bool):
                    period[key]=rng.uniform(0,5) if key=='industry_volatility' else period[key]*rng.uniform(.01,100)
            if index%5==0:period['net_profit']=None
            if index%7==0 and period.get('cash_flow') is not None:period['cash_flow']=-abs(period['cash_flow'])
        data=normalize(Dataset.model_validate(value))
        for comparison in ('year_over_year','previous'):
            golden.update(encode(calculate(data,comparison,today=date(2026,10,1))).encode()+b'\n');count+=1
    assert count==400
    assert golden.hexdigest()=='b1e6f3e880eda90cfa7a67410f34c47f0b0a551af893f47205fa682d52b952bf'
