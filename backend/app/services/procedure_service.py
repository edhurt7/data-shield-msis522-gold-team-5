from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session, selectinload

from app.models import ProcedureDocument
from app.schemas.agent import ProcedureRetrievalResponse


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def list_procedures_for_site(db: Session, site: str) -> ProcedureRetrievalResponse:
    documents = (
        db.query(ProcedureDocument)
        .options(selectinload(ProcedureDocument.chunks))
        .filter(ProcedureDocument.site.ilike(site))
        .order_by(ProcedureDocument.updated_at.desc())
        .all()
    )

    procedures = []
    for document in documents:
        procedures.append(
            {
                "procedure_id": document.id,
                "site": document.site,
                "updated_at": document.updated_at,
                "channel_hint": document.channel_hint,
                "source_chunks": [
                    {
                        "doc_id": chunk.doc_id,
                        "quote": chunk.quote,
                    }
                    for chunk in document.chunks
                ],
            }
        )

    return ProcedureRetrievalResponse(
        site=site,
        retrieved_at=utcnow(),
        procedures=procedures,
    )
