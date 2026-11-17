from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.v1.deps import require_roles
from app.db.session import get_db
from app.models.approval import Approval, ApprovalStatus
from app.models.order import OrderItem, SalesOrder
from app.models.user import User, UserRole
from app.schemas.schemas import RejectOrderRequest
from app.services.approval_service import process_approval_decision
from app.services.email_service import email_service

router = APIRouter(prefix="/approvals", tags=["Approvals"])


def _num(value) -> float:
    return float(value or 0)


def serialize_approval(approval: Approval) -> dict:
    order = approval.order
    customer = order.customer if order else None
    requester = approval.requester
    reviewer = approval.reviewer
    items = []
    if order:
        for item in order.items:
            product = item.product
            items.append(
                {
                    "id": item.id,
                    "order_id": item.order_id,
                    "product_id": item.product_id,
                    "sku": product.sku if product else "",
                    "product_name": product.name if product else "",
                    "quantity": item.quantity,
                    "unit_price": _num(item.unit_price),
                    "subtotal": _num(item.subtotal),
                }
            )
    return {
        "id": approval.id,
        "order_id": approval.order_id,
        "order_number": order.order_number if order else "",
        "order_date": order.order_date.isoformat() if order and order.order_date else None,
        "expected_delivery_date": order.expected_delivery_date.isoformat() if order and order.expected_delivery_date else None,
        "subtotal": _num(order.subtotal) if order else 0,
        "discount_amount": _num(order.discount_amount) if order else 0,
        "tax_amount": _num(order.tax_amount) if order else 0,
        "grand_total": _num(order.grand_total) if order else _num(approval.order_amount),
        "order_status": order.status.value if order else None,
        "notes": order.notes if order else "",
        "requested_by": approval.requested_by,
        "requested_by_name": requester.full_name if requester else "",
        "requested_by_email": requester.email if requester else "",
        "reviewed_by": approval.reviewed_by,
        "reviewed_by_name": reviewer.full_name if reviewer else None,
        "status": approval.status.value,
        "rejection_reason": approval.rejection_reason,
        "order_amount": _num(approval.order_amount),
        "requested_at": approval.requested_at.isoformat() if approval.requested_at else None,
        "reviewed_at": approval.reviewed_at.isoformat() if approval.reviewed_at else None,
        "customer_name": customer.name if customer else "",
        "customer_company": customer.company_name if customer else "",
        "customer_email": customer.email if customer else "",
        "customer_phone": customer.phone if customer else "",
        "customer_city": customer.city if customer else "",
        "items": items,
    }


def _approval_query():
    return select(Approval).options(
        joinedload(Approval.requester),
        joinedload(Approval.reviewer),
        joinedload(Approval.order).joinedload(SalesOrder.customer),
        joinedload(Approval.order).joinedload(SalesOrder.items).joinedload(OrderItem.product),
    )


@router.get("/pending")
def pending_approvals(_: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)), db: Session = Depends(get_db)):
    items = db.execute(
        _approval_query().where(Approval.status == ApprovalStatus.PENDING).order_by(Approval.requested_at.asc())
    ).unique().scalars().all()
    return {"items": [serialize_approval(item) for item in items], "total": len(items)}


@router.get("/history")
def approval_history(_: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)), db: Session = Depends(get_db)):
    items = db.execute(
        _approval_query()
        .where(Approval.status != ApprovalStatus.PENDING)
        .order_by(Approval.reviewed_at.desc())
    ).unique().scalars().all()
    return {"items": [serialize_approval(item) for item in items], "total": len(items)}


@router.get("/{approval_id}")
def get_approval(
    approval_id: int,
    _: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)),
    db: Session = Depends(get_db),
):
    approval = db.execute(_approval_query().where(Approval.id == approval_id)).unique().scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    return serialize_approval(approval)


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
