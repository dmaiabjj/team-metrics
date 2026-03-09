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
        description="True if the item has a linked bug or was returned to active after reaching QA/Delivered.",
    )
    rework_reasons: list[str] = Field(
        default_factory=list,
        description="Reasons rework was flagged: 'linked_bug', 'returned_to_active'.",
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
