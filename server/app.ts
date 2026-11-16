import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import type { Request, Response, NextFunction } from 'express';
import {
  type AuthenticatedRequest,
  type UserRole,
  hashToken,
  issueRefreshToken,
  requireAuth,
  requireRoles,
  signAccessToken,
  verifyRefreshToken,
} from './auth.ts';
import {
  HttpError,
  type OrderStatus,
  adjustInventory,
  cancelSalesOrder,
  createSalesOrder,
  decideApproval,
  transitionOrderStatus,
} from './business.ts';
import type { EmailService } from './emailService.ts';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8, 'New password must be at least 8 characters'),
});

const createUserSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2).max(120),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'MANAGER', 'SALES_EMPLOYEE']),
  is_active: z.boolean().optional().default(true),
});

const updateUserSchema = z.object({
  full_name: z.string().min(2).max(120).optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'SALES_EMPLOYEE']).optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

const productSchema = z.object({
  sku: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(180),
  description: z.string().max(2000).optional().default(''),
  category: z.string().trim().min(2).max(80),
  unit_price: z.number().positive(),
  cost_price: z.number().min(0),
  initial_stock: z.number().int().min(0).optional().default(0),
  minimum_stock_level: z.number().int().min(0).optional().default(10),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
});

const updateProductSchema = z.object({
  sku: z.string().trim().min(2).max(64).optional(),
  name: z.string().trim().min(2).max(180).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().trim().min(2).max(80).optional(),
  unit_price: z.number().positive().optional(),
  cost_price: z.number().min(0).optional(),
  minimum_stock_level: z.number().int().min(0).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const customerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  company_name: z.string().trim().max(180).optional().default(''),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7).max(30).regex(/^[+\d\s()-]{7,30}$/, 'Invalid phone format'),
  billing_address: z.string().trim().max(500).optional().default(''),
  shipping_address: z.string().trim().max(500).optional().default(''),
  city: z.string().trim().max(100).optional().default(''),
  state: z.string().trim().max(100).optional().default(''),
  postal_code: z.string().trim().max(20).optional().default(''),
  is_active: z.boolean().optional().default(true),
});

const inventoryAdjustmentSchema = z.object({
  product_id: z.number().int().positive(),
  transaction_type: z.enum(['STOCK_IN', 'STOCK_ADJUSTMENT']),
  quantity_delta: z.number().int().refine((n) => n !== 0, 'Quantity change cannot be zero'),
  reason: z.string().trim().min(3, 'Adjustment reason is required').max(500),
});

