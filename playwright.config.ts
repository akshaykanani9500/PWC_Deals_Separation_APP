import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const PORT = Number(process.env.E2E_PORT || 4300);

// Normally Playwright uses the browser from `npx playwright install chromium`.
// If that exact build is missing but another Chromium is already installed (CI images, sandboxes),
// use it instead: E2E_CHROMIUM_PATH, or any chromium-* folder under PLAYWRIGHT_BROWSERS_PATH.
function findChromium(): string | undefined {
  if (process.env.E2E_CHROMIUM_PATH) return process.env.E2E_CHROMIUM_PATH;
  try {
    const req = createRequire(import.meta.url);
    const p = req('playwright').chromium.executablePath();
    if (p && fs.existsSync(p)) return undefined; // the managed browser is installed: let Playwright use it
  } catch { /* ignore */ }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return undefined;
  for (const dir of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win/chrome.exe', 'chrome-win64/chrome.exe',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const exe = path.join(root, dir, sub);
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}
const executablePath = findChromium();

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npx tsx tests/e2e/server.ts',
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { E2E_PORT: String(PORT) },
  },
});
