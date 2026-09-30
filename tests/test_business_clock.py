"""UTC inspection date is explicit and independent from the host's local zone."""
from datetime import date,datetime,timezone
from unittest.mock import patch
from server.clock import utc_today
from server.models import calculate
from server.analytics import closed_quarter


def test_clock_explicitly_requests_utc():
    with patch('server.clock.datetime') as clock:
        clock.now.return_value=datetime(2026,9,30,23,59,tzinfo=timezone.utc)
        assert utc_today()==date(2026,9,30)
        clock.now.assert_called_once_with(timezone.utc)


def test_quarter_inspection_boundary_and_frozen_date_are_consistent(example):
    with patch('server.analytics.utc_today',return_value=date(2026,9,30)):
        assert not closed_quarter('2026-Q3')
    with patch('server.analytics.utc_today',return_value=date(2026,10,1)):
        assert closed_quarter('2026-Q3')
        assert not closed_quarter('2026-Q3',today=date(2026,9,30))
    with patch('server.models.utc_today',return_value=date(2026,9,30)):
        old=calculate(example,today=date(2026,9,30))
    with patch('server.models.utc_today',return_value=date(2026,10,1)):
        assert calculate(example,today=date(2026,9,30))==old
