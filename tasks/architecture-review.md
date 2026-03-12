# Architecture Review: Team Metrics

**Date**: 2026-03-11
**Scope**: Full-stack (FastAPI backend + React frontend)

---

## BACKEND IMPROVEMENTS

### 1. Architecture & Separation of Concerns

#### 1.1 `app/api/teams.py` is a God Router (~837 lines)
**Problem**: This single router handles KPIs, DORA drilldowns, delivery snapshots, and work items — all with inline business logic for filtering, mapping, and response construction.

**Recommendation**: Split into focused routers:
```
app/api/
├── teams/
│   ├── __init__.py          # Re-exports combined router
│   ├── kpis.py              # /teams/{id}/kpis endpoints
│   ├── dora.py              # /teams/{id}/dora endpoints
│   ├── work_items.py        # /teams/{id}/work-items endpoints
│   └── delivery_snapshot.py # /teams/{id}/delivery-snapshot endpoints
```

Each sub-router should only call services and map responses — no inline computation.

#### 1.2 Business Logic Leaking into Routers
**Problem**: `teams.py` contains filtering logic (e.g., filtering deliverables by metric in drilldown endpoints) that belongs in the service layer. Lines like:
```python
filtered = [d for d in deliverables if d.is_spillover or ...]
```
These transformations should live in service functions.

**Recommendation**: Move all filtering/mapping into `kpi_service.py` and `dora_service.py`. Routers become thin orchestrators: validate input → call service → return response.

#### 1.3 `report_service.py` Does Too Much (~971 lines)
**Problem**: Single module handles WIQL queries, revision fetching, work item enrichment, hierarchy resolution, status timeline extraction, role assignment, tag classification, and caching orchestration.

**Recommendation**: Extract into focused modules:
```
app/services/
├── report_service.py        # Orchestration only (run_report)
├── enrichment/
│   ├── hierarchy.py         # Parent/child resolution
│   ├── timeline.py          # Status timeline & bounces
│   ├── roles.py             # Developer/QA/RM assignment
│   └── tags.py              # Rework, spillover, tech debt classification
```

#### 1.4 Missing Dependency Injection Pattern
**Problem**: Services access `app.state` directly through request objects or global state. This makes testing harder and couples services to FastAPI.

**Recommendation**: Define a `Dependencies` protocol/dataclass:
```python
@dataclass
class AppDependencies:
    azure_client: AzureDevOpsClient
    report_cache: ReportCache
    wi_cache: WorkItemCache
    deployment_cache: DeploymentCache
    teams_config: dict
    kpi_config: KpiConfig
```
Inject via FastAPI `Depends()` — services accept dependencies as parameters rather than reaching into `request.app.state`.

---

### 2. Code Organization & Module Sizes

#### 2.1 `kpi_service.py` (~813 lines) Needs Decomposition
**Problem**: All 7 KPI computations live in one file. Adding a new KPI means modifying this monolith.

**Recommendation**: Use a strategy pattern:
```
app/services/kpis/
├── __init__.py              # Registry + compute_all_kpis()
├── base.py                  # Abstract KPI protocol
├── rework_rate.py
├── delivery_predictability.py
├── flow_hygiene.py
├── wip_discipline.py
├── tech_debt_ratio.py
├── initiative_delivery.py
└── reliability_action_delivery.py
```

Each KPI implements a `compute(deliverables, config, start, end) -> KPIResult` interface. New KPIs = new file, zero changes to existing code. Open/Closed Principle.

#### 2.2 `azure_devops.py` Adapter is 912 Lines
**Problem**: Mixes HTTP client concerns, retry logic, caching, and Azure API specifics.

**Recommendation**: Extract:
- `app/adapters/http_client.py` — Retry, backoff, circuit breaker (reusable for any API)
- `app/adapters/azure_devops.py` — Azure-specific API methods only

---

### 3. Error Handling

#### 3.1 No Custom Exception Hierarchy
**Problem**: Services raise generic `ValueError` or let `httpx` errors propagate. The global exception handler only catches `httpx.HTTPStatusError`.

