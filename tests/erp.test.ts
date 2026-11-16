import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { initializeSchema, seedDatabase } from '../server/db.ts';
import { EmailService, type EmailTransport } from '../server/emailService.ts';
import { createApiApp } from '../server/app.ts';

function createTestHarness(options?: { failSmtp?: boolean }) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initializeSchema(db);
  seedDatabase(db);

  const sentEmails: Array<{ to: string; subject: string; html: string }> = [];
  const mockTransport: EmailTransport = {
    async sendMail(msg) {
      if (options?.failSmtp) {
        throw new Error('Simulated SMTP connection refused');
      }
      sentEmails.push({ to: msg.to, subject: msg.subject, html: msg.html });
    },
  };

  const emailService = new EmailService(db, mockTransport);
  const app = createApiApp(db, emailService, { disableRateLimit: true });
  return { db, app, sentEmails };
}

async function loginAs(app: any, email: string, password = 'Password123!') {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.access_token as string;
}

describe('Meridian ERP Sales & Inventory Management — Full Automated Suite (26 Tests)', () => {
  let harness: ReturnType<typeof createTestHarness>;

  beforeEach(() => {
    harness = createTestHarness();
  });

  // 1-4: Authentication & RBAC
  it('1. Successful login returns JWT access and refresh tokens', async () => {
    const res = await request(harness.app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'Password123!' });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.body.user.role).toBe('ADMIN');
  });

  it('2. Invalid password returns 401 Unauthorized', async () => {
    const res = await request(harness.app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('3. Unauthorized API access without Bearer token returns 401', async () => {
    const res = await request(harness.app).get('/api/v1/products');
    expect(res.status).toBe(401);
  });

  it('4. Role-based authorization blocks Sales Employee from creating products (403)', async () => {
    const token = await loginAs(harness.app, 'sales@example.com');
    const res = await request(harness.app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ sku: 'RBAC-99', name: 'Blocked SKU', category: 'Test', unit_price: 500, cost_price: 200 });
    expect(res.status).toBe(403);
  });

  // 5-7: Products
  it('5. Admin can create a product with initial stock and transaction entry', async () => {
    const token = await loginAs(harness.app, 'admin@example.com');
    const res = await request(harness.app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sku: 'NEW-SKU-01',
        name: 'Industrial Edge Gateway',
        category: 'Networking',
        unit_price: 15500,
        cost_price: 9800,
        initial_stock: 25,
        minimum_stock_level: 5,
      });
    expect(res.status).toBe(201);
    expect(res.body.sku).toBe('NEW-SKU-01');
    expect(res.body.available_quantity).toBe(25);
  });

  it('6. Admin can update an existing product', async () => {
    const token = await loginAs(harness.app, 'admin@example.com');
    const res = await request(harness.app)
      .put('/api/v1/products/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ unit_price: 29900 });
    expect(res.status).toBe(200);
    expect(res.body.unit_price).toBe(29900);
  });

  it('7. Duplicate SKU validation returns 409 Conflict', async () => {
    const token = await loginAs(harness.app, 'admin@example.com');
    const res = await request(harness.app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ sku: 'NET-SW-48P', name: 'Duplicate SKU', category: 'Networking', unit_price: 1000, cost_price: 500 });
    expect(res.status).toBe(409);
  });

  // 8-9: Customers
  it('8. Create valid customer account', async () => {
    const token = await loginAs(harness.app, 'sales@example.com');
    const res = await request(harness.app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Karthik Rao',
        company_name: 'Kinetix Robotics',
        email: 'ops@kinetix.in',
        phone: '+91-9880011223',
        city: 'Bengaluru',
      });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('ops@kinetix.in');
  });

  it('9. Invalid customer email format is rejected with 422', async () => {
    const token = await loginAs(harness.app, 'sales@example.com');
    const res = await request(harness.app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Email', email: 'not-valid', phone: '+91-9880011223' });
    expect(res.status).toBe(422);
  });

  // 10-12: Inventory
  it('10. View inventory computes available = on_hand - reserved', async () => {
    const token = await loginAs(harness.app, 'sales@example.com');
    const res = await request(harness.app).get('/api/v1/inventory/1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.available_quantity).toBe(res.body.quantity_on_hand - res.body.reserved_quantity);
  });

  it('11. Reject stock adjustment that would create negative inventory (409)', async () => {
    const token = await loginAs(harness.app, 'admin@example.com');
    const res = await request(harness.app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        product_id: 1,
        transaction_type: 'STOCK_ADJUSTMENT',
        quantity_delta: -9999,
        reason: 'Invalid negative write-off test',
      });
    expect(res.status).toBe(409);
  });

  it('12. Stock addition creates verifiable inventory transaction history entry', async () => {
    const token = await loginAs(harness.app, 'admin@example.com');
    const adj = await request(harness.app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: 8, transaction_type: 'STOCK_IN', quantity_delta: 10, reason: 'PO-901 restock' });
    expect(adj.status).toBe(201);

    const hist = await request(harness.app)
      .get('/api/v1/inventory/transactions?product_id=8')
      .set('Authorization', `Bearer ${token}`);
    expect(hist.status).toBe(200);
    expect(hist.body.items[0].reason).toBe('PO-901 restock');
    expect(hist.body.items[0].transaction_type).toBe('STOCK_IN');
  });

  // 13-17: Sales Orders
  it('13. Create valid sales order succeeds', async () => {
    const token = await loginAs(harness.app, 'sales@example.com');
    const res = await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: 1,
        order_date: '2026-11-16',
        items: [{ product_id: 8, quantity: 2 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.order_number).toMatch(/^SO-/);
  });

  it('14. Reject order when requested quantity exceeds available stock (409)', async () => {
    const token = await loginAs(harness.app, 'sales@example.com');
    const res = await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: 1,
        order_date: '2026-11-16',
        items: [{ product_id: 1, quantity: 5000 }],
      });
    expect(res.status).toBe(409);
  });

  it('15. Backend calculates order subtotal and grand total authoritatively', async () => {
    const token = await loginAs(harness.app, 'sales@example.com');
    // Product 8 unit_price = 4800. 3 * 4800 = 14400 - 400 + 1000 = 15000
    const res = await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: 1,
        order_date: '2026-11-16',
        discount_amount: 400,
        tax_amount: 1000,
        items: [{ product_id: 8, quantity: 3 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.subtotal).toBe(14400);
    expect(res.body.grand_total).toBe(15000);
  });

  it('16. Orders at or below approval threshold auto-confirm and deduct stock immediately', async () => {
    const token = await loginAs(harness.app, 'sales@example.com');
    const beforeInv = await request(harness.app).get('/api/v1/inventory/8').set('Authorization', `Bearer ${token}`);
    const beforeOnHand = beforeInv.body.quantity_on_hand;

    const res = await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: 1,
        order_date: '2026-11-16',
        items: [{ product_id: 8, quantity: 2 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CONFIRMED');

    const afterInv = await request(harness.app).get('/api/v1/inventory/8').set('Authorization', `Bearer ${token}`);
    expect(afterInv.body.quantity_on_hand).toBe(beforeOnHand - 2);
  });

  it('17. Orders above approval threshold enter PENDING_APPROVAL and reserve stock', async () => {
    const token = await loginAs(harness.app, 'sales@example.com');
    const beforeInv = await request(harness.app).get('/api/v1/inventory/1').set('Authorization', `Bearer ${token}`);
    const beforeReserved = beforeInv.body.reserved_quantity;

    // Product 1 unit_price = 28500 -> 2 * 28500 = 57000 > 50000 threshold
    const res = await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: 1,
        order_date: '2026-11-16',
        items: [{ product_id: 1, quantity: 2 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING_APPROVAL');

    const afterInv = await request(harness.app).get('/api/v1/inventory/1').set('Authorization', `Bearer ${token}`);
    expect(afterInv.body.reserved_quantity).toBe(beforeReserved + 2);
  });

  // 18-22: Manager Approval Workflow
  it('18. Manager approves pending order -> status CONFIRMED, reserved released & on-hand deducted', async () => {
    const salesToken = await loginAs(harness.app, 'sales@example.com');
    const mgrToken = await loginAs(harness.app, 'manager@example.com');
    const beforeInv = await request(harness.app).get('/api/v1/inventory/1').set('Authorization', `Bearer ${mgrToken}`);

    const orderRes = await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customer_id: 1, order_date: '2026-11-16', items: [{ product_id: 1, quantity: 2 }] });

    const approveRes = await request(harness.app)
      .post(`/api/v1/approvals/${orderRes.body.approval_id}/approve`)
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.orderStatus).toBe('CONFIRMED');

    const afterInv = await request(harness.app).get('/api/v1/inventory/1').set('Authorization', `Bearer ${mgrToken}`);
    expect(afterInv.body.quantity_on_hand).toBe(beforeInv.body.quantity_on_hand - 2);
    expect(afterInv.body.reserved_quantity).toBe(beforeInv.body.reserved_quantity);
  });

  it('19. Manager rejects pending order -> status REJECTED and reserved stock is released', async () => {
    const salesToken = await loginAs(harness.app, 'sales@example.com');
    const mgrToken = await loginAs(harness.app, 'manager@example.com');
    const beforeInv = await request(harness.app).get('/api/v1/inventory/1').set('Authorization', `Bearer ${mgrToken}`);

    const orderRes = await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customer_id: 1, order_date: '2026-11-16', items: [{ product_id: 1, quantity: 2 }] });

    const rejectRes = await request(harness.app)
      .post(`/api/v1/approvals/${orderRes.body.approval_id}/reject`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ rejection_reason: 'Credit limit hold on customer account' });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.orderStatus).toBe('REJECTED');

    const afterInv = await request(harness.app).get('/api/v1/inventory/1').set('Authorization', `Bearer ${mgrToken}`);
    expect(afterInv.body.quantity_on_hand).toBe(beforeInv.body.quantity_on_hand);
    expect(afterInv.body.reserved_quantity).toBe(beforeInv.body.reserved_quantity);
  });

  it('20. Sales employee cannot approve an order (403)', async () => {
    const salesToken = await loginAs(harness.app, 'sales@example.com');
    const orderRes = await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customer_id: 1, order_date: '2026-11-16', items: [{ product_id: 1, quantity: 2 }] });

    const res = await request(harness.app)
      .post(`/api/v1/approvals/${orderRes.body.approval_id}/approve`)
      .set('Authorization', `Bearer ${salesToken}`);
    expect(res.status).toBe(403);
  });

  it('21. Duplicate approval decision on same order is prevented (409)', async () => {
    const salesToken = await loginAs(harness.app, 'sales@example.com');
    const mgrToken = await loginAs(harness.app, 'manager@example.com');
    const orderRes = await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customer_id: 1, order_date: '2026-11-16', items: [{ product_id: 1, quantity: 2 }] });

    const first = await request(harness.app)
      .post(`/api/v1/approvals/${orderRes.body.approval_id}/approve`)
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(first.status).toBe(200);

    const second = await request(harness.app)
      .post(`/api/v1/approvals/${orderRes.body.approval_id}/approve`)
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(second.status).toBe(409);
  });

  it('22. Rejection without a reason fails validation (422)', async () => {
    const salesToken = await loginAs(harness.app, 'sales@example.com');
    const mgrToken = await loginAs(harness.app, 'manager@example.com');
    const orderRes = await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customer_id: 1, order_date: '2026-11-16', items: [{ product_id: 1, quantity: 2 }] });

    const res = await request(harness.app)
      .post(`/api/v1/approvals/${orderRes.body.approval_id}/reject`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ rejection_reason: '' });
    expect(res.status).toBe(422);
  });

  // 23-26: Emails, Transaction Rollback, & Cancellation Reversal
  it('23. Manager email notification is triggered when order requires approval', async () => {
    const salesToken = await loginAs(harness.app, 'sales@example.com');
    await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customer_id: 1, order_date: '2026-11-16', items: [{ product_id: 1, quantity: 2 }] });

    expect(harness.sentEmails.length).toBe(1);
    expect(harness.sentEmails[0].to).toBe('manager@example.com');
    expect(harness.sentEmails[0].subject).toContain('Approval Required');
  });

  it('24. Sales employee notification email is triggered on approval/rejection and SMTP failure does not roll back approval', async () => {
    const failHarness = createTestHarness({ failSmtp: true });
    const salesToken = await loginAs(failHarness.app, 'sales@example.com');
    const mgrToken = await loginAs(failHarness.app, 'manager@example.com');

    const orderRes = await request(failHarness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customer_id: 1, order_date: '2026-11-16', items: [{ product_id: 1, quantity: 2 }] });

    const approveRes = await request(failHarness.app)
      .post(`/api/v1/approvals/${orderRes.body.approval_id}/approve`)
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.orderStatus).toBe('CONFIRMED');

    const emailLogs = await request(failHarness.app).get('/api/v1/emails').set('Authorization', `Bearer ${mgrToken}`);
    expect(emailLogs.body.items[0].status).toBe('FAILED');
  });

  it('25. Failed multi-item order transaction rolls back stock reservation completely', async () => {
    const salesToken = await loginAs(harness.app, 'sales@example.com');
    const beforeInv8 = await request(harness.app).get('/api/v1/inventory/8').set('Authorization', `Bearer ${salesToken}`);

    // Item 1 (product 8) has plenty of stock, Item 2 (product 1) exceeds stock -> entire transaction must rollback
    const res = await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        customer_id: 1,
        order_date: '2026-11-16',
        items: [
          { product_id: 8, quantity: 4 },
          { product_id: 1, quantity: 9999 },
        ],
      });
    expect(res.status).toBe(409);

    const afterInv8 = await request(harness.app).get('/api/v1/inventory/8').set('Authorization', `Bearer ${salesToken}`);
    expect(afterInv8.body.quantity_on_hand).toBe(beforeInv8.body.quantity_on_hand);
    expect(afterInv8.body.reserved_quantity).toBe(beforeInv8.body.reserved_quantity);
  });

  it('26. Cancelling a confirmed order restores stock once and prevents duplicate restoration', async () => {
    const salesToken = await loginAs(harness.app, 'sales@example.com');
    const beforeInv8 = await request(harness.app).get('/api/v1/inventory/8').set('Authorization', `Bearer ${salesToken}`);

    const orderRes = await request(harness.app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customer_id: 1, order_date: '2026-11-16', items: [{ product_id: 8, quantity: 3 }] });
    expect(orderRes.body.status).toBe('CONFIRMED');

    const cancel1 = await request(harness.app)
      .post(`/api/v1/orders/${orderRes.body.id}/cancel`)
      .set('Authorization', `Bearer ${salesToken}`);
    expect(cancel1.status).toBe(200);

    const afterCancel = await request(harness.app).get('/api/v1/inventory/8').set('Authorization', `Bearer ${salesToken}`);
    expect(afterCancel.body.quantity_on_hand).toBe(beforeInv8.body.quantity_on_hand);

    // Duplicate cancellation must return 409 and NOT restore stock twice
    const cancel2 = await request(harness.app)
      .post(`/api/v1/orders/${orderRes.body.id}/cancel`)
      .set('Authorization', `Bearer ${salesToken}`);
    expect(cancel2.status).toBe(409);
  });
});
