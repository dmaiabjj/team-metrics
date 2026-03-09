"""Tests for report service — inclusion logic, config loading, and helper functions."""

from datetime import datetime, timezone

import pytest

from app.config.team_loader import load_teams_config
from app.services.report_service import (
    _apply_inclusion,
    _collect_children,
    _compute_bounces,
    _compute_boundary_statuses,
    _compute_lifecycle_dates,
    _compute_tags,
    _compute_role_assignments,
    _compute_status_timeline,
    _extract_relation_target_id,
    _parse_revision_date,
    _resolve_parents,
    _revision_assigned_to,
    _revision_state,
    _work_item_description,
    _work_item_state,
    _work_item_title,
    _work_item_type,
)

_utc = timezone.utc


# ---------------------------------------------------------------------------
# Inclusion logic
# ---------------------------------------------------------------------------

def test_apply_inclusion_empty_revisions():
    start = datetime(2025, 1, 1, tzinfo=_utc)
    end = datetime(2025, 1, 31, tzinfo=_utc)
    assert _apply_inclusion([], start, end, {}) is False


def test_apply_inclusion_revision_in_period_with_delivered():
    rev = {
        "fields": {
            "System.ChangedDate": "2025-01-15T12:00:00Z",
            "System.State": "Closed",
        }
    }
    real_to_canonical = {"Closed": "Delivered"}
    start = datetime(2025, 1, 1, tzinfo=_utc)
    end = datetime(2025, 1, 31, 23, 59, 59, tzinfo=_utc)
    assert _apply_inclusion([rev], start, end, real_to_canonical) is True


def test_apply_inclusion_active_whole_period():
    """Item active before period with no state change = included."""
    rev = {
        "fields": {
            "System.ChangedDate": "2024-12-01T12:00:00Z",
            "System.State": "Active",
        }
    }
    real_to_canonical = {"Active": "Development Active", "Closed": "Delivered"}
    start = datetime(2025, 1, 1, tzinfo=_utc)
    end = datetime(2025, 1, 31, 23, 59, 59, tzinfo=_utc)
    assert _apply_inclusion([rev], start, end, real_to_canonical) is True


def test_apply_inclusion_outside_period_not_active():
    """Item in a non-active state before period, no change during = excluded."""
    rev = {
        "fields": {
            "System.ChangedDate": "2024-12-01T12:00:00Z",
            "System.State": "New",
        }
    }
    real_to_canonical = {"New": "Backlog", "Active": "Development Active"}
    start = datetime(2025, 1, 1, tzinfo=_utc)
    end = datetime(2025, 1, 31, 23, 59, 59, tzinfo=_utc)
    assert _apply_inclusion([rev], start, end, real_to_canonical) is False


def test_apply_inclusion_transition_to_delivered_in_period():
    """Item transitions from Active to Closed (Delivered) within the period."""
    revs = [
        {"fields": {"System.ChangedDate": "2024-12-01T12:00:00Z", "System.State": "Active"}},
        {"fields": {"System.ChangedDate": "2025-01-20T10:00:00Z", "System.State": "Closed"}},
    ]
    real_to_canonical = {"Active": "Development Active", "Closed": "Delivered"}
    start = datetime(2025, 1, 1, tzinfo=_utc)
    end = datetime(2025, 1, 31, 23, 59, 59, tzinfo=_utc)
    assert _apply_inclusion(revs, start, end, real_to_canonical) is True


def test_apply_inclusion_qa_active_in_period():
    """Item moved to QA within the period = included."""
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-10T12:00:00Z", "System.State": "In QA"}},
    ]
    real_to_canonical = {"In QA": "QA Active"}
    start = datetime(2025, 1, 1, tzinfo=_utc)
    end = datetime(2025, 1, 31, 23, 59, 59, tzinfo=_utc)
    assert _apply_inclusion(revs, start, end, real_to_canonical) is True


# ---------------------------------------------------------------------------
# Date parsing
# ---------------------------------------------------------------------------

