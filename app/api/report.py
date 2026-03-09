"""Report API endpoints — fully async with parallel multi-team execution."""

from __future__ import annotations

import asyncio
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.adapters.azure_devops import AzureDevOpsClient
from app.auth import require_api_key
from app.config.team_loader import load_teams_config
from app.schemas.report import (
    ErrorResponse,
    MultiTeamReportResponse,
    ReportResponse,
    TeamReportResponse,
)
from app.services.report_service import run_report
from app.settings import get_settings

_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid date range"},
    404: {"model": ErrorResponse, "description": "Unknown team_id"},
    503: {"model": ErrorResponse, "description": "Azure DevOps not configured"},
}

logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(dependencies=[Depends(require_api_key)])


def _validate_date_range(start_date: date, end_date: date) -> None:
    """Shared validation for date inputs."""
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date")
    settings = get_settings()
    delta = (end_date - start_date).days
    if delta > settings.max_date_range_days:
        raise HTTPException(
            status_code=400,
            detail=f"Date range exceeds maximum of {settings.max_date_range_days} days",
        )


def get_azure_client(request: Request) -> AzureDevOpsClient:
    """FastAPI dependency — returns the shared AzureDevOpsClient from app state."""
    client = getattr(request.app.state, "azure_client", None)
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Azure DevOps not configured: set AZURE_DEVOPS_ORG and AZURE_DEVOPS_PAT",
        )
    return client


@router.get("", response_model=ReportResponse, responses=_ERROR_RESPONSES)
@limiter.limit("30/minute")
async def get_report(
    request: Request,
    team_id: str = Query(..., description="Team slug, e.g. game-services"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
    skip: int = Query(0, ge=0, description="Number of deliverables to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max deliverables to return"),
) -> ReportResponse:
    """Get performance report for one team and date range."""
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
    total = len(report.deliverables)
    report.total = total
    report.deliverables = report.deliverables[skip : skip + limit]
    return report


@router.get("/multi", response_model=MultiTeamReportResponse, responses=_ERROR_RESPONSES)
@limiter.limit("10/minute")
async def get_report_multi(
    request: Request,
    team_ids: str = Query(..., description="Comma-separated team slugs"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
) -> MultiTeamReportResponse:
    """Get performance report for multiple teams — executed concurrently."""
    _validate_date_range(start_date, end_date)
    ids = [t.strip() for t in team_ids.split(",") if t.strip()]
    teams = load_teams_config()
    unknown = [i for i in ids if i not in teams]
    if unknown:
        raise HTTPException(status_code=404, detail=f"Unknown team_id(s): {unknown}")
    client = get_azure_client(request)

    report_cache = getattr(request.app.state, "report_cache", None)
    wi_cache = getattr(request.app.state, "wi_cache", None)
    settings = get_settings()

    try:
        reports = await asyncio.wait_for(
            asyncio.gather(
                *[
                    run_report(
                        tid, start_date, end_date, client, teams,
                        report_cache=report_cache, wi_cache=wi_cache,
                    )
                    for tid in ids
                ]
            ),
            timeout=settings.report_timeout,
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail=f"Report generation timed out after {settings.report_timeout}s",
        )

    return MultiTeamReportResponse(
        teams=[
            TeamReportResponse(team_id=r.team_id, deliverables=r.deliverables)
            for r in reports
        ]
    )
