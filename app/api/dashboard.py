"""Dashboard endpoint -- cross-team KPI averages + per-team breakdown."""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from app.api.helpers import (
    fetch_all_reports,
    fetch_deploy_frequency_deployments,
    get_azure_client,
    get_deployment_cache,
    resolve_wip_limits,
    validate_date_range,
)
from app.auth import require_api_key
from app.config.dora_loader import get_deploy_frequency_config, load_dora_config
from app.config.kpi_loader import get_team_kpi_overrides, load_kpi_config
from app.config.team_loader import get_team_config
from app.schemas.kpi import (
    AverageKPI,
    DashboardResponse,
    TeamError,
    TeamKPIEntry,
)
from app.schemas.report import ErrorResponse
from app.schemas.snapshot import DeliverySnapshot
from app.services.dora_service import (
    compute_deploy_frequency,
    compute_dora_average,
    compute_lead_time,
)
from app.services.kpi_service import (
    compute_delivery_predictability,
    compute_flow_hygiene,
    compute_initiative_delivery,
    compute_kpi_average,
    compute_reliability_action_delivery,
    compute_rework_rate,
    compute_tech_debt_ratio,
    compute_wip_discipline,
)
from app.services.snapshot_service import compute_delivery_snapshot

logger = logging.getLogger(__name__)

_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid date range"},
    503: {"model": ErrorResponse, "description": "Azure DevOps not configured"},
}

