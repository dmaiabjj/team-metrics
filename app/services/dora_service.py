"""DORA metrics computation: Deploy Frequency and Lead Time."""

from __future__ import annotations

import statistics
from datetime import date, datetime

from app.config.dora_loader import (
    DeployFrequencyConfig,
    LeadTimeConfig,
)
from app.config.team_loader import TeamConfig
from app.schemas.dora import DeployFrequencyKPI, LeadTimeKPI
from app.schemas.kpi import AverageKPI, RAGStatus
from app.schemas.report import DeliverableRow
from app.services.common import committed_items as _committed_items
from app.services.common import date_in_range as _date_in_range


# ---------------------------------------------------------------------------
# Deploy Frequency
# ---------------------------------------------------------------------------


def _rag_deploy_frequency(value: float, config: DeployFrequencyConfig) -> RAGStatus:
    """Higher is better."""
    if value >= config.rag.green_min:
        return RAGStatus.GREEN
    if value >= config.rag.amber_min:
        return RAGStatus.AMBER
    return RAGStatus.RED


def compute_deploy_frequency(
    deployments: list[dict],
    config: DeployFrequencyConfig,
    start: date,
    end: date,
) -> DeployFrequencyKPI:
    """Compute Deploy Frequency KPI from pre-fetched deployments.

    Caller must fetch deployments via azure_client.get_release_deployments()
    and pass them in. period_days = (end - start).days + 1.
    """
    period_days = max(1, (end - start).days + 1)
    deployment_count = len(deployments)
    value = deployment_count / period_days
    rag = _rag_deploy_frequency(value, config)

    green_str = f">= {config.rag.green_min:.1f}"
    amber_str = f">= {config.rag.amber_min:.1f}"

    return DeployFrequencyKPI(
        value=round(value, 4),
        display=f"{value:.2f} deploys/day",
        rag=rag,
        deployment_count=deployment_count,
        period_days=period_days,
        thresholds={
            "green": green_str,
            "amber": amber_str,
            "red": f"< {config.rag.amber_min:.1f}",
        },
    )


# ---------------------------------------------------------------------------
# Lead Time
# ---------------------------------------------------------------------------


def _rag_lead_time(value: float, config: LeadTimeConfig) -> RAGStatus:
    """Lower is better."""
    if value <= config.rag.green_max:
        return RAGStatus.GREEN
    if value <= config.rag.amber_max:
        return RAGStatus.AMBER
    return RAGStatus.RED


def compute_lead_time(
    deliverables: list[DeliverableRow],
    config: LeadTimeConfig,
    start: date,
    end: date,
) -> LeadTimeKPI:
    """Compute Lead Time KPI from deliverables.

    Scope: committed + delivered items with both start_date and finish_date.
    Lead time = finish_date - start_date; cycle time = finish_date - date_created.
    """
    delivered_canonical = config.delivered_canonical_status
    committed = _committed_items(deliverables, start, end)
    measured = [
        d for d in committed
        if d.canonical_status == delivered_canonical
        and d.start_date is not None
        and d.finish_date is not None
    ]

    lead_times: list[float] = []
    cycle_times: list[float] = []

    for d in measured:
        lt_days = (d.finish_date - d.start_date).total_seconds() / 86400
        lead_times.append(lt_days)
        if d.date_created is not None:
            ct_days = (d.finish_date - d.date_created).total_seconds() / 86400
            cycle_times.append(ct_days)

    n = len(lead_times)
    if n == 0:
        return LeadTimeKPI(
            value=0.0,
            display="0.0 days",
            rag=RAGStatus.GREEN,
            lead_time_days=0.0,
            cycle_time_days=0.0,
            median_lead_time_days=0.0,
            median_cycle_time_days=0.0,
            p90_lead_time_days=0.0,
            p90_cycle_time_days=0.0,
            sample_size=0,
            thresholds={
                "green": f"<= {config.rag.green_max:.0f} days",
                "amber": f"<= {config.rag.amber_max:.0f} days",
                "red": f"> {config.rag.amber_max:.0f} days",
            },
        )

    avg_lt = sum(lead_times) / n
    avg_ct = sum(cycle_times) / len(cycle_times) if cycle_times else avg_lt
    median_lt = statistics.median(lead_times)
    median_ct = statistics.median(cycle_times) if cycle_times else median_lt
    sorted_lt = sorted(lead_times)
    sorted_ct = sorted(cycle_times) if cycle_times else sorted_lt
    p90_idx = max(0, int(0.9 * (n - 1)))
    p90_lt = sorted_lt[p90_idx]
    p90_ct = sorted_ct[min(p90_idx, len(sorted_ct) - 1)] if sorted_ct else p90_lt

    rag = _rag_lead_time(avg_lt, config)

    return LeadTimeKPI(
        value=round(avg_lt, 2),
        display=f"{avg_lt:.1f} days",
        rag=rag,
        lead_time_days=round(avg_lt, 2),
        cycle_time_days=round(avg_ct, 2),
        median_lead_time_days=round(median_lt, 2),
        median_cycle_time_days=round(median_ct, 2),
        p90_lead_time_days=round(p90_lt, 2),
        p90_cycle_time_days=round(p90_ct, 2),
        sample_size=n,
        thresholds={
            "green": f"<= {config.rag.green_max:.0f} days",
            "amber": f"<= {config.rag.amber_max:.0f} days",
            "red": f"> {config.rag.amber_max:.0f} days",
        },
    )


