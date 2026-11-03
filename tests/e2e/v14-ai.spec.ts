/**
 * v1.4 (C): AI suggestions use what the user typed and offer options; meeting / email dialogs save to the project
 * log; custom dashboard widgets (manual + AI) persist; impossible widget requests offer "Ask the analytics team".
 */
import { test, expect, type Page } from '@playwright/test';
import { loginUI, apiGet, trackErrors } from './helpers';

async function firstActivityUrl(request: any) {
  const detail = await apiGet<any>(request, 'MANAGER', '/projects/PRJ-0001');
  const stageId = detail.project.current_stage_id || detail.stages[0].stage_id;
  const stage = await apiGet<any>(request, 'MANAGER', `/stages/${stageId}`);
  const act = stage.activities[0];
  return { url: `/projects/PRJ-0001/stages/${stageId}/activities/${act.activity_id}`, activityId: act.activity_id as string };
}

async function openCustomize(page: Page) {
  await page.getByRole('button', { name: 'Customize widgets' }).click();
  await page.getByRole('button', { name: 'New widget' }).first().click();
  return page.getByRole('dialog');
}

test('new project: typed SAP / plants / Germany inputs -> options -> tailored plan with SAP and plant activities and effort', async ({ page, request }) => {
  const errors = trackErrors(page);
  await loginUI(page, 'MANAGER');
  await page.getByRole('button', { name: 'New project' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Code name').fill('Project Kestrel E2E');
  await dlg.getByLabel('Deal type').selectOption('Sell-side carve-out');
  await dlg.getByLabel('Industry').selectOption('Industrial Manufacturing');
  await dlg.getByLabel('Description').fill('SAP S/4 carve-out, 3 plants in Germany');
  await dlg.getByRole('button', { name: 'Suggest a plan from past deals' }).click();
  const res = dlg.getByTestId('ai-suggest-result');
  await expect(res).toBeVisible({ timeout: 15000 });
  await expect(res.getByRole('radio')).toHaveCount(3);
  await expect(res.getByTestId('ai-from-inputs')).toContainText('SAP');
  await expect(res.getByTestId('ai-from-inputs')).toContainText('plants');
  // look at another option, then pick the tailored one
  await res.getByTestId('ai-option-lean').click();
  await expect(res.getByTestId('ai-option-lean')).toHaveAttribute('aria-checked', 'true');
  await res.getByTestId('ai-option-tailored').click();
  await dlg.getByTestId('ai-suggest-apply').click();
  await expect(page.getByText('Suggestion applied — review and press Save')).toBeVisible();
  await dlg.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Project Kestrel E2E' })).toBeVisible();
  const pid = page.url().match(/projects\/(PRJ-\d+)/)![1];
  const detail = await apiGet<any>(request, 'MANAGER', `/projects/${pid}`);
  const names: string[] = []; let hours = 0;
  for (const s of detail.stages) {
    const sd = await apiGet<any>(request, 'MANAGER', `/stages/${s.stage_id}`);
    names.push(...sd.activities.map((a: any) => a.name));
    for (const a of sd.activities) hours += (await apiGet<any>(request, 'MANAGER', `/activities/${a.activity_id}`)).stats.hours;
  }
  expect(names.join(' | ')).toMatch(/ERP clone & data carve-out/);
  expect(names.join(' | ')).toMatch(/Plant \/ OT cut-over/);
  expect(hours, 'tasks were created with effort hours').toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('meeting dialog: create a demo link, save to the project log -> toast and the communications list updates', async ({ page, request }) => {
  const errors = trackErrors(page);
  const { url } = await firstActivityUrl(request);
  await loginUI(page, 'MANAGER');
  await page.goto(url);
  await page.getByTestId('ai-actions').getByRole('button', { name: 'Schedule meeting' }).click();
  const modal = page.getByRole('dialog', { name: 'Schedule a meeting' });
  await expect(modal.getByLabel('Meeting title')).toBeVisible({ timeout: 15000 });
  await modal.getByLabel('Meeting title').fill('Exit sequencing working session E2E');
  await modal.getByRole('button', { name: 'Create meeting link' }).click();
  await expect(modal.getByTestId('meeting-link')).toContainText('https://meet.example.com/dsh-');
  // the footer is inside the viewport and clickable (not clipped by the side panel)
  const save = modal.getByRole('button', { name: 'Save to project log' });
  await expect(save).toBeInViewport();
  await save.click();
  await expect(page.getByText('Meeting saved to the project log')).toBeVisible();
  await expect(modal).toHaveCount(0);
  await expect(page.getByText('Exit sequencing working session E2E').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('email dialog: edit recipients and subject, save to the project log', async ({ page, request }) => {
  const { url, activityId } = await firstActivityUrl(request);
  await loginUI(page, 'MANAGER');
  await page.goto(url);
  await page.getByTestId('ai-actions').getByRole('button', { name: 'Draft email' }).click();
  const modal = page.getByRole('dialog', { name: 'Draft email' });
  await expect(modal.getByLabel('Subject')).toBeVisible({ timeout: 15000 });
  await modal.getByLabel('Add recipient to CC').selectOption({ index: 1 });
  await expect(modal.getByRole('textbox', { name: 'CC', exact: true })).not.toHaveValue('');
  await modal.getByLabel('Subject').fill('Status and next steps E2E');
  const mail = modal.getByRole('link', { name: 'Open in mail app' });
  await expect(mail).toHaveAttribute('href', /^mailto:.*subject=Status%20and%20next%20steps%20E2E/);
  await modal.getByRole('button', { name: 'Save to project log' }).click();
  await expect(page.getByText('Email saved to the project log')).toBeVisible();
  const act = await apiGet<any>(request, 'MANAGER', `/activities/${activityId}`);
  expect(act.communications.some((c: any) => c.channel === 'Email' && c.subject === 'Status and next steps E2E')).toBe(true);
});

test('manual custom widget is created and persists after reload', async ({ page }) => {
  const errors = trackErrors(page);
  await loginUI(page, 'MANAGER');
  const b = await openCustomize(page);
  await b.getByRole('tab', { name: 'Build it' }).click();
  await b.getByLabel('Widget title').fill('Blocked tasks by priority E2E');
  await b.getByLabel('Measure').selectOption('blocked_tasks');
  await b.getByLabel('Group by').selectOption('priority');
  await b.getByLabel('Chart type').selectOption('table');
  await expect(b.getByTestId('widget-preview')).toContainText('Blocked tasks by priority E2E');
  await b.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(page.getByText('Widget "Blocked tasks by priority E2E" added to your dashboard')).toBeVisible();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await page.reload();
  await expect(page.getByTestId('custom-widget').filter({ hasText: 'Blocked tasks by priority E2E' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('AI widget request is turned into a widget', async ({ page }) => {
  await loginUI(page, 'MANAGER');
  const b = await openCustomize(page);
  await b.getByLabel('Describe the widget').fill('open tasks by workstream lead as a pie');
  await b.getByRole('button', { name: 'Suggest widget' }).click();
  await expect(b.getByTestId('widget-ai-result')).toBeVisible();
  await b.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(page.getByTestId('custom-widget').filter({ hasText: /Open tasks by workstream lead/ })).toBeVisible();
});

test('impossible widget request offers "Ask the analytics team"', async ({ page, request }) => {
  await loginUI(page, 'MANAGER');
  const b = await openCustomize(page);
  await b.getByLabel('Describe the widget').fill('stock price of PwC');
  await b.getByRole('button', { name: 'Suggest widget' }).click();
  await expect(b.getByTestId('widget-ai-impossible')).toBeVisible();
  await b.getByRole('button', { name: 'Ask the analytics team' }).click();
  await expect(page.getByText('Request sent to the analytics team (demo)')).toBeVisible();
  const audit = await apiGet<any[]>(request, 'RISK', '/audit');
  expect(audit.some((a) => a.action === 'dashboard.widget_request')).toBe(true);
});
