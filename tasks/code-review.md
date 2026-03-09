# Comprehensive Architecture & Code Review

**Date:** 2026-03-09
**Scope:** Full codebase — architecture, code quality, naming, Azure DevOps integration, performance, testing
**Test baseline:** 138 tests passing (0.08s)

---

## Executive Summary

The API is **well-architected** for its purpose. Clean separation of concerns across layers, proper async patterns with bounded concurrency, tenacity retry, connection pooling, and a solid test suite. The codebase is production-ready with a few targeted improvements that would meaningfully improve performance, correctness, and maintainability.

**Grade: B+** — Strong foundation, but has 3-4 issues that would cause real problems at scale.

---

## 1. CRITICAL — Performance: Revisions Sorted 6x Per Work Item

**Files:** `app/services/report_service.py`

Every enrichment function independently sorts and filters the same revision list:
- `_apply_inclusion()` — sorts + filters nulls
- `_compute_role_assignments()` — sorts + filters nulls
- `_compute_status_timeline()` — sorts + filters nulls
- `_compute_bounces()` — sorts + filters nulls
- `_compute_boundary_statuses()` — sorts + filters nulls
- `_compute_lifecycle_dates()` — sorts + filters nulls

For a team with 300 deliverables averaging 15 revisions each, that's **300 x 6 = 1,800 sort operations** per report.

**Fix:** Sort once in `run_report()` after fetching, pass the pre-sorted list everywhere:

```python
def _prepare_revisions(revisions: list[dict]) -> list[dict]:
    """Sort revisions by date, filtering out entries with no parseable date."""
    return sorted(
        (r for r in revisions if _parse_revision_date(r) is not None),
        key=lambda r: _parse_revision_date(r) or _MIN_DT,
    )
```

Call it once in the enrichment loop and pass to all functions. Each function drops its own sorting block.

---

## 2. CRITICAL — Performance: Child Collection Is Sequential

**File:** `app/services/report_service.py` lines 714-716

Parent resolution was correctly parallelized with `asyncio.gather()` (line 695), but child collection is awaited sequentially inside the `for wi in work_items` loop:

```python
for wi in work_items:
    ...
    child_bugs, child_tasks = await _collect_children(...)  # sequential!
```

For 200 work items, this makes up to 200 sequential batch HTTP requests for children.

**Fix:** Parallelize like parents:

```python
async def _collect_with_sem(wi: dict) -> tuple[list[WorkItemRef], list[WorkItemRef]]:
    async with child_semaphore:
        return await _collect_children(client, team.project, wi, by_id, team, wi_cache)

children_results = await asyncio.gather(*[_collect_with_sem(wi) for wi in work_items])
children_by_id = {wi.get("id"): result for wi, result in zip(work_items, children_results)}
```

