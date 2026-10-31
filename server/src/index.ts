import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config';
import { createDb } from './db/index';
import { createApp } from './app';
import { errorHandler } from './errors';

async function main() {
  const db = await createDb();
  const counts = await db.counts();
  if (!counts.users) {
    // First run on a fresh clone (or a brand-new Google Sheet): load the demo data automatically.
    console.log('[db] The database is empty -> loading demo data (same as `npm run db:seed`)...');
    const { buildSeed } = await import('../../scripts/seed');
    const { TABLES } = await import('../../shared/schema');
    const data = await buildSeed();
    for (const t of TABLES) await db.replaceTable(t.name as any, data[t.name]);
    await db.markSeeded?.();
    await db.reload();
    console.log('[db] Demo data loaded.');
  }
  const app = createApp(db);

  // Production: serve the built React app (npm run build -> dist/client) with SPA fallback.
  const clientDir = path.resolve('dist/client');
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  }
  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    console.log(`\n  Deals Separation Hub API  ->  http://localhost:${config.port}/api/health`);
    console.log(`  Database: ${db.driver} | AI: ${config.geminiApiKey ? 'Gemini (' + config.geminiModels[0] + ')' : 'offline mode (no GEMINI_API_KEY)'}\n`);
  });
  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  Port ${config.port} is already in use - another copy of the app is probably running.`);
      console.error('  Close it, or set a different PORT in .env (for example PORT=4001).\n');
    } else {
      console.error('Server error:', e);
    }
    process.exit(1);
  });
}

main().catch((e) => {
  console.error('Failed to start the server:', e);
  process.exit(1);
});
