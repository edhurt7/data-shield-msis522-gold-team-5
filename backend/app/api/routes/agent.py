from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.agent import (
    AppendExecutionResultRequest,
    AppendExecutionResultResponse,
    GetRunResponse,
    ListRunsResponse,
    PlanSubmissionRequest,
    PlanSubmissionResponse,
    SendChatCommandRequest,
    SendChatCommandResponse,
    StartAgentRunRequest,
    StartAgentRunResponse,
    SubmitApprovalRequest,
    SubmitApprovalResponse,
    TriggerRescanRequest,
    TriggerRescanResponse,
)
from app.services.run_service import (
    build_chat_message,
    build_run_state,
    create_run,
    get_run,
    handle_chat_command,
    list_runs,
    plan_submission,
    append_execution_result,
    submit_approval,
    trigger_rescan,
)


router = APIRouter()


@router.get("/runs", response_model=ListRunsResponse)
def get_runs(db: Session = Depends(get_db)) -> ListRunsResponse:
    return ListRunsResponse(runs=list_runs(db))


@router.post("/runs/start", response_model=StartAgentRunResponse, status_code=status.HTTP_201_CREATED)
def start_run(payload: StartAgentRunRequest, db: Session = Depends(get_db)) -> StartAgentRunResponse:
    run, _events = create_run(db, payload)
    state = build_run_state(run)
    return StartAgentRunResponse(run=state, events=state.timeline[-1:])


@router.get("/runs/{run_id}", response_model=GetRunResponse)
def get_run_by_id(run_id: str, db: Session = Depends(get_db)) -> GetRunResponse:
    run = get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    return GetRunResponse(run=build_run_state(run))


@router.post("/runs/{run_id}/chat", response_model=SendChatCommandResponse)
def send_chat_command(
    run_id: str,
    payload: SendChatCommandRequest,
    db: Session = Depends(get_db),
) -> SendChatCommandResponse:
    run = get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    assistant, _events = handle_chat_command(db, run, payload.message)
    refreshed = get_run(db, run_id)
    assert refreshed is not None
    state = build_run_state(refreshed)
    return SendChatCommandResponse(
        message=build_chat_message(assistant),
        run=state,
        events=state.timeline[-1:],
    )


@router.post("/runs/{run_id}/approval", response_model=SubmitApprovalResponse)
def approve_run(
    run_id: str,
    payload: SubmitApprovalRequest,
    db: Session = Depends(get_db),
) -> SubmitApprovalResponse:
    run = get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    submit_approval(db, run, payload.action, payload.note)
    refreshed = get_run(db, run_id)
    assert refreshed is not None
    state = build_run_state(refreshed)
    return SubmitApprovalResponse(run=state, events=state.timeline[-1:], handoffs=state.handoffs)


@router.post("/runs/{run_id}/rescan", response_model=TriggerRescanResponse)
def rescan_run(
    run_id: str,
    payload: TriggerRescanRequest,
    db: Session = Depends(get_db),
) -> TriggerRescanResponse:
    run = get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    trigger_rescan(db, run, payload.reason)
    refreshed = get_run(db, run_id)
    assert refreshed is not None
    state = build_run_state(refreshed)
    return TriggerRescanResponse(run=state, events=state.timeline[-1:])


@router.post("/runs/{run_id}/execution-results", response_model=AppendExecutionResultResponse)
def add_execution_result(
    run_id: str,
    payload: AppendExecutionResultRequest,
    db: Session = Depends(get_db),
) -> AppendExecutionResultResponse:
    run = get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    append_execution_result(db, run, payload)
    refreshed = get_run(db, run_id)
    assert refreshed is not None
    state = build_run_state(refreshed)
    return AppendExecutionResultResponse(run=state, events=state.timeline[-1:])


@router.post("/runs/{run_id}/plan-submission", response_model=PlanSubmissionResponse)
def create_submission_plan(
    run_id: str,
    payload: PlanSubmissionRequest,
    db: Session = Depends(get_db),
) -> PlanSubmissionResponse:
    run = get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    plan_submission(db, run, payload.site, payload.candidate_url, payload.payload)
    refreshed = get_run(db, run_id)
    assert refreshed is not None
    state = build_run_state(refreshed)
    return PlanSubmissionResponse(accepted=True, handoffs=state.handoffs[-1:])
