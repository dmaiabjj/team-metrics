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


def _kpi_discriminator(v: dict | BaseModel) -> str:
    name = v.get("name") if isinstance(v, dict) else getattr(v, "name", None)
    if name == "delivery_predictability":
        return "delivery_predictability"
    return "rework_rate"


KPIResult = Annotated[
    Union[
        Annotated[ReworkRateKPI, Tag("rework_rate")],
        Annotated[DeliveryPredictabilityKPI, Tag("delivery_predictability")],
    ],
    Discriminator(_kpi_discriminator),
]


class KPIResponse(BaseModel):
    team_id: str
    start_date: date
    end_date: date
    kpis: list[KPIResult] = Field(default_factory=list)


class TeamKPIEntry(BaseModel):
    team_id: str
    kpis: list[KPIResult] = Field(default_factory=list)


class AverageKPI(BaseModel):
    name: str
    value: float = Field(description="Averaged value across teams")
    display: str
    rag: RAGStatus
    team_count: int


class TeamError(BaseModel):
    team_id: str
    error: str


class KPISummaryResponse(BaseModel):
    start_date: date
    end_date: date
    averages: list[AverageKPI] = Field(default_factory=list)
    teams: list[TeamKPIEntry] = Field(default_factory=list)
    errors: list[TeamError] = Field(default_factory=list, description="Teams that failed")


class DrilldownResponse(BaseModel):
    team_id: str
    start_date: date
    end_date: date
    metric: str
    total: int = Field(description="Total matching items before pagination")
    items: list[DeliverableRow] = Field(default_factory=list)
