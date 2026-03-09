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


class TestReportErrors:
    def test_report_missing_params(self, client):
        r = client.get("/report")
        assert r.status_code == 422

    def test_report_bad_date_range(self, client):
        r = client.get("/report", params={
            "team_id": "game-services",
            "start_date": "2025-02-01",
            "end_date": "2025-01-01",
        })
        assert r.status_code == 400
        assert "start_date" in r.json()["detail"]

    def test_report_unknown_team(self, client):
        r = client.get("/report", params={
            "team_id": "nonexistent-team",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 404
        assert "nonexistent-team" in r.json()["detail"]

    def test_report_no_azure_client(self, client):
        """With azure_client=None the dependency returns 503."""
        r = client.get("/report", params={
            "team_id": "game-services",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_multi_report_unknown_team(self, client):
        r = client.get("/report/multi", params={
            "team_ids": "game-services,unknown-team",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 404
        assert "unknown-team" in str(r.json()["detail"])


class TestKPIEndpoints:
    def test_kpi_missing_params(self, client):
        r = client.get("/kpi")
        assert r.status_code == 422

    def test_kpi_unknown_team(self, client):
        r = client.get("/kpi", params={
            "team_id": "nonexistent-team",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 404

    def test_kpi_no_azure_client(self, client):
        r = client.get("/kpi", params={
            "team_id": "game-services",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_kpi_bad_date_range(self, client):
        r = client.get("/kpi", params={
            "team_id": "game-services",
            "start_date": "2025-02-01",
            "end_date": "2025-01-01",
        })
        assert r.status_code == 400

    def test_summary_missing_params(self, client):
        r = client.get("/kpi/summary")
        assert r.status_code == 422

    def test_summary_no_azure_client(self, client):
        r = client.get("/kpi/summary", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_drilldown_missing_params(self, client):
        r = client.get("/kpi/drilldown")
        assert r.status_code == 422

    def test_drilldown_unknown_team(self, client):
        r = client.get("/kpi/drilldown", params={
            "team_id": "nonexistent-team",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
            "metric": "items_reached_qa",
        })
        assert r.status_code == 404

    def test_drilldown_invalid_metric(self, client):
        r = client.get("/kpi/drilldown", params={
            "team_id": "game-services",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
            "metric": "invalid_metric",
        })
        assert r.status_code == 422

    def test_drilldown_no_azure_client(self, client):
        r = client.get("/kpi/drilldown", params={
            "team_id": "game-services",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
            "metric": "items_reached_qa",
        })
        assert r.status_code == 503


class TestReworkRateEndpoints:
    def test_rework_rate_missing_params(self, client):
        r = client.get("/kpi/rework-rate")
        assert r.status_code == 422

    def test_rework_rate_unknown_team(self, client):
        r = client.get("/kpi/rework-rate", params={
            "team_id": "nonexistent-team",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 404

    def test_rework_rate_no_azure_client(self, client):
        r = client.get("/kpi/rework-rate", params={
            "team_id": "game-services",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_rework_rate_summary_no_azure(self, client):
        r = client.get("/kpi/rework-rate/summary", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_rework_rate_drilldown_unknown_team(self, client):
        r = client.get("/kpi/rework-rate/drilldown", params={
            "team_id": "nonexistent-team",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
            "metric": "items_reached_qa",
        })
        assert r.status_code == 404

    def test_rework_rate_drilldown_invalid_metric(self, client):
        r = client.get("/kpi/rework-rate/drilldown", params={
            "team_id": "game-services",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
            "metric": "items_committed",
        })
        assert r.status_code == 422


class TestDeliveryPredictabilityEndpoints:
    def test_dp_missing_params(self, client):
        r = client.get("/kpi/delivery-predictability")
        assert r.status_code == 422

    def test_dp_unknown_team(self, client):
        r = client.get("/kpi/delivery-predictability", params={
            "team_id": "nonexistent-team",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 404

    def test_dp_no_azure_client(self, client):
        r = client.get("/kpi/delivery-predictability", params={
            "team_id": "game-services",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_dp_summary_no_azure(self, client):
        r = client.get("/kpi/delivery-predictability/summary", params={
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
        })
        assert r.status_code == 503

    def test_dp_drilldown_unknown_team(self, client):
        r = client.get("/kpi/delivery-predictability/drilldown", params={
            "team_id": "nonexistent-team",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
            "metric": "items_committed",
        })
        assert r.status_code == 404

    def test_dp_drilldown_invalid_metric(self, client):
        r = client.get("/kpi/delivery-predictability/drilldown", params={
            "team_id": "game-services",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
            "metric": "items_reached_qa",
        })
        assert r.status_code == 422


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