def test_parse_revision_date_iso_z():
    rev = {"fields": {"System.ChangedDate": "2025-01-15T12:00:00Z"}}
    dt = _parse_revision_date(rev)
    assert dt is not None
    assert dt.tzinfo is not None
    assert dt.year == 2025


def test_parse_revision_date_none():
    assert _parse_revision_date({"fields": {}}) is None
    assert _parse_revision_date({}) is None


# ---------------------------------------------------------------------------
# Field helpers
# ---------------------------------------------------------------------------

def test_revision_state():
    rev = {"fields": {"System.State": "  Active  "}}
    assert _revision_state(rev) == "Active"


def test_work_item_helpers():
    wi = {
        "fields": {
            "System.WorkItemType": "Story",
            "System.Title": "As a user I want...",
            "System.State": "Active",
        }
    }
    assert _work_item_type(wi) == "Story"
    assert _work_item_title(wi) == "As a user I want..."
    assert _work_item_state(wi) == "Active"


def test_extract_relation_target_id_from_url():
    rel = {"url": "https://dev.azure.com/org/project/_apis/wit/workItems/42"}
    assert _extract_relation_target_id(rel) == 42


def test_extract_relation_target_id_from_target():
    rel = {"target": {"id": 99}}
    assert _extract_relation_target_id(rel) == 99


def test_extract_relation_target_id_invalid():
    assert _extract_relation_target_id({}) is None


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def test_config_loads_five_teams():
    teams = load_teams_config()
    assert len(teams) == 5
    assert "game-services" in teams
    assert "rules-engine" in teams


def test_config_game_services_project():
    teams = load_teams_config()
    t = teams["game-services"]
    assert t.project == "game-services"
    assert "User Story" in t.deliverable_types
    assert "Epic" in t.container_types
    assert "Bug" in t.bug_types


def test_config_canonical_status_mapping():
    """Canonical statuses must match code constants after YAML fix."""
    teams = load_teams_config()
    t = teams["game-services"]
    r2c = t.real_state_to_canonical()
    assert r2c.get("Active") == "Development Active"
    assert r2c.get("In QA") == "QA Active"
    assert r2c.get("Closed") == "Delivered"


def test_config_payment_resolved_is_dev_active():
    """Payment-services maps Resolved -> Development Active (different from other teams)."""
    teams = load_teams_config()
    t = teams["payment-services"]
    r2c = t.real_state_to_canonical()
    assert r2c.get("Resolved") == "Development Active"


def test_config_all_teams_have_required_fields():
    teams = load_teams_config()
    for tid, t in teams.items():
        assert t.project, f"{tid}: missing project"
        assert t.area_paths, f"{tid}: missing area_paths"
        assert t.deliverable_types, f"{tid}: missing deliverable_types"
        assert t.container_types, f"{tid}: missing container_types"
        assert t.states, f"{tid}: missing states"


# ---------------------------------------------------------------------------
# Role assignment helpers
# ---------------------------------------------------------------------------

def test_revision_assigned_to_dict():
    rev = {"fields": {"System.AssignedTo": {"displayName": "Alice Smith", "uniqueName": "alice@co.com"}}}
    assert _revision_assigned_to(rev) == "Alice Smith"


def test_revision_assigned_to_string():
    rev = {"fields": {"System.AssignedTo": "Bob Jones"}}
    assert _revision_assigned_to(rev) == "Bob Jones"


def test_revision_assigned_to_none():
    assert _revision_assigned_to({"fields": {}}) is None
    assert _revision_assigned_to({}) is None


def test_revision_assigned_to_empty_string():
    rev = {"fields": {"System.AssignedTo": "  "}}
    assert _revision_assigned_to(rev) is None


# ---------------------------------------------------------------------------
# Role assignment computation
# ---------------------------------------------------------------------------

_ROLE_CANONICAL = {
    "Active": "Development Active",
    "Code Review": "Development Active",
    "In QA": "QA Active",
    "Ready for QA": "QA Active",
    "Closed": "Delivered",
}


