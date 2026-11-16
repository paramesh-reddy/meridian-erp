from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.v1.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.customer import Customer
from app.models.order import SalesOrder
from app.models.user import User, UserRole
from app.schemas.schemas import CustomerCreate

router = APIRouter(prefix="/customers", tags=["Customers"])


@router.get("")
def list_customers(
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=100),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Customer)
    if search:
        p = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Customer.name.ilike(p),
                Customer.company_name.ilike(p),
                Customer.email.ilike(p),
                Customer.phone.ilike(p),
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(Customer.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).scalars().all()
    return {
        "items": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_customer(
    payload: CustomerCreate,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    customer = Customer(**payload.model_dump())
    customer.email = customer.email.lower()
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.get("/{customer_id}")
def get_customer(customer_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    orders = db.execute(
        select(SalesOrder).where(SalesOrder.customer_id == customer_id).order_by(SalesOrder.created_at.desc())
    ).scalars().all()
    return {"customer": customer, "orders": orders}


@router.put("/{customer_id}")
def update_customer(
    customer_id: int,
    payload: CustomerCreate,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    for k, v in payload.model_dump().items():
        setattr(customer, k, v.lower() if k == "email" else v)
    db.commit()
    db.refresh(customer)
    return customer


@router.delete("/{customer_id}")
def delete_customer(
    customer_id: int,
    _: User = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)),
    db: Session = Depends(get_db),
):
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    ref_cnt = db.scalar(select(func.count(SalesOrder.id)).where(SalesOrder.customer_id == customer_id)) or 0
    if ref_cnt > 0:
        customer.is_active = False
        db.commit()
        return {"message": "Customer has existing orders and was deactivated", "deactivated": True}
    db.delete(customer)
    db.commit()
    return {"message": "Customer deleted", "deactivated": False}
