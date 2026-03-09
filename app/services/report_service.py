"""Core report generation logic — async with concurrent revision fetching."""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone

from app.adapters.azure_devops import AzureDevOpsClient
from app.config.loader import TeamConfig, get_team_config, load_teams_config
from app.schemas.report import BounceDetail, DeliverableRow, ReportResponse, StatusTimelineEntry
from app.settings import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REL_PARENT = "System.LinkTypes.Hierarchy-Reverse"
REL_CHILD = "System.LinkTypes.Hierarchy-Forward"

ACTIVE_CANONICAL = frozenset({"Development Active", "QA Active"})
ACTIVE_OR_DELIVERED_CANONICAL = frozenset({"Development Active", "QA Active", "Delivered"})

MAX_PARENT_DEPTH = 5  # guard against infinite loops in hierarchy walk


# ---------------------------------------------------------------------------
# Field helpers
# ---------------------------------------------------------------------------

def _parse_revision_date(rev: dict) -> datetime | None:
    raw = (rev.get("fields") or {}).get("System.ChangedDate")
    if not raw:
        return None
    try:
        if isinstance(raw, datetime):
            dt = raw
        elif isinstance(raw, str):
            if raw.endswith("Z"):
                dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            else:
                dt = datetime.fromisoformat(raw)
        else:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


def _revision_state(rev: dict) -> str:
    return ((rev.get("fields") or {}).get("System.State") or "").strip()


def _work_item_type(wi: dict) -> str:
    return ((wi.get("fields") or {}).get("System.WorkItemType") or "").strip()


def _work_item_title(wi: dict) -> str:
    return ((wi.get("fields") or {}).get("System.Title") or "").strip()


def _work_item_state(wi: dict) -> str:
    return ((wi.get("fields") or {}).get("System.State") or "").strip()


def _work_item_description(wi: dict) -> str | None:
    raw = (wi.get("fields") or {}).get("System.Description")
    if not raw:
        return None
    if isinstance(raw, str):
        stripped = raw.strip()
        return stripped or None
    return None


def _revision_assigned_to(rev: dict) -> str | None:
    """Extract display name from System.AssignedTo (may be dict or string)."""
    raw = (rev.get("fields") or {}).get("System.AssignedTo")
    if not raw:
        return None
    if isinstance(raw, dict):
        return (raw.get("displayName") or raw.get("uniqueName") or "").strip() or None
    if isinstance(raw, str):
        return raw.strip() or None
    return None


def _extract_relation_target_id(rel: dict) -> int | None:
    """Parse work item ID from a relation URL or target dict."""
    url = rel.get("url") or ""
    if "/workItems/" in url:
        try:
            return int(url.rstrip("/").split("/workItems/")[-1])
        except (ValueError, IndexError):
            pass
    target = rel.get("target")
    if isinstance(target, dict) and "id" in target:
        return int(target["id"])
    return None


# ---------------------------------------------------------------------------
# Inclusion logic
# ---------------------------------------------------------------------------

def _apply_inclusion(
    revisions: list[dict],
    start_dt: datetime,
    end_dt: datetime,
    real_to_canonical: dict[str, str],
) -> bool:
    """Include if:
    - Rule 1: any revision in period has canonical Development Active / QA Active / Delivered
    - Rule 2: state_at_start in Active/QA AND state_at_end in Active/QA/Delivered
    """
    if not revisions:
        return False
    _min_dt = datetime(1970, 1, 1, tzinfo=timezone.utc)
    sorted_revs = sorted(
        (r for r in revisions if _parse_revision_date(r) is not None),
        key=lambda r: _parse_revision_date(r) or _min_dt,
    )
    if not sorted_revs:
        return False

    state_at_start: str | None = None
    state_at_end: str | None = None
    revisions_in_period: list[dict] = []

    for rev in sorted_revs:
        changed = _parse_revision_date(rev)
        if changed is None:
            continue
        state = _revision_state(rev)
        if changed <= start_dt:
            state_at_start = state
        if changed <= end_dt:
            state_at_end = state
        if start_dt <= changed <= end_dt:
            revisions_in_period.append(rev)

    def canon(s: str) -> str | None:
        return real_to_canonical.get(s) if s else None

    # Rule 1: any revision in period with active/delivered canonical
    for rev in revisions_in_period:
        c = canon(_revision_state(rev))
        if c and c in ACTIVE_OR_DELIVERED_CANONICAL:
            return True

    # Rule 2: state spanning the period
    if state_at_start is None:
        state_at_start = _revision_state(sorted_revs[0])
    if state_at_end is None:
        state_at_end = _revision_state(sorted_revs[-1])
    c_start = canon(state_at_start)
    c_end = canon(state_at_end)
    if c_start in ACTIVE_CANONICAL and c_end in ACTIVE_OR_DELIVERED_CANONICAL:
        return True

    return False


