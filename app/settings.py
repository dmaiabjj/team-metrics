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

    # Cache limits
    report_cache_max: int = 256
    wi_cache_max: int = 4096
    cache_ttl_seconds: int = 0  # 0 = no TTL (infinite); set e.g. 3600 for 1 hour
    azure_cache_max: int = 2048  # Azure API response cache
    azure_cache_ttl_seconds: int = 300  # 5 min default for Azure responses
    deployment_cache_max: int = 512  # DORA deployment cache
    deployment_cache_ttl_seconds: int = 3600  # 1 hour for historical deployment data

    # Request timeout (overall report generation)
    report_timeout: float = 300.0  # seconds

    # Validation
    max_date_range_days: int = 365

    # Logging
    log_level: str = "INFO"

    # Security
    api_key: str = ""


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
