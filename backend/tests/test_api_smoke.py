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
        assert body["run"]["status"] == "awaiting_user"
        assert len(body["run"]["targets"]) == 2
        assert len(body["run"]["candidates"]) == 2
        assert len(body["run"]["procedures"]) == 2
        assert len(body["run"]["drafts"]) == 2
        assert len(body["run"]["handoffs"]) == 2
        assert body["run"]["currentPhase"] == "approval"
        assert any(event["phase"] == "retrieve_procedure" for event in body["events"])

        get_response = client.get(f"/api/agent/runs/{run_id}")
        assert get_response.status_code == 200
        assert get_response.json()["run"]["runId"] == run_id
        assert len(get_response.json()["run"]["removals"] if "removals" in get_response.json()["run"] else []) == 0


def test_ingest_and_retrieve_procedure_documents() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        ingest_response = client.post(
            "/api/procedures/ingest",
            json={
                "site": "ExampleBroker",
                "channel_hint": "webform",
                "source_uri": "https://example.com/privacy",
                "version": "v2",
                "summary": "ExampleBroker privacy removal flow",
                "raw_text": (
                    "Open the ExampleBroker opt-out webform. Search for the matching profile by name and city. "
                    "Submit the form with your privacy email and confirm the checkbox before sending."
                ),
            },
        )

        assert ingest_response.status_code == 200
        ingest_body = ingest_response.json()
        assert ingest_body["site"] == "ExampleBroker"
        assert ingest_body["chunk_count"] >= 1

        retrieve_response = client.post(
            "/api/procedures/retrieve",
            json={
                "seed_profile": {
                    "full_name": "Jane Doe",
                    "name_variants": [],
                    "location": {"city": "Seattle", "state": "Washington"},
                    "approx_age": None,
                    "privacy_email": "shield-abc123@example.com",
                    "optional": {"phone_last4": None, "prior_cities": []},
                    "consent": True,
                },
                "discovery_result": {
                    "site": "ExampleBroker",
                    "scan_timestamp": "2026-03-13T10:00:00.000Z",
                    "found": True,
                    "candidates": [
                        {
                            "url": "https://example.com/jane-doe",
                            "extracted": {
                                "name": "Jane Doe",
                                "age": None,
                                "addresses": ["Seattle, WA"],
                                "relatives": [],
                                "phones": [],
                            },
                            "match_confidence": 0.92,
                            "evidence_snippets": ["Jane Doe in Seattle, WA"],
                        }
                    ],
                    "notes": None,
                },
                "site": "ExampleBroker",
                "provided_chunks": [],
                "registry_chunks": [],
            },
        )

        assert retrieve_response.status_code == 200
        retrieve_body = retrieve_response.json()
        assert retrieve_body["procedures"]
        assert retrieve_body["procedures"][0]["procedure_id"] == ingest_body["procedure_id"]
        assert retrieve_body["procedures"][0]["source_chunks"][0]["relevance_score"] is not None


