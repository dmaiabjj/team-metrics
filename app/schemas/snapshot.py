"""Delivery Snapshot response schemas."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from app.schemas.report import DeliverableRow


class DeliverySnapshot(BaseModel):
    delivered: int = Field(description="Items with canonical_status == Delivered")
    committed: int = Field(description="Spillovers + items started in the period")
    committed_in_period: int = Field(description="Items that entered active status within the period (not spillovers)")
    spillovers: int = Field(description="Items carried from a previous period")
    rework_items: int = Field(description="Items that reached QA with rework tags")
    tech_debts: int = Field(description="Items flagged as technical debt")
    bugs: int = Field(description="Items with at least one child bug")


class SnapshotDrilldownResponse(BaseModel):
    team_id: str
    start_date: date
    end_date: date
    metric: str
    total: int = Field(description="Total matching items before pagination")
    items: list[DeliverableRow] = Field(default_factory=list)
