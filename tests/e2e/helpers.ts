import { expect, type Page, type APIRequestContext } from '@playwright/test';

/** One demo person per persona (see scripts/seed-data.ts). */
export const PEOPLE = {
  EXEC: { id: 'USR-0001', name: 'Vikram Mehta' },
  PARTNER: { id: 'USR-0002', name: 'Sarah Whitfield' },
  MANAGER: { id: 'USR-0004', name: 'Ananya Rao' },
  LEAD: { id: 'USR-0007', name: 'Arjun Nair' },
  ANALYST: { id: 'USR-0010', name: 'Neha Gupta' },
  KM: { id: 'USR-0014', name: 'Meera Krishnan' },
  RISK: { id: 'USR-0015', name: 'Fatima Sheikh' },
  CLIENT: { id: 'USR-0016', name: 'Lisa Moreno' },
  ADMIN: { id: 'USR-0018', name: 'Rahul Verma' },
} as const;
export type PersonaKey = keyof typeof PEOPLE;

/** Sign in through the real login screen (dropdown + button). */
export async function loginUI(page: Page, who: PersonaKey) {
  await page.goto('/login');
  const select = page.locator('#person');
  await expect(select).toBeVisible();
  await select.selectOption(PEOPLE[who].id);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/** API token for direct checks. */
export async function token(request: APIRequestContext, who: PersonaKey) {
  const res = await request.post('/api/auth/login', { data: { userId: PEOPLE[who].id } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token as string;
}

export async function apiGet<T = any>(request: APIRequestContext, who: PersonaKey, path: string): Promise<T> {
  const t = await token(request, who);
  const res = await request.get(`/api${path}`, { headers: { Authorization: `Bearer ${t}` } });
  expect(res.status(), `${who} GET ${path}`).toBe(200);
  return res.json();
}

export async function apiPost<T = any>(request: APIRequestContext, who: PersonaKey, path: string, data: unknown): Promise<T> {
  const t = await token(request, who);
  const res = await request.post(`/api${path}`, { headers: { Authorization: `Bearer ${t}` }, data });
  expect(res.status(), `${who} POST ${path}: ${await res.text()}`).toBeLessThan(300);
  return res.json();
}

/** Collect uncaught page errors so a test fails on any client crash. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
