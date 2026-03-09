"""Shared API helpers -- validation, Azure client dependency, report fetching."""

from __future__ import annotations

import asyncio
from datetime import date

from fastapi import HTTPException, Request

from app.adapters.azure_devops import AzureDevOpsClient
from app.config.team_loader import load_teams_config
from app.services.report_service import run_report
from app.settings import get_settings


def validate_date_range(start_date: date, end_date: date) -> None:
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
    """FastAPI dependency -- returns the shared AzureDevOpsClient from app state."""
    client = getattr(request.app.state, "azure_client", None)
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Azure DevOps not configured: set AZURE_DEVOPS_ORG and AZURE_DEVOPS_PAT",
        )
    return client


async def get_team_report(request: Request, team_id: str, start_date: date, end_date: date):
    """Validate inputs, fetch one team report, return (report, deliverables)."""
    validate_date_range(start_date, end_date)
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
    return report


async def fetch_all_reports(request: Request, start_date: date, end_date: date):
    """Validate dates, fetch reports for all teams. Returns (team_ids, results)."""
    validate_date_range(start_date, end_date)
    teams = load_teams_config()
    client = get_azure_client(request)
    report_cache = getattr(request.app.state, "report_cache", None)
    wi_cache = getattr(request.app.state, "wi_cache", None)
    settings = get_settings()

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
    return team_ids, results