**Recommendation**: Create a domain exception hierarchy:
```python
# app/exceptions.py
class TeamMetricsError(Exception): ...
class TeamNotFoundError(TeamMetricsError): ...
class AzureDevOpsError(TeamMetricsError): ...
class ConfigurationError(TeamMetricsError): ...
class ReportTimeoutError(TeamMetricsError): ...
```
Register handlers in `main.py` per exception type. Services raise domain exceptions — routers never handle raw errors.

#### 3.2 Silent Failures in Enrichment
**Problem**: In `report_service.py`, parent resolution and enrichment use broad `try/except` blocks that log warnings but continue silently. This can produce subtly wrong KPI data.

**Recommendation**: Track enrichment failures per-item and include them in the response as `enrichment_warnings: list[str]`. Log at WARNING level. Optionally expose a `strict=true` query param that fails the request on enrichment errors.

---

### 4. Type Safety & Validation

#### 4.1 Inconsistent Use of Pydantic Models
**Problem**: Some internal data flows use plain dicts (e.g., raw Azure API responses, deployment data), while others use Pydantic models. The boundary between validated and unvalidated data is unclear.

**Recommendation**:
- Define Pydantic models for ALL data boundaries (Azure API responses, config files, internal DTOs)
- Use `TypeAdapter` for validating raw dicts at the adapter boundary
- Internal functions should accept and return typed models, not dicts

#### 4.2 Settings Validation
**Problem**: `settings.py` uses `pydantic-settings` but has minimal validation (no field constraints).

**Recommendation**: Add validators:
```python
class Settings(BaseSettings):
    http_timeout: float = Field(60.0, gt=0, le=600)
    http_pool_size: int = Field(20, gt=0, le=100)
    report_cache_max: int = Field(256, gt=0, le=10000)
    # etc.
```

#### 4.3 Date Parameters Not Validated at Schema Level
**Problem**: Date validation happens in `helpers.py` as a utility function called from routers. If a router forgets to call it, invalid dates pass through.

**Recommendation**: Create a Pydantic model for date range queries:
```python
class DateRangeQuery(BaseModel):
    start_date: date
    end_date: date

    @model_validator(mode='after')
    def validate_range(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be >= start_date")
        if (self.end_date - self.start_date).days > 365:
            raise ValueError("Range exceeds 365 days")
        return self
```
Use as `Depends()` in all endpoints.

---

### 5. Testing

#### 5.1 No Integration Tests Against Real-ish Data
**Problem**: `test_endpoints.py` mocks everything. There's no test that validates the full pipeline (WIQL → enrichment → KPI computation) with realistic fixture data.

**Recommendation**: Add integration tests with a fixture file (`tests/fixtures/azure_responses.json`) containing realistic Azure DevOps responses. Mock only the HTTP client, not the services.

#### 5.2 Test Fixtures Are Scattered
**Problem**: Each test file builds its own test data inline. `test_kpi_service.py` has helper functions like `_deliverable()` duplicated across files.

**Recommendation**: Create a shared fixtures module:
```
tests/
├── fixtures/
│   ├── __init__.py
│   ├── deliverables.py    # Factory functions
│   ├── azure_responses.py # Raw API response fixtures
│   └── configs.py         # Test configurations
```

#### 5.3 Missing Edge Case Coverage
**Problem**: No tests for:
- Concurrent cache access (race conditions)
- Large dataset performance (> 1000 items)
- Malformed Azure API responses
- Network timeout scenarios

**Recommendation**: Add targeted tests for these scenarios. Use `pytest-benchmark` for performance tests.

#### 5.4 No Frontend Tests
**Problem**: Zero test files in `frontend/`. No unit tests, no component tests, no E2E tests.

**Recommendation**: Add at minimum:
- **Vitest** for unit tests (formatters, constants, hooks)
- **React Testing Library** for component tests (KpiChip, WorkItemRow, forms)
- **Playwright** for critical path E2E (dashboard loads, team navigation, date picker)

