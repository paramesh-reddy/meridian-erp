from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.v1.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.approval import Approval, ApprovalStatus
from app.models.customer import Customer
from app.models.inventory import Inventory
from app.models.order import OrderStatus, SalesOrder
from app.models.product import Product, ProductStatus
from app.models.system import EmailLog, SystemSettings
from app.models.user import User, UserRole
from app.schemas.schemas import ThresholdUpdateRequest
from app.services.email_service import email_service

router = APIRouter(tags=["Dashboard & Settings"])


@router.get("/dashboard/admin")
def admin_dashboard(_: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)), db: Session = Depends(get_db)):
    revenue = db.scalar(
        select(func.coalesce(func.sum(SalesOrder.grand_total), 0)).where(
            SalesOrder.status.in_([OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.COMPLETED])
        )
    )
    total_orders = db.scalar(select(func.count(SalesOrder.id))) or 0
    total_products = db.scalar(select(func.count(Product.id)).where(Product.status == ProductStatus.ACTIVE)) or 0
    total_customers = db.scalar(select(func.count(Customer.id)).where(Customer.is_active.is_(True))) or 0
    pending_approvals = db.scalar(select(func.count(Approval.id)).where(Approval.status == ApprovalStatus.PENDING)) or 0
    low_stock = (
        db.scalar(
            select(func.count(Inventory.id)).where(
                (Inventory.quantity_on_hand - Inventory.reserved_quantity) <= Inventory.minimum_stock_level
            )
        )
        or 0
    )
    return {
        "kpis": {
            "total_revenue": float(revenue or 0),
            "total_orders": total_orders,
            "total_products": total_products,
            "total_customers": total_customers,
            "pending_approvals": pending_approvals,
            "low_stock_products": low_stock,
        }
    }


@router.get("/dashboard/sales")
def sales_dashboard(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orders = db.execute(select(SalesOrder).where(SalesOrder.created_by == current_user.id)).scalars().all()
    confirmed = [o for o in orders if o.status in (OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.COMPLETED)]
    return {
        "kpis": {
            "total_orders": len(orders),
            "confirmed_orders": len(confirmed),
            "pending_approvals": sum(1 for o in orders if o.status == OrderStatus.PENDING_APPROVAL),
            "rejected_orders": sum(1 for o in orders if o.status == OrderStatus.REJECTED),
            "sales_value": float(sum(o.grand_total for o in confirmed)),
        },
        "recent_orders": orders[:10],
    }


@router.get("/dashboard/manager")
def manager_dashboard(_: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)), db: Session = Depends(get_db)):
    all_apps = db.execute(select(Approval)).scalars().all()
    pending = [a for a in all_apps if a.status == ApprovalStatus.PENDING]
    return {
        "kpis": {
            "pending_requests": len(pending),
            "approved_orders": sum(1 for a in all_apps if a.status == ApprovalStatus.APPROVED),
            "rejected_orders": sum(1 for a in all_apps if a.status == ApprovalStatus.REJECTED),
            "awaiting_value": float(sum(a.order_amount for a in pending)),
        },
        "pending_approvals": pending,
    }


@router.get("/settings")
def get_settings(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(SystemSettings, 1)
    if not row:
        row = SystemSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.put("/settings/approval-threshold")
def update_threshold(
    payload: ThresholdUpdateRequest,
    admin: User = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    row = db.get(SystemSettings, 1)
    if not row:
        row = SystemSettings(id=1)
        db.add(row)
    row.approval_threshold = payload.approval_threshold
    if payload.company_name:
        row.company_name = payload.company_name
    if payload.currency_symbol:
        row.currency_symbol = payload.currency_symbol
    row.updated_by = admin.id
    db.commit()
    db.refresh(row)
    return row


@router.get("/emails")
def list_email_logs(_: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)), db: Session = Depends(get_db)):
    logs = db.execute(select(EmailLog).order_by(EmailLog.created_at.desc()).limit(100)).scalars().all()
    return {"items": logs, "total": len(logs)}


@router.post("/emails/{log_id}/retry")
def retry_failed_email(
    log_id: int,
    _: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)),
    db: Session = Depends(get_db),
):
    return email_service.retry_email(db, log_id)
