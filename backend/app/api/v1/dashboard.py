from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.api.v1.deps import get_current_user, require_roles
from app.core.config import settings as app_settings
from app.db.session import get_db
from app.models.approval import Approval, ApprovalStatus
from app.models.customer import Customer
from app.models.inventory import Inventory
from app.models.order import OrderItem, OrderStatus, SalesOrder
from app.models.product import Product, ProductStatus
from app.models.system import EmailLog, SystemSettings
from app.models.user import User, UserRole
from app.schemas.schemas import ThresholdUpdateRequest
from app.services.email_service import email_service

router = APIRouter(tags=["Dashboard & Settings"])

FULFILLED = (OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.COMPLETED)


def _num(value) -> float:
    return float(value or 0)


def _month(value) -> str:
    return value.strftime("%Y-%m") if value else ""


def _settings_payload(row: SystemSettings) -> dict:
    smtp_user = app_settings.SMTP_USER
    configured = bool(
        app_settings.SMTP_HOST
        and smtp_user
        and app_settings.SMTP_PASSWORD
        and smtp_user != "your_email@example.com"
    )
    return {
        "id": row.id,
        "approval_threshold": _num(row.approval_threshold),
        "currency_symbol": row.currency_symbol,
        "company_name": row.company_name,
        "updated_at": row.updated_at,
        "smtp_configured": configured,
        "smtp_host": app_settings.SMTP_HOST,
        "manager_email": app_settings.MANAGER_EMAIL,
    }


def _load_orders(db: Session, user_id: int | None = None) -> list[SalesOrder]:
    stmt = (
        select(SalesOrder)
        .options(
            joinedload(SalesOrder.customer),
            joinedload(SalesOrder.creator),
            joinedload(SalesOrder.approval),
        )
        .order_by(SalesOrder.created_at.desc(), SalesOrder.id.desc())
    )
    if user_id is not None:
        stmt = stmt.where(SalesOrder.created_by == user_id)
    return list(db.execute(stmt).unique().scalars().all())


def _order_summary(order: SalesOrder) -> dict:
    return {
        "id": order.id,
        "order_number": order.order_number,
        "order_date": order.order_date.isoformat() if order.order_date else None,
        "grand_total": _num(order.grand_total),
        "status": order.status.value,
        "customer_name": order.customer.name if order.customer else "",
        "customer_company": order.customer.company_name if order.customer else "",
        "sales_rep": order.creator.full_name if order.creator else "",
        "rejection_reason": order.approval.rejection_reason if order.approval else None,
    }


def _approval_summary(approval: Approval) -> dict:
    order = approval.order
    customer = order.customer if order else None
    return {
        "id": approval.id,
        "order_id": approval.order_id,
        "order_number": order.order_number if order else "",
        "order_amount": _num(approval.order_amount),
        "requested_at": approval.requested_at.isoformat() if approval.requested_at else None,
        "reviewed_at": approval.reviewed_at.isoformat() if approval.reviewed_at else None,
        "status": approval.status.value,
        "customer_name": customer.name if customer else "",
        "customer_company": customer.company_name if customer else "",
        "requested_by_name": approval.requester.full_name if approval.requester else "",
        "reviewed_by_name": approval.reviewer.full_name if approval.reviewer else None,
    }


