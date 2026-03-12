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


def reached_qa(d: DeliverableRow, qa_canonical: str) -> bool:
    """Check if a deliverable reached QA status at any point."""
    return any(e.canonical_status == qa_canonical for e in d.status_timeline)


def has_rework_tags(d: DeliverableRow, rework_tags: list[str]) -> bool:
    """Check if a deliverable has any rework-indicating tags."""
    return any(t in rework_tags for t in d.tags)
