import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';

export type UserRole = 'ADMIN' | 'MANAGER' | 'SALES_EMPLOYEE';

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const ACCESS_SECRET = process.env.JWT_SECRET || 'meridian_erp_dev_access_secret_change_in_prod';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'meridian_erp_dev_refresh_secret_change_in_prod';
const ACCESS_EXPIRE_MIN = Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 30);
const REFRESH_EXPIRE_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRE_DAYS || 7);

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role,
      type: 'access',
    },
    ACCESS_SECRET,
    { expiresIn: `${ACCESS_EXPIRE_MIN}m` }
  );
}

export function issueRefreshToken(db: DatabaseSync, user: AuthUser): string {
  const token = jwt.sign(
    {
      sub: String(user.id),
      jti: crypto.randomUUID(),
      type: 'refresh',
    },
    REFRESH_SECRET,
    { expiresIn: `${REFRESH_EXPIRE_DAYS}d` }
  );
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRE_DAYS * 86400 * 1000).toISOString();
  db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked) VALUES (?, ?, ?, 0)`
  ).run(user.id, hashToken(token), expiresAt);
  return token;
}

export function verifyRefreshToken(token: string): { sub: string } {
  const payload = jwt.verify(token, REFRESH_SECRET) as { sub: string; type?: string };
  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type');
  }
  return payload;
}

export function requireAuth(db: DatabaseSync) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }

    const token = authHeader.slice(7).trim();
    try {
      const payload = jwt.verify(token, ACCESS_SECRET) as { sub: string; type?: string };
      if (payload.type !== 'access') {
        res.status(401).json({ detail: 'Invalid access token' });
        return;
      }
      const user = db
        .prepare('SELECT id, email, full_name, role, is_active FROM users WHERE id = ?')
        .get(Number(payload.sub)) as AuthUser | undefined;

      if (!user || !user.is_active) {
        res.status(401).json({ detail: 'User account is inactive or does not exist' });
        return;
      }

      req.user = user;
      next();
    } catch {
      res.status(401).json({ detail: 'Invalid or expired access token' });
    }
  };
}

export function requireRoles(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ detail: 'Insufficient permissions for this operation' });
      return;
    }
    next();
  };
}
