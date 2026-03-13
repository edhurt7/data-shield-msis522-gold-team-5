from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import ProcedureChunk, ProcedureDocument


BUILTIN_PROCEDURES = [
    {
        "id": "fastpeoplesearch-procedure-v1",
        "site": "FastPeopleSearch",
        "updated_at": "2026-03-01T00:00:00+00:00",
        "channel_hint": "webform",
        "source_uri": "builtin://fastpeoplesearch/v1",
        "version": "v1",
        "chunks": [
            {
                "doc_id": "fps-proc-1",
                "quote": "Use the FastPeopleSearch removal webform to request record suppression.",
            },
            {
                "doc_id": "fps-proc-2",
                "quote": "Required fields: full name and privacy email. Check the consent checkbox before form submission.",
            },
        ],
    },
    {
        "id": "spokeo-procedure-v3",
        "site": "Spokeo",
        "updated_at": "2026-02-20T00:00:00+00:00",
        "channel_hint": "webform",
        "source_uri": "builtin://spokeo/v3",
        "version": "v3",
        "chunks": [
            {
                "doc_id": "spokeo-proc-1",
                "quote": "Open the Spokeo opt-out form and search for the matching profile.",
            },
            {
                "doc_id": "spokeo-proc-2",
                "quote": "Submit the webform with full name and privacy email, then confirm the request from the email link if prompted.",
            },
        ],
    },
    {
        "id": "radaris-procedure-v1",
        "site": "Radaris",
        "updated_at": "2026-02-22T00:00:00+00:00",
        "channel_hint": "email",
        "source_uri": "builtin://radaris/v1",
        "version": "v1",
        "chunks": [
            {
                "doc_id": "radaris-proc-1",
                "quote": "Email privacy@radaris.example with a removal request and the matching listing URL.",
            },
            {
                "doc_id": "radaris-proc-2",
                "quote": "Include your full name and privacy email in the email request.",
            },
        ],
    },
]


def seed_builtin_procedures(db: Session) -> None:
    for procedure in BUILTIN_PROCEDURES:
        existing = db.get(ProcedureDocument, procedure["id"])
        if existing:
            continue

        document = ProcedureDocument(
            id=procedure["id"],
            site=procedure["site"],
            channel_hint=procedure["channel_hint"],
            source_uri=procedure["source_uri"],
            version=procedure["version"],
            updated_at=datetime.fromisoformat(procedure["updated_at"]),
            created_at=datetime.now(timezone.utc),
        )
        for index, chunk in enumerate(procedure["chunks"]):
            document.chunks.append(
                ProcedureChunk(
                    doc_id=chunk["doc_id"],
                    quote=chunk["quote"],
                    chunk_order=index,
                )
            )
        db.add(document)

    db.commit()
