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


class KPIConfig(BaseModel):
    rework_rate: ReworkRateConfig
    delivery_predictability: DeliveryPredictabilityConfig


class KPIsRoot(BaseModel):
    kpis: KPIConfig


def _config_path() -> Path:
    return Path(__file__).parent / "kpis.yaml"


@lru_cache(maxsize=1)
def load_kpi_config(path: str | None = None) -> KPIConfig:
    """Load and validate kpis.yaml. Cached after first call."""
    p = Path(path) if path else _config_path()
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    root = KPIsRoot.model_validate(raw)
    return root.kpis
