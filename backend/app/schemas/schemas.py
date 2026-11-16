from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.approval import ApprovalStatus
from app.models.inventory import InventoryTransactionType
from app.models.order import OrderStatus
from app.models.product import ProductStatus
from app.models.user import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8)
    role: UserRole = UserRole.SALES_EMPLOYEE
    is_active: bool = True


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: EmailStr
    full_name: str
    role: UserRole
    is_active: bool
    created_at: datetime | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


class ProductCreate(BaseModel):
    sku: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=2, max_length=180)
    description: str = ""
    category: str = Field(min_length=2, max_length=80)
    unit_price: Decimal = Field(gt=0)
    cost_price: Decimal = Field(ge=0, default=Decimal("0.00"))
    initial_stock: int = Field(ge=0, default=0)
    minimum_stock_level: int = Field(ge=0, default=10)
    status: ProductStatus = ProductStatus.ACTIVE


class ProductUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=2, max_length=64)
    name: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = None
    category: str | None = Field(default=None, min_length=2, max_length=80)
    unit_price: Decimal | None = Field(default=None, gt=0)
    cost_price: Decimal | None = Field(default=None, ge=0)
    minimum_stock_level: int | None = Field(default=None, ge=0)
    status: ProductStatus | None = None


class CustomerCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    company_name: str = ""
    email: EmailStr
    phone: str = Field(min_length=7, max_length=32, pattern=r"^[+\d\s()-]{7,32}$")
    billing_address: str = ""
    shipping_address: str = ""
    city: str = ""
    state: str = ""
    postal_code: str = ""
    is_active: bool = True


class InventoryAdjustmentCreate(BaseModel):
    product_id: int = Field(gt=0)
    transaction_type: InventoryTransactionType
    quantity_delta: int
    reason: str = Field(min_length=3, max_length=500)


class OrderItemInput(BaseModel):
    product_id: int = Field(gt=0)
    quantity: int = Field(gt=0)


class OrderCreate(BaseModel):
    customer_id: int = Field(gt=0)
    order_date: date
    expected_delivery_date: date | None = None
    discount_amount: Decimal = Field(ge=0, default=Decimal("0.00"))
    tax_amount: Decimal = Field(ge=0, default=Decimal("0.00"))
    notes: str = ""
    items: list[OrderItemInput] = Field(min_length=1)


class OrderStatusUpdate(BaseModel):
    status: OrderStatus


class RejectOrderRequest(BaseModel):
    rejection_reason: str = Field(min_length=3, max_length=1000)


class ThresholdUpdateRequest(BaseModel):
    approval_threshold: Decimal = Field(ge=0)
    company_name: str | None = None
    currency_symbol: str | None = None
