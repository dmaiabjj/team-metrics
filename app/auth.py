"""API key authentication dependency.

When the API_KEY setting is non-empty, all protected endpoints require the
X-API-Key header to match. When API_KEY is empty, auth is disabled (open access).
"""

from __future__ import annotations

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

from app.settings import get_settings

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def require_api_key(
    api_key: str | None = Security(_api_key_header),
) -> str | None:
    """Dependency that enforces API key auth when configured."""
    settings = get_settings()
    if not settings.api_key:
        return None
    if not api_key or api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return api_key
