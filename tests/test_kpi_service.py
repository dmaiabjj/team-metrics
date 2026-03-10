"""Unit tests for KPI computation functions."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app.config.kpi_loader import (
    DeliveryPredictabilityConfig,
    FlowHygieneConfig,
    FlowHygieneRAGThresholds,
    InitiativeDeliveryConfig,
    KPIConfig,
    RAGThresholds,
    RAGThresholdsHigherIsBetter,
    ReworkRateConfig,
    TechDebtRatioBandRAG,
    TechDebtRatioConfig,
    WIPDisciplineConfig,
)
from app.config.team_loader import StateMapping, TeamConfig
from app.schemas.kpi import DeliveryPredictabilityKPI, FlowHygieneKPI, RAGStatus, ReworkRateKPI, TechDebtRatioKPI
from app.schemas.report import DeliverableRow, StatusTimelineEntry, WorkItemRef
from app.services.kpi_service import (
    compute_delivery_predictability,
    compute_flow_hygiene,
    compute_initiative_delivery,
    compute_kpi_average,
    compute_rework_rate,
    compute_tech_debt_ratio,
    compute_wip_discipline,
    filter_deliverables_by_metric,
)
from app.services.snapshot_service import compute_delivery_snapshot, filter_snapshot_metric

_DEFAULT_CONFIG = ReworkRateConfig(
    enabled=True,
    description="test",
    formula="test",
    rag=RAGThresholds(green_max=0.10, amber_max=0.15),
    rework_tags=["Code Defect", "Scope / Requirements"],
    qa_canonical_status="QA Active",
)

_DEFAULT_DP_CONFIG = DeliveryPredictabilityConfig(
    enabled=True,
    description="test",
    formula="test",
    rag=RAGThresholdsHigherIsBetter(green_min=0.85, amber_min=0.70),
    delivered_canonical_status="Delivered",
)


def _make_deliverable(
    wid: int = 1,
    timeline_canons: list[str] | None = None,
    tags: list[str] | None = None,
    bounces: int = 0,
    child_bugs: list[WorkItemRef] | None = None,
    is_spillover: bool = False,
    start_date: datetime | None = None,
    status_at_end: str | None = None,
    canonical_status: str | None = None,
    developer: str | None = None,
    qa: str | None = None,
    is_technical_debt: bool = False,
) -> DeliverableRow:
    timeline = []
    if timeline_canons:
        for i, canon in enumerate(timeline_canons):
            timeline.append(StatusTimelineEntry(
                date=datetime(2025, 1, 1 + i, tzinfo=timezone.utc),
                state=f"state_{canon}",
                canonical_status=canon,
            ))
    return DeliverableRow(
        id=wid,
        work_item_type="User Story",
        title=f"Item {wid}",
        state="Active",
        canonical_status=canonical_status,
        status_timeline=timeline,
        tags=tags or [],
        bounces=bounces,
        child_bugs=child_bugs or [],
        is_spillover=is_spillover,
        start_date=start_date,
        status_at_end=status_at_end,
        developer=developer,
        qa=qa,
        is_technical_debt=is_technical_debt,
    )


class TestComputeReworkRate:
    def test_empty_deliverables(self):
        result = compute_rework_rate([], _DEFAULT_CONFIG)
        assert result.value == 0.0
        assert result.rag == RAGStatus.GREEN
        assert result.items_reached_qa == 0
        assert result.items_with_rework == 0

    def test_all_reached_qa_none_rework(self):
        items = [_make_deliverable(i, ["Development Active", "QA Active"]) for i in range(10)]
        result = compute_rework_rate(items, _DEFAULT_CONFIG)
        assert result.value == 0.0
        assert result.rag == RAGStatus.GREEN
        assert result.items_reached_qa == 10
        assert result.items_with_rework == 0

    def test_boundary_green(self):
        qa_items = [_make_deliverable(i, ["QA Active"]) for i in range(50)]
        qa_items[0].tags = ["Code Defect"]
        qa_items[1].tags = ["Code Defect"]
        qa_items[2].tags = ["Code Defect"]
        qa_items[3].tags = ["Code Defect"]
        qa_items[4].tags = ["Code Defect"]
        result = compute_rework_rate(qa_items, _DEFAULT_CONFIG)
        assert result.value == pytest.approx(0.10)
        assert result.rag == RAGStatus.GREEN
        assert result.items_with_rework == 5
        assert result.items_reached_qa == 50

    def test_amber_range(self):
        qa_items = [_make_deliverable(i, ["QA Active"]) for i in range(100)]
        for i in range(12):
            qa_items[i].tags = ["Code Defect"]
        result = compute_rework_rate(qa_items, _DEFAULT_CONFIG)
        assert result.value == pytest.approx(0.12)
        assert result.rag == RAGStatus.AMBER

    def test_red_above_threshold(self):
        qa_items = [_make_deliverable(i, ["QA Active"]) for i in range(50)]
        for i in range(12):
            qa_items[i].tags = ["Code Defect"]
        result = compute_rework_rate(qa_items, _DEFAULT_CONFIG)
        assert result.value == pytest.approx(0.24)
        assert result.rag == RAGStatus.RED

    def test_scope_requirements_counts_as_rework(self):
        items = [
            _make_deliverable(1, ["QA Active"], tags=["Scope / Requirements"], bounces=1),
            _make_deliverable(2, ["QA Active"]),
        ]
        result = compute_rework_rate(items, _DEFAULT_CONFIG)
        assert result.items_with_rework == 1
        assert result.value == pytest.approx(0.5)

    def test_bug_count_aggregation(self):
        items = [
            _make_deliverable(1, ["QA Active"], child_bugs=[
                WorkItemRef(id=100, title="Bug A"),
                WorkItemRef(id=101, title="Bug B"),
            ]),
            _make_deliverable(2, ["QA Active"], child_bugs=[
                WorkItemRef(id=200, title="Bug C"),
            ]),
        ]
        result = compute_rework_rate(items, _DEFAULT_CONFIG)
        assert result.total_bugs == 3

    def test_items_not_in_qa_excluded_from_denominator(self):
        items = [
            _make_deliverable(1, ["Development Active"]),
            _make_deliverable(2, ["QA Active"], tags=["Code Defect"]),
        ]
        result = compute_rework_rate(items, _DEFAULT_CONFIG)
        assert result.items_reached_qa == 1
        assert result.items_with_rework == 1
        assert result.value == pytest.approx(1.0)

    def test_custom_thresholds(self):
        config = ReworkRateConfig(
            enabled=True,
            rag=RAGThresholds(green_max=0.20, amber_max=0.30),
            rework_tags=["Code Defect"],
            qa_canonical_status="QA Active",
        )
        qa_items = [_make_deliverable(i, ["QA Active"]) for i in range(10)]
        qa_items[0].tags = ["Code Defect"]
        qa_items[1].tags = ["Code Defect"]
        result = compute_rework_rate(qa_items, config)
        assert result.value == pytest.approx(0.20)
        assert result.rag == RAGStatus.GREEN

    def test_bounced_back_count(self):
        items = [
            _make_deliverable(1, ["QA Active"], bounces=2),
            _make_deliverable(2, ["QA Active"], bounces=0),
            _make_deliverable(3, ["QA Active"], bounces=1),
        ]
        result = compute_rework_rate(items, _DEFAULT_CONFIG)
        assert result.items_bounced_back == 2


class TestComputeDeliveryPredictability:
    _period_start = date(2025, 1, 1)
    _period_end = date(2025, 1, 31)

    def test_empty_deliverables(self):
        result = compute_delivery_predictability(
            [], _DEFAULT_DP_CONFIG, self._period_start, self._period_end,
        )
        assert result.value == 0.0
        assert result.rag == RAGStatus.RED
        assert result.items_committed == 0

    def test_all_deployed(self):
        items = [
            _make_deliverable(i, start_date=datetime(2025, 1, 5, tzinfo=timezone.utc), canonical_status="Delivered")
            for i in range(10)
        ]
        result = compute_delivery_predictability(
            items, _DEFAULT_DP_CONFIG, self._period_start, self._period_end,
        )
        assert result.value == pytest.approx(1.0)
        assert result.rag == RAGStatus.GREEN
        assert result.items_committed == 10
        assert result.items_deployed == 10
        assert result.items_started_in_period == 10
        assert result.items_spillover == 0

    def test_none_deployed(self):
        items = [
            _make_deliverable(i, start_date=datetime(2025, 1, 5, tzinfo=timezone.utc), canonical_status="Development Active")
            for i in range(10)
        ]
        result = compute_delivery_predictability(
            items, _DEFAULT_DP_CONFIG, self._period_start, self._period_end,
        )
        assert result.value == 0.0
        assert result.rag == RAGStatus.RED
        assert result.items_committed == 10
        assert result.items_deployed == 0

    def test_mixed_started_and_spillover(self):
        items = [
            _make_deliverable(1, start_date=datetime(2025, 1, 10, tzinfo=timezone.utc), canonical_status="Delivered"),
            _make_deliverable(2, start_date=datetime(2025, 1, 12, tzinfo=timezone.utc), canonical_status="Development Active"),
            _make_deliverable(3, is_spillover=True, canonical_status="Delivered"),
            _make_deliverable(4, is_spillover=True, canonical_status="QA Active"),
        ]
        result = compute_delivery_predictability(
            items, _DEFAULT_DP_CONFIG, self._period_start, self._period_end,
        )
        assert result.items_committed == 4
        assert result.items_deployed == 2
        assert result.items_started_in_period == 2
        assert result.items_spillover == 2
        assert result.value == pytest.approx(0.5)
        assert result.rag == RAGStatus.RED

    def test_green_boundary(self):
        started = [
            _make_deliverable(i, start_date=datetime(2025, 1, 5, tzinfo=timezone.utc), canonical_status="Delivered")
            for i in range(85)
        ]
        not_deployed = [
            _make_deliverable(100 + i, start_date=datetime(2025, 1, 5, tzinfo=timezone.utc), canonical_status="Development Active")
            for i in range(15)
        ]
        result = compute_delivery_predictability(
            started + not_deployed, _DEFAULT_DP_CONFIG, self._period_start, self._period_end,
        )
        assert result.value == pytest.approx(0.85)
        assert result.rag == RAGStatus.GREEN

    def test_amber_range(self):
        deployed = [
            _make_deliverable(i, start_date=datetime(2025, 1, 5, tzinfo=timezone.utc), canonical_status="Delivered")
            for i in range(75)
        ]
        remaining = [
            _make_deliverable(100 + i, start_date=datetime(2025, 1, 5, tzinfo=timezone.utc), canonical_status="Development Active")
            for i in range(25)
        ]
        result = compute_delivery_predictability(
            deployed + remaining, _DEFAULT_DP_CONFIG, self._period_start, self._period_end,
        )
        assert result.value == pytest.approx(0.75)
        assert result.rag == RAGStatus.AMBER

    def test_items_outside_period_not_counted(self):
        items = [
            _make_deliverable(1, start_date=datetime(2025, 1, 15, tzinfo=timezone.utc), canonical_status="Delivered"),
            _make_deliverable(2, start_date=datetime(2024, 12, 1, tzinfo=timezone.utc), canonical_status="Delivered"),
        ]
        result = compute_delivery_predictability(
            items, _DEFAULT_DP_CONFIG, self._period_start, self._period_end,
        )
        assert result.items_committed == 1
        assert result.items_deployed == 1

    def test_custom_thresholds(self):
        config = DeliveryPredictabilityConfig(
            enabled=True,
            rag=RAGThresholdsHigherIsBetter(green_min=0.90, amber_min=0.80),
            delivered_canonical_status="Delivered",
        )
        items = [
            _make_deliverable(i, start_date=datetime(2025, 1, 5, tzinfo=timezone.utc), canonical_status="Delivered")
            for i in range(85)
        ] + [
            _make_deliverable(100 + i, start_date=datetime(2025, 1, 5, tzinfo=timezone.utc), canonical_status="Development Active")
            for i in range(15)
        ]
        result = compute_delivery_predictability(
            items, config, self._period_start, self._period_end,
        )
        assert result.value == pytest.approx(0.85)
        assert result.rag == RAGStatus.AMBER


class TestComputeKpiAverage:
    def _make_kpi(self, value: float) -> ReworkRateKPI:
        return ReworkRateKPI(
            value=value,
            display=f"{value * 100:.1f}%",
            rag=RAGStatus.GREEN,
            items_with_rework=0,
            items_reached_qa=10,
            items_bounced_back=0,
            total_bugs=0,
        )

    def test_average_of_three_teams(self):
        kpis = [self._make_kpi(0.05), self._make_kpi(0.10), self._make_kpi(0.15)]
        result = compute_kpi_average("rework_rate", kpis, _DEFAULT_CONFIG)
        assert result.value == pytest.approx(0.10)
        assert result.rag == RAGStatus.GREEN
        assert result.team_count == 3

    def test_single_team(self):
        kpis = [self._make_kpi(0.12)]
        result = compute_kpi_average("rework_rate", kpis, _DEFAULT_CONFIG)
        assert result.value == pytest.approx(0.12)
        assert result.rag == RAGStatus.AMBER

    def test_empty_list(self):
        result = compute_kpi_average("rework_rate", [], _DEFAULT_CONFIG)
        assert result.value == 0.0
        assert result.rag == RAGStatus.GREEN
        assert result.team_count == 0

    def test_dp_average(self):
        kpis = [
            DeliveryPredictabilityKPI(
                value=0.90, display="90.0%", rag=RAGStatus.GREEN,
                items_committed=20, items_deployed=18,
                items_started_in_period=15, items_spillover=5,
            ),
            DeliveryPredictabilityKPI(
                value=0.70, display="70.0%", rag=RAGStatus.AMBER,
                items_committed=10, items_deployed=7,
                items_started_in_period=8, items_spillover=2,
            ),
        ]
        result = compute_kpi_average("delivery_predictability", kpis, _DEFAULT_DP_CONFIG)
        assert result.value == pytest.approx(0.80)
        assert result.rag == RAGStatus.AMBER
        assert result.team_count == 2


class TestFilterDeliverablesByMetric:
    def test_items_reached_qa(self):
        items = [
            _make_deliverable(1, ["QA Active"]),
            _make_deliverable(2, ["Development Active"]),
            _make_deliverable(3, ["Development Active", "QA Active"]),
        ]
        result = filter_deliverables_by_metric(items, "items_reached_qa", rework_config=_DEFAULT_CONFIG)
        assert len(result) == 2
        assert {d.id for d in result} == {1, 3}

    def test_items_with_rework(self):
        items = [
            _make_deliverable(1, ["QA Active"], tags=["Code Defect"]),
            _make_deliverable(2, ["QA Active"]),
            _make_deliverable(3, ["QA Active"], tags=["Scope / Requirements"]),
        ]
        result = filter_deliverables_by_metric(items, "items_with_rework", rework_config=_DEFAULT_CONFIG)
        assert len(result) == 2
        assert {d.id for d in result} == {1, 3}

    def test_items_bounced_back(self):
        items = [
            _make_deliverable(1, ["QA Active"], bounces=1),
            _make_deliverable(2, ["QA Active"], bounces=0),
        ]
        result = filter_deliverables_by_metric(items, "items_bounced_back", rework_config=_DEFAULT_CONFIG)
        assert len(result) == 1
        assert result[0].id == 1

    def test_items_with_bugs(self):
        items = [
            _make_deliverable(1, ["QA Active"], child_bugs=[WorkItemRef(id=100)]),
            _make_deliverable(2, ["QA Active"]),
        ]
        result = filter_deliverables_by_metric(items, "items_with_bugs", rework_config=_DEFAULT_CONFIG)
        assert len(result) == 1
        assert result[0].id == 1

    def test_unknown_metric_raises(self):
        with pytest.raises(ValueError, match="Unknown metric"):
            filter_deliverables_by_metric([], "invalid_metric", rework_config=_DEFAULT_CONFIG)

    def test_dp_items_committed(self):
        items = [
            _make_deliverable(1, start_date=datetime(2025, 1, 15, tzinfo=timezone.utc)),
            _make_deliverable(2, is_spillover=True),
            _make_deliverable(3, start_date=datetime(2024, 12, 1, tzinfo=timezone.utc)),
        ]
        result = filter_deliverables_by_metric(
            items, "items_committed",
            dp_config=_DEFAULT_DP_CONFIG, start=date(2025, 1, 1), end=date(2025, 1, 31),
        )
        assert len(result) == 2
        assert {d.id for d in result} == {1, 2}

    def test_dp_items_deployed(self):
        items = [
            _make_deliverable(1, start_date=datetime(2025, 1, 10, tzinfo=timezone.utc), canonical_status="Delivered"),
            _make_deliverable(2, is_spillover=True, canonical_status="Development Active"),
            _make_deliverable(3, is_spillover=True, canonical_status="Delivered"),
        ]
        result = filter_deliverables_by_metric(
            items, "items_deployed",
            dp_config=_DEFAULT_DP_CONFIG, start=date(2025, 1, 1), end=date(2025, 1, 31),
        )
        assert len(result) == 2
        assert {d.id for d in result} == {1, 3}

    def test_dp_items_started_in_period(self):
        items = [
            _make_deliverable(1, start_date=datetime(2025, 1, 15, tzinfo=timezone.utc)),
            _make_deliverable(2, is_spillover=True),
        ]
        result = filter_deliverables_by_metric(
            items, "items_started_in_period",
            dp_config=_DEFAULT_DP_CONFIG, start=date(2025, 1, 1), end=date(2025, 1, 31),
        )
        assert len(result) == 1
        assert result[0].id == 1

    def test_dp_items_spillover(self):
        items = [
            _make_deliverable(1, start_date=datetime(2025, 1, 15, tzinfo=timezone.utc)),
            _make_deliverable(2, is_spillover=True),
            _make_deliverable(3, is_spillover=True),
        ]
        result = filter_deliverables_by_metric(
            items, "items_spillover",
            dp_config=_DEFAULT_DP_CONFIG, start=date(2025, 1, 1), end=date(2025, 1, 31),
        )
        assert len(result) == 2
        assert {d.id for d in result} == {2, 3}

    def test_fh_items_in_queue(self):
        fh_config = _DEFAULT_FH_CONFIG
        items = [
            _make_fh_deliverable(1, [("2025-01-01", "Active"), ("2025-01-05", "Ready for QA")]),
            _make_fh_deliverable(2, [("2025-01-01", "Active"), ("2025-01-10", "In QA")]),
            _make_fh_deliverable(3, [("2025-01-01", "New")]),
        ]
        result = filter_deliverables_by_metric(
            items, "items_in_queue", fh_config=fh_config,
        )
        assert len(result) == 1
        assert result[0].id == 1


# ---------------------------------------------------------------------------
# Flow Hygiene defaults
# ---------------------------------------------------------------------------

_DEFAULT_FH_CONFIG = FlowHygieneConfig(
    enabled=True,
    description="test",
    formula="test",
    queue_states=["Ready for QA"],
    default_wip_limits={"Ready for QA": 3},
    rag=FlowHygieneRAGThresholds(green_max=1.0, amber_max=1.2),
)


def _make_fh_deliverable(
    wid: int,
    state_transitions: list[tuple[str, str]],
) -> DeliverableRow:
    """Create a deliverable with specific state transitions for flow hygiene tests.

    state_transitions: list of (date_str "YYYY-MM-DD", state_name).
    """
    timeline = [
        StatusTimelineEntry(
            date=datetime.fromisoformat(dt + "T00:00:00+00:00"),
            state=state,
            canonical_status=None,
        )
        for dt, state in state_transitions
    ]
    return DeliverableRow(
        id=wid,
        work_item_type="User Story",
        title=f"Item {wid}",
        state=state_transitions[-1][1] if state_transitions else "New",
        status_timeline=timeline,
    )


# ---------------------------------------------------------------------------
# Flow Hygiene computation
# ---------------------------------------------------------------------------

class TestComputeFlowHygiene:
    def test_empty_deliverables(self):
        result = compute_flow_hygiene(
            [], _DEFAULT_FH_CONFIG,
            {"Ready for QA": (3, "global_default")},
            date(2025, 1, 1), date(2025, 1, 3),
        )
        assert result.name == "flow_hygiene"
        assert result.value == 0.0
        assert result.rag == RAGStatus.GREEN
        assert result.total_days == 3
        assert len(result.states) == 1
        assert result.states[0].avg_items == 0.0

    def test_items_in_queue_full_period(self):
        """Two items in 'Ready for QA' for all 3 days, limit=3."""
        items = [
            _make_fh_deliverable(1, [("2024-12-30", "Ready for QA")]),
            _make_fh_deliverable(2, [("2024-12-31", "Ready for QA")]),
        ]
        result = compute_flow_hygiene(
            items, _DEFAULT_FH_CONFIG,
            {"Ready for QA": (3, "team_config")},
            date(2025, 1, 1), date(2025, 1, 3),
        )
        assert result.total_days == 3
        s = result.states[0]
        assert s.state == "Ready for QA"
        assert s.avg_items == 2.0
        assert s.peak_items == 2
        assert s.wip_limit == 3
        assert s.wip_limit_source == "team_config"
        assert round(s.queue_load, 4) == round(2.0 / 3, 4)
        assert s.days_over_limit == 0
        assert result.rag == RAGStatus.GREEN

    def test_over_limit_causes_amber(self):
        """3 items in queue, limit=2 -> load = 1.5 > 1.2 -> RED."""
        cfg = FlowHygieneConfig(
            enabled=True,
            queue_states=["Ready for QA"],
            default_wip_limits={"Ready for QA": 2},
            rag=FlowHygieneRAGThresholds(green_max=1.0, amber_max=1.2),
        )
        items = [
            _make_fh_deliverable(i, [("2024-12-30", "Ready for QA")])
            for i in range(1, 4)
        ]
        result = compute_flow_hygiene(
            items, cfg,
            {"Ready for QA": (2, "azure_devops")},
            date(2025, 1, 1), date(2025, 1, 1),
        )
        assert result.value == 1.5
        assert result.rag == RAGStatus.RED
        assert result.states[0].days_over_limit == 1

    def test_amber_range(self):
        """Load of exactly 1.1 -> AMBER."""
        items = [
            _make_fh_deliverable(1, [("2024-12-30", "Ready for QA")]),
        ]
        result = compute_flow_hygiene(
            items, _DEFAULT_FH_CONFIG,
            {"Ready for QA": (1, "global_default")},
            date(2025, 1, 1), date(2025, 1, 1),
        )
        assert result.value == 1.0
        assert result.rag == RAGStatus.GREEN

    def test_items_transition_mid_period(self):
        """Item enters queue on day 2 of a 3-day period -> avg = 2/3."""
        items = [
            _make_fh_deliverable(1, [("2025-01-01", "Active"), ("2025-01-02", "Ready for QA")]),
        ]
        result = compute_flow_hygiene(
            items, _DEFAULT_FH_CONFIG,
            {"Ready for QA": (3, "global_default")},
            date(2025, 1, 1), date(2025, 1, 3),
        )
        s = result.states[0]
        assert round(s.avg_items, 2) == round(2 / 3, 2)
        assert s.peak_items == 1

    def test_worst_state_wins(self):
        """With two queue states, overall value = max queue_load."""
        cfg = FlowHygieneConfig(
            enabled=True,
            queue_states=["Ready for QA", "Code Review"],
            default_wip_limits={"Ready for QA": 3, "Code Review": 2},
            rag=FlowHygieneRAGThresholds(green_max=1.0, amber_max=1.2),
        )
        items = [
            _make_fh_deliverable(1, [("2024-12-30", "Ready for QA")]),
            _make_fh_deliverable(2, [("2024-12-30", "Code Review")]),
            _make_fh_deliverable(3, [("2024-12-30", "Code Review")]),
            _make_fh_deliverable(4, [("2024-12-30", "Code Review")]),
        ]
        result = compute_flow_hygiene(
            items, cfg,
            {"Ready for QA": (3, "global_default"), "Code Review": (2, "global_default")},
            date(2025, 1, 1), date(2025, 1, 1),
        )
        rfq_state = next(s for s in result.states if s.state == "Ready for QA")
        cr_state = next(s for s in result.states if s.state == "Code Review")
        assert round(rfq_state.queue_load, 4) == round(1 / 3, 4)
        assert cr_state.queue_load == 1.5
        assert result.value == 1.5
        assert result.rag == RAGStatus.RED


# ---------------------------------------------------------------------------
# WIP Discipline defaults
# ---------------------------------------------------------------------------

_DEFAULT_WD_CONFIG = WIPDisciplineConfig(
    enabled=True,
    description="test",
    formula="test",
    dev_wip_limit=3,
    qa_wip_limit=2,
    compliance_threshold=0.80,
    rag=RAGThresholdsHigherIsBetter(green_min=0.80, amber_min=0.60),
)

_DEFAULT_TEAM_CONFIG = TeamConfig(
    project="test-project",
    states=[
        StateMapping(canonical_status="Development Active", real_states=["Active", "Code Review", "Blocked"]),
        StateMapping(canonical_status="QA Active", real_states=["Ready for QA", "In QA"]),
        StateMapping(canonical_status="Delivered", real_states=["Closed"]),
        StateMapping(canonical_status="Backlog", real_states=["New"]),
    ],
)


def _make_wd_deliverable(
    wid: int,
    state_transitions: list[tuple[str, str, str, str | None]],
    developer: str | None = None,
    qa: str | None = None,
) -> DeliverableRow:
    """Create a deliverable for WIP discipline tests.

    state_transitions: list of (date_str, state, canonical_status, assigned_to).
    """
    timeline = [
        StatusTimelineEntry(
            date=datetime.fromisoformat(dt + "T00:00:00+00:00"),
            state=state,
            canonical_status=canonical,
            assigned_to=assignee,
        )
        for dt, state, canonical, assignee in state_transitions
    ]
    last_state = state_transitions[-1][1] if state_transitions else "New"
    return DeliverableRow(
        id=wid,
        work_item_type="User Story",
        title=f"Item {wid}",
        state=last_state,
        status_timeline=timeline,
        developer=developer,
        qa=qa,
    )


class TestComputeWIPDiscipline:
    def test_empty_deliverables(self):
        result = compute_wip_discipline(
            [], _DEFAULT_WD_CONFIG, _DEFAULT_TEAM_CONFIG,
            date(2025, 1, 1), date(2025, 1, 3),
        )
        assert result.name == "wip_discipline"
        assert result.value == 1.0
        assert result.rag == RAGStatus.GREEN
        assert result.total_developers == 0
        assert result.total_qas == 0
        assert result.persons == []

    def test_all_devs_compliant(self):
        """2 devs each with <= 3 items for all 3 days -> 100% compliant."""
        items = [
            _make_wd_deliverable(1, [("2024-12-30", "Active", "Development Active", "Alice")]),
            _make_wd_deliverable(2, [("2024-12-30", "Active", "Development Active", "Alice")]),
            _make_wd_deliverable(3, [("2024-12-30", "Active", "Development Active", "Bob")]),
        ]
        result = compute_wip_discipline(
            items, _DEFAULT_WD_CONFIG, _DEFAULT_TEAM_CONFIG,
            date(2025, 1, 1), date(2025, 1, 3),
        )
        assert result.total_developers == 2
        assert result.developers_compliant == 2
        assert result.value == 1.0
        assert result.rag == RAGStatus.GREEN

    def test_dev_over_limit(self):
        """Alice has 4 items (limit=3) for all 3 days -> not compliant.
        Bob has 1 -> compliant. Dev compliance = 50%."""
        items = [
            _make_wd_deliverable(i, [("2024-12-30", "Active", "Development Active", "Alice")])
            for i in range(1, 5)
        ] + [
            _make_wd_deliverable(5, [("2024-12-30", "Active", "Development Active", "Bob")]),
        ]
        result = compute_wip_discipline(
            items, _DEFAULT_WD_CONFIG, _DEFAULT_TEAM_CONFIG,
            date(2025, 1, 1), date(2025, 1, 3),
        )
        assert result.total_developers == 2
        assert result.developers_compliant == 1
        devs = [p for p in result.persons if p.role == "developer"]
        alice = next(p for p in devs if p.person == "Alice")
        assert alice.is_compliant is False
        assert alice.peak_wip == 4

    def test_qa_worse_than_dev(self):
        """Devs all compliant but QA over limit -> value = compliant_hours / total_hours.
        Dev1: 1 compliant day. QA1: 0 compliant days. Total = (1+0)/(1+1) = 0.5."""
        items = [
            _make_wd_deliverable(1, [("2024-12-30", "Active", "Development Active", "Dev1")]),
            _make_wd_deliverable(2, [("2024-12-30", "In QA", "QA Active", "QA1")]),
            _make_wd_deliverable(3, [("2024-12-30", "In QA", "QA Active", "QA1")]),
            _make_wd_deliverable(4, [("2024-12-30", "In QA", "QA Active", "QA1")]),
        ]
        result = compute_wip_discipline(
            items, _DEFAULT_WD_CONFIG, _DEFAULT_TEAM_CONFIG,
            date(2025, 1, 1), date(2025, 1, 1),
        )
        assert result.developers_compliant == 1
        assert result.qas_compliant == 0
        assert result.value == 0.5
        assert result.rag == RAGStatus.RED

    def test_status_breakdown_by_real_state(self):
        """Alice has items in Active and Code Review -> breakdown shows both."""
        items = [
            _make_wd_deliverable(1, [("2024-12-30", "Active", "Development Active", "Alice")]),
            _make_wd_deliverable(2, [("2024-12-30", "Code Review", "Development Active", "Alice")]),
        ]
        result = compute_wip_discipline(
            items, _DEFAULT_WD_CONFIG, _DEFAULT_TEAM_CONFIG,
            date(2025, 1, 1), date(2025, 1, 1),
        )
        alice = next(p for p in result.persons if p.person == "Alice")
        assert alice.role == "developer"
        states = {b.state: b.avg_items for b in alice.status_breakdown}
        assert "Active" in states
        assert "Code Review" in states
        assert states["Active"] == 1.0
        assert states["Code Review"] == 1.0
        assert alice.avg_wip == 2.0

    def test_mid_period_transition(self):
        """Item moves from Dev Active to QA Active mid-period."""
        items = [
            _make_wd_deliverable(1, [
                ("2025-01-01", "Active", "Development Active", "Alice"),
                ("2025-01-02", "In QA", "QA Active", "Bob"),
            ]),
        ]
        result = compute_wip_discipline(
            items, _DEFAULT_WD_CONFIG, _DEFAULT_TEAM_CONFIG,
            date(2025, 1, 1), date(2025, 1, 3),
        )
        alice = next(p for p in result.persons if p.person == "Alice")
        assert alice.role == "developer"
        assert alice.avg_wip == pytest.approx(1 / 3, abs=0.01)
        bob = next(p for p in result.persons if p.person == "Bob")
        assert bob.role == "qa"
        assert bob.avg_wip == pytest.approx(2 / 3, abs=0.01)

    def test_compliance_threshold_boundary(self):
        """Dev over limit exactly 1 out of 5 days = 80% compliant -> passes."""
        items = [
            _make_wd_deliverable(1, [("2024-12-30", "Active", "Development Active", "Alice")]),
            _make_wd_deliverable(2, [("2024-12-30", "Active", "Development Active", "Alice")]),
            _make_wd_deliverable(3, [("2024-12-30", "Active", "Development Active", "Alice")]),
            _make_wd_deliverable(4, [
                ("2025-01-01", "Active", "Development Active", "Alice"),
                ("2025-01-02", "Closed", "Delivered", "Alice"),
            ]),
        ]
        result = compute_wip_discipline(
            items, _DEFAULT_WD_CONFIG, _DEFAULT_TEAM_CONFIG,
            date(2025, 1, 1), date(2025, 1, 5),
        )
        alice = next(p for p in result.persons if p.person == "Alice")
        assert alice.days_over_limit == 1
        assert alice.days_compliant == 4
        assert alice.compliance_pct == 0.8
        assert alice.is_compliant is True


class TestFilterWDMetrics:
    def test_developers(self):
        items = [
            _make_deliverable(1, developer="Alice"),
            _make_deliverable(2, developer="Bob"),
            _make_deliverable(3, developer=None),
        ]
        result = filter_deliverables_by_metric(items, "developers")
        assert len(result) == 2
        assert {d.id for d in result} == {1, 2}

    def test_developers_with_person_filter(self):
        items = [
            _make_deliverable(1, developer="Alice"),
            _make_deliverable(2, developer="Bob"),
            _make_deliverable(3, developer="Alice"),
        ]
        result = filter_deliverables_by_metric(items, "developers", person="Alice")
        assert len(result) == 2
        assert all(d.developer == "Alice" for d in result)

    def test_qas(self):
        items = [
            _make_deliverable(1, qa="Charlie"),
            _make_deliverable(2, qa=None),
        ]
        result = filter_deliverables_by_metric(items, "qas")
        assert len(result) == 1
        assert result[0].id == 1

    def test_qas_with_person_filter(self):
        items = [
            _make_deliverable(1, qa="Charlie"),
            _make_deliverable(2, qa="Dave"),
        ]
        result = filter_deliverables_by_metric(items, "qas", person="Charlie")
        assert len(result) == 1
        assert result[0].qa == "Charlie"

    def test_compliant_gte_80(self):
        """Items assigned to compliant persons are returned."""
        items = [
            _make_wd_deliverable(
                1, [("2024-12-30", "Active", "Development Active", "Alice")],
                developer="Alice",
            ),
            _make_wd_deliverable(
                2, [("2024-12-30", "Active", "Development Active", "Alice")],
                developer="Alice",
            ),
            _make_wd_deliverable(
                3, [("2024-12-30", "Active", "Development Active", "Bob")],
                developer="Bob",
            ),
        ]
        result = filter_deliverables_by_metric(
            items, "compliant_gte_80",
            wd_config=_DEFAULT_WD_CONFIG,
            team_config=_DEFAULT_TEAM_CONFIG,
            start=date(2025, 1, 1), end=date(2025, 1, 1),
        )
        assert len(result) == 3

    def test_over_wip_limit(self):
        """Alice has 4 items (limit=3) -> over limit -> items returned."""
        items = [
            _make_wd_deliverable(
                i, [("2024-12-30", "Active", "Development Active", "Alice")],
                developer="Alice",
            )
            for i in range(1, 5)
        ] + [
            _make_wd_deliverable(
                5, [("2024-12-30", "Active", "Development Active", "Bob")],
                developer="Bob",
            ),
        ]
        result = filter_deliverables_by_metric(
            items, "over_wip_limit",
            wd_config=_DEFAULT_WD_CONFIG,
            team_config=_DEFAULT_TEAM_CONFIG,
            start=date(2025, 1, 1), end=date(2025, 1, 1),
        )
        assert {d.id for d in result} == {1, 2, 3, 4}


# ---------------------------------------------------------------------------
# Tech Debt Ratio defaults
# ---------------------------------------------------------------------------

_DEFAULT_TD_CONFIG = TechDebtRatioConfig(
    enabled=True,
    description="test",
    formula="test",
    delivered_canonical_status="Delivered",
    rag=TechDebtRatioBandRAG(amber_min=0.10, green_min=0.20, green_max=0.30),
)


class TestComputeTechDebtRatio:
    def test_empty_deliverables(self):
        result = compute_tech_debt_ratio([], _DEFAULT_TD_CONFIG)
        assert result.name == "tech_debt_ratio"
        assert result.value == 0.0
        assert result.rag == RAGStatus.RED
        assert result.tech_debt_count == 0
        assert result.total_deployed == 0

    def test_no_tech_debt(self):
        """0% tech debt -> below amber_min -> RED."""
        items = [
            _make_deliverable(i, canonical_status="Delivered")
            for i in range(10)
        ]
        result = compute_tech_debt_ratio(items, _DEFAULT_TD_CONFIG)
        assert result.value == 0.0
        assert result.rag == RAGStatus.RED
        assert result.tech_debt_count == 0
        assert result.total_deployed == 10

    def test_all_tech_debt(self):
        """100% tech debt -> above green_max -> RED."""
        items = [
            _make_deliverable(i, canonical_status="Delivered", is_technical_debt=True)
            for i in range(5)
        ]
        result = compute_tech_debt_ratio(items, _DEFAULT_TD_CONFIG)
        assert result.value == 1.0
        assert result.rag == RAGStatus.RED
        assert result.tech_debt_count == 5
        assert result.total_deployed == 5

    def test_red_below_amber_min(self):
        """5% tech debt -> below 10% amber_min -> RED."""
        deployed = [
            _make_deliverable(i, canonical_status="Delivered")
            for i in range(100)
        ]
        for i in range(5):
            deployed[i].is_technical_debt = True
        result = compute_tech_debt_ratio(deployed, _DEFAULT_TD_CONFIG)
        assert result.value == pytest.approx(0.05)
        assert result.rag == RAGStatus.RED

    def test_amber_range(self):
        """15% tech debt -> in [10%, 20%) -> AMBER."""
        deployed = [
            _make_deliverable(i, canonical_status="Delivered")
            for i in range(100)
        ]
        for i in range(15):
            deployed[i].is_technical_debt = True
        result = compute_tech_debt_ratio(deployed, _DEFAULT_TD_CONFIG)
        assert result.value == pytest.approx(0.15)
        assert result.rag == RAGStatus.AMBER

    def test_amber_at_boundary(self):
        """10% tech debt -> exactly amber_min -> AMBER."""
        deployed = [
            _make_deliverable(i, canonical_status="Delivered")
            for i in range(100)
        ]
        for i in range(10):
            deployed[i].is_technical_debt = True
        result = compute_tech_debt_ratio(deployed, _DEFAULT_TD_CONFIG)
        assert result.value == pytest.approx(0.10)
        assert result.rag == RAGStatus.AMBER

    def test_green_at_lower_boundary(self):
        """20% tech debt -> exactly green_min -> GREEN."""
        deployed = [
            _make_deliverable(i, canonical_status="Delivered")
            for i in range(100)
        ]
        for i in range(20):
            deployed[i].is_technical_debt = True
        result = compute_tech_debt_ratio(deployed, _DEFAULT_TD_CONFIG)
        assert result.value == pytest.approx(0.20)
        assert result.rag == RAGStatus.GREEN

    def test_green_at_upper_boundary(self):
        """30% tech debt -> exactly green_max -> GREEN."""
        deployed = [
            _make_deliverable(i, canonical_status="Delivered")
            for i in range(100)
        ]
        for i in range(30):
            deployed[i].is_technical_debt = True
        result = compute_tech_debt_ratio(deployed, _DEFAULT_TD_CONFIG)
        assert result.value == pytest.approx(0.30)
        assert result.rag == RAGStatus.GREEN

    def test_red_above_green_max(self):
        """35% tech debt -> above 30% green_max -> RED."""
        deployed = [
            _make_deliverable(i, canonical_status="Delivered")
            for i in range(100)
        ]
        for i in range(35):
            deployed[i].is_technical_debt = True
        result = compute_tech_debt_ratio(deployed, _DEFAULT_TD_CONFIG)
        assert result.value == pytest.approx(0.35)
        assert result.rag == RAGStatus.RED

    def test_non_delivered_items_excluded(self):
        """Only 'Delivered' items count, others are excluded from ratio."""
        items = [
            _make_deliverable(1, canonical_status="Delivered", is_technical_debt=True),
            _make_deliverable(2, canonical_status="Delivered"),
            _make_deliverable(3, canonical_status="Development Active", is_technical_debt=True),
            _make_deliverable(4, canonical_status="QA Active"),
        ]
        result = compute_tech_debt_ratio(items, _DEFAULT_TD_CONFIG)
        assert result.total_deployed == 2
        assert result.tech_debt_count == 1
        assert result.value == pytest.approx(0.5)

    def test_display_format(self):
        items = [
            _make_deliverable(1, canonical_status="Delivered", is_technical_debt=True),
            _make_deliverable(2, canonical_status="Delivered"),
        ]
        result = compute_tech_debt_ratio(items, _DEFAULT_TD_CONFIG)
        assert result.display == "50.0%"


class TestFilterTDMetrics:
    def test_tech_debt_deployed(self):
        items = [
            _make_deliverable(1, canonical_status="Delivered", is_technical_debt=True),
            _make_deliverable(2, canonical_status="Delivered"),
            _make_deliverable(3, canonical_status="Development Active", is_technical_debt=True),
        ]
        result = filter_deliverables_by_metric(
            items, "tech_debt_deployed", td_config=_DEFAULT_TD_CONFIG,
        )
        assert len(result) == 1
        assert result[0].id == 1

    def test_non_tech_debt_deployed(self):
        items = [
            _make_deliverable(1, canonical_status="Delivered", is_technical_debt=True),
            _make_deliverable(2, canonical_status="Delivered"),
            _make_deliverable(3, canonical_status="Delivered"),
        ]
        result = filter_deliverables_by_metric(
            items, "non_tech_debt_deployed", td_config=_DEFAULT_TD_CONFIG,
        )
        assert len(result) == 2
        assert {d.id for d in result} == {2, 3}

    def test_td_config_required(self):
        with pytest.raises(ValueError, match="td_config required"):
            filter_deliverables_by_metric([], "tech_debt_deployed")


# ---------------------------------------------------------------------------
# Delivery Snapshot
# ---------------------------------------------------------------------------

_DEFAULT_KPI_CONFIG = KPIConfig(
    rework_rate=_DEFAULT_CONFIG,
    delivery_predictability=_DEFAULT_DP_CONFIG,
    flow_hygiene=FlowHygieneConfig(
        enabled=True,
        queue_states=["Ready for QA"],
        default_wip_limits={"Ready for QA": 3},
        rag=FlowHygieneRAGThresholds(green_max=1.0, amber_max=1.2),
    ),
    wip_discipline=WIPDisciplineConfig(
        enabled=True,
        dev_wip_limit=3,
        qa_wip_limit=2,
        compliance_threshold=0.80,
        rag=RAGThresholdsHigherIsBetter(green_min=0.80, amber_min=0.60),
    ),
    tech_debt_ratio=_DEFAULT_TD_CONFIG,
)


class TestComputeDeliverySnapshot:
    _start = date(2025, 1, 1)
    _end = date(2025, 1, 31)

    def test_empty_deliverables(self):
        result = compute_delivery_snapshot([], _DEFAULT_KPI_CONFIG, self._start, self._end)
        assert result.delivered == 0
        assert result.committed == 0
        assert result.committed_in_period == 0
        assert result.spillovers == 0
        assert result.rework_items == 0
        assert result.tech_debts == 0
        assert result.bugs == 0

    def test_all_metrics(self):
        items = [
            _make_deliverable(
                1, timeline_canons=["QA Active"], tags=["Code Defect"],
                start_date=datetime(2025, 1, 5, tzinfo=timezone.utc),
                canonical_status="Delivered", is_technical_debt=True,
                child_bugs=[WorkItemRef(id=100, title="Bug A")],
            ),
            _make_deliverable(
                2, start_date=datetime(2025, 1, 10, tzinfo=timezone.utc),
                canonical_status="Delivered",
            ),
            _make_deliverable(
                3, is_spillover=True, canonical_status="Development Active",
                is_technical_debt=True,
            ),
            _make_deliverable(
                4, start_date=datetime(2025, 1, 15, tzinfo=timezone.utc),
                canonical_status="QA Active",
                child_bugs=[WorkItemRef(id=200, title="Bug B")],
            ),
        ]
        result = compute_delivery_snapshot(items, _DEFAULT_KPI_CONFIG, self._start, self._end)
        assert result.committed == 4
        assert result.committed_in_period == 3
        assert result.delivered == 2
        assert result.spillovers == 1
        assert result.rework_items == 1
        assert result.tech_debts == 2
        assert result.bugs == 2

    def test_only_committed_counted_for_delivered(self):
        """Items outside the period are not committed and cannot be delivered."""
        items = [
            _make_deliverable(
                1, start_date=datetime(2024, 12, 1, tzinfo=timezone.utc),
                canonical_status="Delivered",
            ),
        ]
        result = compute_delivery_snapshot(items, _DEFAULT_KPI_CONFIG, self._start, self._end)
        assert result.committed == 0
        assert result.delivered == 0


class TestFilterSnapshotMetric:
    _start = date(2025, 1, 1)
    _end = date(2025, 1, 31)

    def _items(self):
        return [
            _make_deliverable(
                1, timeline_canons=["QA Active"], tags=["Code Defect"],
                start_date=datetime(2025, 1, 5, tzinfo=timezone.utc),
                canonical_status="Delivered", is_technical_debt=True,
                child_bugs=[WorkItemRef(id=100, title="Bug A")],
            ),
            _make_deliverable(
                2, start_date=datetime(2025, 1, 10, tzinfo=timezone.utc),
                canonical_status="Delivered",
            ),
            _make_deliverable(
                3, is_spillover=True, canonical_status="Development Active",
                is_technical_debt=True,
            ),
            _make_deliverable(
                4, start_date=datetime(2025, 1, 15, tzinfo=timezone.utc),
                canonical_status="QA Active",
                child_bugs=[WorkItemRef(id=200, title="Bug B")],
            ),
        ]

    def test_delivered(self):
        result = filter_snapshot_metric(self._items(), "delivered", _DEFAULT_KPI_CONFIG, self._start, self._end)
        assert {d.id for d in result} == {1, 2}

    def test_committed(self):
        result = filter_snapshot_metric(self._items(), "committed", _DEFAULT_KPI_CONFIG, self._start, self._end)
        assert {d.id for d in result} == {1, 2, 3, 4}

    def test_committed_in_period(self):
        result = filter_snapshot_metric(self._items(), "committed_in_period", _DEFAULT_KPI_CONFIG, self._start, self._end)
        assert {d.id for d in result} == {1, 2, 4}

    def test_spillovers(self):
        result = filter_snapshot_metric(self._items(), "spillovers", _DEFAULT_KPI_CONFIG, self._start, self._end)
        assert {d.id for d in result} == {3}

    def test_rework_items(self):
        result = filter_snapshot_metric(self._items(), "rework_items", _DEFAULT_KPI_CONFIG, self._start, self._end)
        assert {d.id for d in result} == {1}

    def test_tech_debts(self):
        result = filter_snapshot_metric(self._items(), "tech_debts", _DEFAULT_KPI_CONFIG, self._start, self._end)
        assert {d.id for d in result} == {1, 3}

    def test_bugs(self):
        result = filter_snapshot_metric(self._items(), "bugs", _DEFAULT_KPI_CONFIG, self._start, self._end)
        assert {d.id for d in result} == {1, 4}

    def test_invalid_metric(self):
        with pytest.raises(ValueError, match="Unknown snapshot metric"):
            filter_snapshot_metric([], "invalid", _DEFAULT_KPI_CONFIG, self._start, self._end)


# ---------------------------------------------------------------------------
# Initiative Delivery
# ---------------------------------------------------------------------------

_DEFAULT_ID_CONFIG = InitiativeDeliveryConfig(
    enabled=True,
    delivered_canonical_status="Delivered",
    rag=RAGThresholdsHigherIsBetter(green_min=0.85, amber_min=0.70),
)

_DEFAULT_TEAM_CONFIG = TeamConfig(
    project="test",
    area_paths=["test"],
    deliverable_types=["User Story"],
    container_types=["Epic", "Feature"],
    bug_types=["Bug"],
    states=[
        StateMapping(canonical_status="Delivered", real_states=["Closed", "Resolved", "Release Candidate"]),
        StateMapping(canonical_status="Development Active", real_states=["Active"]),
        StateMapping(canonical_status="QA Active", real_states=["In QA"]),
    ],
)


class TestComputeInitiativeDelivery:
    def test_empty_deliverables(self):
        result = compute_initiative_delivery(
            [], _DEFAULT_ID_CONFIG, _DEFAULT_TEAM_CONFIG, [],
            date(2025, 1, 1), date(2025, 1, 31),
        )
        assert result.name == "initiative_delivery"
        assert result.value == 0.0
        assert result.initiatives_committed == 0
        assert result.initiatives_delivered == 0
        assert result.rag == RAGStatus.RED

    def test_all_delivered(self):
        """2 deliverables under initiatives, both committed and delivered -> 100%."""
        d1 = _make_deliverable(1, start_date=datetime(2025, 1, 5, tzinfo=timezone.utc), canonical_status="Delivered")
        d1.parent_epic = WorkItemRef(id=100, title="Epic A", state="Closed")
        d2 = _make_deliverable(2, start_date=datetime(2025, 1, 10, tzinfo=timezone.utc), canonical_status="Delivered")
        d2.parent_epic = WorkItemRef(id=101, title="Epic B", state="Resolved")
        items = [d1, d2]
        result = compute_initiative_delivery(
            items, _DEFAULT_ID_CONFIG, _DEFAULT_TEAM_CONFIG, [100, 101],
            date(2025, 1, 1), date(2025, 1, 31),
        )
        assert result.initiatives_committed == 2
        assert result.initiatives_delivered == 2
        assert result.value == 1.0
        assert result.rag == RAGStatus.GREEN

    def test_partial_delivery(self):
        """2 deliverables under initiatives committed, 1 delivered -> 50%."""
        d1 = _make_deliverable(1, start_date=datetime(2025, 1, 5, tzinfo=timezone.utc), canonical_status="Delivered")
        d1.parent_epic = WorkItemRef(id=100, title="Epic A", state="Closed")
        d2 = _make_deliverable(2, start_date=datetime(2025, 1, 10, tzinfo=timezone.utc), canonical_status="Development Active")
        d2.parent_epic = WorkItemRef(id=101, title="Epic B", state="Active")
        items = [d1, d2]
        result = compute_initiative_delivery(
            items, _DEFAULT_ID_CONFIG, _DEFAULT_TEAM_CONFIG, [100, 101],
            date(2025, 1, 1), date(2025, 1, 31),
        )
        assert result.initiatives_committed == 2
        assert result.initiatives_delivered == 1
        assert result.value == 0.5
        assert result.rag == RAGStatus.RED

    def test_empty_initiative_ids_counts_nothing(self):
        """When initiative_ids is empty, count nothing even with deliverables."""
        d1 = _make_deliverable(1, start_date=datetime(2025, 1, 5, tzinfo=timezone.utc))
        d1.parent_epic = WorkItemRef(id=100, title="Epic A", state="Closed")
        d2 = _make_deliverable(2, start_date=datetime(2025, 1, 10, tzinfo=timezone.utc))
        d2.parent_epic = WorkItemRef(id=101, title="Epic B", state="Resolved")
        items = [d1, d2]
        result = compute_initiative_delivery(
            items, _DEFAULT_ID_CONFIG, _DEFAULT_TEAM_CONFIG, [],
            date(2025, 1, 1), date(2025, 1, 31),
        )
        assert result.initiatives_committed == 0
        assert result.initiatives_delivered == 0
        assert result.value == 0.0

    def test_filter_by_initiative_ids(self):
        """Only count deliverables under initiative_ids when set."""
        d1 = _make_deliverable(1, start_date=datetime(2025, 1, 5, tzinfo=timezone.utc), canonical_status="Delivered")
        d1.parent_epic = WorkItemRef(id=100, title="Epic A", state="Closed")
        d2 = _make_deliverable(2, start_date=datetime(2025, 1, 10, tzinfo=timezone.utc))
        d2.parent_epic = WorkItemRef(id=101, title="Epic B", state="Active")
        items = [d1, d2]
        result = compute_initiative_delivery(
            items, _DEFAULT_ID_CONFIG, _DEFAULT_TEAM_CONFIG, [100],
            date(2025, 1, 1), date(2025, 1, 31),
        )
        assert result.initiatives_committed == 1
        assert result.initiatives_delivered == 1
        assert result.value == 1.0
