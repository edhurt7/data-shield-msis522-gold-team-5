from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.agent import ProcedureRetrievalRequest, ProcedureRetrievalResponse
from app.services.procedure_service import list_procedures_for_site


router = APIRouter()


@router.post("/retrieve", response_model=ProcedureRetrievalResponse)
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
                }
            ],
        )
    return list_procedures_for_site(db, payload.site)
