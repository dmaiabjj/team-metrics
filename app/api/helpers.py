"""Shared API helpers -- validation, Azure client dependency, report fetching."""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone

from fastapi import HTTPException, Request

from app.adapters.azure_devops import AzureDevOpsClient
from app.cache import DeploymentCache
from app.config.kpi_loader import FlowHygieneConfig
from app.config.team_loader import DeployFrequencyTeamConfig, TeamConfig, load_teams_config
from app.exceptions import (
    AzureDevOpsUnavailableError,
    InvalidDateRangeError,
    ReportTimeoutError,
    TeamNotFoundError,
)
from app.services.report_service import run_report
from app.settings import get_settings

logger = logging.getLogger(__name__)


def validate_date_range(start_date: date, end_date: date) -> None:
    if start_date > end_date:
        raise InvalidDateRangeError("start_date must be <= end_date")
    settings = get_settings()
    delta = (end_date - start_date).days
    if delta > settings.max_date_range_days:
        raise InvalidDateRangeError(
            f"Date range exceeds maximum of {settings.max_date_range_days} days"
        )


def validate_team_id(team_id: str) -> None:
    """Validate that team_id is a known team. Raises TeamNotFoundError if not."""
    teams = load_teams_config()
    if team_id not in teams:
        raise TeamNotFoundError(team_id, known_teams=list(teams.keys()))


def get_azure_client(request: Request) -> AzureDevOpsClient:
    """FastAPI dependency -- returns the shared AzureDevOpsClient from app state."""
    client = getattr(request.app.state, "azure_client", None)
    if client is None:
        raise AzureDevOpsUnavailableError()
    return client


async def get_team_report(request: Request, team_id: str, start_date: date, end_date: date):
    """Validate inputs, fetch one team report, return (report, deliverables)."""
    validate_date_range(start_date, end_date)
    validate_team_id(team_id)
    client = get_azure_client(request)
    teams = load_teams_config()
    report_cache = getattr(request.app.state, "report_cache", None)
    wi_cache = getattr(request.app.state, "wi_cache", None)
    settings = get_settings()
    try:
        report = await asyncio.wait_for(
            run_report(
                team_id, start_date, end_date, client, teams,
                report_cache=report_cache, wi_cache=wi_cache,
            ),
            timeout=settings.report_timeout,
        )
    except asyncio.TimeoutError:
        raise ReportTimeoutError(settings.report_timeout) from None
    return report


async def fetch_deploy_frequency_deployments(
    azure_client: AzureDevOpsClient,
    df_config: DeployFrequencyTeamConfig,
    project: str,
    start_date: date,
    end_date: date,
    *,
    team_id: str | None = None,
    deployment_cache: DeploymentCache | None = None,
) -> tuple[list[dict], str]:
    """Fetch deployments for deploy frequency based on config.

    Returns (deployments, format). format is "release" | "environment" | "build".
    Use deployments_to_summaries, environment_records_to_summaries, or
    build_deployments_to_summaries accordingly.

    If team_id and deployment_cache are provided, checks deployment cache first.
    """
    if team_id and deployment_cache is not None:
        cached = deployment_cache.get(team_id, start_date, end_date)
        if cached is not None:
            return cached

    def _store(deployments: list[dict], fmt: str) -> None:
        if team_id and deployment_cache is not None:
            deployment_cache.put(team_id, start_date, end_date, deployments, fmt)

    min_t = datetime(start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc)
    max_t = datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59, tzinfo=timezone.utc)

    if df_config.definition_environment_ids:
        ids = [(d.definition_id, d.environment_id) for d in df_config.definition_environment_ids]
        deployments = await azure_client.get_release_deployments(
            project, min_t, max_t, definition_environment_ids=ids,
        )
        _store(deployments, "release")
        return deployments, "release"

    if df_config.definition_ids and df_config.environment_name:
        # Try Build API first (YAML pipelines with stage name).
        deployments = await azure_client.get_build_deployments_by_stage(
            project, min_t, max_t,
            df_config.definition_ids,
            stage_name=df_config.environment_name,
        )
        if deployments:
            _store(deployments, "build")
            return deployments, "build"

        # Fallback to Release API (classic pipelines).
        deployments = await azure_client.get_release_deployments_by_definition_and_env_name(
            project, min_t, max_t,
            df_config.definition_ids,
            df_config.environment_name,
        )
        if deployments:
            _store(deployments, "release")
            return deployments, "release"

        # Final fallback to Environments API if environment_guid is configured.
        if df_config.environment_guid:
            env_project = df_config.environment_project or project
            records = await azure_client.get_environment_deployment_records(
                env_project, df_config.environment_guid, min_t, max_t,
            )
            _store(records, "environment")
            return records, "environment"

        _store([], "build")
        return [], "build"

    if df_config.definition_ids and df_config.environment_guid:
        env_project = df_config.environment_project or project
        records = await azure_client.get_environment_deployment_records(
            env_project, df_config.environment_guid, min_t, max_t,
        )
        _store(records, "environment")
        return records, "environment"

    _store([], "release")
    return [], "release"