def test_compute_role_assignments_basic():
    """Developer active 10 days, QA active 5 days, delivered by release manager."""
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "Active",
                     "System.AssignedTo": {"displayName": "Alice"}}},
        {"fields": {"System.ChangedDate": "2025-01-11T00:00:00Z", "System.State": "In QA",
                     "System.AssignedTo": {"displayName": "Bob"}}},
        {"fields": {"System.ChangedDate": "2025-01-16T00:00:00Z", "System.State": "Closed",
                     "System.AssignedTo": {"displayName": "Carol"}}},
    ]
    dev, qa, rm = _compute_role_assignments(revs, _ROLE_CANONICAL)
    assert dev == "Alice"
    assert qa == "Bob"
    assert rm == "Carol"


def test_compute_role_assignments_empty_revisions():
    dev, qa, rm = _compute_role_assignments([], _ROLE_CANONICAL)
    assert dev is None
    assert qa is None
    assert rm is None


def test_compute_role_assignments_no_assignee():
    """Revisions with no AssignedTo produce None roles."""
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "Active"}},
        {"fields": {"System.ChangedDate": "2025-01-10T00:00:00Z", "System.State": "In QA"}},
    ]
    dev, qa, rm = _compute_role_assignments(revs, _ROLE_CANONICAL)
    assert dev is None
    assert qa is None
    assert rm is None


def test_compute_role_assignments_multiple_developers():
    """When multiple people are assigned during dev, the one with most time wins."""
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "Active",
                     "System.AssignedTo": "Alice"}},
        {"fields": {"System.ChangedDate": "2025-01-03T00:00:00Z", "System.State": "Active",
                     "System.AssignedTo": "Bob"}},
        {"fields": {"System.ChangedDate": "2025-01-10T00:00:00Z", "System.State": "In QA",
                     "System.AssignedTo": "Carol"}},
    ]
    dev, qa, rm = _compute_role_assignments(revs, _ROLE_CANONICAL)
    # Alice: 2 days, Bob: 7 days => Bob wins
    assert dev == "Bob"
    assert qa == "Carol"


def test_compute_role_assignments_unmapped_state():
    """States not in canonical mapping don't contribute to any role."""
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "New",
                     "System.AssignedTo": "Alice"}},
        {"fields": {"System.ChangedDate": "2025-01-10T00:00:00Z", "System.State": "Active",
                     "System.AssignedTo": "Bob"}},
        {"fields": {"System.ChangedDate": "2025-01-15T00:00:00Z", "System.State": "Closed",
                     "System.AssignedTo": "Carol"}},
    ]
    dev, qa, rm = _compute_role_assignments(revs, _ROLE_CANONICAL)
    # "New" is unmapped, so Alice gets no credit
    assert dev == "Bob"
    assert rm == "Carol"


def test_compute_role_assignments_single_revision():
    """Single revision — only the last-revision-to-now logic applies."""
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "Active",
                     "System.AssignedTo": "Alice"}},
    ]
    dev, qa, rm = _compute_role_assignments(revs, _ROLE_CANONICAL)
    # Alice is the only person in Dev Active (via last-rev-to-now)
    assert dev == "Alice"
    assert qa is None
    assert rm is None


# ---------------------------------------------------------------------------
# Description helper
# ---------------------------------------------------------------------------

def test_work_item_description():
    wi = {"fields": {"System.Description": "<div>Some HTML description</div>"}}
    assert _work_item_description(wi) == "<div>Some HTML description</div>"


def test_work_item_description_none():
    assert _work_item_description({"fields": {}}) is None
    assert _work_item_description({}) is None


def test_work_item_description_empty():
    wi = {"fields": {"System.Description": "  "}}
    assert _work_item_description(wi) is None


# ---------------------------------------------------------------------------
# Status timeline
# ---------------------------------------------------------------------------

