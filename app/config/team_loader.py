from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field, field_validator


class StateMapping(BaseModel):
    canonical_status: str
    real_states: list[str] = Field(default_factory=list)


class DefinitionEnvironmentId(BaseModel):
    definition_id: int
    environment_id: int


class DeployFrequencyTeamConfig(BaseModel):
    """Deploy frequency config. Use either definition_environment_ids (integer stage IDs),
    definition_ids + environment_name (Build API for YAML pipelines), or environment_guid (Environments API).
    """
    definition_environment_ids: list[DefinitionEnvironmentId] = Field(default_factory=list)
    # Environments API: environment GUID (Pipelines → Environments).
    environment_guid: str | None = Field(default=None, description="Environment GUID for Environments API")
    environment_project: str | None = Field(
        default=None,
        description="Project where the environment lives (for Environments API). If unset, uses team project.",
    )
    environment_name: str | None = Field(
        default=None,
        description="Stage name to filter (e.g. 'Coreflex PROD') when using definition_ids without definitionEnvironmentId",
    )
    definition_ids: list[int] = Field(
        default_factory=list,
        description="Pipeline/definition IDs; used with environment_guid or environment_name",
    )


class TeamConfig(BaseModel):
    project: str
    area_paths: list[str] = Field(default_factory=list)

    @field_validator("area_paths", mode="before")
    @classmethod
    def coerce_area_paths(cls, v: list[str] | None) -> list[str]:
        if v is None:
            return []
        return v
    deliverable_types: list[str] = Field(default_factory=list)
    container_types: list[str] = Field(default_factory=list)
    bug_types: list[str] = Field(default_factory=list)
    states: list[StateMapping] = Field(default_factory=list)
    board_name: str = "Stories"
    azure_team: str | None = None

    def normalize(self) -> "TeamConfig":
        def norm(s: str) -> str:
            return s.strip() if s else ""

        def norm_list(items: list[str]) -> list[str]:
            return [norm(x) for x in items if norm(x)]

        return TeamConfig(
            project=norm(self.project),
            area_paths=norm_list(self.area_paths),
            deliverable_types=norm_list(self.deliverable_types),
            container_types=norm_list(self.container_types),
            bug_types=norm_list(self.bug_types),
            states=[
                StateMapping(
                    canonical_status=norm(s.canonical_status),
                    real_states=norm_list(s.real_states),
                )
                for s in self.states
            ],
            board_name=norm(self.board_name) or "Stories",
            azure_team=norm(self.azure_team) if self.azure_team else None,
        )

    def real_state_to_canonical(self) -> dict[str, str]:
        """Build reverse map: real_state -> canonical_status."""
        out: dict[str, str] = {}
        for mapping in self.states:
            for real in mapping.real_states:
                if real:
                    out[real.strip()] = mapping.canonical_status.strip()
        return out


class TeamsConfig(BaseModel):
    teams: dict[str, TeamConfig] = Field(default_factory=dict)


def _config_path() -> Path:
    return Path(__file__).parent / "teams.yaml"


@lru_cache(maxsize=1)
def load_teams_config(path: str | None = None) -> dict[str, TeamConfig]:
    """Load and validate teams.yaml; return dict team_id -> normalized TeamConfig.

    Cached after first call. Pass a string path (not Path) for testability with lru_cache.
    """
    p = Path(path) if path else _config_path()
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    config = TeamsConfig.model_validate({"teams": raw.get("teams", raw)})
    return {tid: t.normalize() for tid, t in config.teams.items()}


def get_team_config(
    team_id: str, teams: dict[str, TeamConfig] | None = None
) -> TeamConfig | None:
    """Get config for a team; optionally pass preloaded teams dict."""
    if teams is None:
        teams = load_teams_config()
    return teams.get(team_id.strip())
