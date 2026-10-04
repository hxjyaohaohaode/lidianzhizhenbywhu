import copy
import hashlib
import json
from pathlib import Path
import unittest
from scripts.product_readout_oracles import expect_first_use_readout, expect_reader_first_markdown, canonical_hash, expect_old_report_unchanged

class Oracles(unittest.TestCase):
    def setUp(self):
        self.csv=b'Explicit synthetic CSV, not real financial data'
        self.receipt={'dataset_version':1,'import_context':{'synthetic':True}}
        self.saved={'id':'synthetic-id','version':1,'payload':{'periods':[{'period':'2024-Q1','cost':80000,'cash_flow':None}]}}
        self.saved['content_hash']=canonical_hash(self.saved['payload'])
        self.source={'status':'recorded','dataset_id':self.saved['id'],'dataset_version':1,'dataset_hash':self.saved['content_hash'],
            'receipt_hash':canonical_hash(self.receipt),'file':{'name':'corrected.csv','sha256':hashlib.sha256(self.csv).hexdigest(),'bytes':len(self.csv)},'input_amount_unit':'wan','input_basis':'standalone_quarter','confirmed_at':'synthetic-time'}
        self.result={'readout':{'schema_version':1,'scope_recorded':True,'period':'2024-Q1','amount_unit':'yuan','input_source':self.source,
            'facts':[{'id':'gross_margin','unit':'ratio','status':'available','value':.2,'formula':'(收入−成本)/收入','inputs':[{'path':'periods/2024-Q1/revenue','value':100000,'unit':'CNY'},{'path':'periods/2024-Q1/cost','value':80000,'unit':'CNY'}]},
                     {'id':'cash_flow','label':'经营现金流','unit':'CNY','status':'missing','value':None,'reason':'未提供金额'},
                     {'id':'cash_ratio','unit':'ratio','status':'missing','value':None,'reason':'缺少现金流'}],
            'next_steps':[{'period':'2024-Q1','fields':['cash_flow'],'conditional':False,'action':'补充同口径现金流'}]}}
    def check(self): return expect_first_use_readout(self.result,self.saved,self.receipt,self.csv,'corrected.csv')
    def test_accepts_explicit_correct_fixture(self): self.check()
    def test_rejects_null_as_zero(self):
        self.result['readout']['facts'][1]['value']=0
        with self.assertRaises(AssertionError):self.check()
    def test_rejects_latest_file_false_attribution(self):
        self.source['file']['name']='later-Q2-only.csv'
        with self.assertRaises(AssertionError):self.check()
    def test_rejects_raw_ratio_mislabeled_percent(self):
        self.result['readout']['facts'][0]['value']=20
        with self.assertRaises(AssertionError):self.check()
    def test_reader_first_rejects_original_real_download(self):
        path=Path(__file__).parent/'fixtures/legacy-first-use-report-00310c1d.md'
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),'fbf4b0f3d8e2dcb59d7b9bbbc758ccd86e803d226eb777f45319a0e3650f0768')
        with self.assertRaises(AssertionError):expect_reader_first_markdown(path.read_bytes(),file_name='L1-synthetic-corrected.csv',file_hash='unused')
    def test_reader_first_allows_equivalent_plain_wording(self):
        text=('## 本次问题的回答\n2024-Q1 毛利率20.00%，经营现金流未提供\n## 输入来源与保存范围\ncorrected.csv HASH 原单位万元，独立单季，未经独立核验\n## 下一步需要补充什么\n补同季度现金流\n## 技术附录\n```json\n{}\n```')
        expect_reader_first_markdown(text.encode(),file_name='corrected.csv',file_hash='HASH')
    def test_saved_result_unchanged_allows_truthful_current_context(self):
        result={**self.result,'dataset_version':1,'dataset_hash':self.saved['content_hash'],'lineage':[{'id':'gross_margin','value':.2,'inputs':[{'path':'periods/2024-Q1/cost','value':80000}]}]}
        before={**copy.deepcopy(result),'export_context':{'stale':False}}
        after={**copy.deepcopy(result),'export_context':{'stale':True}}
        current={'version':2,'content_hash':'changed','payload':{'periods':[{'period':'2024-Q1','cost':70000,'cash_flow':None}]}}
        expect_old_report_unchanged(json.dumps(before),json.dumps(after),{'result':result},current)
        after['readout']['input_source']['file']['name']='current-file.csv'
        with self.assertRaises(AssertionError):expect_old_report_unchanged(json.dumps(before),json.dumps(after),{'result':result},current)

if __name__=='__main__':unittest.main()
