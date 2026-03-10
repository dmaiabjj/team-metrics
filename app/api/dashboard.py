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
    resolve_wip_limits,
    validate_date_range,
)
from app.auth import require_api_key
from app.config.dora_loader import load_dora_config
from app.config.kpi_loader import load_kpi_config
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
    compute_kpi_average,
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

    team_entries: list[TeamKPIEntry] = []
    team_errors: list[TeamError] = []
    all_snapshots: list[DeliverySnapshot] = []
    all_rework_kpis = []
    all_dp_kpis = []
    all_fh_kpis = []
    all_wd_kpis = []
    all_td_kpis = []
    all_df_kpis = []
    all_lt_kpis = []
    dora_config = load_dora_config()

    for tid, result in zip(team_ids, results):
        if isinstance(result, Exception):
            logger.warning("Team %s failed: %s", tid, result)
            team_errors.append(TeamError(team_id=tid, error=str(result)))
            continue
        report = result
        tc = get_team_config(tid)
        snapshot = compute_delivery_snapshot(
            report.deliverables, kpi_config, start_date, end_date,
        )
        all_snapshots.append(snapshot)
        kpis: list = []
        if kpi_config.rework_rate.enabled:
            rw = compute_rework_rate(report.deliverables, kpi_config.rework_rate)
            kpis.append(rw)
            all_rework_kpis.append(rw)
        if kpi_config.delivery_predictability.enabled:
            dp = compute_delivery_predictability(
                report.deliverables, kpi_config.delivery_predictability,
                start_date, end_date,
            )
            kpis.append(dp)
            all_dp_kpis.append(dp)
        if kpi_config.flow_hygiene.enabled and tc is not None:
                wip_limits = await resolve_wip_limits(
                    azure_client, tc, kpi_config.flow_hygiene,
                )
                fh = compute_flow_hygiene(
                    report.deliverables, kpi_config.flow_hygiene,
                    wip_limits, start_date, end_date,
                )
                kpis.append(fh.model_copy(update={"states": None}))
                all_fh_kpis.append(fh)
        if kpi_config.wip_discipline.enabled and tc is not None:
                wd = compute_wip_discipline(
                    report.deliverables, kpi_config.wip_discipline,
                    tc, start_date, end_date,
                )
                kpis.append(wd.model_copy(update={"persons": None}))
                all_wd_kpis.append(wd)
        if kpi_config.tech_debt_ratio.enabled:
            td = compute_tech_debt_ratio(
                report.deliverables, kpi_config.tech_debt_ratio,
            )
            kpis.append(td)
            all_td_kpis.append(td)
        dora: list = []
        if dora_config.deploy_frequency.enabled:
            df_deployments = []
            df_team = tc.deploy_frequency if tc else None
            has_df_config = df_team and (
                df_team.definition_environment_ids
                or (df_team.definition_ids and (df_team.environment_name or df_team.environment_guid))
            )
            if has_df_config:
                try:
                    df_deployments, _ = await fetch_deploy_frequency_deployments(
                        azure_client, df_team, tc.project, start_date, end_date,
                    )
                except Exception:
                    pass
            df_kpi = compute_deploy_frequency(
                df_deployments, dora_config.deploy_frequency, start_date, end_date,
            )
            dora.append(df_kpi)
            all_df_kpis.append(df_kpi)
        if dora_config.lead_time.enabled:
            lt_kpi = compute_lead_time(
                report.deliverables, dora_config.lead_time, start_date, end_date,
            )
            dora.append(lt_kpi)
            all_lt_kpis.append(lt_kpi)
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
    if kpi_config.rework_rate.enabled and all_rework_kpis:
        kpi_averages.append(
            compute_kpi_average("rework_rate", all_rework_kpis, kpi_config.rework_rate)
        )
    if kpi_config.delivery_predictability.enabled and all_dp_kpis:
        kpi_averages.append(
            compute_kpi_average(
                "delivery_predictability", all_dp_kpis,
                kpi_config.delivery_predictability,
            )
        )
    if kpi_config.flow_hygiene.enabled and all_fh_kpis:
        kpi_averages.append(
            compute_kpi_average(
                "flow_hygiene", all_fh_kpis, kpi_config.flow_hygiene,
            )
        )
    if kpi_config.wip_discipline.enabled and all_wd_kpis:
        kpi_averages.append(
            compute_kpi_average(
                "wip_discipline", all_wd_kpis, kpi_config.wip_discipline,
            )
        )
    if kpi_config.tech_debt_ratio.enabled and all_td_kpis:
        kpi_averages.append(
            compute_kpi_average(
                "tech_debt_ratio", all_td_kpis, kpi_config.tech_debt_ratio,
            )
        )

    dora_averages: list[AverageKPI] = []
    if dora_config.deploy_frequency.enabled and all_df_kpis:
        dora_averages.append(
            compute_dora_average(
                "deploy_frequency", all_df_kpis, dora_config.deploy_frequency,
            )
        )
    if dora_config.lead_time.enabled and all_lt_kpis:
        dora_averages.append(
            compute_dora_average(
                "lead_time", all_lt_kpis, dora_config.lead_time,
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