def test_compute_status_timeline_basic():
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "Active",
                     "System.AssignedTo": "Alice"}},
        {"fields": {"System.ChangedDate": "2025-01-10T00:00:00Z", "System.State": "In QA",
                     "System.AssignedTo": "Bob"}},
        {"fields": {"System.ChangedDate": "2025-01-15T00:00:00Z", "System.State": "Closed",
                     "System.AssignedTo": "Carol"}},
    ]
    timeline = _compute_status_timeline(revs, _ROLE_CANONICAL)
    assert len(timeline) == 3
    assert timeline[0].state == "Active"
    assert timeline[0].canonical_status == "Development Active"
    assert timeline[0].assigned_to == "Alice"
    assert timeline[1].state == "In QA"
    assert timeline[1].canonical_status == "QA Active"
    assert timeline[2].state == "Closed"
    assert timeline[2].canonical_status == "Delivered"


def test_compute_status_timeline_skips_same_state():
    """Consecutive revisions in the same state should be deduplicated."""
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "Active",
                     "System.AssignedTo": "Alice"}},
        {"fields": {"System.ChangedDate": "2025-01-05T00:00:00Z", "System.State": "Active",
                     "System.AssignedTo": "Bob"}},
        {"fields": {"System.ChangedDate": "2025-01-10T00:00:00Z", "System.State": "In QA",
                     "System.AssignedTo": "Carol"}},
    ]
    timeline = _compute_status_timeline(revs, _ROLE_CANONICAL)
    assert len(timeline) == 2
    assert timeline[0].state == "Active"
    assert timeline[0].assigned_to == "Alice"  # first occurrence
    assert timeline[1].state == "In QA"


def test_compute_status_timeline_empty():
    assert _compute_status_timeline([], _ROLE_CANONICAL) == []


# ---------------------------------------------------------------------------
# Boundary statuses
# ---------------------------------------------------------------------------

def test_compute_boundary_statuses_basic():
    revs = [
        {"fields": {"System.ChangedDate": "2024-12-15T00:00:00Z", "System.State": "Active"}},
        {"fields": {"System.ChangedDate": "2025-01-10T00:00:00Z", "System.State": "In QA"}},
        {"fields": {"System.ChangedDate": "2025-01-20T00:00:00Z", "System.State": "Closed"}},
    ]
    start = datetime(2025, 1, 1, tzinfo=_utc)
    end = datetime(2025, 1, 31, 23, 59, 59, tzinfo=_utc)
    at_start, at_end = _compute_boundary_statuses(revs, start, end)
    assert at_start == "Active"  # last state before/at start
    assert at_end == "Closed"    # last state before/at end


def test_compute_boundary_statuses_no_revision_before_start():
    """Item created during the period — status_at_start is None."""
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-10T00:00:00Z", "System.State": "Active"}},
    ]
    start = datetime(2025, 1, 1, tzinfo=_utc)
    end = datetime(2025, 1, 31, 23, 59, 59, tzinfo=_utc)
    at_start, at_end = _compute_boundary_statuses(revs, start, end)
    assert at_start is None
    assert at_end == "Active"


def test_compute_boundary_statuses_all_before_period():
    """All revisions before the period — both start and end are the last state."""
    revs = [
        {"fields": {"System.ChangedDate": "2024-11-01T00:00:00Z", "System.State": "New"}},
        {"fields": {"System.ChangedDate": "2024-12-01T00:00:00Z", "System.State": "Active"}},
    ]
    start = datetime(2025, 1, 1, tzinfo=_utc)
    end = datetime(2025, 1, 31, 23, 59, 59, tzinfo=_utc)
    at_start, at_end = _compute_boundary_statuses(revs, start, end)
    assert at_start == "Active"
    assert at_end == "Active"


def test_compute_boundary_statuses_empty():
    start = datetime(2025, 1, 1, tzinfo=_utc)
    end = datetime(2025, 1, 31, 23, 59, 59, tzinfo=_utc)
    at_start, at_end = _compute_boundary_statuses([], start, end)
    assert at_start is None
    assert at_end is None


