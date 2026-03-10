"""Shared schema types."""

from __future__ import annotations

from enum import Enum


class RAGStatus(str, Enum):
    GREEN = "green"
    AMBER = "amber"
    RED = "red"
