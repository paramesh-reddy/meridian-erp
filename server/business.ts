import type { DatabaseSync } from 'node:sqlite';
import { runInTransaction } from './db.ts';
import type { EmailService } from './emailService.ts';
import { renderApprovalRequestHtml, renderOrderDecisionHtml } from './emailService.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type OrderStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'CANCELLED';

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CONFIRMED', 'CANCELLED'],
  PENDING_APPROVAL: ['CONFIRMED', 'REJECTED'],
  CONFIRMED: ['PROCESSING', 'COMPLETED', 'CANCELLED'],
  REJECTED: [],
  PROCESSING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function formatCurrency(amount: number, symbol = '₹'): string {
  return `${symbol}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function adjustInventory(
  db: DatabaseSync,
  params: {
    productId: number;
    transactionType: 'STOCK_IN' | 'STOCK_ADJUSTMENT';
    quantityDelta: number;
    reason: string;
    performedBy: number;
  }
) {
  return runInTransaction(db, () => {
    const inv = db
      .prepare('SELECT id, product_id, quantity_on_hand, reserved_quantity, minimum_stock_level FROM inventory WHERE product_id = ?')
      .get(params.productId) as
      | {
          id: number;
          product_id: number;
          quantity_on_hand: number;
          reserved_quantity: number;
          minimum_stock_level: number;
        }
      | undefined;

    if (!inv) {
      throw new HttpError(404, 'Inventory record not found for this product');
    }

    if (params.transactionType === 'STOCK_IN' && params.quantityDelta <= 0) {
      throw new HttpError(400, 'Stock addition quantity must be greater than zero');
    }
    if (params.quantityDelta === 0) {
      throw new HttpError(400, 'Adjustment quantity cannot be zero');
    }

    const newQuantityOnHand = inv.quantity_on_hand + params.quantityDelta;
    if (newQuantityOnHand < 0) {
      throw new HttpError(409, `Adjustment would result in negative stock (${newQuantityOnHand})`);
    }
    if (newQuantityOnHand < inv.reserved_quantity) {
      throw new HttpError(
        409,
        `Cannot reduce quantity on hand (${newQuantityOnHand}) below reserved stock (${inv.reserved_quantity})`
      );
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE inventory SET quantity_on_hand = ?, updated_at = ? WHERE product_id = ?').run(
      newQuantityOnHand,
      now,
      params.productId
    );

    const txRes = db
      .prepare(
        `INSERT INTO inventory_transactions
         (product_id, transaction_type, quantity, reference_order_id, previous_quantity, new_quantity, performed_by, reason, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`
      )
      .run(
        params.productId,
        params.transactionType,
        Math.abs(params.quantityDelta),
        inv.quantity_on_hand,
        newQuantityOnHand,
        params.performedBy,
        params.reason.trim(),
        now
      );

    return {
      transactionId: Number(txRes.lastInsertRowid),
      productId: params.productId,
      previousQuantity: inv.quantity_on_hand,
      newQuantity: newQuantityOnHand,
      reservedQuantity: inv.reserved_quantity,
      availableQuantity: newQuantityOnHand - inv.reserved_quantity,
    };
  });
}

export async function createSalesOrder(
  db: DatabaseSync,
  emailService: EmailService,
  params: {
    customerId: number;
    createdBy: number;
    orderDate: string;
    expectedDeliveryDate?: string | null;
    discountAmount?: number;
    taxAmount?: number;
    notes?: string;
    items: Array<{ productId: number; quantity: number }>;
  }
) {
  if (!params.items || params.items.length === 0) {
    throw new HttpError(400, 'Order must contain at least one product line item');
  }

  // Merge duplicate product line items cleanly to enforce accurate stock check
  const aggregatedItems = new Map<number, number>();
  for (const item of params.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new HttpError(422, 'Product quantity must be a positive integer');
    }
    aggregatedItems.set(item.productId, (aggregatedItems.get(item.productId) || 0) + item.quantity);
  }

  const discount = Number((params.discountAmount ?? 0).toFixed(2));
  const tax = Number((params.taxAmount ?? 0).toFixed(2));
  if (discount < 0 || tax < 0) {
    throw new HttpError(422, 'Discount and tax amounts cannot be negative');
  }

  const created = runInTransaction(db, () => {
    const customer = db
      .prepare('SELECT id, name, company_name, is_active FROM customers WHERE id = ?')
      .get(params.customerId) as
      | { id: number; name: string; company_name: string; is_active: number }
      | undefined;

    if (!customer) {
      throw new HttpError(404, 'Customer not found');
    }
    if (!customer.is_active) {
      throw new HttpError(400, 'Cannot create order for an inactive customer');
    }

    const creator = db
      .prepare('SELECT id, full_name, email FROM users WHERE id = ?')
      .get(params.createdBy) as { id: number; full_name: string; email: string } | undefined;

    if (!creator) {
      throw new HttpError(404, 'Creator user not found');
    }

    const settings = db
      .prepare('SELECT approval_threshold, currency_symbol FROM system_settings WHERE id = 1')
      .get() as { approval_threshold: number; currency_symbol: string } | undefined;
    const threshold = settings?.approval_threshold ?? 50000;
    const currencySymbol = settings?.currency_symbol ?? '₹';

    let subtotal = 0;
    const resolvedItems: Array<{
      productId: number;
      name: string;
      sku: string;
      quantity: number;
      unitPrice: number;
      lineSubtotal: number;
      quantityOnHand: number;
      reservedQuantity: number;
    }> = [];

    for (const [productId, quantity] of aggregatedItems.entries()) {
      const product = db
        .prepare(
          `SELECT p.id, p.name, p.sku, p.unit_price, p.status, i.quantity_on_hand, i.reserved_quantity
           FROM products p
           JOIN inventory i ON i.product_id = p.id
           WHERE p.id = ?`
        )
        .get(productId) as
        | {
            id: number;
            name: string;
            sku: string;
            unit_price: number;
            status: string;
            quantity_on_hand: number;
            reserved_quantity: number;
          }
        | undefined;

      if (!product) {
        throw new HttpError(404, `Product #${productId} not found`);
      }
      if (product.status !== 'ACTIVE') {
        throw new HttpError(400, `Product "${product.name}" is inactive and cannot be ordered`);
      }

      const available = product.quantity_on_hand - product.reserved_quantity;
      if (quantity > available) {
        throw new HttpError(
          409,
          `Insufficient available stock for "${product.name}" (SKU: ${product.sku}). Available: ${available}, Requested: ${quantity}`
        );
      }

      const lineSubtotal = Number((product.unit_price * quantity).toFixed(2));
      subtotal = Number((subtotal + lineSubtotal).toFixed(2));
      resolvedItems.push({
        productId,
        name: product.name,
        sku: product.sku,
        quantity,
        unitPrice: product.unit_price,
        lineSubtotal,
        quantityOnHand: product.quantity_on_hand,
        reservedQuantity: product.reserved_quantity,
      });
    }

    if (discount > subtotal) {
      throw new HttpError(422, 'Discount cannot exceed order subtotal');
    }

    const grandTotal = Number((subtotal - discount + tax).toFixed(2));
    const requiresApproval = grandTotal > threshold;
    const status: OrderStatus = requiresApproval ? 'PENDING_APPROVAL' : 'CONFIRMED';

    const now = new Date().toISOString();
    const seqRow = db.prepare('SELECT COALESCE(MAX(id), 0) + 1001 as next_num FROM sales_orders').get() as {
      next_num: number;
    };
    const orderNumber = `SO-${new Date().getUTCFullYear()}-${seqRow.next_num}`;

    const orderRes = db
      .prepare(
        `INSERT INTO sales_orders
         (order_number, customer_id, created_by, order_date, expected_delivery_date, subtotal, discount_amount, tax_amount, grand_total, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        orderNumber,
        params.customerId,
        params.createdBy,
        params.orderDate,
        params.expectedDeliveryDate || null,
        subtotal,
        discount,
        tax,
        grandTotal,
        status,
        (params.notes || '').trim(),
        now,
        now
      );

    const orderId = Number(orderRes.lastInsertRowid);
    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)`
    );
    const insertTx = db.prepare(
      `INSERT INTO inventory_transactions
       (product_id, transaction_type, quantity, reference_order_id, previous_quantity, new_quantity, performed_by, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const item of resolvedItems) {
      insertItem.run(orderId, item.productId, item.quantity, item.unitPrice, item.lineSubtotal);

      if (requiresApproval) {
        // Reserve stock while waiting for manager approval
        db.prepare('UPDATE inventory SET reserved_quantity = reserved_quantity + ?, updated_at = ? WHERE product_id = ?').run(
          item.quantity,
          now,
          item.productId
        );
        insertTx.run(
          item.productId,
          'STOCK_RESERVED',
          item.quantity,
          orderId,
          item.quantityOnHand,
          item.quantityOnHand,
          params.createdBy,
          `Stock reserved for pending order ${orderNumber}`,
          now
        );
      } else {
        // Below threshold: auto-confirm and deduct stock immediately
        const newOnHand = item.quantityOnHand - item.quantity;
        if (newOnHand < 0) {
          throw new HttpError(409, `Insufficient stock for ${item.name}`);
        }
        db.prepare('UPDATE inventory SET quantity_on_hand = ?, updated_at = ? WHERE product_id = ?').run(
          newOnHand,
          now,
          item.productId
        );
        insertTx.run(
          item.productId,
          'STOCK_DEDUCTED',
          item.quantity,
          orderId,
          item.quantityOnHand,
          newOnHand,
          params.createdBy,
          `Auto-confirmed order ${orderNumber} (within approval threshold)`,
          now
        );
      }
    }

    let approvalId: number | null = null;
    if (requiresApproval) {
      const appRes = db
        .prepare(
          `INSERT INTO approvals (order_id, requested_by, reviewed_by, status, rejection_reason, order_amount, requested_at, reviewed_at)
           VALUES (?, ?, NULL, 'PENDING', NULL, ?, ?, NULL)`
        )
        .run(orderId, params.createdBy, grandTotal, now);
      approvalId = Number(appRes.lastInsertRowid);
    }

    return {
      orderId,
      orderNumber,
      status,
      requiresApproval,
      approvalId,
      subtotal,
      discountAmount: discount,
      taxAmount: tax,
      grandTotal,
      currencySymbol,
      customerName: customer.company_name ? `${customer.name} (${customer.company_name})` : customer.name,
      employeeName: creator.full_name,
      resolvedItems,
    };
  });

  // Non-blocking email notification after commit when approval is required
  if (created.requiresApproval && created.approvalId) {
    const managerRow = db
      .prepare(`SELECT email FROM users WHERE role = 'MANAGER' AND is_active = 1 ORDER BY id ASC LIMIT 1`)
      .get() as { email: string } | undefined;
    const managerEmail = process.env.MANAGER_EMAIL && process.env.MANAGER_EMAIL !== 'manager@example.com'
      ? process.env.MANAGER_EMAIL
      : managerRow?.email || 'manager@example.com';

    const frontendUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000';
    const approvalLink = `${frontendUrl}/approvals/${created.approvalId}`;
    const html = renderApprovalRequestHtml({
      orderNumber: created.orderNumber,
      customerName: created.customerName,
      employeeName: created.employeeName,
      orderDate: params.orderDate,
      grandTotal: formatCurrency(created.grandTotal, created.currencySymbol),
      items: created.resolvedItems.map((i) => ({
        name: `${i.name} (${i.sku})`,
        quantity: i.quantity,
        subtotal: formatCurrency(i.lineSubtotal, created.currencySymbol),
      })),
      approvalLink,
    });

    await emailService.sendAndLog({
      recipient: managerEmail,
      subject: `[Approval Required] Sales Order ${created.orderNumber} — ${formatCurrency(created.grandTotal, created.currencySymbol)}`,
      templateName: 'manager_approval_request',
      bodyHtml: html,
      referenceOrderId: created.orderId,
    });
  }

  return created;
}

export async function decideApproval(
  db: DatabaseSync,
  emailService: EmailService,
  params: {
    approvalId: number;
    reviewerId: number;
    reviewerRole: string;
    decision: 'APPROVED' | 'REJECTED';
    rejectionReason?: string;
  }
) {
  if (params.reviewerRole !== 'MANAGER' && params.reviewerRole !== 'ADMIN') {
    throw new HttpError(403, 'Only Managers or Admins can approve or reject orders');
  }

  if (params.decision === 'REJECTED' && (!params.rejectionReason || !params.rejectionReason.trim())) {
    throw new HttpError(422, 'Rejection reason is mandatory when rejecting an order');
  }

  const outcome = runInTransaction(db, () => {
    const approval = db
      .prepare(
        `SELECT a.*, o.order_number, o.status as order_status, o.grand_total, o.created_by,
                u.email as employee_email, u.full_name as employee_name
         FROM approvals a
         JOIN sales_orders o ON o.id = a.order_id
         JOIN users u ON u.id = o.created_by
         WHERE a.id = ?`
      )
      .get(params.approvalId) as
      | {
          id: number;
          order_id: number;
          requested_by: number;
          status: string;
          order_number: string;
          order_status: OrderStatus;
          grand_total: number;
          created_by: number;
          employee_email: string;
          employee_name: string;
        }
      | undefined;

    if (!approval) {
      throw new HttpError(404, 'Approval request not found');
    }

    if (approval.requested_by === params.reviewerId && params.reviewerRole === 'SALES_EMPLOYEE') {
      throw new HttpError(403, 'Sales employees cannot approve their own orders');
    }
    if (approval.requested_by === params.reviewerId) {
      throw new HttpError(403, 'Order creator cannot approve or reject their own order');
    }

    if (approval.status !== 'PENDING' || approval.order_status !== 'PENDING_APPROVAL') {
      throw new HttpError(
        409,
        `Order ${approval.order_number} has already been ${approval.status.toLowerCase()}`
      );
    }

    const reviewer = db
      .prepare('SELECT id, full_name, email FROM users WHERE id = ?')
      .get(params.reviewerId) as { id: number; full_name: string; email: string } | undefined;

    if (!reviewer) {
      throw new HttpError(404, 'Reviewer user not found');
    }

    const settings = db
      .prepare('SELECT currency_symbol FROM system_settings WHERE id = 1')
      .get() as { currency_symbol: string } | undefined;
    const currencySymbol = settings?.currency_symbol ?? '₹';

    const items = db
      .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
      .all(approval.order_id) as Array<{ product_id: number; quantity: number }>;

    const now = new Date().toISOString();
    const insertTx = db.prepare(
      `INSERT INTO inventory_transactions
       (product_id, transaction_type, quantity, reference_order_id, previous_quantity, new_quantity, performed_by, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    if (params.decision === 'APPROVED') {
      for (const item of items) {
        const inv = db
          .prepare('SELECT quantity_on_hand, reserved_quantity FROM inventory WHERE product_id = ?')
          .get(item.product_id) as { quantity_on_hand: number; reserved_quantity: number };

        const newOnHand = inv.quantity_on_hand - item.quantity;
        const newReserved = inv.reserved_quantity - item.quantity;
        if (newOnHand < 0 || newReserved < 0) {
          throw new HttpError(
            409,
            `Inventory integrity violation while approving order ${approval.order_number}`
          );
        }

        db.prepare(
          'UPDATE inventory SET quantity_on_hand = ?, reserved_quantity = ?, updated_at = ? WHERE product_id = ?'
        ).run(newOnHand, newReserved, now, item.product_id);

        insertTx.run(
          item.product_id,
          'STOCK_DEDUCTED',
          item.quantity,
          approval.order_id,
          inv.quantity_on_hand,
          newOnHand,
          params.reviewerId,
          `Approved order ${approval.order_number} — reserved stock deducted`,
          now
        );
      }

      db.prepare(
        `UPDATE approvals SET status = 'APPROVED', reviewed_by = ?, reviewed_at = ? WHERE id = ?`
      ).run(params.reviewerId, now, params.approvalId);

      db.prepare(`UPDATE sales_orders SET status = 'CONFIRMED', updated_at = ? WHERE id = ?`).run(
        now,
        approval.order_id
      );
    } else {
      // REJECTED -> release reserved stock
      for (const item of items) {
        const inv = db
          .prepare('SELECT quantity_on_hand, reserved_quantity FROM inventory WHERE product_id = ?')
          .get(item.product_id) as { quantity_on_hand: number; reserved_quantity: number };

        const newReserved = Math.max(0, inv.reserved_quantity - item.quantity);
        db.prepare('UPDATE inventory SET reserved_quantity = ?, updated_at = ? WHERE product_id = ?').run(
          newReserved,
          now,
          item.product_id
        );

        insertTx.run(
          item.product_id,
          'STOCK_RELEASED',
          item.quantity,
          approval.order_id,
          inv.quantity_on_hand,
          inv.quantity_on_hand,
          params.reviewerId,
          `Rejected order ${approval.order_number} — reserved stock released: ${params.rejectionReason!.trim()}`,
          now
        );
      }

      db.prepare(
        `UPDATE approvals SET status = 'REJECTED', reviewed_by = ?, rejection_reason = ?, reviewed_at = ? WHERE id = ?`
      ).run(params.reviewerId, params.rejectionReason!.trim(), now, params.approvalId);

      db.prepare(`UPDATE sales_orders SET status = 'REJECTED', updated_at = ? WHERE id = ?`).run(
        now,
        approval.order_id
      );
    }

    return {
      approvalId: params.approvalId,
      orderId: approval.order_id,
      orderNumber: approval.order_number,
      decision: params.decision,
      orderStatus: params.decision === 'APPROVED' ? 'CONFIRMED' : 'REJECTED',
      employeeEmail: approval.employee_email,
      managerName: reviewer.full_name,
      grandTotal: approval.grand_total,
      currencySymbol,
      reviewedAt: now,
      rejectionReason: params.rejectionReason?.trim() || null,
    };
  });

  // Notify sales employee (never rolls back approval on SMTP error)
  const frontendUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000';
  const orderLink = `${frontendUrl}/orders/${outcome.orderId}`;
  const html = renderOrderDecisionHtml({
    orderNumber: outcome.orderNumber,
    decision: outcome.decision,
    managerName: outcome.managerName,
    decisionDate: outcome.reviewedAt,
    grandTotal: formatCurrency(outcome.grandTotal, outcome.currencySymbol),
    rejectionReason: outcome.rejectionReason,
    orderLink,
  });

  await emailService.sendAndLog({
    recipient: outcome.employeeEmail,
    subject: `[Order ${outcome.decision === 'APPROVED' ? 'Approved' : 'Rejected'}] Sales Order ${outcome.orderNumber}`,
    templateName: outcome.decision === 'APPROVED' ? 'order_approved' : 'order_rejected',
    bodyHtml: html,
    referenceOrderId: outcome.orderId,
  });

  return outcome;
}

