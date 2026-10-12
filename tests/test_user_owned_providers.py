"""User-owned model selection; all credentials/data below are isolated fixtures."""
import pytest
from conftest import Actor
from server.connections import scoped_providers
from server.providers import ProviderService
from test_services import connection, ok

LEGACY_IDS = ('deepseek', 'qwen', 'glm', 'mimo')

@pytest.fixture
def configured_legacy_environment(monkeypatch):
    for name in LEGACY_IDS:
        monkeypatch.setenv(name.upper()+'_API_KEY', 'FIXTURE-IGNORED-LEGACY-CREDENTIAL')
        monkeypatch.setenv(name.upper()+'_MODEL', 'fixture-ignored-legacy-model')


def test_legacy_environment_never_populates_production_registry(configured_legacy_environment):
    service = ProviderService()
    assert service.providers == {} and service.status() == []
    assert service.select() is None
    assert all(service.select(name) is None for name in LEGACY_IDS)


def test_empty_accounts_never_expose_or_select_legacy_models(factory, configured_legacy_environment):
    actor = Actor(factory())
    service = actor.client.app.state.providers
    scoped = scoped_providers(service, actor.user['id'])
    assert ok(actor.get('/services/connections'))['items'] == []
    assert scoped.status() == [] and scoped.select() is None
    assert all(scoped.select(name) is None for name in LEGACY_IDS)
    assert service.vault.catalog(actor.user['id']) == []


def test_saved_private_connections_survive_without_server_fallback(factory, configured_legacy_environment):
    actor = Actor(factory())
    added = ok(connection(actor, name='My own MiMo', base_url='https://api.xiaomimimo.com/v1', model='my-explicit-model'), 201)
    service = actor.client.app.state.providers
    store = actor.client.app.state.store
    before = store.one('SELECT * FROM private_connections WHERE id=?', (added['id'],))
    scoped = scoped_providers(service, actor.user['id'])
    assert scoped.select().id == added['id']
    assert scoped.select(added['id']).model == 'my-explicit-model'
    assert scoped.select('mimo') is None
    assert [row['id'] for row in scoped.status()] == [added['id']]
    assert all(row['scope'] == 'private_account' for row in scoped.status())
    assert store.one('SELECT * FROM private_connections WHERE id=?', (added['id'],)) == before
    other = Actor(actor.client)
    other_scoped = scoped_providers(service, other.user['id'])
    assert other_scoped.select(added['id']) is None and other_scoped.select() is None
    assert other_scoped.status() == []
    ok(actor.post('/services/connections/'+added['id']+'/remove', json={'version':1,'password':actor.password}))
    assert scoped.status() == [] and scoped.select() is None and scoped.select('mimo') is None


@pytest.mark.parametrize('provider', LEGACY_IDS)
def test_legacy_provider_cannot_be_used_in_new_plan(factory, configured_legacy_environment, provider):
    actor = Actor(factory()); dataset = actor.dataset()
    response = actor.post('/workspace/plans', json={'dataset_id':dataset['id'], 'query':'核对经营指标与现金流',
                                                  'use_llm':True, 'provider':provider, 'max_calls':1})
    assert response.status_code == 201, response.text
    plan = response.json()
    assert plan['payload']['blockers']
    result = actor.post('/workspace/plans/'+plan['id']+'/execute', json={
        'version':plan['version'], 'fingerprint':plan['payload']['fingerprint'], 'external_consent':True})
    assert result.status_code == 409, result.text
    assert ok(actor.get('/runs'))['items'] == []