---

### 6. Configuration Management

#### 6.1 Config Loaders Reload From Disk Every Call
**Problem**: `load_teams_config()`, `load_kpi_config()`, `load_dora_config()` each use `@lru_cache` which caches forever but doesn't support hot-reload or invalidation.

**Recommendation**: Load configs once at startup into `app.state`. Pass as dependency to services. Add a `POST /admin/reload-config` endpoint (admin-only) for hot-reload without restart.

#### 6.2 YAML Configs Have No Schema Validation
**Problem**: YAML files are parsed into dicts and accessed with `.get()` calls. Typos in config keys silently produce wrong behavior.

**Recommendation**: Define Pydantic models for each config file and validate on load:
```python
class TeamConfig(BaseModel):
    project: str
    azure_team: str
    area_paths: list[str] = []
    deliverable_types: list[str]
    states: dict[str, list[str]]
    # etc.
```

---

### 7. Performance & Caching

#### 7.1 In-Memory Cache Doesn't Survive Restarts
**Problem**: All 4 cache layers are in-memory with `OrderedDict + Lock`. Every restart means cold start with potential thundering herd on popular endpoints.

**Recommendation**:
- Short-term: Add cache warming on startup for frequently-accessed teams
- Medium-term: Consider Redis for L1/L3 caches (reports and deployments) to survive restarts
- Add `stale-while-revalidate` pattern: serve stale data while refreshing in background

#### 7.2 No Cache Key Normalization
**Problem**: Cache keys include raw date strings. Different date formats for the same date would produce cache misses.

**Recommendation**: Normalize cache keys to `(team_id, start_date.isoformat(), end_date.isoformat())`.

#### 7.3 Thread-Safety Concern
**Problem**: `cache.py` uses `threading.Lock` but the app is async. Under high concurrency, this blocks the event loop.

**Recommendation**: Replace `threading.Lock` with `asyncio.Lock` for async-safe caching, or use a proper async cache library.

---

### 8. API Design

#### 8.1 Inconsistent Response Envelope
**Problem**: Some endpoints return flat responses, others wrap in objects. The drilldown endpoints return different shapes depending on the KPI.

**Recommendation**: Standardize on a response envelope:
```json
{
  "data": { ... },
  "meta": {
    "team_id": "...",
    "period": { "start": "...", "end": "..." },
    "cached": true,
    "computed_at": "..."
  }
}
```

#### 8.2 No API Versioning
**Problem**: All endpoints are unversioned. Any breaking change breaks all clients.

**Recommendation**: Add version prefix: `/api/v1/teams/...`. Can coexist with future `/api/v2/`.

#### 8.3 Pagination Should Use Cursor-Based Pattern
**Problem**: `skip/limit` pagination is brittle with changing data (items can be skipped or duplicated).

**Recommendation**: For work items, consider cursor-based pagination using work item ID as cursor. Keep `skip/limit` as a backward-compatible alias.

---

### 9. Security

#### 9.1 API Key Auth is Optional and Weak
**Problem**: Single shared API key via env var. No per-user auth, no token rotation, no expiry.

**Recommendation**:
- Short-term: Make API key required in production (fail startup if `API_KEY` not set when `ENV=production`)
- Medium-term: Support multiple API keys with labels (for rotation)
- Long-term: Consider OAuth2/JWT for per-user auth

#### 9.2 No Input Sanitization on Team IDs
**Problem**: `team_id` path parameters are used directly in WIQL queries and config lookups without validation against the known team list.

**Recommendation**: Add a `valid_team_id` dependency that validates against loaded team configs:
```python
def valid_team_id(team_id: str = Path(...)):
    teams = load_teams_config()
    if team_id not in teams:
        raise HTTPException(404, f"Unknown team: {team_id}")
    return team_id
```

#### 9.3 CORS Allows All Origins by Default
**Problem**: `cors_origins or ["*"]` — if env var is not set, all origins are allowed.

**Recommendation**: Fail startup if `CORS_ORIGINS` is not set in production. Default to `["http://localhost:5173"]` in development only.