@router.get("/dashboard/admin")
def admin_dashboard(_: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)), db: Session = Depends(get_db)):
    orders = _load_orders(db)
    fulfilled = [order for order in orders if order.status in FULFILLED]
    total_products = db.scalar(select(func.count(Product.id)).where(Product.status == ProductStatus.ACTIVE)) or 0
    total_customers = db.scalar(select(func.count(Customer.id)).where(Customer.is_active.is_(True))) or 0

    monthly: dict[str, dict[str, float | int]] = defaultdict(lambda: {"revenue": 0.0, "order_count": 0})
    status_counts: dict[str, dict[str, float | int]] = defaultdict(lambda: {"count": 0, "value": 0.0})
    for order in orders:
        status_row = status_counts[order.status.value]
        status_row["count"] = int(status_row["count"]) + 1
        status_row["value"] = float(status_row["value"]) + _num(order.grand_total)
    for order in fulfilled:
        bucket = monthly[_month(order.order_date)]
        bucket["revenue"] = float(bucket["revenue"]) + _num(order.grand_total)
        bucket["order_count"] = int(bucket["order_count"]) + 1

    product_totals: dict[int, dict] = {}
    sold_rows = db.execute(
        select(OrderItem, Product)
        .join(Product, Product.id == OrderItem.product_id)
        .join(SalesOrder, SalesOrder.id == OrderItem.order_id)
        .where(SalesOrder.status.in_(FULFILLED))
    ).all()
    for item, product in sold_rows:
        row = product_totals.setdefault(
            product.id, {"name": product.name, "sku": product.sku, "units_sold": 0, "revenue": 0.0}
        )
        row["units_sold"] += item.quantity
        row["revenue"] += _num(item.subtotal)
    top_products = sorted(product_totals.values(), key=lambda row: row["revenue"], reverse=True)[:5]

    inventories = db.execute(select(Inventory).options(joinedload(Inventory.product))).unique().scalars().all()
    by_category: dict[str, dict[str, int]] = defaultdict(lambda: {"on_hand": 0, "reserved": 0, "available": 0})
    low_stock_products = []
    low_stock_count = 0
    for inventory in inventories:
        product = inventory.product
        if not product or product.status != ProductStatus.ACTIVE:
            continue
        available = inventory.quantity_on_hand - inventory.reserved_quantity
        bucket = by_category[product.category]
        bucket["on_hand"] += inventory.quantity_on_hand
        bucket["reserved"] += inventory.reserved_quantity
        bucket["available"] += available
        if available <= inventory.minimum_stock_level:
            low_stock_count += 1
            low_stock_products.append(
                {
                    "product_id": product.id,
                    "sku": product.sku,
                    "name": product.name,
                    "category": product.category,
                    "quantity_on_hand": inventory.quantity_on_hand,
                    "reserved_quantity": inventory.reserved_quantity,
                    "available_quantity": available,
                    "minimum_stock_level": inventory.minimum_stock_level,
                }
            )
    low_stock_products.sort(key=lambda row: row["available_quantity"])

    pending = db.execute(
        select(Approval)
        .options(
            joinedload(Approval.order).joinedload(SalesOrder.customer),
            joinedload(Approval.requester),
        )
        .where(Approval.status == ApprovalStatus.PENDING)
        .order_by(Approval.requested_at.asc())
    ).unique().scalars().all()

    return {
        "kpis": {
            "total_revenue": sum(_num(order.grand_total) for order in fulfilled),
            "total_orders": len(orders),
            "total_products": total_products,
            "total_customers": total_customers,
            "pending_approvals": len(pending),
            "low_stock_products": low_stock_count,
        },
        "charts": {
            "monthly_revenue": [
                {"month": month, "revenue": data["revenue"], "order_count": data["order_count"]}
                for month, data in sorted(monthly.items())
            ],
            "status_distribution": [
                {"status": status, "count": data["count"], "value": data["value"]}
                for status, data in status_counts.items()
            ],
            "top_products": top_products,
            "inventory_by_category": [{"category": category, **values} for category, values in by_category.items()],
        },
        "tables": {
            "recent_orders": [_order_summary(order) for order in orders[:6]],
            "pending_approvals": [_approval_summary(item) for item in pending[:5]],
            "low_stock_products": low_stock_products[:6],
        },
    }


