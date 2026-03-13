from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


def _serialize_datetime(value: datetime) -> str:
    normalized = value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return normalized.isoformat(timespec="seconds").replace("+00:00", "Z")


class ApiModel(BaseModel):
    model_config = ConfigDict(
        json_encoders={
            datetime: _serialize_datetime,
        },
    )


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


class SeedProfileLocation(ApiModel):
    city: str
    state: str


class SeedProfileOptional(ApiModel):
    phone_last4: str | None = None
    prior_cities: list[str] = Field(default_factory=list)


class SeedProfile(ApiModel):
    full_name: str
    name_variants: list[str] = Field(default_factory=list)
    location: SeedProfileLocation
    approx_age: str | None = None
    privacy_email: EmailStr
    optional: SeedProfileOptional = Field(default_factory=SeedProfileOptional)
    consent: Literal[True]


class SearchProfile(ApiModel):
    profileId: str
    firstName: str
    lastName: str
    middleName: str | None = None
    state: str | None = None
    city: str | None = None
    dateOfBirth: str | None = None
    proxyEmail: EmailStr | None = None


class UserIntent(ApiModel):
    requestText: str
    requestedActions: list[str]
    requestedSites: list[str] = Field(default_factory=list)
    geographicHint: str | None = None
    requiresUserApprovalBeforeSubmission: bool = True


class WorkflowEventRead(ApiModel):
    eventId: str
    runId: str
    phase: AgentRunPhase
    status: AgentRunStatus
    message: str
    createdAt: datetime
    siteId: str | None = None
    candidateId: str | None = None
    reviewReasons: list[str] = Field(default_factory=list)


class AgentRunStateRead(ApiModel):
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


class StartAgentRunRequest(ApiModel):
    seed_profile: SeedProfile
    request_text: str
    requested_sites: list[str] = Field(default_factory=list)


class StartAgentRunResponse(ApiModel):
    run: AgentRunStateRead
    events: list[WorkflowEventRead] = Field(default_factory=list)


class GetRunResponse(ApiModel):
    run: AgentRunStateRead


class ListRunsResponse(ApiModel):
    runs: list[AgentRunStateRead]


class SendChatCommandRequest(ApiModel):
    message: str


