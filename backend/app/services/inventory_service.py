from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError, ConflictError, NotFoundError
from app.models.inventory import Inventory, InventoryTransaction, InventoryTransactionType
from app.schemas.schemas import InventoryAdjustmentCreate


def adjust_inventory(db: Session, payload: InventoryAdjustmentCreate, user_id: int) -> Inventory:
    if payload.transaction_type not in (
        InventoryTransactionType.STOCK_IN,
        InventoryTransactionType.STOCK_ADJUSTMENT,
    ):
        raise BadRequestError("Manual adjustments only support STOCK_IN or STOCK_ADJUSTMENT")
    if payload.quantity_delta == 0:
        raise BadRequestError("Quantity delta cannot be zero")
    if payload.transaction_type == InventoryTransactionType.STOCK_IN and payload.quantity_delta <= 0:
        raise BadRequestError("STOCK_IN quantity must be positive")

    inv = db.execute(
        select(Inventory).where(Inventory.product_id == payload.product_id).with_for_update()
    ).scalar_one_or_none()
    if not inv:
        raise NotFoundError("Inventory record not found for product")

    new_on_hand = inv.quantity_on_hand + payload.quantity_delta
    if new_on_hand < 0:
        raise ConflictError(f"Adjustment would create negative inventory ({new_on_hand})")
    if new_on_hand < inv.reserved_quantity:
        raise ConflictError(
            f"Quantity on hand ({new_on_hand}) cannot fall below reserved quantity ({inv.reserved_quantity})"
        )

    prev = inv.quantity_on_hand
    inv.quantity_on_hand = new_on_hand
    tx = InventoryTransaction(
        product_id=payload.product_id,
        transaction_type=payload.transaction_type,
        quantity=abs(payload.quantity_delta),
        reference_order_id=None,
        previous_quantity=prev,
        new_quantity=new_on_hand,
        performed_by=user_id,
        reason=payload.reason.strip(),
    )
    db.add(tx)
    db.commit()
    db.refresh(inv)
    return inv
