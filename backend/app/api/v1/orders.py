from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.deps import get_current_user
from app.db.session import get_db
from app.models.order import OrderItem, OrderStatus, SalesOrder
from app.models.user import User, UserRole
from app.schemas.schemas import OrderCreate, OrderStatusUpdate
from app.services.email_service import email_service
from app.services.order_service import ALLOWED_TRANSITIONS, cancel_sales_order, create_sales_order

router = APIRouter(prefix="/orders", tags=["Sales Orders"])


@router.get("")
def list_orders(
    status_filter: OrderStatus | None = Query(default=None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(SalesOrder).order_by(SalesOrder.created_at.desc(), SalesOrder.id.desc())
    if current_user.role == UserRole.SALES_EMPLOYEE:
        stmt = stmt.where(SalesOrder.created_by == current_user.id)
    if status_filter:
        stmt = stmt.where(SalesOrder.status == status_filter)
    orders = db.execute(stmt).scalars().all()
    return {"items": orders, "total": len(orders)}


@router.post("", status_code=status.HTTP_201_CREATED)
def post_order(
    payload: OrderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return create_sales_order(db, payload, current_user, email_service)


@router.get("/{order_id}")
def get_order(order_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    order = db.get(SalesOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if current_user.role == UserRole.SALES_EMPLOYEE and order.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return order


@router.get("/{order_id}/items")
def get_order_items(order_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    order = db.get(SalesOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if current_user.role == UserRole.SALES_EMPLOYEE and order.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    items = db.execute(select(OrderItem).where(OrderItem.order_id == order_id)).scalars().all()
    return {"items": items}


@router.put("/{order_id}")
def update_order_status(
    order_id: int,
    payload: OrderStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = db.get(SalesOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if payload.status not in ALLOWED_TRANSITIONS.get(order.status, []):
        raise HTTPException(status_code=409, detail=f"Invalid transition {order.status.value} -> {payload.status.value}")
    if payload.status == OrderStatus.CANCELLED:
        return cancel_sales_order(db, order_id, current_user)
    if current_user.role == UserRole.SALES_EMPLOYEE:
        raise HTTPException(status_code=403, detail="Only managers or admins can progress fulfillment status")
    order.status = payload.status
    db.commit()
    db.refresh(order)
    return order


@router.post("/{order_id}/cancel")
def cancel_order(order_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return cancel_sales_order(db, order_id, current_user)