# ---------------------------------------------------------------------------
# Role assignment: developer, QA, release manager by time in canonical state
# ---------------------------------------------------------------------------

CANONICAL_TO_ROLE = {
    "Development Active": "developer",
    "QA Active": "qa",
    "Delivered": "release_manager",
}


def _compute_role_assignments(
    revisions: list[dict],
    real_to_canonical: dict[str, str],
) -> tuple[str | None, str | None, str | None]:
    """Compute developer, QA, and release_manager from revision history.

    For each consecutive revision pair, the person assigned during that interval
    accumulates time toward the canonical status of that interval's state.
    The person with the most accumulated time per role wins.

    Returns (developer, qa, release_manager).
    """
    _min_dt = datetime(1970, 1, 1, tzinfo=timezone.utc)
    sorted_revs = sorted(
        (r for r in revisions if _parse_revision_date(r) is not None),
        key=lambda r: _parse_revision_date(r) or _min_dt,
    )
    if not sorted_revs:
        return None, None, None

    # Accumulate seconds per person per role
    # { "developer": {"Alice": 3600, "Bob": 1200}, "qa": {...}, ... }
    time_by_role: dict[str, dict[str, float]] = {
        "developer": {},
        "qa": {},
        "release_manager": {},
    }

    for i in range(len(sorted_revs) - 1):
        rev = sorted_revs[i]
        next_rev = sorted_revs[i + 1]

        t_start = _parse_revision_date(rev)
        t_end = _parse_revision_date(next_rev)
        if t_start is None or t_end is None or t_end <= t_start:
            continue

        state = _revision_state(rev)
        canonical = real_to_canonical.get(state)
        role = CANONICAL_TO_ROLE.get(canonical) if canonical else None
        if not role:
            continue

        person = _revision_assigned_to(rev)
        if not person:
            continue

        duration = (t_end - t_start).total_seconds()
        time_by_role[role][person] = time_by_role[role].get(person, 0.0) + duration

    # Also account for time from the last revision to "now" (ongoing assignment)
    if sorted_revs:
        last_rev = sorted_revs[-1]
        state = _revision_state(last_rev)
        canonical = real_to_canonical.get(state)
        role = CANONICAL_TO_ROLE.get(canonical) if canonical else None
        person = _revision_assigned_to(last_rev)
        if role and person:
            t_last = _parse_revision_date(last_rev)
            if t_last:
                now = datetime.now(timezone.utc)
                duration = (now - t_last).total_seconds()
                time_by_role[role][person] = time_by_role[role].get(person, 0.0) + duration

    def _pick_top(role_key: str) -> str | None:
        people = time_by_role[role_key]
        if not people:
            return None
        return max(people, key=people.get)  # type: ignore[arg-type]

    return _pick_top("developer"), _pick_top("qa"), _pick_top("release_manager")


# ---------------------------------------------------------------------------
# Status timeline and period boundary states
# ---------------------------------------------------------------------------

