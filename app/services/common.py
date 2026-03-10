"""Shared helpers for service modules."""

from __future__ import annotations

from datetime import date, datetime

from app.schemas.report import DeliverableRow


def date_in_range(dt: datetime | None, start: date, end: date) -> bool:
    """Check if a datetime falls within [start, end] (date-only comparison)."""
    if dt is None:
        return False
    d = dt.date() if isinstance(dt, datetime) else dt
    return start <= d <= end


def committed_items(
    deliverables: list[DeliverableRow],
    start: date,
    end: date,
) -> list[DeliverableRow]:
    """Items committed to the period: spillovers + items started in period."""
    return [
        d for d in deliverables
        if d.is_spillover or date_in_range(d.start_date, start, end)
    ]
