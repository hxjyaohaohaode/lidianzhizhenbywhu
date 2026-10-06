from __future__ import annotations
import contextlib
import copy
import json
import uuid
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from server.app import make_app
from server.config import Settings
from server.security import COOKIE

PASSWORD='Independent-password-2026'
class Actor:
    def __init__(self,client,email=None):
        self.client=client;self.email=email or f'{uuid.uuid4().hex}@test.example';self.password=PASSWORD
        r=client.post('/api/auth/register',json={'email':self.email,'password':self.password,'name':'测试研究员'},headers={'Cookie':''})
        assert r.status_code==201,r.text
        self.user=r.json()['user'];self.csrf=r.json()['csrf'];self.token=r.cookies[COOKIE]
    def call(self,method,path,**kwargs):
        headers={'Cookie':f'{COOKIE}={self.token}','X-CSRF-Token':self.csrf,**kwargs.pop('headers',{})}
        return self.client.request(method,'/api'+path,headers=headers,**kwargs)
    def get(self,path,**kwargs):return self.call('GET',path,**kwargs)
    def post(self,path,**kwargs):return self.call('POST',path,**kwargs)
    def put(self,path,**kwargs):return self.call('PUT',path,**kwargs)
    def delete(self,path,**kwargs):return self.call('DELETE',path,**kwargs)
    def dataset(self):
        data=json.loads((Path(__file__).parents[0]/'fixtures/synthetic-financial.json').read_text(encoding='utf-8'))
        # Synthetic inputs remain isolated fixtures; exercise the user import contract.
        data['source_kind']='user_provided'
        r=self.post('/datasets',json=data);assert r.status_code==201,r.text;return r.json()
    def evidence_ref(self,document):
        response=self.get('/workspace/evidence');assert response.status_code==200,response.text
        selected=next(row for row in response.json()['items'] if row['id']==document['id'])
        return {key:selected[key] for key in ('id','version','content_hash','review_version','review_hash')}
    def conversation(self,**fields):
        r=self.post('/conversations',json={'title':'测试会话',**fields});assert r.status_code==201,r.text;return r.json()
    def run(self,dataset=None,session=None,key=None,**fields):
        dataset=dataset or self.dataset();session=session or self.conversation()
        # Legacy worker unit tests deliberately inject an already-authorized fixture row.
        # The production /runs API never enables external models; workspace plan tests
        # exercise the actual approval API separately, without this fixture helper.
        model=fields.get('use_llm',False)
        response=self.post('/runs',json={'dataset_id':dataset['id'],'session_id':session['id'],'query':'分析毛利率和现金流风险',**fields,'use_llm':False if model else fields.get('use_llm',False)},headers={'Idempotency-Key':key or uuid.uuid4().hex})
        if model and response.status_code==202:
            row=response.json();row['payload']['use_llm']=True
            from server.store import encode
            with self.client.app.state.store.transaction() as db:
                db.execute('UPDATE runs SET payload=? WHERE id=?',(encode(row['payload']),row['id']))
            return self.get('/runs/'+row['id'])
        return response
    def execute(self,run):
        self.client.portal.call(self.client.app.state.worker.execute,run['id']);return self.get('/runs/'+run['id']).json()

@pytest.fixture
def factory(tmp_path):
    with contextlib.ExitStack() as stack:
        index=0
        def build(providers=None,worker=False,**kwargs):
            nonlocal index
            index+=1;settings=Settings(data_dir=tmp_path/str(index),origin='http://testserver',**kwargs)
            app=make_app(settings,providers=providers,worker_enabled=worker)
            return stack.enter_context(TestClient(app,raise_server_exceptions=False))
        yield build
@pytest.fixture
def client(factory):return factory()
@pytest.fixture
def actor(client):return Actor(client)
@pytest.fixture
def example():return json.loads((Path(__file__).parents[0]/'fixtures/synthetic-financial.json').read_text(encoding='utf-8'))
def editable(row):
    p=copy.deepcopy(row['payload']);p.pop('verification',None);p.pop('input_amount_unit',None);p['version']=row['version'];return p


def dataset_ref(row):
    """The exact viewed fixture revision, never a fresh read during submission."""
    return {'kind':'dataset','dataset_version':row['version'],'dataset_hash':row['content_hash']}