def _compute_status_timeline(
    revisions: list[dict],
    real_to_canonical: dict[str, str],
) -> list[StatusTimelineEntry]:
    """Build chronological list of state transitions from revision history."""
    _min_dt = datetime(1970, 1, 1, tzinfo=timezone.utc)
    sorted_revs = sorted(
        (r for r in revisions if _parse_revision_date(r) is not None),
        key=lambda r: _parse_revision_date(r) or _min_dt,
    )

    timeline: list[StatusTimelineEntry] = []
    prev_state: str | None = None
    for rev in sorted_revs:
        state = _revision_state(rev)
        if state == prev_state:
            continue  # skip revisions that didn't change the state
        prev_state = state
        dt = _parse_revision_date(rev)
        if dt is None:
            continue
        timeline.append(
            StatusTimelineEntry(
                date=dt,
                state=state,
                canonical_status=real_to_canonical.get(state),
                assigned_to=_revision_assigned_to(rev),
            )
        )
    return timeline


TAG_CODE_DEFECT = "Code Defect"
TAG_SCOPE_REQUIREMENTS = "Scope / Requirements"
TAG_SPILLOVER = "Spillover"


def _compute_bounces(
    revisions: list[dict],
    real_to_canonical: dict[str, str],
) -> tuple[int, list[BounceDetail]]:
    """Count how many times the item went from QA/Delivered back to active/backlog.

    Returns (bounce_count, bounce_details). Each detail records the revision
    numbers, states, and timestamp of the regression.
    """
    _min_dt = datetime(1970, 1, 1, tzinfo=timezone.utc)
    sorted_revs = sorted(
        (r for r in revisions if _parse_revision_date(r) is not None),
        key=lambda r: _parse_revision_date(r) or _min_dt,
    )

    details: list[BounceDetail] = []
    prev_canon: str | None = None
    prev_state: str | None = None
    prev_rev_num: int = 0

    for rev in sorted_revs:
        state = _revision_state(rev)
        canon = real_to_canonical.get(state)
        rev_num = rev.get("rev", 0)

        if (
            prev_canon in ("QA Active", "Delivered")
            and canon in ("Development Active", "Backlog")
        ):
            dt = _parse_revision_date(rev) or _min_dt
            details.append(BounceDetail(
                from_revision=prev_rev_num,
                to_revision=rev_num,
                from_state=prev_state or "",
                to_state=state,
                date=dt,
            ))

        prev_canon = canon
        prev_state = state
        prev_rev_num = rev_num

    return len(details), details


def _compute_tags(
    revisions: list[dict],
    real_to_canonical: dict[str, str],
    child_bug_ids: list[int],
    status_at_start: str | None,
    bounce_count: int,
) -> tuple[bool, bool, list[str]]:
    """Compute deliverable tags, has_rework, and is_spillover.

    Tags: 'Code Defect' (linked bugs), 'Scope / Requirements' (bounced back at least once),
    'Spillover' (in Development Active or QA Active before the period).
    has_rework is True when 'Code Defect' or 'Scope / Requirements' is in tags.
    Returns (has_rework, is_spillover, tags).
    """
    tags: list[str] = []
    if child_bug_ids:
        tags.append(TAG_CODE_DEFECT)

    if bounce_count > 0:
        tags.append(TAG_SCOPE_REQUIREMENTS)

    if status_at_start is not None:
        canon_start = real_to_canonical.get(status_at_start)
        if canon_start in ("Development Active", "QA Active"):
            tags.append(TAG_SPILLOVER)

    has_rework = TAG_CODE_DEFECT in tags or TAG_SCOPE_REQUIREMENTS in tags
    is_spillover = TAG_SPILLOVER in tags
    return has_rework, is_spillover, tags


def _compute_boundary_statuses(
    revisions: list[dict],
    start_dt: datetime,
    end_dt: datetime,
) -> tuple[str | None, str | None]:
    """Return (status_at_start, status_at_end) of the period.

    status_at_start = state of the most recent revision at or before start_dt.
    status_at_end   = state of the most recent revision at or before end_dt.
    """
    _min_dt = datetime(1970, 1, 1, tzinfo=timezone.utc)
    sorted_revs = sorted(
        (r for r in revisions if _parse_revision_date(r) is not None),
        key=lambda r: _parse_revision_date(r) or _min_dt,
    )
    if not sorted_revs:
        return None, None

    status_at_start: str | None = None
    status_at_end: str | None = None

    for rev in sorted_revs:
        changed = _parse_revision_date(rev)
        if changed is None:
            continue
        state = _revision_state(rev)
        if changed <= start_dt:
            status_at_start = state
        if changed <= end_dt:
            status_at_end = state

    return status_at_start, status_at_end


