"""KPI computation layer -- pure functions over enriched deliverables."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from collections import defaultdict

from app.config.kpi_loader import (
    DeliveryPredictabilityConfig,
    FlowHygieneConfig,
    InitiativeDeliveryConfig,
    ReliabilityActionDeliveryConfig,
    ReworkRateConfig,
    TechDebtRatioConfig,
    TeamKPIOverrides,
    WIPDisciplineConfig,
)
from app.config.team_loader import TeamConfig
from app.schemas.kpi import (
    AverageKPI,
    DeliveryPredictabilityKPI,
    FlowHygieneKPI,
    InitiativeDeliveryKPI,
    PersonStatusBreakdown,
    PersonWIPMetric,
    PersonWorkItem,
    RAGStatus,
    ReliabilityActionDeliveryKPI,
    ReworkRateKPI,
    StateQueueMetric,
    TechDebtRatioKPI,
    WIPDisciplineKPI,
)
from app.schemas.report import DeliverableRow
from app.services.common import committed_items, date_in_range, has_rework_tags, reached_qa

# Re-export for backwards compatibility.
_date_in_range = date_in_range
_committed_items = committed_items
_reached_qa = reached_qa
_has_rework_tags = has_rework_tags


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


def _rag_flow_hygiene(value: float, config: FlowHygieneConfig) -> RAGStatus:
    if value <= config.rag.green_max:
        return RAGStatus.GREEN
    if value <= config.rag.amber_max:
        return RAGStatus.AMBER
    return RAGStatus.RED


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
# Flow Hygiene
# ---------------------------------------------------------------------------

def _state_on_day(
    d: DeliverableRow,
    target_day: date,
) -> str | None:
    """Return the Azure DevOps state the item was in at end-of-day *target_day*.

    Uses the status_timeline (sorted by date ascending).  We find the latest
    entry whose date is on or before target_day.
    """
    result: str | None = None
    for entry in d.status_timeline:
        entry_date = entry.date.date() if isinstance(entry.date, datetime) else entry.date
        if entry_date <= target_day:
            result = entry.state
        else:
            break
    return result


def compute_flow_hygiene(
    deliverables: list[DeliverableRow],
    config: FlowHygieneConfig,
    wip_limits: dict[str, tuple[int, str]],
    start: date,
    end: date,
) -> FlowHygieneKPI:
    """Compute Flow Hygiene KPI with daily snapshots per queue state."""
    total_days = (end - start).days + 1
    if total_days <= 0:
        total_days = 1
    days = [start + timedelta(days=i) for i in range(total_days)]
    queue_states_set = frozenset(config.queue_states)

    state_metrics: list[StateQueueMetric] = []

    for q_state in config.queue_states:
        limit, source = wip_limits.get(q_state, (1, "global_default"))
        if limit <= 0:
            limit = 1
            source = "global_default"

        daily_counts: list[int] = []
        for day in days:
            count = 0
            for d in deliverables:
                item_state = _state_on_day(d, day)
                if item_state == q_state:
                    count += 1
            daily_counts.append(count)

        avg_items = sum(daily_counts) / len(daily_counts)
        peak_items = max(daily_counts) if daily_counts else 0
        days_over = sum(1 for c in daily_counts if c > limit)
        queue_load = avg_items / limit

        state_metrics.append(StateQueueMetric(
            state=q_state,
            avg_items=round(avg_items, 2),
            peak_items=peak_items,
            wip_limit=limit,
            wip_limit_source=source,
            queue_load=round(queue_load, 4),
            days_over_limit=days_over,
        ))

    worst_load = max((s.queue_load for s in state_metrics), default=0.0)

    if worst_load <= config.rag.green_max:
        rag = RAGStatus.GREEN
    elif worst_load <= config.rag.amber_max:
        rag = RAGStatus.AMBER
    else:
        rag = RAGStatus.RED

    green_str = f"{config.rag.green_max:.1f}"
    amber_str = f"{config.rag.amber_max:.1f}"

    return FlowHygieneKPI(
        value=round(worst_load, 4),
        display=f"{worst_load:.2f}",
        rag=rag,
        total_days=total_days,
        states=state_metrics,
        thresholds={
            "green": f"<= {green_str}",
            "amber": f"{green_str}-{amber_str}",
            "red": f"> {amber_str}",
        },
    )


def _was_in_queue_states(d: DeliverableRow, queue_states: frozenset[str]) -> bool:
    """True if the item was in any of the queue states at any point."""
    return any(e.state in queue_states for e in d.status_timeline)


# ---------------------------------------------------------------------------
# WIP Discipline
# ---------------------------------------------------------------------------

def _assignee_and_state_on_day(
    d: DeliverableRow,
    target_day: date,
) -> tuple[str | None, str | None, str | None]:
    """Return (state, canonical_status, assigned_to) at end-of-day *target_day*."""
    state: str | None = None
    canonical: str | None = None
    assignee: str | None = None
    for entry in d.status_timeline:
        entry_date = entry.date.date() if isinstance(entry.date, datetime) else entry.date
        if entry_date <= target_day:
            state = entry.state
            canonical = entry.canonical_status
            assignee = entry.assigned_to
        else:
            break
    return state, canonical, assignee


def _build_person_metrics(
    person_daily_totals: dict[str, list[int]],
    person_daily_per_state: dict[str, dict[str, list[int]]],
    wip_limit: int,
    compliance_threshold: float,
    total_days: int,
    role: str,
) -> list[PersonWIPMetric]:
    """Aggregate daily per-person WIP counts into PersonWIPMetric objects."""
    persons: list[PersonWIPMetric] = []
    for person, daily_totals in sorted(person_daily_totals.items()):
        avg_wip = sum(daily_totals) / len(daily_totals) if daily_totals else 0.0
        peak_wip = max(daily_totals) if daily_totals else 0
        days_compliant = sum(1 for c in daily_totals if c <= wip_limit)
        days_over = total_days - days_compliant
        compliance_pct = days_compliant / total_days if total_days > 0 else 1.0

        breakdown: list[PersonStatusBreakdown] = []
        for st, st_daily in sorted(person_daily_per_state.get(person, {}).items()):
            st_avg = sum(st_daily) / len(st_daily) if st_daily else 0.0
            st_peak = max(st_daily) if st_daily else 0
            if st_avg > 0 or st_peak > 0:
                breakdown.append(PersonStatusBreakdown(
                    state=st,
                    avg_items=round(st_avg, 2),
                    peak_items=st_peak,
                ))

        persons.append(PersonWIPMetric(
            person=person,
            role=role,
            avg_wip=round(avg_wip, 2),
            peak_wip=peak_wip,
            days_compliant=days_compliant,
            days_over_limit=days_over,
            total_days=total_days,
            compliance_pct=round(compliance_pct, 4),
            is_compliant=compliance_pct >= compliance_threshold,
            status_breakdown=breakdown,
        ))

    return persons


def compute_wip_discipline(
    deliverables: list[DeliverableRow],
    config: WIPDisciplineConfig,
    team_config: TeamConfig,
    start: date,
    end: date,
) -> WIPDisciplineKPI:
    total_days = (end - start).days + 1
    if total_days <= 0:
        total_days = 1
    days = [start + timedelta(days=i) for i in range(total_days)]

    real_to_canonical = team_config.real_state_to_canonical()

    dev_daily_totals: dict[str, list[int]] = defaultdict(lambda: [0] * total_days)
    dev_daily_per_state: dict[str, dict[str, list[int]]] = defaultdict(
        lambda: defaultdict(lambda: [0] * total_days)
    )
    qa_daily_totals: dict[str, list[int]] = defaultdict(lambda: [0] * total_days)
    qa_daily_per_state: dict[str, dict[str, list[int]]] = defaultdict(
        lambda: defaultdict(lambda: [0] * total_days)
    )
    dev_item_ids: dict[str, set[int]] = defaultdict(set)
    qa_item_ids: dict[str, set[int]] = defaultdict(set)

    for day_idx, day in enumerate(days):
        for d in deliverables:
            state, canonical_from_timeline, assignee = _assignee_and_state_on_day(d, day)
            if state is None:
                continue
            assignee = assignee or "Unassigned"
            canonical = canonical_from_timeline or real_to_canonical.get(state)
            if canonical == "Under Development":
                dev_daily_totals[assignee][day_idx] += 1
                dev_daily_per_state[assignee][state][day_idx] += 1
                dev_item_ids[assignee].add(d.id)
            elif canonical == "Under QA":
                qa_daily_totals[assignee][day_idx] += 1
                qa_daily_per_state[assignee][state][day_idx] += 1
                qa_item_ids[assignee].add(d.id)

    dev_persons = _build_person_metrics(
        dev_daily_totals, dev_daily_per_state,
        config.dev_wip_limit, config.compliance_threshold,
        total_days, "developer",
    )
    qa_persons = _build_person_metrics(
        qa_daily_totals, qa_daily_per_state,
        config.qa_wip_limit, config.compliance_threshold,
        total_days, "qa",
    )

    deliverables_by_id = {d.id: d for d in deliverables}
    for p in dev_persons:
        p.work_items = [
            PersonWorkItem(id=d.id, title=d.title, state=d.state or "")
            for wid in sorted(dev_item_ids.get(p.person, set()))
            if (d := deliverables_by_id.get(wid)) is not None
        ]
    for p in qa_persons:
        p.work_items = [
            PersonWorkItem(id=d.id, title=d.title, state=d.state or "")
            for wid in sorted(qa_item_ids.get(p.person, set()))
            if (d := deliverables_by_id.get(wid)) is not None
        ]

    all_persons = dev_persons + qa_persons

    total_dev = len(dev_persons)
    dev_compliant_count = sum(1 for p in dev_persons if p.is_compliant)
    total_qa = len(qa_persons)
    qa_compliant_count = sum(1 for p in qa_persons if p.is_compliant)

    dev_compliant_days = sum(p.days_compliant for p in dev_persons)
    qa_compliant_days = sum(p.days_compliant for p in qa_persons)
    dev_total_days = total_dev * total_days
    qa_total_days = total_qa * total_days
    total_person_days = dev_total_days + qa_total_days
    value = (dev_compliant_days + qa_compliant_days) / total_person_days if total_person_days > 0 else 1.0

    if value >= config.rag.green_min:
        rag = RAGStatus.GREEN
    elif value >= config.rag.amber_min:
        rag = RAGStatus.AMBER
    else:
        rag = RAGStatus.RED

    green_pct = f"{config.rag.green_min * 100:.0f}%"
    amber_pct = f"{config.rag.amber_min * 100:.0f}%"

    return WIPDisciplineKPI(
        value=round(value, 4),
        display=f"{value * 100:.1f}%",
        rag=rag,
        total_days=total_days,
        total_developers=total_dev,
        developers_compliant=dev_compliant_count,
        dev_wip_limit=config.dev_wip_limit,
        total_qas=total_qa,
        qas_compliant=qa_compliant_count,
        qa_wip_limit=config.qa_wip_limit,
        persons=all_persons,
        thresholds={
            "green": f">= {green_pct}",
            "amber": f"{amber_pct}-{green_pct}",
            "red": f"< {amber_pct}",
        },
    )


# ---------------------------------------------------------------------------
# Tech Debt Ratio
# ---------------------------------------------------------------------------

def _rag_band(value: float, config: TechDebtRatioConfig) -> RAGStatus:
    """Target-band RAG: GREEN when value is in [green_min, green_max], AMBER in
    [amber_min, green_min), RED outside [amber_min, green_max]."""
    r = config.rag
    if r.green_min <= value <= r.green_max:
        return RAGStatus.GREEN
    if r.amber_min <= value < r.green_min:
        return RAGStatus.AMBER
    return RAGStatus.RED


def compute_tech_debt_ratio(
    deliverables: list[DeliverableRow],
    config: TechDebtRatioConfig,
) -> TechDebtRatioKPI:
    """Tech debt ratio over committed+delivered items only (matches work items page)."""
    deployed = [d for d in deliverables if d.is_delivered]
    tech_debt = [d for d in deployed if d.is_technical_debt]

    total = len(deployed)
    debt_count = len(tech_debt)
    value = debt_count / total if total > 0 else 0.0
    rag = _rag_band(value, config)

    r = config.rag
    amber_pct = f"{r.amber_min * 100:.0f}%"
    green_lo = f"{r.green_min * 100:.0f}%"
    green_hi = f"{r.green_max * 100:.0f}%"

    return TechDebtRatioKPI(
        value=round(value, 4),
        display=f"{value * 100:.1f}%",
        rag=rag,
        tech_debt_count=debt_count,
        total_deployed=total,
        thresholds={
            "green": f"{green_lo}-{green_hi}",
            "amber": f"{amber_pct}-{green_lo}",
            "red": f"< {amber_pct} or > {green_hi}",
        },
    )


# ---------------------------------------------------------------------------
# Reliability Action Delivery (Post-Mortem SLA Compliance)
# ---------------------------------------------------------------------------

def compute_reliability_action_delivery(
    deliverables: list[DeliverableRow],
    config: ReliabilityActionDeliveryConfig,
) -> ReliabilityActionDeliveryKPI:
    """Compute reliability action delivery: % of post-mortem deliverables delivered within SLA."""
    delivered_canonical = config.delivered_canonical_status
    in_scope = [
        d for d in deliverables
        if d.is_post_mortem and (d.canonical_status or "").strip() == delivered_canonical
    ]
    sla_met = sum(1 for d in in_scope if d.post_mortem_sla_met is True)
    total = len(in_scope)
    value = sla_met / total if total > 0 else 0.0
    rag = _rag_higher_is_better(value, config)
    return ReliabilityActionDeliveryKPI(
        value=round(value, 4),
        display=f"{value * 100:.1f}%",
        rag=rag,
        reliability_actions_sla_met=sla_met,
        reliability_actions_delivered=total,
        thresholds={
            "green": f">= {config.rag.green_min * 100:.0f}%",
            "amber": f"{config.rag.amber_min * 100:.0f}%-{config.rag.green_min * 100:.0f}%",
            "red": f"< {config.rag.amber_min * 100:.0f}%",
        },
    )


# ---------------------------------------------------------------------------
# Initiative Delivery (Delivery of Specific Initiatives)
# ---------------------------------------------------------------------------

def compute_initiative_delivery(
    deliverables: list[DeliverableRow],
    config: InitiativeDeliveryConfig,
    team_config: TeamConfig,
    initiative_ids: list[int],
    start: date,
    end: date,
) -> InitiativeDeliveryKPI:
    """Compute initiative delivery: % of deliverables (under initiative epics/features) committed that were delivered.

    Counts deliverables linked to initiative_ids (parent_epic or parent_feature).
    Committed = deliverable was spillover or started in period.
    Delivered = deliverable reached canonical Delivered status.
    initiative_ids: parent work item IDs to track; empty = count nothing (0 committed, 0 delivered).
    """
    if not initiative_ids:
        return InitiativeDeliveryKPI(
            value=0.0,
            display="0.0%",
            rag=_rag_higher_is_better(0.0, config),
            initiatives_committed=0,
            initiatives_delivered=0,
            thresholds={
                "green": f">= {config.rag.green_min * 100:.0f}%",
                "amber": f"{config.rag.amber_min * 100:.0f}%-{config.rag.green_min * 100:.0f}%",
                "red": f"< {config.rag.amber_min * 100:.0f}%",
            },
        )
    delivered_canonical = config.delivered_canonical_status
    ids_filter = frozenset(initiative_ids)

    committed = committed_items(deliverables, start, end)
    committed_ids = frozenset(d.id for d in committed)

    def _under_initiative(d: DeliverableRow) -> bool:
        if d.parent_epic and d.parent_epic.id in ids_filter:
            return True
        if d.parent_feature and d.parent_feature.id in ids_filter:
            return True
        return False

    in_scope = [d for d in deliverables if _under_initiative(d)]
    committed_count = sum(1 for d in in_scope if d.id in committed_ids)
    delivered_count = sum(
        1 for d in in_scope
        if (d.canonical_status or "").strip() == delivered_canonical
    )
    value = delivered_count / committed_count if committed_count > 0 else 0.0
    rag = _rag_higher_is_better(value, config)

    return InitiativeDeliveryKPI(
        value=round(value, 4),
        display=f"{value * 100:.1f}%",
        rag=rag,
        initiatives_committed=committed_count,
        initiatives_delivered=delivered_count,
        thresholds={
            "green": f">= {config.rag.green_min * 100:.0f}%",
            "amber": f"{config.rag.amber_min * 100:.0f}%-{config.rag.green_min * 100:.0f}%",
            "red": f"< {config.rag.amber_min * 100:.0f}%",
        },
    )


# ---------------------------------------------------------------------------
# Cross-team average
# ---------------------------------------------------------------------------

def compute_kpi_average(
    kpi_name: str,
    team_kpis: list,
    config: ReworkRateConfig | DeliveryPredictabilityConfig | FlowHygieneConfig | WIPDisciplineConfig | TechDebtRatioConfig | InitiativeDeliveryConfig,
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

    if isinstance(config, TechDebtRatioConfig):
        rag = _rag_band(avg, config)
    elif isinstance(config, (DeliveryPredictabilityConfig, WIPDisciplineConfig, InitiativeDeliveryConfig, ReliabilityActionDeliveryConfig)):
        rag = _rag_higher_is_better(avg, config)
    elif isinstance(config, FlowHygieneConfig):
        rag = _rag_flow_hygiene(avg, config)
    else:
        rag = _rag_lower_is_better(avg, config)

    display = f"{avg:.2f}" if isinstance(config, FlowHygieneConfig) else f"{avg * 100:.1f}%"
    extra: dict = {}
    if isinstance(config, InitiativeDeliveryConfig) and team_kpis:
        extra["initiatives_committed"] = sum(
            getattr(k, "initiatives_committed", 0) or 0 for k in team_kpis
        )
        extra["initiatives_delivered"] = sum(
            getattr(k, "initiatives_delivered", 0) or 0 for k in team_kpis
        )
    if isinstance(config, ReliabilityActionDeliveryConfig) and team_kpis:
        extra["reliability_actions_sla_met"] = sum(
            getattr(k, "reliability_actions_sla_met", 0) or 0 for k in team_kpis
        )
        extra["reliability_actions_delivered"] = sum(
            getattr(k, "reliability_actions_delivered", 0) or 0 for k in team_kpis
        )
    return AverageKPI(
        name=kpi_name,
        value=round(avg, 4),
        display=display,
        rag=rag,
        team_count=len(team_kpis),
        **extra,
    )


# ---------------------------------------------------------------------------
# Drilldown filtering
# ---------------------------------------------------------------------------

REWORK_METRICS = frozenset({
    "items_reached_qa", "items_with_rework", "items_bounced_back", "items_with_bugs",
})

DP_METRICS = frozenset({
    "items_committed", "items_deployed", "items_started_in_period", "items_spillover",
})

FH_METRICS = frozenset({
    "items_in_queue",
})

WD_METRICS = frozenset({
    "developers", "qas", "compliant_gte_80", "over_wip_limit",
})

TD_METRICS = frozenset({
    "tech_debt_deployed", "non_tech_debt_deployed",
})

ID_METRICS = frozenset({
    "initiatives_committed", "initiatives_delivered",
})

RAD_METRICS = frozenset({
    "reliability_actions_sla_met",
    "reliability_actions_sla_breached",
})

VALID_DRILLDOWN_METRICS = REWORK_METRICS | DP_METRICS | FH_METRICS | WD_METRICS | TD_METRICS | ID_METRICS | RAD_METRICS


def filter_deliverables_by_metric(
    deliverables: list[DeliverableRow],
    metric: str,
    rework_config: ReworkRateConfig | None = None,
    dp_config: DeliveryPredictabilityConfig | None = None,
    fh_config: FlowHygieneConfig | None = None,
    wd_config: WIPDisciplineConfig | None = None,
    td_config: TechDebtRatioConfig | None = None,
    id_config: InitiativeDeliveryConfig | None = None,
    id_overrides: TeamKPIOverrides | None = None,
    rad_config: ReliabilityActionDeliveryConfig | None = None,
    team_config: TeamConfig | None = None,
    start: date | None = None,
    end: date | None = None,
    person: str | None = None,
) -> list[DeliverableRow]:
    if metric not in VALID_DRILLDOWN_METRICS:
        raise ValueError(
            f"Unknown metric '{metric}'. Valid: {sorted(VALID_DRILLDOWN_METRICS)}"
        )

    if metric in REWORK_METRICS:
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

    if metric in DP_METRICS:
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

    if metric in FH_METRICS:
        if fh_config is None:
            raise ValueError("fh_config required for flow hygiene metrics")
        queue_states = frozenset(fh_config.queue_states)
        if metric == "items_in_queue":
            return [d for d in deliverables if _was_in_queue_states(d, queue_states)]

    if metric in WD_METRICS:
        if metric == "developers":
            result = [d for d in deliverables if d.developer is not None]
            if person:
                person_lower = person.lower()
                result = [d for d in result if (d.developer or "").lower() == person_lower]
            return result
        if metric == "qas":
            result = [d for d in deliverables if d.qa is not None]
            if person:
                person_lower = person.lower()
                result = [d for d in result if (d.qa or "").lower() == person_lower]
            return result
        if metric in ("compliant_gte_80", "over_wip_limit"):
            if wd_config is None or team_config is None or start is None or end is None:
                raise ValueError(
                    "wd_config, team_config, start, and end required for compliance metrics"
                )
            kpi = compute_wip_discipline(deliverables, wd_config, team_config, start, end)
            if metric == "compliant_gte_80":
                names = {p.person.lower() for p in kpi.persons if p.is_compliant}
            else:
                names = {p.person.lower() for p in kpi.persons if not p.is_compliant}
            return [
                d for d in deliverables
                if (d.developer and d.developer.lower() in names)
                or (d.qa and d.qa.lower() in names)
            ]

    if metric in TD_METRICS:
        if td_config is None:
            raise ValueError("td_config required for tech debt ratio metrics")
        deployed = [d for d in deliverables if d.is_delivered]
        if metric == "tech_debt_deployed":
            return [d for d in deployed if d.is_technical_debt]
        if metric == "non_tech_debt_deployed":
            return [d for d in deployed if not d.is_technical_debt]

    if metric in ID_METRICS:
        if id_config is None or team_config is None or id_overrides is None or start is None or end is None:
            raise ValueError(
                "id_config, team_config, id_overrides, start, and end required for initiative delivery metrics"
            )
        if not id_overrides.initiative_ids:
            return []
        ids_filter = frozenset(id_overrides.initiative_ids)
        delivered_canonical = id_config.delivered_canonical_status
        committed = _committed_items(deliverables, start, end)
        committed_ids = frozenset(d.id for d in committed)

        def _under_initiative(d: DeliverableRow) -> bool:
            if d.parent_epic and d.parent_epic.id in ids_filter:
                return True
            if d.parent_feature and d.parent_feature.id in ids_filter:
                return True
            return False

        in_scope = [d for d in deliverables if _under_initiative(d)]
        if metric == "initiatives_committed":
            return [d for d in in_scope if d.id in committed_ids]
        return [
            d for d in in_scope
            if (d.canonical_status or "").strip() == delivered_canonical
        ]

    if metric in RAD_METRICS:
        if rad_config is None:
            raise ValueError("rad_config required for reliability action delivery metrics")
        delivered_canonical = rad_config.delivered_canonical_status
        in_scope = [
            d for d in deliverables
            if d.is_post_mortem and (d.canonical_status or "").strip() == delivered_canonical
        ]
        if metric == "reliability_actions_sla_met":
            return [d for d in in_scope if d.post_mortem_sla_met is True]
        return [d for d in in_scope if d.post_mortem_sla_met is False]

    return []
