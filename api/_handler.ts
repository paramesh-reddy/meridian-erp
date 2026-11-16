import type { Request, Response } from 'express';
import { createApiApp } from '../server/app.ts';
import { getDb } from '../server/db.ts';
import { EmailService } from '../server/emailService.ts';

let app: ReturnType<typeof createApiApp> | null = null;

function getApp() {
  if (!app) {
    const db = getDb();
    app = createApiApp(db, new EmailService(db));
  }
  return app;
}

function searchOf(url: string): string {
  const index = url.indexOf('?');
  return index >= 0 ? url.slice(index) : '';
}

function applyForwardedPath(req: Request, forwarded: string, extraSearch = ''): void {
  const path = forwarded.replace(/^\/+/, '').replace(/\/+$/, '');
  req.url = `/api/${path}${extraSearch}`;
}

/**
 * Vercel sometimes delivers the function mount path instead of the browser path.
 * Express routes are registered at /api/v1/*, so restore that full path first.
 */
export function restoreApiUrl(req: Request): void {
  const current = req.url || '/';
  const pathOnly = current.split('?')[0] || '/';
  // /api/v1/... is already the Express path. Bare /api is only the function mount.
  if (pathOnly.startsWith('/api/')) {
    return;
  }

  const search = searchOf(current);
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : '');
  const queryPath = (req.query as { __path?: string | string[] } | undefined)?.__path;
  const fromQuery = Array.isArray(queryPath) ? queryPath.join('/') : queryPath;
  const forwarded = fromQuery || params.get('__path');
  if (forwarded) {
    params.delete('__path');
    const rest = params.toString();
    applyForwardedPath(req, forwarded, rest ? `?${rest}` : '');
    return;
  }

  const slug = (req.query as { slug?: string | string[] } | undefined)?.slug;
  if (Array.isArray(slug) && slug.length > 0) {
    req.url = `/api/${slug.join('/')}${search}`;
    return;
  }
  if (typeof slug === 'string' && slug.length > 0) {
    req.url = `/api/${slug}${search}`;
    return;
  }
  if (pathOnly === '/v1' || pathOnly.startsWith('/v1/')) {
    req.url = `/api${pathOnly}${search}`;
  }
}

export default function handler(req: Request, res: Response): void {
  try {
    restoreApiUrl(req);
    getApp()(req, res);
  } catch (error) {
    console.error('API failed to start', error);
    if (res.headersSent) {
      return;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ detail: 'API failed to start', error: message }));
  }
}
