"""Team endpoints -- KPIs, KPI detail, drilldown, and work items."""

from __future__ import annotations

import logging
from datetime import date
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.api.helpers import get_team_report
from app.auth import require_api_key
from app.config.kpi_loader import load_kpi_config
from app.schemas.kpi import (
    DrilldownResponse,
    TeamKPIDetailResponse,
    TeamKPIsResponse,
)
from app.schemas.report import ErrorResponse, WorkItemsResponse
from app.services.kpi_service import (
    compute_delivery_predictability,
    compute_rework_rate,
    filter_deliverables_by_metric,
)

logger = logging.getLogger(__name__)

_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid date range"},
    404: {"model": ErrorResponse, "description": "Unknown team_id or KPI"},
    422: {"model": ErrorResponse, "description": "Invalid parameters"},
    503: {"model": ErrorResponse, "description": "Azure DevOps not configured"},
}

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(dependencies=[Depends(require_api_key)])


class KPIName(str, Enum):
    REWORK_RATE = "rework-rate"
    DELIVERY_PREDICTABILITY = "delivery-predictability"


REWORK_METRICS = frozenset({
    "items_reached_qa", "items_with_rework", "items_bounced_back", "items_with_bugs",
})
DP_METRICS = frozenset({
    "items_committed", "items_deployed", "items_started_in_period", "items_spillover",
})
KPI_METRICS: dict[KPIName, frozenset[str]] = {
    KPIName.REWORK_RATE: REWORK_METRICS,
    KPIName.DELIVERY_PREDICTABILITY: DP_METRICS,
}


def _compute_single_kpi(kpi_name: KPIName, deliverables, kpi_config, start_date, end_date):
    """Compute a single KPI by name."""
    if kpi_name == KPIName.REWORK_RATE:
        return compute_rework_rate(deliverables, kpi_config.rework_rate)
    return compute_delivery_predictability(
        deliverables, kpi_config.delivery_predictability, start_date, end_date,
    )


# ---------------------------------------------------------------------------
# Endpoint 5: GET /teams/{team_id}/work-items
# ---------------------------------------------------------------------------

@router.get(
    "/{team_id}/work-items",
    response_model=WorkItemsResponse,
    responses=_ERROR_RESPONSES,
)
@limiter.limit("30/minute")
async def get_work_items(
    request: Request,
    team_id: str = Path(..., description="Team slug"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
    skip: int = Query(0, ge=0, description="Number of items to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max items to return"),
) -> WorkItemsResponse:
    """Return work items (deliverables) for one team and date range."""
    report = await get_team_report(request, team_id, start_date, end_date)
    total = len(report.deliverables)
    return WorkItemsResponse(
        team_id=team_id,
        start_date=start_date,
        end_date=end_date,
        total=total,
        items=report.deliverables[skip : skip + limit],
    )


# ---------------------------------------------------------------------------
# Endpoint 2: GET /teams/{team_id}/kpis
# ---------------------------------------------------------------------------

@router.get(
    "/{team_id}/kpis",
    response_model=TeamKPIsResponse,
    responses=_ERROR_RESPONSES,
)
@limiter.limit("30/minute")
async def get_team_kpis(
    request: Request,
    team_id: str = Path(..., description="Team slug"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
) -> TeamKPIsResponse:
    """Compute all KPIs for one team."""
    report = await get_team_report(request, team_id, start_date, end_date)
    kpi_config = load_kpi_config()
    kpis: list = []
    if kpi_config.rework_rate.enabled:
        kpis.append(compute_rework_rate(report.deliverables, kpi_config.rework_rate))
    if kpi_config.delivery_predictability.enabled:
        kpis.append(compute_delivery_predictability(
            report.deliverables, kpi_config.delivery_predictability, start_date, end_date,
        ))
    return TeamKPIsResponse(
        team_id=team_id, start_date=start_date, end_date=end_date, kpis=kpis,
    )


# ---------------------------------------------------------------------------
# Endpoint 3: GET /teams/{team_id}/kpis/{kpi_name}
# ---------------------------------------------------------------------------

@router.get(
    "/{team_id}/kpis/{kpi_name}",
    response_model=TeamKPIDetailResponse,
    responses=_ERROR_RESPONSES,
)
@limiter.limit("30/minute")
async def get_team_kpi_detail(
    request: Request,
    team_id: str = Path(..., description="Team slug"),
    kpi_name: KPIName = Path(..., description="KPI name"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
) -> TeamKPIDetailResponse:
    """Return a single KPI with its metrics and all involved work items."""
    report = await get_team_report(request, team_id, start_date, end_date)
    kpi_config = load_kpi_config()
    kpi = _compute_single_kpi(kpi_name, report.deliverables, kpi_config, start_date, end_date)

    seen_ids: set[int] = set()
    items: list = []
    for metric in KPI_METRICS[kpi_name]:
        for d in filter_deliverables_by_metric(
            report.deliverables,
            metric,
            rework_config=kpi_config.rework_rate,
            dp_config=kpi_config.delivery_predictability,
            start=start_date,
            end=end_date,
        ):
            if d.id not in seen_ids:
                seen_ids.add(d.id)
                items.append(d)

    return TeamKPIDetailResponse(
        team_id=team_id, start_date=start_date, end_date=end_date,
        kpi=kpi, total=len(items), items=items,
    )


# ---------------------------------------------------------------------------
# Endpoint 4: GET /teams/{team_id}/kpis/{kpi_name}/drilldown/{metric}
# ---------------------------------------------------------------------------

@router.get(
    "/{team_id}/kpis/{kpi_name}/drilldown/{metric}",
    response_model=DrilldownResponse,
    responses=_ERROR_RESPONSES,
)
@limiter.limit("30/minute")
async def get_kpi_drilldown(
    request: Request,
    team_id: str = Path(..., description="Team slug"),
    kpi_name: KPIName = Path(..., description="KPI name"),
    metric: str = Path(..., description="Metric to drill into"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
    skip: int = Query(0, ge=0, description="Number of items to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max items to return"),
) -> DrilldownResponse:
    """Return the work items behind a specific KPI metric."""
    valid_metrics = KPI_METRICS.get(kpi_name, frozenset())
    if metric not in valid_metrics:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid metric '{metric}' for {kpi_name.value}. "
                   f"Valid: {sorted(valid_metrics)}",
        )

    report = await get_team_report(request, team_id, start_date, end_date)
    kpi_config = load_kpi_config()
    filtered = filter_deliverables_by_metric(
        report.deliverables,
        metric,
        rework_config=kpi_config.rework_rate,
        dp_config=kpi_config.delivery_predictability,
        start=start_date,
        end=end_date,
    )
    total = len(filtered)
    return DrilldownResponse(
        team_id=team_id,
        start_date=start_date,
        end_date=end_date,
        kpi_name=kpi_name.value,
        metric=metric,
        total=total,
        items=filtered[skip : skip + limit],
    )
