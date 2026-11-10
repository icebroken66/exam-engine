"""Learning HTTP contracts; dependencies and business rules stay in their owning modules."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import tutoring
from .learning_evidence import course_learning_evidence
from .learning_sessions import (
    LearningSessionError, advance_session, create_or_resume_session, prepare_course_context,
    correct_attempt, read_learning_session, read_session_history, request_hint,
    review_current_attempt, submit_attempt,
)
from .model_gateway import ModelGateway
from .models import Course, LearningSession
from .schemas import (
    CourseContextRead, CourseLearningEvidenceRead, LearningAttemptInput,
    LearningGradeCorrectionInput, LearningGradeReviewInput, TutoringInput,
    TutoringHistoryRead, LearningProgressInput, LearningHintRead, LearningSessionHistoryRead,
    LearningSessionSummaryRead, LearningSessionRead,
)
from .dependencies import get_db, get_model_gateway

router = APIRouter()


@router.get("/api/courses/{course_id}/learning-evidence", response_model=CourseLearningEvidenceRead, tags=["learning"])
def get_learning_evidence(course_id: str, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=50),
                          db: Session = Depends(get_db)) -> dict:
    result = course_learning_evidence(db, course_id, page=page, page_size=page_size)
    if result is None:
        raise HTTPException(status_code=404, detail="课程不存在")
    return result


@router.get(
    "/api/courses/{course_id}/learning-context",
    response_model=CourseContextRead,
    tags=["learning"],
)
def get_learning_context(
    course_id: str,
    db: Session = Depends(get_db),
    gateway: ModelGateway = Depends(get_model_gateway),
) -> dict:
    try:
        return prepare_course_context(db, course_id, gateway)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.get(
    "/api/courses/{course_id}/learning-sessions/current",
    response_model=LearningSessionRead | None,
    tags=["learning"],
)
def get_current_learning_session(
    course_id: str,
    db: Session = Depends(get_db),
) -> dict | None:
    if db.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="课程不存在")
    session = db.scalar(
        select(LearningSession)
        .where(LearningSession.course_id == course_id)
        .order_by(LearningSession.created_at.desc(), LearningSession.id)
        .limit(1)
    )
    if session is None:
        return None
    try:
        return read_learning_session(db, session.id)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.post(
    "/api/courses/{course_id}/learning-sessions",
    response_model=LearningSessionRead,
    tags=["learning"],
)
def start_learning_session(
    course_id: str,
    restart: bool = False,
    db: Session = Depends(get_db),
    gateway: ModelGateway = Depends(get_model_gateway),
) -> dict:
    try:
        return create_or_resume_session(db, course_id, restart, gateway)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.get("/api/learning-sessions/{session_id}", response_model=LearningSessionRead, tags=["learning"])
def get_learning_session(session_id: str, db: Session = Depends(get_db)) -> dict:
    try:
        return read_learning_session(db, session_id)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.get("/api/courses/{course_id}/learning-sessions", response_model=list[LearningSessionSummaryRead], tags=["learning"])
def list_learning_sessions(course_id: str, db: Session = Depends(get_db)) -> list:
    if db.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="课程不存在")
    return list(db.scalars(select(LearningSession).where(LearningSession.course_id == course_id)
                           .order_by(LearningSession.created_at.desc(), LearningSession.id)).all())


@router.get("/api/learning-sessions/{session_id}/history", response_model=LearningSessionHistoryRead, tags=["learning"])
def get_learning_history(session_id: str, db: Session = Depends(get_db)) -> dict:
    try:
        return read_session_history(db, session_id)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.get("/api/learning-sessions/{session_id}/tasks/{task_id}/tutoring", response_model=TutoringHistoryRead, tags=["learning"])
def get_tutoring(session_id: str, task_id: str, db: Session = Depends(get_db)) -> dict:
    try:
        return tutoring.history(db, session_id, task_id)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.post("/api/learning-sessions/{session_id}/tutoring", response_model=TutoringHistoryRead, tags=["learning"])
def send_tutoring(session_id: str, payload: TutoringInput, db: Session = Depends(get_db), gateway: ModelGateway = Depends(get_model_gateway)) -> dict:
    try:
        return tutoring.send(db, session_id, payload, gateway)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.post("/api/learning-sessions/{session_id}/tutoring/{turn_id}/received", response_model=TutoringHistoryRead, tags=["learning"])
def receive_tutoring(session_id: str, turn_id: str, db: Session = Depends(get_db)) -> dict:
    try:
        return tutoring.acknowledge(db, session_id, turn_id)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.post("/api/learning-sessions/{session_id}/attempts", response_model=LearningSessionRead, tags=["learning"])
def create_learning_attempt(
    session_id: str,
    payload: LearningAttemptInput,
    db: Session = Depends(get_db),
    gateway: ModelGateway = Depends(get_model_gateway),
) -> dict:
    try:
        return submit_attempt(db, session_id, payload.answer, payload.duration_seconds, gateway, payload.expected_task_id, payload.expected_progress_version)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.post("/api/learning-sessions/{session_id}/attempts/{attempt_id}/review", response_model=LearningSessionRead, tags=["learning"])
def review_learning_attempt(
    session_id: str, attempt_id: str, payload: LearningGradeReviewInput,
    db: Session = Depends(get_db), gateway: ModelGateway = Depends(get_model_gateway),
) -> dict:
    try:
        return review_current_attempt(db, session_id, attempt_id, payload.reason, gateway, payload.expected_review_count)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.post("/api/learning-sessions/{session_id}/attempts/{attempt_id}/correction", response_model=LearningSessionRead, tags=["learning"])
def correct_learning_attempt(
    session_id: str, attempt_id: str, payload: LearningGradeCorrectionInput, db: Session = Depends(get_db),
) -> dict:
    try:
        return correct_attempt(db, session_id, attempt_id, payload.verdict, payload.reason, payload.expected_review_count)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.post("/api/learning-sessions/{session_id}/next", response_model=LearningSessionRead, tags=["learning"])
def next_learning_action(
    session_id: str,
    payload: LearningProgressInput | None = None,
    db: Session = Depends(get_db),
    gateway: ModelGateway = Depends(get_model_gateway),
) -> dict:
    try:
        return advance_session(db, session_id, gateway, payload.expected_task_id if payload else None, payload.expected_progress_version if payload else None)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.post("/api/learning-sessions/{session_id}/hints", response_model=LearningHintRead, tags=["learning"])
def create_learning_hint(session_id: str, payload: LearningProgressInput | None = None, db: Session = Depends(get_db)) -> dict:
    try:
        return request_hint(db, session_id, payload.expected_task_id if payload else None, payload.expected_progress_version if payload else None)
    except LearningSessionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error
