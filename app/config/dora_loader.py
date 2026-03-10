"""Loader and Pydantic models for app/config/dora.yaml."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field


class DeployFrequencyRAG(BaseModel):
    """Higher-is-better thresholds (deploys per day)."""
    green_min: float = Field(..., ge=0)
    amber_min: float = Field(..., ge=0)


class LeadTimeRAG(BaseModel):
    """Lower-is-better thresholds (days)."""
    green_max: float = Field(..., ge=0)
    amber_max: float = Field(..., ge=0)


class DeployFrequencyConfig(BaseModel):
    enabled: bool = True
    description: str = ""
    formula: str = ""
    rag: DeployFrequencyRAG


class LeadTimeConfig(BaseModel):
    enabled: bool = True
    description: str = ""
    formula: str = ""
    delivered_canonical_status: str = "Delivered"
    rag: LeadTimeRAG


class DoraConfig(BaseModel):
    deploy_frequency: DeployFrequencyConfig
    lead_time: LeadTimeConfig


class DoraRoot(BaseModel):
    dora: DoraConfig


def _config_path() -> Path:
    return Path(__file__).parent / "dora.yaml"


@lru_cache(maxsize=1)
def load_dora_config(path: str | None = None) -> DoraConfig:
    """Load and validate dora.yaml. Cached after first call."""
    p = Path(path) if path else _config_path()
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    root = DoraRoot.model_validate(raw)
    return root.dora
