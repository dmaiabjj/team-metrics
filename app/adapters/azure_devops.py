"""Async Azure DevOps REST client with connection pooling, retry, and circuit breaker."""

from __future__ import annotations

import asyncio
import functools
import hashlib
import json
import logging
import time
from datetime import date, datetime, timedelta
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict

from app.cache import AzureResponseCache
from tenacity import (
    RetryCallState,
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic models for Azure API response validation (boundary validation)
# ---------------------------------------------------------------------------

class AzureWorkItemResponse(BaseModel):
    """Lightweight validation model for Azure DevOps work item responses."""
    model_config = ConfigDict(extra="ignore")
    id: int
    rev: int = 0
    fields: dict[str, Any] = {}
    relations: list[dict[str, Any]] = []


class AzureWiqlResponse(BaseModel):
    """Lightweight validation model for WIQL query responses."""
    model_config = ConfigDict(extra="ignore")
    workItems: list[dict[str, Any]] = []


# ---------------------------------------------------------------------------
# Cache key helpers
# ---------------------------------------------------------------------------

def _cache_key(*parts: object) -> str:
    """Build a deterministic cache key from parts."""
    return ":".join(str(p) for p in parts)


def _cache_key_hash(*parts: object) -> str:
    """Build a short hash for complex key parts."""
    payload = json.dumps(parts, sort_keys=True, default=str)
    return hashlib.md5(payload.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Retry infrastructure
# ---------------------------------------------------------------------------

def _is_retryable(exc: BaseException) -> bool:
    """Retry on 429, 503, and transient connection errors."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in {429, 503}
    return isinstance(exc, (httpx.ConnectError, httpx.ReadTimeout, httpx.ConnectTimeout))


def _wait_with_retry_after(retry_state: RetryCallState) -> float:
    """Respect Retry-After header on 429 responses, fall back to exponential backoff."""
    exc = retry_state.outcome.exception() if retry_state.outcome else None
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429:
        retry_after = exc.response.headers.get("Retry-After")
        if retry_after:
            try:
                wait_seconds = float(retry_after)
                return min(wait_seconds, 60.0)  # cap at 60s
            except (ValueError, TypeError):
                pass
    # Fall back to exponential backoff: 1s, 2s, 4s, ... capped at 10s.
    return wait_exponential(multiplier=1, min=1, max=10)(retry_state)


_azure_retry = retry(
    retry=retry_if_exception(_is_retryable),
    stop=stop_after_attempt(3),
    wait=_wait_with_retry_after,
    reraise=True,
)


# ---------------------------------------------------------------------------
# Circuit breaker
# ---------------------------------------------------------------------------

class _CircuitBreaker:
    """Simple circuit breaker for Azure DevOps API calls.

    Opens after `threshold` consecutive failures, stays open for
    `recovery_seconds`, then allows a single probe request.
    """

    def __init__(self, threshold: int = 5, recovery_seconds: float = 60):
        self._failures = 0
        self._last_failure = 0.0
        self._threshold = threshold
        self._recovery = recovery_seconds

    @property
    def is_open(self) -> bool:
        if self._failures < self._threshold:
            return False
        return (time.monotonic() - self._last_failure) < self._recovery

    def record_failure(self) -> None:
        self._failures += 1
        self._last_failure = time.monotonic()

    def record_success(self) -> None:
        self._failures = 0


def _is_circuit_breaker_failure(exc: BaseException) -> bool:
    """True if the error indicates Azure/service unavailability (should trip circuit breaker)."""
    if isinstance(exc, httpx.HTTPStatusError):
        # 4xx = client error (bad config, invalid area path, etc.) — not Azure being down
        if exc.response.status_code < 500:
            return False
    return True


def _with_circuit_breaker(method):
    """Decorator that wraps an async method with circuit breaker checks."""
    @functools.wraps(method)
    async def wrapper(self, *args, **kwargs):
        if self._circuit_breaker.is_open:
            raise httpx.ConnectError("Circuit breaker open — Azure DevOps appears unavailable")
        try:
            result = await method(self, *args, **kwargs)
            self._circuit_breaker.record_success()
            return result
        except Exception as exc:
            if _is_circuit_breaker_failure(exc):
                self._circuit_breaker.record_failure()
            raise
    return wrapper


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _escape_wiql(value: str) -> str:
    """Escape single quotes for WIQL string literals."""
    return value.replace(chr(39), chr(39) + chr(39))


def _area_path_condition(project: str, area_path: str) -> str:
    """Build WIQL condition for a path: root uses =, sub-areas use UNDER."""
    escaped = _escape_wiql(area_path.strip())
    if area_path.strip() == project:
        return f"[System.AreaPath] = '{escaped}'"
    return f"[System.AreaPath] UNDER '{escaped}'"


def _normalize_org(org: str) -> str:
    """Ensure org is only the organization name, not a full URL."""
    s = (org or "").strip().rstrip("/")
    if not s:
        return s
    if "dev.azure.com/" in s:
        s = s.split("dev.azure.com/")[-1]
    return s.strip("/") or org.strip()


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class AzureDevOpsClient:
    """Async Azure DevOps REST client for WIQL, work items, and revisions.

    Accepts a shared httpx.AsyncClient for connection pooling across requests.
    Includes circuit breaker for resilience under Azure outages.
    """

    def __init__(
        self,
        org: str,
        pat: str,
        http_client: httpx.AsyncClient | None = None,
        azure_cache: AzureResponseCache | None = None,
    ):
        self.org = _normalize_org(org)
        self.pat = pat
        self._base = f"https://dev.azure.com/{self.org}"
        self._auth = ("", pat)
        self._owns_client = http_client is None
        self._cache = azure_cache
        self._circuit_breaker = _CircuitBreaker()
        self._client = http_client or httpx.AsyncClient(
            timeout=60.0,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )

    async def close(self) -> None:
        """Close the HTTP client only if we created it ourselves."""
        if self._owns_client and not self._client.is_closed:
            await self._client.aclose()

    async def health_check(self) -> bool:
        """Verify connectivity to Azure DevOps by listing one project.

        Always hits Azure (no cache) for real-time status.
        """
        url = f"{self._base}/_apis/projects"
        r = await self._client.get(
            url,
            params={"api-version": "7.1", "$top": "1"},
            auth=self._auth,
            headers=self._headers(),
        )
        r.raise_for_status()
        return True

    def _headers(self) -> dict[str, str]:
        return {"Accept": "application/json", "Content-Type": "application/json"}

    @_with_circuit_breaker
    @_azure_retry
    async def wiql_query(
        self,
        project: str,
        area_paths: list[str],
        deliverable_types: list[str],
        *,
        changed_since: date | None = None,
        top: int = 20000,
    ) -> list[int]:
        """Run WIQL to get work item IDs. area_paths are EXCLUSIONS (items under
        these paths are excluded). Empty area_paths = include all in project.

        Args:
            changed_since: Only return items changed on or after this date.
                           Dramatically reduces candidates for long-running teams.
        """
        if not deliverable_types:
            return []
        excl_conditions = [_area_path_condition(project, p) for p in area_paths if p]
        area_clause = f" AND NOT ({' OR '.join(excl_conditions)})" if excl_conditions else ""
        types_clause = ",".join(f"'{_escape_wiql(t)}'" for t in deliverable_types)
        wiql = (
            f"SELECT [System.Id] FROM WorkItems "
            f"WHERE [System.TeamProject] = @project "
            f"{area_clause} "
            f"AND [System.WorkItemType] IN ({types_clause})"
        )
        if changed_since is not None:
            wiql += f" AND [System.ChangedDate] >= '{changed_since.isoformat()}'"

        key = _cache_key("wiql", project, _cache_key_hash(area_paths, deliverable_types, changed_since))
        if self._cache:
            cached = self._cache.get(key)
            if cached is not None:
                return cached

        url = f"{self._base}/{project}/_apis/wit/wiql"
        params: dict[str, str] = {"api-version": "7.1"}
        if top:
            params["$top"] = str(top)

        logger.debug("WIQL query for project=%s, types=%s", project, deliverable_types)
        r = await self._client.post(
            url,
            params=params,
            json={"query": wiql},
            auth=self._auth,
            headers=self._headers(),
        )
        r.raise_for_status()
        data = r.json()
        validated = AzureWiqlResponse.model_validate(data)
        result = [wi["id"] for wi in validated.workItems]
        if len(result) >= top:
            logger.warning(
                "WIQL hit $top=%d limit for project=%s — results may be truncated",
                top, project,
            )
        if self._cache:
            self._cache.put(key, result)
        logger.info("WIQL returned %d candidates for project=%s", len(result), project)
        return result

    @_with_circuit_breaker
    @_azure_retry
    async def wiql_search_by_title(
        self,
        project: str,
        area_paths: list[str],
        deliverable_types: list[str],
        title_contains: str,
        *,
        changed_since: date | None = None,
        top: int = 50,
    ) -> list[int]:
        """Run WIQL to get work item IDs matching title. area_paths are EXCLUSIONS."""
        if not deliverable_types or not title_contains.strip():
            return []
        excl_conditions = [_area_path_condition(project, p) for p in area_paths if p]
        area_clause = f" AND NOT ({' OR '.join(excl_conditions)})" if excl_conditions else ""
        types_clause = ",".join(f"'{_escape_wiql(t)}'" for t in deliverable_types)
        escaped_title = _escape_wiql(title_contains.strip())
        wiql = (
            f"SELECT [System.Id] FROM WorkItems "
            f"WHERE [System.TeamProject] = @project "
            f"{area_clause} "
            f"AND [System.WorkItemType] IN ({types_clause}) "
            f"AND [System.Title] CONTAINS '{escaped_title}'"
        )
        if changed_since is not None:
            wiql += f" AND [System.ChangedDate] >= '{changed_since.isoformat()}'"

        url = f"{self._base}/{project}/_apis/wit/wiql"
        r = await self._client.post(
            url,
            params={"api-version": "7.1", "$top": str(top)},
            json={"query": wiql},
            auth=self._auth,
            headers=self._headers(),
        )
        r.raise_for_status()
        data = r.json()
        validated = AzureWiqlResponse.model_validate(data)
        return [wi["id"] for wi in validated.workItems]

    @_with_circuit_breaker
    @_azure_retry
    async def get_revisions(self, project: str, work_item_id: int) -> list[dict]:
        """Get all revisions for a work item."""
        key = _cache_key("rev", project, work_item_id)
        if self._cache:
            cached = self._cache.get(key)
            if cached is not None:
                return cached
        url = f"{self._base}/{project}/_apis/wit/workItems/{work_item_id}/revisions"
        r = await self._client.get(
            url,
            params={"api-version": "7.1"},
            auth=self._auth,
            headers=self._headers(),
        )
        r.raise_for_status()
        data = r.json()
        result = data.get("value") or []
        if self._cache:
            self._cache.put(key, result)
        return result

    @_with_circuit_breaker
    @_azure_retry
    async def get_work_item(
        self,
        project: str,
        work_item_id: int,
        *,
        expand: str = "Relations",
    ) -> dict | None:
        """Get a single work item with relations."""
        key = _cache_key("wi", project, work_item_id, expand)
        if self._cache:
            cached = self._cache.get(key)
            if cached is not None:
                return None if cached == "__none__" else cached
        url = f"{self._base}/{project}/_apis/wit/workItems/{work_item_id}"
        r = await self._client.get(
            url,
            params={"api-version": "7.1", "$expand": expand},
            auth=self._auth,
            headers=self._headers(),
        )
        if r.status_code == 404:
            if self._cache:
                self._cache.put(key, "__none__")
            return None
        r.raise_for_status()
        result = r.json()
        if self._cache:
            self._cache.put(key, result)
        return result

    @_with_circuit_breaker
    @_azure_retry
    async def _fetch_batch_chunk(
        self,
        project: str,
        ids: list[int],
        expand: str,
        fields: list[str] | None,
    ) -> list[dict]:
        """Fetch a single chunk (max 200) of work items."""
        ids_tuple = tuple(sorted(ids))
        fields_str = ",".join(sorted(fields)) if fields else ""
        key = _cache_key("batch", project, _cache_key_hash(ids_tuple), expand, fields_str)
        if self._cache:
            cached = self._cache.get(key)
            if cached is not None:
                return cached
        url = f"{self._base}/{project}/_apis/wit/workitemsbatch"
        body: dict = {"ids": ids, "$expand": expand}
        if fields:
            body["fields"] = fields
        r = await self._client.post(
            url,
            params={"api-version": "7.1"},
            json=body,
            auth=self._auth,
            headers=self._headers(),
        )
        r.raise_for_status()
        data = r.json()
        result = data.get("value") or []
        if self._cache:
            self._cache.put(key, result)
        return result

    async def get_work_items_batch(
        self,
        project: str,
        ids: list[int],
        *,
        expand: str = "Relations",
        fields: list[str] | None = None,
    ) -> list[dict]:
        """Fetch multiple work items by ID in parallel chunks of 200.

        Args:
            fields: Optional list of field reference names to return (reduces payload).
        """
        if not ids:
            return []
        chunk_size = 200
        chunks = [ids[i : i + chunk_size] for i in range(0, len(ids), chunk_size)]
        if len(chunks) == 1:
            result = await self._fetch_batch_chunk(project, chunks[0], expand, fields)
        else:
            batch_results = await asyncio.gather(
                *[self._fetch_batch_chunk(project, c, expand, fields) for c in chunks]
            )
            result = [wi for batch in batch_results for wi in batch]
        logger.info("Batch fetched %d work items for project=%s", len(result), project)
        return result

    async def get_board_wip_limits(
        self,
        project: str,
        board: str = "Stories",
        team: str | None = None,
    ) -> dict[str, int]:
        """Fetch WIP limits from Azure DevOps board columns.

        Returns a dict mapping state name -> itemLimit for columns
        where itemLimit > 0.  Falls back to empty dict on any error.
        ``team`` defaults to "{project} Team" which is the Azure DevOps
        default team convention.
        """
        team = team or f"{project} Team"
        key = _cache_key("board", project, board, team)
        if self._cache:
            cached = self._cache.get(key)
            if cached is not None:
                return cached
        url = f"{self._base}/{project}/{team}/_apis/work/boards/{board}"
        try:
            r = await self._client.get(
                url,
                params={"api-version": "7.1"},
                auth=self._auth,
                headers=self._headers(),
            )
            r.raise_for_status()
        except Exception:
            logger.warning(
                "Could not fetch board WIP limits for project=%s board=%s: returning empty",
                project, board, exc_info=True,
            )
            return {}

        data = r.json()
        limits: dict[str, int] = {}
        for col in data.get("columns") or []:
            item_limit = col.get("itemLimit", 0)
            if item_limit <= 0:
                continue
            for state in (col.get("stateMappings") or {}).values():
                if state and state not in limits:
                    limits[state] = item_limit
        if self._cache:
            self._cache.put(key, limits)
        logger.info(
            "Board WIP limits for project=%s board=%s: %s", project, board, limits,
        )
        return limits

    @_with_circuit_breaker
    @_azure_retry
    async def get_release_deployments(
        self,
        project: str,
        min_started_time: datetime,
        max_started_time: datetime,
        definition_environment_ids: list[tuple[int, int]] | None = None,
    ) -> list[dict]:
        """Fetch successful deployments to production in the date range.

        Uses the Release Management API (vsrm.dev.azure.com). If
        definition_environment_ids is provided, fetches deployments for each
        (definition_id, definition_environment_id) pair and merges. Otherwise
        returns empty list (caller must specify which pipelines count as prod).

        Returns list of deployment objects (id, startedOn, release, environment, etc.).
        """
        base = f"https://vsrm.dev.azure.com/{self.org}/{project}/_apis/release/deployments"
        min_iso = min_started_time.isoformat()
        max_iso = max_started_time.isoformat()

        if not definition_environment_ids:
            return []

        all_deployments: list[dict] = []
        seen_ids: set[int] = set()

        for definition_id, definition_environment_id in definition_environment_ids:
            params: dict[str, str | int] = {
                "api-version": "6.0",
                "definitionId": definition_id,
                "definitionEnvironmentId": definition_environment_id,
                "deploymentStatus": "succeeded",
                "minStartedTime": min_iso,
                "maxStartedTime": max_iso,
                "queryOrder": "ascending",
                "$top": 1000,
            }
            try:
                r = await self._client.get(
                    base,
                    params=params,
                    auth=self._auth,
                    headers=self._headers(),
                )
                r.raise_for_status()
            except Exception:
                logger.warning(
                    "Could not fetch deployments for definition=%s env=%s: %s",
                    definition_id, definition_environment_id, exc_info=True,
                )
                continue
            data = r.json()
            for dep in data.get("value") or []:
                dep_id = dep.get("id")
                if dep_id is not None and dep_id not in seen_ids:
                    seen_ids.add(dep_id)
                    all_deployments.append(dep)

        logger.info(
            "Release deployments for project=%s: %d in range",
            project, len(all_deployments),
        )
        return all_deployments

    # -------------------------------------------------------------------
    # Build deployments (YAML pipelines) — decomposed into focused methods
    # -------------------------------------------------------------------

    async def _fetch_builds_paginated(
        self,
        project: str,
        definition_id: int,
        query_min_iso: str,
        query_max_iso: str,
    ) -> list[dict]:
        """Fetch all builds for a definition in time range, handling pagination."""
        base_builds = f"https://dev.azure.com/{self.org}/{project}/_apis/build/builds"
        all_builds: list[dict] = []
        continuation_token: str | None = None

        while True:
            params: dict[str, str | int] = {
                "api-version": "7.0",
                "definitions": definition_id,
                "minTime": query_min_iso,
                "maxTime": query_max_iso,
                "resultFilter": "succeeded",
                "statusFilter": "completed",
                "$top": 500,
                "queryOrder": "finishTimeAscending",
            }
            if continuation_token:
                params["continuationToken"] = continuation_token
            builds_key = _cache_key(
                "builds", project, definition_id, query_min_iso, query_max_iso,
                continuation_token or "",
            )
            if self._cache:
                cached = self._cache.get(builds_key)
                if cached is not None:
                    builds = cached.get("value") or []
                    continuation_token = cached.get("x-ms-continuationtoken")
                else:
                    builds = None
            else:
                builds = None

            if builds is None:
                try:
                    r = await self._client.get(
                        base_builds,
                        params=params,
                        auth=self._auth,
                        headers=self._headers(),
                    )
                    r.raise_for_status()
                except Exception:
                    logger.warning(
                        "Could not fetch builds for definition=%s",
                        definition_id, exc_info=True,
                    )
                    break
                data = r.json()
                builds = data.get("value") or []
                continuation_token = (
                    r.headers.get("x-ms-continuationtoken")
                    or r.headers.get("X-MS-ContinuationToken")
                )
                if self._cache:
                    self._cache.put(builds_key, {
                        "value": builds,
                        "x-ms-continuationtoken": continuation_token,
                    })

            all_builds.extend(builds)
            if not continuation_token:
                break

        return all_builds

    async def _fetch_build_timeline(self, project: str, build_id: int) -> list[dict]:
        """Fetch timeline records for a single build."""
        base_builds = f"https://dev.azure.com/{self.org}/{project}/_apis/build/builds"
        tl_key = _cache_key("timeline", project, build_id)
        if self._cache:
            tl_data = self._cache.get(tl_key)
        else:
            tl_data = None

        if tl_data is None:
            try:
                tl_r = await self._client.get(
                    f"{base_builds}/{build_id}/timeline",
                    params={"api-version": "6.0"},
                    auth=self._auth,
                    headers=self._headers(),
                )
                tl_r.raise_for_status()
                tl_data = tl_r.json()
                if self._cache:
                    self._cache.put(tl_key, tl_data)
            except Exception:
                logger.warning(
                    "Could not fetch timeline for build=%s",
                    build_id, exc_info=True,
                )
                return []

        return tl_data.get("records") or []

    @staticmethod
    def _filter_stage_records(
        records: list[dict],
        stage_name_lower: str,
        min_started_time: datetime,
        max_started_time: datetime,
        build: dict,
        definition_id: int,
        seen: set[tuple[int, str]],
    ) -> list[dict]:
        """Filter timeline records for matching stage deployments."""
        deployments: list[dict] = []
        build_id = build.get("id")

        for rec in records:
            if rec.get("type") != "Stage":
                continue
            if rec.get("result") != "succeeded":
                continue
            rec_name = (rec.get("name") or "").strip().lower()
            # Exact match or prefix match (e.g. "prod" matches "prod-canary")
            if not stage_name_lower:
                continue
            if rec_name != stage_name_lower and not rec_name.startswith(stage_name_lower):
                continue
            stage_start_str = rec.get("startTime") or build.get("startTime", "")
            if stage_start_str:
                try:
                    stage_start = datetime.fromisoformat(
                        stage_start_str.replace("Z", "+00:00")
                    )
                    if stage_start < min_started_time or stage_start > max_started_time:
                        continue
                except (ValueError, TypeError):
                    pass
            rec_id = (rec.get("id") or "").strip().lower()
            seen_key = (build_id, rec_id or str(rec.get("id", "")))
            if seen_key in seen:
                continue
            seen.add(seen_key)
            deployments.append({
                "buildId": build_id,
                "definitionId": definition_id,
                "startTime": stage_start_str,
                "stageName": rec.get("name"),
                "stageId": rec.get("id"),
                "buildNumber": build.get("buildNumber"),
                "definitionName": build.get("definition", {}).get("name"),
            })

        return deployments

    @_with_circuit_breaker
    @_azure_retry
    async def get_build_deployments_by_stage(
        self,
        project: str,
        min_started_time: datetime,
        max_started_time: datetime,
        definition_ids: list[int],
        stage_name: str,
    ) -> list[dict]:
        """Fetch successful YAML pipeline runs where the given stage succeeded.

        Uses Build API: list builds per definition, get timeline, filter by stage name.
        Build query uses a 14-day buffer. Final filter is by stage startTime.
        Returns list of deployment-like dicts: {buildId, definitionId, startTime, stageName, ...}.
        """
        buffer = timedelta(days=14)
        query_min = min_started_time - buffer
        query_max = max_started_time + buffer
        query_min_iso = query_min.isoformat()
        query_max_iso = query_max.isoformat()
        stage_name_lower = (stage_name or "").strip().lower()

        deployments: list[dict] = []
        seen: set[tuple[int, str]] = set()

        for definition_id in definition_ids:
            builds = await self._fetch_builds_paginated(
                project, definition_id, query_min_iso, query_max_iso,
            )
            for build in builds:
                build_id = build.get("id")
                if build_id is None:
                    continue
                records = await self._fetch_build_timeline(project, build_id)
                deployments.extend(
                    self._filter_stage_records(
                        records, stage_name_lower,
                        min_started_time, max_started_time,
                        build, definition_id, seen,
                    )
                )

        logger.info(
            "Build deployments for project=%s stage=%s: %d in range",
            project, stage_name or "?", len(deployments),
        )
        return deployments

    @_with_circuit_breaker
    @_azure_retry
    async def get_release_deployments_by_definition_and_env_name(
        self,
        project: str,
        min_started_time: datetime,
        max_started_time: datetime,
        definition_ids: list[int],
        environment_name: str,
    ) -> list[dict]:
        """Fetch successful deployments for given pipelines, filtered by environment/stage name.

        Uses Release API without definitionEnvironmentId; fetches per definitionId
        and filters by releaseEnvironment.name. Use when you have pipeline IDs and
        stage name (e.g. 'Coreflex PROD') but not integer definitionEnvironmentId.
        """
        base = f"https://vsrm.dev.azure.com/{self.org}/{project}/_apis/release/deployments"
        min_iso = min_started_time.isoformat()
        max_iso = max_started_time.isoformat()
        env_name_lower = environment_name.strip().lower()

        all_deployments: list[dict] = []
        seen_ids: set[int] = set()

        for definition_id in definition_ids:
            params: dict[str, str | int] = {
                "api-version": "6.0",
                "definitionId": definition_id,
                "deploymentStatus": "succeeded",
                "minStartedTime": min_iso,
                "maxStartedTime": max_iso,
                "queryOrder": "ascending",
                "$top": 1000,
            }
            try:
                r = await self._client.get(
                    base,
                    params=params,
                    auth=self._auth,
                    headers=self._headers(),
                )
                r.raise_for_status()
            except Exception:
                logger.warning(
                    "Could not fetch deployments for definition=%s",
                    definition_id, exc_info=True,
                )
                continue
            data = r.json()
            for dep in data.get("value") or []:
                env = dep.get("releaseEnvironment") or {}
                dep_env_name = (env.get("name") or "").strip().lower()
                if env_name_lower not in dep_env_name and dep_env_name not in env_name_lower:
                    continue
                dep_id = dep.get("id")
                if dep_id is not None and dep_id not in seen_ids:
                    seen_ids.add(dep_id)
                    all_deployments.append(dep)
        logger.info(
            "Release deployments for project=%s env=%s: %d in range",
            project, environment_name, len(all_deployments),
        )
        return all_deployments

    @_with_circuit_breaker
    @_azure_retry
    async def get_environment_deployment_records(
        self,
        project: str,
        environment_id: str,
        min_started_time: datetime,
        max_started_time: datetime,
    ) -> list[dict]:
        """Fetch deployment records for an environment (GUID) via Environments API.

        Uses Pipelines Environments API. environment_id can be integer or GUID.
        Returns records filtered by startTime in range. Result format differs from
        Release API; caller must normalize if needed.
        """
        base = f"https://dev.azure.com/{self.org}/{project}/_apis/pipelines/environments/{environment_id}/environmentdeploymentrecords"
        all_records: list[dict] = []
        total_raw = 0
        first_rec_keys: list[str] | None = None
        continuation_token: str | None = None

        while True:
            params: dict[str, str | int] = {
                "api-version": "7.2-preview.1",
                "$top": 500,
            }
            if continuation_token:
                params["continuationToken"] = continuation_token
            try:
                r = await self._client.get(
                    base,
                    params=params,
                    auth=self._auth,
                    headers=self._headers(),
                )
                r.raise_for_status()
            except Exception:
                logger.warning(
                    "Could not fetch environment deployment records for env=%s",
                    environment_id, exc_info=True,
                )
                break
            data = r.json()
            records = data.get("value") or []
            total_raw += len(records)
            for rec in records:
                if first_rec_keys is None and rec:
                    first_rec_keys = list(rec.keys())
                start_str = rec.get("startTime")
                if start_str:
                    try:
                        start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                        if min_started_time <= start_dt <= max_started_time:
                            if rec.get("result") == "succeeded":
                                all_records.append(rec)
                    except (ValueError, TypeError):
                        pass
            continuation_token = data.get("continuationToken")
            if not continuation_token:
                break

        logger.info(
            "Environment deployment records for project=%s env=%s: %d in range",
            project, environment_id, len(all_records),
        )
        return all_records
