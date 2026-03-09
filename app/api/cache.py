"""Cache management endpoints — manual invalidation."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request

from app.cache import ReportCache, WorkItemCache

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_caches(request: Request) -> tuple[ReportCache, WorkItemCache]:
    return request.app.state.report_cache, request.app.state.wi_cache


@router.delete("")
async def invalidate_all(request: Request):
    """Clear all cached data (L1 report cache + L2 work-item cache)."""
    report_cache, wi_cache = _get_caches(request)
    l1_cleared = report_cache.invalidate()
    l2_cleared = wi_cache.invalidate()
    logger.info("Cache invalidated: %d reports, %d work items", l1_cleared, l2_cleared)
    return {
        "cleared": {"reports": l1_cleared, "work_items": l2_cleared},
    }


@router.delete("/{team_id}")
async def invalidate_team(team_id: str, request: Request):
    """Clear cached reports for a specific team. L2 work-item cache is unaffected."""
    report_cache, _ = _get_caches(request)
    l1_cleared = report_cache.invalidate(team_id)
    logger.info("Cache invalidated for team %s: %d reports", team_id, l1_cleared)
    return {
        "team_id": team_id,
        "cleared": {"reports": l1_cleared},
    }


@router.get("/stats")
async def cache_stats(request: Request):
    """Return current cache sizes."""
    report_cache, wi_cache = _get_caches(request)
    return {
        "report_cache_entries": report_cache.size,
        "work_item_cache_entries": wi_cache.size,
    }
