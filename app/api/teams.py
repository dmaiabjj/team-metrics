"""Team endpoints -- KPIs, KPI detail, drilldown, and work items."""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from app.api.helpers import (
    fetch_deploy_frequency_deployments,
    get_azure_client,
    get_team_report,
    get_wi_cache,
    resolve_wip_limits,
    validate_date_range,
)
from app.auth import require_api_key
from app.config.dora_loader import get_deploy_frequency_config, load_dora_config
from app.config.kpi_loader import get_team_kpi_overrides, load_kpi_config
from app.config.team_loader import get_team_config
from app.schemas.kpi import (
    DrilldownResponse,
    TeamDoraResponse,
    TeamKPIDetailResponse,
    TeamKPIsResponse,
    WIPDisciplineKPI,
)
from app.services.dora_service import (
    build_deployments_to_summaries,
    compute_deploy_frequency,
    compute_lead_time,
    deployments_to_summaries,
    environment_records_to_summaries,
    filter_dora_metric,
)
from app.schemas.snapshot import SnapshotDrilldownResponse
from app.schemas.report import DeliverableRow, ErrorResponse, WorkItemsResponse
from app.services.kpi_service import (
    DP_METRICS,
    FH_METRICS,
    ID_METRICS,
    RAD_METRICS,
    REWORK_METRICS,
    TD_METRICS,
    WD_METRICS,
    compute_delivery_predictability,
    compute_flow_hygiene,
    compute_initiative_delivery,
    compute_reliability_action_delivery,
    compute_rework_rate,
    compute_tech_debt_ratio,
    compute_wip_discipline,
    filter_deliverables_by_metric,
)
from app.services.report_service import fetch_single_work_item, search_work_items
from app.config.team_loader import load_teams_config
from app.services.snapshot_service import (
    VALID_SNAPSHOT_METRICS,
    compute_delivery_snapshot,
    filter_snapshot_metric,
)

logger = logging.getLogger(__name__)

_ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Invalid date range"},
    404: {"model": ErrorResponse, "description": "Unknown team_id or KPI"},
    422: {"model": ErrorResponse, "description": "Invalid parameters"},
    503: {"model": ErrorResponse, "description": "Azure DevOps not configured"},
}

from app.rate_limit import limiter

router = APIRouter(dependencies=[Depends(require_api_key)])


class KPIName(str, Enum):
    REWORK_RATE = "rework-rate"
    DELIVERY_PREDICTABILITY = "delivery-predictability"
    FLOW_HYGIENE = "flow-hygiene"
    WIP_DISCIPLINE = "wip-discipline"
    TECH_DEBT_RATIO = "tech-debt-ratio"
    INITIATIVE_DELIVERY = "initiative-delivery"
    RELIABILITY_ACTION_DELIVERY = "reliability-action-delivery"
    DEPLOY_FREQUENCY = "deploy-frequency"
    LEAD_TIME = "lead-time"


DEPLOY_FREQ_METRICS = frozenset({"deployments"})
LEAD_TIME_METRICS = frozenset({"measured_items"})
KPI_METRICS: dict[KPIName, frozenset[str]] = {
    KPIName.REWORK_RATE: REWORK_METRICS,
    KPIName.DELIVERY_PREDICTABILITY: DP_METRICS,
    KPIName.FLOW_HYGIENE: FH_METRICS,
    KPIName.WIP_DISCIPLINE: WD_METRICS,
    KPIName.TECH_DEBT_RATIO: TD_METRICS,
    KPIName.INITIATIVE_DELIVERY: ID_METRICS,
    KPIName.RELIABILITY_ACTION_DELIVERY: RAD_METRICS,
    KPIName.DEPLOY_FREQUENCY: DEPLOY_FREQ_METRICS,
    KPIName.LEAD_TIME: LEAD_TIME_METRICS,
}


