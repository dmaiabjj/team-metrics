"""KPI computation layer -- pure functions over enriched deliverables."""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.config.kpi_loader import DeliveryPredictabilityConfig, ReworkRateConfig
from app.schemas.kpi import (
    AverageKPI,
    DeliveryPredictabilityKPI,
    RAGStatus,
    ReworkRateKPI,
)
from app.schemas.report import DeliverableRow


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reached_qa(d: DeliverableRow, qa_canonical: str) -> bool:
    return any(e.canonical_status == qa_canonical for e in d.status_timeline)


def _has_rework_tags(d: DeliverableRow, rework_tags: list[str]) -> bool:
    return any(t in rework_tags for t in d.tags)


def _rag_lower_is_better(value: float, config: ReworkRateConfig) -> RAGStatus:
    if value <= config.rag.green_max:
        return RAGStatus.GREEN
    if value <= config.rag.amber_max:
        return RAGStatus.AMBER
    return RAGStatus.RED


def _rag_higher_is_better(value: float, config: DeliveryPredictabilityConfig) -> RAGStatus:
    if value >= config.rag.green_min:
        return RAGStatus.GREEN
    if value >= config.rag.amber_min:
        return RAGStatus.AMBER
    return RAGStatus.RED


def _date_in_range(dt: datetime | None, start: date, end: date) -> bool:
    """Check if a datetime falls within [start, end] (date-only comparison)."""
    if dt is None:
        return False
    d = dt.date() if isinstance(dt, datetime) else dt
    return start <= d <= end


# ---------------------------------------------------------------------------
# Rework Rate
# ---------------------------------------------------------------------------

def compute_rework_rate(
    deliverables: list[DeliverableRow],
    config: ReworkRateConfig,
) -> ReworkRateKPI:
    qa_canonical = config.qa_canonical_status
    rework_tags = config.rework_tags

    qa_items = [d for d in deliverables if _reached_qa(d, qa_canonical)]
    rework_items = [d for d in qa_items if _has_rework_tags(d, rework_tags)]
    bounced = sum(1 for d in deliverables if d.bounces > 0)
    total_bugs = sum(len(d.child_bugs) for d in deliverables)

    denominator = len(qa_items)
    numerator = len(rework_items)
    value = numerator / denominator if denominator > 0 else 0.0
    rag = _rag_lower_is_better(value, config)

    green_pct = f"{config.rag.green_max * 100:.0f}%"
    amber_pct = f"{config.rag.amber_max * 100:.0f}%"

    return ReworkRateKPI(
        value=round(value, 4),
        display=f"{value * 100:.1f}%",
        rag=rag,
        items_with_rework=numerator,
        items_reached_qa=denominator,
        items_bounced_back=bounced,
        total_bugs=total_bugs,
        thresholds={
            "green": f"<= {green_pct}",
            "amber": f"{green_pct}-{amber_pct}",
            "red": f"> {amber_pct}",
        },
    )


# ---------------------------------------------------------------------------
# Delivery Predictability
# ---------------------------------------------------------------------------

def _committed_items(
    deliverables: list[DeliverableRow],
    start: date,
    end: date,
) -> list[DeliverableRow]:
    """Items committed to the period: spillovers + items started in period."""
    return [
        d for d in deliverables
        if d.is_spillover or _date_in_range(d.start_date, start, end)
    ]


def compute_delivery_predictability(
    deliverables: list[DeliverableRow],
    config: DeliveryPredictabilityConfig,
    start: date,
    end: date,
) -> DeliveryPredictabilityKPI:
    delivered_canonical = config.delivered_canonical_status

    committed = _committed_items(deliverables, start, end)
    spillover_list = [d for d in committed if d.is_spillover]
    started_list = [d for d in committed if not d.is_spillover]
    deployed_list = [d for d in committed if d.canonical_status == delivered_canonical]

    n_committed = len(committed)
    n_deployed = len(deployed_list)
    value = n_deployed / n_committed if n_committed > 0 else 0.0
    rag = _rag_higher_is_better(value, config)

    green_pct = f"{config.rag.green_min * 100:.0f}%"
    amber_pct = f"{config.rag.amber_min * 100:.0f}%"

    return DeliveryPredictabilityKPI(
        value=round(value, 4),
        display=f"{value * 100:.1f}%",
        rag=rag,
        items_committed=n_committed,
        items_deployed=n_deployed,
        items_started_in_period=len(started_list),
        items_spillover=len(spillover_list),
        thresholds={
            "green": f">= {green_pct}",
            "amber": f"{amber_pct}-{green_pct}",
            "red": f"< {amber_pct}",
        },
    )


