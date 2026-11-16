from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from app.models.approval import Approval, ApprovalStatus
from app.models.inventory import Inventory, InventoryTransaction, InventoryTransactionType
from app.models.order import OrderItem, OrderStatus, SalesOrder
from app.models.system import SystemSettings
from app.models.user import User, UserRole
from app.services.email_service import EmailService


def process_approval_decision(
    db: Session,
    approval_id: int,
    reviewer: User,
    decision: ApprovalStatus,
    mailer: EmailService,
    rejection_reason: str | None = None,
) -> Approval:
    if reviewer.role not in (UserRole.MANAGER, UserRole.ADMIN):
        raise ForbiddenError("Only Managers or Admins can approve or reject orders")
    if decision == ApprovalStatus.REJECTED and (not rejection_reason or not rejection_reason.strip()):
        raise BadRequestError("Rejection reason is mandatory")

    approval = db.execute(
        select(Approval).where(Approval.id == approval_id).with_for_update()
    ).scalar_one_or_none()
    if not approval:
        raise NotFoundError("Approval request not found")

    if approval.requested_by == reviewer.id:
        raise ForbiddenError("Users cannot approve or reject their own orders")
    if approval.status != ApprovalStatus.PENDING:
        raise ConflictError(f"Order has already been {approval.status.value.lower()}")

    order = db.execute(
        select(SalesOrder).where(SalesOrder.id == approval.order_id).with_for_update()
    ).scalar_one()
    if order.status != OrderStatus.PENDING_APPROVAL:
        raise ConflictError("Order is no longer pending approval")

    items = db.execute(select(OrderItem).where(OrderItem.order_id == order.id)).scalars().all()
    now = datetime.now(timezone.utc)

    for item in items:
        inv = db.execute(
            select(Inventory).where(Inventory.product_id == item.product_id).with_for_update()
        ).scalar_one()
        prev = inv.quantity_on_hand

        if decision == ApprovalStatus.APPROVED:
            if inv.quantity_on_hand < item.quantity or inv.reserved_quantity < item.quantity:
                raise ConflictError("Insufficient reserved inventory for approval")
            inv.quantity_on_hand -= item.quantity
            inv.reserved_quantity -= item.quantity
            db.add(
                InventoryTransaction(
                    product_id=item.product_id,
                    transaction_type=InventoryTransactionType.STOCK_DEDUCTED,
                    quantity=item.quantity,
                    reference_order_id=order.id,
                    previous_quantity=prev,
                    new_quantity=inv.quantity_on_hand,
                    performed_by=reviewer.id,
                    reason=f"Approved {order.order_number} — reserved stock deducted",
                )
            )
        else:
            inv.reserved_quantity = max(0, inv.reserved_quantity - item.quantity)
            db.add(
                InventoryTransaction(
                    product_id=item.product_id,
                    transaction_type=InventoryTransactionType.STOCK_RELEASED,
                    quantity=item.quantity,
                    reference_order_id=order.id,
                    previous_quantity=prev,
                    new_quantity=prev,
                    performed_by=reviewer.id,
                    reason=f"Rejected {order.order_number} — reserved stock released",
                )
            )

    approval.status = decision
    approval.reviewed_by = reviewer.id
    approval.reviewed_at = now
    if decision == ApprovalStatus.REJECTED:
        approval.rejection_reason = rejection_reason.strip()
        order.status = OrderStatus.REJECTED
    else:
        order.status = OrderStatus.CONFIRMED

    db.commit()
    db.refresh(approval)

    employee = db.get(User, approval.requested_by)
    settings_row = db.get(SystemSettings, 1)
    currency = settings_row.currency_symbol if settings_row else "₹"

    if employee:
        template_name = "order_approved" if decision == ApprovalStatus.APPROVED else "order_rejected"
        mailer.send_template_email(
            db=db,
            recipient=employee.email,
            subject=f"[Order {decision.value.title()}] Sales Order {order.order_number}",
            template_name=template_name,
            context={
                "order_number": order.order_number,
                "manager_name": reviewer.full_name,
                "decision_date": now.strftime("%Y-%m-%d %H:%M UTC"),
                "grand_total": f"{currency}{order.grand_total:,.2f}",
                "rejection_reason": approval.rejection_reason or "",
                "order_link": f"{settings.FRONTEND_URL}/orders/{order.id}",
            },
            reference_order_id=order.id,
        )

    return approval