---

## FRONTEND IMPROVEMENTS

### 10. Component Architecture

#### 10.1 Pages Are Too Large and Contain Inline Components
**Problem**:
- `DoraHealthPage.jsx` (456 lines) defines `MiniStat`, `CrossTeamBenchmark`, `computeOverall`, `hexToRgba`, `levelCardStyle`, and `metricCardOuterStyle` inline
- `WorkItemDetailPage.jsx` (462 lines) defines 8+ helper components inline
- `TeamPage.jsx` (401 lines) defines `KpiHeroCard` and `SecHeader` inline

**Recommendation**: Extract local components into their own files:
```
components/
├── dora/
│   ├── MiniStat.jsx
│   ├── CrossTeamBenchmark.jsx
│   ├── MetricCard.jsx
│   └── OverallSummary.jsx
├── work-items/
│   ├── WorkItemHeader.jsx
│   ├── StatusTimeline.jsx
│   ├── HierarchyView.jsx
│   └── PersonPanel.jsx
├── team/
│   ├── KpiHeroCard.jsx
│   └── SectionHeader.jsx
```

#### 10.2 `PageShell.jsx` is a No-Op
**Problem**: `PageShell` renders `<>{children}</>` — it's a pass-through doing nothing.

**Recommendation**: Either remove it entirely, or give it a purpose (e.g., common page padding, error boundary wrapper, scroll-to-top on route change).

#### 10.3 No Error Boundaries
**Problem**: If any component throws during render, the entire app crashes. No `ErrorBoundary` at route or section level.

**Recommendation**: Add React Error Boundaries:
- Route-level: Wrap each `<Route>` element in an error boundary
- Section-level: Wrap data-dependent sections (charts, tables) individually

---

### 11. State Management

#### 11.1 Date Period State Should Sync with URL
**Problem**: `PeriodContext` stores dates in React state only. Refreshing the page resets to last-30-days. Links can't include date ranges. Different tabs can't have different periods.

**Recommendation**: Store `start_date` and `end_date` as URL search params:
```javascript
// Use react-router's useSearchParams
const [searchParams, setSearchParams] = useSearchParams();
const periodStart = searchParams.get('start') || defaultStart();
const periodEnd = searchParams.get('end') || defaultEnd();
```
This makes URLs shareable and bookmarkable.

#### 11.2 No Loading/Error State Composition
**Problem**: Every page independently handles `isLoading`, `isError`, `error` from TanStack Query hooks with ad-hoc patterns.

**Recommendation**: Create a `QueryGuard` component:
```jsx
function QueryGuard({ query, children }) {
  if (query.isLoading) return <Loader />;
  if (query.isError) return <ErrorBox message={query.error.message} />;
  return children(query.data);
}
```

---

### 12. API Layer

#### 12.1 No Request Cancellation
**Problem**: When navigating between pages, in-flight requests are not cancelled. Old responses can arrive after navigation, causing stale data flashes.

**Recommendation**: TanStack Query supports `AbortSignal` — pass it through:
```javascript
queryFn: ({ signal }) => api(url, { signal })
```

#### 12.2 URL Construction is Fragile
**Problem**: Query strings are built with template literals: `` `/teams/${teamId}/kpis/${kpiSlug}?start_date=${periodStart}&end_date=${periodEnd}` ``. No encoding, no parameter validation.

**Recommendation**: Create a URL builder:
```javascript
function buildUrl(path, params = {}) {
  const url = new URL(path, BASE_URL);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, String(v));
  });
  return url.toString();
}
```

#### 12.3 No Request Deduplication for Concurrent Mounts
**Problem**: If the dashboard and sidebar both trigger the same API call simultaneously, two requests fire.

**Recommendation**: TanStack Query handles this automatically via `queryKey` deduplication — this works if all hooks use the same query key structure. Audit that all hooks follow the same pattern consistently. Currently they do, so this is already well-handled.

---

### 13. Styling

