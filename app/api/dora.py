"""DORA endpoints -- deploy frequency and lead time metrics."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Path, Query, Request

from app.api.helpers import (
    fetch_deploy_frequency_deployments,
    get_azure_client,
    get_team_report,
)
from app.api.teams import KPIName, _compute_single_kpi
from app.auth import require_api_key
from app.config.dora_loader import get_deploy_frequency_config, load_dora_config
from app.config.kpi_loader import load_kpi_config
from app.config.team_loader import get_team_config
from app.rate_limit import limiter
from app.schemas.kpi import DrilldownResponse, TeamDoraResponse, TeamKPIDetailResponse
from app.schemas.report import ErrorResponse
from app.services.dora_service import (
    build_deployments_to_summaries,
    compute_lead_time,
    deployments_to_summaries,
    environment_records_to_summaries,
    filter_dora_metric,
)

_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid date range"},
    404: {"model": ErrorResponse, "description": "Unknown team_id or KPI"},
    422: {"model": ErrorResponse, "description": "Invalid parameters"},
    503: {"model": ErrorResponse, "description": "Azure DevOps not configured"},
}

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.get(
    "/{team_id}/dora",
    response_model=TeamDoraResponse,
    responses=_ERROR_RESPONSES,
)
@limiter.limit("30/minute")
async def get_team_dora(
    request: Request,
    team_id: str = Path(..., description="Team slug"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
) -> TeamDoraResponse:
    """Return DORA metrics only for one team."""
    report = await get_team_report(request, team_id, start_date, end_date)
    dora_config = load_dora_config()
    dora: list = []
    if dora_config.deploy_frequency.enabled:
        df_kpi = await _compute_single_kpi(
            KPIName.DEPLOY_FREQUENCY, report.deliverables, load_kpi_config(),
            start_date, end_date,
            request=request, team_id=team_id, dora_config=dora_config,
        )
        dora.append(df_kpi)
    if dora_config.lead_time.enabled:
        dora.append(compute_lead_time(
            report.deliverables, dora_config.lead_time, start_date, end_date,
        ))
    return TeamDoraResponse(
        team_id=team_id, start_date=start_date, end_date=end_date, dora=dora,
    )


@router.get(
    "/{team_id}/dora/deploy-frequency/drilldown/deployments",
    response_model=DrilldownResponse,
    response_model_exclude_none=True,
    responses=_ERROR_RESPONSES,
)
@limiter.limit("30/minute")
async def get_dora_deploy_frequency_drilldown(
    request: Request,
    team_id: str = Path(..., description="Team slug"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
    skip: int = Query(0, ge=0, description="Number of items to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max items to return"),
) -> DrilldownResponse:
    """Drilldown into deploy frequency deployments."""
    tc = get_team_config(team_id)
    df_team = get_deploy_frequency_config(team_id) if tc else None
    has_df_config = df_team and (
        df_team.definition_environment_ids
        or (df_team.definition_ids and (df_team.environment_name or df_team.environment_guid))
    )
    deployments: list = []
    if tc and has_df_config:
        azure_client = get_azure_client(request)
        raw, fmt = await fetch_deploy_frequency_deployments(
            azure_client, df_team, tc.project, start_date, end_date,
            team_id=team_id,
            deployment_cache=getattr(request.app.state, "deployment_cache", None),
        )
        deployments = (
            deployments_to_summaries(raw) if fmt == "release"
            else build_deployments_to_summaries(raw) if fmt == "build"
            else environment_records_to_summaries(raw)
        )
    total = len(deployments)
    return DrilldownResponse(
        team_id=team_id,
        start_date=start_date,
        end_date=end_date,
        kpi_name="deploy-frequency",
        metric="deployments",
        total=total,
        items=[],
        deployments=deployments[skip : skip + limit],
    )


@router.get(
    "/{team_id}/dora/lead-time/drilldown/measured_items",
    response_model=DrilldownResponse,
    response_model_exclude_none=True,
    responses=_ERROR_RESPONSES,
)
@limiter.limit("30/minute")
async def get_dora_lead_time_drilldown(
    request: Request,
    team_id: str = Path(..., description="Team slug"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
    skip: int = Query(0, ge=0, description="Number of items to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max items to return"),
) -> DrilldownResponse:
    """Drilldown into lead time measured items."""
    report = await get_team_report(request, team_id, start_date, end_date)
    dora_config = load_dora_config()
    filtered = filter_dora_metric(
        report.deliverables, "measured_items",
        dora_config.lead_time, start_date, end_date,
    )
    total = len(filtered)
    return DrilldownResponse(
        team_id=team_id,
        start_date=start_date,
        end_date=end_date,
        kpi_name="lead-time",
        metric="measured_items",
        total=total,
        items=filtered[skip : skip + limit],
    )


@router.get(
    "/{team_id}/dora/deploy-frequency",
    response_model=TeamKPIDetailResponse,
    response_model_exclude_none=True,
    responses=_ERROR_RESPONSES,
)
@limiter.limit("30/minute")
async def get_dora_deploy_frequency(
    request: Request,
    team_id: str = Path(..., description="Team slug"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
) -> TeamKPIDetailResponse:
    """Deploy frequency (DORA) detail."""
    report = await get_team_report(request, team_id, start_date, end_date)
    dora_config = load_dora_config()
    kpi = await _compute_single_kpi(
        KPIName.DEPLOY_FREQUENCY, report.deliverables, load_kpi_config(),
        start_date, end_date,
        request=request, team_id=team_id, dora_config=dora_config,
    )
    tc = get_team_config(team_id)
    df_team = get_deploy_frequency_config(team_id) if tc else None
    has_df_config = df_team and (
        df_team.definition_environment_ids
        or (df_team.definition_ids and (df_team.environment_name or df_team.environment_guid))
    )
    deployments: list | None = None
    if tc and has_df_config:
        azure_client = get_azure_client(request)
        raw, fmt = await fetch_deploy_frequency_deployments(
            azure_client, df_team, tc.project, start_date, end_date,
            team_id=team_id,
            deployment_cache=getattr(request.app.state, "deployment_cache", None),
        )
        deployments = (
            deployments_to_summaries(raw) if fmt == "release"
            else build_deployments_to_summaries(raw) if fmt == "build"
            else environment_records_to_summaries(raw)
        )
    else:
        deployments = []
    return TeamKPIDetailResponse(
        team_id=team_id,
        start_date=start_date,
        end_date=end_date,
        kpi=kpi,
        total=len(deployments) if deployments else 0,
        items=[],
        deployments=deployments,
    )


@router.get(
    "/{team_id}/dora/lead-time",
    response_model=TeamKPIDetailResponse,
    responses=_ERROR_RESPONSES,
)
@limiter.limit("30/minute")
async def get_dora_lead_time(
    request: Request,
    team_id: str = Path(..., description="Team slug"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
) -> TeamKPIDetailResponse:
    """Lead time (DORA) detail."""
    report = await get_team_report(request, team_id, start_date, end_date)
    dora_config = load_dora_config()
    kpi = compute_lead_time(
        report.deliverables, dora_config.lead_time, start_date, end_date,
    )
    items = filter_dora_metric(
        report.deliverables, "measured_items",
        dora_config.lead_time, start_date, end_date,
    )
    return TeamKPIDetailResponse(
        team_id=team_id,
        start_date=start_date,
        end_date=end_date,
        kpi=kpi,
        total=len(items),
        items=items,
        deployments=None,
    )