# ---------------------------------------------------------------------------
# Cross-team average
# ---------------------------------------------------------------------------

def compute_kpi_average(
    kpi_name: str,
    team_kpis: list[ReworkRateKPI] | list[DeliveryPredictabilityKPI],
    config: ReworkRateConfig | DeliveryPredictabilityConfig,
) -> AverageKPI:
    if not team_kpis:
        return AverageKPI(
            name=kpi_name,
            value=0.0,
            display="0.0%",
            rag=RAGStatus.GREEN,
            team_count=0,
        )
    avg = sum(k.value for k in team_kpis) / len(team_kpis)

    if isinstance(config, DeliveryPredictabilityConfig):
        rag = _rag_higher_is_better(avg, config)
    else:
        rag = _rag_lower_is_better(avg, config)

    return AverageKPI(
        name=kpi_name,
        value=round(avg, 4),
        display=f"{avg * 100:.1f}%",
        rag=rag,
        team_count=len(team_kpis),
    )


# ---------------------------------------------------------------------------
# Drilldown filtering
# ---------------------------------------------------------------------------

VALID_DRILLDOWN_METRICS = frozenset({
    "items_reached_qa",
    "items_with_rework",
    "items_bounced_back",
    "items_with_bugs",
    "items_committed",
    "items_deployed",
    "items_started_in_period",
    "items_spillover",
})

_REWORK_METRICS = frozenset({
    "items_reached_qa", "items_with_rework", "items_bounced_back", "items_with_bugs",
})

_DP_METRICS = frozenset({
    "items_committed", "items_deployed", "items_started_in_period", "items_spillover",
})


def filter_deliverables_by_metric(
    deliverables: list[DeliverableRow],
    metric: str,
    rework_config: ReworkRateConfig | None = None,
    dp_config: DeliveryPredictabilityConfig | None = None,
    start: date | None = None,
    end: date | None = None,
) -> list[DeliverableRow]:
    if metric not in VALID_DRILLDOWN_METRICS:
        raise ValueError(
            f"Unknown metric '{metric}'. Valid: {sorted(VALID_DRILLDOWN_METRICS)}"
        )

    if metric in _REWORK_METRICS:
        if rework_config is None:
            raise ValueError("rework_config required for rework metrics")
        qa_canonical = rework_config.qa_canonical_status
        rework_tags = rework_config.rework_tags

        if metric == "items_reached_qa":
            return [d for d in deliverables if _reached_qa(d, qa_canonical)]
        if metric == "items_with_rework":
            return [
                d for d in deliverables
                if _reached_qa(d, qa_canonical) and _has_rework_tags(d, rework_tags)
            ]
        if metric == "items_bounced_back":
            return [d for d in deliverables if d.bounces > 0]
        if metric == "items_with_bugs":
            return [d for d in deliverables if len(d.child_bugs) > 0]

    if metric in _DP_METRICS:
        if dp_config is None or start is None or end is None:
            raise ValueError("dp_config, start, and end required for delivery predictability metrics")
        delivered_canonical = dp_config.delivered_canonical_status
        committed = _committed_items(deliverables, start, end)

        if metric == "items_committed":
            return committed
        if metric == "items_deployed":
            return [d for d in committed if d.canonical_status == delivered_canonical]
        if metric == "items_started_in_period":
            return [d for d in committed if not d.is_spillover]
        if metric == "items_spillover":
            return [d for d in committed if d.is_spillover]

    return []