@router.get("/dashboard/sales")
def sales_dashboard(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orders = _load_orders(db, current_user.id)
    confirmed = [order for order in orders if order.status in FULFILLED]
    monthly: dict[str, dict[str, float | int]] = defaultdict(lambda: {"revenue": 0.0, "order_count": 0})
    for order in confirmed:
        bucket = monthly[_month(order.order_date)]
        bucket["revenue"] = float(bucket["revenue"]) + _num(order.grand_total)
        bucket["order_count"] = int(bucket["order_count"]) + 1
    return {
        "kpis": {
            "total_orders": len(orders),
            "confirmed_orders": len(confirmed),
            "pending_approvals": sum(1 for order in orders if order.status == OrderStatus.PENDING_APPROVAL),
            "rejected_orders": sum(1 for order in orders if order.status == OrderStatus.REJECTED),
            "sales_value": sum(_num(order.grand_total) for order in confirmed),
        },
        "recent_orders": [_order_summary(order) for order in orders[:10]],
        "monthly_sales": [
            {"month": month, "revenue": data["revenue"], "order_count": data["order_count"]}
            for month, data in sorted(monthly.items())
        ],
    }


@router.get("/dashboard/manager")
def manager_dashboard(_: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)), db: Session = Depends(get_db)):
    approvals = db.execute(
        select(Approval)
        .options(
            joinedload(Approval.order).joinedload(SalesOrder.customer),
            joinedload(Approval.requester),
            joinedload(Approval.reviewer),
        )
        .order_by(Approval.requested_at.asc())
    ).unique().scalars().all()
    pending = [item for item in approvals if item.status == ApprovalStatus.PENDING]
    history = [item for item in approvals if item.status != ApprovalStatus.PENDING]
    history.sort(key=lambda item: item.reviewed_at or item.requested_at, reverse=True)
    return {
        "kpis": {
            "pending_requests": len(pending),
            "approved_orders": sum(1 for item in approvals if item.status == ApprovalStatus.APPROVED),
            "rejected_orders": sum(1 for item in approvals if item.status == ApprovalStatus.REJECTED),
            "awaiting_value": sum(_num(item.order_amount) for item in pending),
        },
        "pending_approvals": [_approval_summary(item) for item in pending],
        "recent_history": [_approval_summary(item) for item in history[:8]],
    }


