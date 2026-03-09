"""Dashboard endpoint -- cross-team KPI averages + per-team breakdown."""

from __future__ import annotations

import asyncio
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.api.helpers import fetch_all_reports, validate_date_range
from app.auth import require_api_key
from app.config.kpi_loader import load_kpi_config
from app.schemas.kpi import (
    AverageKPI,
    DashboardResponse,
    TeamError,
    TeamKPIEntry,
)
from app.schemas.report import ErrorResponse
from app.services.kpi_service import (
    compute_delivery_predictability,
    compute_kpi_average,
    compute_rework_rate,
)

logger = logging.getLogger(__name__)

_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid date range"},
    503: {"model": ErrorResponse, "description": "Azure DevOps not configured"},
}

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(dependencies=[Depends(require_api_key)])


@router.get("", response_model=DashboardResponse, responses=_ERROR_RESPONSES)
@limiter.limit("10/minute")
async def get_dashboard(
    request: Request,
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
) -> DashboardResponse:
    """Cross-team KPI averages and per-team breakdown."""
    team_ids, results = await fetch_all_reports(request, start_date, end_date)
    kpi_config = load_kpi_config()

    team_entries: list[TeamKPIEntry] = []
    team_errors: list[TeamError] = []
    all_rework_kpis = []
    all_dp_kpis = []

    for tid, result in zip(team_ids, results):
        if isinstance(result, Exception):
            logger.warning("Team %s failed: %s", tid, result)
            team_errors.append(TeamError(team_id=tid, error=str(result)))
            continue
        report = result
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
        team_entries.append(TeamKPIEntry(team_id=report.team_id, kpis=kpis))

    averages: list[AverageKPI] = []
    if kpi_config.rework_rate.enabled and all_rework_kpis:
        averages.append(
            compute_kpi_average("rework_rate", all_rework_kpis, kpi_config.rework_rate)
        )
    if kpi_config.delivery_predictability.enabled and all_dp_kpis:
        averages.append(
            compute_kpi_average(
                "delivery_predictability", all_dp_kpis,
                kpi_config.delivery_predictability,
            )
        )

    return DashboardResponse(
        start_date=start_date,
        end_date=end_date,
        averages=averages,
        teams=team_entries,
        errors=team_errors,
    )
