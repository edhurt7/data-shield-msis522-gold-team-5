def test_healthcheck() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


def test_start_run_and_fetch_it() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        start_response = client.post(
            "/api/agent/runs/start",
            json={
                "seed_profile": {
                    "full_name": "Jane Doe",
                    "name_variants": ["J. Doe"],
                    "location": {"city": "Seattle", "state": "Washington"},
                    "approx_age": "35",
                    "privacy_email": "shield-abc123@example.com",
                    "optional": {"phone_last4": None, "prior_cities": ["Tacoma"]},
                    "consent": True,
                },
                "request_text": "Search for my name + Seattle and submit removals for everything you find.",
                "requested_sites": ["fastpeoplesearch", "spokeo"],
            },
        )

        assert start_response.status_code == 201
        body = start_response.json()
        run_id = body["run"]["runId"]
        assert body["run"]["status"] == "in_progress"
        assert len(body["run"]["targets"]) == 2

        get_response = client.get(f"/api/agent/runs/{run_id}")
        assert get_response.status_code == 200
        assert get_response.json()["run"]["runId"] == run_id
