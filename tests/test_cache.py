"""Tests for the in-memory cache layer (L1 report + L2 work-item)."""

from datetime import date

from app.cache import ReportCache, WorkItemCache
from app.schemas.report import ReportResponse


def _make_response(team_id: str = "t1") -> ReportResponse:
    return ReportResponse(
        team_id=team_id,
        start_date=date(2025, 1, 1),
        end_date=date(2025, 1, 31),
        deliverables=[],
    )


# ---------------------------------------------------------------------------
# ReportCache (L1)
# ---------------------------------------------------------------------------

class TestReportCache:
    def test_miss_returns_none(self):
        cache = ReportCache()
        assert cache.get("t1", date(2025, 1, 1), date(2025, 1, 31)) is None

    def test_put_then_hit(self):
        cache = ReportCache()
        resp = _make_response()
        cache.put("t1", date(2025, 1, 1), date(2025, 1, 31), resp)
        assert cache.get("t1", date(2025, 1, 1), date(2025, 1, 31)) is resp

    def test_different_key_is_miss(self):
        cache = ReportCache()
        cache.put("t1", date(2025, 1, 1), date(2025, 1, 31), _make_response())
        assert cache.get("t2", date(2025, 1, 1), date(2025, 1, 31)) is None
        assert cache.get("t1", date(2025, 2, 1), date(2025, 2, 28)) is None

    def test_invalidate_all(self):
        cache = ReportCache()
        cache.put("t1", date(2025, 1, 1), date(2025, 1, 31), _make_response("t1"))
        cache.put("t2", date(2025, 1, 1), date(2025, 1, 31), _make_response("t2"))
        assert cache.size == 2
        cleared = cache.invalidate()
        assert cleared == 2
        assert cache.size == 0
        assert cache.get("t1", date(2025, 1, 1), date(2025, 1, 31)) is None

    def test_invalidate_by_team(self):
        cache = ReportCache()
        cache.put("t1", date(2025, 1, 1), date(2025, 1, 31), _make_response("t1"))
        cache.put("t1", date(2025, 2, 1), date(2025, 2, 28), _make_response("t1"))
        cache.put("t2", date(2025, 1, 1), date(2025, 1, 31), _make_response("t2"))
        assert cache.size == 3
        cleared = cache.invalidate("t1")
        assert cleared == 2
        assert cache.size == 1
        assert cache.get("t1", date(2025, 1, 1), date(2025, 1, 31)) is None
        assert cache.get("t2", date(2025, 1, 1), date(2025, 1, 31)) is not None

    def test_invalidate_nonexistent_team(self):
        cache = ReportCache()
        cache.put("t1", date(2025, 1, 1), date(2025, 1, 31), _make_response())
        cleared = cache.invalidate("unknown")
        assert cleared == 0
        assert cache.size == 1

    def test_size_property(self):
        cache = ReportCache()
        assert cache.size == 0
        cache.put("t1", date(2025, 1, 1), date(2025, 1, 31), _make_response())
        assert cache.size == 1

    def test_overwrite_same_key(self):
        cache = ReportCache()
        r1 = _make_response()
        r2 = _make_response()
        cache.put("t1", date(2025, 1, 1), date(2025, 1, 31), r1)
        cache.put("t1", date(2025, 1, 1), date(2025, 1, 31), r2)
        assert cache.size == 1
        assert cache.get("t1", date(2025, 1, 1), date(2025, 1, 31)) is r2

    def test_lru_eviction(self):
        cache = ReportCache(maxsize=2)
        r1 = _make_response("t1")
        r2 = _make_response("t2")
        r3 = _make_response("t3")
        cache.put("t1", date(2025, 1, 1), date(2025, 1, 31), r1)
        cache.put("t2", date(2025, 1, 1), date(2025, 1, 31), r2)
        cache.put("t3", date(2025, 1, 1), date(2025, 1, 31), r3)
        assert cache.size == 2
        assert cache.get("t1", date(2025, 1, 1), date(2025, 1, 31)) is None
        assert cache.get("t2", date(2025, 1, 1), date(2025, 1, 31)) is r2
        assert cache.get("t3", date(2025, 1, 1), date(2025, 1, 31)) is r3

    def test_lru_access_prevents_eviction(self):
        cache = ReportCache(maxsize=2)
        r1 = _make_response("t1")
        r2 = _make_response("t2")
        r3 = _make_response("t3")
        cache.put("t1", date(2025, 1, 1), date(2025, 1, 31), r1)
        cache.put("t2", date(2025, 1, 1), date(2025, 1, 31), r2)
        cache.get("t1", date(2025, 1, 1), date(2025, 1, 31))  # touch t1
        cache.put("t3", date(2025, 1, 1), date(2025, 1, 31), r3)  # evicts t2
        assert cache.get("t1", date(2025, 1, 1), date(2025, 1, 31)) is r1
        assert cache.get("t2", date(2025, 1, 1), date(2025, 1, 31)) is None


# ---------------------------------------------------------------------------
# WorkItemCache (L2)
# ---------------------------------------------------------------------------

class TestWorkItemCache:
    def test_miss_returns_none(self):
        cache = WorkItemCache()
        assert cache.get("proj", 1) is None

    def test_put_then_hit(self):
        cache = WorkItemCache()
        wi = {"id": 42, "fields": {"System.Title": "Test"}}
        cache.put("proj", 42, wi)
        assert cache.get("proj", 42) is wi

    def test_different_project_is_miss(self):
        cache = WorkItemCache()
        cache.put("proj-a", 42, {"id": 42})
        assert cache.get("proj-b", 42) is None

    def test_invalidate(self):
        cache = WorkItemCache()
        cache.put("proj", 1, {"id": 1})
        cache.put("proj", 2, {"id": 2})
        assert cache.size == 2
        cleared = cache.invalidate()
        assert cleared == 2
        assert cache.size == 0
        assert cache.get("proj", 1) is None

    def test_size_property(self):
        cache = WorkItemCache()
        assert cache.size == 0
        cache.put("proj", 1, {"id": 1})
        assert cache.size == 1

    def test_lru_eviction(self):
        cache = WorkItemCache(maxsize=2)
        cache.put("proj", 1, {"id": 1})
        cache.put("proj", 2, {"id": 2})
        cache.put("proj", 3, {"id": 3})
        assert cache.size == 2
        assert cache.get("proj", 1) is None
        assert cache.get("proj", 2) is not None
        assert cache.get("proj", 3) is not None
