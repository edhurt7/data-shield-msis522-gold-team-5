from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ProcedureDocument(Base):
    __tablename__ = "procedure_documents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    site: Mapped[str] = mapped_column(String(255), index=True)
    channel_hint: Mapped[str] = mapped_column(String(32), default="unknown")
    source_uri: Mapped[str] = mapped_column(String(500), default="")
    version: Mapped[str] = mapped_column(String(64), default="v1")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    chunks: Mapped[list["ProcedureChunk"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="ProcedureChunk.chunk_order",
    )


class ProcedureChunk(Base):
    __tablename__ = "procedure_chunks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"chunk_{uuid4().hex}")
    procedure_id: Mapped[str] = mapped_column(ForeignKey("procedure_documents.id"), index=True)
    doc_id: Mapped[str] = mapped_column(String(128))
    chunk_order: Mapped[int] = mapped_column(Integer, default=0)
    quote: Mapped[str] = mapped_column(Text)

    document: Mapped[ProcedureDocument] = relationship(back_populates="chunks")
    embeddings: Mapped[list["ProcedureChunkEmbedding"]] = relationship(
        back_populates="chunk",
        cascade="all, delete-orphan",
        order_by="ProcedureChunkEmbedding.created_at",
    )


class ProcedureChunkEmbedding(Base):
    __tablename__ = "procedure_chunk_embeddings"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"embed_{uuid4().hex}")
    chunk_id: Mapped[str] = mapped_column(ForeignKey("procedure_chunks.id"), index=True)
    provider: Mapped[str] = mapped_column(String(64), default="local_hash")
    model: Mapped[str] = mapped_column(String(128), default="local-hash-128")
    dimensions: Mapped[int] = mapped_column(Integer, default=128)
    content_hash: Mapped[str] = mapped_column(String(128), index=True)
    vector: Mapped[list[float]] = mapped_column(JSON, default=list)
    embedding_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    chunk: Mapped[ProcedureChunk] = relationship(back_populates="embeddings")