# ---------------------------------------------------------------------------
# Bounces
# ---------------------------------------------------------------------------

_TAG_CANONICAL = {
    "New": "Backlog",
    "Active": "Development Active",
    "In Review": "QA Active",
    "Closed": "Delivered",
}


def test_bounces_none():
    revs = [
        {"rev": 1, "fields": {"System.ChangedDate": "2025-01-01T10:00:00Z", "System.State": "Active"}},
        {"rev": 2, "fields": {"System.ChangedDate": "2025-01-15T10:00:00Z", "System.State": "Closed"}},
    ]
    count, details = _compute_bounces(revs, _TAG_CANONICAL)
    assert count == 0
    assert details == []


def test_bounces_single():
    revs = [
        {"rev": 1, "fields": {"System.ChangedDate": "2025-01-01T10:00:00Z", "System.State": "Active"}},
        {"rev": 2, "fields": {"System.ChangedDate": "2025-01-10T10:00:00Z", "System.State": "In Review"}},
        {"rev": 3, "fields": {"System.ChangedDate": "2025-01-15T10:00:00Z", "System.State": "Active"}},
    ]
    count, details = _compute_bounces(revs, _TAG_CANONICAL)
    assert count == 1
    assert details[0].from_revision == 2
    assert details[0].to_revision == 3
    assert details[0].from_state == "In Review"
    assert details[0].to_state == "Active"


def test_bounces_multiple():
    revs = [
        {"rev": 1, "fields": {"System.ChangedDate": "2025-01-01T10:00:00Z", "System.State": "Active"}},
        {"rev": 2, "fields": {"System.ChangedDate": "2025-01-05T10:00:00Z", "System.State": "In Review"}},
        {"rev": 3, "fields": {"System.ChangedDate": "2025-01-10T10:00:00Z", "System.State": "Active"}},
        {"rev": 4, "fields": {"System.ChangedDate": "2025-01-15T10:00:00Z", "System.State": "Closed"}},
        {"rev": 5, "fields": {"System.ChangedDate": "2025-01-20T10:00:00Z", "System.State": "Active"}},
    ]
    count, details = _compute_bounces(revs, _TAG_CANONICAL)
    assert count == 2
    assert details[0].from_state == "In Review"
    assert details[0].to_state == "Active"
    assert details[1].from_state == "Closed"
    assert details[1].to_state == "Active"


def test_bounces_delivered_to_backlog():
    revs = [
        {"rev": 5, "fields": {"System.ChangedDate": "2025-01-10T10:00:00Z", "System.State": "Closed"}},
        {"rev": 6, "fields": {"System.ChangedDate": "2025-01-15T10:00:00Z", "System.State": "New"}},
    ]
    count, details = _compute_bounces(revs, _TAG_CANONICAL)
    assert count == 1
    assert details[0].from_state == "Closed"
    assert details[0].to_state == "New"


# ---------------------------------------------------------------------------
# Tags & rework detection
# ---------------------------------------------------------------------------


def test_tags_no_rework():
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T10:00:00Z", "System.State": "Active"}},
        {"fields": {"System.ChangedDate": "2025-01-15T10:00:00Z", "System.State": "Closed"}},
    ]
    has_rework, is_spillover, tags = _compute_tags(revs, _TAG_CANONICAL, [], None, 0)
    assert has_rework is False
    assert is_spillover is False
    assert tags == []


def test_tags_code_defect_from_linked_bugs():
    revs = [{"fields": {"System.ChangedDate": "2025-01-01T10:00:00Z", "System.State": "Active"}}]
    has_rework, is_spillover, tags = _compute_tags(revs, _TAG_CANONICAL, [100, 101], None, 0)
    assert has_rework is True
    assert is_spillover is False
    assert "Code Defect" in tags


