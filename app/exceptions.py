"""Domain exception hierarchy for Team Metrics.

Services raise domain exceptions. Routers and global exception handlers
translate them into HTTP responses. This keeps business logic decoupled
from HTTP status codes.
"""

from __future__ import annotations


class TeamMetricsError(Exception):
    """Base exception for all domain errors."""

    def __init__(self, message: str, *, error_code: str = "INTERNAL_ERROR") -> None:
        super().__init__(message)
        self.error_code = error_code


class TeamNotFoundError(TeamMetricsError):
    """Raised when a team_id does not match any configured team."""

    def __init__(self, team_id: str, known_teams: list[str] | None = None) -> None:
        detail = f"Unknown team_id: {team_id}"
        if known_teams:
            detail += f". Known: {known_teams}"
        super().__init__(detail, error_code="TEAM_NOT_FOUND")
        self.team_id = team_id


class AzureDevOpsUnavailableError(TeamMetricsError):
    """Raised when Azure DevOps client is not configured."""

    def __init__(self) -> None:
        super().__init__(
            "Azure DevOps not configured: set AZURE_DEVOPS_ORG and AZURE_DEVOPS_PAT",
            error_code="AZURE_NOT_CONFIGURED",
        )


class ReportTimeoutError(TeamMetricsError):
    """Raised when report generation exceeds the allowed timeout."""

    def __init__(self, timeout_seconds: float) -> None:
        super().__init__(
            f"Report generation timed out after {timeout_seconds}s",
            error_code="REPORT_TIMEOUT",
        )
        self.timeout_seconds = timeout_seconds


class InvalidDateRangeError(TeamMetricsError):
    """Raised when the requested date range is invalid."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail, error_code="INVALID_DATE_RANGE")


class KPINotEnabledError(TeamMetricsError):
    """Raised when a requested KPI/metric is not enabled in config."""

    def __init__(self, kpi_name: str) -> None:
        super().__init__(
            f"{kpi_name} is not enabled in configuration",
            error_code="KPI_NOT_ENABLED",
        )
        self.kpi_name = kpi_name
