# Architecture Review v2: Team Metrics

**Date**: 2026-03-12
**Scope**: Full-stack (FastAPI backend + React frontend) — architecture, maintainability, readability, mobile, accessibility

---

## Priority Matrix

| Priority | Category | Count |
|----------|----------|-------|
| **P0 — Critical** | Bugs, correctness, security | 4 |
| **P1 — High** | Architecture, DRY, mobile gaps | 10 |
| **P2 — Medium** | Readability, consistency, accessibility | 12 |
| **P3 — Low** | Polish, dead code, style | 8 |

---

## P0 — CRITICAL (Bugs & Correctness)

### B1. `assert` in production code path
**File**: `app/services/dora_service.py:105`
**Problem**: `assert d.start_date is not None` will silently pass if Python runs with `-O` flag. `AssertionError` is not caught by the FastAPI exception handlers.
**Fix**: Replace with guard clause or keep the filtering from lines 94–99 which already ensures both dates exist.

### B2. Hardcoded team fallback in Topbar search
**File**: `frontend/src/components/layout/Topbar.jsx:51`
**Problem**: `const searchTeam = teamId || 'game-services'` — search silently queries wrong team when on non-team pages (`/performance`, `/developers`, etc.).
**Fix**: Disable search on non-team pages or use a fleet-level search API.

### B3. `responsive-two-col` class not defined
**File**: `frontend/src/pages/WorkItemDetailPage.jsx`
**Problem**: `className="responsive-two-col"` is set but this class does not exist in `tokens.css`. The layout relies on inline flexbox styles instead, so this class has no effect.
**Fix**: Either define the class in `tokens.css` or remove the className.

### B4. Type annotation mismatch in `_apply_inclusion`
**File**: `app/services/report_service.py:231`
**Problem**: `revisions_in_period: list[dict]` but tuples are appended: `.append((rev, prev_state))`. Mypy would flag this.
**Fix**: Change annotation to `list[tuple[dict, str | None]]`.

---

## P1 — HIGH (Architecture & DRY)

### A1. ~120 lines duplicated between `run_report` and `fetch_single_work_item`
**File**: `app/services/report_service.py:696-781` vs `801-920`
**Problem**: Both build a `DeliverableRow` from the same set of helper calls (revisions, parents, children, lifecycle, bounces, tags, etc.). Nearly identical logic.
**Fix**: Extract `_build_deliverable_row(wi, revs, parents, children, team_cfg, start, end)` → `DeliverableRow` and call from both places.

### A2. `snapshot_service.py` imports private helpers from `kpi_service.py`
**Files**: `app/services/snapshot_service.py:12-13`
**Problem**: `from app.services.kpi_service import _has_rework_tags, _reached_qa` — cross-module private coupling. Breaks if `kpi_service` renames these internals.
**Fix**: Move `_reached_qa` and `_has_rework_tags` to `services/common.py`.

### A3. `teams.py` is 836 lines — god router
**File**: `app/api/teams.py`
**Problem**: Handles KPIs, DORA, work items, snapshots, drilldowns — all in one file.
**Fix**: Split DORA routes (~300 lines) into `app/api/dora.py` as a sub-router.

### A4. `search_work_items` fetches items sequentially
**File**: `app/services/report_service.py:963-969`
**Problem**: `for wid in candidate_ids[:limit]: item = await fetch_single_work_item(...)` — sequential awaits for up to 15 items.
**Fix**: Use `asyncio.gather(*[fetch_single_work_item(...) for wid in candidate_ids[:limit]])`.

### A5. Extract duplicated `FlagPill` component
**Files**: `frontend/src/pages/WorkItemsPage.jsx:353` and `WorkItemDetailPage.jsx:372`
**Problem**: Identical component defined in two files.
**Fix**: Move to `components/shared/FlagPill.jsx`.

### A6. Extract shared analysis sub-components
**Files**: `PerformanceAnalysisPage`, `DeveloperAnalysisPage`, `CrossPerformancePage`, `CrossPersonAnalysisPage`
**Problem**: `TrendArrow`, `ModeTab`, `PillSelector`, `Divider` are defined inline in 3-4 pages.
**Fix**: Move to `components/shared/` or `components/analysis/`.

### A7. Centralize page title derivation
**Files**: `Topbar.jsx` and `Sidebar.jsx`
**Problem**: Both independently switch on `location.pathname` to derive the page title/active state.
**Fix**: Extract to a `usePageTitle()` hook or `PAGE_TITLES` constant map.

