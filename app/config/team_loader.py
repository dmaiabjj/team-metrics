from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field


class StateMapping(BaseModel):
    canonical_status: str
    real_states: list[str] = Field(default_factory=list)


class TeamConfig(BaseModel):
    project: str
    area_paths: list[str] = Field(default_factory=list)
    deliverable_types: list[str] = Field(default_factory=list)
    container_types: list[str] = Field(default_factory=list)
    bug_types: list[str] = Field(default_factory=list)
    states: list[StateMapping] = Field(default_factory=list)
    tech_debt_epic_ids: list[int] = Field(default_factory=list)
    post_mortem_epic_ids: list[int] = Field(default_factory=list)
    post_mortem_sla_weeks: int | None = None

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
            tech_debt_epic_ids=self.tech_debt_epic_ids,
            post_mortem_epic_ids=self.post_mortem_epic_ids,
            post_mortem_sla_weeks=self.post_mortem_sla_weeks,
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
