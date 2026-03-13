from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.agent import (
    ProcedureIngestRequest,
    ProcedureIngestResponse,
    ProcedureRetrievalRequest,
    ProcedureRetrievalResponse,
    ProcedureSearchRequest,
    ProcedureSearchResponse,
)
from app.services.procedure_service import (
    ingest_procedure_document,
    list_procedures_for_site,
    retrieve_relevant_procedures,
    search_procedure_documents,
)


router = APIRouter()


@router.post("/retrieve", response_model=ProcedureRetrievalResponse, response_model_exclude_none=True)
def retrieve_procedure_payload(
    payload: ProcedureRetrievalRequest,
    db: Session = Depends(get_db),
) -> ProcedureRetrievalResponse:
    if payload.provided_chunks:
        base_response = list_procedures_for_site(db, payload.site)
        return ProcedureRetrievalResponse(
            site=payload.site,
            retrieved_at=base_response.retrieved_at,
            procedures=[
                {
                    "procedure_id": f"{payload.site.lower()}-provided",
                    "site": payload.site,
                    "updated_at": base_response.retrieved_at,
                    "channel_hint": "unknown",
                    "source_chunks": payload.provided_chunks,
                    "score": 1.0,
                    "freshness_days": 0,
                    "summary": "Provided retrieval chunks",
                }
            ],
        )
    return retrieve_relevant_procedures(db, payload)


@router.post("/ingest", response_model=ProcedureIngestResponse, response_model_exclude_none=True)
def ingest_procedure_payload(
    payload: ProcedureIngestRequest,
    db: Session = Depends(get_db),
) -> ProcedureIngestResponse:
    return ingest_procedure_document(db, payload)


@router.post("/search", response_model=ProcedureSearchResponse, response_model_exclude_none=True)
def search_procedures(
    payload: ProcedureSearchRequest,
    db: Session = Depends(get_db),
) -> ProcedureSearchResponse:
    return search_procedure_documents(db, payload)