export function transitionOrderStatus(
  db: DatabaseSync,
  params: { orderId: number; nextStatus: OrderStatus; userId: number; userRole: string }
) {
  return runInTransaction(db, () => {
    const order = db
      .prepare('SELECT id, order_number, status, created_by FROM sales_orders WHERE id = ?')
      .get(params.orderId) as
      | { id: number; order_number: string; status: OrderStatus; created_by: number }
      | undefined;

    if (!order) {
      throw new HttpError(404, 'Sales order not found');
    }

    if (params.userRole === 'SALES_EMPLOYEE' && order.created_by !== params.userId) {
      throw new HttpError(403, 'You can only update your own orders');
    }

    const allowed = ALLOWED_TRANSITIONS[order.status] || [];
    if (!allowed.includes(params.nextStatus)) {
      throw new HttpError(
        409,
        `Invalid status transition from ${order.status} to ${params.nextStatus}`
      );
    }

    if (params.nextStatus === 'CANCELLED') {
      return cancelOrderInternal(db, order, params.userId);
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ?').run(
      params.nextStatus,
      now,
      params.orderId
    );
    return { orderId: params.orderId, orderNumber: order.order_number, status: params.nextStatus };
  });
}

export function cancelSalesOrder(
  db: DatabaseSync,
  params: { orderId: number; userId: number; userRole: string }
) {
  return runInTransaction(db, () => {
    const order = db
      .prepare('SELECT id, order_number, status, created_by FROM sales_orders WHERE id = ?')
      .get(params.orderId) as
      | { id: number; order_number: string; status: OrderStatus; created_by: number }
      | undefined;

    if (!order) {
      throw new HttpError(404, 'Sales order not found');
    }

    if (params.userRole === 'SALES_EMPLOYEE' && order.created_by !== params.userId) {
      throw new HttpError(403, 'You can only cancel your own orders');
    }

    if (order.status === 'CANCELLED') {
      throw new HttpError(409, 'Order is already cancelled');
    }
    if (order.status === 'COMPLETED') {
      throw new HttpError(409, 'Completed orders cannot be cancelled');
    }
    if (order.status === 'REJECTED') {
      throw new HttpError(409, 'Rejected orders cannot be cancelled');
    }

    return cancelOrderInternal(db, order, params.userId);
  });
}

