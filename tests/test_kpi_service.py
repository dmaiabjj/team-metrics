"""Unit tests for KPI computation functions."""

from __future__ import annotations

import pytest

from app.config.kpi_loader import RAGThresholds, ReworkRateConfig
from app.schemas.kpi import RAGStatus, ReworkRateKPI
from app.schemas.report import DeliverableRow, StatusTimelineEntry, WorkItemRef
from app.services.kpi_service import (
    compute_kpi_average,
    compute_rework_rate,
    filter_deliverables_by_metric,
)

_DEFAULT_CONFIG = ReworkRateConfig(
    enabled=True,
    description="test",
    formula="test",
    rag=RAGThresholds(green_max=0.10, amber_max=0.15),
    rework_tags=["Code Defect", "Scope / Requirements"],
    qa_canonical_status="QA Active",
)


def _make_deliverable(
    wid: int = 1,
    timeline_canons: list[str] | None = None,
    tags: list[str] | None = None,
    bounces: int = 0,
    child_bugs: list[WorkItemRef] | None = None,
) -> DeliverableRow:
    timeline = []
    if timeline_canons:
        from datetime import datetime, timezone
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
        status_timeline=timeline,
        tags=tags or [],
        bounces=bounces,
        child_bugs=child_bugs or [],
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


class TestFilterDeliverablesByMetric:
    def test_items_reached_qa(self):
        items = [
            _make_deliverable(1, ["QA Active"]),
            _make_deliverable(2, ["Development Active"]),
            _make_deliverable(3, ["Development Active", "QA Active"]),
        ]
        result = filter_deliverables_by_metric(items, "items_reached_qa", _DEFAULT_CONFIG)
        assert len(result) == 2
        assert {d.id for d in result} == {1, 3}

    def test_items_with_rework(self):
        items = [
            _make_deliverable(1, ["QA Active"], tags=["Code Defect"]),
            _make_deliverable(2, ["QA Active"]),
            _make_deliverable(3, ["QA Active"], tags=["Scope / Requirements"]),
        ]
        result = filter_deliverables_by_metric(items, "items_with_rework", _DEFAULT_CONFIG)
        assert len(result) == 2
        assert {d.id for d in result} == {1, 3}

    def test_items_bounced_back(self):
        items = [
            _make_deliverable(1, ["QA Active"], bounces=1),
            _make_deliverable(2, ["QA Active"], bounces=0),
        ]
        result = filter_deliverables_by_metric(items, "items_bounced_back", _DEFAULT_CONFIG)
        assert len(result) == 1
        assert result[0].id == 1

    def test_items_with_bugs(self):
        items = [
            _make_deliverable(1, ["QA Active"], child_bugs=[WorkItemRef(id=100)]),
            _make_deliverable(2, ["QA Active"]),
        ]
        result = filter_deliverables_by_metric(items, "items_with_bugs", _DEFAULT_CONFIG)
        assert len(result) == 1
        assert result[0].id == 1

    def test_unknown_metric_raises(self):
        with pytest.raises(ValueError, match="Unknown metric"):
            filter_deliverables_by_metric([], "invalid_metric", _DEFAULT_CONFIG)