### A8. Merge duplicate `useWorkItems` calls in TeamPage
**File**: `frontend/src/pages/TeamPage.jsx`
**Problem**: Two separate `useWorkItems` calls: `limit=6` (preview) and `limit=500` (full list). Fires two API requests for the same team/period.
**Fix**: Fetch 500 once, derive the preview by slicing: `items.slice(0, 6)`.

### A9. `FlagPill` / `ChildItemRow` missing keyboard support
**Files**: `WorkItemDetailPage.jsx`, `WorkItemsPage.jsx`
**Problem**: `ChildItemRow` has `onClick` but no `role="button"`, `tabIndex`, or `onKeyDown`. Same issue in `FlagPill`, `DeveloperCard`, `OverviewPage` team cards.
**Fix**: Add `role="button"`, `tabIndex={0}`, `onKeyDown` with Enter/Space handlers consistently.

### A10. Mobile responsive gaps in page content
**Files**: Various pages
**Problem**:
- `WorkItemsPage` uses `padding: 32` inline — not responsive on small screens
- `WorkItemDetailPage` right column hardcoded `width: 280`
- Analysis pages have fixed `minWidth` sticky columns that overflow
- Topbar search and team-btn hidden at 480px with no alternative provided
**Fix**: Replace hardcoded padding/widths with responsive CSS classes. Add `@media` rules for analysis page tables.

---

## P2 — MEDIUM (Readability, Consistency, Accessibility)

### M1. `get_board_wip_limits` bypasses circuit breaker
**File**: `app/adapters/azure_devops.py:458`
**Problem**: Only Azure method without `@_with_circuit_breaker` or `@_azure_retry`. Still fires calls when Azure is fully down.
**Fix**: Add `@_with_circuit_breaker` decorator.

### M2. Dead code: `ConfigurationError` never raised
**File**: `app/exceptions.py`
**Fix**: Either use it in config loaders (wrap Pydantic `ValidationError`) or remove it.

### M3. Dead code: `get_report_cache` never called
**File**: `app/api/helpers.py:225-229`
**Fix**: Remove the unused function.

### M4. Dead code: `PageShell.jsx` is a pass-through wrapper
**File**: `frontend/src/components/layout/PageShell.jsx`
**Fix**: Remove file and any imports.

### M5. `DEFAULT_*` cache constants duplicate `settings.py` values
**File**: `app/cache.py:16-23`
**Problem**: Two sources of truth for cache defaults.
**Fix**: Remove defaults from `cache.py`; always pass explicit values from settings at construction time.

### M6. Config loaders called inline instead of injected
**Files**: `app/api/dashboard.py`, `app/api/teams.py`
**Problem**: `load_kpi_config()` / `load_dora_config()` called repeatedly inside handlers. They're `lru_cache`d so cost is minimal, but architecturally inconsistent with startup eager loading.
**Fix**: Store loaded configs on `app.state` during lifespan; inject via `Depends`.

### M7. Missing `<label>` elements on form inputs
**Files**: `WorkItemsPage.jsx` filter bar, `Topbar.jsx` date picker
**Problem**: All inputs use placeholder text only — screen readers cannot identify them.
**Fix**: Add `<label htmlFor="...">` or `aria-label` attributes.

### M8. No accessible chart alternatives
**Files**: All chart components
**Problem**: Recharts SVGs have no `aria-label`, `<title>`, or `<desc>`. `HealthStrip` colored segments have no text labels.
**Fix**: Add `aria-label` to `ResponsiveContainer` wrappers describing the chart's data.

### M9. No `focus-visible` styles
**File**: `frontend/src/theme/tokens.css`
**Problem**: Tab navigation shows browser defaults or nothing.
**Fix**: Add `*:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`.

### M10. No "skip to main content" link
**File**: `frontend/src/App.jsx`
**Problem**: Keyboard users must tab through entire sidebar on every page load.
**Fix**: Add visually-hidden skip link at top of layout.

### M11. Magic color values outside design token system
**Files**: Various pages
**Problem**: `#13101a` (bug panel bg), `#ef444430` (border), `#a78bfa`, `#60a5fa` appear as hardcoded values.
**Fix**: Define as CSS variables in `tokens.css`.

