from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import AgentRun
from app.services.procedure_service import list_procedures_for_site


WorkflowMode = Literal["plan", "execute"]


class LangGraphBridgeError(RuntimeError):
    pass


class LangGraphWorkerUnavailableError(LangGraphBridgeError):
    pass


@dataclass
class LangGraphWorkflowResult:
    current_phase: str
    status: str
    pending_review_reasons: list[str]
    targets: list[dict[str, Any]]
    candidates: list[dict[str, Any]]
    match_decisions: list[dict[str, Any]]
    procedures: list[dict[str, Any]]
    drafts: list[dict[str, Any]]
    handoffs: list[dict[str, Any]]
    outcomes: list[dict[str, Any]]
    timeline: list[dict[str, Any]]
    removals: list[dict[str, Any]]
    monitored_target_set: dict[str, Any]
    automation_attempted: bool
    automation_error: str | None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "LangGraphWorkflowResult":
        return cls(
            current_phase=str(payload["currentPhase"]),
            status=str(payload["status"]),
            pending_review_reasons=[str(item) for item in payload.get("pendingReviewReasons", [])],
            targets=[dict(item) for item in payload.get("targets", [])],
            candidates=[dict(item) for item in payload.get("candidates", [])],
            match_decisions=[dict(item) for item in payload.get("matchDecisions", [])],
            procedures=[dict(item) for item in payload.get("procedures", [])],
            drafts=[dict(item) for item in payload.get("drafts", [])],
            handoffs=[dict(item) for item in payload.get("handoffs", [])],
            outcomes=[dict(item) for item in payload.get("outcomes", [])],
            timeline=[dict(item) for item in payload.get("timeline", [])],
            removals=[dict(item) for item in payload.get("removals", [])],
            monitored_target_set=dict(payload.get("monitoredTargetSet", {})),
            automation_attempted=bool(payload.get("automationAttempted", False)),
            automation_error=str(payload["automationError"]) if payload.get("automationError") else None,
        )


def _procedure_payloads_for_run(db: Session, run: AgentRun) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    seen: set[str] = set()
    site_names_by_id = {
        str(target.get("siteId", "")).strip().lower(): str(target.get("siteName", "")).strip()
        for target in (run.targets or [])
    }
    for requested_site in run.requested_sites or []:
        normalized = str(requested_site).strip().lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        site_name = site_names_by_id.get(normalized) or requested_site.replace("_", " ").replace("-", " ").title()
        payload = list_procedures_for_site(db, site_name)
        payloads.append(payload.model_dump(mode="json"))
    return payloads


def run_langgraph_workflow(
    db: Session,
    run: AgentRun,
    *,
    mode: WorkflowMode,
) -> LangGraphWorkflowResult:
    settings = get_settings()
    if not settings.workflow_worker_enabled:
        raise LangGraphWorkerUnavailableError("LangGraph worker is disabled in backend settings.")

    payload = {
        "mode": mode,
        "runId": run.id,
        "profileId": run.profile_id,
        "seedProfile": {
            "full_name": run.profile.full_name,
            "name_variants": list(run.profile.optional_attributes.get("name_variants", [])),
            "location": {
                "city": run.profile.city,
                "state": run.profile.state,
            },
            "approx_age": run.profile.approx_age,
            "privacy_email": run.profile.privacy_email,
            "optional": {
                "phone_last4": run.profile.optional_attributes.get("phone_last4"),
                "prior_cities": list(run.profile.optional_attributes.get("prior_cities", [])),
            },
            "consent": True,
        },
        "requestText": run.request_text,
        "requestedSites": list(run.requested_sites or []),
        "procedureResponses": _procedure_payloads_for_run(db, run),
    }

    try:
        completed = subprocess.run(
            settings.workflow_worker_command_parts,
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            cwd=settings.workflow_worker_cwd,
            check=False,
        )
    except FileNotFoundError as exc:
        raise LangGraphWorkerUnavailableError(
            f"Unable to start the LangGraph worker command: {' '.join(settings.workflow_worker_command_parts)}"
        ) from exc

    if completed.returncode != 0:
        stderr = completed.stderr.strip()
        if "No such file" in stderr or "not found" in stderr.lower():
            raise LangGraphWorkerUnavailableError(stderr or "LangGraph worker command is unavailable.")
        raise LangGraphBridgeError(stderr or completed.stdout.strip() or "LangGraph worker failed.")

    try:
        parsed = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise LangGraphBridgeError("LangGraph worker returned invalid JSON.") from exc

    return LangGraphWorkflowResult.from_payload(parsed)