#### 13.1 Mixed Styling Approaches
**Problem**: The codebase uses THREE styling approaches simultaneously:
1. CSS custom properties in `tokens.css` (543 lines of hand-written CSS)
2. Tailwind utility classes on some elements
3. Inline `style={{}}` objects in pages (especially `DoraHealthPage`, `WorkItemDetailPage`)

**Recommendation**: Consolidate to a single approach. Given Tailwind is already a dependency:
- Migrate `tokens.css` custom classes to Tailwind's `@apply` or component classes
- Replace inline `style={{}}` with Tailwind utilities or CSS modules
- Keep CSS custom properties for design tokens (colors, spacing) only

#### 13.2 Inline Styles Are Unmaintainable
**Problem**: `DoraHealthPage.jsx` has 50+ inline style objects like:
```jsx
style={{ background: `linear-gradient(135deg, ${hexToRgba(color, 0.08)}, ...)` }}
```
These can't be searched, reused, or overridden.

**Recommendation**: Extract computed styles into a `useDoraStyles(color)` hook or CSS-in-JS utility. Or use Tailwind's `style` attribute only for truly dynamic values (colors from data), with structural styles in utility classes.

---

### 14. Accessibility

#### 14.1 No ARIA Labels or Roles
**Problem**: Interactive elements (KPI chips, stat boxes, filter tabs) lack `role`, `aria-label`, `aria-selected`, and keyboard navigation support.

**Recommendation**:
- Add `role="button"` and `tabIndex={0}` to clickable divs
- Add `aria-label` to icon-only buttons
- Add `role="tablist"` / `role="tab"` to filter tabs
- Add `aria-live="polite"` to data regions that update

#### 14.2 Color-Only Status Indicators
**Problem**: RAG status (green/amber/red) is conveyed only through color. Color-blind users can't distinguish.

**Recommendation**: Add secondary indicators: icons (checkmark/warning/error), text labels, or patterns alongside colors.

#### 14.3 No Keyboard Navigation
**Problem**: Custom components (sidebar, dropdowns, filter chips) are mouse-only.

**Recommendation**: Add `onKeyDown` handlers for Enter/Space on clickable elements. Implement arrow-key navigation for lists and tabs.

---

### 15. Performance

#### 15.1 No Code Splitting
**Problem**: All pages and components are eagerly imported in `App.jsx`. The entire app bundle loads on first visit.

**Recommendation**: Use `React.lazy()` + `Suspense` for route-level code splitting:
```jsx
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
// etc.
```

#### 15.2 Large Re-renders on Period Change
**Problem**: Changing the date period triggers re-renders across the entire app tree since `PeriodContext` wraps everything.

**Recommendation**:
- Split context into `PeriodStateContext` (values) and `PeriodDispatchContext` (setter)
- Use `useMemo` on context value (already done)
- Consider moving period to URL params (see 11.1), which naturally limits re-renders

#### 15.3 Charts Re-render on Every Parent Render
**Problem**: Recharts components like `KpiDonutChart` and `DoraBarChart` re-render even when their data hasn't changed.

**Recommendation**: Wrap chart components in `React.memo()` and memoize data transformations with `useMemo`.

---

### 16. Code Organization

#### 16.1 No Barrel Exports
**Problem**: Import paths are long and scattered:
```javascript
import { useDashboard } from '../api/hooks/useDashboard';
import { useTeamKpis } from '../api/hooks/useTeamKpis';
import { fmt, kpiStatus, ragToStatus } from '../lib/formatters';
```

**Recommendation**: Add `index.js` barrel files:
```javascript
// api/hooks/index.js
export { useDashboard } from './useDashboard';
export { useTeamKpis } from './useTeamKpis';
// etc.
```

#### 16.2 No TypeScript
**Problem**: Entire frontend is plain JavaScript. No type checking for props, API responses, or state.

**Recommendation**:
- Short-term: Add JSDoc type annotations for key interfaces (API responses, component props)
- Medium-term: Migrate to TypeScript incrementally (rename `.jsx` → `.tsx`, add types for API layer first)