@router.get("/dashboard/notifications")
def notifications(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = []
    if current_user.role in (UserRole.ADMIN, UserRole.MANAGER):
        pending = db.execute(
            select(Approval)
            .options(joinedload(Approval.order).joinedload(SalesOrder.customer))
            .where(Approval.status == ApprovalStatus.PENDING)
            .order_by(Approval.requested_at.desc())
            .limit(5)
        ).unique().scalars().all()
        for approval in pending:
            order = approval.order
            company = order.customer.company_name if order and order.customer else ""
            items.append(
                {
                    "id": f"app-{approval.id}",
                    "type": "APPROVAL",
                    "title": f"Approval needed: {order.order_number if order else approval.order_id}",
                    "subtitle": f"{company} — ₹{_num(approval.order_amount):,.2f}",
                    "link": f"/approvals/{approval.id}",
                }
            )
    else:
        recent = db.execute(
            select(SalesOrder)
            .where(
                SalesOrder.created_by == current_user.id,
                SalesOrder.status.in_(
                    [OrderStatus.CONFIRMED, OrderStatus.REJECTED, OrderStatus.PENDING_APPROVAL]
                ),
            )
            .order_by(SalesOrder.updated_at.desc())
            .limit(5)
        ).scalars().all()
        for order in recent:
            items.append(
                {
                    "id": f"ord-{order.id}",
                    "type": "ORDER",
                    "title": f"{order.order_number} · {order.status.value.replace('_', ' ')}",
                    "subtitle": "Click to view order details",
                    "link": f"/orders/{order.id}",
                }
            )

    low_stock = db.execute(
        select(Inventory)
        .options(joinedload(Inventory.product))
        .join(Product)
        .where(
            Product.status == ProductStatus.ACTIVE,
            (Inventory.quantity_on_hand - Inventory.reserved_quantity) <= Inventory.minimum_stock_level,
        )
        .limit(4)
    ).scalars().all()
    for inventory in low_stock:
        product = inventory.product
        if not product:
            continue
        available = inventory.quantity_on_hand - inventory.reserved_quantity
        items.append(
            {
                "id": f"low-{product.id}",
                "type": "LOW_STOCK",
                "title": f"Low stock: {product.sku}",
                "subtitle": f"{product.name} ({available} units left)",
                "link": "/inventory",
            }
        )
    return {"items": items, "count": len(items)}


@router.get("/reports/summary")
def reports_summary(_: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)), db: Session = Depends(get_db)):
    category_sales: dict[str, dict] = {}
    rows = db.execute(
        select(OrderItem, Product)
        .join(Product, Product.id == OrderItem.product_id)
        .join(SalesOrder, SalesOrder.id == OrderItem.order_id)
        .where(SalesOrder.status.in_(FULFILLED))
    ).all()
    for item, product in rows:
        row = category_sales.setdefault(
            product.category,
            {"category": product.category, "total_units": 0, "revenue": 0.0, "estimated_gross_profit": 0.0},
        )
        row["total_units"] += item.quantity
        row["revenue"] += _num(item.subtotal)
        row["estimated_gross_profit"] += (_num(item.unit_price) - _num(product.cost_price)) * item.quantity

    valuation: dict[str, dict] = {}
    inventories = db.execute(select(Inventory).options(joinedload(Inventory.product))).unique().scalars().all()
    for inventory in inventories:
        product = inventory.product
        if not product or product.status != ProductStatus.ACTIVE:
            continue
        row = valuation.setdefault(
            product.category,
            {"category": product.category, "total_units": 0, "cost_valuation": 0.0, "retail_valuation": 0.0},
        )
        row["total_units"] += inventory.quantity_on_hand
        row["cost_valuation"] += inventory.quantity_on_hand * _num(product.cost_price)
        row["retail_valuation"] += inventory.quantity_on_hand * _num(product.unit_price)

    reps = db.execute(select(User).where(User.role == UserRole.SALES_EMPLOYEE)).scalars().all()
    rep_orders = db.execute(select(SalesOrder)).scalars().all()
    performance = []
    for rep in reps:
        owned = [order for order in rep_orders if order.created_by == rep.id]
        confirmed = [order for order in owned if order.status in FULFILLED]
        performance.append(
            {
                "full_name": rep.full_name,
                "email": rep.email,
                "total_orders": len(owned),
                "confirmed_orders": len(confirmed),
                "total_revenue": sum(_num(order.grand_total) for order in confirmed),
            }
        )

    return {
        "category_sales": sorted(category_sales.values(), key=lambda row: row["revenue"], reverse=True),
        "inventory_valuation": list(valuation.values()),
        "sales_rep_performance": performance,
    }


@router.get("/settings")
def get_settings(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(SystemSettings, 1)
    if not row:
        row = SystemSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return _settings_payload(row)


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
    return _settings_payload(row)


@router.get("/emails")
def list_email_logs(_: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)), db: Session = Depends(get_db)):
    logs = db.execute(select(EmailLog).order_by(EmailLog.created_at.desc()).limit(100)).scalars().all()
    order_ids = [log.reference_order_id for log in logs if log.reference_order_id]
    numbers = {}
    if order_ids:
        rows = db.execute(select(SalesOrder.id, SalesOrder.order_number).where(SalesOrder.id.in_(order_ids))).all()
        numbers = {row.id: row.order_number for row in rows}
    items = [
        {
            "id": log.id,
            "recipient": log.recipient,
            "subject": log.subject,
            "template_name": log.template_name,
            "body_html": log.body_html,
            "reference_order_id": log.reference_order_id,
            "order_number": numbers.get(log.reference_order_id),
            "status": log.status.value,
            "error_message": log.error_message,
            "retry_count": log.retry_count,
            "created_at": log.created_at,
            "sent_at": log.sent_at,
        }
        for log in logs
    ]
    return {"items": items, "total": len(items)}


@router.post("/emails/{log_id}/retry")
def retry_failed_email(
    log_id: int,
    _: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)),
    db: Session = Depends(get_db),
):
    log = email_service.retry_email(db, log_id)
    return {"status": log.status.value, "error_message": log.error_message}