async def resolve_wip_limits(
    azure_client: AzureDevOpsClient | None,
    team_config: TeamConfig,
    fh_config: FlowHygieneConfig,
    wip_limits_override: dict[str, int] | None = None,
) -> dict[str, tuple[int, str]]:
    """Resolve WIP limits per state with 3-tier fallback.

    Priority: Azure DevOps board > kpis.yaml teams (wip_limits_override) > kpis.yaml default.
    Returns {state: (limit, source)}.
    """
    azure_limits: dict[str, int] = {}
    if azure_client is not None:
        try:
            azure_limits = await azure_client.get_board_wip_limits(
                team_config.project, team_config.board_name,
                team=team_config.azure_team,
            )
        except Exception:
            logger.warning("Failed to fetch board WIP limits, falling back to config", exc_info=True)

    azure_lower = {k.lower(): v for k, v in azure_limits.items()}
    team_wip = wip_limits_override or {}
    team_lower = {k.lower(): v for k, v in team_wip.items()}

    result: dict[str, tuple[int, str]] = {}
    for state in fh_config.queue_states:
        key = state.lower()
        az_val = azure_lower.get(key, 0)
        if az_val > 0:
            result[state] = (az_val, "azure_devops")
        elif team_lower.get(key, 0) > 0:
            result[state] = (team_lower[key], "kpis_teams")
        else:
            result[state] = (fh_config.default_wip_limits.get(state, 1), "global_default")
    return result


async def fetch_all_reports(request: Request, start_date: date, end_date: date):
    """Validate dates, fetch reports for all teams. Returns (team_ids, results)."""
    validate_date_range(start_date, end_date)
    teams = load_teams_config()
    client = get_azure_client(request)
    report_cache = getattr(request.app.state, "report_cache", None)
    wi_cache = getattr(request.app.state, "wi_cache", None)
    settings = get_settings()

    team_ids = list(teams.keys())
    try:
        results = await asyncio.wait_for(
            asyncio.gather(
                *[
                    run_report(
                        tid, start_date, end_date, client, teams,
                        report_cache=report_cache, wi_cache=wi_cache,
                    )
                    for tid in team_ids
                ],
                return_exceptions=True,
            ),
            timeout=settings.report_timeout,
        )
    except asyncio.TimeoutError:
        raise ReportTimeoutError(settings.report_timeout) from None
    return team_ids, results


def get_report_cache(request: Request) -> "ReportCache | None":
    """Typed accessor for report cache from app state."""
    from app.cache import ReportCache
    cache = getattr(request.app.state, "report_cache", None)
    return cache if isinstance(cache, ReportCache) else None


def get_wi_cache(request: Request) -> "WorkItemCache | None":
    """Typed accessor for work item cache from app state."""
    from app.cache import WorkItemCache
    cache = getattr(request.app.state, "wi_cache", None)
    return cache if isinstance(cache, WorkItemCache) else None


def get_deployment_cache(request: Request) -> "DeploymentCache | None":
    """Typed accessor for deployment cache from app state."""
    cache = getattr(request.app.state, "deployment_cache", None)
    return cache if isinstance(cache, DeploymentCache) else None