#### 16.3 `dangerouslySetInnerHTML` in WorkItemDetailPage
**Problem**: Work item descriptions are rendered with `dangerouslySetInnerHTML`. If Azure DevOps descriptions contain malicious HTML, this is an XSS vector.

**Recommendation**: Sanitize HTML before rendering using `DOMPurify`:
```javascript
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(description) }} />
```

---

## CROSS-CUTTING IMPROVEMENTS

### 17. Developer Experience

#### 17.1 No Linting/Formatting Consistency
**Problem**: Backend has `ruff` in dev deps but no pre-commit hooks. Frontend has `eslint` but it's unclear if it's enforced.

**Recommendation**: Add a `pre-commit` config with:
- Backend: `ruff check`, `ruff format`, `mypy`
- Frontend: `eslint --fix`, `prettier`
- Both: Enforce in CI pipeline

#### 17.2 No CI/CD Pipeline
**Problem**: No `.github/workflows/`, no `Dockerfile`, no deployment config.

**Recommendation**: Add:
- `Dockerfile` (multi-stage: Python backend + static frontend)
- `.github/workflows/ci.yml` (lint, test, build)
- `.github/workflows/deploy.yml` (deploy on merge to main)

#### 17.3 No OpenAPI Client Generation
**Problem**: Frontend API hooks manually construct URLs and don't validate response shapes.

**Recommendation**: Use FastAPI's auto-generated OpenAPI spec to generate a typed client:
- `openapi-typescript-codegen` or `orval` to generate typed API client from FastAPI's `/openapi.json`
- Eliminates URL construction, adds response type safety

---

## PRIORITY MATRIX

| Priority | Area | Impact | Effort |
|----------|------|--------|--------|
| **P0 - Critical** | XSS fix (dangerouslySetInnerHTML) | Security | Low |
| **P0 - Critical** | CORS origin restriction in production | Security | Low |
| **P0 - Critical** | Team ID validation against known teams | Security | Low |
| **P1 - High** | Split teams.py god router | Maintainability | Medium |
| **P1 - High** | Custom exception hierarchy | Reliability | Medium |
| **P1 - High** | Date range as URL params | UX | Medium |
| **P1 - High** | Route-level error boundaries | Reliability | Low |
| **P1 - High** | Code splitting with React.lazy | Performance | Low |
| **P2 - Medium** | Extract inline page components | Readability | Medium |
| **P2 - Medium** | KPI strategy pattern | Extensibility | High |
| **P2 - Medium** | Dependency injection cleanup | Testability | Medium |
| **P2 - Medium** | Consolidate styling approach | Maintainability | High |
| **P2 - Medium** | Add frontend tests (Vitest + RTL) | Quality | High |
| **P2 - Medium** | Shared test fixtures (backend) | Maintainability | Medium |
| **P2 - Medium** | asyncio.Lock for async cache | Correctness | Low |
| **P3 - Low** | API versioning | Future-proofing | Low |
| **P3 - Low** | TypeScript migration | Type Safety | High |
| **P3 - Low** | OpenAPI client generation | DX | Medium |
| **P3 - Low** | Redis for cache persistence | Performance | High |
| **P3 - Low** | Barrel exports | DX | Low |
| **P3 - Low** | CI/CD pipeline | DevOps | Medium |

---

## SUMMARY

### What's Working Well
- Clean service-layer separation (report → KPI → DORA → snapshot)
- Multi-layer caching strategy is well-thought-out
- Pydantic schemas at API boundaries
- TanStack Query usage on frontend is solid
- RAG status system is consistent across stack
- Async throughout the backend
- Configuration-as-code with YAML

### Top 5 Changes for Maximum Impact
1. **Fix security issues** (XSS, CORS, team ID validation) — immediate risk
2. **Split teams.py** into focused sub-routers — biggest maintainability win
3. **URL-based period state** — biggest UX win (shareable links, refresh persistence)
4. **Add error boundaries + code splitting** — biggest reliability/performance win
5. **Custom exception hierarchy** — biggest debugging/observability win
