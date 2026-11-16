from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.customer import Customer
from app.models.inventory import Inventory, InventoryTransaction, InventoryTransactionType
from app.models.product import Product, ProductStatus
from app.models.system import SystemSettings
from app.models.user import User, UserRole


def seed_initial_data(db: Session) -> None:
    if db.scalar(select(User.id).limit(1)):
        return

    dev_hash = hash_password("Password123!")
    admin = User(email="admin@example.com", full_name="Arjun Mehta", password_hash=dev_hash, role=UserRole.ADMIN)
    manager = User(email="manager@example.com", full_name="Priya Nair", password_hash=dev_hash, role=UserRole.MANAGER)
    sales = User(email="sales@example.com", full_name="Rohan Sharma", password_hash=dev_hash, role=UserRole.SALES_EMPLOYEE)
    db.add_all([admin, manager, sales])
    db.flush()

    db.add(
        SystemSettings(
            id=1,
            approval_threshold=Decimal("50000.00"),
            currency_symbol="₹",
            company_name="Meridian Industrial Supply Pvt. Ltd.",
            updated_by=admin.id,
        )
    )

    sample_products = [
        ("NET-SW-48P", "Meridian 48-Port Gigabit PoE+ Switch", "Networking", Decimal("28500.00"), Decimal("19200.00"), 42, 10),
        ("SRV-RACK-2U", "Enterprise 2U Rackmount Compute Node", "Computing", Decimal("44000.00"), Decimal("31500.00"), 18, 6),
        ("SNS-THM-01", "Industrial Modbus Thermal Array Sensor", "Industrial Sensors", Decimal("6800.00"), Decimal("4100.00"), 7, 15),
        ("PWR-UPS-3K", "Online Double-Conversion 3kVA UPS", "Power Systems", Decimal("19500.00"), Decimal("13400.00"), 26, 8),
        ("PER-BAR-2D", "Rugged 2D Warehouse Barcode Scanner", "Peripherals", Decimal("4800.00"), Decimal("2850.00"), 64, 15),
    ]
    for sku, name, cat, price, cost, stock, min_lvl in sample_products:
        prod = Product(
            sku=sku,
            name=name,
            category=cat,
            unit_price=price,
            cost_price=cost,
            minimum_stock_level=min_lvl,
            status=ProductStatus.ACTIVE,
        )
        db.add(prod)
        db.flush()
        db.add(Inventory(product_id=prod.id, quantity_on_hand=stock, reserved_quantity=0, minimum_stock_level=min_lvl))
        db.add(
            InventoryTransaction(
                product_id=prod.id,
                transaction_type=InventoryTransactionType.STOCK_IN,
                quantity=stock,
                previous_quantity=0,
                new_quantity=stock,
                performed_by=admin.id,
                reason="Initial warehouse opening balance",
            )
        )

    db.add_all(
        [
            Customer(
                name="Vikramaditya Rao",
                company_name="TechNova Solutions Pvt. Ltd.",
                email="procurement@technova.in",
                phone="+91-9845011223",
                billing_address="Plot 42, Electronic City Phase 1",
                shipping_address="Plot 42, Electronic City Phase 1",
                city="Bengaluru",
                state="Karnataka",
                postal_code="560100",
            ),
            Customer(
                name="Meera Kulkarni",
                company_name="Apex Precision Manufacturing",
                email="supply@apexprecision.co.in",
                phone="+91-9822044556",
                billing_address="MIDC Chakan Industrial Area",
                shipping_address="MIDC Chakan Industrial Area",
                city="Pune",
                state="Maharashtra",
                postal_code="410501",
            ),
        ]
    )
    db.commit()


if __name__ == "__main__":
    with SessionLocal() as session:
        seed_initial_data(session)
        print("Database seeded successfully.")
