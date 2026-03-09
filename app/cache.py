"""In-memory cache with manual invalidation for report responses and work items."""

from __future__ import annotations

import logging
import time
from datetime import date

from app.schemas.report import ReportResponse

logger = logging.getLogger(__name__)


class ReportCache:
    """L1 cache: full ReportResponse keyed by (team_id, start_date, end_date)."""

    def __init__(self) -> None:
        self._store: dict[tuple[str, date, date], tuple[float, ReportResponse]] = {}

    def get(self, team_id: str, start_date: date, end_date: date) -> ReportResponse | None:
        key = (team_id, start_date, end_date)
        entry = self._store.get(key)
        if entry is None:
            return None
        logger.debug("L1 cache HIT for %s", key)
        return entry[1]

    def put(self, team_id: str, start_date: date, end_date: date, response: ReportResponse) -> None:
        key = (team_id, start_date, end_date)
        self._store[key] = (time.monotonic(), response)
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
    """L2 cache: individual work-item dicts keyed by (project, work_item_id)."""

    def __init__(self) -> None:
        self._store: dict[tuple[str, int], dict] = {}

    def get(self, project: str, work_item_id: int) -> dict | None:
        key = (project, work_item_id)
        entry = self._store.get(key)
        if entry is not None:
            logger.debug("L2 cache HIT for %s/%d", project, work_item_id)
        return entry

    def put(self, project: str, work_item_id: int, data: dict) -> None:
        self._store[(project, work_item_id)] = data

    def invalidate(self) -> int:
        count = len(self._store)
        self._store.clear()
        return count

    @property
    def size(self) -> int:
        return len(self._store)
