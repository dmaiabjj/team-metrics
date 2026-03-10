"""Core report generation logic — async with concurrent revision fetching."""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone

from app.adapters.azure_devops import AzureDevOpsClient
from app.cache import ReportCache, WorkItemCache
from app.config.team_loader import TeamConfig, get_team_config, load_teams_config
from app.schemas.report import BounceDetail, DeliverableRow, ReportResponse, StatusTimelineEntry, WorkItemRef
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

_MIN_DT = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _prepare_revisions(revisions: list[dict]) -> list[dict]:
    """Filter out revisions with no date and sort chronologically. Call once per work item."""
    return sorted(
        (r for r in revisions if _parse_revision_date(r) is not None),
        key=lambda r: _parse_revision_date(r) or _MIN_DT,
    )


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
# Delivery days: creation → first Delivered state
# ---------------------------------------------------------------------------

class _LifecycleDates:
    __slots__ = ("date_created", "start_date", "finish_date", "delivery_days")

    def __init__(
        self,
        date_created: datetime | None = None,
        start_date: datetime | None = None,
        finish_date: datetime | None = None,
        delivery_days: float | None = None,
    ):
        self.date_created = date_created
        self.start_date = start_date
        self.finish_date = finish_date
        self.delivery_days = delivery_days


def _compute_lifecycle_dates(
    sorted_revs: list[dict],
    real_to_canonical: dict[str, str],
) -> _LifecycleDates:
    """Extract key lifecycle timestamps from pre-sorted revision history.

    date_created: timestamp of the first revision (creation).
    start_date: timestamp when the item first entered Development Active or QA Active.
    finish_date: latest date the item entered Delivered, only if the item's final
                 state is still Delivered. If it bounced back, finish_date is None.
    delivery_days: calendar days from date_created to finish_date (None if not delivered).
    """
    if not sorted_revs:
        return _LifecycleDates()

    created_dt = _parse_revision_date(sorted_revs[0])
    first_active_dt: datetime | None = None
    last_delivered_dt: datetime | None = None
    prev_state: str | None = None
    final_canon: str | None = None

    for rev in sorted_revs:
        state = _revision_state(rev)
        if state == prev_state:
            continue
        prev_state = state
        canon = real_to_canonical.get(state)
        final_canon = canon
        dt = _parse_revision_date(rev)
        if dt is None:
            continue
        if first_active_dt is None and canon in ACTIVE_CANONICAL:
            first_active_dt = dt
        if canon == "Delivered":
            last_delivered_dt = dt

    if final_canon != "Delivered":
        last_delivered_dt = None

    delivery_days: float | None = None
    if created_dt and last_delivered_dt:
        delivery_days = round((last_delivered_dt - created_dt).total_seconds() / 86400, 2)

    return _LifecycleDates(
        date_created=created_dt,
        start_date=first_active_dt,
        finish_date=last_delivered_dt,
        delivery_days=delivery_days,
    )


# ---------------------------------------------------------------------------
# Inclusion logic
# ---------------------------------------------------------------------------

def _apply_inclusion(
    sorted_revs: list[dict],
    start_dt: datetime,
    end_dt: datetime,
    real_to_canonical: dict[str, str],
) -> bool:
    """Include if:
    - Rule 1: any revision in period has canonical Development Active / QA Active / Delivered
    - Rule 2: state_at_start in Active/QA AND state_at_end in Active/QA/Delivered
    """
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
    sorted_revs: list[dict],
    real_to_canonical: dict[str, str],
) -> tuple[str | None, str | None, str | None]:
    """Compute developer, QA, and release_manager from pre-sorted revision history.

    Last-one-wins: the last person assigned while the item is in a canonical
    status becomes the role holder. Revisions are walked chronologically.

    Returns (developer, qa, release_manager).
    """
    if not sorted_revs:
        return None, None, None

    last_by_role: dict[str, str | None] = {
        "developer": None,
        "qa": None,
        "release_manager": None,
    }

    for rev in sorted_revs:
        state = _revision_state(rev)
        canonical = real_to_canonical.get(state)
        role = CANONICAL_TO_ROLE.get(canonical) if canonical else None
        if not role:
            continue
        person = _revision_assigned_to(rev)
        if person:
            last_by_role[role] = person

    return last_by_role["developer"], last_by_role["qa"], last_by_role["release_manager"]


