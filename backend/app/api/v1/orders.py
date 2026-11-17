from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.v1.deps import get_current_user
from app.db.session import get_db
from app.models.approval import Approval
from app.models.customer import Customer
from app.models.order import OrderItem, OrderStatus, SalesOrder
from app.models.user import User, UserRole
from app.schemas.schemas import OrderCreate, OrderStatusUpdate
from app.services.email_service import email_service
from app.services.order_service import ALLOWED_TRANSITIONS, cancel_sales_order, create_sales_order

router = APIRouter(prefix="/orders", tags=["Sales Orders"])


def _num(value) -> float:
    return float(value or 0)


def serialize_order(order: SalesOrder) -> dict:
    customer = order.customer
    creator = order.creator
    approval = order.approval
    reviewer = approval.reviewer if approval else None
    items = []
    for item in order.items:
        product = item.product
        items.append(
            {
                "id": item.id,
                "order_id": item.order_id,
                "product_id": item.product_id,
                "sku": product.sku if product else "",
                "product_name": product.name if product else "",
                "category": product.category if product else "",
                "quantity": item.quantity,
                "unit_price": _num(item.unit_price),
                "subtotal": _num(item.subtotal),
            }
        )
    return {
        "id": order.id,
        "order_number": order.order_number,
        "customer_id": order.customer_id,
        "customer_name": customer.name if customer else "",
        "customer_company": customer.company_name if customer else "",
        "customer_email": customer.email if customer else "",
        "customer_phone": customer.phone if customer else "",
        "customer_shipping_address": customer.shipping_address if customer else "",
        "customer_city": customer.city if customer else "",
        "customer_state": customer.state if customer else "",
        "created_by": order.created_by,
        "created_by_name": creator.full_name if creator else "",
        "created_by_email": creator.email if creator else "",
        "order_date": order.order_date.isoformat() if order.order_date else None,
        "expected_delivery_date": order.expected_delivery_date.isoformat() if order.expected_delivery_date else None,
        "subtotal": _num(order.subtotal),
        "discount_amount": _num(order.discount_amount),
        "tax_amount": _num(order.tax_amount),
        "grand_total": _num(order.grand_total),
        "status": order.status.value,
        "notes": order.notes or "",
        "approval_id": approval.id if approval else None,
        "approval_status": approval.status.value if approval else None,
        "rejection_reason": approval.rejection_reason if approval else None,
        "reviewed_by_name": reviewer.full_name if reviewer else None,
        "reviewed_at": approval.reviewed_at.isoformat() if approval and approval.reviewed_at else None,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "updated_at": order.updated_at.isoformat() if order.updated_at else None,
        "items": items,
    }


def _order_query():
    return select(SalesOrder).options(
        joinedload(SalesOrder.customer),
        joinedload(SalesOrder.creator),
        joinedload(SalesOrder.approval).joinedload(Approval.reviewer),
        joinedload(SalesOrder.items).joinedload(OrderItem.product),
    )


def _load_order(db: Session, order_id: int) -> SalesOrder | None:
    return db.execute(_order_query().where(SalesOrder.id == order_id)).unique().scalar_one_or_none()


@router.get("")
def list_orders(
    status_filter: OrderStatus | None = Query(default=None, alias="status"),
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = _order_query().order_by(SalesOrder.created_at.desc(), SalesOrder.id.desc())
    if current_user.role == UserRole.SALES_EMPLOYEE:
        stmt = stmt.where(SalesOrder.created_by == current_user.id)
    if status_filter:
        stmt = stmt.where(SalesOrder.status == status_filter)
    if search and search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.join(Customer, Customer.id == SalesOrder.customer_id).where(
            or_(
                SalesOrder.order_number.ilike(term),
                Customer.name.ilike(term),
                Customer.company_name.ilike(term),
            )
        )
    orders = db.execute(stmt).unique().scalars().all()
    total = len(orders)
    start = (page - 1) * page_size
    page_items = orders[start : start + page_size]
    return {
        "items": [serialize_order(order) for order in page_items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def post_order(
    payload: OrderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = create_sales_order(db, payload, current_user, email_service)
    loaded = _load_order(db, order.id) or order
    return serialize_order(loaded)


@router.get("/{order_id}")
def get_order(order_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    order = _load_order(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if current_user.role == UserRole.SALES_EMPLOYEE and order.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return serialize_order(order)


@router.get("/{order_id}/items")
def get_order_items(order_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    order = _load_order(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if current_user.role == UserRole.SALES_EMPLOYEE and order.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return {"items": serialize_order(order)["items"]}


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
        cancel_sales_order(db, order_id, current_user)
        return serialize_order(_load_order(db, order_id))
    if current_user.role == UserRole.SALES_EMPLOYEE:
        raise HTTPException(status_code=403, detail="Only managers or admins can progress fulfillment status")
    order.status = payload.status
    db.commit()
    return serialize_order(_load_order(db, order_id))


@router.post("/{order_id}/cancel")
def cancel_order(order_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cancel_sales_order(db, order_id, current_user)
    loaded = _load_order(db, order_id)
    if not loaded:
        raise HTTPException(status_code=404, detail="Order not found")
    return serialize_order(loaded)
