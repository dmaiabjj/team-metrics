"""Async Azure DevOps REST client with connection pooling and retry."""

from __future__ import annotations

import logging

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
        top: int = 20000,
    ) -> list[int]:
        """Run WIQL to get work item IDs under given area paths."""
        if not deliverable_types:
            return []
        area_conditions = " OR ".join(
            f"[System.AreaPath] UNDER '{p.replace(chr(39), chr(39) + chr(39))}'"
            for p in area_paths
            if p
        )
        if not area_conditions:
            return []
        types_clause = ",".join(f"'{t}'" for t in deliverable_types)
        wiql = (
            f"SELECT [System.Id] FROM WorkItems "
            f"WHERE [System.TeamProject] = @project "
            f"AND ({area_conditions}) "
            f"AND [System.WorkItemType] IN ({types_clause})"
        )
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
    async def get_work_items_batch(
        self,
        project: str,
        ids: list[int],
        *,
        expand: str = "Relations",
    ) -> list[dict]:
        """Fetch multiple work items by ID (max 200 per request)."""
        if not ids:
            return []
        result: list[dict] = []
        chunk = 200
        for i in range(0, len(ids), chunk):
            batch = ids[i : i + chunk]
            url = f"{self._base}/{project}/_apis/wit/workitemsbatch"
            r = await self._client.post(
                url,
                params={"api-version": "7.1"},
                json={"ids": batch, "$expand": expand},
                auth=self._auth,
                headers=self._headers(),
            )
            r.raise_for_status()
            data = r.json()
            result.extend(data.get("value") or [])
        logger.info("Batch fetched %d work items for project=%s", len(result), project)
        return result
