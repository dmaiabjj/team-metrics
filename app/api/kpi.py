"""KPI endpoints -- computed from cached report data."""

from __future__ import annotations

import asyncio
import logging
from datetime import date
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.api.report import _validate_date_range, get_azure_client
from app.auth import require_api_key
from app.config.kpi_loader import load_kpi_config
from app.config.team_loader import load_teams_config
from app.schemas.kpi import (
    AverageKPI,
    DrilldownResponse,
    KPIResponse,
    KPISummaryResponse,
    TeamError,
    TeamKPIEntry,
)
from app.schemas.report import ErrorResponse
from app.services.kpi_service import (
    compute_kpi_average,
    compute_rework_rate,
    filter_deliverables_by_metric,
)
from app.services.report_service import run_report
from app.settings import get_settings

logger = logging.getLogger(__name__)

_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid date range"},
    404: {"model": ErrorResponse, "description": "Unknown team_id"},
    422: {"model": ErrorResponse, "description": "Invalid parameters"},
    503: {"model": ErrorResponse, "description": "Azure DevOps not configured"},
}

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(dependencies=[Depends(require_api_key)])


class DrilldownMetric(str, Enum):
    ITEMS_REACHED_QA = "items_reached_qa"
    ITEMS_WITH_REWORK = "items_with_rework"
    ITEMS_BOUNCED_BACK = "items_bounced_back"
    ITEMS_WITH_BUGS = "items_with_bugs"


async def _get_deliverables(request: Request, team_id: str, start_date: date, end_date: date):
    """Shared helper: validate, fetch report, return deliverables list."""
    _validate_date_range(start_date, end_date)
    teams = load_teams_config()
    if team_id not in teams:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown team_id: {team_id}. Known: {list(teams.keys())}",
        )
    client = get_azure_client(request)
    report_cache = getattr(request.app.state, "report_cache", None)
    wi_cache = getattr(request.app.state, "wi_cache", None)
    settings = get_settings()
    try:
        report = await asyncio.wait_for(
            run_report(
                team_id, start_date, end_date, client, teams,
                report_cache=report_cache, wi_cache=wi_cache,
            ),
            timeout=settings.report_timeout,
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail=f"Report generation timed out after {settings.report_timeout}s",
        )
    return report.deliverables


@router.get("", response_model=KPIResponse, responses=_ERROR_RESPONSES)
@limiter.limit("30/minute")
async def get_kpis(
    request: Request,
    team_id: str = Query(..., description="Team slug"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
) -> KPIResponse:
    """Compute KPIs for one team."""
    deliverables = await _get_deliverables(request, team_id, start_date, end_date)
    kpi_config = load_kpi_config()
    kpis = []
    if kpi_config.rework_rate.enabled:
        kpis.append(compute_rework_rate(deliverables, kpi_config.rework_rate))
    return KPIResponse(
        team_id=team_id,
        start_date=start_date,
        end_date=end_date,
        kpis=kpis,
    )


@router.get("/summary", response_model=KPISummaryResponse, responses=_ERROR_RESPONSES)
@limiter.limit("10/minute")
async def get_kpi_summary(
    request: Request,
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
) -> KPISummaryResponse:
    """Compute KPIs for all teams, return per-team breakdown and averages."""
    _validate_date_range(start_date, end_date)
    teams = load_teams_config()
    client = get_azure_client(request)
    report_cache = getattr(request.app.state, "report_cache", None)
    wi_cache = getattr(request.app.state, "wi_cache", None)
    settings = get_settings()
    kpi_config = load_kpi_config()

    team_ids = list(teams.keys())
    try:
        results = await asyncio.wait_for(
            asyncio.gather(
                *[
                    run_report(
                        tid, start_date, end_date, client, teams,
                        report_cache=report_cache, wi_cache=wi_cache,
                    )
                    for tid in team_ids
                ],
                return_exceptions=True,
            ),
            timeout=settings.report_timeout,
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail=f"Report generation timed out after {settings.report_timeout}s",
        )

    team_entries: list[TeamKPIEntry] = []
    team_errors: list[TeamError] = []
    all_rework_kpis = []

    for tid, result in zip(team_ids, results):
        if isinstance(result, Exception):
            logger.warning("Team %s failed: %s", tid, result)
            team_errors.append(TeamError(team_id=tid, error=str(result)))
            continue
        report = result
        kpis = []
        if kpi_config.rework_rate.enabled:
            rw = compute_rework_rate(report.deliverables, kpi_config.rework_rate)
            kpis.append(rw)
            all_rework_kpis.append(rw)
        team_entries.append(TeamKPIEntry(team_id=report.team_id, kpis=kpis))

    averages: list[AverageKPI] = []
    if kpi_config.rework_rate.enabled and all_rework_kpis:
        averages.append(
            compute_kpi_average("rework_rate", all_rework_kpis, kpi_config.rework_rate)
        )

    return KPISummaryResponse(
        start_date=start_date,
        end_date=end_date,
        averages=averages,
        teams=team_entries,
        errors=team_errors,
    )


@router.get("/drilldown", response_model=DrilldownResponse, responses=_ERROR_RESPONSES)
@limiter.limit("30/minute")
async def get_kpi_drilldown(
    request: Request,
    team_id: str = Query(..., description="Team slug"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
    metric: DrilldownMetric = Query(..., description="Metric to drill into"),
    skip: int = Query(0, ge=0, description="Number of items to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max items to return"),
) -> DrilldownResponse:
    """Return the work items behind a specific KPI metric."""
    deliverables = await _get_deliverables(request, team_id, start_date, end_date)
    kpi_config = load_kpi_config()

    try:
        filtered = filter_deliverables_by_metric(
            deliverables, metric.value, kpi_config.rework_rate,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    total = len(filtered)
    return DrilldownResponse(
        team_id=team_id,
        start_date=start_date,
        end_date=end_date,
        metric=metric.value,
        total=total,
        items=filtered[skip : skip + limit],
    )
