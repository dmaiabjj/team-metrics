"""Async Azure DevOps REST client with connection pooling and retry."""

from __future__ import annotations

import asyncio
import logging
from datetime import date

import httpx
from tenacity import (
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
        wait=wait_exponential(multiplier=1, min=1, max=10),
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
        wait=wait_exponential(multiplier=1, min=1, max=10),
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
        wait=wait_exponential(multiplier=1, min=1, max=10),
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
        wait=wait_exponential(multiplier=1, min=1, max=10),
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