**Caveat:** `_collect_children` mutates `all_work_items_by_id` dict (see issue #10 below). Must resolve that first to avoid race conditions.

---

## 3. CRITICAL — Performance: WIQL Has No Date Filter

**File:** `app/adapters/azure_devops.py` lines 85-89

The WIQL query fetches **ALL** work items matching area paths and types with no date constraint:

```sql
SELECT [System.Id] FROM WorkItems
WHERE [System.TeamProject] = @project
AND (...area conditions...)
AND [System.WorkItemType] IN ('User Story', 'Issue', 'Task')
```

For a mature team with 10,000 historical items, we fetch revisions for all 10,000 even if querying a 2-week sprint. The inclusion filter then discards 9,800+ of them.

**Fix:** Add a date pre-filter. Since `System.ChangedDate` may not perfectly cover spanning items, use a generous buffer:

```python
async def wiql_query(
    self,
    project: str,
    area_paths: list[str],
    deliverable_types: list[str],
    *,
    changed_since: date | None = None,  # NEW
    top: int = 20000,
) -> list[int]:
    ...
    wiql = (
        f"SELECT [System.Id] FROM WorkItems "
        f"WHERE [System.TeamProject] = @project "
        f"AND ({area_conditions}) "
        f"AND [System.WorkItemType] IN ({types_clause})"
    )
    # Items active during the period were changed at some point before end_date
    # Use a generous lookback to catch spanning items
    if changed_since:
        wiql += f" AND [System.ChangedDate] >= '{changed_since.isoformat()}'"
```

In `run_report()`, pass `changed_since` as e.g. `start_date - timedelta(days=365)` to catch items that entered active status up to a year before the period. This dramatically reduces candidates for long-running teams.

---

## 4. HIGH — Duplicate Constant: ACTIVE_CANONICAL_SET

**File:** `app/services/report_service.py` lines 24 and 127

Two identical frozensets:
```python
ACTIVE_CANONICAL = frozenset({"Development Active", "QA Active"})       # line 24
ACTIVE_CANONICAL_SET = frozenset({"Development Active", "QA Active"})   # line 127
```

`ACTIVE_CANONICAL` is used in `_apply_inclusion()`, `ACTIVE_CANONICAL_SET` in `_compute_lifecycle_dates()`.

**Fix:** Delete `ACTIVE_CANONICAL_SET`, use `ACTIVE_CANONICAL` everywhere.

---

## 5. HIGH — Role Assignment Is Non-Deterministic

**File:** `app/services/report_service.py` lines 309-321

```python
if sorted_revs:
    last_rev = sorted_revs[-1]
    ...
    now = datetime.now(timezone.utc)
    duration = (now - t_last).total_seconds()
    time_by_role[role][person] = ...
```

The "last revision to now" window means role assignments change every second. A report generated Monday gives different `developer` values than the same report Tuesday. This also makes the function untestable without time mocking.

**Fix:** Either (a) remove the "now" extension and only use inter-revision intervals, or (b) accept an `as_of: datetime` parameter defaulting to `datetime.now(tz=timezone.utc)` for testability, or (c) use `end_dt` from the report period as the upper bound.

Option (c) is recommended — use the period end date as the cutoff:

```python
def _compute_role_assignments(
    revisions: list[dict],
    real_to_canonical: dict[str, str],
    end_dt: datetime | None = None,  # NEW: upper bound for time accumulation
) -> tuple[str | None, str | None, str | None]:
```

---

## 6. HIGH — Health Check Accesses Private Members

**File:** `app/main.py` lines 112-120

```python
r = await client._client.get(
    f"{client._base}/_apis/projects",
    ...
    auth=client._auth,
    headers=client._headers(),
)
```

Reaches into `_client`, `_base`, `_auth` — all underscore-prefixed (private).

**Fix:** Add a public method to `AzureDevOpsClient`:

```python
async def health_check(self) -> bool:
    """Verify connectivity to Azure DevOps."""
    url = f"{self._base}/_apis/projects"
    r = await self._client.get(
        url, params={"api-version": "7.1", "$top": "1"},
        auth=self._auth, headers=self._headers(),
    )
    r.raise_for_status()
    return True
```

---

## 7. HIGH — `_collect_children` Mutates Shared Dict

**File:** `app/services/report_service.py` lines 583-591

```python
missing_ids = [cid for cid in child_ids if cid not in all_work_items_by_id]
if missing_ids:
    fetched = await client.get_work_items_batch(project, missing_ids, expand="None")
    for wi in fetched:
        wid = wi.get("id")
        if wid:
            all_work_items_by_id[wid] = wi  # MUTATION
```

The `by_id` dict from `run_report()` is passed to every `_collect_children` call and mutated. Currently this works because children are collected sequentially. But if parallelized (fix #2), concurrent mutations to the same dict would cause race conditions.

**Fix:** Either (a) make `_collect_children` return the fetched items separately and merge in the caller, or (b) use a thread-safe structure, or (c) pre-fetch all child IDs in a single batch before the enrichment loop.

Option (c) is cleanest — collect all child IDs from all work items' relations, batch-fetch the missing ones once, then run `_collect_children` as a pure classification step.

---

## 8. MEDIUM — Cache Has No TTL

**File:** `app/cache.py`

Both `ReportCache` and `WorkItemCache` use LRU eviction only. A report cached 30 days ago stays valid until evicted by size pressure.

**Fix:** Add optional TTL:

```python
def __init__(self, maxsize: int = 256, ttl_seconds: float | None = None):
    self._ttl = ttl_seconds

def get(self, team_id, start_date, end_date):
    entry = self._store.get(key)
    if entry is None:
        return None
    ts, response = entry
    if self._ttl and (time.monotonic() - ts) > self._ttl:
        del self._store[key]
        return None  # expired
    ...
```

Add `REPORT_CACHE_TTL` and `WI_CACHE_TTL` to settings.

---

## 9. MEDIUM — Batch API Chunks Are Sequential

**File:** `app/adapters/azure_devops.py` lines 171-185

```python
for i in range(0, len(ids), chunk):
    batch = ids[i : i + chunk]
    ...
    result.extend(data.get("value") or [])
```

When fetching >200 items, chunks are processed sequentially.

**Fix:**

```python
async def get_work_items_batch(self, project, ids, *, expand="Relations"):
    if not ids:
        return []
    chunks = [ids[i:i+200] for i in range(0, len(ids), 200)]
    responses = await asyncio.gather(*[self._fetch_chunk(project, c, expand) for c in chunks])
    return [wi for batch in responses for wi in batch]
```

---

## 10. MEDIUM — Limiter Instances Are Duplicated

**Files:** `app/main.py` line 82, `app/api/teams.py` line 37, `app/api/dashboard.py` line 36

Three separate `Limiter` instances exist. `main.py` creates one and attaches it to `app.state`, but the routers create their own. This means rate limits are tracked independently per limiter (3 separate counters).

**Fix:** Create one limiter, share it via import or dependency injection:

```python
# app/rate_limit.py
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])
```

Import this single instance everywhere.

---

## 11. MEDIUM — Metric Sets Defined Twice

**Files:** `app/api/teams.py` lines 46-55, `app/services/kpi_service.py` lines 183-200

Both files define the same metric frozensets. If a new metric is added, both must be updated.

**Fix:** Define once in `kpi_service.py` (the service owns the domain logic), import in the router.

---

## 12. MEDIUM — `_compute_tags` Has Unused `revisions` Parameter

**File:** `app/services/report_service.py` line 418

```python
def _compute_tags(
    revisions: list[dict],  # UNUSED
    real_to_canonical: dict[str, str],
    child_bug_ids: list[int],
    status_at_start: str | None,
    bounce_count: int,
) -> tuple[bool, bool, list[str]]:
```

The `revisions` parameter is never referenced in the function body. Dead parameter.

**Fix:** Remove it, update callers.

---

## 13. MEDIUM — Azure DevOps Field Selection

**File:** `app/adapters/azure_devops.py`

Neither `get_work_items_batch` nor `get_revisions` use field selection. Each work item response includes **all** fields (description, history, custom fields, etc.), often 5-10KB per item.

**Fix:** Add `fields` parameter to batch API:

```python
async def get_work_items_batch(self, project, ids, *, expand="Relations", fields=None):
    body = {"ids": batch, "$expand": expand}
    if fields:
        body["fields"] = fields
```

In `run_report`, request only needed fields:
```python
_NEEDED_FIELDS = [
    "System.Id", "System.Title", "System.State",
    "System.WorkItemType", "System.Description", "System.AreaPath",
]
work_items = await client.get_work_items_batch(
    team.project, included_ids, fields=_NEEDED_FIELDS
)
```

This can reduce response payload by 60-80%.

---

## 14. MEDIUM — `_min_dt` Sentinel Repeated Everywhere

**File:** `app/services/report_service.py`

`_min_dt = datetime(1970, 1, 1, tzinfo=timezone.utc)` is defined locally in 6 functions.

**Fix:** Module-level constant:

```python
_MIN_DT = datetime(1970, 1, 1, tzinfo=timezone.utc)
```

---

## 15. LOW — WIQL String Interpolation for Types

**File:** `app/adapters/azure_devops.py` line 84

```python
types_clause = ",".join(f"'{t}'" for t in deliverable_types)
```

No escaping on type names. If a type contained a single quote, it would break the WIQL.

**Fix:** Apply the same escaping as area paths:

```python
types_clause = ",".join(
    f"'{t.replace(chr(39), chr(39) + chr(39))}'" for t in deliverable_types
)
```

---

## 16. LOW — Missing Type Annotations

| Location | Issue |
|---|---|
| `app/api/cache.py:17` | `_get_caches` lacks return type |
| `app/api/teams.py:58` | `_compute_single_kpi` lacks return type |
| `app/api/dashboard.py:62` | `kpis: list = []` should be `list[KPIResult]` |
| `app/api/teams.py:116` | `kpis: list = []` should be `list[KPIResult]` |

---

## 17. LOW — Config YAML Duplication

**File:** `app/config/teams.yaml`

4 of 5 teams share identical state mappings. Only payment-services differs.

**Fix (optional):** Use YAML anchors:

```yaml
_default_states: &default_states
  - canonical_status: "Development Active"
    real_states: ["Active", "Onhold", "Blocked", "Code Review"]
  ...

teams:
  game-services:
    states: *default_states
  payment-services:
    states:
      - canonical_status: "Development Active"
        real_states: ["Active", "Onhold", "Blocked", "Code Review", "Resolved"]
      ...
```

---

## 18. LOW — `expand="None"` String vs Omission

**File:** `app/services/report_service.py` line 585

```python
fetched = await client.get_work_items_batch(project, missing_ids, expand="None")
```

Passes the literal string `"None"` to Azure DevOps as `$expand=None`. Verify Azure DevOps API interprets this as "no expansion" rather than an error. The SDK typically uses `WorkItemExpand.None` (enum value 0). The REST API may or may not accept the string "None".

**Fix:** Either verify via Azure DevOps REST API docs that `$expand=None` is valid, or omit the parameter entirely by adding support for `expand=None` (Python None) in the client.

---

## 19. LOW — `team_metrics.egg-info/SOURCES.txt` Stale

References deleted files (`app/api/report.py`, `app/config/loader.py`).

**Fix:** `pip install -e .` to regenerate, or add `team_metrics.egg-info/` to `.gitignore`.

---

## Architecture & Naming: What's Good

1. **Layer separation is clean** — adapters, services, schemas, api, config are properly isolated
2. **Naming is consistent** — `compute_*` for pure functions, `get_*` for fetchers, `_` prefix for internal functions
3. **Schema naming is excellent** — `DeliverableRow`, `WorkItemRef`, `BounceDetail`, `StatusTimelineEntry` are self-documenting
4. **Config-driven** — canonical status mapping, KPI thresholds, team structure all externalized to YAML
5. **Pydantic v2 used correctly** — `BaseModel`, `BaseSettings`, `Field` with descriptions, discriminated unions for KPI polymorphism
6. **Error handling is consistent** — `ErrorResponse` model, exception handlers in main.py, `_ERROR_RESPONSES` dict on routers
7. **Test organization mirrors source** — test files map 1:1 to source modules

---

## Summary of Recommended Changes

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| CRITICAL | Sort revisions once, not 6x | Small | ~6x speedup on enrichment |
| CRITICAL | Parallelize child collection | Medium | ~Nx speedup for large teams |
| CRITICAL | Add date filter to WIQL | Small | 10-100x fewer API calls |
| HIGH | Remove duplicate ACTIVE_CANONICAL_SET | Trivial | Code hygiene |
| HIGH | Fix non-deterministic role assignment | Small | Correctness + testability |
| HIGH | Health check via public method | Small | Encapsulation |
| HIGH | Fix `_collect_children` mutation | Medium | Required for parallelization |
| MEDIUM | Add cache TTL | Medium | Data freshness |
| MEDIUM | Parallelize batch chunks | Small | ~2-3x for large fetches |
| MEDIUM | Single rate limiter instance | Small | Correct rate limiting |
| MEDIUM | Single source of truth for metrics | Small | Maintainability |
| MEDIUM | Remove dead `revisions` param | Trivial | Code hygiene |
| MEDIUM | Add field selection to batch API | Small | 60-80% payload reduction |
| MEDIUM | Module-level _MIN_DT constant | Trivial | DRY |
| LOW | Escape types in WIQL | Trivial | Defense in depth |
| LOW | Add missing type annotations | Small | Type safety |
| LOW | YAML anchors for state mappings | Small | DRY config |
| LOW | Verify expand="None" behavior | Trivial | Correctness |
| LOW | Regenerate egg-info | Trivial | Build hygiene |
