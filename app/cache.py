"""In-memory LRU cache with TTL, thread-safety, and manual invalidation."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections import OrderedDict
from datetime import date

from app.schemas.report import ReportResponse

logger = logging.getLogger(__name__)

DEFAULT_REPORT_CACHE_MAX = 256
DEFAULT_WI_CACHE_MAX = 4096
DEFAULT_AZURE_CACHE_MAX = 2048
DEFAULT_DEPLOYMENT_CACHE_MAX = 512
DEFAULT_REPORT_TTL_SECONDS = 600  # 10 min for L1
DEFAULT_WI_TTL_SECONDS = 1800  # 30 min for L2
DEFAULT_AZURE_TTL_SECONDS = 300  # 5 min for Azure API responses
DEFAULT_DEPLOYMENT_TTL_SECONDS = 3600  # 1 hour for historical deployment data


class AzureResponseCache:
    """Generic LRU+TTL cache for Azure DevOps API responses.

    Key: string (caller builds deterministic key from method + params).
    Value: JSON-serializable (dict, list, etc.).
    Evicts least-recently-used entries when maxsize is exceeded.
    Entries expire after ttl_seconds (0 = no expiry).
    Thread-safe via threading.Lock (sub-microsecond hold times).
    """

    def __init__(
        self,
        maxsize: int = DEFAULT_AZURE_CACHE_MAX,
        ttl_seconds: int = DEFAULT_AZURE_TTL_SECONDS,
    ) -> None:
        self._maxsize = maxsize
        self._ttl = ttl_seconds
        self._store: OrderedDict[str, tuple[float, object]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> object | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            stored_at, value = entry
            if self._ttl > 0 and (time.monotonic() - stored_at) > self._ttl:
                del self._store[key]
                logger.debug("Azure cache EXPIRED for %s", key[:80])
                return None
            self._store.move_to_end(key)
            logger.debug("Azure cache HIT for %s", key[:80])
            return value

    def put(self, key: str, value: object) -> None:
        with self._lock:
            self._store[key] = (time.monotonic(), value)
            self._store.move_to_end(key)
            while len(self._store) > self._maxsize:
                self._store.popitem(last=False)
            logger.debug("Azure cache STORE for %s", key[:80])

    def invalidate(self, prefix: str | None = None) -> int:
        """Clear cached entries. If prefix is given, only entries whose key starts with prefix."""
        with self._lock:
            if prefix is None:
                count = len(self._store)
                self._store.clear()
                return count
            keys_to_remove = [k for k in self._store if k.startswith(prefix)]
            for k in keys_to_remove:
                del self._store[k]
            return len(keys_to_remove)

    @property
    def size(self) -> int:
        return len(self._store)


class DeploymentCache:
    """L3 cache: deployment data for DORA deploy frequency, keyed by (team_id, start_date, end_date).

    Stores (deployments, format) tuple. format is "release" | "build" | "environment".
    Evicts least-recently-used entries when maxsize is exceeded.
    Entries expire after ttl_seconds (0 = no expiry). Longer TTL recommended for historical data.
    Thread-safe via threading.Lock.
    """

    def __init__(
        self,
        maxsize: int = DEFAULT_DEPLOYMENT_CACHE_MAX,
        ttl_seconds: int = DEFAULT_DEPLOYMENT_TTL_SECONDS,
    ) -> None:
        self._maxsize = maxsize
        self._ttl = ttl_seconds
        self._store: OrderedDict[tuple[str, date, date], tuple[float, tuple[list[dict], str]]] = (
            OrderedDict()
        )
        self._lock = threading.Lock()

    def get(self, team_id: str, start_date: date, end_date: date) -> tuple[list[dict], str] | None:
        key = (team_id, start_date, end_date)
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            stored_at, value = entry
            if self._ttl > 0 and (time.monotonic() - stored_at) > self._ttl:
                del self._store[key]
                logger.debug("Deployment cache EXPIRED for %s", key)
                return None
            self._store.move_to_end(key)
            logger.debug("Deployment cache HIT for %s", key)
            return value

    def put(
        self,
        team_id: str,
        start_date: date,
        end_date: date,
        deployments: list[dict],
        fmt: str,
    ) -> None:
        key = (team_id, start_date, end_date)
        with self._lock:
            self._store[key] = (time.monotonic(), (deployments, fmt))
            self._store.move_to_end(key)
            while len(self._store) > self._maxsize:
                self._store.popitem(last=False)
            logger.debug("Deployment cache STORE for %s", key)

    def invalidate(self, team_id: str | None = None) -> int:
        """Clear cached deployments. If team_id is given, only that team's entries."""
        with self._lock:
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