from app.rate_limit import limiter

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.get("", response_model=DashboardResponse, response_model_exclude_none=True, responses=_ERROR_RESPONSES)
@limiter.limit("10/minute")
async def get_dashboard(
    request: Request,
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
) -> DashboardResponse:
    """Cross-team KPI averages and per-team breakdown."""
    team_ids, results = await fetch_all_reports(request, start_date, end_date)
    kpi_config = load_kpi_config()
    azure_client = get_azure_client(request)
    dora_config = load_dora_config()
    deployment_cache = get_deployment_cache(request)

    # --- Pre-resolve all Azure-dependent data concurrently ---
    wip_tasks: dict[str, asyncio.Task] = {}
    deploy_tasks: dict[str, asyncio.Task] = {}

    for tid, result in zip(team_ids, results):
        if isinstance(result, Exception):
            continue
        team_config = get_team_config(tid)
        if team_config is None:
            continue

        if kpi_config.flow_hygiene.enabled:
            kpi_overrides = get_team_kpi_overrides(tid)
            wip_tasks[tid] = asyncio.create_task(
                resolve_wip_limits(
                    azure_client, team_config, kpi_config.flow_hygiene,
                    wip_limits_override=kpi_overrides.wip_limits,
                )
            )

        if dora_config.deploy_frequency.enabled:
            df_team = get_deploy_frequency_config(tid)
            has_config = df_team and (
                df_team.definition_environment_ids
                or (df_team.definition_ids and (df_team.environment_name or df_team.environment_guid))
            )
            if has_config:
                deploy_tasks[tid] = asyncio.create_task(
                    fetch_deploy_frequency_deployments(
                        azure_client, df_team, team_config.project,
                        start_date, end_date,
                        team_id=tid, deployment_cache=deployment_cache,
                    )
                )

    # Await all Azure tasks concurrently
    all_tasks = list(wip_tasks.values()) + list(deploy_tasks.values())
    if all_tasks:
        await asyncio.gather(*all_tasks, return_exceptions=True)

    # --- Compute KPIs using pre-fetched data ---
    team_entries: list[TeamKPIEntry] = []
    team_errors: list[TeamError] = []
    all_snapshots: list[DeliverySnapshot] = []
    kpis_by_type: dict[str, list] = {}

    for tid, result in zip(team_ids, results):
        if isinstance(result, Exception):
            logger.warning("Team %s failed: %s", tid, result)
            team_errors.append(TeamError(team_id=tid, error=str(result)))
            continue
        report = result
        team_config = get_team_config(tid)
        snapshot = compute_delivery_snapshot(
            report.deliverables, kpi_config, start_date, end_date,
        )
        all_snapshots.append(snapshot)
        kpis: list = []

        if kpi_config.rework_rate.enabled:
            rw = compute_rework_rate(report.deliverables, kpi_config.rework_rate)
            kpis.append(rw)
            kpis_by_type.setdefault("rework_rate", []).append(rw)
        if kpi_config.delivery_predictability.enabled:
            dp = compute_delivery_predictability(
                report.deliverables, kpi_config.delivery_predictability,
                start_date, end_date,
            )
            kpis.append(dp)
            kpis_by_type.setdefault("delivery_predictability", []).append(dp)
        if kpi_config.flow_hygiene.enabled and team_config is not None:
            wip_task = wip_tasks.get(tid)
            if wip_task is not None:
                try:
                    wip_limits = wip_task.result()
                    fh = compute_flow_hygiene(
                        report.deliverables, kpi_config.flow_hygiene,
                        wip_limits, start_date, end_date,
                    )
                    kpis.append(fh.model_copy(update={"states": None}))
                    kpis_by_type.setdefault("flow_hygiene", []).append(fh)
                except Exception:
                    logger.warning("WIP limits failed for team %s", tid, exc_info=True)
        if kpi_config.wip_discipline.enabled and team_config is not None:
            wd = compute_wip_discipline(
                report.deliverables, kpi_config.wip_discipline,
                team_config, start_date, end_date,
            )
            kpis.append(wd.model_copy(update={"persons": None}))
            kpis_by_type.setdefault("wip_discipline", []).append(wd)
        if kpi_config.tech_debt_ratio.enabled:
            td = compute_tech_debt_ratio(
                report.deliverables, kpi_config.tech_debt_ratio,
            )
            kpis.append(td)
            kpis_by_type.setdefault("tech_debt_ratio", []).append(td)
        if kpi_config.initiative_delivery.enabled and team_config is not None:
            id_overrides = get_team_kpi_overrides(tid)
            id_kpi = compute_initiative_delivery(
                report.deliverables, kpi_config.initiative_delivery, team_config,
                id_overrides.initiative_ids, start_date, end_date,
            )
            kpis.append(id_kpi)
            kpis_by_type.setdefault("initiative_delivery", []).append(id_kpi)
        if kpi_config.reliability_action_delivery.enabled:
            rad_kpi = compute_reliability_action_delivery(
                report.deliverables, kpi_config.reliability_action_delivery,
            )
            kpis.append(rad_kpi)
            kpis_by_type.setdefault("reliability_action_delivery", []).append(rad_kpi)

        dora: list = []
        if dora_config.deploy_frequency.enabled:
            df_deployments: list = []
            deploy_task = deploy_tasks.get(tid)
            if deploy_task is not None:
                try:
                    df_deployments, _ = deploy_task.result()
                except Exception:
                    pass
            df_kpi = compute_deploy_frequency(
                df_deployments, dora_config.deploy_frequency, start_date, end_date,
            )
            dora.append(df_kpi)
            kpis_by_type.setdefault("deploy_frequency", []).append(df_kpi)
        if dora_config.lead_time.enabled:
            lt_kpi = compute_lead_time(
                report.deliverables, dora_config.lead_time, start_date, end_date,
            )
            dora.append(lt_kpi)
            kpis_by_type.setdefault("lead_time", []).append(lt_kpi)

        team_entries.append(TeamKPIEntry(
            team_id=report.team_id, delivery_snapshot=snapshot, kpis=kpis, dora=dora,
        ))

    agg_snapshot = DeliverySnapshot(
        delivered=sum(s.delivered for s in all_snapshots),
        committed=sum(s.committed for s in all_snapshots),
        committed_in_period=sum(s.committed_in_period for s in all_snapshots),
        spillovers=sum(s.spillovers for s in all_snapshots),
        rework_items=sum(s.rework_items for s in all_snapshots),
        tech_debts=sum(s.tech_debts for s in all_snapshots),
        bugs=sum(s.bugs for s in all_snapshots),
    )

    kpi_averages: list[AverageKPI] = []
    for name, cfg in [
        ("rework_rate", kpi_config.rework_rate),
        ("delivery_predictability", kpi_config.delivery_predictability),
        ("flow_hygiene", kpi_config.flow_hygiene),
        ("wip_discipline", kpi_config.wip_discipline),
        ("tech_debt_ratio", kpi_config.tech_debt_ratio),
        ("initiative_delivery", kpi_config.initiative_delivery),
        ("reliability_action_delivery", kpi_config.reliability_action_delivery),
    ]:
        items = kpis_by_type.get(name, [])
        if cfg.enabled and items:
            kpi_averages.append(compute_kpi_average(name, items, cfg))

    dora_averages: list[AverageKPI] = []
    if dora_config.deploy_frequency.enabled and kpis_by_type.get("deploy_frequency"):
        dora_averages.append(
            compute_dora_average(
                "deploy_frequency", kpis_by_type["deploy_frequency"],
                dora_config.deploy_frequency,
            )
        )
    if dora_config.lead_time.enabled and kpis_by_type.get("lead_time"):
        dora_averages.append(
            compute_dora_average(
                "lead_time", kpis_by_type["lead_time"], dora_config.lead_time,
            )
        )

    return DashboardResponse(
        start_date=start_date,
        end_date=end_date,
        delivery_snapshot=agg_snapshot,
        kpis=kpi_averages,
        dora=dora_averages,
        teams=team_entries,
        errors=team_errors,
    )