def test_search_procedures_returns_ranked_results() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        response = client.post(
            "/api/procedures/search",
            json={
                "site": "FastPeopleSearch",
                "query": "privacy email webform opt out",
                "limit": 3,
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["site"] == "FastPeopleSearch"
        assert len(body["procedures"]) >= 1
        assert body["procedures"][0]["source_chunks"][0]["quote"]
        assert "embedding_score" in body["procedures"][0]


def test_plan_submission_and_execution_are_logged_as_removals() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        start_response = client.post(
            "/api/agent/runs/start",
            json={
                "seed_profile": {
                    "full_name": "Janet Doe",
                    "name_variants": [],
                    "location": {"city": "Portland", "state": "Oregon"},
                    "approx_age": None,
                    "privacy_email": "shield-portland@example.com",
                    "optional": {"phone_last4": None, "prior_cities": []},
                    "consent": True,
                },
                "request_text": "Create a removal plan",
                "requested_sites": ["spokeo"],
            },
        )
        run_id = start_response.json()["run"]["runId"]

        plan_response = client.post(
            f"/api/agent/runs/{run_id}/plan-submission",
            json={
                "site": "Spokeo",
                "candidate_url": "https://spokeo.example/janet-doe",
                "payload": {
                    "submission_channel": "webform",
                    "required_fields": [
                        {"name": "full_name", "value": "Janet Doe", "required": True},
                        {"name": "privacy_email", "value": "shield-portland@example.com", "required": True},
                    ],
                    "optional_fields": [],
                    "steps": ["Open form", "Submit request"],
                },
            },
        )

        assert plan_response.status_code == 200

        execution_response = client.post(
            f"/api/agent/runs/{run_id}/execution-results",
            json={
                "site": "Spokeo",
                "candidate_url": "https://spokeo.example/janet-doe",
                "status": "submitted",
                "manual_review_required": False,
                "confirmation_text": "Request submitted successfully.",
                "ticket_ids": ["ticket-123"],
                "screenshot_ref": None,
                "error_text": None,
            },
        )
        assert execution_response.status_code == 200

        removals_response = client.get(f"/api/agent/runs/{run_id}/removals")
        assert removals_response.status_code == 200
        body = removals_response.json()
        matching = [
            removal
            for removal in body["removals"]
            if removal["candidate_url"] == "https://spokeo.example/janet-doe"
        ]
        assert len(matching) == 1
        assert matching[0]["status"] == "submitted"
        assert len(matching[0]["events"]) >= 2


def test_rescan_rebuilds_demo_workflow_state() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        start_response = client.post(
            "/api/agent/runs/start",
            json={
                "seed_profile": {
                    "full_name": "Jordan Example",
                    "name_variants": [],
                    "location": {"city": "Seattle", "state": "Washington"},
                    "approx_age": "33",
                    "privacy_email": "jordan-shield@example.com",
                    "optional": {"phone_last4": None, "prior_cities": []},
                    "consent": True,
                },
                "request_text": "Run and then rescan",
                "requested_sites": ["spokeo", "radaris"],
            },
        )
        run_id = start_response.json()["run"]["runId"]

        rescan_response = client.post(
            f"/api/agent/runs/{run_id}/rescan",
            json={"siteIds": ["spokeo", "radaris"], "reason": "Verify the current listings again."},
        )

        assert rescan_response.status_code == 200
        body = rescan_response.json()
        assert body["run"]["runId"] == run_id
        assert body["run"]["currentPhase"] == "approval"
        assert body["run"]["status"] == "awaiting_user"
        assert len(body["run"]["candidates"]) == 2
        assert any(event["phase"] == "approval" for event in body["events"])


def test_monitoring_target_set_endpoints() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        start_response = client.post(
            "/api/agent/runs/start",
            json={
                "seed_profile": {
                    "full_name": "Morgan Example",
                    "name_variants": [],
                    "location": {"city": "Seattle", "state": "Washington"},
                    "approx_age": "31",
                    "privacy_email": "morgan-shield@example.com",
                    "optional": {"phone_last4": "0114", "prior_cities": ["Tacoma"]},
                    "consent": True,
                },
                "request_text": "Track my listings.",
                "requested_sites": ["spokeo"],
            },
        )
        run_id = start_response.json()["run"]["runId"]

        create_response = client.post(
            f"/api/monitoring/runs/{run_id}/target-set",
            json={"profileId": "profile_demo"},
        )
        assert create_response.status_code == 200
        target_set = create_response.json()["targetSet"]
        assert target_set["sourceRunId"] == run_id
        assert target_set["targetCount"] >= 1

        list_response = client.get("/api/monitoring/target-sets")
        assert list_response.status_code == 200
        assert any(item["sourceRunId"] == run_id for item in list_response.json()["targetSets"])

        get_response = client.get(f"/api/monitoring/target-sets/{target_set['targetSetId']}")
        assert get_response.status_code == 200
        assert get_response.json()["targetSet"]["sourceRunId"] == run_id
