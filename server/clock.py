"""One business-date policy across saved data, approvals, evidence and tracking."""
from datetime import datetime, timezone


def utc_today():
    return datetime.now(timezone.utc).date()
