"""Report API endpoints — fully async with parallel multi-team execution."""

from __future__ import annotations

import asyncio
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.adapters.azure_devops import AzureDevOpsClient
from app.config.loader import load_teams_config
from app.schemas.report import (
    MultiTeamReportResponse,
    ReportResponse,
    TeamReportResponse,
)
from app.services.report_service import run_report
from app.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()


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


@router.get("", response_model=ReportResponse)
async def get_report(
    team_id: str = Query(..., description="Team slug, e.g. game-services"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
    client: AzureDevOpsClient = Depends(get_azure_client),
) -> ReportResponse:
    """Get performance report for one team and date range."""
    _validate_date_range(start_date, end_date)
    teams = load_teams_config()
    if team_id not in teams:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown team_id: {team_id}. Known: {list(teams.keys())}",
        )
    return await run_report(team_id, start_date, end_date, client, teams)


@router.get("/multi", response_model=MultiTeamReportResponse)
async def get_report_multi(
    team_ids: str = Query(..., description="Comma-separated team slugs"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
    client: AzureDevOpsClient = Depends(get_azure_client),
) -> MultiTeamReportResponse:
    """Get performance report for multiple teams — executed concurrently."""
    _validate_date_range(start_date, end_date)
    ids = [t.strip() for t in team_ids.split(",") if t.strip()]
    teams = load_teams_config()
    unknown = [i for i in ids if i not in teams]
    if unknown:
        raise HTTPException(status_code=404, detail=f"Unknown team_id(s): {unknown}")

    # Run all team reports concurrently
    reports = await asyncio.gather(
        *[run_report(tid, start_date, end_date, client, teams) for tid in ids]
    )

    return MultiTeamReportResponse(
        teams=[
            TeamReportResponse(team_id=r.team_id, deliverables=r.deliverables)
            for r in reports
        ]
    )
