"""FastAPI application entry point with lifespan-managed async HTTP client."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.adapters.azure_devops import AzureDevOpsClient
from app.api.cache import router as cache_router
from app.api.report import router as report_router
from app.cache import ReportCache, WorkItemCache
from app.config.loader import load_teams_config
from app.settings import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: create shared HTTP client + Azure DevOps client.  Shutdown: close them."""
    settings = get_settings()

    # Eagerly load & validate team config at startup
    teams = load_teams_config()
    logger.info("Loaded %d team configurations: %s", len(teams), list(teams.keys()))

    # Shared HTTP client with connection pooling
    http_client: httpx.AsyncClient | None = None
    azure_client: AzureDevOpsClient | None = None

    if settings.azure_devops_org and settings.azure_devops_pat:
        http_client = httpx.AsyncClient(
            timeout=settings.http_timeout,
            limits=httpx.Limits(
                max_connections=settings.http_pool_size,
                max_keepalive_connections=settings.http_pool_size,
            ),
        )
        azure_client = AzureDevOpsClient(
            org=settings.azure_devops_org,
            pat=settings.azure_devops_pat,
            http_client=http_client,
        )
        logger.info("Azure DevOps client ready for org=%s", azure_client.org)
    else:
        logger.warning("Azure DevOps credentials not configured — API will return 503")

    app.state.azure_client = azure_client
    app.state.report_cache = ReportCache()
    app.state.wi_cache = WorkItemCache()
    logger.info("In-memory caches initialised (L1 report + L2 work-item)")

    yield

    # Shutdown
    if http_client and not http_client.is_closed:
        await http_client.aclose()
        logger.info("HTTP client closed")


app = FastAPI(
    title="Azure DevOps Performance Report API",
    version="0.2.0",
    lifespan=lifespan,
)
app.include_router(report_router, prefix="/report", tags=["report"])
app.include_router(cache_router, prefix="/cache", tags=["cache"])


# ---------------------------------------------------------------------------
# Global exception handler for unexpected errors
# ---------------------------------------------------------------------------

@app.exception_handler(httpx.HTTPStatusError)
async def azure_http_error_handler(request: Request, exc: httpx.HTTPStatusError):
    """Translate upstream Azure DevOps errors into clean API responses."""
    status = exc.response.status_code
    logger.error(
        "Azure DevOps returned %d for %s: %s",
        status,
        exc.request.url,
        exc.response.text[:200],
    )
    if status == 401:
        return JSONResponse(
            status_code=502,
            content={"detail": "Azure DevOps authentication failed — check PAT"},
        )
    if status == 429:
        return JSONResponse(
            status_code=429,
            content={"detail": "Azure DevOps rate limit exceeded — try again later"},
        )
    return JSONResponse(
        status_code=502,
        content={"detail": f"Azure DevOps returned HTTP {status}"},
    )


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health(deep: bool = False):
    """Basic health check. Pass ?deep=true to verify Azure DevOps connectivity."""
    result: dict = {"status": "ok"}
    if deep:
        client = getattr(app.state, "azure_client", None)
        if client is None:
            result["azure"] = "not_configured"
        else:
            try:
                # Lightweight probe: list projects (1 result)
                r = await client._client.get(
                    f"{client._base}/_apis/projects",
                    params={"api-version": "7.1", "$top": "1"},
                    auth=client._auth,
                    headers=client._headers(),
                )
                r.raise_for_status()
                result["azure"] = "connected"
            except Exception as e:
                result["azure"] = f"error: {e}"
    return result