def test_tags_scope_requirements_from_bounces():
    has_rework, is_spillover, tags = _compute_tags([], _TAG_CANONICAL, [], None, 2)
    assert has_rework is True
    assert "Scope / Requirements" in tags


def test_tags_no_scope_requirements_zero_bounces():
    has_rework, is_spillover, tags = _compute_tags([], _TAG_CANONICAL, [], None, 0)
    assert has_rework is False
    assert "Scope / Requirements" not in tags


def test_tags_spillover_dev_active_at_start():
    revs = [{"fields": {"System.ChangedDate": "2024-12-01T10:00:00Z", "System.State": "Active"}}]
    has_rework, is_spillover, tags = _compute_tags(revs, _TAG_CANONICAL, [], "Active", 0)
    assert is_spillover is True
    assert "Spillover" in tags
    assert has_rework is False


def test_tags_spillover_qa_active_at_start():
    revs = [{"fields": {"System.ChangedDate": "2024-12-01T10:00:00Z", "System.State": "In Review"}}]
    has_rework, is_spillover, tags = _compute_tags(revs, _TAG_CANONICAL, [], "In Review", 0)
    assert is_spillover is True
    assert "Spillover" in tags
    assert has_rework is False


def test_tags_no_spillover_when_backlog_at_start():
    revs = [{"fields": {"System.ChangedDate": "2024-12-01T10:00:00Z", "System.State": "New"}}]
    has_rework, is_spillover, tags = _compute_tags(revs, _TAG_CANONICAL, [], "New", 0)
    assert is_spillover is False
    assert "Spillover" not in tags


def test_tags_combined_code_defect_and_spillover():
    revs = [{"fields": {"System.ChangedDate": "2024-12-01T10:00:00Z", "System.State": "Active"}}]
    has_rework, is_spillover, tags = _compute_tags(revs, _TAG_CANONICAL, [200], "Active", 0)
    assert has_rework is True
    assert is_spillover is True
    assert "Code Defect" in tags
    assert "Spillover" in tags


# ---------------------------------------------------------------------------
# Lifecycle dates
# ---------------------------------------------------------------------------


def test_lifecycle_dates_full():
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "New"}},
        {"fields": {"System.ChangedDate": "2025-01-05T00:00:00Z", "System.State": "Active"}},
        {"fields": {"System.ChangedDate": "2025-01-15T00:00:00Z", "System.State": "Closed"}},
    ]
    lc = _compute_lifecycle_dates(revs, _TAG_CANONICAL)
    assert lc.date_created == datetime(2025, 1, 1, tzinfo=_utc)
    assert lc.start_date == datetime(2025, 1, 5, tzinfo=_utc)
    assert lc.finish_date == datetime(2025, 1, 15, tzinfo=_utc)
    assert lc.delivery_days == 14.0


def test_lifecycle_dates_never_delivered():
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "New"}},
        {"fields": {"System.ChangedDate": "2025-01-05T00:00:00Z", "System.State": "Active"}},
    ]
    lc = _compute_lifecycle_dates(revs, _TAG_CANONICAL)
    assert lc.date_created == datetime(2025, 1, 1, tzinfo=_utc)
    assert lc.start_date == datetime(2025, 1, 5, tzinfo=_utc)
    assert lc.finish_date is None
    assert lc.delivery_days is None


def test_lifecycle_dates_never_active():
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "New"}},
    ]
    lc = _compute_lifecycle_dates(revs, _TAG_CANONICAL)
    assert lc.date_created == datetime(2025, 1, 1, tzinfo=_utc)
    assert lc.start_date is None
    assert lc.finish_date is None


def test_lifecycle_dates_empty():
    lc = _compute_lifecycle_dates([], _TAG_CANONICAL)
    assert lc.date_created is None
    assert lc.start_date is None
    assert lc.finish_date is None
    assert lc.delivery_days is None


