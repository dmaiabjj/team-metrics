"""In-memory LRU cache with TTL and manual invalidation for report responses and work items."""

from __future__ import annotations

import logging
import time
from collections import OrderedDict
from datetime import date

from app.schemas.report import ReportResponse

logger = logging.getLogger(__name__)

DEFAULT_REPORT_CACHE_MAX = 256
DEFAULT_WI_CACHE_MAX = 4096
DEFAULT_TTL_SECONDS = 0  # 0 means no TTL (infinite)


class ReportCache:
    """L1 cache: full ReportResponse keyed by (team_id, start_date, end_date).

    Evicts least-recently-used entries when maxsize is exceeded.
    Entries expire after ttl_seconds (0 = no expiry).
    """

    def __init__(self, maxsize: int = DEFAULT_REPORT_CACHE_MAX, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
        self._maxsize = maxsize
        self._ttl = ttl_seconds
        self._store: OrderedDict[tuple[str, date, date], tuple[float, ReportResponse]] = (
            OrderedDict()
        )

    def get(self, team_id: str, start_date: date, end_date: date) -> ReportResponse | None:
        key = (team_id, start_date, end_date)
        entry = self._store.get(key)
        if entry is None:
            return None
        stored_at, response = entry
        if self._ttl > 0 and (time.monotonic() - stored_at) > self._ttl:
            del self._store[key]
            logger.debug("L1 cache EXPIRED for %s", key)
            return None
        self._store.move_to_end(key)
        logger.debug("L1 cache HIT for %s", key)
        return response

    def put(
        self, team_id: str, start_date: date, end_date: date, response: ReportResponse
    ) -> None:
        key = (team_id, start_date, end_date)
        self._store[key] = (time.monotonic(), response)
        self._store.move_to_end(key)
        while len(self._store) > self._maxsize:
            self._store.popitem(last=False)
        logger.debug("L1 cache STORE for %s", key)

    def invalidate(self, team_id: str | None = None) -> int:
        """Clear cached reports. If team_id is given, only that team's entries."""
        if team_id is None:
            count = len(self._store)
            self._store.clear()
            return count
        keys_to_remove = [k for k in self._store if k[0] == team_id]
        for k in keys_to_remove:
            del self._store[k]
        return len(keys_to_remove)

    @property
    def size(self) -> int:
        return len(self._store)


class WorkItemCache:
    """L2 cache: individual work-item dicts keyed by (project, work_item_id).

    Evicts least-recently-used entries when maxsize is exceeded.
    Entries expire after ttl_seconds (0 = no expiry).
    """

    def __init__(self, maxsize: int = DEFAULT_WI_CACHE_MAX, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
        self._maxsize = maxsize
        self._ttl = ttl_seconds
        self._store: OrderedDict[tuple[str, int], tuple[float, dict]] = OrderedDict()

    def get(self, project: str, work_item_id: int) -> dict | None:
        key = (project, work_item_id)
        entry = self._store.get(key)
        if entry is None:
            return None
        stored_at, data = entry
        if self._ttl > 0 and (time.monotonic() - stored_at) > self._ttl:
            del self._store[key]
            logger.debug("L2 cache EXPIRED for %s/%d", project, work_item_id)
            return None
        self._store.move_to_end(key)
        logger.debug("L2 cache HIT for %s/%d", project, work_item_id)
        return data

    def put(self, project: str, work_item_id: int, data: dict) -> None:
        key = (project, work_item_id)
        self._store[key] = (time.monotonic(), data)
        self._store.move_to_end(key)
        while len(self._store) > self._maxsize:
            self._store.popitem(last=False)

    def invalidate(self) -> int:
        count = len(self._store)
        self._store.clear()
        return count

    @property
    def size(self) -> int:
        return len(self._store)
