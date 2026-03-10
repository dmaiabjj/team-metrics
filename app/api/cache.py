"""Cache management endpoints — manual invalidation."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request

from app.auth import require_api_key
from app.cache import AzureResponseCache, DeploymentCache, ReportCache, WorkItemCache

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_api_key)])


def _get_caches(request: Request) -> tuple[ReportCache, WorkItemCache]:
    return request.app.state.report_cache, request.app.state.wi_cache


def _get_azure_cache(request: Request) -> AzureResponseCache | None:
    return getattr(request.app.state, "azure_cache", None)


def _get_deployment_cache(request: Request) -> DeploymentCache | None:
    return getattr(request.app.state, "deployment_cache", None)


@router.delete("")
async def invalidate_all(request: Request):
    """Clear all cached data (L1 + L2 + Azure API + deployment cache)."""
    report_cache, wi_cache = _get_caches(request)
    l1_cleared = report_cache.invalidate()
    l2_cleared = wi_cache.invalidate()
    azure_cache = _get_azure_cache(request)
    azure_cleared = azure_cache.invalidate() if azure_cache else 0
    deployment_cache = _get_deployment_cache(request)
    deployment_cleared = deployment_cache.invalidate() if deployment_cache else 0
    logger.info(
        "Cache invalidated: %d reports, %d work items, %d azure, %d deployments",
        l1_cleared, l2_cleared, azure_cleared, deployment_cleared,
    )
    return {
        "cleared": {
            "reports": l1_cleared,
            "work_items": l2_cleared,
            "azure": azure_cleared,
            "deployments": deployment_cleared,
        },
    }


@router.delete("/{team_id}")
async def invalidate_team(team_id: str, request: Request):
    """Clear cached reports and deployments for a specific team. L2 work-item cache is unaffected."""
    report_cache, _ = _get_caches(request)
    l1_cleared = report_cache.invalidate(team_id)
    deployment_cache = _get_deployment_cache(request)
    deployment_cleared = deployment_cache.invalidate(team_id) if deployment_cache else 0
    logger.info(
        "Cache invalidated for team %s: %d reports, %d deployments",
        team_id, l1_cleared, deployment_cleared,
    )
    return {
        "team_id": team_id,
        "cleared": {"reports": l1_cleared, "deployments": deployment_cleared},
    }


@router.get("/stats")
async def cache_stats(request: Request):
    """Return current cache sizes."""
    report_cache, wi_cache = _get_caches(request)
    azure_cache = _get_azure_cache(request)
    deployment_cache = _get_deployment_cache(request)
    return {
        "report_cache_entries": report_cache.size,
        "work_item_cache_entries": wi_cache.size,
        "azure_cache_entries": azure_cache.size if azure_cache else 0,
        "deployment_cache_entries": deployment_cache.size if deployment_cache else 0,
    }