const createOrderSchema = z.object({
  customer_id: z.number().int().positive(),
  order_date: z.string().min(4),
  expected_delivery_date: z.string().nullable().optional(),
  discount_amount: z.number().min(0).optional().default(0),
  tax_amount: z.number().min(0).optional().default(0),
  notes: z.string().max(1000).optional().default(''),
  items: z
    .array(
      z.object({
        product_id: z.number().int().positive(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1, 'Order must contain at least one item'),
});

const rejectSchema = z.object({
  rejection_reason: z.string().trim().min(3, 'Rejection reason is required').max(1000),
});

const thresholdSchema = z.object({
  approval_threshold: z.number().min(0),
  company_name: z.string().trim().min(2).max(200).optional(),
  currency_symbol: z.string().trim().min(1).max(6).optional(),
});

export function createApiApp(
  db: DatabaseSync,
  emailService: EmailService,
  options?: { disableRateLimit?: boolean }
) {
  const app = express();
  app.use(cors());
  // Vercel may parse the JSON body before Express runs. Parsing again would
  // wipe it, so keep an already-parsed object and only read the stream otherwise.
  app.use((req, res, next) => {
    const existing = req.body as unknown;
    if (Buffer.isBuffer(existing)) {
      try {
        req.body = existing.length ? JSON.parse(existing.toString('utf8')) : {};
      } catch {
        req.body = {};
      }
      next();
      return;
    }
    if (typeof existing === 'string') {
      try {
        req.body = existing ? JSON.parse(existing) : {};
      } catch {
        req.body = {};
      }
      next();
      return;
    }
    if (existing && typeof existing === 'object') {
      next();
      return;
    }
    express.json({ limit: '1mb' })(req, res, next);
  });

  const v1 = express.Router();
  const authMiddleware = requireAuth(db);

  const authRateLimiter = options?.disableRateLimit
    ? (_req: Request, _res: Response, next: NextFunction) => next()
    : rateLimit({
        windowMs: 60 * 1000,
        max: 40,
        standardHeaders: true,
        legacyHeaders: false,
        message: { detail: 'Too many authentication attempts. Please try again shortly.' },
      });

  // Health
  v1.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'meridian-erp-api', timestamp: new Date().toISOString() });
  });

  // ================= AUTH =================
  v1.post('/auth/login', authRateLimiter, (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ detail: parsed.error.issues[0]?.message || 'Validation error' });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const user = db
      .prepare('SELECT id, email, full_name, password_hash, role, is_active FROM users WHERE LOWER(email) = ?')
      .get(email) as
      | {
          id: number;
          email: string;
          full_name: string;
          password_hash: string;
          role: UserRole;
          is_active: number;
        }
      | undefined;

    if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash)) {
      res.status(401).json({ detail: 'Invalid email or password' });
      return;
    }
    if (!user.is_active) {
      res.status(403).json({ detail: 'Account is deactivated. Contact an administrator.' });
      return;
    }

    const authUser = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      is_active: user.is_active,
    };

    const access_token = signAccessToken(authUser);
    const refresh_token = issueRefreshToken(db, authUser);

    res.json({
      access_token,
      refresh_token,
      token_type: 'bearer',
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        is_active: Boolean(user.is_active),
      },
    });
  });

  v1.post('/auth/refresh', (req, res) => {
    const refreshToken = req.body?.refresh_token;
    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(401).json({ detail: 'Refresh token is required' });
      return;
    }
    try {
      const payload = verifyRefreshToken(refreshToken);
      const tokenHash = hashToken(refreshToken);
      const stored = db
        .prepare('SELECT id, user_id, expires_at, revoked FROM refresh_tokens WHERE token_hash = ?')
        .get(tokenHash) as { id: number; user_id: number; expires_at: string; revoked: number } | undefined;

      if (!stored || stored.revoked || new Date(stored.expires_at).getTime() < Date.now()) {
        res.status(401).json({ detail: 'Refresh token is expired or revoked' });
        return;
      }

      const user = db
        .prepare('SELECT id, email, full_name, role, is_active FROM users WHERE id = ?')
        .get(Number(payload.sub)) as
        | { id: number; email: string; full_name: string; role: UserRole; is_active: number }
        | undefined;

      if (!user || !user.is_active) {
        res.status(401).json({ detail: 'User account inactive or missing' });
        return;
      }

      // Rotate refresh token
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(stored.id);
      const access_token = signAccessToken(user);
      const new_refresh_token = issueRefreshToken(db, user);

      res.json({
        access_token,
        refresh_token: new_refresh_token,
        token_type: 'bearer',
      });
    } catch {
      res.status(401).json({ detail: 'Invalid refresh token' });
    }
  });

  v1.post('/auth/logout', (req, res) => {
    const refreshToken = req.body?.refresh_token;
    if (typeof refreshToken === 'string' && refreshToken.length > 0) {
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(hashToken(refreshToken));
    }
    res.json({ message: 'Logged out successfully' });
  });

  v1.get('/auth/me', authMiddleware, (req: AuthenticatedRequest, res) => {
    const u = req.user!;
    res.json({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      is_active: Boolean(u.is_active),
    });
  });

  v1.post('/auth/change-password', authMiddleware, (req: AuthenticatedRequest, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ detail: parsed.error.issues[0]?.message || 'Validation error' });
      return;
    }

    const user = db
      .prepare('SELECT id, password_hash FROM users WHERE id = ?')
      .get(req.user!.id) as { id: number; password_hash: string };

    if (!bcrypt.compareSync(parsed.data.current_password, user.password_hash)) {
      res.status(400).json({ detail: 'Current password is incorrect' });
      return;
    }

    const newHash = bcrypt.hashSync(parsed.data.new_password, 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      newHash,
      new Date().toISOString(),
      req.user!.id
    );
    res.json({ message: 'Password updated successfully' });
  });

  // ================= USERS (ADMIN) =================
  v1.get('/users', authMiddleware, requireRoles('ADMIN'), (_req, res) => {
    const users = db
      .prepare('SELECT id, email, full_name, role, is_active, created_at, updated_at FROM users ORDER BY id ASC')
      .all() as Array<{
      id: number;
      email: string;
      full_name: string;
      role: string;
      is_active: number;
      created_at: string;
      updated_at: string;
    }>;

    res.json({
      items: users.map((u) => ({ ...u, is_active: Boolean(u.is_active) })),
      total: users.length,
    });
  });

  v1.post('/users', authMiddleware, requireRoles('ADMIN'), (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ detail: parsed.error.issues[0]?.message || 'Validation error' });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
    if (existing) {
      res.status(409).json({ detail: 'A user with this email already exists' });
      return;
    }

    const hash = bcrypt.hashSync(parsed.data.password, 10);
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO users (email, full_name, password_hash, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(email, parsed.data.full_name.trim(), hash, parsed.data.role, parsed.data.is_active ? 1 : 0, now, now);

    const created = db
      .prepare('SELECT id, email, full_name, role, is_active, created_at, updated_at FROM users WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
    res.status(201).json({ ...created, is_active: Boolean(created.is_active) });
  });

  v1.get('/users/:id', authMiddleware, requireRoles('ADMIN'), (req, res) => {
    const user = db
      .prepare('SELECT id, email, full_name, role, is_active, created_at, updated_at FROM users WHERE id = ?')
      .get(Number(req.params.id)) as Record<string, unknown> | undefined;
    if (!user) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }
    res.json({ ...user, is_active: Boolean(user.is_active) });
  });

  v1.put('/users/:id', authMiddleware, requireRoles('ADMIN'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }

    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ detail: parsed.error.issues[0]?.message || 'Validation error' });
      return;
    }

    if (id === req.user!.id && parsed.data.is_active === false) {
      res.status(400).json({ detail: 'You cannot deactivate your own admin account' });
      return;
    }

    const fullName = parsed.data.full_name?.trim() ?? (existing.full_name as string);
    const role = parsed.data.role ?? (existing.role as string);
    const isActive = parsed.data.is_active !== undefined ? (parsed.data.is_active ? 1 : 0) : (existing.is_active as number);
    const passwordHash = parsed.data.password ? bcrypt.hashSync(parsed.data.password, 10) : (existing.password_hash as string);

    db.prepare('UPDATE users SET full_name = ?, role = ?, is_active = ?, password_hash = ?, updated_at = ? WHERE id = ?').run(
      fullName,
      role,
      isActive,
      passwordHash,
      new Date().toISOString(),
      id
    );

    const updated = db
      .prepare('SELECT id, email, full_name, role, is_active, created_at, updated_at FROM users WHERE id = ?')
      .get(id) as Record<string, unknown>;
    res.json({ ...updated, is_active: Boolean(updated.is_active) });
  });

  v1.delete('/users/:id', authMiddleware, requireRoles('ADMIN'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    if (id === req.user!.id) {
      res.status(400).json({ detail: 'Cannot delete or deactivate yourself' });
      return;
    }
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }

    const hasOrders = db.prepare('SELECT COUNT(*) as cnt FROM sales_orders WHERE created_by = ?').get(id) as { cnt: number };
    if (hasOrders.cnt > 0) {
      db.prepare('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
      res.json({ message: 'User has historical orders and was deactivated instead of deleted', deactivated: true });
      return;
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ message: 'User deleted successfully', deactivated: false });
  });

  // ================= PRODUCTS =================
  v1.get('/products', authMiddleware, (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const category = String(req.query.category || '').trim();
    const status = String(req.query.status || '').trim();
    const sortBy = String(req.query.sort_by || 'created_at');
    const sortOrder = String(req.query.sort_order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size || 12)));

    const where: string[] = [];
    const params: Array<string | number> = [];

    if (search) {
      where.push('(LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category) {
      where.push('p.category = ?');
      params.push(category);
    }
    if (status && (status === 'ACTIVE' || status === 'INACTIVE')) {
      where.push('p.status = ?');
      params.push(status);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortColumnMap: Record<string, string> = {
      unit_price: 'p.unit_price',
      name: 'p.name',
      stock: '(i.quantity_on_hand - i.reserved_quantity)',
      created_at: 'p.created_at',
    };
    const orderCol = sortColumnMap[sortBy] || 'p.created_at';

    const countRow = db
      .prepare(`SELECT COUNT(*) as total FROM products p JOIN inventory i ON i.product_id = p.id ${whereSql}`)
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `SELECT p.*, i.quantity_on_hand, i.reserved_quantity,
                (i.quantity_on_hand - i.reserved_quantity) as available_quantity
         FROM products p
         JOIN inventory i ON i.product_id = p.id
         ${whereSql}
         ORDER BY ${orderCol} ${sortOrder}
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize);

    const categories = db
      .prepare('SELECT DISTINCT category FROM products ORDER BY category ASC')
      .all() as Array<{ category: string }>;

    res.json({
      items: rows,
      total: countRow.total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(countRow.total / pageSize)),
      categories: categories.map((c) => c.category),
    });
  });

  v1.post('/products', authMiddleware, requireRoles('ADMIN'), (req: AuthenticatedRequest, res) => {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ detail: parsed.error.issues[0]?.message || 'Validation error' });
      return;
    }

    const skuUpper = parsed.data.sku.toUpperCase();
    const dup = db.prepare('SELECT id FROM products WHERE UPPER(sku) = ?').get(skuUpper);
    if (dup) {
      res.status(409).json({ detail: `Product with SKU "${skuUpper}" already exists` });
      return;
    }

    const now = new Date().toISOString();
    const pRes = db
      .prepare(
        `INSERT INTO products (sku, name, description, category, unit_price, cost_price, minimum_stock_level, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        skuUpper,
        parsed.data.name,
        parsed.data.description,
        parsed.data.category,
        parsed.data.unit_price,
        parsed.data.cost_price,
        parsed.data.minimum_stock_level,
        parsed.data.status,
        now,
        now
      );

    const productId = Number(pRes.lastInsertRowid);
    db.prepare(
      `INSERT INTO inventory (product_id, quantity_on_hand, reserved_quantity, minimum_stock_level, updated_at)
       VALUES (?, ?, 0, ?, ?)`
    ).run(productId, parsed.data.initial_stock, parsed.data.minimum_stock_level, now);

    if (parsed.data.initial_stock > 0) {
      db.prepare(
        `INSERT INTO inventory_transactions (product_id, transaction_type, quantity, reference_order_id, previous_quantity, new_quantity, performed_by, reason, created_at)
         VALUES (?, 'STOCK_IN', ?, NULL, 0, ?, ?, 'Initial product opening stock', ?)`
      ).run(productId, parsed.data.initial_stock, parsed.data.initial_stock, req.user!.id, now);
    }

    const created = db
      .prepare(
        `SELECT p.*, i.quantity_on_hand, i.reserved_quantity,
                (i.quantity_on_hand - i.reserved_quantity) as available_quantity
         FROM products p JOIN inventory i ON i.product_id = p.id WHERE p.id = ?`
      )
      .get(productId);
    res.status(201).json(created);
  });

  v1.get('/products/:id', authMiddleware, (req, res) => {
    const product = db
      .prepare(
        `SELECT p.*, i.quantity_on_hand, i.reserved_quantity,
                (i.quantity_on_hand - i.reserved_quantity) as available_quantity
         FROM products p JOIN inventory i ON i.product_id = p.id WHERE p.id = ?`
      )
      .get(Number(req.params.id));
    if (!product) {
      res.status(404).json({ detail: 'Product not found' });
      return;
    }
    res.json(product);
  });

  v1.put('/products/:id', authMiddleware, requireRoles('ADMIN'), (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ detail: 'Product not found' });
      return;
    }

    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ detail: parsed.error.issues[0]?.message || 'Validation error' });
      return;
    }

    const nextSku = (parsed.data.sku ?? (existing.sku as string)).toUpperCase();
    if (nextSku !== (existing.sku as string).toUpperCase()) {
      const dup = db.prepare('SELECT id FROM products WHERE UPPER(sku) = ? AND id != ?').get(nextSku, id);
      if (dup) {
        res.status(409).json({ detail: `SKU "${nextSku}" is already assigned to another product` });
        return;
      }
    }

    const now = new Date().toISOString();
    const minStock = parsed.data.minimum_stock_level ?? (existing.minimum_stock_level as number);

    db.prepare(
      `UPDATE products
       SET sku = ?, name = ?, description = ?, category = ?, unit_price = ?, cost_price = ?, minimum_stock_level = ?, status = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      nextSku,
      String(parsed.data.name ?? existing.name),
      String(parsed.data.description ?? existing.description),
      String(parsed.data.category ?? existing.category),
      Number(parsed.data.unit_price ?? existing.unit_price),
      Number(parsed.data.cost_price ?? existing.cost_price),
      Number(minStock),
      String(parsed.data.status ?? existing.status),
      now,
      id
    );

    db.prepare('UPDATE inventory SET minimum_stock_level = ?, updated_at = ? WHERE product_id = ?').run(minStock, now, id);

    const updated = db
      .prepare(
        `SELECT p.*, i.quantity_on_hand, i.reserved_quantity,
                (i.quantity_on_hand - i.reserved_quantity) as available_quantity
         FROM products p JOIN inventory i ON i.product_id = p.id WHERE p.id = ?`
      )
      .get(id);
    res.json(updated);
  });

  v1.delete('/products/:id', authMiddleware, requireRoles('ADMIN'), (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ detail: 'Product not found' });
      return;
    }

    const ref = db.prepare('SELECT COUNT(*) as cnt FROM order_items WHERE product_id = ?').get(id) as { cnt: number };
    if (ref.cnt > 0) {
      db.prepare(`UPDATE products SET status = 'INACTIVE', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
      res.json({
        message: 'Product is referenced by existing orders and has been deactivated instead of deleted.',
        deactivated: true,
      });
      return;
    }

    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    res.json({ message: 'Product deleted successfully', deactivated: false });
  });

  // ================= CUSTOMERS =================
  v1.get('/customers', authMiddleware, (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size || 12)));

    const where: string[] = [];
    const params: Array<string | number> = [];

    if (search) {
      where.push('(LOWER(name) LIKE ? OR LOWER(company_name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(phone) LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status === 'ACTIVE') where.push('is_active = 1');
    if (status === 'INACTIVE') where.push('is_active = 0');

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRow = db.prepare(`SELECT COUNT(*) as total FROM customers ${whereSql}`).get(...params) as { total: number };
    const rows = db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM sales_orders o WHERE o.customer_id = c.id) as order_count,
                (SELECT COALESCE(SUM(o.grand_total), 0) FROM sales_orders o WHERE o.customer_id = c.id AND o.status IN ('CONFIRMED', 'PROCESSING', 'COMPLETED')) as total_spend
         FROM customers c
         ${whereSql}
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;

    res.json({
      items: rows.map((r) => ({ ...r, is_active: Boolean(r.is_active) })),
      total: countRow.total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(countRow.total / pageSize)),
    });
  });

  v1.post('/customers', authMiddleware, requireRoles('ADMIN', 'MANAGER', 'SALES_EMPLOYEE'), (req, res) => {
    const parsed = customerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ detail: parsed.error.issues[0]?.message || 'Validation error' });
      return;
    }
    const now = new Date().toISOString();
    const d = parsed.data;
    const info = db
      .prepare(
        `INSERT INTO customers (name, company_name, email, phone, billing_address, shipping_address, city, state, postal_code, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        d.name,
        d.company_name,
        d.email.toLowerCase(),
        d.phone,
        d.billing_address,
        d.shipping_address || d.billing_address,
        d.city,
        d.state,
        d.postal_code,
        d.is_active ? 1 : 0,
        now,
        now
      );

    const created = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(info.lastInsertRowid)) as Record<string, unknown>;
    res.status(201).json({ ...created, is_active: Boolean(created.is_active) });
  });

  v1.get('/customers/:id', authMiddleware, (req, res) => {
    const id = Number(req.params.id);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!customer) {
      res.status(404).json({ detail: 'Customer not found' });
      return;
    }

    const orders = db
      .prepare(
        `SELECT o.id, o.order_number, o.order_date, o.grand_total, o.status, u.full_name as sales_rep
         FROM sales_orders o
         JOIN users u ON u.id = o.created_by
         WHERE o.customer_id = ?
         ORDER BY o.created_at DESC`
      )
      .all(id);

    res.json({
      ...customer,
      is_active: Boolean(customer.is_active),
      orders,
    });
  });

  v1.put('/customers/:id', authMiddleware, requireRoles('ADMIN', 'MANAGER', 'SALES_EMPLOYEE'), (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ detail: 'Customer not found' });
      return;
    }

    const parsed = customerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ detail: parsed.error.issues[0]?.message || 'Validation error' });
      return;
    }
    const d = parsed.data;
    db.prepare(
      `UPDATE customers
       SET name = ?, company_name = ?, email = ?, phone = ?, billing_address = ?, shipping_address = ?, city = ?, state = ?, postal_code = ?, is_active = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      d.name,
      d.company_name,
      d.email.toLowerCase(),
      d.phone,
      d.billing_address,
      d.shipping_address || d.billing_address,
      d.city,
      d.state,
      d.postal_code,
      d.is_active ? 1 : 0,
      new Date().toISOString(),
      id
    );

    const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ ...updated, is_active: Boolean(updated.is_active) });
  });

  v1.delete('/customers/:id', authMiddleware, requireRoles('ADMIN', 'MANAGER'), (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM customers WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ detail: 'Customer not found' });
      return;
    }

    const ref = db.prepare('SELECT COUNT(*) as cnt FROM sales_orders WHERE customer_id = ?').get(id) as { cnt: number };
    if (ref.cnt > 0) {
      db.prepare('UPDATE customers SET is_active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
      res.json({
        message: 'Customer has existing orders and was deactivated instead of deleted.',
        deactivated: true,
      });
      return;
    }

    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    res.json({ message: 'Customer deleted successfully', deactivated: false });
  });

  // ================= INVENTORY =================
  v1.get('/inventory', authMiddleware, (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const lowStockOnly = req.query.low_stock === 'true';

    const where: string[] = [];
    const params: Array<string> = [];
    if (search) {
      where.push('(LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (lowStockOnly) {
      where.push('(i.quantity_on_hand - i.reserved_quantity) <= i.minimum_stock_level');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT i.id, i.product_id, p.sku, p.name as product_name, p.category, p.unit_price, p.status as product_status,
                i.quantity_on_hand, i.reserved_quantity,
                (i.quantity_on_hand - i.reserved_quantity) as available_quantity,
                i.minimum_stock_level, i.updated_at
         FROM inventory i
         JOIN products p ON p.id = i.product_id
         ${whereSql}
         ORDER BY available_quantity ASC, p.name ASC`
      )
      .all(...params);

    res.json({ items: rows, total: rows.length });
  });

  v1.get('/inventory/low-stock', authMiddleware, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT i.id, i.product_id, p.sku, p.name as product_name, p.category,
                i.quantity_on_hand, i.reserved_quantity,
                (i.quantity_on_hand - i.reserved_quantity) as available_quantity,
                i.minimum_stock_level, i.updated_at
         FROM inventory i
         JOIN products p ON p.id = i.product_id
         WHERE (i.quantity_on_hand - i.reserved_quantity) <= i.minimum_stock_level
           AND p.status = 'ACTIVE'
         ORDER BY available_quantity ASC`
      )
      .all();
    res.json({ items: rows, total: rows.length });
  });

  v1.get('/inventory/transactions', authMiddleware, (req, res) => {
    const productId = req.query.product_id ? Number(req.query.product_id) : null;
    const whereSql = productId ? 'WHERE t.product_id = ?' : '';
    const params = productId ? [productId] : [];
    const rows = db
      .prepare(
        `SELECT t.*, p.sku, p.name as product_name, u.full_name as performed_by_name,
                o.order_number as reference_order_number
         FROM inventory_transactions t
         JOIN products p ON p.id = t.product_id
         JOIN users u ON u.id = t.performed_by
         LEFT JOIN sales_orders o ON o.id = t.reference_order_id
         ${whereSql}
         ORDER BY t.created_at DESC, t.id DESC
         LIMIT 200`
      )
      .all(...params);
    res.json({ items: rows, total: rows.length });
  });

  v1.get('/inventory/:product_id', authMiddleware, (req, res) => {
    const productId = Number(req.params.product_id);
    const inv = db
      .prepare(
        `SELECT i.id, i.product_id, p.sku, p.name as product_name, p.category,
                i.quantity_on_hand, i.reserved_quantity,
                (i.quantity_on_hand - i.reserved_quantity) as available_quantity,
                i.minimum_stock_level, i.updated_at
         FROM inventory i
         JOIN products p ON p.id = i.product_id
         WHERE i.product_id = ?`
      )
      .get(productId);
    if (!inv) {
      res.status(404).json({ detail: 'Inventory record not found' });
      return;
    }
    res.json(inv);
  });

  v1.post('/inventory/adjustments', authMiddleware, requireRoles('ADMIN', 'MANAGER'), (req: AuthenticatedRequest, res) => {
    const parsed = inventoryAdjustmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ detail: parsed.error.issues[0]?.message || 'Validation error' });
      return;
    }

    const result = adjustInventory(db, {
      productId: parsed.data.product_id,
      transactionType: parsed.data.transaction_type,
      quantityDelta: parsed.data.quantity_delta,
      reason: parsed.data.reason,
      performedBy: req.user!.id,
    });
    res.status(201).json(result);
  });

  // ================= SALES ORDERS =================
  v1.get('/orders', authMiddleware, (req: AuthenticatedRequest, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size || 12)));

    const where: string[] = [];
    const params: Array<string | number> = [];

    if (req.user!.role === 'SALES_EMPLOYEE') {
      where.push('o.created_by = ?');
      params.push(req.user!.id);
    }
    if (status) {
      where.push('o.status = ?');
      params.push(status);
    }
    if (search) {
      where.push('(LOWER(o.order_number) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(c.company_name) LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRow = db
      .prepare(
        `SELECT COUNT(*) as total
         FROM sales_orders o
         JOIN customers c ON c.id = o.customer_id
         ${whereSql}`
      )
      .get(...params) as { total: number };

    const items = db
      .prepare(
        `SELECT o.*, c.name as customer_name, c.company_name as customer_company,
                u.full_name as created_by_name, u.email as created_by_email,
                a.id as approval_id, a.status as approval_status, a.rejection_reason
         FROM sales_orders o
         JOIN customers c ON c.id = o.customer_id
         JOIN users u ON u.id = o.created_by
         LEFT JOIN approvals a ON a.order_id = o.id
         ${whereSql}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize);

    res.json({
      items,
      total: countRow.total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(countRow.total / pageSize)),
    });
  });

  v1.post('/orders', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = createOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({ detail: parsed.error.issues[0]?.message || 'Validation error' });
        return;
      }

      const created = await createSalesOrder(db, emailService, {
        customerId: parsed.data.customer_id,
        createdBy: req.user!.id,
        orderDate: parsed.data.order_date,
        expectedDeliveryDate: parsed.data.expected_delivery_date,
        discountAmount: parsed.data.discount_amount,
        taxAmount: parsed.data.tax_amount,
        notes: parsed.data.notes,
        items: parsed.data.items.map((i) => ({ productId: i.product_id, quantity: i.quantity })),
      });

      const fullOrder = db
        .prepare(
          `SELECT o.*, c.name as customer_name, c.company_name as customer_company,
                  u.full_name as created_by_name, a.id as approval_id, a.status as approval_status
           FROM sales_orders o
           JOIN customers c ON c.id = o.customer_id
           JOIN users u ON u.id = o.created_by
           LEFT JOIN approvals a ON a.order_id = o.id
           WHERE o.id = ?`
        )
        .get(created.orderId);

      res.status(201).json(fullOrder);
    } catch (err) {
      next(err);
    }
  });

  v1.get('/orders/:id', authMiddleware, (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const order = db
      .prepare(
        `SELECT o.*, c.name as customer_name, c.company_name as customer_company, c.email as customer_email,
                c.phone as customer_phone, c.shipping_address as customer_shipping_address, c.city as customer_city, c.state as customer_state,
                u.full_name as created_by_name, u.email as created_by_email,
                a.id as approval_id, a.status as approval_status, a.rejection_reason, a.reviewed_at,
                rev.full_name as reviewed_by_name
         FROM sales_orders o
         JOIN customers c ON c.id = o.customer_id
         JOIN users u ON u.id = o.created_by
         LEFT JOIN approvals a ON a.order_id = o.id
         LEFT JOIN users rev ON rev.id = a.reviewed_by
         WHERE o.id = ?`
      )
      .get(id) as { created_by: number } | undefined;

    if (!order) {
      res.status(404).json({ detail: 'Sales order not found' });
      return;
    }

    if (req.user!.role === 'SALES_EMPLOYEE' && order.created_by !== req.user!.id) {
      res.status(403).json({ detail: 'You do not have permission to view this order' });
      return;
    }

    const items = db
      .prepare(
        `SELECT oi.*, p.sku, p.name as product_name, p.category,
                (i.quantity_on_hand - i.reserved_quantity) as current_available_stock
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN inventory i ON i.product_id = oi.product_id
         WHERE oi.order_id = ?`
      )
      .all(id);

    res.json({ ...order, items });
  });

  v1.get('/orders/:id/items', authMiddleware, (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const order = db.prepare('SELECT id, created_by FROM sales_orders WHERE id = ?').get(id) as
      | { id: number; created_by: number }
      | undefined;
    if (!order) {
      res.status(404).json({ detail: 'Sales order not found' });
      return;
    }
    if (req.user!.role === 'SALES_EMPLOYEE' && order.created_by !== req.user!.id) {
      res.status(403).json({ detail: 'Forbidden' });
      return;
    }
    const items = db
      .prepare(
        `SELECT oi.*, p.sku, p.name as product_name
         FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`
      )
      .all(id);
    res.json({ items });
  });

  v1.put('/orders/:id', authMiddleware, (req: AuthenticatedRequest, res, next) => {
    try {
      const nextStatus = req.body?.status as OrderStatus | undefined;
      if (!nextStatus) {
        res.status(422).json({ detail: 'Target status is required' });
        return;
      }
      if ((nextStatus === 'PROCESSING' || nextStatus === 'COMPLETED') && req.user!.role === 'SALES_EMPLOYEE') {
        res.status(403).json({ detail: 'Only managers or admins can mark orders as processing or completed' });
        return;
      }
      const result = transitionOrderStatus(db, {
        orderId: Number(req.params.id),
        nextStatus,
        userId: req.user!.id,
        userRole: req.user!.role,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  v1.post('/orders/:id/cancel', authMiddleware, (req: AuthenticatedRequest, res, next) => {
    try {
      const result = cancelSalesOrder(db, {
        orderId: Number(req.params.id),
        userId: req.user!.id,
        userRole: req.user!.role,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // ================= APPROVALS =================
  v1.get('/approvals/pending', authMiddleware, requireRoles('ADMIN', 'MANAGER'), (_req, res) => {
    const rows = db
      .prepare(
        `SELECT a.*, o.order_number, o.order_date, o.expected_delivery_date, o.grand_total, o.notes,
                c.name as customer_name, c.company_name as customer_company,
                u.full_name as requested_by_name, u.email as requested_by_email
         FROM approvals a
         JOIN sales_orders o ON o.id = a.order_id
         JOIN customers c ON c.id = o.customer_id
         JOIN users u ON u.id = a.requested_by
         WHERE a.status = 'PENDING'
         ORDER BY a.requested_at ASC`
      )
      .all();
    res.json({ items: rows, total: rows.length });
  });

  v1.get('/approvals/history', authMiddleware, requireRoles('ADMIN', 'MANAGER'), (_req, res) => {
    const rows = db
      .prepare(
        `SELECT a.*, o.order_number, o.order_date, o.grand_total,
                c.name as customer_name, c.company_name as customer_company,
                u.full_name as requested_by_name,
                rev.full_name as reviewed_by_name
         FROM approvals a
         JOIN sales_orders o ON o.id = a.order_id
         JOIN customers c ON c.id = o.customer_id
         JOIN users u ON u.id = a.requested_by
         LEFT JOIN users rev ON rev.id = a.reviewed_by
         WHERE a.status IN ('APPROVED', 'REJECTED')
         ORDER BY a.reviewed_at DESC`
      )
      .all();
    res.json({ items: rows, total: rows.length });
  });

  v1.get('/approvals/:id', authMiddleware, requireRoles('ADMIN', 'MANAGER'), (req, res) => {
    const id = Number(req.params.id);
    const approval = db
      .prepare(
        `SELECT a.*, o.order_number, o.order_date, o.expected_delivery_date, o.subtotal, o.discount_amount, o.tax_amount, o.grand_total, o.status as order_status, o.notes,
                c.id as customer_id, c.name as customer_name, c.company_name as customer_company, c.email as customer_email, c.phone as customer_phone, c.city as customer_city,
                u.full_name as requested_by_name, u.email as requested_by_email,
                rev.full_name as reviewed_by_name
         FROM approvals a
         JOIN sales_orders o ON o.id = a.order_id
         JOIN customers c ON c.id = o.customer_id
         JOIN users u ON u.id = a.requested_by
         LEFT JOIN users rev ON rev.id = a.reviewed_by
         WHERE a.id = ?`
      )
      .get(id) as { order_id: number } | undefined;

    if (!approval) {
      res.status(404).json({ detail: 'Approval request not found' });
      return;
    }

    const items = db
      .prepare(
        `SELECT oi.*, p.sku, p.name as product_name, p.category,
                i.quantity_on_hand, i.reserved_quantity, (i.quantity_on_hand - i.reserved_quantity) as available_quantity
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN inventory i ON i.product_id = oi.product_id
         WHERE oi.order_id = ?`
      )
      .all(approval.order_id);

    res.json({ ...approval, items });
  });

  v1.post('/approvals/:id/approve', authMiddleware, requireRoles('ADMIN', 'MANAGER'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const outcome = await decideApproval(db, emailService, {
        approvalId: Number(req.params.id),
        reviewerId: req.user!.id,
        reviewerRole: req.user!.role,
        decision: 'APPROVED',
      });
      res.json(outcome);
    } catch (err) {
      next(err);
    }
  });

  v1.post('/approvals/:id/reject', authMiddleware, requireRoles('ADMIN', 'MANAGER'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = rejectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({ detail: parsed.error.issues[0]?.message || 'Rejection reason is required' });
        return;
      }

      const outcome = await decideApproval(db, emailService, {
        approvalId: Number(req.params.id),
        reviewerId: req.user!.id,
        reviewerRole: req.user!.role,
        decision: 'REJECTED',
        rejectionReason: parsed.data.rejection_reason,
      });
      res.json(outcome);
    } catch (err) {
      next(err);
    }
  });

  // ================= DASHBOARD & ANALYTICS =================
  v1.get('/dashboard/admin', authMiddleware, requireRoles('ADMIN', 'MANAGER'), (_req, res) => {
    const revRow = db
      .prepare(
        `SELECT COALESCE(SUM(grand_total), 0) as total_revenue, COUNT(*) as confirmed_orders
         FROM sales_orders WHERE status IN ('CONFIRMED', 'PROCESSING', 'COMPLETED')`
      )
      .get() as { total_revenue: number; confirmed_orders: number };

    const totalOrdersRow = db.prepare('SELECT COUNT(*) as cnt FROM sales_orders').get() as { cnt: number };
    const totalProductsRow = db.prepare(`SELECT COUNT(*) as cnt FROM products WHERE status = 'ACTIVE'`).get() as { cnt: number };
    const totalCustomersRow = db.prepare('SELECT COUNT(*) as cnt FROM customers WHERE is_active = 1').get() as { cnt: number };
    const pendingApprovalsRow = db.prepare(`SELECT COUNT(*) as cnt FROM approvals WHERE status = 'PENDING'`).get() as { cnt: number };
    const lowStockRow = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM inventory i
         JOIN products p ON p.id = i.product_id
         WHERE (i.quantity_on_hand - i.reserved_quantity) <= i.minimum_stock_level AND p.status = 'ACTIVE'`
      )
      .get() as { cnt: number };

    const monthlyRevenue = db
      .prepare(
        `SELECT substr(order_date, 1, 7) as month,
                COALESCE(SUM(grand_total), 0) as revenue,
                COUNT(*) as order_count
         FROM sales_orders
         WHERE status IN ('CONFIRMED', 'PROCESSING', 'COMPLETED')
         GROUP BY substr(order_date, 1, 7)
         ORDER BY month ASC`
      )
      .all();

    const statusDistribution = db
      .prepare(
        `SELECT status, COUNT(*) as count, COALESCE(SUM(grand_total), 0) as value
         FROM sales_orders
         GROUP BY status`
      )
      .all();

    const topProducts = db
      .prepare(
        `SELECT p.name, p.sku, SUM(oi.quantity) as units_sold, SUM(oi.subtotal) as revenue
         FROM order_items oi
         JOIN sales_orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         WHERE o.status IN ('CONFIRMED', 'PROCESSING', 'COMPLETED')
         GROUP BY p.id
         ORDER BY revenue DESC
         LIMIT 5`
      )
      .all();

    const inventoryByCategory = db
      .prepare(
        `SELECT p.category,
                SUM(i.quantity_on_hand) as on_hand,
                SUM(i.reserved_quantity) as reserved,
                SUM(i.quantity_on_hand - i.reserved_quantity) as available
         FROM inventory i
         JOIN products p ON p.id = i.product_id
         WHERE p.status = 'ACTIVE'
         GROUP BY p.category`
      )
      .all();

    const recentOrders = db
      .prepare(
        `SELECT o.id, o.order_number, o.order_date, o.grand_total, o.status,
                c.name as customer_name, c.company_name as customer_company, u.full_name as sales_rep
         FROM sales_orders o
         JOIN customers c ON c.id = o.customer_id
         JOIN users u ON u.id = o.created_by
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT 6`
      )
      .all();

    const pendingApprovalsList = db
      .prepare(
        `SELECT a.id, a.order_id, a.order_amount, a.requested_at, o.order_number,
                c.company_name as customer_company, c.name as customer_name, u.full_name as requested_by_name
         FROM approvals a
         JOIN sales_orders o ON o.id = a.order_id
         JOIN customers c ON c.id = o.customer_id
         JOIN users u ON u.id = a.requested_by
         WHERE a.status = 'PENDING'
         ORDER BY a.requested_at ASC
         LIMIT 5`
      )
      .all();

    const lowStockProducts = db
      .prepare(
        `SELECT p.id as product_id, p.sku, p.name, p.category,
                i.quantity_on_hand, i.reserved_quantity,
                (i.quantity_on_hand - i.reserved_quantity) as available_quantity,
                i.minimum_stock_level
         FROM inventory i
         JOIN products p ON p.id = i.product_id
         WHERE (i.quantity_on_hand - i.reserved_quantity) <= i.minimum_stock_level AND p.status = 'ACTIVE'
         ORDER BY available_quantity ASC
         LIMIT 6`
      )
      .all();

    res.json({
      kpis: {
        total_revenue: revRow.total_revenue,
        total_orders: totalOrdersRow.cnt,
        total_products: totalProductsRow.cnt,
        total_customers: totalCustomersRow.cnt,
        pending_approvals: pendingApprovalsRow.cnt,
        low_stock_products: lowStockRow.cnt,
      },
      charts: {
        monthly_revenue: monthlyRevenue,
        status_distribution: statusDistribution,
        top_products: topProducts,
        inventory_by_category: inventoryByCategory,
      },
      tables: {
        recent_orders: recentOrders,
        pending_approvals: pendingApprovalsList,
        low_stock_products: lowStockProducts,
      },
    });
  });

  v1.get('/dashboard/sales', authMiddleware, (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const summary = db
      .prepare(
        `SELECT
           COUNT(*) as total_orders,
           SUM(CASE WHEN status IN ('CONFIRMED', 'PROCESSING', 'COMPLETED') THEN 1 ELSE 0 END) as confirmed_orders,
           SUM(CASE WHEN status = 'PENDING_APPROVAL' THEN 1 ELSE 0 END) as pending_approvals,
           SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_orders,
           COALESCE(SUM(CASE WHEN status IN ('CONFIRMED', 'PROCESSING', 'COMPLETED') THEN grand_total ELSE 0 END), 0) as sales_value
         FROM sales_orders
         WHERE created_by = ?`
      )
      .get(userId);

    const recentOrders = db
      .prepare(
        `SELECT o.*, c.name as customer_name, c.company_name as customer_company,
                a.rejection_reason, a.status as approval_status
         FROM sales_orders o
         JOIN customers c ON c.id = o.customer_id
         LEFT JOIN approvals a ON a.order_id = o.id
         WHERE o.created_by = ?
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT 10`
      )
      .all(userId);

    const monthlySales = db
      .prepare(
        `SELECT substr(order_date, 1, 7) as month,
                COALESCE(SUM(grand_total), 0) as revenue,
                COUNT(*) as order_count
         FROM sales_orders
         WHERE created_by = ? AND status IN ('CONFIRMED', 'PROCESSING', 'COMPLETED')
         GROUP BY substr(order_date, 1, 7)
         ORDER BY month ASC`
      )
      .all(userId);

    res.json({
      kpis: summary,
      recent_orders: recentOrders,
      monthly_sales: monthlySales,
    });
  });

  v1.get('/dashboard/manager', authMiddleware, requireRoles('ADMIN', 'MANAGER'), (_req, res) => {
    const kpis = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_requests,
           SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved_orders,
           SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_orders,
           COALESCE(SUM(CASE WHEN status = 'PENDING' THEN order_amount ELSE 0 END), 0) as awaiting_value
         FROM approvals`
      )
      .get();

    const pendingApprovals = db
      .prepare(
        `SELECT a.*, o.order_number, o.order_date, o.grand_total,
                c.name as customer_name, c.company_name as customer_company,
                u.full_name as requested_by_name
         FROM approvals a
         JOIN sales_orders o ON o.id = a.order_id
         JOIN customers c ON c.id = o.customer_id
         JOIN users u ON u.id = a.requested_by
         WHERE a.status = 'PENDING'
         ORDER BY a.requested_at ASC`
      )
      .all();

    const recentHistory = db
      .prepare(
        `SELECT a.*, o.order_number, o.grand_total,
                c.name as customer_name, c.company_name as customer_company,
                u.full_name as requested_by_name, rev.full_name as reviewed_by_name
         FROM approvals a
         JOIN sales_orders o ON o.id = a.order_id
         JOIN customers c ON c.id = o.customer_id
         JOIN users u ON u.id = a.requested_by
         LEFT JOIN users rev ON rev.id = a.reviewed_by
         WHERE a.status IN ('APPROVED', 'REJECTED')
         ORDER BY a.reviewed_at DESC
         LIMIT 8`
      )
      .all();

    res.json({
      kpis,
      pending_approvals: pendingApprovals,
      recent_history: recentHistory,
    });
  });

  v1.get('/dashboard/notifications', authMiddleware, (req: AuthenticatedRequest, res) => {
    const notifications: Array<{ id: string; type: string; title: string; subtitle: string; link: string }> = [];

    if (req.user!.role === 'ADMIN' || req.user!.role === 'MANAGER') {
      const pending = db
        .prepare(
          `SELECT a.id, o.order_number, a.order_amount, c.company_name
           FROM approvals a
           JOIN sales_orders o ON o.id = a.order_id
           JOIN customers c ON c.id = o.customer_id
           WHERE a.status = 'PENDING'
           ORDER BY a.requested_at DESC LIMIT 5`
        )
        .all() as Array<{ id: number; order_number: string; order_amount: number; company_name: string }>;
      for (const p of pending) {
        notifications.push({
          id: `app-${p.id}`,
          type: 'APPROVAL',
          title: `Approval needed: ${p.order_number}`,
          subtitle: `${p.company_name} — ₹${p.order_amount.toLocaleString('en-IN')}`,
          link: `/approvals/${p.id}`,
        });
      }
    } else {
      const recentDecisions = db
        .prepare(
          `SELECT o.id, o.order_number, o.status
           FROM sales_orders o
           WHERE o.created_by = ? AND o.status IN ('CONFIRMED', 'REJECTED', 'PENDING_APPROVAL')
           ORDER BY o.updated_at DESC LIMIT 5`
        )
        .all(req.user!.id) as Array<{ id: number; order_number: string; status: string }>;
      for (const o of recentDecisions) {
        notifications.push({
          id: `ord-${o.id}`,
          type: 'ORDER',
          title: `${o.order_number} · ${o.status.replace('_', ' ')}`,
          subtitle: 'Click to view order details',
          link: `/orders/${o.id}`,
        });
      }
    }

    const lowStock = db
      .prepare(
        `SELECT p.id, p.sku, p.name, (i.quantity_on_hand - i.reserved_quantity) as available
         FROM inventory i JOIN products p ON p.id = i.product_id
         WHERE (i.quantity_on_hand - i.reserved_quantity) <= i.minimum_stock_level AND p.status = 'ACTIVE'
         LIMIT 4`
      )
      .all() as Array<{ id: number; sku: string; name: string; available: number }>;

    for (const ls of lowStock) {
      notifications.push({
        id: `low-${ls.id}`,
        type: 'LOW_STOCK',
        title: `Low stock: ${ls.sku}`,
        subtitle: `${ls.name} (${ls.available} units left)`,
        link: '/inventory',
      });
    }

    res.json({ items: notifications, count: notifications.length });
  });

  // ================= REPORTS & SETTINGS & EMAILS =================
  v1.get('/reports/summary', authMiddleware, requireRoles('ADMIN', 'MANAGER'), (_req, res) => {
    const categorySales = db
      .prepare(
        `SELECT p.category,
                SUM(oi.quantity) as total_units,
                SUM(oi.subtotal) as revenue,
                SUM((oi.unit_price - p.cost_price) * oi.quantity) as estimated_gross_profit
         FROM order_items oi
         JOIN sales_orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         WHERE o.status IN ('CONFIRMED', 'PROCESSING', 'COMPLETED')
         GROUP BY p.category
         ORDER BY revenue DESC`
      )
      .all();

    const inventoryValuation = db
      .prepare(
        `SELECT p.category,
                SUM(i.quantity_on_hand) as total_units,
                SUM(i.quantity_on_hand * p.cost_price) as cost_valuation,
                SUM(i.quantity_on_hand * p.unit_price) as retail_valuation
         FROM inventory i
         JOIN products p ON p.id = i.product_id
         WHERE p.status = 'ACTIVE'
         GROUP BY p.category`
      )
      .all();

    const salesRepPerformance = db
      .prepare(
        `SELECT u.full_name, u.email,
                COUNT(o.id) as total_orders,
                SUM(CASE WHEN o.status IN ('CONFIRMED', 'PROCESSING', 'COMPLETED') THEN 1 ELSE 0 END) as confirmed_orders,
                COALESCE(SUM(CASE WHEN o.status IN ('CONFIRMED', 'PROCESSING', 'COMPLETED') THEN o.grand_total ELSE 0 END), 0) as total_revenue
         FROM users u
         LEFT JOIN sales_orders o ON o.created_by = u.id
         WHERE u.role = 'SALES_EMPLOYEE'
         GROUP BY u.id`
      )
      .all();

    res.json({
      category_sales: categorySales,
      inventory_valuation: inventoryValuation,
      sales_rep_performance: salesRepPerformance,
    });
  });

  v1.get('/settings', authMiddleware, (_req, res) => {
    const settings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get() as Record<string, unknown>;
    const smtpConfigured = Boolean(
      process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASSWORD &&
        process.env.SMTP_USER !== 'your_email@example.com'
    );
    res.json({
      ...settings,
      smtp_configured: smtpConfigured,
      smtp_host: process.env.SMTP_HOST || 'smtp.gmail.com',
      manager_email: process.env.MANAGER_EMAIL || 'manager@example.com',
    });
  });

  v1.put('/settings/approval-threshold', authMiddleware, requireRoles('ADMIN'), (req: AuthenticatedRequest, res) => {
    const parsed = thresholdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ detail: parsed.error.issues[0]?.message || 'Validation error' });
      return;
    }

    const current = db.prepare('SELECT * FROM system_settings WHERE id = 1').get() as Record<string, unknown>;
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE system_settings
       SET approval_threshold = ?, company_name = ?, currency_symbol = ?, updated_by = ?, updated_at = ?
       WHERE id = 1`
    ).run(
      Number(parsed.data.approval_threshold),
      String(parsed.data.company_name ?? current.company_name),
      String(parsed.data.currency_symbol ?? current.currency_symbol),
      req.user!.id,
      now
    );

    const updated = db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
    res.json(updated);
  });

  v1.get('/emails', authMiddleware, requireRoles('ADMIN', 'MANAGER'), (_req, res) => {
    const logs = db
      .prepare(
        `SELECT e.*, o.order_number
         FROM email_logs e
         LEFT JOIN sales_orders o ON o.id = e.reference_order_id
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT 100`
      )
      .all();
    res.json({ items: logs, total: logs.length });
  });

  v1.post('/emails/:id/retry', authMiddleware, requireRoles('ADMIN', 'MANAGER'), async (req, res, next) => {
    try {
      const result = await emailService.retryEmail(Number(req.params.id));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/v1', v1);

  // Centralized error handler (never leaks stack traces)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ detail: err.message });
      return;
    }
    console.error('[API Error]', err);
    res.status(500).json({ detail: 'An unexpected server error occurred' });
  });

  return app;
}
