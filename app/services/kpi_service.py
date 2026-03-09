"""KPI computation layer -- pure functions over enriched deliverables."""

from __future__ import annotations

from app.config.kpi_loader import ReworkRateConfig
from app.schemas.kpi import AverageKPI, RAGStatus, ReworkRateKPI
from app.schemas.report import DeliverableRow


def _reached_qa(d: DeliverableRow, qa_canonical: str) -> bool:
    return any(e.canonical_status == qa_canonical for e in d.status_timeline)


def _has_rework_tags(d: DeliverableRow, rework_tags: list[str]) -> bool:
    return any(t in rework_tags for t in d.tags)


def _rag_from_value(value: float, config: ReworkRateConfig) -> RAGStatus:
    if value <= config.rag.green_max:
        return RAGStatus.GREEN
    if value <= config.rag.amber_max:
        return RAGStatus.AMBER
    return RAGStatus.RED


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
    rag = _rag_from_value(value, config)

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


def compute_kpi_average(
    kpi_name: str,
    team_kpis: list[ReworkRateKPI],
    config: ReworkRateConfig,
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
    rag = _rag_from_value(avg, config)
    return AverageKPI(
        name=kpi_name,
        value=round(avg, 4),
        display=f"{avg * 100:.1f}%",
        rag=rag,
        team_count=len(team_kpis),
    )


VALID_DRILLDOWN_METRICS = frozenset({
    "items_reached_qa",
    "items_with_rework",
    "items_bounced_back",
    "items_with_bugs",
})


def filter_deliverables_by_metric(
    deliverables: list[DeliverableRow],
    metric: str,
    config: ReworkRateConfig,
) -> list[DeliverableRow]:
    if metric not in VALID_DRILLDOWN_METRICS:
        raise ValueError(
            f"Unknown metric '{metric}'. Valid: {sorted(VALID_DRILLDOWN_METRICS)}"
        )

    qa_canonical = config.qa_canonical_status
    rework_tags = config.rework_tags

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
    return []
