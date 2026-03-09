"""KPI response schemas."""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Annotated, Union

from pydantic import BaseModel, Discriminator, Field, Tag

from app.schemas.report import DeliverableRow


class RAGStatus(str, Enum):
    GREEN = "green"
    AMBER = "amber"
    RED = "red"


class ReworkRateKPI(BaseModel):
    name: str = "rework_rate"
    value: float = Field(description="Rework rate as a decimal (e.g. 0.10 for 10%)")
    display: str = Field(description="Human-readable percentage (e.g. '10.0%')")
    rag: RAGStatus
    items_with_rework: int
    items_reached_qa: int
    items_bounced_back: int
    total_bugs: int
    thresholds: dict[str, str] = Field(
        default_factory=lambda: {
            "green": "<= 10%",
            "amber": "10-15%",
            "red": "> 15%",
        }
    )


class DeliveryPredictabilityKPI(BaseModel):
    name: str = "delivery_predictability"
    value: float = Field(description="Predictability as a decimal (e.g. 0.90 for 90%)")
    display: str = Field(description="Human-readable percentage (e.g. '90.0%')")
    rag: RAGStatus
    items_committed: int
    items_deployed: int
    items_started_in_period: int
    items_spillover: int
    thresholds: dict[str, str] = Field(
        default_factory=lambda: {
            "green": ">= 85%",
            "amber": "70-85%",
            "red": "< 70%",
        }
    )


class StateQueueMetric(BaseModel):
    state: str
    avg_items: float = Field(description="Average daily count of items in this state")
    peak_items: int = Field(description="Maximum daily count observed")
    wip_limit: int = Field(description="WIP limit applied to this state")
    wip_limit_source: str = Field(description="Where the limit came from: azure_devops | team_config | global_default")
    queue_load: float = Field(description="avg_items / wip_limit")
    days_over_limit: int = Field(description="Number of days where count exceeded wip_limit")


class FlowHygieneKPI(BaseModel):
    name: str = "flow_hygiene"
    value: float = Field(description="Worst queue_load across all monitored states")
    display: str = Field(description="Human-readable ratio (e.g. '1.33')")
    rag: RAGStatus
    total_days: int
    states: list[StateQueueMetric] | None = Field(default_factory=list)
    thresholds: dict[str, str] = Field(
        default_factory=lambda: {
            "green": "<= 1.0",
            "amber": "1.0-1.2",
            "red": "> 1.2",
        }
    )


class PersonStatusBreakdown(BaseModel):
    state: str
    avg_items: float = Field(description="Average daily items in this real state")
    peak_items: int = Field(description="Maximum daily items observed")


class PersonWorkItem(BaseModel):
    id: int
    title: str
    state: str


class PersonWIPMetric(BaseModel):
    person: str
    role: str = Field(description="developer or qa")
    avg_wip: float = Field(description="Average daily WIP across the period")
    peak_wip: int = Field(description="Maximum daily WIP observed")
    days_compliant: int
    days_over_limit: int
    total_days: int
    compliance_pct: float = Field(description="days_compliant / total_days")
    is_compliant: bool = Field(description="True if compliance_pct >= threshold")
    status_breakdown: list[PersonStatusBreakdown] = Field(default_factory=list)
    work_items: list[PersonWorkItem] = Field(default_factory=list)


class WIPDisciplineKPI(BaseModel):
    name: str = "wip_discipline"
    value: float = Field(description="compliant_hours / total_hours across all persons and roles")
    display: str = Field(description="Human-readable percentage (e.g. '75.0%')")
    rag: RAGStatus
    total_days: int
    total_developers: int = 0
    developers_compliant: int = 0
    dev_wip_limit: int = 0
    total_qas: int = 0
    qas_compliant: int = 0
    qa_wip_limit: int = 0
    persons: list[PersonWIPMetric] | None = Field(default_factory=list)
    thresholds: dict[str, str] = Field(
        default_factory=lambda: {
            "green": ">= 80%",
            "amber": "60-80%",
            "red": "< 60%",
        }
    )


_KPI_TAG_MAP = {
    "delivery_predictability": "delivery_predictability",
    "flow_hygiene": "flow_hygiene",
    "wip_discipline": "wip_discipline",
}


def _kpi_discriminator(v: dict | BaseModel) -> str:
    name = v.get("name") if isinstance(v, dict) else getattr(v, "name", None)
    return _KPI_TAG_MAP.get(name, "rework_rate")


KPIResult = Annotated[
    Union[
        Annotated[ReworkRateKPI, Tag("rework_rate")],
        Annotated[DeliveryPredictabilityKPI, Tag("delivery_predictability")],
        Annotated[FlowHygieneKPI, Tag("flow_hygiene")],
        Annotated[WIPDisciplineKPI, Tag("wip_discipline")],
    ],
    Discriminator(_kpi_discriminator),
]


# ---------------------------------------------------------------------------
# Endpoint 2: GET /teams/{team_id}/kpis
# ---------------------------------------------------------------------------

class TeamKPIsResponse(BaseModel):
    team_id: str
    start_date: date
    end_date: date
    kpis: list[KPIResult] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Endpoint 3: GET /teams/{team_id}/kpis/{kpi_name}
# ---------------------------------------------------------------------------

class TeamKPIDetailResponse(BaseModel):
    team_id: str
    start_date: date
    end_date: date
    kpi: KPIResult
    total: int = Field(0, description="Total work items involved in this KPI")
    items: list[DeliverableRow] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Endpoint 4: GET /teams/{team_id}/kpis/{kpi_name}/drilldown/{metric}
# ---------------------------------------------------------------------------

class DrilldownResponse(BaseModel):
    team_id: str
    start_date: date
    end_date: date
    kpi_name: str
    metric: str
    total: int = Field(description="Total matching items before pagination")
    items: list[DeliverableRow] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Endpoint 1: GET /dashboard
# ---------------------------------------------------------------------------

class AverageKPI(BaseModel):
    name: str
    value: float = Field(description="Averaged value across teams")
    display: str
    rag: RAGStatus
    team_count: int


class TeamError(BaseModel):
    team_id: str
    error: str


class TeamKPIEntry(BaseModel):
    team_id: str
    kpis: list[KPIResult] = Field(default_factory=list)


class DashboardResponse(BaseModel):
    start_date: date
    end_date: date
    averages: list[AverageKPI] = Field(default_factory=list)
    teams: list[TeamKPIEntry] = Field(default_factory=list)
    errors: list[TeamError] = Field(default_factory=list, description="Teams that failed")
