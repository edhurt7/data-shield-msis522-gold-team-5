from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


AgentRunPhase = Literal[
    "intake",
    "scan",
    "match",
    "retrieve_procedure",
    "draft",
    "approval",
    "execution",
    "verification",
    "logging",
    "completed",
]
AgentRunStatus = Literal["queued", "in_progress", "awaiting_user", "blocked", "completed", "failed", "canceled"]
ReviewReason = Literal[
    "ambiguous_match",
    "captcha",
    "email_confirmation_required",
    "legal_hold",
    "low_confidence_match",
    "manual_submission_required",
    "missing_required_input",
    "missing_procedure",
    "procedure_unknown",
    "contradictory_procedure",
    "rate_limited",
    "site_unreachable",
    "stale_procedure",
]
ApprovalAction = Literal["approve", "reject", "request_changes"]


class SeedProfileLocation(BaseModel):
    city: str
    state: str


class SeedProfileOptional(BaseModel):
    phone_last4: str | None = None
    prior_cities: list[str] = Field(default_factory=list)


class SeedProfile(BaseModel):
    full_name: str
    name_variants: list[str] = Field(default_factory=list)
    location: SeedProfileLocation
    approx_age: str | None = None
    privacy_email: EmailStr
    optional: SeedProfileOptional = Field(default_factory=SeedProfileOptional)
    consent: Literal[True]


class SearchProfile(BaseModel):
    profileId: str
    firstName: str
    lastName: str
    middleName: str | None = None
    state: str | None = None
    city: str | None = None
    dateOfBirth: str | None = None
    proxyEmail: EmailStr | None = None


class UserIntent(BaseModel):
    requestText: str
    requestedActions: list[str]
    requestedSites: list[str] = Field(default_factory=list)
    geographicHint: str | None = None
    requiresUserApprovalBeforeSubmission: bool = True


class WorkflowEventRead(BaseModel):
    eventId: str
    runId: str
    phase: AgentRunPhase
    status: AgentRunStatus
    message: str
    createdAt: datetime
    siteId: str | None = None
    candidateId: str | None = None
    reviewReasons: list[str] = Field(default_factory=list)


class AgentRunStateRead(BaseModel):
    runId: str
    profile: SearchProfile
    intent: UserIntent
    currentPhase: AgentRunPhase
    status: AgentRunStatus
    consentConfirmed: bool
    targets: list[dict[str, Any]] = Field(default_factory=list)
    candidates: list[dict[str, Any]] = Field(default_factory=list)
    matchDecisions: list[dict[str, Any]] = Field(default_factory=list)
    procedures: list[dict[str, Any]] = Field(default_factory=list)
    drafts: list[dict[str, Any]] = Field(default_factory=list)
    handoffs: list[dict[str, Any]] = Field(default_factory=list)
    outcomes: list[dict[str, Any]] = Field(default_factory=list)
    pendingReviewReasons: list[str] = Field(default_factory=list)
    timeline: list[WorkflowEventRead] = Field(default_factory=list)
    createdAt: datetime
    updatedAt: datetime


class StartAgentRunRequest(BaseModel):
    seed_profile: SeedProfile
    request_text: str
    requested_sites: list[str] = Field(default_factory=list)


class StartAgentRunResponse(BaseModel):
    run: AgentRunStateRead
    events: list[WorkflowEventRead] = Field(default_factory=list)


class GetRunResponse(BaseModel):
    run: AgentRunStateRead


class ListRunsResponse(BaseModel):
    runs: list[AgentRunStateRead]


class SendChatCommandRequest(BaseModel):
    message: str


class ChatMessageRead(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    createdAt: datetime


class SendChatCommandResponse(BaseModel):
    message: ChatMessageRead
    run: AgentRunStateRead
    events: list[WorkflowEventRead] = Field(default_factory=list)


class ListChatMessagesResponse(BaseModel):
    messages: list[ChatMessageRead] = Field(default_factory=list)


class SubmitApprovalRequest(BaseModel):
    action: ApprovalAction
    siteIds: list[str] = Field(default_factory=list)
    note: str | None = None


class SubmitApprovalResponse(BaseModel):
    run: AgentRunStateRead
    events: list[WorkflowEventRead] = Field(default_factory=list)
    handoffs: list[dict[str, Any]] = Field(default_factory=list)


class TriggerRescanRequest(BaseModel):
    siteIds: list[str] = Field(default_factory=list)
    reason: str | None = None


class TriggerRescanResponse(BaseModel):
    run: AgentRunStateRead
    events: list[WorkflowEventRead] = Field(default_factory=list)


class AppendExecutionResultRequest(BaseModel):
    site: str
    candidate_url: str
    status: Literal["submitted", "pending", "failed", "manual_required"]
    manual_review_required: bool = False
    confirmation_text: str | None = None
    ticket_ids: list[str] = Field(default_factory=list)
    screenshot_ref: str | None = None
    error_text: str | None = None
    handoffId: str | None = None


class AppendExecutionResultResponse(BaseModel):
    run: AgentRunStateRead
    events: list[WorkflowEventRead] = Field(default_factory=list)


class PlanSubmissionRequest(BaseModel):
    site: str
    candidate_url: str
    payload: dict[str, Any]


class PlanSubmissionResponse(BaseModel):
    accepted: bool
    handoffs: list[dict[str, Any]] = Field(default_factory=list)


class ProcedureChunkRead(BaseModel):
    doc_id: str
    quote: str


class ProcedureRecordRead(BaseModel):
    procedure_id: str
    site: str
    updated_at: datetime
    channel_hint: Literal["email", "webform", "unknown"]
    source_chunks: list[ProcedureChunkRead]


class ProcedureRetrievalRequest(BaseModel):
    seed_profile: dict[str, Any]
    discovery_result: dict[str, Any]
    site: str
    provided_chunks: list[ProcedureChunkRead] = Field(default_factory=list)
    registry_chunks: list[ProcedureChunkRead] = Field(default_factory=list)


class ProcedureRetrievalResponse(BaseModel):
    site: str
    retrieved_at: datetime
    procedures: list[ProcedureRecordRead] = Field(default_factory=list)


class ApiError(BaseModel):
    code: str
    message: str
    details: Any | None = None

    model_config = ConfigDict(json_schema_extra={"example": {"code": "not_found", "message": "Run was not found."}})
