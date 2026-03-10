"""Shared test fixtures."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.cache import AzureResponseCache, DeploymentCache, ReportCache, WorkItemCache
from app.main import app


@pytest.fixture()
def client() -> TestClient:
    """TestClient with cache singletons pre-initialised on app.state."""
    app.state.azure_client = None
    app.state.report_cache = ReportCache(maxsize=64)
    app.state.wi_cache = WorkItemCache(maxsize=128)
    app.state.azure_cache = AzureResponseCache(maxsize=256)
    app.state.deployment_cache = DeploymentCache(maxsize=128)
    return TestClient(app, raise_server_exceptions=False)
