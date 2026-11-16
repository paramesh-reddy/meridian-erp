from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from app.models.approval import Approval, ApprovalStatus
from app.models.customer import Customer
from app.models.inventory import Inventory, InventoryTransaction, InventoryTransactionType
from app.models.order import OrderItem, OrderStatus, SalesOrder
from app.models.product import Product, ProductStatus
from app.models.system import SystemSettings
from app.models.user import User, UserRole
from app.schemas.schemas import OrderCreate
from app.services.email_service import EmailService

ALLOWED_TRANSITIONS: dict[OrderStatus, list[OrderStatus]] = {
    OrderStatus.DRAFT: [OrderStatus.PENDING_APPROVAL, OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
    OrderStatus.PENDING_APPROVAL: [OrderStatus.CONFIRMED, OrderStatus.REJECTED],
    OrderStatus.CONFIRMED: [OrderStatus.PROCESSING, OrderStatus.COMPLETED, OrderStatus.CANCELLED],
    OrderStatus.REJECTED: [],
    OrderStatus.PROCESSING: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
    OrderStatus.COMPLETED: [],
    OrderStatus.CANCELLED: [],
}


def create_sales_order(db: Session, payload: OrderCreate, user: User, mailer: EmailService) -> SalesOrder:
    customer = db.get(Customer, payload.customer_id)
    if not customer:
        raise NotFoundError("Customer not found")
    if not customer.is_active:
        raise BadRequestError("Cannot create order for inactive customer")

    # Aggregate quantities per product
    aggregated: dict[int, int] = {}
    for item in payload.items:
        aggregated[item.product_id] = aggregated.get(item.product_id, 0) + item.quantity

    settings_row = db.get(SystemSettings, 1)
    threshold = settings_row.approval_threshold if settings_row else Decimal("50000.00")
    currency = settings_row.currency_symbol if settings_row else "₹"

    subtotal = Decimal("0.00")
    resolved_lines: list[tuple[Product, Inventory, int, Decimal]] = []

    # Lock inventory rows deterministically in product_id order to prevent deadlocks and overselling
    for product_id in sorted(aggregated.keys()):
        qty = aggregated[product_id]
        product = db.get(Product, product_id)
        if not product:
            raise NotFoundError(f"Product #{product_id} not found")
        if product.status != ProductStatus.ACTIVE:
            raise BadRequestError(f"Product '{product.name}' is inactive")

        inv = db.execute(
            select(Inventory).where(Inventory.product_id == product_id).with_for_update()
        ).scalar_one_or_none()
        if not inv or inv.available_quantity < qty:
            avail = inv.available_quantity if inv else 0
            raise ConflictError(f"Insufficient stock for '{product.name}'. Available: {avail}, Requested: {qty}")

        line_sub = (product.unit_price * qty).quantize(Decimal("0.01"))
        subtotal += line_sub
        resolved_lines.append((product, inv, qty, line_sub))

    if payload.discount_amount > subtotal:
        raise BadRequestError("Discount cannot exceed subtotal")

    grand_total = (subtotal - payload.discount_amount + payload.tax_amount).quantize(Decimal("0.01"))
    requires_approval = grand_total > threshold
    order_status = OrderStatus.PENDING_APPROVAL if requires_approval else OrderStatus.CONFIRMED

    next_seq = (db.scalar(select(func.coalesce(func.max(SalesOrder.id), 0))) or 0) + 1001
    order_number = f"SO-{datetime.now(timezone.utc).year}-{next_seq}"

    order = SalesOrder(
        order_number=order_number,
        customer_id=customer.id,
        created_by=user.id,
        order_date=payload.order_date,
        expected_delivery_date=payload.expected_delivery_date,
        subtotal=subtotal,
        discount_amount=payload.discount_amount,
        tax_amount=payload.tax_amount,
        grand_total=grand_total,
        status=order_status,
        notes=payload.notes.strip(),
    )
    db.add(order)
    db.flush()

    for product, inv, qty, line_sub in resolved_lines:
        db.add(
            OrderItem(
                order_id=order.id,
                product_id=product.id,
                quantity=qty,
                unit_price=product.unit_price,
                subtotal=line_sub,
            )
        )
        prev_qty = inv.quantity_on_hand
        if requires_approval:
            inv.reserved_quantity += qty
            db.add(
                InventoryTransaction(
                    product_id=product.id,
                    transaction_type=InventoryTransactionType.STOCK_RESERVED,
                    quantity=qty,
                    reference_order_id=order.id,
                    previous_quantity=prev_qty,
                    new_quantity=prev_qty,
                    performed_by=user.id,
                    reason=f"Reserved pending approval for {order_number}",
                )
            )
        else:
            inv.quantity_on_hand -= qty
            db.add(
                InventoryTransaction(
                    product_id=product.id,
                    transaction_type=InventoryTransactionType.STOCK_DEDUCTED,
                    quantity=qty,
                    reference_order_id=order.id,
                    previous_quantity=prev_qty,
                    new_quantity=inv.quantity_on_hand,
                    performed_by=user.id,
                    reason=f"Auto-confirmed {order_number} below threshold",
                )
            )

    approval = None
    if requires_approval:
        approval = Approval(
            order_id=order.id,
            requested_by=user.id,
            status=ApprovalStatus.PENDING,
            order_amount=grand_total,
        )
        db.add(approval)

    db.commit()
    db.refresh(order)

    if requires_approval and approval:
        manager = db.execute(
            select(User).where(User.role == UserRole.MANAGER, User.is_active.is_(True)).limit(1)
        ).scalar_one_or_none()
        recipient = manager.email if manager else settings.MANAGER_EMAIL
        mailer.send_template_email(
            db=db,
            recipient=recipient,
            subject=f"[Approval Required] Sales Order {order.order_number}",
            template_name="manager_approval_request",
            context={
                "order_number": order.order_number,
                "customer_name": customer.company_name or customer.name,
                "employee_name": user.full_name,
                "order_date": str(order.order_date),
                "grand_total": f"{currency}{grand_total:,.2f}",
                "items": [
                    {
                        "name": f"{p.name} ({p.sku})",
                        "quantity": qty,
                        "subtotal": f"{currency}{line_sub:,.2f}",
                    }
                    for p, _, qty, line_sub in resolved_lines
                ],
                "approval_link": f"{settings.FRONTEND_URL}/approvals/{approval.id}",
            },
            reference_order_id=order.id,
        )

    return order


def cancel_sales_order(db: Session, order_id: int, user: User) -> SalesOrder:
    order = db.execute(select(SalesOrder).where(SalesOrder.id == order_id).with_for_update()).scalar_one_or_none()
    if not order:
        raise NotFoundError("Sales order not found")
    if user.role == UserRole.SALES_EMPLOYEE and order.created_by != user.id:
        raise ForbiddenError("You can only cancel your own orders")
    if order.status in (OrderStatus.CANCELLED, OrderStatus.COMPLETED, OrderStatus.REJECTED):
        raise ConflictError(f"Orders in status {order.status.value} cannot be cancelled")

    items = db.execute(select(OrderItem).where(OrderItem.order_id == order.id)).scalars().all()
    for item in items:
        inv = db.execute(
            select(Inventory).where(Inventory.product_id == item.product_id).with_for_update()
        ).scalar_one()
        prev = inv.quantity_on_hand
        if order.status == OrderStatus.PENDING_APPROVAL:
            inv.reserved_quantity = max(0, inv.reserved_quantity - item.quantity)
            db.add(
                InventoryTransaction(
                    product_id=item.product_id,
                    transaction_type=InventoryTransactionType.STOCK_RELEASED,
                    quantity=item.quantity,
                    reference_order_id=order.id,
                    previous_quantity=prev,
                    new_quantity=prev,
                    performed_by=user.id,
                    reason=f"Cancelled pending order {order.order_number}",
                )
            )
        elif order.status in (OrderStatus.CONFIRMED, OrderStatus.PROCESSING):
            inv.quantity_on_hand += item.quantity
            db.add(
                InventoryTransaction(
                    product_id=item.product_id,
                    transaction_type=InventoryTransactionType.STOCK_IN,
                    quantity=item.quantity,
                    reference_order_id=order.id,
                    previous_quantity=prev,
                    new_quantity=inv.quantity_on_hand,
                    performed_by=user.id,
                    reason=f"Cancelled confirmed order {order.order_number} — stock restored",
                )
            )

    order.status = OrderStatus.CANCELLED
    db.commit()
    db.refresh(order)
    return order
