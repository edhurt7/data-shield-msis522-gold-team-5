from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models import AgentRun, ChatMessage, Profile, WorkflowEvent
from app.schemas.agent import (
    AgentRunStateRead,
    AppendExecutionResultRequest,
    ChatMessageRead,
    SearchProfile,
    StartAgentRunRequest,
    UserIntent,
    WorkflowEventRead,
)


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


def list_runs(db: Session) -> list[AgentRunStateRead]:
    runs = db.query(AgentRun).order_by(AgentRun.created_at.desc()).all()
    return [build_run_state(run) for run in runs]


def get_run(db: Session, run_id: str) -> AgentRun | None:
    return db.get(AgentRun, run_id)


def create_run(db: Session, payload: StartAgentRunRequest) -> tuple[AgentRun, list[WorkflowEvent]]:
    profile = Profile(
        full_name=payload.seed_profile.full_name,
        city=payload.seed_profile.location.city,
        state=payload.seed_profile.location.state,
        approx_age=payload.seed_profile.approx_age,
        privacy_email=str(payload.seed_profile.privacy_email),
        consent_confirmed=payload.seed_profile.consent,
        optional_attributes=payload.seed_profile.optional.model_dump(),
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
    elif action == "reject":
        run.current_phase = "approval"
        run.status = "blocked"
        message = "User rejected submission plan."
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
    run.outcomes = [*(run.outcomes or []), outcome]
    run.current_phase = "verification"
    run.status = "completed" if payload.status == "submitted" else "in_progress"
    event = append_event(
        db,
        run,
        phase="verification",
        status="completed" if payload.status == "submitted" else "in_progress",
        message=f"Execution result recorded for {payload.site}: {payload.status}.",
        site_id=payload.site.lower().replace(" ", "_"),
        candidate_id=payload.candidate_url,
        review_reasons=["manual_submission_required"] if payload.manual_review_required else [],
    )
    run.updated_at = utcnow()
    db.commit()
    db.refresh(run)
    return [event]


def plan_submission(db: Session, run: AgentRun, site: str, candidate_url: str, payload: dict) -> None:
    handoff = {
        "handoffId": f"handoff_{uuid4().hex}",
        "mode": "human_assisted",
        "requiresUserApproval": True,
        "reviewReasons": ["manual_submission_required"],
        "payload": {
            "siteId": site.lower().replace(" ", "_"),
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
        site_id=site.lower().replace(" ", "_"),
        candidate_id=candidate_url,
        review_reasons=["manual_submission_required"],
    )
    run.updated_at = utcnow()
    db.commit()
