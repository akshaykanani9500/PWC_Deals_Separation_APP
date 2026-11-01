/**
 * v1.1 features: open-project tabs, sticky stage/activity tabs, stage overview, right-hand snapshot,
 * Table/Board/Timeline, board moves by permission, KPI filters, My work, accessibility menu,
 * Gemini key entered in the UI, and the Google Sheets setup card.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginUI, apiGet, token, trackErrors } from './helpers';

async function projectsOf(request: any, who: any) { return apiGet<any[]>(request, who, '/projects'); }

/** First activity (with tasks) of the project's current stage. */
async function firstActivity(request: any, who: any, projectId: string) {
  const detail = await apiGet<any>(request, who, `/projects/${projectId}`);
  const stageId = detail.project.current_stage_id || detail.stages[0].stage_id;
  const stage = await apiGet<any>(request, who, `/stages/${stageId}`);
  const act = stage.activities.find((a: any) => a.task_count > 0) ?? stage.activities[0];
  return { detail, stageId, stage, activityId: act.activity_id as string, url: `/projects/${projectId}/stages/${stageId}/activities/${act.activity_id}` };
}

async function useTableView(page: Page) {
  const table = page.getByRole('group', { name: 'Task view' }).getByRole('button', { name: 'Table' });
  if (await table.count()) await table.click();
}

