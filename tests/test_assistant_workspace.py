"""Read-only assistant and perspective checks use only synthetic isolated inputs."""
from conftest import Actor


def test_assistant_traces_saved_inputs_without_claiming_causality(actor):
    d=actor.dataset()
    r=actor.post('/workspace/assistant',json={'query':'为什么毛利率和现金流变化？','dataset_id':d['id']})
    assert r.status_code==200,r.text
    body=r.json();facts={f['id']:f for f in body['facts']}
    assert body['external_calls']==0 and '不能单独证明原因' in body['answer']
    assert body['scope']['dataset_version']==d['version']
    assert body['scope']['input_hash']==d['content_hash']
    assert facts['gross_margin']['formula']=='(收入−成本)/收入'
    assert {'revenue','cost'}=={x['path'].split('/')[-1] for x in facts['gross_margin']['inputs']}
    assert facts['cash_ratio']['trend'][-1]['value']==facts['cash_ratio']['value']
    assert d['payload']['verification']=='unverified_user_input'
    assert all(f['dataset_id']==d['id'] and f['verification']==d['payload']['verification'] for f in facts.values())


def test_assistant_scope_requires_selection_and_rejects_foreign_dataset(actor,client):
    first=actor.dataset();second=actor.dataset();other=Actor(client);foreign=other.dataset()
    ambiguous=actor.post('/workspace/assistant',json={'query':'查看现金流'}).json()
    assert '多个数据集' in ambiguous['answer'] and ambiguous['facts']==[]
    assert actor.post('/workspace/assistant',json={'query':'查看现金流','dataset_id':foreign['id']}).status_code==404
    selected=actor.post('/workspace/assistant',json={'query':'查看现金流','dataset_id':second['id']}).json()
    assert all(f['dataset_id']==second['id'] for f in selected['facts'])
    assert selected['scope']['dataset_id']!=foreign['id'] and first['id']!=second['id']


def test_role_switch_is_versioned_preference_not_permission(actor,client):
    other=Actor(client);initial=actor.user['version']
    changed=actor.put('/preferences/role',json={'role':'analyst','version':initial})
    assert changed.status_code==200,changed.text
    assert changed.json()['user']['preferences']['role']=='analyst'
    assert changed.json()['user']['version']==initial+1
    assert actor.put('/preferences/role',json={'role':'advisor','version':initial}).status_code==409
    assert actor.put('/preferences/role',json={'role':'admin','version':initial+1}).status_code==422
    assert other.get('/auth/me').json()['user']['preferences']['role']=='enterprise'
    assert actor.post('/workspace/assistant',json={'query':'诊断'}).json()['followups'][0].startswith('哪些指标')
