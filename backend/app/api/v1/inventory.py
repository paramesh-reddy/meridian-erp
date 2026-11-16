from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.inventory import Inventory, InventoryTransaction
from app.models.product import Product
from app.models.user import User, UserRole
from app.schemas.schemas import InventoryAdjustmentCreate
from app.services.inventory_service import adjust_inventory

router = APIRouter(prefix="/inventory", tags=["Inventory"])


def _serialize_inventory(inv: Inventory) -> dict:
    return {
        "id": inv.id,
        "product_id": inv.product_id,
        "sku": inv.product.sku,
        "product_name": inv.product.name,
        "category": inv.product.category,
        "quantity_on_hand": inv.quantity_on_hand,
        "reserved_quantity": inv.reserved_quantity,
        "available_quantity": inv.available_quantity,
        "minimum_stock_level": inv.minimum_stock_level,
        "updated_at": inv.updated_at,
    }


@router.get("")
def list_inventory(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Inventory).join(Product)).scalars().all()
    return {"items": [_serialize_inventory(i) for i in rows], "total": len(rows)}


@router.get("/low-stock")
def low_stock(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Inventory)
        .join(Product)
        .where((Inventory.quantity_on_hand - Inventory.reserved_quantity) <= Inventory.minimum_stock_level)
    ).scalars().all()
    return {"items": [_serialize_inventory(i) for i in rows], "total": len(rows)}


@router.get("/transactions")
def list_transactions(product_id: int | None = None, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(InventoryTransaction).order_by(InventoryTransaction.created_at.desc(), InventoryTransaction.id.desc())
    if product_id:
        stmt = stmt.where(InventoryTransaction.product_id == product_id)
    rows = db.execute(stmt.limit(200)).scalars().all()
    return {"items": rows, "total": len(rows)}


@router.get("/{product_id}")
def get_inventory_item(product_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    inv = db.execute(select(Inventory).where(Inventory.product_id == product_id)).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Inventory record not found")
    return _serialize_inventory(inv)


@router.post("/adjustments", status_code=status.HTTP_201_CREATED)
def post_adjustment(
    payload: InventoryAdjustmentCreate,
    reviewer: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)),
    db: Session = Depends(get_db),
):
    inv = adjust_inventory(db, payload, reviewer.id)
    return _serialize_inventory(inv)