# ---------------------------------------------------------------------------
# Status timeline and period boundary states
# ---------------------------------------------------------------------------

def _compute_status_timeline(
    sorted_revs: list[dict],
    real_to_canonical: dict[str, str],
) -> list[StatusTimelineEntry]:
    """Build chronological list of state transitions from pre-sorted revision history."""
    timeline: list[StatusTimelineEntry] = []
    prev_state: str | None = None
    for rev in sorted_revs:
        state = _revision_state(rev)
        assignee = _revision_assigned_to(rev)
        if state == prev_state:
            if assignee and timeline and timeline[-1].assigned_to != assignee:
                timeline[-1] = timeline[-1].model_copy(update={"assigned_to": assignee})
            continue
        prev_state = state
        dt = _parse_revision_date(rev)
        if dt is None:
            continue
        timeline.append(
            StatusTimelineEntry(
                date=dt,
                state=state,
                canonical_status=real_to_canonical.get(state),
                assigned_to=assignee,
            )
        )
    return timeline


TAG_CODE_DEFECT = "Code Defect"
TAG_SCOPE_REQUIREMENTS = "Scope / Requirements"
TAG_SPILLOVER = "Spillover"


def _compute_bounces(
    sorted_revs: list[dict],
    real_to_canonical: dict[str, str],
) -> tuple[int, list[BounceDetail]]:
    """Count how many times the item went from QA/Delivered back to active/backlog.

    Returns (bounce_count, bounce_details). Each detail records the revision
    numbers, states, and timestamp of the regression.
    """
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
            dt = _parse_revision_date(rev) or _MIN_DT
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
    sorted_revs: list[dict],
    start_dt: datetime,
    end_dt: datetime,
) -> tuple[str | None, str | None]:
    """Return (status_at_start, status_at_end) of the period.

    status_at_start = state of the most recent revision at or before start_dt.
    status_at_end   = state of the most recent revision at or before end_dt.
    """
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

async def _resolve_parents(
    client: AzureDevOpsClient,
    project: str,
    work_item: dict,
    team: TeamConfig,
    wi_cache: WorkItemCache | None = None,
) -> tuple[WorkItemRef | None, WorkItemRef | None]:
    """Walk the parent hierarchy (up to MAX_PARENT_DEPTH) to find Epic and Feature."""
    epic_ref: WorkItemRef | None = None
    feature_ref: WorkItemRef | None = None
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

        parent_wi: dict | None = None
        if wi_cache is not None:
            parent_wi = wi_cache.get(project, parent_id)
        if parent_wi is None:
            parent_wi = await client.get_work_item(project, parent_id)
            if parent_wi and wi_cache is not None:
                wi_cache.put(project, parent_id, parent_wi)
        if not parent_wi:
            logger.warning("Parent work item %d not found for project=%s", parent_id, project)
            break

        ptype = _work_item_type(parent_wi)
        if ptype not in team.container_types:
            break

        ref = WorkItemRef(
            id=parent_wi.get("id"),
            title=_work_item_title(parent_wi) or None,
            state=_work_item_state(parent_wi) or None,
        )
        if ptype == "Epic" and epic_ref is None:
            epic_ref = ref
        elif ptype == "Feature" and feature_ref is None:
            feature_ref = ref

        if epic_ref and feature_ref:
            break

        current_wi = parent_wi

    return epic_ref, feature_ref


# ---------------------------------------------------------------------------
# Children: collect bugs and tasks, fetching missing ones
# ---------------------------------------------------------------------------