def test_lifecycle_dates_same_day():
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-10T10:00:00Z", "System.State": "New"}},
        {"fields": {"System.ChangedDate": "2025-01-10T18:00:00Z", "System.State": "Closed"}},
    ]
    lc = _compute_lifecycle_dates(revs, _TAG_CANONICAL)
    assert lc.date_created == datetime(2025, 1, 10, 10, 0, tzinfo=_utc)
    assert lc.start_date is None  # never went through active
    assert lc.finish_date == datetime(2025, 1, 10, 18, 0, tzinfo=_utc)
    assert lc.delivery_days is not None
    assert lc.delivery_days < 1.0


def test_lifecycle_start_date_from_qa():
    """start_date picks up QA Active if that's the first active canonical."""
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "New"}},
        {"fields": {"System.ChangedDate": "2025-01-08T00:00:00Z", "System.State": "In Review"}},
    ]
    lc = _compute_lifecycle_dates(revs, _TAG_CANONICAL)
    assert lc.start_date == datetime(2025, 1, 8, tzinfo=_utc)


def test_lifecycle_finish_date_uses_last_delivered():
    """finish_date is the last Delivered date when the item ends in Delivered."""
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "New"}},
        {"fields": {"System.ChangedDate": "2025-01-05T00:00:00Z", "System.State": "Active"}},
        {"fields": {"System.ChangedDate": "2025-01-10T00:00:00Z", "System.State": "Closed"}},
        {"fields": {"System.ChangedDate": "2025-01-12T00:00:00Z", "System.State": "Active"}},
        {"fields": {"System.ChangedDate": "2025-01-20T00:00:00Z", "System.State": "Closed"}},
    ]
    lc = _compute_lifecycle_dates(revs, _TAG_CANONICAL)
    assert lc.finish_date == datetime(2025, 1, 20, tzinfo=_utc)
    assert lc.delivery_days == 19.0


def test_lifecycle_finish_date_none_after_bounce_back():
    """finish_date is None when the item bounced back from Delivered and stayed active."""
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "New"}},
        {"fields": {"System.ChangedDate": "2025-01-05T00:00:00Z", "System.State": "Active"}},
        {"fields": {"System.ChangedDate": "2025-01-10T00:00:00Z", "System.State": "Closed"}},
        {"fields": {"System.ChangedDate": "2025-01-12T00:00:00Z", "System.State": "Active"}},
    ]
    lc = _compute_lifecycle_dates(revs, _TAG_CANONICAL)
    assert lc.finish_date is None
    assert lc.delivery_days is None


def test_lifecycle_ignores_non_state_change_revisions():
    """Revisions that don't change state (e.g. assignee edit) must not move finish_date."""
    revs = [
        {"fields": {"System.ChangedDate": "2025-01-01T00:00:00Z", "System.State": "New"}},
        {"fields": {"System.ChangedDate": "2025-01-05T00:00:00Z", "System.State": "Active"}},
        {"fields": {"System.ChangedDate": "2025-01-10T00:00:00Z", "System.State": "Closed"}},
        {"fields": {"System.ChangedDate": "2025-01-15T00:00:00Z", "System.State": "Closed"}},
        {"fields": {"System.ChangedDate": "2025-01-18T00:00:00Z", "System.State": "Closed"}},
    ]
    lc = _compute_lifecycle_dates(revs, _TAG_CANONICAL)
    assert lc.finish_date == datetime(2025, 1, 10, tzinfo=_utc)
    assert lc.delivery_days == 9.0


# ---------------------------------------------------------------------------
# Config: tech debt & post mortem fields
# ---------------------------------------------------------------------------


def test_config_has_tech_debt_and_post_mortem_fields():
    teams = load_teams_config()
    for tid, tc in teams.items():
        assert isinstance(tc.tech_debt_epic_ids, list), f"{tid} missing tech_debt_epic_ids"
        assert isinstance(tc.post_mortem_epic_ids, list), f"{tid} missing post_mortem_epic_ids"
        assert tc.post_mortem_sla_weeks is not None, f"{tid} missing post_mortem_sla_weeks"
