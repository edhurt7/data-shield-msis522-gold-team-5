from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"profile_{uuid4().hex}")
    full_name: Mapped[str] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(120))
    state: Mapped[str] = mapped_column(String(120))
    approx_age: Mapped[str | None] = mapped_column(String(32), nullable=True)
    privacy_email: Mapped[str] = mapped_column(String(255))
    consent_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    optional_attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    runs: Mapped[list["AgentRun"]] = relationship(back_populates="profile")


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"run_{uuid4().hex}")
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id"), index=True)
    request_text: Mapped[str] = mapped_column(Text)
    requested_sites: Mapped[list[str]] = mapped_column(JSON, default=list)
    profile_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    intent_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    current_phase: Mapped[str] = mapped_column(String(64), default="intake")
    status: Mapped[str] = mapped_column(String(64), default="queued")
    consent_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    targets: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    candidates: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    match_decisions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    procedures: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    drafts: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    handoffs: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    outcomes: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    pending_review_reasons: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    profile: Mapped[Profile] = relationship(back_populates="runs")
    events: Mapped[list["WorkflowEvent"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="WorkflowEvent.created_at",
    )
    chat_messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ChatMessage.created_at",
    )
    removal_requests: Mapped[list["RemovalRequest"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="RemovalRequest.created_at",
    )


class WorkflowEvent(Base):
    __tablename__ = "workflow_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"evt_{uuid4().hex}")
    run_id: Mapped[str] = mapped_column(ForeignKey("agent_runs.id"), index=True)
    phase: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(64))
    message: Mapped[str] = mapped_column(Text)
    site_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    candidate_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    review_reasons: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    run: Mapped[AgentRun] = relationship(back_populates="events")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"chat_{uuid4().hex}")
    run_id: Mapped[str] = mapped_column(ForeignKey("agent_runs.id"), index=True)
    role: Mapped[str] = mapped_column(String(32))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    run: Mapped[AgentRun] = relationship(back_populates="chat_messages")


class RemovalRequest(Base):
    __tablename__ = "removal_requests"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"removal_{uuid4().hex}")
    run_id: Mapped[str] = mapped_column(ForeignKey("agent_runs.id"), index=True)
    site_id: Mapped[str] = mapped_column(String(120), index=True)
    candidate_id: Mapped[str] = mapped_column(String(255))
    candidate_url: Mapped[str] = mapped_column(Text)
    procedure_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    submission_channel: Mapped[str] = mapped_column(String(32), default="webform")
    status: Mapped[str] = mapped_column(String(64), default="planned")
    latest_ticket_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    latest_confirmation_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    latest_error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_reasons: Mapped[list[str]] = mapped_column(JSON, default=list)
    request_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    run: Mapped[AgentRun] = relationship(back_populates="removal_requests")
    status_events: Mapped[list["RemovalStatusEvent"]] = relationship(
        back_populates="removal_request",
        cascade="all, delete-orphan",
        order_by="RemovalStatusEvent.created_at",
    )


class RemovalStatusEvent(Base):
    __tablename__ = "removal_status_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"rem_evt_{uuid4().hex}")
    removal_request_id: Mapped[str] = mapped_column(ForeignKey("removal_requests.id"), index=True)
    status: Mapped[str] = mapped_column(String(64))
    message: Mapped[str] = mapped_column(Text)
    ticket_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    screenshot_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    confirmation_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    removal_request: Mapped[RemovalRequest] = relationship(back_populates="status_events")
