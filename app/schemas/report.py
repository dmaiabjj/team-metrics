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


class WorkItemRef(BaseModel):
    id: int
    title: str | None = None
    state: str | None = None


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
    date_created: datetime | None = None
    start_date: datetime | None = None
    finish_date: datetime | None = None
    status_at_start: str | None = None
    status_at_end: str | None = None
    status_timeline: list[StatusTimelineEntry] = Field(default_factory=list)
    parent_epic: WorkItemRef | None = None
    parent_feature: WorkItemRef | None = None
    child_bugs: list[WorkItemRef] = Field(default_factory=list)
    child_tasks: list[WorkItemRef] = Field(default_factory=list)
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
    is_technical_debt: bool = Field(
        default=False,
        description="True if the work item is under a tech-debt epic (configured per team).",
    )
    is_post_mortem: bool = Field(
        default=False,
        description="True if the work item is under a post-mortem epic (configured per team).",
    )
    post_mortem_sla_met: bool | None = Field(
        default=None,
        description="True if post-mortem item was delivered within the SLA. None if not a post-mortem item.",
    )
    delivery_days: float | None = Field(
        default=None,
        description="Calendar days from creation to Delivered status. None if not yet delivered.",
    )
    tags: list[str] = Field(
        default_factory=list,
        description="Tags: 'Code Defect' (linked bugs), 'Scope / Requirements' (returned to active after QA/Delivered), 'Spillover' (in dev or QA before period).",
    )


class ReportResponse(BaseModel):
    """Internal model used by the service layer and cache."""

    team_id: str
    start_date: date
    end_date: date
    total: int = Field(0, description="Total number of deliverables before pagination.")
    deliverables: list[DeliverableRow] = Field(default_factory=list)


class WorkItemsResponse(BaseModel):
    """API response for GET /teams/{team_id}/work-items."""

    team_id: str
    start_date: date
    end_date: date
    total: int = Field(0, description="Total number of items before pagination.")
    items: list[DeliverableRow] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    """Standard error response for consistent API error formatting."""

    detail: str
    error_code: str | None = None
