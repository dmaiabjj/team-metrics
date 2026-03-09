from datetime import date, datetime

from pydantic import BaseModel, Field


class ReportRequest(BaseModel):
    team_id: str
    start_date: date
    end_date: date


class StatusTimelineEntry(BaseModel):
    date: datetime
    state: str
    canonical_status: str | None = None
    assigned_to: str | None = None


class BounceDetail(BaseModel):
    from_revision: int
    to_revision: int
    from_state: str
    to_state: str
    date: datetime


class DeliverableRow(BaseModel):
    id: int
    work_item_type: str
    title: str
    description: str | None = None
    state: str
    canonical_status: str | None = None
    status_at_start: str | None = None
    status_at_end: str | None = None
    status_timeline: list[StatusTimelineEntry] = Field(default_factory=list)
    parent_epic_title: str | None = None
    parent_feature_title: str | None = None
    child_bug_ids: list[int] = Field(default_factory=list)
    child_task_ids: list[int] = Field(default_factory=list)
    developer: str | None = None
    qa: str | None = None
    release_manager: str | None = None
    has_rework: bool = Field(
        default=False,
        description="True if the item has tag 'Code Defect' or 'Scope / Requirements'.",
    )
    is_spillover: bool = Field(
        default=False,
        description="True if the item was in Development Active or QA Active at the start of the period.",
    )
    bounces: int = Field(
        default=0,
        description="Number of times the item went back from QA/Delivered to active.",
    )
    bounce_details: list[BounceDetail] = Field(
        default_factory=list,
        description="Details of each bounce: which revisions, states, and when.",
    )
    tags: list[str] = Field(
        default_factory=list,
        description="Tags: 'Code Defect' (linked bugs), 'Scope / Requirements' (returned to active after QA/Delivered), 'Spillover' (in dev or QA before period).",
    )


class ReportResponse(BaseModel):
    team_id: str
    start_date: date
    end_date: date
    deliverables: list[DeliverableRow] = Field(default_factory=list)


class TeamReportResponse(BaseModel):
    team_id: str
    deliverables: list[DeliverableRow] = Field(default_factory=list)


class MultiTeamReportResponse(BaseModel):
    teams: list[TeamReportResponse] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    """Standard error response for consistent API error formatting."""

    detail: str
    error_code: str | None = None