test('open-project tabs: open two projects, switch, close, and they persist after reload', async ({ page, request }) => {
  const errors = trackErrors(page);
  await loginUI(page, 'MANAGER');
  const visible = (await projectsOf(request, 'MANAGER')).filter((p) => p.status !== 'Closed').slice(0, 2);
  expect(visible.length).toBe(2);
  const strip = page.getByRole('tablist', { name: 'Open projects' });

  for (const p of visible) {
    await page.goto('/');
    await page.locator(`table tbody a[href="/projects/${p.project_id}"]`).click();
    await expect(page.getByRole('heading', { name: p.code_name })).toBeVisible();
  }
  await expect(strip.getByRole('tab', { name: visible[0].code_name })).toBeVisible();
  await expect(strip.getByRole('tab', { name: visible[1].code_name })).toHaveAttribute('aria-selected', 'true');

  // switch with the tab strip, back and forth: each tab must keep leading to its own project
  await strip.getByRole('tab', { name: visible[0].code_name }).click();
  await expect(page.getByRole('heading', { name: visible[0].code_name })).toBeVisible();
  await strip.getByRole('tab', { name: visible[1].code_name }).click();
  await expect(page.getByRole('heading', { name: visible[1].code_name })).toBeVisible();
  await strip.getByRole('tab', { name: visible[0].code_name }).click();
  await expect(page.getByRole('heading', { name: visible[0].code_name })).toBeVisible();
  for (const p of visible) {
    await expect(strip.getByRole('tab', { name: p.code_name })).toHaveAttribute('href', new RegExp(`^/projects/${p.project_id}`));
  }

  // persists after reload
  await page.reload();
  await expect(strip.getByRole('tab', { name: visible[1].code_name })).toBeVisible();

  // close the active tab -> neighbour or dashboard opens, tab gone
  await page.getByRole('button', { name: `Close tab: ${visible[0].code_name}` }).click();
  await expect(strip.getByRole('tab', { name: visible[0].code_name })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: visible[0].code_name })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('stage and activity tabs stay at the top while scrolling; stage overview cards open activities; snapshot panel', async ({ page, request }) => {
  const errors = trackErrors(page);
  await loginUI(page, 'MANAGER');
  const p = (await projectsOf(request, 'MANAGER')).find((x) => x.status !== 'Closed')!;
  const { stageId, stage, url } = await firstActivity(request, 'MANAGER', p.project_id);

  // Stage overview: activity cards are links to activities
  await page.goto(`/projects/${p.project_id}/stages/${stageId}`);
  await expect(page.getByText('Activities in this stage')).toBeVisible();
  const firstName = stage.activities[0].name as string;
  await page.getByRole('main').getByRole('link', { name: new RegExp(firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
  await expect(page).toHaveURL(/\/activities\/ACT-/);

  // Snapshot in the right panel on stage and activity views, and it can be hidden/shown
  await page.goto(url);
  await expect(page.getByText('Project snapshot')).toBeVisible();
  await page.getByRole('button', { name: 'Hide side panel' }).click();
  await expect(page.getByText('Project snapshot')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show side panel' }).click();
  await expect(page.getByText('Project snapshot')).toBeVisible();

  // Sticky tabs: after scrolling far down, both tab rows are still near the top of the viewport
  await useTableView(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const stages = await page.getByRole('tablist', { name: 'Stages' }).boundingBox();
  const acts = await page.getByRole('tablist', { name: 'Activities' }).boundingBox();
  expect(stages && stages.y).toBeGreaterThanOrEqual(80);
  expect(stages!.y).toBeLessThan(200);
  expect(acts!.y).toBeLessThan(260);
  expect(acts!.y).toBeGreaterThan(stages!.y);
  expect(errors).toEqual([]);
});

test('task views: Table, Board, Timeline; MANAGER moves a task on the board', async ({ page, request }) => {
  const errors = trackErrors(page);
  await loginUI(page, 'MANAGER');
  const p = (await projectsOf(request, 'MANAGER')).find((x) => x.status !== 'Closed')!;
  const { activityId, url } = await firstActivity(request, 'MANAGER', p.project_id);
  await page.goto(url);
  const views = page.getByRole('group', { name: 'Task view' });

  await views.getByRole('button', { name: 'Timeline' }).click();
  await expect(views.getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-pressed', 'true');
  await views.getByRole('button', { name: 'Board' }).click();
  const board = page.getByLabel('Task board');
  await expect(board).toBeVisible();
  for (const col of ['Not Started', 'In Progress', 'Blocked', 'Done']) await expect(page.getByRole('region', { name: `${col} column` })).toBeVisible();

  // keyboard-friendly move (same code path as drag-and-drop)
  const act = await apiGet<any>(request, 'MANAGER', `/activities/${activityId}`);
  const task = act.tasks.find((t: any) => t.perms.canEdit && t.status !== 'Blocked')!;
  await page.getByLabel(`Move ${task.title} to`).selectOption('Blocked');
  await expect(page.getByRole('region', { name: 'Blocked column' }).getByText(task.title)).toBeVisible();
  await expect.poll(async () => (await apiGet<any>(request, 'MANAGER', `/tasks/${task.task_id}`)).task.status).toBe('Blocked');

  // drag-and-drop back to In Progress
  const card = page.getByRole('region', { name: 'Blocked column' }).locator('li', { hasText: task.title });
  await card.dragTo(page.getByRole('region', { name: 'In Progress column' }));
  await expect.poll(async () => (await apiGet<any>(request, 'MANAGER', `/tasks/${task.task_id}`)).task.status).toBe('In Progress');

  await views.getByRole('button', { name: 'Table' }).click();
  await expect(page.locator('[data-testid="task-title"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('board moves follow permissions: ANALYST only on own tasks, CLIENT never', async ({ page, request }) => {
  // ANALYST
  await loginUI(page, 'ANALYST');
  const me = (await apiGet<any>(request, 'ANALYST', '/auth/me')).user.user_id;
  const proj = (await projectsOf(request, 'ANALYST')).find((x) => x.status !== 'Closed')!;
  const { activityId, url } = await firstActivity(request, 'ANALYST', proj.project_id);
  await page.goto(url);
  await page.getByRole('group', { name: 'Task view' }).getByRole('button', { name: 'Board' }).click();
  const act = await apiGet<any>(request, 'ANALYST', `/activities/${activityId}`);
  for (const t of act.tasks) {
    const mover = page.getByLabel(`Move ${t.title} to`);
    if (t.assignee_user_id === me) await expect(mover).toHaveCount(1);
    else await expect(mover).toHaveCount(0);
  }
  // server refuses an ANALYST status change on someone else's task
  const other = act.tasks.find((t: any) => t.assignee_user_id !== me);
  if (other) {
    const tk = await token(request, 'ANALYST');
    const res = await request.patch(`/api/tasks/${other.task_id}`, { headers: { Authorization: `Bearer ${tk}` }, data: { status: 'Done' } });
    expect(res.status()).toBe(403);
  }
  await page.getByRole('group', { name: 'Task view' }).getByRole('button', { name: 'Table' }).click();

  // CLIENT
  await loginUI(page, 'CLIENT');
  const cp = (await projectsOf(request, 'CLIENT'))[0];
  const c = await firstActivity(request, 'CLIENT', cp.project_id);
  await page.goto(c.url);
  await page.getByRole('group', { name: 'Task view' }).getByRole('button', { name: 'Board' }).click();
  await expect(page.getByLabel('Task board')).toBeVisible();
  await expect(page.locator('select[aria-label^="Move "]')).toHaveCount(0);
  await expect(page.locator('li[draggable="true"]')).toHaveCount(0);
  await page.getByRole('group', { name: 'Task view' }).getByRole('button', { name: 'Table' }).click();
});

test('dashboard: KPI tile filters the project table; My work lists own tasks with links', async ({ page, request }) => {
  await loginUI(page, 'MANAGER');
  const visible = await projectsOf(request, 'MANAGER');
  const withOverdue = visible.filter((p) => p.overdue_tasks > 0 && p.status !== 'Closed');
  await page.getByTitle('Show projects with overdue tasks').click();
  await expect(page.getByRole('button', { name: /^Remove filter:/ })).toBeVisible();
  await expect(page.locator('table tbody tr')).toHaveCount(withOverdue.length);
  await page.getByRole('button', { name: /^Remove filter:/ }).click();
  await expect(page.getByRole('button', { name: /^Remove filter:/ })).toHaveCount(0);

  const myWork = page.locator('.card', { has: page.getByText('My work', { exact: true }) }).first();
  await expect(myWork).toBeVisible();
  const links = myWork.locator('a[href^="/projects/"]');
  expect(await links.count()).toBeGreaterThan(0);
  await links.first().click();
  await expect(page).toHaveURL(/\/projects\/PRJ-/);
  await expect(page.locator('[role="dialog"], aside').first()).toBeVisible();
});

test('accessibility menu: text size and high contrast persist', async ({ page }) => {
  await loginUI(page, 'ANALYST');
  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page.getByRole('radio', { name: 'Larger' }).click();
  await page.getByRole('switch', { name: 'High contrast' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', '125');
  await expect(page.locator('html')).toHaveClass(/(^|\s)hc(\s|$)/);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', '125');
  await expect(page.locator('html')).toHaveClass(/(^|\s)hc(\s|$)/);
  // reset for other tests sharing this browser storage
  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page.getByRole('radio', { name: 'Standard' }).click();
  await page.getByRole('switch', { name: 'High contrast' }).click();
});

test('Gemini key in the UI: test shows a clear error offline, save sends the header, key never echoed, remove clears', async ({ page }) => {
  const errors = trackErrors(page);
  const KEY = 'AQ.Ab8FakeKeyForE2eTests-0123456789abcdef';
  const sentHeaders: string[] = [];
  const leaks: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) { const h = r.headers()['x-ai-key']; if (h) sentHeaders.push(h); } });
  page.on('response', async (r) => {
    if (!r.url().includes('/api/')) return;
    try { const body = await r.text(); if (body.includes(KEY) || body.includes(KEY.slice(3, 20))) leaks.push(r.url()); } catch { /* streamed/binary */ }
  });

  await loginUI(page, 'MANAGER');
  await page.getByTestId('ai-status-button').click();
  const modal = page.getByTestId('ai-settings-modal');
  await expect(modal).toBeVisible();
  await page.getByTestId('ai-key-input').fill(KEY);
  await page.getByTestId('ai-test-button').click();
  const result = page.getByTestId('ai-test-result');
  await expect(result).toBeVisible({ timeout: 40_000 });
  await expect(result).toContainText(/reach|could not|couldn't|error|failed|rejected|invalid/i);
  await page.getByTestId('ai-save-button').click();
  expect(await page.evaluate(() => localStorage.getItem('dsh.ai.key'))).toBe(KEY);
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  // App keeps working (offline AI) and the key travels as a header
  await page.getByTestId('piku-bubble').click();
  await page.getByTestId('piku-input').fill('What is overdue on my projects?');
  const t0 = Date.now();
  await page.getByTestId('piku-send').click();
  await expect(page.getByTestId('piku-answer').last()).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - t0).toBeLessThan(10_000);
  expect(sentHeaders.length).toBeGreaterThan(0);
  expect(sentHeaders.every((h) => h === KEY)).toBe(true);
  await page.getByRole('button', { name: 'Close Piku' }).click();

  // Remove key
  await page.getByTestId('ai-status-button').click();
  await page.getByRole('button', { name: 'Remove key' }).click();
  expect(await page.evaluate(() => localStorage.getItem('dsh.ai.key'))).toBeNull();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ai-status-button')).toContainText('Add key');

  expect(leaks, 'API responses must never contain the key').toEqual([]);
  expect(errors).toEqual([]);
});

test('Google Sheets setup card: ADMIN only; others get 403', async ({ page, request }) => {
  await loginUI(page, 'ADMIN');
  await page.goto('/admin/data');
  const card = page.getByTestId('sheets-setup-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText(/Not connected|GOOGLE_SHEET_ID/);
  await expect(card).toContainText('Service Accounts');

  for (const who of ['MANAGER', 'EXEC', 'CLIENT'] as const) {
    const tk = await token(request, who);
    const s = await request.get('/api/admin/sheets/status', { headers: { Authorization: `Bearer ${tk}` } });
    expect(s.status(), `${who} status`).toBe(403);
    const i = await request.post('/api/admin/sheets/init', { headers: { Authorization: `Bearer ${tk}` }, data: { seed: false } });
    expect(i.status(), `${who} init`).toBe(403);
  }
  await loginUI(page, 'MANAGER');
  await page.goto('/admin/data');
  await expect(page.getByTestId('sheets-setup-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'This is outside your access' })).toBeVisible();
});