class ChatMessageRead(ApiModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    createdAt: datetime


class SendChatCommandResponse(ApiModel):
    message: ChatMessageRead
    run: AgentRunStateRead
    events: list[WorkflowEventRead] = Field(default_factory=list)


class ListChatMessagesResponse(ApiModel):
    messages: list[ChatMessageRead] = Field(default_factory=list)


class SubmitApprovalRequest(ApiModel):
    action: ApprovalAction
    siteIds: list[str] = Field(default_factory=list)
    note: str | None = None


class SubmitApprovalResponse(ApiModel):
    run: AgentRunStateRead
    events: list[WorkflowEventRead] = Field(default_factory=list)
    handoffs: list[dict[str, Any]] = Field(default_factory=list)


class TriggerRescanRequest(ApiModel):
    siteIds: list[str] = Field(default_factory=list)
    reason: str | None = None


class TriggerRescanResponse(ApiModel):
    run: AgentRunStateRead
    events: list[WorkflowEventRead] = Field(default_factory=list)


class AppendExecutionResultRequest(ApiModel):
    site: str
    candidate_url: str
    status: Literal["submitted", "pending", "failed", "manual_required"]
    manual_review_required: bool = False
    confirmation_text: str | None = None
    ticket_ids: list[str] = Field(default_factory=list)
    screenshot_ref: str | None = None
    error_text: str | None = None
    handoffId: str | None = None


class AppendExecutionResultResponse(ApiModel):
    run: AgentRunStateRead
    events: list[WorkflowEventRead] = Field(default_factory=list)


class PlanSubmissionRequest(ApiModel):
    site: str
    candidate_url: str
    payload: dict[str, Any]


class PlanSubmissionResponse(ApiModel):
    accepted: bool
    handoffs: list[dict[str, Any]] = Field(default_factory=list)


class MonitoringPolicyRead(ApiModel):
    cadenceDays: int
    reReviewCooldownDays: int
    reReviewListingReappearanceThreshold: int


class MonitoredTargetRead(ApiModel):
    siteId: str
    candidateId: str
    candidateUrl: str
    monitoringStatus: Literal["scheduled", "awaiting_confirmation", "rescan_due", "manual_review"]
    latestStatus: str
    triggerNewRemovalCycle: bool = False


class MonitoredTargetSetRead(ApiModel):
    targetSetId: str
    sourceRunId: str
    profileId: str
    profileName: str
    status: Literal["active", "needs_attention", "completed"]
    monitoringPolicy: MonitoringPolicyRead
    targetCount: int
    activeTargetCount: int
    needsAttentionCount: int
    targets: list[MonitoredTargetRead] = Field(default_factory=list)
    materializedFromRunAt: datetime
    createdAt: datetime
    updatedAt: datetime
    storageBacked: bool = False


class CreateMonitoredTargetSetFromRunRequest(ApiModel):
    profileId: str


class CreateMonitoredTargetSetFromRunResponse(ApiModel):
    targetSet: MonitoredTargetSetRead


class ListMonitoredTargetSetsResponse(ApiModel):
    targetSets: list[MonitoredTargetSetRead] = Field(default_factory=list)


class GetMonitoredTargetSetResponse(ApiModel):
    targetSet: MonitoredTargetSetRead


class ProcedureChunkRead(ApiModel):
    doc_id: str
    quote: str
    relevance_score: float | None = None
    matched_terms: list[str] = Field(default_factory=list)
    embedding_score: float | None = None


class ProcedureRecordRead(ApiModel):
    procedure_id: str
    site: str
    updated_at: datetime
    channel_hint: Literal["email", "webform", "unknown"]
    source_chunks: list[ProcedureChunkRead]
    score: float | None = None
    lexical_score: float | None = None
    embedding_score: float | None = None
    freshness_days: int | None = None
    summary: str | None = None


class ProcedureRetrievalRequest(ApiModel):
    seed_profile: dict[str, Any]
    discovery_result: dict[str, Any]
    site: str
    provided_chunks: list[ProcedureChunkRead] = Field(default_factory=list)
    registry_chunks: list[ProcedureChunkRead] = Field(default_factory=list)


class ProcedureRetrievalResponse(ApiModel):
    site: str
    retrieved_at: datetime
    procedures: list[ProcedureRecordRead] = Field(default_factory=list)


class ProcedureIngestRequest(ApiModel):
    procedure_id: str | None = None
    site: str
    channel_hint: Literal["email", "webform", "unknown"] = "unknown"
    source_uri: str = ""
    version: str = "v1"
    summary: str | None = None
    raw_text: str
    chunk_size: int = 280
    overlap: int = 40
    is_active: bool = True
    regenerate_embeddings: bool = True


class ProcedureIngestResponse(ApiModel):
    procedure_id: str
    site: str
    chunk_count: int
    version: str
    updated_at: datetime
    embedding_provider: str
    embedding_model: str


class ProcedureSearchRequest(ApiModel):
    site: str
    query: str
    limit: int = 5


class ProcedureSearchResponse(ApiModel):
    site: str
    query: str
    retrieved_at: datetime
    procedures: list[ProcedureRecordRead] = Field(default_factory=list)


class RemovalStatusEventRead(ApiModel):
    id: str
    status: str
    message: str
    ticket_ids: list[str] = Field(default_factory=list)
    screenshot_ref: str | None = None
    error_text: str | None = None
    confirmation_text: str | None = None
    created_at: datetime


class RemovalRequestRead(ApiModel):
    id: str
    run_id: str
    site_id: str
    candidate_id: str
    candidate_url: str
    procedure_id: str | None = None
    submission_channel: str
    status: str
    latest_ticket_id: str | None = None
    latest_confirmation_text: str | None = None
    latest_error_text: str | None = None
    review_reasons: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    events: list[RemovalStatusEventRead] = Field(default_factory=list)


class ListRemovalRequestsResponse(ApiModel):
    removals: list[RemovalRequestRead] = Field(default_factory=list)


class ApiError(ApiModel):
    code: str
    message: str
    details: Any | None = None

    model_config = ConfigDict(json_schema_extra={"example": {"code": "not_found", "message": "Run was not found."}})