### M12. `_cache_key_hash` uses MD5 without `usedforsecurity=False`
**File**: `app/adapters/azure_devops.py:58`
**Fix**: `hashlib.md5(payload.encode(), usedforsecurity=False)` for FIPS compatibility.

---

## P3 — LOW (Polish & Style)

### L1. Import organization — `limiter` imported mid-file
**Files**: `app/api/dashboard.py`, `app/api/teams.py`
**Fix**: Move `from app.rate_limit import limiter` to top of file (PEP 8).

### L2. `_compute_single_kpi` long if/elif chain
**File**: `app/api/teams.py`
**Fix**: Refactor to `match`/`case` (Python 3.10+) or dispatch dict.

### L3. Threshold strings recomputed on every KPI call
**Files**: `app/services/kpi_service.py`
**Fix**: Compute once as cached property on config models.

### L4. `DeliverableRow` has 30+ flat fields
**File**: `app/schemas/report.py`
**Fix**: Group into nested models: `LifecycleInfo`, `RoleAssignment`, `ClassificationFlags`.

### L5. `area_paths` naming semantically inverted
**File**: `app/config/team_loader.py`
**Problem**: `area_paths` are exclusions, not inclusions, despite the name suggesting the opposite.
**Fix**: Rename to `excluded_area_paths`.

### L6. Non-functional settings button in Topbar
**File**: `frontend/src/components/layout/Topbar.jsx:150`
**Problem**: Static `⚙` character with no click handler — renders as a non-functional button.
**Fix**: Remove or implement settings functionality.

### L7. `aggregateByDeveloper` implemented in two places
**Files**: `useDeveloperAnalysis.js` and `DeveloperSummary.jsx`
**Problem**: Two implementations with different field sets. Intentional but creates maintenance burden.
**Fix**: Merge into a single function or explicitly name them differently (`aggregateDevMetrics` vs `aggregateDevSummary`).

### L8. `compute_flow_hygiene` is O(days × items × states)
**File**: `app/services/kpi_service.py`
**Problem**: For 90 days × 200 items × 2 states = 36K timeline scans.
**Fix**: Pre-build `{item_id: {day: state}}` index from timeline, then query by day.

---

## MOBILE-SPECIFIC FINDINGS

### Current Mobile Support (What's Working)

| Feature | Status |
|---------|--------|
| Off-canvas sidebar drawer | Working (CSS transform + `.mobile-open`) |
| Hamburger toggle in Topbar | Working (`isMobile` prop) |
| Backdrop overlay | Working (`.sidebar-overlay.visible`) |
| Grid collapse to 1-col at 768px | Working |
| iOS safe-area insets | Working (`env(safe-area-inset-*)`) |
| Touch targets (44px min) | Working for nav buttons |
| Date inputs enlarged for touch | Working |
| `.tbl-scroll-wrap` horizontal scroll | Working for tables |

### Mobile Gaps to Fix

| Issue | Location | Fix |
|-------|----------|-----|
| Hardcoded `padding: 32` on pages | WorkItemsPage, others | Use responsive CSS class |
| Hardcoded `width: 280` detail sidebar | WorkItemDetailPage | Use `min-width` + `flex-basis` |
| Analysis page tables overflow | CrossPerformancePage, etc. | Add horizontal scroll wrapper |
| Search hidden at 480px, no alternative | Topbar | Add search to mobile menu or show icon |
| No mobile-specific card stacking | DeveloperAnalysisPage | Cards already use `auto-fill` — OK |
| Mobile focus management | Sidebar drawer | Move focus to first menu item on open |
| Touch scroll on charts | All chart components | Recharts handles this — OK |
| No pull-to-refresh | All pages | Consider adding for mobile UX |

---

## IMPLEMENTATION ORDER (Recommended)

**Phase 1 — Correctness** (P0: B1-B4)
Fix production bugs and type errors.

**Phase 2 — DRY & Architecture** (P1: A1-A4)
Backend deduplication and performance.

**Phase 3 — Frontend DRY** (P1: A5-A8)
Extract shared components and merge queries.

**Phase 4 — Mobile & Accessibility** (P1: A9-A10, P2: M7-M10)
Keyboard support, ARIA, responsive gaps, focus management.

**Phase 5 — Cleanup** (P2: M1-M6, M11-M12)
Dead code, consistency, design tokens.

**Phase 6 — Polish** (P3: L1-L8)
Code style, naming, optimization.
