"""Async Azure DevOps REST client with connection pooling and retry."""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta

import httpx
from tenacity import (
    RetryCallState,
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

logger = logging.getLogger(__name__)


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


def _escape_wiql(value: str) -> str:
    """Escape single quotes for WIQL string literals."""
    return value.replace(chr(39), chr(39) + chr(39))


def _normalize_org(org: str) -> str:
    """Ensure org is only the organization name, not a full URL."""
    s = (org or "").strip().rstrip("/")
    if not s:
        return s
    if "dev.azure.com/" in s:
        s = s.split("dev.azure.com/")[-1]
    return s.strip("/") or org.strip()


class AzureDevOpsClient:
    """Async Azure DevOps REST client for WIQL, work items, and revisions.

    Accepts a shared httpx.AsyncClient for connection pooling across requests.
    """

    def __init__(self, org: str, pat: str, http_client: httpx.AsyncClient | None = None):
        self.org = _normalize_org(org)
        self.pat = pat
        self._base = f"https://dev.azure.com/{self.org}"
        self._auth = ("", pat)
        self._owns_client = http_client is None
        self._client = http_client or httpx.AsyncClient(
            timeout=60.0,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )

    async def close(self) -> None:
        """Close the HTTP client only if we created it ourselves."""
        if self._owns_client and not self._client.is_closed:
            await self._client.aclose()

    async def health_check(self) -> bool:
        """Verify connectivity to Azure DevOps by listing one project."""
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

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(3),
        wait=_wait_with_retry_after,
        reraise=True,
    )
    async def wiql_query(
        self,
        project: str,
        area_paths: list[str],
        deliverable_types: list[str],
        *,
        changed_since: date | None = None,
        top: int = 20000,
    ) -> list[int]:
        """Run WIQL to get work item IDs under given area paths.

        Args:
            changed_since: Only return items changed on or after this date.
                           Dramatically reduces candidates for long-running teams.
        """
        if not deliverable_types:
            return []
        area_conditions = " OR ".join(
            f"[System.AreaPath] UNDER '{_escape_wiql(p)}'"
            for p in area_paths
            if p
        )
        if not area_conditions:
            return []
        types_clause = ",".join(f"'{_escape_wiql(t)}'" for t in deliverable_types)
        wiql = (
            f"SELECT [System.Id] FROM WorkItems "
            f"WHERE [System.TeamProject] = @project "
            f"AND ({area_conditions}) "
            f"AND [System.WorkItemType] IN ({types_clause})"
        )
        if changed_since is not None:
            wiql += f" AND [System.ChangedDate] >= '{changed_since.isoformat()}'"

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
        work_items = data.get("workItems") or []
        logger.info("WIQL returned %d candidates for project=%s", len(work_items), project)
        return [wi["id"] for wi in work_items]

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(3),
        wait=_wait_with_retry_after,
        reraise=True,
    )
    async def get_revisions(self, project: str, work_item_id: int) -> list[dict]:
        """Get all revisions for a work item."""
        url = f"{self._base}/{project}/_apis/wit/workItems/{work_item_id}/revisions"
        r = await self._client.get(
            url,
            params={"api-version": "7.1"},
            auth=self._auth,
            headers=self._headers(),
        )
        r.raise_for_status()
        data = r.json()
        return data.get("value") or []

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(3),
        wait=_wait_with_retry_after,
        reraise=True,
    )
    async def get_work_item(
        self,
        project: str,
        work_item_id: int,
        *,
        expand: str = "Relations",
    ) -> dict | None:
        """Get a single work item with relations."""
        url = f"{self._base}/{project}/_apis/wit/workItems/{work_item_id}"
        r = await self._client.get(
            url,
            params={"api-version": "7.1", "$expand": expand},
            auth=self._auth,
            headers=self._headers(),
        )
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(3),
        wait=_wait_with_retry_after,
        reraise=True,
    )
    async def _fetch_batch_chunk(
        self,
        project: str,
        ids: list[int],
        expand: str,
        fields: list[str] | None,
    ) -> list[dict]:
        """Fetch a single chunk (max 200) of work items."""
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
        return data.get("value") or []

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
        logger.info(
            "Board WIP limits for project=%s board=%s: %s", project, board, limits,
        )
        return limits

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(3),
        wait=_wait_with_retry_after,
        reraise=True,
    )
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

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(3),
        wait=_wait_with_retry_after,
        reraise=True,
    )
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
        base_builds = f"https://dev.azure.com/{self.org}/{project}/_apis/build/builds"
        buffer = timedelta(days=14)
        query_min = min_started_time - buffer
        query_max = max_started_time + buffer
        min_iso = query_min.isoformat()
        max_iso = query_max.isoformat()
        stage_name_lower = (stage_name or "").strip().lower()

        deployments: list[dict] = []
        seen: set[tuple[int, str]] = set()  # (build_id, stage_record_id)

        for definition_id in definition_ids:
            continuation_token: str | None = None
            while True:
                params: dict[str, str | int] = {
                    "api-version": "7.0",
                    "definitions": definition_id,
                    "minTime": min_iso,
                    "maxTime": max_iso,
                    "resultFilter": "succeeded",
                    "statusFilter": "completed",
                    "$top": 500,
                    "queryOrder": "finishTimeAscending",
                }
                if continuation_token:
                    params["continuationToken"] = continuation_token
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
                builds = r.json().get("value") or []
                continuation_token = (
                    r.headers.get("x-ms-continuationtoken")
                    or r.headers.get("X-MS-ContinuationToken")
                )
                for build in builds:
                    build_id = build.get("id")
                    if build_id is None:
                        continue
                    try:
                        tl_r = await self._client.get(
                            f"{base_builds}/{build_id}/timeline",
                            params={"api-version": "6.0"},
                            auth=self._auth,
                            headers=self._headers(),
                        )
                        tl_r.raise_for_status()
                    except Exception:
                        logger.warning(
                            "Could not fetch timeline for build=%s",
                            build_id, exc_info=True,
                        )
                        continue
                    tl_data = tl_r.json()
                    records = tl_data.get("records") or []
                    for rec in records:
                        if rec.get("type") != "Stage":
                            continue
                        if rec.get("result") != "succeeded":
                            continue
                        rec_name = (rec.get("name") or "").strip().lower()
                        if not stage_name_lower or not (
                            stage_name_lower in rec_name or rec_name in stage_name_lower
                        ):
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
                        key = (build_id, rec_id or str(rec.get("id", "")))
                        if key in seen:
                            continue
                        seen.add(key)
                        deployments.append({
                            "buildId": build_id,
                            "definitionId": definition_id,
                            "startTime": stage_start_str,
                            "stageName": rec.get("name"),
                            "stageId": rec.get("id"),
                            "buildNumber": build.get("buildNumber"),
                            "definitionName": build.get("definition", {}).get("name"),
                        })
                if not continuation_token:
                    break

        logger.info(
            "Build deployments for project=%s stage=%s: %d in range",
            project, stage_name or "?", len(deployments),
        )
        return deployments

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(3),
        wait=_wait_with_retry_after,
        reraise=True,
    )
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

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(3),
        wait=_wait_with_retry_after,
        reraise=True,
    )
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