class ReportCache:
    """L1 cache: full ReportResponse keyed by (team_id, start_date, end_date).

    Evicts least-recently-used entries when maxsize is exceeded.
    Entries expire after ttl_seconds (0 = no expiry).
    Thread-safe via threading.Lock.
    Includes single-flight pattern to prevent cache stampede.
    """

    def __init__(self, maxsize: int = DEFAULT_REPORT_CACHE_MAX, ttl_seconds: int = DEFAULT_REPORT_TTL_SECONDS) -> None:
        self._maxsize = maxsize
        self._ttl = ttl_seconds
        self._store: OrderedDict[tuple[str, date, date], tuple[float, ReportResponse]] = (
            OrderedDict()
        )
        self._lock = threading.Lock()
        self._in_flight: dict[tuple[str, date, date], asyncio.Event] = {}

    def get(self, team_id: str, start_date: date, end_date: date) -> ReportResponse | None:
        key = (team_id, start_date, end_date)
        with self._lock:
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
        with self._lock:
            self._store[key] = (time.monotonic(), response)
            self._store.move_to_end(key)
            while len(self._store) > self._maxsize:
                self._store.popitem(last=False)
            logger.debug("L1 cache STORE for %s", key)

    def invalidate(self, team_id: str | None = None) -> int:
        """Clear cached reports. If team_id is given, only that team's entries."""
        with self._lock:
            if team_id is None:
                count = len(self._store)
                self._store.clear()
                return count
            keys_to_remove = [k for k in self._store if k[0] == team_id]
            for k in keys_to_remove:
                del self._store[k]
            return len(keys_to_remove)

    async def get_or_wait(
        self, team_id: str, start_date: date, end_date: date
    ) -> ReportResponse | None:
        """Return cached value, or wait if another coroutine is already computing it."""
        cached = self.get(team_id, start_date, end_date)
        if cached is not None:
            return cached
        key = (team_id, start_date, end_date)
        if key in self._in_flight:
            await self._in_flight[key].wait()
            return self.get(team_id, start_date, end_date)
        return None

    def mark_computing(self, team_id: str, start_date: date, end_date: date) -> None:
        """Signal that this key is being computed — other coroutines should wait."""
        key = (team_id, start_date, end_date)
        self._in_flight[key] = asyncio.Event()

    def mark_done(self, team_id: str, start_date: date, end_date: date) -> None:
        """Signal that computation is complete — wake waiting coroutines."""
        key = (team_id, start_date, end_date)
        event = self._in_flight.pop(key, None)
        if event:
            event.set()

    @property
    def size(self) -> int:
        return len(self._store)


class WorkItemCache:
    """L2 cache: individual work-item dicts keyed by (project, work_item_id).

    Evicts least-recently-used entries when maxsize is exceeded.
    Entries expire after ttl_seconds (0 = no expiry).
    Thread-safe via threading.Lock.
    """

    def __init__(self, maxsize: int = DEFAULT_WI_CACHE_MAX, ttl_seconds: int = DEFAULT_WI_TTL_SECONDS) -> None:
        self._maxsize = maxsize
        self._ttl = ttl_seconds
        self._store: OrderedDict[tuple[str, int], tuple[float, dict]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, project: str, work_item_id: int) -> dict | None:
        key = (project, work_item_id)
        with self._lock:
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
        with self._lock:
            self._store[key] = (time.monotonic(), data)
            self._store.move_to_end(key)
            while len(self._store) > self._maxsize:
                self._store.popitem(last=False)

    def invalidate(self) -> int:
        with self._lock:
            count = len(self._store)
            self._store.clear()
            return count

    @property
    def size(self) -> int:
        return len(self._store)
