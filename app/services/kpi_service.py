"""KPI computation layer -- pure functions over enriched deliverables."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from collections import defaultdict

from app.config.kpi_loader import (
    DeliveryPredictabilityConfig,
    FlowHygieneConfig,
    ReworkRateConfig,
    WIPDisciplineConfig,
)
from app.config.team_loader import TeamConfig
from app.schemas.kpi import (
    AverageKPI,
    DeliveryPredictabilityKPI,
    FlowHygieneKPI,
    PersonStatusBreakdown,
    PersonWIPMetric,
    RAGStatus,
    ReworkRateKPI,
    RoleWIPSummary,
    StateQueueMetric,
    WIPDisciplineKPI,
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


def _rag_flow_hygiene(value: float, config: FlowHygieneConfig) -> RAGStatus:
    if value <= config.rag.green_max:
        return RAGStatus.GREEN
    if value <= config.rag.amber_max:
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


def _build_role_summary(
    person_daily_totals: dict[str, list[int]],
    person_daily_per_state: dict[str, dict[str, list[int]]],
    wip_limit: int,
    compliance_threshold: float,
    total_days: int,
    role: str,
    canonical_status: str,
) -> RoleWIPSummary:
    """Aggregate daily per-person WIP counts into a RoleWIPSummary."""
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
            avg_wip=round(avg_wip, 2),
            peak_wip=peak_wip,
            days_compliant=days_compliant,
            days_over_limit=days_over,
            total_days=total_days,
            compliance_pct=round(compliance_pct, 4),
            is_compliant=compliance_pct >= compliance_threshold,
            status_breakdown=breakdown,
        ))

    total_persons = len(persons)
    compliant_count = sum(1 for p in persons if p.is_compliant)
    total_compliant_days = sum(p.days_compliant for p in persons)
    total_person_days = total_persons * total_days
    compliance_rate = total_compliant_days / total_person_days if total_person_days > 0 else 1.0
    return RoleWIPSummary(
        role=role,
        canonical_status=canonical_status,
        wip_limit=wip_limit,
        total_persons=total_persons,
        persons_compliant=compliant_count,
        persons_over_limit=total_persons - compliant_count,
        compliance_rate=round(compliance_rate, 4),
        persons=persons,
    )


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

    for day_idx, day in enumerate(days):
        for d in deliverables:
            state, canonical_from_timeline, assignee = _assignee_and_state_on_day(d, day)
            if state is None or assignee is None:
                continue
            canonical = canonical_from_timeline or real_to_canonical.get(state)
            if canonical == "Development Active":
                dev_daily_totals[assignee][day_idx] += 1
                dev_daily_per_state[assignee][state][day_idx] += 1
            elif canonical == "QA Active":
                qa_daily_totals[assignee][day_idx] += 1
                qa_daily_per_state[assignee][state][day_idx] += 1

    dev_summary = _build_role_summary(
        dev_daily_totals, dev_daily_per_state,
        config.dev_wip_limit, config.compliance_threshold,
        total_days, "developer", "Development Active",
    )
    qa_summary = _build_role_summary(
        qa_daily_totals, qa_daily_per_state,
        config.qa_wip_limit, config.compliance_threshold,
        total_days, "qa", "QA Active",
    )

    dev_compliant = sum(p.days_compliant for p in dev_summary.persons)
    qa_compliant = sum(p.days_compliant for p in qa_summary.persons)
    dev_total = dev_summary.total_persons * total_days
    qa_total = qa_summary.total_persons * total_days
    total_hours = dev_total + qa_total
    value = (dev_compliant + qa_compliant) / total_hours if total_hours > 0 else 1.0

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
        developers=dev_summary,
        qas=qa_summary,
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
    team_kpis: list,
    config: ReworkRateConfig | DeliveryPredictabilityConfig | FlowHygieneConfig | WIPDisciplineConfig,
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

    if isinstance(config, (DeliveryPredictabilityConfig, WIPDisciplineConfig)):
        rag = _rag_higher_is_better(avg, config)
    elif isinstance(config, FlowHygieneConfig):
        rag = _rag_flow_hygiene(avg, config)
    else:
        rag = _rag_lower_is_better(avg, config)

    display = f"{avg:.2f}" if isinstance(config, FlowHygieneConfig) else f"{avg * 100:.1f}%"
    return AverageKPI(
        name=kpi_name,
        value=round(avg, 4),
        display=display,
        rag=rag,
        team_count=len(team_kpis),
    )


# ---------------------------------------------------------------------------
# Drilldown filtering
# ---------------------------------------------------------------------------

_REWORK_METRICS = frozenset({
    "items_reached_qa", "items_with_rework", "items_bounced_back", "items_with_bugs",
})

_DP_METRICS = frozenset({
    "items_committed", "items_deployed", "items_started_in_period", "items_spillover",
})

_FH_METRICS = frozenset({
    "items_in_queue",
})

_WD_METRICS = frozenset({
    "developer_assignments", "qa_assignments",
})

VALID_DRILLDOWN_METRICS = _REWORK_METRICS | _DP_METRICS | _FH_METRICS | _WD_METRICS


def filter_deliverables_by_metric(
    deliverables: list[DeliverableRow],
    metric: str,
    rework_config: ReworkRateConfig | None = None,
    dp_config: DeliveryPredictabilityConfig | None = None,
    fh_config: FlowHygieneConfig | None = None,
    start: date | None = None,
    end: date | None = None,
    person: str | None = None,
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

    if metric in _FH_METRICS:
        if fh_config is None:
            raise ValueError("fh_config required for flow hygiene metrics")
        queue_states = frozenset(fh_config.queue_states)
        if metric == "items_in_queue":
            return [d for d in deliverables if _was_in_queue_states(d, queue_states)]

    if metric in _WD_METRICS:
        if metric == "developer_assignments":
            result = [d for d in deliverables if d.developer is not None]
            if person:
                person_lower = person.lower()
                result = [d for d in result if (d.developer or "").lower() == person_lower]
            return result
        if metric == "qa_assignments":
            result = [d for d in deliverables if d.qa is not None]
            if person:
                person_lower = person.lower()
                result = [d for d in result if (d.qa or "").lower() == person_lower]
            return result

    return []
