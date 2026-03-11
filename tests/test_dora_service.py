"""Unit tests for DORA metrics computation."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app.config.dora_loader import (
    DeployFrequencyConfig,
    DeployFrequencyRAG,
    LeadTimeConfig,
    LeadTimeRAG,
)
from app.schemas.common import RAGStatus
from app.schemas.report import DeliverableRow, StatusTimelineEntry
from app.services.dora_service import (
    compute_deploy_frequency,
    compute_dora_average,
    compute_lead_time,
    deployments_to_summaries,
    filter_dora_metric,
)

_DF_CONFIG = DeployFrequencyConfig(
    enabled=True,
    description="test",
    formula="deployment_count / period_days",
    rag=DeployFrequencyRAG(green_min=1.0, amber_min=0.25),
)

_LT_CONFIG = LeadTimeConfig(
    enabled=True,
    description="test",
    formula="avg(finish_date - start_date)",
    delivered_canonical_status="Delivered",
    rag=LeadTimeRAG(green_max=7.0, amber_max=14.0),
)


def _make_deliverable(
    wid: int = 1,
    canonical_status: str = "Delivered",
    start_date: datetime | None = None,
    finish_date: datetime | None = None,
    date_created: datetime | None = None,
    is_spillover: bool = False,
) -> DeliverableRow:
    return DeliverableRow(
        id=wid,
        work_item_type="User Story",
        title=f"Item {wid}",
        state="Closed",
        canonical_status=canonical_status,
        start_date=start_date,
        finish_date=finish_date,
        date_created=date_created,
        is_spillover=is_spillover,
        status_timeline=[
            StatusTimelineEntry(
                date=start_date or datetime(2025, 1, 1, tzinfo=timezone.utc),
                state="Active",
                canonical_status="Under Development",
            ),
            StatusTimelineEntry(
                date=finish_date or datetime(2025, 1, 10, tzinfo=timezone.utc),
                state="Closed",
                canonical_status="Delivered",
            ),
        ],
    )


class TestComputeDeployFrequency:
    def test_empty_deployments(self):
        result = compute_deploy_frequency(
            [], _DF_CONFIG, date(2025, 1, 1), date(2025, 1, 31),
        )
        assert result.value == 0.0
        assert result.rag == RAGStatus.RED
        assert result.deployment_count == 0
        assert result.period_days == 31

    def test_green_threshold(self):
        deployments = [{"id": i} for i in range(31)]
        result = compute_deploy_frequency(
            deployments, _DF_CONFIG, date(2025, 1, 1), date(2025, 1, 31),
        )
        assert result.value == pytest.approx(1.0)
        assert result.rag == RAGStatus.GREEN
        assert result.deployment_count == 31

    def test_amber_threshold(self):
        deployments = [{"id": i} for i in range(10)]
        result = compute_deploy_frequency(
            deployments, _DF_CONFIG, date(2025, 1, 1), date(2025, 1, 31),
        )
        assert result.value == pytest.approx(10 / 31, rel=1e-2)
        assert result.rag == RAGStatus.AMBER

    def test_red_below_amber(self):
        deployments = [{"id": 1}]
        result = compute_deploy_frequency(
            deployments, _DF_CONFIG, date(2025, 1, 1), date(2025, 1, 31),
        )
        assert result.value == pytest.approx(1 / 31, rel=1e-2)
        assert result.rag == RAGStatus.RED


class TestComputeLeadTime:
    def test_empty_deliverables(self):
        result = compute_lead_time([], _LT_CONFIG, date(2025, 1, 1), date(2025, 1, 31))
        assert result.value == 0.0
        assert result.rag == RAGStatus.GREEN
        assert result.sample_size == 0

    def test_lead_time_amber(self):
        start = datetime(2025, 1, 2, tzinfo=timezone.utc)
        finish = datetime(2025, 1, 10, tzinfo=timezone.utc)
        d = _make_deliverable(
            wid=1, canonical_status="Delivered",
            start_date=start, finish_date=finish, date_created=start, is_spillover=False,
        )
        result = compute_lead_time([d], _LT_CONFIG, date(2025, 1, 1), date(2025, 1, 31))
        assert result.sample_size == 1
        assert result.lead_time_days == pytest.approx(8.0)
        assert result.rag == RAGStatus.AMBER

    def test_lead_time_avg_median_p90(self):
        base = datetime(2025, 1, 1, tzinfo=timezone.utc)
        items = []
        for i in range(5):
            s = base.replace(day=1 + i)
            f = base.replace(day=6 + i)
            d = _make_deliverable(i + 1, "Delivered", s, f, s, False)
            d.start_date = s
            d.finish_date = f
            d.date_created = s
            items.append(d)
        result = compute_lead_time(items, _LT_CONFIG, date(2025, 1, 1), date(2025, 1, 31))
        assert result.sample_size == 5
        assert result.lead_time_days == 5.0
        assert result.median_lead_time_days == 5.0
        assert result.cycle_time_days == 5.0

    def test_committed_and_delivered_filter(self):
        start = datetime(2025, 1, 5, tzinfo=timezone.utc)
        finish = datetime(2025, 1, 7, tzinfo=timezone.utc)
        delivered = _make_deliverable(1, "Delivered", start, finish, start, False)
        delivered.start_date = start
        delivered.finish_date = finish
        not_delivered = _make_deliverable(2, "Under Development", start, None, start, False)
        not_delivered.finish_date = None
        result = compute_lead_time(
            [delivered, not_delivered], _LT_CONFIG, date(2025, 1, 1), date(2025, 1, 31),
        )
        assert result.sample_size == 1


class TestComputeDoraAverage:
    def test_empty_deploy_frequency(self):
        result = compute_dora_average("deploy_frequency", [], _DF_CONFIG)
        assert result.value == 0.0
        assert result.team_count == 0
        assert "deploys/day" in result.display

    def test_empty_lead_time(self):
        result = compute_dora_average("lead_time", [], _LT_CONFIG)
        assert result.value == 0.0
        assert result.team_count == 0
        assert "days" in result.display

    def test_average_deploy_frequency(self):
        from app.schemas.dora import DeployFrequencyKPI

        kpis = [
            DeployFrequencyKPI(value=1.0, display="1.0", rag=RAGStatus.GREEN, deployment_count=10, period_days=10, thresholds={}),
            DeployFrequencyKPI(value=2.0, display="2.0", rag=RAGStatus.GREEN, deployment_count=20, period_days=10, thresholds={}),
        ]
        result = compute_dora_average("deploy_frequency", kpis, _DF_CONFIG)
        assert result.value == pytest.approx(1.5)
        assert result.team_count == 2

    def test_average_lead_time(self):
        from app.schemas.dora import LeadTimeKPI

        kpis = [
            LeadTimeKPI(value=5.0, display="5.0", rag=RAGStatus.GREEN, lead_time_days=5.0, cycle_time_days=5.0,
                       median_lead_time_days=5.0, median_cycle_time_days=5.0, p90_lead_time_days=5.0, p90_cycle_time_days=5.0,
                       sample_size=10, thresholds={}),
            LeadTimeKPI(value=7.0, display="7.0", rag=RAGStatus.GREEN, lead_time_days=7.0, cycle_time_days=7.0,
                       median_lead_time_days=7.0, median_cycle_time_days=7.0, p90_lead_time_days=7.0, p90_cycle_time_days=7.0,
                       sample_size=10, thresholds={}),
        ]
        result = compute_dora_average("lead_time", kpis, _LT_CONFIG)
        assert result.value == pytest.approx(6.0)
        assert result.team_count == 2


class TestFilterDoraMetric:
    def test_measured_items(self):
        start = datetime(2025, 1, 5, tzinfo=timezone.utc)
        finish = datetime(2025, 1, 10, tzinfo=timezone.utc)
        d = _make_deliverable(1, "Delivered", start, finish, start, False)
        d.start_date = start
        d.finish_date = finish
        result = filter_dora_metric(
            [d], "measured_items", _LT_CONFIG, date(2025, 1, 1), date(2025, 1, 31),
        )
        assert len(result) == 1
        assert result[0].id == 1

    def test_unknown_metric_raises(self):
        with pytest.raises(ValueError, match="Unknown DORA metric"):
            filter_dora_metric([], "invalid", _LT_CONFIG, date(2025, 1, 1), date(2025, 1, 31))


class TestDeploymentsToSummaries:
    def test_converts_raw_to_summary(self):
        raw = [
            {
                "id": 1,
                "startedOn": "2025-01-15T10:00:00Z",
                "deploymentStatus": "succeeded",
                "release": {"id": 10, "name": "Release-1", "releaseDefinition": {"id": 1, "name": "Def1"}},
                "releaseEnvironment": {"definitionEnvironmentId": 2, "name": "Production"},
            },
        ]
        result = deployments_to_summaries(raw)
        assert len(result) == 1
        assert result[0].id == 1
        assert result[0].release_id == 10
        assert result[0].definition_id == 1
        assert result[0].environment_id == 2
        assert "2025-01-15" in result[0].started_on
        assert result[0].status == "succeeded"

    def test_build_deployments_to_summaries(self):
        from app.services.dora_service import build_deployments_to_summaries

        raw = [
            {
                "buildId": 123,
                "definitionId": 208,
                "startTime": "2025-01-15T10:00:00Z",
                "stageName": "Coreflex PROD",
                "stageId": "de00afe2-3b4b-5d17-8d57-d20dedd3fa47",
                "buildNumber": "20250115.1",
                "definitionName": "my-pipeline",
            },
        ]
        result = build_deployments_to_summaries(raw)
        assert len(result) == 1
        assert result[0].id == 123
        assert result[0].definition_id == 208
        assert result[0].environment_id != 0  # derived from stage GUID
        assert result[0].environment_name == "Coreflex PROD"
        assert result[0].stage_id == "de00afe2-3b4b-5d17-8d57-d20dedd3fa47"
