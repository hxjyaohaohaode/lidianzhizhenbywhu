import copy,hashlib
from datetime import date
from pathlib import Path
import pytest
from server.analytics import forecast_baselines
from test_workspace_analytics import series
ROOT=Path(__file__).resolve().parents[1]


def test_holdout_selection_does_not_observe_the_last_two_targets():
    d=series(12);base=forecast_baselines(d,'revenue',2,date(2026,1,1));changed=copy.deepcopy(d)
    for period in changed['periods'][-2:]:period['revenue']*=100
    other=forecast_baselines(changed,'revenue',2,date(2026,1,1))
    assert base['locked_holdout']['method']==other['locked_holdout']['method']
    assert base['locked_holdout']['development']==other['locked_holdout']['development']
    assert base['locked_holdout']['folds'][0]['prediction']==other['locked_holdout']['folds'][0]['prediction']
    h=base['locked_holdout'];assert h['selection_end']<h['holdout_start']
    assert all(f['train_end']<f['target'] for f in h['folds']) and h['selection_uses_holdout'] is False


def test_short_history_has_no_fake_locked_holdout():
    r=forecast_baselines(series(8),'revenue',1,date(2026,1,1));assert r['locked_holdout']['status']=='insufficient_history'
    assert 'mae' not in r['locked_holdout']

@pytest.mark.parametrize('file,expected',[
    ('logo.png','ad25a12134433d1459a6f8777772ce40378b0e020305adcc8def8fa72994ab25'),
    ('loading-video.mp4','8d1b22989c4a5593bfe9a9a50a87cf9176549f34e031111133a93ddf60fde3dd')])
def test_original_assets_are_preserved_byte_for_byte(file,expected):
    assert hashlib.sha256((ROOT/'web'/'brand'/file).read_bytes()).hexdigest()==expected


def test_original_asset_routes_and_video_range(client):
    for path,file in [('/images/logo.png','logo.png'),('/loading-video.mp4','loading-video.mp4')]:
        r=client.get(path);assert r.status_code==200 and r.content==(ROOT/'web'/'brand'/file).read_bytes()
    r=client.get('/loading-video.mp4',headers={'Range':'bytes=0-99'});assert r.status_code==206 and len(r.content)==100