# ---------------------------------------------------------------------------
# Hierarchy: walk parent chain for Epic & Feature titles
# ---------------------------------------------------------------------------

async def _resolve_parent_titles(
    client: AzureDevOpsClient,
    project: str,
    work_item: dict,
    team: TeamConfig,
) -> tuple[str | None, str | None]:
    """Walk the parent hierarchy (up to MAX_PARENT_DEPTH) to find Epic and Feature titles."""
    epic_title: str | None = None
    feature_title: str | None = None
    current_wi = work_item

    for _ in range(MAX_PARENT_DEPTH):
        relations = current_wi.get("relations") or []
        parent_id: int | None = None
        for r in relations:
            if r.get("rel") == REL_PARENT:
                parent_id = _extract_relation_target_id(r)
                break

        if parent_id is None:
            break

        parent_wi = await client.get_work_item(project, parent_id)
        if not parent_wi:
            logger.warning("Parent work item %d not found for project=%s", parent_id, project)
            break

        ptype = _work_item_type(parent_wi)
        if ptype not in team.container_types:
            break  # parent is not a container (Epic/Feature); stop

        ptitle = _work_item_title(parent_wi) or None
        if ptype == "Epic" and epic_title is None:
            epic_title = ptitle
        elif ptype == "Feature" and feature_title is None:
            feature_title = ptitle

        # Found both — no need to walk further
        if epic_title and feature_title:
            break

        current_wi = parent_wi

    return epic_title, feature_title


# ---------------------------------------------------------------------------
# Children: collect bugs and tasks, fetching missing ones
# ---------------------------------------------------------------------------

async def _collect_children(
    client: AzureDevOpsClient,
    project: str,
    work_item: dict,
    all_work_items_by_id: dict[int, dict],
    team: TeamConfig,
) -> tuple[list[int], list[int]]:
    """Return (child_bug_ids, child_task_ids).

    Batch-fetches any child IDs not already in the lookup dict (e.g. Bugs
    that weren't in the WIQL deliverable query).
    """
    bug_ids: list[int] = []
    task_ids: list[int] = []

    relations = work_item.get("relations") or []
    child_ids: list[int] = []
    for r in relations:
        if r.get("rel") != REL_CHILD:
            continue
        cid = _extract_relation_target_id(r)
        if cid is not None:
            child_ids.append(cid)

    if not child_ids:
        return bug_ids, task_ids

    # Fetch IDs we haven't seen (Bugs won't be in the deliverable batch)
    missing_ids = [cid for cid in child_ids if cid not in all_work_items_by_id]
    if missing_ids:
        fetched = await client.get_work_items_batch(project, missing_ids, expand="None")
        for wi in fetched:
            wid = wi.get("id")
            if wid:
                all_work_items_by_id[wid] = wi

    # Classify children
    for cid in child_ids:
        child_wi = all_work_items_by_id.get(cid)
        if not child_wi:
            continue
        ctype = _work_item_type(child_wi)
        if ctype in team.bug_types:
            bug_ids.append(cid)
        elif ctype in team.deliverable_types or "Task" in ctype:
            task_ids.append(cid)

    return bug_ids, task_ids


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