function cancelOrderInternal(
  db: DatabaseSync,
  order: { id: number; order_number: string; status: OrderStatus },
  userId: number
) {
  const now = new Date().toISOString();
  const items = db
    .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
    .all(order.id) as Array<{ product_id: number; quantity: number }>;

  const insertTx = db.prepare(
    `INSERT INTO inventory_transactions
     (product_id, transaction_type, quantity, reference_order_id, previous_quantity, new_quantity, performed_by, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  if (order.status === 'PENDING_APPROVAL') {
    for (const item of items) {
      const inv = db
        .prepare('SELECT quantity_on_hand, reserved_quantity FROM inventory WHERE product_id = ?')
        .get(item.product_id) as { quantity_on_hand: number; reserved_quantity: number };
      const newReserved = Math.max(0, inv.reserved_quantity - item.quantity);
      db.prepare('UPDATE inventory SET reserved_quantity = ?, updated_at = ? WHERE product_id = ?').run(
        newReserved,
        now,
        item.product_id
      );
      insertTx.run(
        item.product_id,
        'STOCK_RELEASED',
        item.quantity,
        order.id,
        inv.quantity_on_hand,
        inv.quantity_on_hand,
        userId,
        `Cancelled pending order ${order.order_number} — reserved stock released`,
        now
      );
    }
    db.prepare(`UPDATE approvals SET status = 'REJECTED', rejection_reason = 'Order cancelled by user', reviewed_at = ? WHERE order_id = ? AND status = 'PENDING'`).run(
      now,
      order.id
    );
  } else if (order.status === 'CONFIRMED' || order.status === 'PROCESSING') {
    for (const item of items) {
      const inv = db
        .prepare('SELECT quantity_on_hand FROM inventory WHERE product_id = ?')
        .get(item.product_id) as { quantity_on_hand: number };
      const newOnHand = inv.quantity_on_hand + item.quantity;
      db.prepare('UPDATE inventory SET quantity_on_hand = ?, updated_at = ? WHERE product_id = ?').run(
        newOnHand,
        now,
        item.product_id
      );
      insertTx.run(
        item.product_id,
        'STOCK_IN',
        item.quantity,
        order.id,
        inv.quantity_on_hand,
        newOnHand,
        userId,
        `Cancelled ${order.status.toLowerCase()} order ${order.order_number} — stock restored`,
        now
      );
    }
  }

  db.prepare(`UPDATE sales_orders SET status = 'CANCELLED', updated_at = ? WHERE id = ?`).run(
    now,
    order.id
  );

  return { orderId: order.id, orderNumber: order.order_number, status: 'CANCELLED' as OrderStatus };
}
