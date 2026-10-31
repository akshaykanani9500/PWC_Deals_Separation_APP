/**
 * Starts the app for end-to-end tests: a fresh temp database (auto-seeded on start) and the built UI.
 * Used by playwright.config.ts -> webServer. Cross-platform (no shell syntax).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-e2e-'));
process.env.DATA_DIR = dir;
process.env.DB_DRIVER = 'local';
process.env.PORT = process.env.E2E_PORT || '4300';
// AI runs offline in tests so results are deterministic (a fake key also proves the offline fallback).
process.env.GEMINI_API_KEY = process.env.E2E_GEMINI_KEY ?? '';
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
await import('../../server/src/index');