async def _collect_children(
    client: AzureDevOpsClient,
    project: str,
    work_item: dict,
    known_work_items: dict[int, dict],
    team: TeamConfig,
    wi_cache: WorkItemCache | None = None,
) -> tuple[list[WorkItemRef], list[WorkItemRef], dict[int, dict]]:
    """Return (child_bugs, child_tasks, newly_fetched) as WorkItemRef lists.

    Batch-fetches any child IDs not already in known_work_items (e.g. Bugs
    that weren't in the WIQL deliverable query). Returns newly fetched items
    separately to avoid mutating the shared lookup.
    """
    bugs: list[WorkItemRef] = []
    tasks: list[WorkItemRef] = []
    newly_fetched: dict[int, dict] = {}

    relations = work_item.get("relations") or []
    child_ids: list[int] = []
    for r in relations:
        if r.get("rel") != REL_CHILD:
            continue
        cid = _extract_relation_target_id(r)
        if cid is not None:
            child_ids.append(cid)

    if not child_ids:
        return bugs, tasks, newly_fetched

    # Build local lookup: known items + L2 cache hits
    local_lookup: dict[int, dict] = {}
    for cid in child_ids:
        if cid in known_work_items:
            local_lookup[cid] = known_work_items[cid]
        elif wi_cache is not None:
            cached_wi = wi_cache.get(project, cid)
            if cached_wi is not None:
                local_lookup[cid] = cached_wi

    missing_ids = [cid for cid in child_ids if cid not in local_lookup]
    if missing_ids:
        fetched = await client.get_work_items_batch(project, missing_ids, expand="none")
        for wi in fetched:
            wid = wi.get("id")
            if wid:
                local_lookup[wid] = wi
                newly_fetched[wid] = wi
                if wi_cache is not None:
                    wi_cache.put(project, wid, wi)

    for cid in child_ids:
        child_wi = local_lookup.get(cid)
        if not child_wi:
            continue
        ctype = _work_item_type(child_wi)
        ref = WorkItemRef(
            id=cid,
            title=_work_item_title(child_wi) or None,
            state=_work_item_state(child_wi) or None,
        )
        if ctype in team.bug_types:
            bugs.append(ref)
        elif ctype in team.deliverable_types or "Task" in ctype:
            tasks.append(ref)

    return bugs, tasks, newly_fetched


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

