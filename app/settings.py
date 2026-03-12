from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Environment
    environment: str = "development"  # "development" | "production"

    azure_devops_org: str = ""
    azure_devops_pat: SecretStr = SecretStr("")
    azure_devops_project: str | None = None  # optional per-request override

    # Performance tuning
    revision_concurrency: int = Field(20, gt=0, le=100, description="Max parallel revision fetches")
    http_timeout: float = Field(60.0, gt=0, le=600, description="Seconds per HTTP request")
    http_pool_size: int = Field(20, gt=0, le=100, description="Connection pool size")

    # Retry config
    retry_max_attempts: int = Field(3, gt=0, le=10)
    retry_wait_seconds: float = Field(1.0, gt=0, le=60)

    # Cache limits
    report_cache_max: int = Field(256, gt=0, le=10000)
    wi_cache_max: int = Field(4096, gt=0, le=50000)
    cache_ttl_seconds: int = Field(600, ge=0, description="10 min for L1 report cache")
    wi_cache_ttl_seconds: int = Field(1800, ge=0, description="30 min for L2 work item cache")
    azure_cache_max: int = Field(2048, gt=0, le=50000, description="Azure API response cache")
    azure_cache_ttl_seconds: int = Field(300, ge=0, description="5 min default for Azure responses")
    deployment_cache_max: int = Field(512, gt=0, le=10000, description="DORA deployment cache")
    deployment_cache_ttl_seconds: int = Field(3600, ge=0, description="1 hour for historical deployment data")

    # Request timeout (overall report generation)
    report_timeout: float = Field(300.0, gt=0, le=900, description="Seconds")

    # Validation
    max_date_range_days: int = Field(365, gt=0, le=730)

    # Logging
    log_level: str = "INFO"

    # Security
    api_key: SecretStr = SecretStr("")

    # CORS
    cors_origins: list[str] = []

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in ("production", "prod")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
