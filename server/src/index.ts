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
    console.warn('[db] The database is empty. Run `npm run db:seed` to load the demo data, then restart.');
  }
  const app = createApp(db);

  // Production: serve the built React app (npm run build -> dist/client) with SPA fallback.
  const clientDir = path.resolve('dist/client');
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  }
  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`\n  Deals Separation Hub API  ->  http://localhost:${config.port}/api/health`);
    console.log(`  Database: ${db.driver} | AI: ${config.geminiApiKey ? 'Gemini (' + config.geminiModels[0] + ')' : 'offline mode (no GEMINI_API_KEY)'}\n`);
  });
}

main().catch((e) => {
  console.error('Failed to start the server:', e);
  process.exit(1);
});