async def run_report(
    team_id: str,
    start_date: date,
    end_date: date,
    client: AzureDevOpsClient,
    teams: dict[str, TeamConfig] | None = None,
    report_cache: ReportCache | None = None,
    wi_cache: WorkItemCache | None = None,
) -> ReportResponse:
    """Generate performance report for one team and date range."""
    if report_cache is not None:
        cached = report_cache.get(team_id, start_date, end_date)
        if cached is not None:
            logger.info("Team %s: returning L1 cached report", team_id)
            return cached

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
    changed_since = date(start_date.year, 1, 1)
    candidate_ids = await client.wiql_query(
        team.project,
        team.area_paths,
        team.deliverable_types,
        changed_since=changed_since,
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
                sorted_revs = _prepare_revisions(revs)
                if _apply_inclusion(sorted_revs, start_dt, end_dt, real_to_canonical):
                    return (wid, sorted_revs)
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

    # Step 4a: Resolve parents concurrently (bounded by semaphore)
    parent_semaphore = asyncio.Semaphore(settings.revision_concurrency)

    async def _resolve_with_sem(wi: dict) -> tuple[WorkItemRef | None, WorkItemRef | None]:
        async with parent_semaphore:
            return await _resolve_parents(client, team.project, wi, team, wi_cache)

    parent_results = await asyncio.gather(
        *[_resolve_with_sem(wi) for wi in work_items]
    )
    parents_by_id: dict[int, tuple[WorkItemRef | None, WorkItemRef | None]] = {}
    for wi, parent_pair in zip(work_items, parent_results):
        wid = wi.get("id")
        if wid:
            parents_by_id[wid] = parent_pair

    # Step 4b: Collect children concurrently
    child_semaphore = asyncio.Semaphore(settings.revision_concurrency)

    async def _collect_with_sem(wi: dict) -> tuple[int, list[WorkItemRef], list[WorkItemRef], dict[int, dict]]:
        async with child_semaphore:
            bugs, tasks, fetched = await _collect_children(
                client, team.project, wi, by_id, team, wi_cache
            )
            return wi.get("id", 0), bugs, tasks, fetched

    child_results = await asyncio.gather(*[_collect_with_sem(wi) for wi in work_items])

    # Merge newly fetched items into the shared lookup
    children_by_id: dict[int, tuple[list[WorkItemRef], list[WorkItemRef]]] = {}
    for wid, bugs, tasks, fetched in child_results:
        if wid:
            children_by_id[wid] = (bugs, tasks)
            by_id.update(fetched)

    # Step 4c: Enrich each deliverable
    deliverables: list[DeliverableRow] = []
    for wi in work_items:
        wid = wi.get("id")
        if not wid:
            continue
        state = _work_item_state(wi)
        canonical_status = real_to_canonical.get(state) or "Unknown"

        epic_ref, feature_ref = parents_by_id.get(wid, (None, None))
        child_bugs, child_tasks = children_by_id.get(wid, ([], []))

        # Compute enrichments from cached revisions
        revs = revisions_by_id.get(wid, [])
        developer, qa, release_manager = _compute_role_assignments(revs, real_to_canonical)
        status_timeline = _compute_status_timeline(revs, real_to_canonical)
        status_at_start, status_at_end = _compute_boundary_statuses(revs, start_dt, end_dt)
        bounce_count, bounce_details = _compute_bounces(revs, real_to_canonical)
        child_bug_ids = [b.id for b in child_bugs]
        has_rework, is_spillover, tags = _compute_tags(
            real_to_canonical, child_bug_ids, status_at_start, bounce_count,
        )

        parent_epic_id = epic_ref.id if epic_ref else None
        is_technical_debt = (
            parent_epic_id is not None and parent_epic_id in team.tech_debt_epic_ids
        )
        is_post_mortem = (
            parent_epic_id is not None and parent_epic_id in team.post_mortem_epic_ids
        )

        lifecycle = _compute_lifecycle_dates(revs, real_to_canonical)

        post_mortem_sla_met: bool | None = None
        if is_post_mortem and team.post_mortem_sla_weeks is not None:
            if lifecycle.delivery_days is not None:
                sla_days = team.post_mortem_sla_weeks * 7
                post_mortem_sla_met = lifecycle.delivery_days <= sla_days
            else:
                post_mortem_sla_met = False

        deliverables.append(
            DeliverableRow(
                id=wid,
                work_item_type=_work_item_type(wi),
                title=_work_item_title(wi),
                description=_work_item_description(wi),
                state=state,
                canonical_status=canonical_status if canonical_status != "Unknown" else None,
                date_created=lifecycle.date_created,
                start_date=lifecycle.start_date,
                finish_date=lifecycle.finish_date,
                status_at_start=status_at_start,
                status_at_end=status_at_end,
                status_timeline=status_timeline,
                parent_epic=epic_ref,
                parent_feature=feature_ref,
                child_bugs=child_bugs,
                child_tasks=child_tasks,
                developer=developer,
                qa=qa,
                release_manager=release_manager,
                has_rework=has_rework,
                is_spillover=is_spillover,
                bounces=bounce_count,
                bounce_details=bounce_details,
                is_technical_debt=is_technical_debt,
                is_post_mortem=is_post_mortem,
                post_mortem_sla_met=post_mortem_sla_met,
                delivery_days=lifecycle.delivery_days,
                tags=tags,
            )
        )

    logger.info("Team %s: report complete with %d deliverables", team_id, len(deliverables))

    response = ReportResponse(
        team_id=team_id,
        start_date=start_date,
        end_date=end_date,
        total=len(deliverables),
        deliverables=deliverables,
    )
    if report_cache is not None:
        report_cache.put(team_id, start_date, end_date, response)
    return response
