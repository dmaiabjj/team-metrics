"""FastAPI application entry point with lifespan-managed async HTTP client."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from app.adapters.azure_devops import AzureDevOpsClient
from app.api.cache import router as cache_router
from app.api.dashboard import router as dashboard_router
from app.api.dora import router as dora_router
from app.api.teams import router as teams_router
from app.cache import AzureResponseCache, DeploymentCache, ReportCache, WorkItemCache
from app.exceptions import (
    AzureDevOpsUnavailableError,
    InvalidDateRangeError,
    KPINotEnabledError,
    ReportTimeoutError,
    TeamMetricsError,
    TeamNotFoundError,
)
from app.rate_limit import limiter
from app.config.kpi_loader import load_kpi_config
from app.config.team_loader import load_teams_config
from app.schemas.report import ErrorResponse
from app.settings import get_settings

logger = logging.getLogger(__name__)


def _configure_logging() -> None:
    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        force=True,
    )


_configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: create shared HTTP client + Azure DevOps client.  Shutdown: close them."""
    settings = get_settings()

    # Eagerly load & validate configs at startup
    teams = load_teams_config()
    logger.info("Loaded %d team configurations: %s", len(teams), list(teams.keys()))

    kpi_cfg = load_kpi_config()
    logger.info("KPI config loaded (rework_rate enabled=%s)", kpi_cfg.rework_rate.enabled)

    # Shared HTTP client with connection pooling
    http_client: httpx.AsyncClient | None = None
    azure_client: AzureDevOpsClient | None = None

    azure_cache = AzureResponseCache(
        maxsize=settings.azure_cache_max,
        ttl_seconds=settings.azure_cache_ttl_seconds,
    )
    app.state.azure_cache = azure_cache

    if settings.azure_devops_org and settings.azure_devops_pat.get_secret_value():
        http_client = httpx.AsyncClient(
            timeout=settings.http_timeout,
            limits=httpx.Limits(
                max_connections=settings.http_pool_size,
                max_keepalive_connections=settings.http_pool_size,
            ),
        )
        azure_client = AzureDevOpsClient(
            org=settings.azure_devops_org,
            pat=settings.azure_devops_pat.get_secret_value(),
            http_client=http_client,
            azure_cache=azure_cache,
        )
        logger.info("Azure DevOps client ready for org=%s", azure_client.org)
    else:
        logger.warning("Azure DevOps credentials not configured — API will return 503")

    app.state.azure_client = azure_client
    app.state.report_cache = ReportCache(maxsize=settings.report_cache_max, ttl_seconds=settings.cache_ttl_seconds)
    app.state.wi_cache = WorkItemCache(maxsize=settings.wi_cache_max, ttl_seconds=settings.wi_cache_ttl_seconds)
    app.state.deployment_cache = DeploymentCache(
        maxsize=settings.deployment_cache_max,
        ttl_seconds=settings.deployment_cache_ttl_seconds,
    )
    logger.info(
        "In-memory caches initialised (L1 max=%d, L2 max=%d, Azure max=%d, deployment max=%d)",
        settings.report_cache_max,
        settings.wi_cache_max,
        settings.azure_cache_max,
        settings.deployment_cache_max,
    )

    yield

    # Shutdown
    if http_client and not http_client.is_closed:
        await http_client.aclose()
        logger.info("HTTP client closed")


app = FastAPI(
    title="Azure DevOps Performance Report API",
    version="0.3.0",
    lifespan=lifespan,
)
app.state.limiter = limiter

# CORS middleware
_settings = get_settings()
_cors_origins = _settings.cors_origins
if not _cors_origins:
    if _settings.is_production:
        logger.warning(
            "CORS_ORIGINS not configured in production — defaulting to no origins allowed. "
            "Set CORS_ORIGINS env var to allow frontend access."
        )
        _cors_origins = []
    else:
        _cors_origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "DELETE"],
    allow_headers=["X-API-Key"],
)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    body = ErrorResponse(detail="Rate limit exceeded — slow down", error_code="RATE_LIMITED")
    return JSONResponse(status_code=429, content=body.model_dump())


app.include_router(dashboard_router, prefix="/dashboard", tags=["dashboard"])
app.include_router(teams_router, prefix="/teams", tags=["teams"])
app.include_router(dora_router, prefix="/teams", tags=["dora"])
app.include_router(cache_router, prefix="/cache", tags=["cache"])


# ---------------------------------------------------------------------------
# Domain exception handlers
# ---------------------------------------------------------------------------


@app.exception_handler(TeamNotFoundError)
async def team_not_found_handler(request: Request, exc: TeamNotFoundError):
    body = ErrorResponse(detail=str(exc), error_code=exc.error_code)
    return JSONResponse(status_code=404, content=body.model_dump())


@app.exception_handler(AzureDevOpsUnavailableError)
async def azure_unavailable_handler(request: Request, exc: AzureDevOpsUnavailableError):
    body = ErrorResponse(detail=str(exc), error_code=exc.error_code)
    return JSONResponse(status_code=503, content=body.model_dump())


@app.exception_handler(ReportTimeoutError)
async def report_timeout_handler(request: Request, exc: ReportTimeoutError):
    body = ErrorResponse(detail=str(exc), error_code=exc.error_code)
    return JSONResponse(status_code=504, content=body.model_dump())


@app.exception_handler(InvalidDateRangeError)
async def invalid_date_range_handler(request: Request, exc: InvalidDateRangeError):
    body = ErrorResponse(detail=str(exc), error_code=exc.error_code)
    return JSONResponse(status_code=400, content=body.model_dump())


@app.exception_handler(KPINotEnabledError)
async def kpi_not_enabled_handler(request: Request, exc: KPINotEnabledError):
    body = ErrorResponse(detail=str(exc), error_code=exc.error_code)
    return JSONResponse(status_code=404, content=body.model_dump())


@app.exception_handler(TeamMetricsError)
async def domain_error_handler(request: Request, exc: TeamMetricsError):
    """Catch-all for domain errors not handled by more specific handlers."""
    body = ErrorResponse(detail=str(exc), error_code=exc.error_code)
    return JSONResponse(status_code=400, content=body.model_dump())


# ---------------------------------------------------------------------------
# External error handlers
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
        body = ErrorResponse(
            detail="Azure DevOps authentication failed — check PAT",
            error_code="AZURE_AUTH_FAILED",
        )
        return JSONResponse(status_code=502, content=body.model_dump())
    if status == 429:
        body = ErrorResponse(
            detail="Azure DevOps rate limit exceeded — try again later",
            error_code="AZURE_RATE_LIMITED",
        )
        return JSONResponse(status_code=429, content=body.model_dump())
    body = ErrorResponse(
        detail=f"Azure DevOps returned HTTP {status}",
        error_code="AZURE_UPSTREAM_ERROR",
    )
    return JSONResponse(status_code=502, content=body.model_dump())


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
                await client.health_check()
                result["azure"] = "connected"
            except Exception as e:
                result["azure"] = f"error: {e}"
    return result