# ---------------------------------------------------------------------------
# Cross-team average
# ---------------------------------------------------------------------------


def compute_dora_average(
    kpi_name: str,
    team_kpis: list[DeployFrequencyKPI] | list[LeadTimeKPI],
    config: DeployFrequencyConfig | LeadTimeConfig,
) -> AverageKPI:
    """Compute average DORA KPI across teams."""
    if not team_kpis:
        if isinstance(config, DeployFrequencyConfig):
            return AverageKPI(
                name=kpi_name,
                value=0.0,
                display="0.0 deploys/day",
                rag=RAGStatus.GREEN,
                team_count=0,
            )
        return AverageKPI(
            name=kpi_name,
            value=0.0,
            display="0.0 days",
            rag=RAGStatus.GREEN,
            team_count=0,
        )

    avg = sum(k.value for k in team_kpis) / len(team_kpis)

    if isinstance(config, DeployFrequencyConfig):
        rag = _rag_deploy_frequency(avg, config)
        display = f"{avg:.2f} deploys/day"
    else:
        rag = _rag_lead_time(avg, config)
        display = f"{avg:.1f} days"

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

_LT_METRICS = frozenset({"measured_items"})


def filter_dora_metric(
    deliverables: list[DeliverableRow],
    metric: str,
    lt_config: LeadTimeConfig,
    start: date,
    end: date,
) -> list[DeliverableRow]:
    """Filter deliverables for lead_time drilldown (measured_items)."""
    if metric not in _LT_METRICS:
        raise ValueError(
            f"Unknown DORA metric '{metric}'. Valid: {sorted(_LT_METRICS)}"
        )
    if metric == "measured_items":
        delivered_canonical = lt_config.delivered_canonical_status
        committed = _committed_items(deliverables, start, end)
        return [
            d for d in committed
            if d.canonical_status == delivered_canonical
            and d.start_date is not None
            and d.finish_date is not None
        ]
    return []


def deployments_to_summaries(deployments: list[dict]) -> list:
    """Convert raw Release API deployment dicts to DeploymentSummary for drilldown."""
    from app.schemas.dora import DeploymentSummary

    result: list = []
    for dep in deployments:
        release = dep.get("release") or {}
        release_def = release.get("releaseDefinition") or {}
        env = dep.get("releaseEnvironment") or {}
        result.append(
            DeploymentSummary(
                id=dep.get("id", 0),
                release_id=release.get("id", 0),
                release_name=release.get("name"),
                definition_id=release_def.get("id", 0),
                definition_name=release_def.get("name"),
                environment_id=env.get("definitionEnvironmentId") or env.get("id", 0),
                environment_name=env.get("name"),
                started_on=str(dep.get("startedOn", "")),
                status=str(dep.get("deploymentStatus", "succeeded")),
            )
        )
    return result


def environment_records_to_summaries(records: list[dict]) -> list:
    """Convert Environments API deployment records to DeploymentSummary for drilldown."""
    from app.schemas.dora import DeploymentSummary

    result: list = []
    for i, rec in enumerate(records):
        result.append(
            DeploymentSummary(
                id=rec.get("id", i),
                release_id=0,
                release_name=None,
                definition_id=0,
                definition_name=None,
                environment_id=rec.get("environmentId", 0),
                environment_name=rec.get("stageName"),
                started_on=str(rec.get("startTime", "")),
                status=str(rec.get("result", "succeeded")),
            )
        )
    return result


def _stage_guid_to_int(guid: str | None) -> int:
    """Derive a stable int from a stage GUID for environment_id (Build API)."""
    if not guid:
        return 0
    s = str(guid).replace("-", "")
    if len(s) >= 8:
        try:
            return int(s[:8], 16)
        except ValueError:
            pass
    return 0


def build_deployments_to_summaries(deployments: list[dict]) -> list:
    """Convert Build API deployment dicts (from get_build_deployments_by_stage) to DeploymentSummary."""
    from app.schemas.dora import DeploymentSummary

    result: list = []
    for i, dep in enumerate(deployments):
        stage_id = dep.get("stageId")
        result.append(
            DeploymentSummary(
                id=dep.get("buildId", i),
                release_id=0,
                release_name=dep.get("buildNumber"),
                definition_id=dep.get("definitionId", 0),
                definition_name=dep.get("definitionName"),
                environment_id=_stage_guid_to_int(stage_id),
                environment_name=dep.get("stageName"),
                stage_id=str(stage_id) if stage_id else None,
                started_on=str(dep.get("startTime", "")),
                status="succeeded",
            )
        )
    return result
