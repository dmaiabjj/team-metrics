from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    azure_devops_org: str = ""
    azure_devops_pat: str = ""
    azure_devops_project: str | None = None  # optional per-request override

    # Performance tuning
    revision_concurrency: int = 20  # max parallel revision fetches
    http_timeout: float = 60.0  # seconds per HTTP request
    http_pool_size: int = 20  # connection pool size

    # Retry config
    retry_max_attempts: int = 3
    retry_wait_seconds: float = 1.0  # initial backoff

    # Validation
    max_date_range_days: int = 365


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
