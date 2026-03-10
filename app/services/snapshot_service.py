"""Delivery Snapshot computation -- pure functions over enriched deliverables."""

from __future__ import annotations

from datetime import date

from app.config.kpi_loader import KPIConfig
from app.schemas.report import DeliverableRow
from app.schemas.snapshot import DeliverySnapshot
from app.services.kpi_service import _committed_items, _date_in_range, _has_rework_tags, _reached_qa

VALID_SNAPSHOT_METRICS = frozenset({
    "delivered", "committed", "committed_in_period", "spillovers",
    "rework_items", "tech_debts", "bugs",
})


def compute_delivery_snapshot(
    deliverables: list[DeliverableRow],
    kpi_config: KPIConfig,
    start: date,
    end: date,
) -> DeliverySnapshot:
    delivered_canonical = kpi_config.delivery_predictability.delivered_canonical_status
    qa_canonical = kpi_config.rework_rate.qa_canonical_status
    rework_tags = kpi_config.rework_rate.rework_tags

    committed = _committed_items(deliverables, start, end)
    delivered = [d for d in committed if d.canonical_status == delivered_canonical]
    spillovers = [d for d in committed if d.is_spillover]
    committed_in_period = [d for d in committed if not d.is_spillover]
    rework = [
        d for d in deliverables
        if _reached_qa(d, qa_canonical) and _has_rework_tags(d, rework_tags)
    ]
    tech_debts = [d for d in deliverables if d.is_technical_debt]
    bugs = [d for d in deliverables if len(d.child_bugs) > 0]

    return DeliverySnapshot(
        delivered=len(delivered),
        committed=len(committed),
        committed_in_period=len(committed_in_period),
        spillovers=len(spillovers),
        rework_items=len(rework),
        tech_debts=len(tech_debts),
        bugs=len(bugs),
    )


def filter_snapshot_metric(
    deliverables: list[DeliverableRow],
    metric: str,
    kpi_config: KPIConfig,
    start: date,
    end: date,
) -> list[DeliverableRow]:
    if metric not in VALID_SNAPSHOT_METRICS:
        raise ValueError(
            f"Unknown snapshot metric '{metric}'. Valid: {sorted(VALID_SNAPSHOT_METRICS)}"
        )

    delivered_canonical = kpi_config.delivery_predictability.delivered_canonical_status
    qa_canonical = kpi_config.rework_rate.qa_canonical_status
    rework_tags = kpi_config.rework_rate.rework_tags

    if metric == "committed":
        return _committed_items(deliverables, start, end)
    if metric == "committed_in_period":
        committed = _committed_items(deliverables, start, end)
        return [d for d in committed if not d.is_spillover]
    if metric == "delivered":
        committed = _committed_items(deliverables, start, end)
        return [d for d in committed if d.canonical_status == delivered_canonical]
    if metric == "spillovers":
        committed = _committed_items(deliverables, start, end)
        return [d for d in committed if d.is_spillover]
    if metric == "rework_items":
        return [
            d for d in deliverables
            if _reached_qa(d, qa_canonical) and _has_rework_tags(d, rework_tags)
        ]
    if metric == "tech_debts":
        return [d for d in deliverables if d.is_technical_debt]
    if metric == "bugs":
        return [d for d in deliverables if len(d.child_bugs) > 0]

    return []
