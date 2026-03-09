"""Integration tests for HTTP endpoints using FastAPI TestClient."""

from __future__ import annotations


class TestHealth:
    def test_health_ok(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_health_deep_not_configured(self, client):
        r = client.get("/health", params={"deep": "true"})
        assert r.status_code == 200
        assert r.json()["azure"] == "not_configured"


# ---------------------------------------------------------------------------
# Endpoint 1: GET /dashboard
# ---------------------------------------------------------------------------

class TestDashboard:
    def test_missing_params(self, client):
        r = client.get("/dashboard")
        assert r.status_code == 422

    def test_bad_date_range(self, client):
        r = client.get("/dashboard", params={
            "start_date": "2025-02-01",
            "end_date": "2025-01-01",
        })
        assert r.status_code == 400
        assert "start_date" in r.json()["detail"]

    def test_no_azure_client(self, client):
        r = client.get("/dashboard", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503


# ---------------------------------------------------------------------------
# Endpoint 5: GET /teams/{team_id}/work-items
# ---------------------------------------------------------------------------

class TestWorkItems:
    def test_missing_params(self, client):
        r = client.get("/teams/game-services/work-items")
        assert r.status_code == 422

    def test_unknown_team(self, client):
        r = client.get("/teams/nonexistent-team/work-items", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 404
        assert "nonexistent-team" in r.json()["detail"]

    def test_bad_date_range(self, client):
        r = client.get("/teams/game-services/work-items", params={
            "start_date": "2025-02-01",
            "end_date": "2025-01-01",
        })
        assert r.status_code == 400

    def test_no_azure_client(self, client):
        r = client.get("/teams/game-services/work-items", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503


# ---------------------------------------------------------------------------
# Endpoint 2: GET /teams/{team_id}/kpis
# ---------------------------------------------------------------------------

class TestTeamKPIs:
    def test_missing_params(self, client):
        r = client.get("/teams/game-services/kpis")
        assert r.status_code == 422

    def test_unknown_team(self, client):
        r = client.get("/teams/nonexistent-team/kpis", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 404

    def test_bad_date_range(self, client):
        r = client.get("/teams/game-services/kpis", params={
            "start_date": "2025-02-01",
            "end_date": "2025-01-01",
        })
        assert r.status_code == 400

    def test_no_azure_client(self, client):
        r = client.get("/teams/game-services/kpis", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503


# ---------------------------------------------------------------------------
# Endpoint 3: GET /teams/{team_id}/kpis/{kpi_name}
# ---------------------------------------------------------------------------

class TestTeamKPIDetail:
    def test_missing_params(self, client):
        r = client.get("/teams/game-services/kpis/rework-rate")
        assert r.status_code == 422

    def test_unknown_team(self, client):
        r = client.get("/teams/nonexistent-team/kpis/rework-rate", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 404

    def test_invalid_kpi_name(self, client):
        r = client.get("/teams/game-services/kpis/invalid-kpi", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 422

    def test_no_azure_client_rework(self, client):
        r = client.get("/teams/game-services/kpis/rework-rate", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_no_azure_client_dp(self, client):
        r = client.get("/teams/game-services/kpis/delivery-predictability", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_no_azure_client_fh(self, client):
        r = client.get("/teams/game-services/kpis/flow-hygiene", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_no_azure_client_wd(self, client):
        r = client.get("/teams/game-services/kpis/wip-discipline", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503


# ---------------------------------------------------------------------------
# Endpoint 4: GET /teams/{team_id}/kpis/{kpi_name}/drilldown/{metric}
# ---------------------------------------------------------------------------

class TestDrilldown:
    def test_missing_params(self, client):
        r = client.get("/teams/game-services/kpis/rework-rate/drilldown/items_reached_qa")
        assert r.status_code == 422

    def test_unknown_team(self, client):
        r = client.get("/teams/nonexistent-team/kpis/rework-rate/drilldown/items_reached_qa", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 404

    def test_invalid_kpi_name(self, client):
        r = client.get("/teams/game-services/kpis/invalid-kpi/drilldown/items_reached_qa", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 422

    def test_wrong_metric_for_kpi(self, client):
        """items_committed is a DP metric, not a rework metric."""
        r = client.get("/teams/game-services/kpis/rework-rate/drilldown/items_committed", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 422
        assert "Invalid metric" in r.json()["detail"]

    def test_wrong_metric_for_dp(self, client):
        """items_reached_qa is a rework metric, not a DP metric."""
        r = client.get("/teams/game-services/kpis/delivery-predictability/drilldown/items_reached_qa", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 422

    def test_wrong_metric_for_fh(self, client):
        """items_committed is not a flow hygiene metric."""
        r = client.get("/teams/game-services/kpis/flow-hygiene/drilldown/items_committed", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 422
        assert "Invalid metric" in r.json()["detail"]

    def test_no_azure_client(self, client):
        r = client.get("/teams/game-services/kpis/rework-rate/drilldown/items_reached_qa", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_valid_dp_metric(self, client):
        """items_deployed is a valid DP metric, should get 503 (no Azure), not 422."""
        r = client.get("/teams/game-services/kpis/delivery-predictability/drilldown/items_deployed", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_valid_fh_metric(self, client):
        """items_in_queue is a valid FH metric, should get 503 (no Azure), not 422."""
        r = client.get("/teams/game-services/kpis/flow-hygiene/drilldown/items_in_queue", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_wrong_metric_for_wd(self, client):
        """items_reached_qa is not a WIP discipline metric."""
        r = client.get("/teams/game-services/kpis/wip-discipline/drilldown/items_reached_qa", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 422
        assert "Invalid metric" in r.json()["detail"]

    def test_valid_wd_metric_developers(self, client):
        """developers is a valid WD metric, should get 503 (no Azure), not 422."""
        r = client.get("/teams/game-services/kpis/wip-discipline/drilldown/developers", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_valid_wd_metric_qas(self, client):
        """qas is a valid WD metric."""
        r = client.get("/teams/game-services/kpis/wip-discipline/drilldown/qas", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_valid_wd_metric_compliant(self, client):
        """compliant_gte_80 is a valid WD metric."""
        r = client.get("/teams/game-services/kpis/wip-discipline/drilldown/compliant_gte_80", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_valid_wd_metric_over_wip(self, client):
        """over_wip_limit is a valid WD metric."""
        r = client.get("/teams/game-services/kpis/wip-discipline/drilldown/over_wip_limit", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503


# ---------------------------------------------------------------------------
# Old endpoints should be gone
# ---------------------------------------------------------------------------

class TestOldEndpointsRemoved:
    def test_old_report(self, client):
        r = client.get("/report", params={
            "team_id": "game-services",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 404

    def test_old_kpi(self, client):
        r = client.get("/kpi", params={
            "team_id": "game-services",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 404

    def test_old_kpi_summary(self, client):
        r = client.get("/kpi/summary", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Cache endpoints (unchanged)
# ---------------------------------------------------------------------------

class TestCacheEndpoints:
    def test_cache_stats_empty(self, client):
        r = client.get("/cache/stats")
        assert r.status_code == 200
        data = r.json()
        assert data["report_cache_entries"] == 0
        assert data["work_item_cache_entries"] == 0

    def test_cache_invalidate_all(self, client):
        r = client.delete("/cache")
        assert r.status_code == 200
        data = r.json()
        assert "cleared" in data
        assert data["cleared"]["reports"] == 0
        assert data["cleared"]["work_items"] == 0

    def test_cache_invalidate_team(self, client):
        r = client.delete("/cache/game-services")
        assert r.status_code == 200
        data = r.json()
        assert data["team_id"] == "game-services"
        assert data["cleared"]["reports"] == 0