async def run_report(
    team_id: str,
    start_date: date,
    end_date: date,
    client: AzureDevOpsClient,
    teams: dict[str, TeamConfig] | None = None,
) -> ReportResponse:
    """Generate performance report for one team and date range."""
    if teams is None:
        teams = load_teams_config()
    team = get_team_config(team_id, teams)
    if not team:
        return ReportResponse(
            team_id=team_id, start_date=start_date, end_date=end_date, deliverables=[]
        )

    start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date, datetime.max.time(), tzinfo=timezone.utc)
    real_to_canonical = team.real_state_to_canonical()

    # Step 1: WIQL to get candidate deliverable IDs
    candidate_ids = await client.wiql_query(
        team.project,
        team.area_paths,
        team.deliverable_types,
    )
    logger.info(
        "Team %s: %d WIQL candidates in %s – %s",
        team_id, len(candidate_ids), start_date, end_date,
    )

    if not candidate_ids:
        return ReportResponse(
            team_id=team_id, start_date=start_date, end_date=end_date, deliverables=[]
        )

    # Step 2: Fetch revisions concurrently with bounded parallelism
    settings = get_settings()
    semaphore = asyncio.Semaphore(settings.revision_concurrency)

    async def _check_inclusion(wid: int) -> tuple[int, list[dict]] | None:
        async with semaphore:
            try:
                revs = await client.get_revisions(team.project, wid)
                if _apply_inclusion(revs, start_dt, end_dt, real_to_canonical):
                    return (wid, revs)
            except Exception:
                logger.exception("Failed to check revisions for work item %d", wid)
            return None

    results = await asyncio.gather(*[_check_inclusion(wid) for wid in candidate_ids])
    included: list[tuple[int, list[dict]]] = [r for r in results if r is not None]
    included_ids = [wid for wid, _ in included]
    revisions_by_id: dict[int, list[dict]] = {wid: revs for wid, revs in included}
    logger.info("Team %s: %d items passed inclusion filter", team_id, len(included_ids))

    if not included_ids:
        return ReportResponse(
            team_id=team_id, start_date=start_date, end_date=end_date, deliverables=[]
        )

    # Step 3: Batch fetch included work items with relations
    work_items = await client.get_work_items_batch(team.project, included_ids)
    by_id: dict[int, dict] = {wi["id"]: wi for wi in work_items}

    # Step 4: Enrich each deliverable
    deliverables: list[DeliverableRow] = []
    for wi in work_items:
        wid = wi.get("id")
        if not wid:
            continue
        state = _work_item_state(wi)
        canonical_status = real_to_canonical.get(state) or "Unknown"

        parent_epic, parent_feature = await _resolve_parent_titles(
            client, team.project, wi, team
        )
        child_bug_ids, child_task_ids = await _collect_children(
            client, team.project, wi, by_id, team
        )

        # Compute enrichments from cached revisions
        revs = revisions_by_id.get(wid, [])
        developer, qa, release_manager = _compute_role_assignments(revs, real_to_canonical)
        status_timeline = _compute_status_timeline(revs, real_to_canonical)
        status_at_start, status_at_end = _compute_boundary_statuses(revs, start_dt, end_dt)
        bounce_count, bounce_details = _compute_bounces(revs, real_to_canonical)
        has_rework, is_spillover, tags = _compute_tags(
            revs, real_to_canonical, child_bug_ids, status_at_start, bounce_count,
        )

        deliverables.append(
            DeliverableRow(
                id=wid,
                work_item_type=_work_item_type(wi),
                title=_work_item_title(wi),
                description=_work_item_description(wi),
                state=state,
                canonical_status=canonical_status if canonical_status != "Unknown" else None,
                status_at_start=status_at_start,
                status_at_end=status_at_end,
                status_timeline=status_timeline,
                parent_epic_title=parent_epic,
                parent_feature_title=parent_feature,
                child_bug_ids=child_bug_ids,
                child_task_ids=child_task_ids,
                developer=developer,
                qa=qa,
                release_manager=release_manager,
                has_rework=has_rework,
                is_spillover=is_spillover,
                bounces=bounce_count,
                bounce_details=bounce_details,
                tags=tags,
            )
        )

    logger.info("Team %s: report complete with %d deliverables", team_id, len(deliverables))

    return ReportResponse(
        team_id=team_id,
        start_date=start_date,
        end_date=end_date,
        deliverables=deliverables,
    )
