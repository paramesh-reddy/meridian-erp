def auth_headers(client, email: str, password: str = "Password123!") -> dict:
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# 1-4: Authentication & RBAC
def test_01_successful_login(client):
    r = client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "Password123!"})
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_02_invalid_password(client):
    r = client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "wrong"})
    assert r.status_code == 401


def test_03_unauthorized_access(client):
    r = client.get("/api/v1/products")
    assert r.status_code == 401


def test_04_role_based_authorization(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    r = client.post(
        "/api/v1/products",
        headers=sales_hdr,
        json={"sku": "RBAC-1", "name": "Test", "category": "Net", "unit_price": 100, "cost_price": 50},
    )
    assert r.status_code == 403


# 5-7: Products
def test_05_create_product(client):
    admin_hdr = auth_headers(client, "admin@example.com")
    r = client.post(
        "/api/v1/products",
        headers=admin_hdr,
        json={"sku": "TST-100", "name": "Sensor X", "category": "Sensors", "unit_price": 1500, "cost_price": 800, "initial_stock": 20},
    )
    assert r.status_code == 201
    assert r.json()["available_quantity"] == 20


def test_06_update_product(client):
    admin_hdr = auth_headers(client, "admin@example.com")
    r = client.put("/api/v1/products/1", headers=admin_hdr, json={"unit_price": 29900})
    assert r.status_code == 200
    assert r.json()["unit_price"] == 29900.0


def test_07_duplicate_sku_validation(client):
    admin_hdr = auth_headers(client, "admin@example.com")
    r = client.post(
        "/api/v1/products",
        headers=admin_hdr,
        json={"sku": "NET-SW-48P", "name": "Dup", "category": "Net", "unit_price": 1000, "cost_price": 500},
    )
    assert r.status_code == 409


# 8-9: Customers
def test_08_create_customer(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    r = client.post(
        "/api/v1/customers",
        headers=sales_hdr,
        json={"name": "Aria Sen", "company_name": "Aria Corp", "email": "aria@corp.in", "phone": "+91-9811122233"},
    )
    assert r.status_code == 201


def test_09_invalid_customer_email(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    r = client.post(
        "/api/v1/customers",
        headers=sales_hdr,
        json={"name": "Bad", "email": "not-an-email", "phone": "+91-9811122233"},
    )
    assert r.status_code == 422


# 10-12: Inventory
def test_10_view_inventory(client):
    hdr = auth_headers(client, "sales@example.com")
    r = client.get("/api/v1/inventory", headers=hdr)
    assert r.status_code == 200
    assert len(r.json()["items"]) >= 5


def test_11_reject_negative_stock_adjustment(client):
    admin_hdr = auth_headers(client, "admin@example.com")
    r = client.post(
        "/api/v1/inventory/adjustments",
        headers=admin_hdr,
        json={"product_id": 1, "transaction_type": "STOCK_ADJUSTMENT", "quantity_delta": -9999, "reason": "Audit"},
    )
    assert r.status_code == 409


def test_12_verify_inventory_transaction_history(client):
    admin_hdr = auth_headers(client, "admin@example.com")
    client.post(
        "/api/v1/inventory/adjustments",
        headers=admin_hdr,
        json={"product_id": 1, "transaction_type": "STOCK_IN", "quantity_delta": 5, "reason": "Restock PO"},
    )
    r = client.get("/api/v1/inventory/transactions?product_id=1", headers=admin_hdr)
    assert r.status_code == 200
    assert r.json()["total"] >= 2


# 13-17: Sales Orders
def test_13_create_valid_sales_order(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    r = client.post(
        "/api/v1/orders",
        headers=sales_hdr,
        json={"customer_id": 1, "order_date": "2026-11-16", "items": [{"product_id": 5, "quantity": 2}]},
    )
    assert r.status_code == 201


def test_14_reject_order_insufficient_stock(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    r = client.post(
        "/api/v1/orders",
        headers=sales_hdr,
        json={"customer_id": 1, "order_date": "2026-11-16", "items": [{"product_id": 1, "quantity": 5000}]},
    )
    assert r.status_code == 409


def test_15_calculate_order_total_server_side(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    r = client.post(
        "/api/v1/orders",
        headers=sales_hdr,
        json={"customer_id": 1, "order_date": "2026-11-16", "discount_amount": 500, "tax_amount": 100, "items": [{"product_id": 5, "quantity": 2}]},
    )
    # Product 5 unit_price is 4800 -> 2*4800 - 500 + 100 = 9200
    assert float(r.json()["grand_total"]) == 9200.0


def test_16_auto_confirm_below_threshold(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    r = client.post(
        "/api/v1/orders",
        headers=sales_hdr,
        json={"customer_id": 1, "order_date": "2026-11-16", "items": [{"product_id": 5, "quantity": 2}]},
    )
    assert r.json()["status"] == "CONFIRMED"


def test_17_pending_approval_above_threshold(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    r = client.post(
        "/api/v1/orders",
        headers=sales_hdr,
        json={"customer_id": 1, "order_date": "2026-11-16", "items": [{"product_id": 1, "quantity": 3}]},
    )
    assert r.json()["status"] == "PENDING_APPROVAL"


# 18-22: Approvals
def test_18_manager_approves_order_deducts_stock(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    mgr_hdr = auth_headers(client, "manager@example.com")
    client.post("/api/v1/orders", headers=sales_hdr, json={"customer_id": 1, "order_date": "2026-11-16", "items": [{"product_id": 1, "quantity": 3}]})
    app_id = client.get("/api/v1/approvals/pending", headers=mgr_hdr).json()["items"][0]["id"]
    r = client.post(f"/api/v1/approvals/{app_id}/approve", headers=mgr_hdr)
    assert r.status_code == 200
    inv = client.get("/api/v1/inventory/1", headers=mgr_hdr).json()
    assert inv["quantity_on_hand"] == 39
    assert inv["reserved_quantity"] == 0


def test_19_manager_rejects_releases_stock(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    mgr_hdr = auth_headers(client, "manager@example.com")
    client.post("/api/v1/orders", headers=sales_hdr, json={"customer_id": 1, "order_date": "2026-11-16", "items": [{"product_id": 1, "quantity": 3}]})
    app_id = client.get("/api/v1/approvals/pending", headers=mgr_hdr).json()["items"][0]["id"]
    r = client.post(f"/api/v1/approvals/{app_id}/reject", headers=mgr_hdr, json={"rejection_reason": "Excessive qty"})
    assert r.status_code == 200
    inv = client.get("/api/v1/inventory/1", headers=mgr_hdr).json()
    assert inv["quantity_on_hand"] == 42
    assert inv["reserved_quantity"] == 0


def test_20_sales_employee_cannot_approve(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    client.post("/api/v1/orders", headers=sales_hdr, json={"customer_id": 1, "order_date": "2026-11-16", "items": [{"product_id": 1, "quantity": 3}]})
    r = client.post("/api/v1/approvals/1/approve", headers=sales_hdr)
    assert r.status_code == 403


def test_21_duplicate_approval_prevented(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    mgr_hdr = auth_headers(client, "manager@example.com")
    client.post("/api/v1/orders", headers=sales_hdr, json={"customer_id": 1, "order_date": "2026-11-16", "items": [{"product_id": 1, "quantity": 3}]})
    app_id = client.get("/api/v1/approvals/pending", headers=mgr_hdr).json()["items"][0]["id"]
    assert client.post(f"/api/v1/approvals/{app_id}/approve", headers=mgr_hdr).status_code == 200
    assert client.post(f"/api/v1/approvals/{app_id}/approve", headers=mgr_hdr).status_code == 409


def test_22_rejection_requires_reason(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    mgr_hdr = auth_headers(client, "manager@example.com")
    client.post("/api/v1/orders", headers=sales_hdr, json={"customer_id": 1, "order_date": "2026-11-16", "items": [{"product_id": 1, "quantity": 3}]})
    app_id = client.get("/api/v1/approvals/pending", headers=mgr_hdr).json()["items"][0]["id"]
    r = client.post(f"/api/v1/approvals/{app_id}/reject", headers=mgr_hdr, json={"rejection_reason": ""})
    assert r.status_code == 422


# 23-25: Emails & Rollbacks
def test_23_manager_email_triggered_on_approval_request(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    client.post("/api/v1/orders", headers=sales_hdr, json={"customer_id": 1, "order_date": "2026-11-16", "items": [{"product_id": 1, "quantity": 3}]})
    assert any(e["template"] == "manager_approval_request" for e in client.sent_emails)


def test_24_employee_email_triggered_after_decision(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    mgr_hdr = auth_headers(client, "manager@example.com")
    client.post("/api/v1/orders", headers=sales_hdr, json={"customer_id": 1, "order_date": "2026-11-16", "items": [{"product_id": 1, "quantity": 3}]})
    app_id = client.get("/api/v1/approvals/pending", headers=mgr_hdr).json()["items"][0]["id"]
    client.post(f"/api/v1/approvals/{app_id}/approve", headers=mgr_hdr)
    assert any(e["template"] == "order_approved" for e in client.sent_emails)


def test_25_failed_order_transaction_rolls_back_all_items(client):
    sales_hdr = auth_headers(client, "sales@example.com")
    # First item has stock (product 5 has 64), second item exceeds stock (product 1 has 42)
    r = client.post(
        "/api/v1/orders",
        headers=sales_hdr,
        json={"customer_id": 1, "order_date": "2026-11-16", "items": [{"product_id": 5, "quantity": 4}, {"product_id": 1, "quantity": 999}]},
    )
    assert r.status_code == 409
    inv5 = client.get("/api/v1/inventory/5", headers=sales_hdr).json()
    assert inv5["quantity_on_hand"] == 64
    assert inv5["reserved_quantity"] == 0
