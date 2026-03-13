from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.agent import (
    AppendExecutionResultRequest,
    AppendExecutionResultResponse,
    GetRunResponse,
    ListRemovalRequestsResponse,
    ListChatMessagesResponse,
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
    list_removal_requests,
    list_chat_messages,
    create_run,
    get_run,
    handle_chat_command,
    list_runs,
    append_execution_result,
    plan_submission,
    process_run_workflow,
    submit_approval,
    trigger_rescan,
)


router = APIRouter()


@router.get("/runs", response_model=ListRunsResponse)
def get_runs(db: Session = Depends(get_db)) -> ListRunsResponse:
    return ListRunsResponse(runs=list_runs(db))


@router.post("/runs/start", response_model=StartAgentRunResponse, status_code=status.HTTP_201_CREATED)
def start_run(payload: StartAgentRunRequest, db: Session = Depends(get_db)) -> StartAgentRunResponse:
    run, events = create_run(db, payload)
    events.extend(process_run_workflow(db, run))
    state = build_run_state(run)
    return StartAgentRunResponse(run=state, events=[event for event in state.timeline if event.eventId in {item.id for item in events}])


@router.get("/runs/{run_id}", response_model=GetRunResponse)
def get_run_by_id(run_id: str, db: Session = Depends(get_db)) -> GetRunResponse:
    run = get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    return GetRunResponse(run=build_run_state(run))


@router.get("/runs/{run_id}/messages", response_model=ListChatMessagesResponse)
def get_run_messages(run_id: str, db: Session = Depends(get_db)) -> ListChatMessagesResponse:
    run = get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    return list_chat_messages(run)


@router.get("/runs/{run_id}/removals", response_model=ListRemovalRequestsResponse)
def get_run_removals(run_id: str, db: Session = Depends(get_db)) -> ListRemovalRequestsResponse:
    run = get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    return list_removal_requests(db, run_id)


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
    events = trigger_rescan(db, run, payload.reason)
    events.extend(process_run_workflow(db, run, reset_state=True))
    refreshed = get_run(db, run_id)
    assert refreshed is not None
    state = build_run_state(refreshed)
    return TriggerRescanResponse(run=state, events=[event for event in state.timeline if event.eventId in {item.id for item in events}])


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