async def _compute_single_kpi(
    kpi_name: KPIName, deliverables, kpi_config, start_date, end_date,
    *, request: Request | None = None, team_id: str | None = None,
    dora_config=None,
):
    """Compute a single KPI by name."""
    if kpi_name == KPIName.REWORK_RATE:
        return compute_rework_rate(deliverables, kpi_config.rework_rate)
    if kpi_name == KPIName.DELIVERY_PREDICTABILITY:
        return compute_delivery_predictability(
            deliverables, kpi_config.delivery_predictability, start_date, end_date,
        )
    if kpi_name == KPIName.TECH_DEBT_RATIO:
        return compute_tech_debt_ratio(deliverables, kpi_config.tech_debt_ratio)
    if kpi_name == KPIName.INITIATIVE_DELIVERY:
        tc = get_team_config(team_id) if team_id else None
        if tc is None:
            raise HTTPException(status_code=404, detail=f"Unknown team_id: {team_id}")
        id_overrides = get_team_kpi_overrides(team_id) if team_id else None
        return compute_initiative_delivery(
            deliverables, kpi_config.initiative_delivery, tc,
            (id_overrides.initiative_ids if id_overrides else []),
            start_date, end_date,
        )
    if kpi_name == KPIName.RELIABILITY_ACTION_DELIVERY:
        return compute_reliability_action_delivery(
            deliverables, kpi_config.reliability_action_delivery,
        )

    if kpi_name == KPIName.DEPLOY_FREQUENCY:
        if dora_config is None or not dora_config.deploy_frequency.enabled:
            raise HTTPException(status_code=404, detail="Deploy frequency not enabled")
        tc = get_team_config(team_id) if team_id else None
        if tc is None:
            raise HTTPException(status_code=404, detail=f"Unknown team_id: {team_id}")
        df_team = get_deploy_frequency_config(team_id) if team_id else None
        has_config = (
            df_team
            and (
                df_team.definition_environment_ids
                or (df_team.definition_ids and (df_team.environment_name or df_team.environment_guid))
            )
        )
        if not has_config:
            return compute_deploy_frequency(
                [], dora_config.deploy_frequency, start_date, end_date,
            )
        azure_client = get_azure_client(request) if request else None
        if azure_client is None:
            return compute_deploy_frequency(
                [], dora_config.deploy_frequency, start_date, end_date,
            )
        deployments, _ = await fetch_deploy_frequency_deployments(
            azure_client, df_team, tc.project, start_date, end_date,
            team_id=team_id,
            deployment_cache=getattr(request.app.state, "deployment_cache", None),
        )
        return compute_deploy_frequency(
            deployments, dora_config.deploy_frequency, start_date, end_date,
        )

    if kpi_name == KPIName.LEAD_TIME:
        if dora_config is None or not dora_config.lead_time.enabled:
            raise HTTPException(status_code=404, detail="Lead time not enabled")
        return compute_lead_time(
            deliverables, dora_config.lead_time, start_date, end_date,
        )

    tc = get_team_config(team_id) if team_id else None
    if tc is None:
        raise HTTPException(status_code=404, detail=f"Unknown team_id: {team_id}")

    if kpi_name == KPIName.FLOW_HYGIENE:
        azure_client = get_azure_client(request) if request else None
        kpi_overrides = get_team_kpi_overrides(team_id) if team_id else None
        wip_limits = await resolve_wip_limits(
            azure_client, tc, kpi_config.flow_hygiene,
            wip_limits_override=kpi_overrides.wip_limits if kpi_overrides else None,
        )
        return compute_flow_hygiene(
            deliverables, kpi_config.flow_hygiene, wip_limits, start_date, end_date,
        )

    return compute_wip_discipline(
        deliverables, kpi_config.wip_discipline, tc, start_date, end_date,
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
# Endpoint: GET /teams/{team_id}/work-items/search (must be before {item_id})
# ---------------------------------------------------------------------------

@router.get(
    "/{team_id}/work-items/search",
    response_model=WorkItemsResponse,
    responses=_ERROR_RESPONSES,
)
@limiter.limit("30/minute")
async def get_work_items_search(
    request: Request,
    team_id: str = Path(..., description="Team slug"),
    q: str = Query(..., min_length=1, description="Search query (ID or text)"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
) -> WorkItemsResponse:
    """Search work items by ID or title. Fallback when not in period cache."""
    validate_date_range(start_date, end_date)
    teams = load_teams_config()
    if team_id not in teams:
        raise HTTPException(status_code=404, detail=f"Unknown team_id: {team_id}")
    client = get_azure_client(request)
    wi_cache = get_wi_cache(request)
    items = await search_work_items(
        team_id, q, start_date, end_date, client, teams, wi_cache, limit=15
    )
    return WorkItemsResponse(
        team_id=team_id,
        start_date=start_date,
        end_date=end_date,
        total=len(items),
        items=items,
    )


# ---------------------------------------------------------------------------
# Endpoint: GET /teams/{team_id}/work-items/{item_id}
# ---------------------------------------------------------------------------

@router.get(
    "/{team_id}/work-items/{item_id}",
    response_model=DeliverableRow,
    responses={**_ERROR_RESPONSES, 404: {"model": ErrorResponse, "description": "Work item not found"}},
)
@limiter.limit("30/minute")
async def get_work_item(
    request: Request,
    team_id: str = Path(..., description="Team slug"),
    item_id: int = Path(..., description="Work item ID"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
) -> DeliverableRow:
    """Fetch a single work item by ID (period-independent). For detail page and search fallback."""
    validate_date_range(start_date, end_date)
    teams = load_teams_config()
    if team_id not in teams:
        raise HTTPException(status_code=404, detail=f"Unknown team_id: {team_id}")
    client = get_azure_client(request)
    wi_cache = get_wi_cache(request)
    item = await fetch_single_work_item(
        team_id, item_id, start_date, end_date, client, teams, wi_cache
    )
    if item is None:
        raise HTTPException(status_code=404, detail=f"Work item #{item_id} not found")
    return item


# ---------------------------------------------------------------------------
# Endpoint 2: GET /teams/{team_id}/kpis
# ---------------------------------------------------------------------------

@router.get(
    "/{team_id}/kpis",
    response_model=TeamKPIsResponse,
    response_model_exclude_none=True,
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
    if kpi_config.flow_hygiene.enabled:
        fh = await _compute_single_kpi(
            KPIName.FLOW_HYGIENE, report.deliverables, kpi_config, start_date, end_date,
            request=request, team_id=team_id,
        )
        kpis.append(fh.model_copy(update={"states": None}))
    if kpi_config.wip_discipline.enabled:
        wd = await _compute_single_kpi(
            KPIName.WIP_DISCIPLINE, report.deliverables, kpi_config, start_date, end_date,
            request=request, team_id=team_id,
        )
        kpis.append(wd.model_copy(update={"persons": None}))
    if kpi_config.tech_debt_ratio.enabled:
        kpis.append(compute_tech_debt_ratio(
            report.deliverables, kpi_config.tech_debt_ratio,
        ))
    if kpi_config.initiative_delivery.enabled:
        tc = get_team_config(team_id)
        if tc:
            id_overrides = get_team_kpi_overrides(team_id)
            kpis.append(compute_initiative_delivery(
                report.deliverables, kpi_config.initiative_delivery, tc,
                id_overrides.initiative_ids, start_date, end_date,
            ))
    if kpi_config.reliability_action_delivery.enabled:
        kpis.append(compute_reliability_action_delivery(
            report.deliverables, kpi_config.reliability_action_delivery,
        ))
    dora: list = []
    dora_config = load_dora_config()
    if dora_config.deploy_frequency.enabled:
        df_kpi = await _compute_single_kpi(
            KPIName.DEPLOY_FREQUENCY, report.deliverables, kpi_config,
            start_date, end_date,
            request=request, team_id=team_id, dora_config=dora_config,
        )
        dora.append(df_kpi)
    if dora_config.lead_time.enabled:
        dora.append(compute_lead_time(
            report.deliverables, dora_config.lead_time, start_date, end_date,
        ))
    snapshot = compute_delivery_snapshot(
        report.deliverables, kpi_config, start_date, end_date,
    )
    return TeamKPIsResponse(
        team_id=team_id, start_date=start_date, end_date=end_date,
        delivery_snapshot=snapshot, kpis=kpis, dora=dora,
    )


# ---------------------------------------------------------------------------
# DORA endpoints: GET /teams/{team_id}/dora/...
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Endpoint 3: GET /teams/{team_id}/kpis/{kpi_name}
# ---------------------------------------------------------------------------

@router.get(
    "/{team_id}/kpis/{kpi_name}",
    response_model=TeamKPIDetailResponse,
    response_model_exclude_none=True,
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
    dora_config = load_dora_config()
    kpi = await _compute_single_kpi(
        kpi_name, report.deliverables, kpi_config, start_date, end_date,
        request=request, team_id=team_id, dora_config=dora_config,
    )

    seen_ids: set[int] = set()
    items: list = []
    deployments = None

    if kpi_name == KPIName.DEPLOY_FREQUENCY:
        tc = get_team_config(team_id)
        df_team = get_deploy_frequency_config(team_id) if tc else None
        has_df_config = df_team and (
            df_team.definition_environment_ids
            or (df_team.definition_ids and (df_team.environment_name or df_team.environment_guid))
        )
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
    elif kpi_name == KPIName.LEAD_TIME:
        if dora_config.lead_time.enabled:
            items = filter_dora_metric(
                report.deliverables, "measured_items",
                dora_config.lead_time, start_date, end_date,
            )
    elif isinstance(kpi, WIPDisciplineKPI) and kpi.persons:
        wip_ids = {wi.id for p in kpi.persons for wi in (p.work_items or [])}
        for d in report.deliverables:
            if d.id in wip_ids and d.id not in seen_ids:
                seen_ids.add(d.id)
                items.append(d)
    else:
        tc = get_team_config(team_id)
        id_overrides = get_team_kpi_overrides(team_id) if kpi_name == KPIName.INITIATIVE_DELIVERY else None
        for metric in KPI_METRICS[kpi_name]:
            for d in filter_deliverables_by_metric(
                report.deliverables,
                metric,
                rework_config=kpi_config.rework_rate,
                dp_config=kpi_config.delivery_predictability,
                fh_config=kpi_config.flow_hygiene,
                td_config=kpi_config.tech_debt_ratio,
                id_config=kpi_config.initiative_delivery if kpi_name == KPIName.INITIATIVE_DELIVERY else None,
                id_overrides=id_overrides,
                rad_config=kpi_config.reliability_action_delivery if kpi_name == KPIName.RELIABILITY_ACTION_DELIVERY else None,
                team_config=tc if kpi_name in (KPIName.WIP_DISCIPLINE, KPIName.INITIATIVE_DELIVERY) else None,
                start=start_date,
                end=end_date,
            ):
                if d.id not in seen_ids:
                    seen_ids.add(d.id)
                    items.append(d)
        # For initiative_delivery, also include all deliverables under initiative_ids
        if kpi_name == KPIName.INITIATIVE_DELIVERY and id_overrides and id_overrides.initiative_ids:
            ids_filter = frozenset(id_overrides.initiative_ids)
            for d in report.deliverables:
                if d.id in seen_ids:
                    continue
                if d.parent_epic and d.parent_epic.id in ids_filter:
                    seen_ids.add(d.id)
                    items.append(d)
                elif d.parent_feature and d.parent_feature.id in ids_filter:
                    seen_ids.add(d.id)
                    items.append(d)
        # For reliability_action_delivery, include all post-mortem deliverables
        if kpi_name == KPIName.RELIABILITY_ACTION_DELIVERY:
            for d in report.deliverables:
                if d.is_post_mortem and d.id not in seen_ids:
                    seen_ids.add(d.id)
                    items.append(d)

    total = len(deployments) if deployments is not None else len(items)
    return TeamKPIDetailResponse(
        team_id=team_id, start_date=start_date, end_date=end_date,
        kpi=kpi, total=total, items=items, deployments=deployments,
    )


# ---------------------------------------------------------------------------
# Endpoint 4: GET /teams/{team_id}/kpis/{kpi_name}/drilldown/{metric}
# ---------------------------------------------------------------------------

@router.get(
    "/{team_id}/kpis/{kpi_name}/drilldown/{metric}",
    response_model=DrilldownResponse,
    response_model_exclude_none=True,
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
    person: str | None = Query(None, description="Filter to a specific person (for WIP discipline drilldown)"),
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
    dora_config = load_dora_config()

    if kpi_name == KPIName.DEPLOY_FREQUENCY and metric == "deployments":
        tc = get_team_config(team_id)
        df_team = get_deploy_frequency_config(team_id) if tc else None
        has_df_config = df_team and (
            df_team.definition_environment_ids
            or (df_team.definition_ids and (df_team.environment_name or df_team.environment_guid))
        )
        deployments = []
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
            kpi_name=kpi_name.value,
            metric=metric,
            total=total,
            items=[],
            deployments=deployments[skip : skip + limit],
        )

    if kpi_name == KPIName.LEAD_TIME and metric == "measured_items":
        filtered = filter_dora_metric(
            report.deliverables, metric,
            dora_config.lead_time, start_date, end_date,
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

    tc = get_team_config(team_id) if kpi_name in (KPIName.WIP_DISCIPLINE, KPIName.INITIATIVE_DELIVERY) else None
    id_overrides = get_team_kpi_overrides(team_id) if kpi_name == KPIName.INITIATIVE_DELIVERY else None
    filtered = filter_deliverables_by_metric(
        report.deliverables,
        metric,
        rework_config=kpi_config.rework_rate,
        dp_config=kpi_config.delivery_predictability,
        fh_config=kpi_config.flow_hygiene,
        wd_config=kpi_config.wip_discipline,
        td_config=kpi_config.tech_debt_ratio,
        id_config=kpi_config.initiative_delivery if kpi_name == KPIName.INITIATIVE_DELIVERY else None,
        id_overrides=id_overrides,
        rad_config=kpi_config.reliability_action_delivery if kpi_name == KPIName.RELIABILITY_ACTION_DELIVERY else None,
        team_config=tc,
        start=start_date,
        end=end_date,
        person=person,
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


# ---------------------------------------------------------------------------
# Endpoint 6: GET /teams/{team_id}/delivery-snapshot/{metric}
# ---------------------------------------------------------------------------

@router.get(
    "/{team_id}/delivery-snapshot/{metric}",
    response_model=SnapshotDrilldownResponse,
    responses=_ERROR_RESPONSES,
)
@limiter.limit("30/minute")
async def get_snapshot_drilldown(
    request: Request,
    team_id: str = Path(..., description="Team slug"),
    metric: str = Path(..., description="Snapshot metric to drill into"),
    start_date: date = Query(..., description="Start of period (inclusive)"),
    end_date: date = Query(..., description="End of period (inclusive)"),
    skip: int = Query(0, ge=0, description="Number of items to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max items to return"),
) -> SnapshotDrilldownResponse:
    """Return work items behind a delivery snapshot metric."""
    if metric not in VALID_SNAPSHOT_METRICS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid snapshot metric '{metric}'. "
                   f"Valid: {sorted(VALID_SNAPSHOT_METRICS)}",
        )
    report = await get_team_report(request, team_id, start_date, end_date)
    kpi_config = load_kpi_config()
    filtered = filter_snapshot_metric(
        report.deliverables, metric, kpi_config, start_date, end_date,
    )
    total = len(filtered)
    return SnapshotDrilldownResponse(
        team_id=team_id,
        start_date=start_date,
        end_date=end_date,
        metric=metric,
        total=total,
        items=filtered[skip : skip + limit],
    )
