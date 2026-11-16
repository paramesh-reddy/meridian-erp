import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { getDb } from './server/db.ts';
import { EmailService } from './server/emailService.ts';
import { createApiApp } from './server/app.ts';

async function startServer() {
  const port = Number(process.env.PORT || 3000);
  const db = getDb();
  const emailService = new EmailService(db);
  const app = createApiApp(db, emailService);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Meridian ERP server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
