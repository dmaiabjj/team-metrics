"""DORA metric response schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import RAGStatus


class DeployFrequencyKPI(BaseModel):
    name: str = "deploy_frequency"
    value: float = Field(description="Deployments per day")
    display: str = Field(description="Human-readable (e.g. '1.2 deploys/day')")
    rag: RAGStatus
    deployment_count: int
    period_days: int
    thresholds: dict[str, str] = Field(default_factory=dict)


class LeadTimeKPI(BaseModel):
    name: str = "lead_time"
    value: float = Field(description="Average lead time in days")
    display: str = Field(description="Human-readable (e.g. '5.2 days')")
    rag: RAGStatus
    lead_time_days: float = Field(description="Average lead time (start to finish)")
    cycle_time_days: float = Field(description="Average cycle time (created to finish)")
    median_lead_time_days: float
    median_cycle_time_days: float
    p90_lead_time_days: float
    p90_cycle_time_days: float
    sample_size: int
    thresholds: dict[str, str] = Field(default_factory=dict)


class DeploymentSummary(BaseModel):
    """Summary of a deployment for drilldown responses."""

    id: int
    release_id: int
    release_name: str | None = None
    definition_id: int
    definition_name: str | None = None
    environment_id: int = Field(description="Stage/environment ID (int from Release/Environments API, derived from stage GUID for Build API)")
    environment_name: str | None = None
    stage_id: str | None = Field(default=None, description="Stage GUID for Build API (from timeline record)")
    started_on: str = Field(description="ISO 8601 datetime")
    status: str = "succeeded"
