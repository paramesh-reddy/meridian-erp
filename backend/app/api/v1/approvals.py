from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.deps import require_roles
from app.db.session import get_db
from app.models.approval import Approval, ApprovalStatus
from app.models.user import User, UserRole
from app.schemas.schemas import RejectOrderRequest
from app.services.approval_service import process_approval_decision
from app.services.email_service import email_service

router = APIRouter(prefix="/approvals", tags=["Approvals"])


@router.get("/pending")
def pending_approvals(_: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)), db: Session = Depends(get_db)):
    items = db.execute(
        select(Approval).where(Approval.status == ApprovalStatus.PENDING).order_by(Approval.requested_at.asc())
    ).scalars().all()
    return {"items": items, "total": len(items)}


@router.get("/history")
def approval_history(_: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)), db: Session = Depends(get_db)):
    items = db.execute(
        select(Approval).where(Approval.status != ApprovalStatus.PENDING).order_by(Approval.reviewed_at.desc())
    ).scalars().all()
    return {"items": items, "total": len(items)}


@router.get("/{approval_id}")
def get_approval(
    approval_id: int,
    _: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)),
    db: Session = Depends(get_db),
):
    approval = db.get(Approval, approval_id)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    return approval


@router.post("/{approval_id}/approve")
def approve_order(
    approval_id: int,
    reviewer: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)),
    db: Session = Depends(get_db),
):
    return process_approval_decision(db, approval_id, reviewer, ApprovalStatus.APPROVED, email_service)


@router.post("/{approval_id}/reject")
def reject_order(
    approval_id: int,
    payload: RejectOrderRequest,
    reviewer: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)),
    db: Session = Depends(get_db),
):
    return process_approval_decision(
        db, approval_id, reviewer, ApprovalStatus.REJECTED, email_service, payload.rejection_reason
    )
