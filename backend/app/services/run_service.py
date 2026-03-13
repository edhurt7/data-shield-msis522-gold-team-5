from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import Session, selectinload

from app.models import AgentRun, ChatMessage, Profile, RemovalRequest, RemovalStatusEvent, WorkflowEvent
from app.schemas.agent import (
    AgentRunStateRead,
    AppendExecutionResultRequest,
    ChatMessageRead,
    CreateMonitoredTargetSetFromRunResponse,
    GetMonitoredTargetSetResponse,
    ListRemovalRequestsResponse,
    ListChatMessagesResponse,
    ListMonitoredTargetSetsResponse,
    MonitoredTargetSetRead,
    ProcedureRetrievalRequest,
    RemovalRequestRead,
    RemovalStatusEventRead,
    SearchProfile,
    StartAgentRunRequest,
    UserIntent,
    WorkflowEventRead,
)
from app.services.langgraph_bridge import LangGraphBridgeError, LangGraphWorkflowResult, run_langgraph_workflow
from app.services.procedure_service import retrieve_relevant_procedures


SUPPORTED_DISCOVERY_SITES = {"fastpeoplesearch", "spokeo", "radaris"}
DEFAULT_PHONE_BY_SITE = {
    "fastpeoplesearch": "(206) 555-0182",
    "spokeo": "(206) 555-0147",
    "radaris": "(206) 555-0161",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _split_name(full_name: str) -> tuple[str, str]:
    parts = [part for part in full_name.strip().split(" ") if part]
    if not parts:
        return "Unknown", "User"
    if len(parts) == 1:
        return parts[0], parts[0]
    return parts[0], parts[-1]


def _search_profile_from_seed(profile_id: str, payload: StartAgentRunRequest) -> SearchProfile:
    first_name, last_name = _split_name(payload.seed_profile.full_name)
    return SearchProfile(
        profileId=profile_id,
        firstName=first_name,
        lastName=last_name,
        city=payload.seed_profile.location.city,
        state=payload.seed_profile.location.state,
        proxyEmail=payload.seed_profile.privacy_email,
    )


def _intent_from_request(payload: StartAgentRunRequest) -> UserIntent:
    return UserIntent(
        requestText=payload.request_text,
        requestedActions=["scan_only", "submit_opt_out"],
        requestedSites=payload.requested_sites,
        geographicHint=payload.seed_profile.location.city,
        requiresUserApprovalBeforeSubmission=True,
    )


def _targets_from_request(payload: StartAgentRunRequest) -> list[dict[str, str]]:
    full_name = payload.seed_profile.full_name
    city = payload.seed_profile.location.city
    state = payload.seed_profile.location.state
    targets: list[dict[str, str]] = []
    for site in payload.requested_sites:
        site_name = site.replace("_", " ").replace("-", " ").title()
        targets.append(
            {
                "siteId": site,
                "siteName": site_name,
                "query": f"{full_name} {city} {state}",
            }
        )
    return targets


def _site_name(site_id: str) -> str:
    return site_id.replace("_", " ").replace("-", " ").title()


def _listing_url(site_id: str, full_name: str, city: str, state: str) -> str:
    slug = full_name.lower().replace(" ", "-")
    city_slug = city.lower().replace(" ", "-")
    state_slug = state.lower().replace(" ", "-")
    if site_id == "spokeo":
        return f"https://www.spokeo.example/{slug}/{city_slug}-{state_slug}"
    if site_id == "fastpeoplesearch":
        return f"https://www.fastpeoplesearch.example/name/{slug}_{city_slug}-{state_slug}"
    if site_id == "radaris":
        return f"https://www.radaris.example/p/{full_name.replace(' ', '/')}/{city_slug}-{state_slug}"
    return f"https://www.{site_id}.example/{slug}/{city_slug}-{state_slug}"


def _candidate_fields(run: AgentRun, site_id: str) -> list[dict[str, object]]:
    city = run.profile_snapshot.get("city", "") or run.profile.city
    state = run.profile_snapshot.get("state", "") or run.profile.state
    age = run.profile.approx_age or "Unknown"
    fields: list[dict[str, object]] = [
        {"field": "Full Name", "value": run.profile.full_name},
        {"field": "Current Location", "value": f"{city}, {state}"},
        {"field": "Phone Number", "value": DEFAULT_PHONE_BY_SITE.get(site_id, "(206) 555-0100")},
    ]
    if age and age != "Unknown":
        fields.append({"field": "Age", "value": age})
    if run.profile.optional_attributes.get("prior_cities"):
        fields.append({"field": "Prior Cities", "value": run.profile.optional_attributes["prior_cities"]})
    return fields


def _candidate_evidence(run: AgentRun, site_id: str, listing_url: str) -> list[dict[str, object]]:
    city = run.profile_snapshot.get("city", "") or run.profile.city
    state = run.profile_snapshot.get("state", "") or run.profile.state
    age = run.profile.approx_age
    excerpt = f"{run.profile.full_name} in {city}, {state}"
    if age:
        excerpt = f"{excerpt}, age {age}"
    return [
        {
            "sourceType": "listing_page",
            "sourceUrl": listing_url,
            "excerpt": excerpt,
            "capturedAt": utcnow().isoformat(),
            "fields": [],
        }
    ]


def _discovery_result_for_candidate(run: AgentRun, candidate: dict[str, object]) -> dict[str, object]:
    extracted_fields = candidate.get("extractedFields", [])
    location = next(
        (
            field.get("value")
            for field in extracted_fields
            if isinstance(field, dict) and field.get("field") == "Current Location"
        ),
        None,
    )
    return {
        "site": candidate["siteName"],
        "scan_timestamp": utcnow().isoformat(),
        "found": True,
        "candidates": [
            {
                "url": candidate["listingUrl"],
                "extracted": {
                    "name": candidate["displayName"],
                    "age": run.profile.approx_age,
                    "addresses": [location] if isinstance(location, str) else [],
                    "relatives": [],
                    "phones": [
                        field["value"]
                        for field in extracted_fields
                        if isinstance(field, dict) and field.get("field") == "Phone Number"
                    ],
                },
                "match_confidence": 0.94,
                "evidence_snippets": [candidate["evidence"][0]["excerpt"]],
            }
        ],
        "notes": None,
    }


def _infer_required_inputs(channel: str) -> list[dict[str, object]]:
    required = [
        {"key": "full_name", "label": "Full name", "required": True, "source": "profile"},
        {"key": "privacy_email", "label": "Privacy email", "required": True, "source": "system"},
    ]
    if channel == "email":
        required.append({"key": "listing_url", "label": "Listing URL", "required": True, "source": "listing"})
    return required


def _steps_from_procedure(site_id: str, channel: str, candidate_url: str) -> list[dict[str, object]]:
    if channel == "email":
        return [
            {
                "stepId": f"step_{site_id}_1",
                "action": "manual_review",
                "instruction": f"Review the prepared email for {site_id} and confirm the listing URL is correct.",
                "required": True,
            },
            {
                "stepId": f"step_{site_id}_2",
                "action": "check_email",
                "instruction": "Send the prepared privacy request from the designated privacy-safe mailbox.",
                "required": True,
            },
        ]

    return [
        {
            "stepId": f"step_{site_id}_1",
            "action": "navigate",
            "instruction": f"Open the {site_id} opt-out page and search for the matching record.",
            "targetUrl": candidate_url,
            "required": True,
        },
        {
            "stepId": f"step_{site_id}_2",
            "action": "fill",
            "instruction": "Populate the required form fields using the prepared data.",
            "inputKey": "full_name",
            "required": True,
        },
        {
            "stepId": f"step_{site_id}_3",
            "action": "submit",
            "instruction": "Submit the opt-out request and capture any confirmation details.",
            "required": True,
        },
    ]


def _draft_for_candidate(
    run: AgentRun,
    site_id: str,
    candidate: dict[str, object],
    procedure_id: str,
    submission_channel: str,
) -> dict[str, object]:
    generated_at = utcnow().isoformat()
    facts_used = candidate["extractedFields"]
    listing_url = candidate["listingUrl"]
    if submission_channel == "email":
        subject = f"Privacy removal request for {run.profile.full_name}"
        body = (
            f"Hello {candidate['siteName']} privacy team,\n\n"
            f"I am requesting removal of the listing at {listing_url}.\n"
            f"Name: {run.profile.full_name}\n"
            f"City/State: {run.profile.city}, {run.profile.state}\n"
            f"Privacy email: {run.profile.privacy_email}\n\n"
            "Please confirm once this record has been suppressed."
        )
        return {
            "draftId": f"draft_{uuid4().hex}",
            "siteId": site_id,
            "candidateId": candidate["candidateId"],
            "submissionChannel": "email",
            "subject": subject,
            "body": body,
            "factsUsed": facts_used,
            "procedureId": procedure_id,
            "generatedAt": generated_at,
        }

    body = (
        f"Prepared webform submission for {candidate['siteName']} using "
        f"{run.profile.full_name}, {run.profile.city}, {run.profile.state}, and {run.profile.privacy_email}."
    )
    return {
        "draftId": f"draft_{uuid4().hex}",
        "siteId": site_id,
        "candidateId": candidate["candidateId"],
        "submissionChannel": "webform",
        "body": body,
        "factsUsed": facts_used,
        "procedureId": procedure_id,
        "generatedAt": generated_at,
    }


def _submission_payload(
    run: AgentRun,
    candidate: dict[str, object],
    procedure: dict[str, object],
    draft: dict[str, object],
) -> dict[str, object]:
    required_fields = [
        {"name": "full_name", "value": run.profile.full_name, "required": True},
        {"name": "privacy_email", "value": run.profile.privacy_email, "required": True},
    ]
    optional_fields = [
        {"name": "city", "value": run.profile.city, "required": False},
        {"name": "state", "value": run.profile.state, "required": False},
    ]
    if procedure["submissionChannel"] == "email":
        required_fields.append({"name": "listing_url", "value": candidate["listingUrl"], "required": True})
        return {
            "site": candidate["siteName"],
            "candidate_url": candidate["listingUrl"],
            "submission_channel": "email",
            "procedure_type": "email",
            "required_fields": required_fields,
            "optional_fields": optional_fields,
            "manual_review_required": True,
            "review_reasons": ["manual_submission_required"],
            "email": {
                "to": "privacy@radaris.example",
                "subject": draft["subject"],
                "body": draft["body"],
            },
        }

    webform_fields = [
        {"name": "full_name", "value": run.profile.full_name},
        {"name": "privacy_email", "value": run.profile.privacy_email},
        {"name": "city", "value": run.profile.city},
        {"name": "state", "value": run.profile.state},
    ]
    return {
        "site": candidate["siteName"],
        "candidate_url": candidate["listingUrl"],
        "submission_channel": "webform",
        "procedure_type": "webform",
        "required_fields": required_fields,
        "optional_fields": optional_fields,
        "manual_review_required": True,
        "review_reasons": ["manual_submission_required"],
        "webform": {
            "fields": webform_fields,
            "consent_checkboxes": [
                {
                    "label": "I confirm this request concerns my personal information.",
                    "instruction": "Check the consent checkbox before submission.",
                    "required": True,
                }
            ],
        },
    }


def _clear_run_state(run: AgentRun) -> None:
    run.candidates = []
    run.match_decisions = []
    run.procedures = []
    run.drafts = []
    run.handoffs = []
    run.outcomes = []
    run.pending_review_reasons = []


def _persist_langgraph_result(
    db: Session,
    run: AgentRun,
    result: LangGraphWorkflowResult,
    *,
    reset_state: bool,
) -> list[WorkflowEvent]:
    if reset_state:
        _clear_run_state(run)

    run.targets = result.targets
    run.candidates = result.candidates
    run.match_decisions = result.match_decisions
    run.procedures = result.procedures
    run.drafts = result.drafts
    run.handoffs = result.handoffs
    run.outcomes = result.outcomes
    run.pending_review_reasons = result.pending_review_reasons
    run.current_phase = result.current_phase
    run.status = result.status

    events: list[WorkflowEvent] = []
    for payload in result.timeline:
        events.append(
            append_event(
                db,
                run,
                phase=str(payload["phase"]),
                status=str(payload["status"]),
                message=str(payload["message"]),
                site_id=payload.get("siteId"),
                candidate_id=payload.get("candidateId"),
                review_reasons=list(payload.get("reviewReasons", [])),
            )
        )

    if result.automation_error:
        run.pending_review_reasons = sorted(
            set([*(run.pending_review_reasons or []), "manual_submission_required"])
        )

    for removal_payload in result.removals:
        removal = get_or_create_removal_request(
            db,
            run,
            site_id=str(removal_payload["siteId"]),
            candidate_id=str(removal_payload["candidateId"]),
            candidate_url=str(removal_payload["candidateUrl"]),
            procedure_id=str(removal_payload["procedureId"]) if removal_payload.get("procedureId") else None,
            submission_channel=str(removal_payload.get("submissionChannel", "webform")),
        )
        removal.status = str(removal_payload.get("status", "planned"))
        removal.review_reasons = list(removal_payload.get("reviewReasons", []))
        removal.latest_ticket_id = (removal_payload.get("ticketIds") or [None])[0]
        removal.latest_confirmation_text = removal_payload.get("confirmationText")
        removal.latest_error_text = removal_payload.get("errorText")
        removal.request_metadata = dict(removal_payload.get("metadata", {}))
        append_removal_status_event(
            db,
            removal,
            status=removal.status,
            message=str(removal_payload.get("message", f"Workflow updated {removal.site_id}.")),
            ticket_ids=list(removal_payload.get("ticketIds", [])),
            screenshot_ref=removal_payload.get("screenshotRef"),
            error_text=removal_payload.get("errorText"),
            confirmation_text=removal_payload.get("confirmationText"),
        )

    run.updated_at = utcnow()
    db.commit()
    db.refresh(run)
    return events


def _process_run_workflow_deterministic(db: Session, run: AgentRun, *, reset_state: bool = False) -> list[WorkflowEvent]:
    events: list[WorkflowEvent] = []
    if reset_state:
        _clear_run_state(run)

    for target in run.targets or []:
        site_id = str(target["siteId"]).lower()
        if site_id not in SUPPORTED_DISCOVERY_SITES:
            events.append(
                append_event(
                    db,
                    run,
                    phase="scan",
                    status="completed",
                    message=f"No supported discovery workflow is configured for {target['siteName']} yet.",
                    site_id=site_id,
                    review_reasons=["missing_procedure"],
                )
            )
            continue

        listing_url = _listing_url(site_id, run.profile.full_name, run.profile.city, run.profile.state)
        candidate_id = f"cand_{site_id}_{uuid4().hex[:8]}"
        candidate = {
            "candidateId": candidate_id,
            "siteId": site_id,
            "siteName": _site_name(site_id),
            "listingUrl": listing_url,
            "displayName": run.profile.full_name,
            "extractedFields": _candidate_fields(run, site_id),
            "evidence": _candidate_evidence(run, site_id, listing_url),
        }
        run.candidates = [*(run.candidates or []), candidate]
        events.append(
            append_event(
                db,
                run,
                phase="scan",
                status="completed",
                message=f"Found a likely listing on {candidate['siteName']}.",
                site_id=site_id,
                candidate_id=candidate_id,
            )
        )

        match_decision = {
            "siteId": site_id,
            "candidateId": candidate_id,
            "decision": "likely_match",
            "confidence": 0.94,
            "rationale": "Name and location align with the requested search profile, so the record is suitable for opt-out planning.",
            "evidence": candidate["evidence"],
            "reviewReasons": [],
        }
        run.match_decisions = [*(run.match_decisions or []), match_decision]
        events.append(
            append_event(
                db,
                run,
                phase="match",
                status="completed",
                message=f"Confirmed a likely match for {candidate['siteName']}.",
                site_id=site_id,
                candidate_id=candidate_id,
            )
        )

        retrieval = retrieve_relevant_procedures(
            db,
            ProcedureRetrievalRequest(
                seed_profile={
                    "full_name": run.profile.full_name,
                    "privacy_email": run.profile.privacy_email,
                    "location": {"city": run.profile.city, "state": run.profile.state},
                },
                discovery_result=_discovery_result_for_candidate(run, candidate),
                site=candidate["siteName"],
                provided_chunks=[],
                registry_chunks=[],
            ),
        )
        selected = retrieval.procedures[0] if retrieval.procedures else None
        if not selected or not selected.source_chunks:
            run.pending_review_reasons = sorted(set([*(run.pending_review_reasons or []), "missing_procedure"]))
            events.append(
                append_event(
                    db,
                    run,
                    phase="retrieve_procedure",
                    status="blocked",
                    message=f"No usable opt-out procedure was found for {candidate['siteName']}.",
                    site_id=site_id,
                    candidate_id=candidate_id,
                    review_reasons=["missing_procedure", "manual_submission_required"],
                )
            )
            continue

        procedure = {
            "siteId": site_id,
            "procedureId": selected.procedure_id,
            "source": "rag",
            "sourceDocumentUri": selected.summary or selected.procedure_id,
            "sourceVersion": selected.procedure_id.rsplit("-", 1)[-1],
            "retrievedAt": retrieval.retrieved_at.isoformat(),
            "submissionChannel": "email" if selected.channel_hint == "email" else "webform",
            "freshnessDays": selected.freshness_days or 0,
            "isComplete": True,
            "requiredInputs": _infer_required_inputs("email" if selected.channel_hint == "email" else "webform"),
            "steps": _steps_from_procedure(site_id, "email" if selected.channel_hint == "email" else "webform", candidate["listingUrl"]),
            "reviewReasons": [],
        }
        run.procedures = [*(run.procedures or []), procedure]
        events.append(
            append_event(
                db,
                run,
                phase="retrieve_procedure",
                status="completed",
                message=f"Retrieved opt-out procedure for {candidate['siteName']}.",
                site_id=site_id,
                candidate_id=candidate_id,
            )
        )

        draft = _draft_for_candidate(run, site_id, candidate, procedure["procedureId"], procedure["submissionChannel"])
        run.drafts = [*(run.drafts or []), draft]
        events.append(
            append_event(
                db,
                run,
                phase="draft",
                status="completed",
                message=f"Prepared a submission draft for {candidate['siteName']}.",
                site_id=site_id,
                candidate_id=candidate_id,
            )
        )

        payload = _submission_payload(run, candidate, procedure, draft)
        handoff = {
            "handoffId": f"handoff_{uuid4().hex}",
            "mode": "human_assisted",
            "requiresUserApproval": True,
            "reviewReasons": ["manual_submission_required"],
            "payload": {
                "siteId": site_id,
                "candidateId": candidate_id,
                "procedureId": procedure["procedureId"],
                "procedureVersion": procedure["sourceVersion"],
                "submissionChannel": procedure["submissionChannel"],
                "fields": {field["name"]: field["value"] for field in payload["required_fields"] + payload.get("optional_fields", [])},
                "steps": procedure["steps"],
                "draft": draft,
            },
            "createdAt": utcnow().isoformat(),
        }
        run.handoffs = [*(run.handoffs or []), handoff]
        run.pending_review_reasons = sorted(set([*(run.pending_review_reasons or []), "manual_submission_required"]))

        removal = get_or_create_removal_request(
            db,
            run,
            site_id=site_id,
            candidate_id=candidate_id,
            candidate_url=candidate["listingUrl"],
            procedure_id=procedure["procedureId"],
            submission_channel=procedure["submissionChannel"],
        )
        removal.status = "planned"
        removal.review_reasons = ["manual_submission_required"]
        removal.request_metadata = payload
        append_removal_status_event(
            db,
            removal,
            status="planned",
            message=f"Generated a ready-for-review submission plan for {candidate['siteName']}.",
        )
        events.append(
            append_event(
                db,
                run,
                phase="approval",
                status="awaiting_user",
                message=f"Submission plan is ready for review for {candidate['siteName']}.",
                site_id=site_id,
                candidate_id=candidate_id,
                review_reasons=["manual_submission_required"],
            )
        )

    if run.handoffs:
        run.current_phase = "approval"
        run.status = "awaiting_user"
    elif run.candidates:
        run.current_phase = "retrieve_procedure"
        run.status = "blocked"
        run.pending_review_reasons = sorted(set([*(run.pending_review_reasons or []), "missing_procedure"]))
    else:
        run.current_phase = "completed"
        run.status = "completed"

    run.updated_at = utcnow()
    db.commit()
    db.refresh(run)
    return events


def process_run_workflow(db: Session, run: AgentRun, *, reset_state: bool = False) -> list[WorkflowEvent]:
    try:
        result = run_langgraph_workflow(db, run, mode="plan")
    except LangGraphBridgeError as exc:
        events = _process_run_workflow_deterministic(db, run, reset_state=reset_state)
        events.append(
            append_event(
                db,
                run,
                phase=run.current_phase,
                status=run.status,
                message=f"LangGraph worker was unavailable; deterministic fallback used. {exc}",
                review_reasons=["manual_submission_required"],
            )
        )
        db.commit()
        db.refresh(run)
        return events

    return _persist_langgraph_result(db, run, result, reset_state=reset_state)


def _event_read(event: WorkflowEvent) -> WorkflowEventRead:
    return WorkflowEventRead(
        eventId=event.id,
        runId=event.run_id,
        phase=event.phase,
        status=event.status,
        message=event.message,
        createdAt=event.created_at,
        siteId=event.site_id,
        candidateId=event.candidate_id,
        reviewReasons=event.review_reasons or [],
    )


def build_run_state(run: AgentRun) -> AgentRunStateRead:
    timeline = [_event_read(event) for event in run.events]
    return AgentRunStateRead(
        runId=run.id,
        profile=SearchProfile.model_validate(run.profile_snapshot),
        intent=UserIntent.model_validate(run.intent_snapshot),
        currentPhase=run.current_phase,
        status=run.status,
        consentConfirmed=run.consent_confirmed,
        targets=run.targets or [],
        candidates=run.candidates or [],
        matchDecisions=run.match_decisions or [],
        procedures=run.procedures or [],
        drafts=run.drafts or [],
        handoffs=run.handoffs or [],
        outcomes=run.outcomes or [],
        pendingReviewReasons=run.pending_review_reasons or [],
        timeline=timeline,
        createdAt=run.created_at,
        updatedAt=run.updated_at,
    )


def build_chat_message(message: ChatMessage) -> ChatMessageRead:
    return ChatMessageRead(
        id=message.id,
        role=message.role,
        content=message.content,
        createdAt=message.created_at,
    )


def build_removal_status_event(event: RemovalStatusEvent) -> RemovalStatusEventRead:
    return RemovalStatusEventRead(
        id=event.id,
        status=event.status,
        message=event.message,
        ticket_ids=event.ticket_ids or [],
        screenshot_ref=event.screenshot_ref,
        error_text=event.error_text,
        confirmation_text=event.confirmation_text,
        created_at=event.created_at,
    )


def build_removal_request(removal: RemovalRequest) -> RemovalRequestRead:
    return RemovalRequestRead(
        id=removal.id,
        run_id=removal.run_id,
        site_id=removal.site_id,
        candidate_id=removal.candidate_id,
        candidate_url=removal.candidate_url,
        procedure_id=removal.procedure_id,
        submission_channel=removal.submission_channel,
        status=removal.status,
        latest_ticket_id=removal.latest_ticket_id,
        latest_confirmation_text=removal.latest_confirmation_text,
        latest_error_text=removal.latest_error_text,
        review_reasons=removal.review_reasons or [],
        metadata=removal.request_metadata or {},
        created_at=removal.created_at,
        updated_at=removal.updated_at,
        events=[build_removal_status_event(event) for event in removal.status_events],
    )


def list_chat_messages(run: AgentRun) -> ListChatMessagesResponse:
    messages = [build_chat_message(message) for message in run.chat_messages]
    return ListChatMessagesResponse(messages=messages)


def list_removal_requests(db: Session, run_id: str) -> ListRemovalRequestsResponse:
    removals = (
        db.query(RemovalRequest)
        .options(selectinload(RemovalRequest.status_events))
        .filter(RemovalRequest.run_id == run_id)
        .order_by(RemovalRequest.created_at.desc())
        .all()
    )
    return ListRemovalRequestsResponse(removals=[build_removal_request(removal) for removal in removals])


def list_runs(db: Session) -> list[AgentRunStateRead]:
    runs = db.query(AgentRun).order_by(AgentRun.created_at.desc()).all()
    return [build_run_state(run) for run in runs]


def get_run(db: Session, run_id: str) -> AgentRun | None:
    return db.get(AgentRun, run_id)


def get_or_create_removal_request(
    db: Session,
    run: AgentRun,
    *,
    site_id: str,
    candidate_id: str,
    candidate_url: str,
    procedure_id: str | None,
    submission_channel: str,
) -> RemovalRequest:
    existing = (
        db.query(RemovalRequest)
        .filter(
            RemovalRequest.run_id == run.id,
            RemovalRequest.site_id == site_id,
            RemovalRequest.candidate_url == candidate_url,
        )
        .one_or_none()
    )
    if existing:
        if procedure_id:
            existing.procedure_id = procedure_id
        existing.submission_channel = submission_channel or existing.submission_channel
        return existing

    removal = RemovalRequest(
        run_id=run.id,
        site_id=site_id,
        candidate_id=candidate_id,
        candidate_url=candidate_url,
        procedure_id=procedure_id,
        submission_channel=submission_channel,
        status="planned",
        request_metadata={"source": "agent_workflow"},
    )
    db.add(removal)
    db.flush()
    return removal


def append_removal_status_event(
    db: Session,
    removal: RemovalRequest,
    *,
    status: str,
    message: str,
    ticket_ids: list[str] | None = None,
    screenshot_ref: str | None = None,
    error_text: str | None = None,
    confirmation_text: str | None = None,
) -> RemovalStatusEvent:
    event = RemovalStatusEvent(
        removal_request_id=removal.id,
        status=status,
        message=message,
        ticket_ids=ticket_ids or [],
        screenshot_ref=screenshot_ref,
        error_text=error_text,
        confirmation_text=confirmation_text,
    )
    db.add(event)
    db.flush()
    return event


def create_run(db: Session, payload: StartAgentRunRequest) -> tuple[AgentRun, list[WorkflowEvent]]:
    profile = Profile(
        full_name=payload.seed_profile.full_name,
        city=payload.seed_profile.location.city,
        state=payload.seed_profile.location.state,
        approx_age=payload.seed_profile.approx_age,
        privacy_email=str(payload.seed_profile.privacy_email),
        consent_confirmed=payload.seed_profile.consent,
        optional_attributes={
            **payload.seed_profile.optional.model_dump(),
            "name_variants": list(payload.seed_profile.name_variants),
        },
    )
    db.add(profile)
    db.flush()

    profile_snapshot = _search_profile_from_seed(profile.id, payload)
    intent_snapshot = _intent_from_request(payload)
    run = AgentRun(
        profile_id=profile.id,
        request_text=payload.request_text,
        requested_sites=payload.requested_sites,
        profile_snapshot=profile_snapshot.model_dump(),
        intent_snapshot=intent_snapshot.model_dump(),
        current_phase="scan",
        status="in_progress",
        consent_confirmed=payload.seed_profile.consent,
        targets=_targets_from_request(payload),
        candidates=[],
        match_decisions=[],
        procedures=[],
        drafts=[],
        handoffs=[],
        outcomes=[],
        pending_review_reasons=[],
    )
    db.add(run)
    db.flush()

    event = WorkflowEvent(
        run_id=run.id,
        phase="scan",
        status="in_progress",
        message="Agent run created and queued for discovery.",
    )
    db.add(event)
    db.commit()
    db.refresh(run)
    return run, [event]


def add_chat_message(db: Session, run: AgentRun, role: str, content: str) -> ChatMessage:
    message = ChatMessage(run_id=run.id, role=role, content=content)
    db.add(message)
    db.flush()
    return message


def append_event(
    db: Session,
    run: AgentRun,
    *,
    phase: str,
    status: str,
    message: str,
    site_id: str | None = None,
    candidate_id: str | None = None,
    review_reasons: list[str] | None = None,
) -> WorkflowEvent:
    event = WorkflowEvent(
        run_id=run.id,
        phase=phase,
        status=status,
        message=message,
        site_id=site_id,
        candidate_id=candidate_id,
        review_reasons=review_reasons or [],
    )
    db.add(event)
    db.flush()
    return event


def handle_chat_command(db: Session, run: AgentRun, message: str) -> tuple[ChatMessage, list[WorkflowEvent]]:
    add_chat_message(db, run, "user", message)

    lowered = message.lower()
    assistant_content = "I logged that request. The backend workflow scaffold is ready for live discovery and execution wiring."
    phase = run.current_phase
    status = run.status

    if "rescan" in lowered:
        assistant_content = "I queued a re-scan for the selected broker sites."
        run.current_phase = "scan"
        run.status = "in_progress"
        phase = "scan"
        status = "in_progress"
    elif "submit" in lowered or "removal" in lowered:
        assistant_content = "I marked this run for approval-backed submission handling."
        run.current_phase = "approval"
        run.status = "awaiting_user"
        phase = "approval"
        status = "awaiting_user"

    assistant = add_chat_message(db, run, "assistant", assistant_content)
    event = append_event(db, run, phase=phase, status=status, message=assistant_content)
    run.updated_at = utcnow()
    db.commit()
    db.refresh(run)
    return assistant, [event]


def execute_approved_run(db: Session, run: AgentRun) -> list[WorkflowEvent]:
    try:
        result = run_langgraph_workflow(db, run, mode="execute")
    except LangGraphBridgeError as exc:
        run.current_phase = "execution"
        run.status = "blocked"
        event = append_event(
            db,
            run,
            phase="execution",
            status="blocked",
            message=f"Automation execution could not start. {exc}",
            review_reasons=["manual_submission_required"],
        )
        run.pending_review_reasons = sorted(set([*(run.pending_review_reasons or []), "manual_submission_required"]))
        run.updated_at = utcnow()
        db.commit()
        db.refresh(run)
        return [event]

    return _persist_langgraph_result(db, run, result, reset_state=False)


def submit_approval(
    db: Session,
    run: AgentRun,
    action: str,
    note: str | None,
) -> list[WorkflowEvent]:
    if action == "approve":
        run.current_phase = "execution"
        run.status = "in_progress"
        message = "User approved submission plan."
        for removal in run.removal_requests:
            if removal.status == "planned":
                removal.status = "approved"
                append_removal_status_event(
                    db,
                    removal,
                    status="approved",
                    message="User approved this removal request for execution.",
                )
        db.commit()
        db.refresh(run)
        events = execute_approved_run(db, run)
        if note:
            message = f"{message} Note: {note}"
        approval_event = append_event(db, run, phase="execution", status=run.status, message=message)
        run.updated_at = utcnow()
        db.commit()
        db.refresh(run)
        return [approval_event, *events]
    elif action == "reject":
        run.current_phase = "approval"
        run.status = "blocked"
        message = "User rejected submission plan."
        for removal in run.removal_requests:
            if removal.status in {"planned", "approved"}:
                removal.status = "rejected"
                append_removal_status_event(
                    db,
                    removal,
                    status="rejected",
                    message="User rejected this removal request.",
                )
    else:
        run.current_phase = "approval"
        run.status = "awaiting_user"
        message = "User requested changes to the submission plan."

    if note:
        message = f"{message} Note: {note}"

    event = append_event(db, run, phase=run.current_phase, status=run.status, message=message)
    run.updated_at = utcnow()
    db.commit()
    db.refresh(run)
    return [event]


def build_monitored_target_set(run: AgentRun, profile_id: str | None = None) -> MonitoredTargetSetRead:
    profile_name = run.profile.full_name
    latest_outcome_by_candidate = {
        str(outcome.get("candidateId")): dict(outcome)
        for outcome in (run.outcomes or [])
        if outcome.get("candidateId")
    }
    targets = []
    needs_attention_count = 0
    active_count = 0
    for candidate in run.candidates or []:
        candidate_id = str(candidate.get("candidateId"))
        site_id = str(candidate.get("siteId"))
        listing_url = str(candidate.get("listingUrl"))
        outcome = latest_outcome_by_candidate.get(candidate_id, {})
        latest_status = str(outcome.get("status") or run.status)
        if latest_status in {"failed", "needs_follow_up"} or "manual_submission_required" in (run.pending_review_reasons or []):
            monitoring_status = "manual_review"
            needs_attention_count += 1
        elif latest_status in {"submitted", "pending"}:
            monitoring_status = "awaiting_confirmation"
            active_count += 1
        else:
            monitoring_status = "scheduled"
            active_count += 1
        targets.append(
            {
                "siteId": site_id,
                "candidateId": candidate_id,
                "candidateUrl": listing_url,
                "monitoringStatus": monitoring_status,
                "latestStatus": latest_status,
                "triggerNewRemovalCycle": False,
            }
        )

    status = "needs_attention" if needs_attention_count > 0 else "active" if targets else "completed"
    return MonitoredTargetSetRead(
        targetSetId=f"mts_{run.id}",
        sourceRunId=run.id,
        profileId=profile_id or run.profile.id,
        profileName=profile_name,
        status=status,
        monitoringPolicy={
            "cadenceDays": 30,
            "reReviewCooldownDays": 30,
            "reReviewListingReappearanceThreshold": 1,
        },
        targetCount=len(targets),
        activeTargetCount=active_count,
        needsAttentionCount=needs_attention_count,
        targets=targets,
        materializedFromRunAt=run.updated_at,
        createdAt=run.created_at,
        updatedAt=run.updated_at,
        storageBacked=False,
    )


def list_monitored_target_sets(db: Session) -> ListMonitoredTargetSetsResponse:
    runs = db.query(AgentRun).order_by(AgentRun.updated_at.desc()).all()
    return ListMonitoredTargetSetsResponse(
        targetSets=[build_monitored_target_set(run) for run in runs if (run.candidates or [])]
    )


def get_monitored_target_set(db: Session, target_set_id: str) -> GetMonitoredTargetSetResponse | None:
    if not target_set_id.startswith("mts_"):
        return None
    run_id = target_set_id.removeprefix("mts_")
    run = get_run(db, run_id)
    if not run:
        return None
    return GetMonitoredTargetSetResponse(targetSet=build_monitored_target_set(run))


def create_monitored_target_set_from_run(
    db: Session,
    run: AgentRun,
    profile_id: str,
) -> CreateMonitoredTargetSetFromRunResponse:
    return CreateMonitoredTargetSetFromRunResponse(
        targetSet=build_monitored_target_set(run, profile_id=profile_id)
    )


def trigger_rescan(db: Session, run: AgentRun, reason: str | None) -> list[WorkflowEvent]:
    run.current_phase = "scan"
    run.status = "in_progress"
    message = "Re-scan triggered."
    if reason:
        message = f"{message} Reason: {reason}"
    event = append_event(db, run, phase="scan", status="in_progress", message=message)
    run.updated_at = utcnow()
    db.commit()
    db.refresh(run)
    return [event]


def append_execution_result(
    db: Session,
    run: AgentRun,
    payload: AppendExecutionResultRequest,
) -> list[WorkflowEvent]:
    outcome = {
        "siteId": payload.site.lower().replace(" ", "_"),
        "candidateId": payload.candidate_url,
        "status": "needs_follow_up" if payload.status in {"pending", "manual_required"} else payload.status,
        "confirmationId": payload.ticket_ids[0] if payload.ticket_ids else None,
        "observedAt": utcnow().isoformat(),
        "evidence": [
            {
                "sourceType": "execution_log",
                "sourceUrl": payload.screenshot_ref,
                "excerpt": payload.confirmation_text or payload.error_text or f"Execution result: {payload.status}",
                "capturedAt": utcnow().isoformat(),
                "fields": [],
            }
        ],
        "reviewReasons": ["manual_submission_required"] if payload.manual_review_required else [],
    }
    site_id = payload.site.lower().replace(" ", "_")
    removal = get_or_create_removal_request(
        db,
        run,
        site_id=site_id,
        candidate_id=payload.candidate_url,
        candidate_url=payload.candidate_url,
        procedure_id=None,
        submission_channel="webform",
    )
    removal.status = payload.status
    removal.latest_ticket_id = payload.ticket_ids[0] if payload.ticket_ids else None
    removal.latest_confirmation_text = payload.confirmation_text
    removal.latest_error_text = payload.error_text
    removal.review_reasons = ["manual_submission_required"] if payload.manual_review_required else []
    append_removal_status_event(
        db,
        removal,
        status=payload.status,
        message=f"Execution result recorded for {payload.site}.",
        ticket_ids=payload.ticket_ids,
        screenshot_ref=payload.screenshot_ref,
        error_text=payload.error_text,
        confirmation_text=payload.confirmation_text,
    )
    run.outcomes = [*(run.outcomes or []), outcome]
    run.current_phase = "verification"
    run.status = "completed" if payload.status == "submitted" else "in_progress"
    event = append_event(
        db,
        run,
        phase="verification",
        status="completed" if payload.status == "submitted" else "in_progress",
        message=f"Execution result recorded for {payload.site}: {payload.status}.",
        site_id=site_id,
        candidate_id=payload.candidate_url,
        review_reasons=["manual_submission_required"] if payload.manual_review_required else [],
    )
    run.updated_at = utcnow()
    db.commit()
    db.refresh(run)
    return [event]


def plan_submission(db: Session, run: AgentRun, site: str, candidate_url: str, payload: dict) -> None:
    site_id = site.lower().replace(" ", "_")
    handoff = {
        "handoffId": f"handoff_{uuid4().hex}",
        "mode": "human_assisted",
        "requiresUserApproval": True,
        "reviewReasons": ["manual_submission_required"],
        "payload": {
            "siteId": site_id,
            "candidateId": candidate_url,
            "procedureId": payload.get("procedureId", f"proc_{site.lower().replace(' ', '_')}_draft"),
            "procedureVersion": payload.get("procedureVersion", "draft"),
            "submissionChannel": payload.get("submission_channel", "webform"),
            "fields": {field["name"]: field["value"] for field in payload.get("required_fields", [])},
            "steps": payload.get("steps", []),
            "draft": payload,
        },
        "createdAt": utcnow().isoformat(),
    }
    removal = get_or_create_removal_request(
        db,
        run,
        site_id=site_id,
        candidate_id=candidate_url,
        candidate_url=candidate_url,
        procedure_id=handoff["payload"]["procedureId"],
        submission_channel=handoff["payload"]["submissionChannel"],
    )
    removal.status = "planned"
    removal.review_reasons = ["manual_submission_required"]
    removal.request_metadata = {
        **(removal.request_metadata or {}),
        "required_fields": payload.get("required_fields", []),
        "optional_fields": payload.get("optional_fields", []),
    }
    append_removal_status_event(
        db,
        removal,
        status="planned",
        message=f"Submission plan created for {site}.",
    )
    run.handoffs = [*(run.handoffs or []), handoff]
    run.pending_review_reasons = sorted(set([*(run.pending_review_reasons or []), "manual_submission_required"]))
    run.current_phase = "approval"
    run.status = "awaiting_user"
    append_event(
        db,
        run,
        phase="approval",
        status="awaiting_user",
        message=f"Submission plan created for {site}.",
        site_id=site_id,
        candidate_id=candidate_url,
        review_reasons=["manual_submission_required"],
    )
    run.updated_at = utcnow()
    db.commit()
