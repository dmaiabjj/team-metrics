"""Loader and Pydantic models for app/config/kpis.yaml."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field


class RAGThresholds(BaseModel):
    """Lower-is-better thresholds (e.g. rework rate)."""
    green_max: float = Field(..., ge=0, le=1)
    amber_max: float = Field(..., ge=0, le=1)


class RAGThresholdsHigherIsBetter(BaseModel):
    """Higher-is-better thresholds (e.g. delivery predictability)."""
    green_min: float = Field(..., ge=0, le=1)
    amber_min: float = Field(..., ge=0, le=1)


class ReworkRateConfig(BaseModel):
    enabled: bool = True
    description: str = ""
    formula: str = ""
    rag: RAGThresholds
    rework_tags: list[str] = Field(default_factory=list)
    qa_canonical_status: str = "QA Active"


class DeliveryPredictabilityConfig(BaseModel):
    enabled: bool = True
    description: str = ""
    formula: str = ""
    rag: RAGThresholdsHigherIsBetter
    delivered_canonical_status: str = "Delivered"


class FlowHygieneRAGThresholds(BaseModel):
    """Lower-is-better thresholds for queue_load (can exceed 1.0)."""
    green_max: float = Field(..., ge=0)
    amber_max: float = Field(..., ge=0)


class FlowHygieneConfig(BaseModel):
    enabled: bool = True
    description: str = ""
    formula: str = ""
    queue_states: list[str] = Field(default_factory=list)
    default_wip_limits: dict[str, int] = Field(default_factory=dict)
    rag: FlowHygieneRAGThresholds


class WIPDisciplineConfig(BaseModel):
    enabled: bool = True
    description: str = ""
    formula: str = ""
    dev_wip_limit: int = 3
    qa_wip_limit: int = 2
    compliance_threshold: float = Field(0.80, ge=0, le=1)
    rag: RAGThresholdsHigherIsBetter


class TechDebtRatioBandRAG(BaseModel):
    """Target-band thresholds: value should fall within [green_min, green_max]."""
    amber_min: float = Field(..., ge=0, le=1)
    green_min: float = Field(..., ge=0, le=1)
    green_max: float = Field(..., ge=0, le=1)


class TechDebtRatioConfig(BaseModel):
    enabled: bool = True
    description: str = ""
    formula: str = ""
    delivered_canonical_status: str = "Delivered"
    rag: TechDebtRatioBandRAG


class InitiativeDeliveryConfig(BaseModel):
    enabled: bool = True
    description: str = ""
    formula: str = ""
    delivered_canonical_status: str = "Delivered"
    rag: RAGThresholdsHigherIsBetter = Field(
        default_factory=lambda: RAGThresholdsHigherIsBetter(green_min=0.85, amber_min=0.70)
    )


class ReliabilityActionDeliveryConfig(BaseModel):
    enabled: bool = True
    description: str = ""
    formula: str = ""
    delivered_canonical_status: str = "Delivered"
    rag: RAGThresholdsHigherIsBetter = Field(
        default_factory=lambda: RAGThresholdsHigherIsBetter(green_min=0.85, amber_min=0.70)
    )


class TeamKPIOverrides(BaseModel):
    """Per-team overrides for KPI-related config (from kpis.yaml teams section)."""
    tech_debt_epic_ids: list[int] = Field(default_factory=list)
    post_mortem_epic_ids: list[int] = Field(default_factory=list)
    post_mortem_sla_weeks: int | None = None
    wip_limits: dict[str, int] | None = Field(default=None)
    initiative_ids: list[int] = Field(default_factory=list)


class KPIConfig(BaseModel):
    rework_rate: ReworkRateConfig
    delivery_predictability: DeliveryPredictabilityConfig
    flow_hygiene: FlowHygieneConfig
    wip_discipline: WIPDisciplineConfig
    tech_debt_ratio: TechDebtRatioConfig
    initiative_delivery: InitiativeDeliveryConfig = Field(
        default_factory=lambda: InitiativeDeliveryConfig()
    )
    reliability_action_delivery: ReliabilityActionDeliveryConfig = Field(
        default_factory=lambda: ReliabilityActionDeliveryConfig()
    )


class KPIsRoot(BaseModel):
    kpis: KPIConfig


def _config_path() -> Path:
    return Path(__file__).parent / "kpis.yaml"


class KPIsRootWithTeams(BaseModel):
    """Full kpis.yaml structure including teams section."""
    model_config = {"extra": "allow"}

    rework_rate: ReworkRateConfig = Field(default_factory=ReworkRateConfig)
    delivery_predictability: DeliveryPredictabilityConfig = Field(default_factory=DeliveryPredictabilityConfig)
    flow_hygiene: FlowHygieneConfig = Field(default_factory=FlowHygieneConfig)
    wip_discipline: WIPDisciplineConfig = Field(default_factory=WIPDisciplineConfig)
    tech_debt_ratio: TechDebtRatioConfig = Field(default_factory=TechDebtRatioConfig)
    initiative_delivery: InitiativeDeliveryConfig = Field(default_factory=InitiativeDeliveryConfig)
    reliability_action_delivery: ReliabilityActionDeliveryConfig = Field(
        default_factory=ReliabilityActionDeliveryConfig
    )
    teams: dict[str, TeamKPIOverrides] = Field(default_factory=dict)


@lru_cache(maxsize=1)
def load_kpi_config(path: str | None = None) -> KPIConfig:
    """Load and validate kpis.yaml. Cached after first call."""
    p = Path(path) if path else _config_path()
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    root = KPIsRoot.model_validate(raw)
    return root.kpis


@lru_cache(maxsize=1)
def _load_kpis_with_teams(path: str | None = None) -> KPIsRootWithTeams:
    """Load full kpis.yaml including teams. Internal use for get_team_kpi_overrides."""
    p = Path(path) if path else _config_path()
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    kpis_raw = raw.get("kpis", raw)
    return KPIsRootWithTeams.model_validate(kpis_raw)


def get_team_kpi_overrides(team_id: str, path: str | None = None) -> TeamKPIOverrides:
    """Get per-team KPI overrides. Returns defaults (empty lists, None) when team has no entry."""
    root = _load_kpis_with_teams(path)
    overrides = root.teams.get(team_id.strip())
    if overrides is not None:
        return overrides
    return TeamKPIOverrides()
