from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.v1.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.inventory import Inventory, InventoryTransaction, InventoryTransactionType
from app.models.order import OrderItem
from app.models.product import Product, ProductStatus
from app.models.user import User, UserRole
from app.schemas.schemas import ProductCreate, ProductUpdate

router = APIRouter(prefix="/products", tags=["Products"])


def _serialize_product(p: Product) -> dict:
    inv = p.inventory
    on_hand = inv.quantity_on_hand if inv else 0
    reserved = inv.reserved_quantity if inv else 0
    return {
        "id": p.id,
        "sku": p.sku,
        "name": p.name,
        "description": p.description,
        "category": p.category,
        "unit_price": float(p.unit_price),
        "cost_price": float(p.cost_price),
        "minimum_stock_level": p.minimum_stock_level,
        "status": p.status.value,
        "quantity_on_hand": on_hand,
        "reserved_quantity": reserved,
        "available_quantity": on_hand - reserved,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }


@router.get("")
def list_products(
    search: str | None = None,
    category: str | None = None,
    status_filter: ProductStatus | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=100),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Product)
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(or_(Product.name.ilike(pattern), Product.sku.ilike(pattern)))
    if category:
        stmt = stmt.where(Product.category == category)
    if status_filter:
        stmt = stmt.where(Product.status == status_filter)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.execute(stmt.order_by(Product.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).scalars().all()
    categories = db.execute(select(Product.category).distinct().order_by(Product.category.asc())).scalars().all()

    return {
        "items": [_serialize_product(p) for p in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "categories": list(categories),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    admin: User = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    sku = payload.sku.strip().upper()
    if db.execute(select(Product).where(func.upper(Product.sku) == sku)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Product with SKU '{sku}' already exists")

    product = Product(
        sku=sku,
        name=payload.name.strip(),
        description=payload.description,
        category=payload.category.strip(),
        unit_price=payload.unit_price,
        cost_price=payload.cost_price,
        minimum_stock_level=payload.minimum_stock_level,
        status=payload.status,
    )
    db.add(product)
    db.flush()
    db.add(
        Inventory(
            product_id=product.id,
            quantity_on_hand=payload.initial_stock,
            reserved_quantity=0,
            minimum_stock_level=payload.minimum_stock_level,
        )
    )
    if payload.initial_stock > 0:
        db.add(
            InventoryTransaction(
                product_id=product.id,
                transaction_type=InventoryTransactionType.STOCK_IN,
                quantity=payload.initial_stock,
                previous_quantity=0,
                new_quantity=payload.initial_stock,
                performed_by=admin.id,
                reason="Initial product stock",
            )
        )
    db.commit()
    db.refresh(product)
    return _serialize_product(product)


@router.get("/{product_id}")
def get_product(product_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return _serialize_product(product)


@router.put("/{product_id}")
def update_product(
    product_id: int,
    payload: ProductUpdate,
    _: User = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if payload.sku:
        sku = payload.sku.strip().upper()
        dup = db.execute(select(Product).where(func.upper(Product.sku) == sku, Product.id != product_id)).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail=f"SKU '{sku}' already exists")
        product.sku = sku
    for field in ("name", "description", "category", "unit_price", "cost_price", "minimum_stock_level", "status"):
        val = getattr(payload, field)
        if val is not None:
            setattr(product, field, val)
    if payload.minimum_stock_level is not None and product.inventory:
        product.inventory.minimum_stock_level = payload.minimum_stock_level
    db.commit()
    db.refresh(product)
    return _serialize_product(product)


@router.delete("/{product_id}")
def delete_product(
    product_id: int,
    _: User = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    ref_cnt = db.scalar(select(func.count(OrderItem.id)).where(OrderItem.product_id == product_id)) or 0
    if ref_cnt > 0:
        product.status = ProductStatus.INACTIVE
        db.commit()
        return {"message": "Product is referenced by existing orders and was deactivated", "deactivated": True}
    db.delete(product)
    db.commit()
    return {"message": "Product deleted", "deactivated": False}
