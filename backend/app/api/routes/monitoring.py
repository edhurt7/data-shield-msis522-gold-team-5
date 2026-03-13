from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.agent import (
    CreateMonitoredTargetSetFromRunRequest,
    CreateMonitoredTargetSetFromRunResponse,
    GetMonitoredTargetSetResponse,
    ListMonitoredTargetSetsResponse,
)
from app.services.run_service import (
    create_monitored_target_set_from_run,
    get_monitored_target_set,
    get_run,
    list_monitored_target_sets,
)


router = APIRouter()


@router.get("/target-sets", response_model=ListMonitoredTargetSetsResponse)
def get_target_sets(db: Session = Depends(get_db)) -> ListMonitoredTargetSetsResponse:
    return list_monitored_target_sets(db)


@router.get("/target-sets/{target_set_id}", response_model=GetMonitoredTargetSetResponse)
def get_target_set(target_set_id: str, db: Session = Depends(get_db)) -> GetMonitoredTargetSetResponse:
    response = get_monitored_target_set(db, target_set_id)
    if response is None:
        raise HTTPException(status_code=404, detail="Target set not found.")
    return response


@router.post("/runs/{run_id}/target-set", response_model=CreateMonitoredTargetSetFromRunResponse)
def materialize_target_set_from_run(
    run_id: str,
    payload: CreateMonitoredTargetSetFromRunRequest,
    db: Session = Depends(get_db),
) -> CreateMonitoredTargetSetFromRunResponse:
    run = get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    return create_monitored_target_set_from_run(db, run, payload.profileId)
