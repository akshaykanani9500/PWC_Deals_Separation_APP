/**
 * v1.4: risk-tiered approvals, the top-bar approvals bell, toasts with names, acting roles and admin reset, through the UI.
 * Phoenix = PRJ-0001 (Partner Sarah USR-0002, Manager Ananya USR-0004, Analyst Neha USR-0010).
 * Falcon  = PRJ-0008 (Partner Rajiv USR-0003, Manager Daniel, Analyst Sneha USR-0012). Risk = Fatima USR-0015. Admin = Rahul USR-0018.
 */
import { test, expect, type Page } from '@playwright/test';
import { trackErrors } from './helpers';

async function loginAs(page: Page, userId: string) {
  await page.goto('/login');
  await page.locator('#person').selectOption(userId);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
const bell = (page: Page) => page.getByRole('button', { name: /^Approvals and access updates/ });

test('analyst asks, toast names the approver, approver approves from the bell, analyst sees it live', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAs(page, 'USR-0010');
  await page.goto('/projects/PRJ-0001');
  await page.getByRole('button', { name: 'Request access' }).click();
  const panel = page.getByRole('dialog');
  await panel.getByLabel('Permission').selectOption({ label: 'Add and edit activities' });
  await expect(panel.getByText('Needs: level 1 only')).toBeVisible();
  await expect(panel.getByText(/Level 1: Ananya Rao \(Manager\) or Sarah Whitfield \(Partner\)/)).toBeVisible();
  await panel.getByLabel('Why is it needed?').fill('I am planning the cut-over activities for the Day-1 weekend.');
  await panel.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Sent. Next: level 1 — Ananya Rao (Manager) or Sarah Whitfield (Partner). Level 1 is all this needs.')).toBeVisible();
  await expect(panel.getByRole('article', { name: /Add and edit activities for Neha Gupta/ }).getByText(/Next approver:/)).toBeVisible();
  await page.keyboard.press('Escape');

  // Approver: sign-in toast counts what waits, the bell shows it, approve inline.
  await loginAs(page, 'USR-0004');
  await expect(page.getByText(/Signed in as Ananya Rao \(.+\) — \d+ requests? waiting for you/)).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName(/[1-9]\d* waiting for you/);
  await bell(page).click();
  const pop = page.getByRole('dialog', { name: 'Approvals and access updates' });
  await expect(pop.getByRole('heading', { name: /Waiting for you/ })).toBeVisible();
  const item = pop.getByRole('listitem', { name: /Add and edit activities for Neha Gupta/ });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: /^Approve/ }).click();
  await item.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText(/Approved — access is live until/)).toBeVisible();
  await expect(item).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(bell(page)).toBeFocused();

  // Requester: bell shows a new update, "Your requests" says live.
  await loginAs(page, 'USR-0010');
  await expect(bell(page)).toHaveAccessibleName(/1 new update/);
  await bell(page).click();
  const mine = page.getByRole('dialog', { name: 'Approvals and access updates' });
  await expect(mine.getByText('New')).toBeVisible();
  await expect(mine.getByText(/Active: Live until/)).toBeVisible();
  // the rules explainer opens from the bell and closes with Esc
  await mine.getByRole('button', { name: 'How approval works' }).click();
  await expect(page.getByRole('dialog', { name: 'How approval works' }).getByRole('cell', { name: /Act as Engagement Manager/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'How approval works' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(bell(page)).not.toHaveAccessibleName(/new update/);
  expect(errors).toEqual([]);
});

test('partner sponsors an acting role from the team panel; Risk approves; the analyst can run the project', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAs(page, 'USR-0003');
  await page.goto('/projects/PRJ-0008');
  await page.getByRole('button', { name: /^Team \(/ }).click();
  await page.getByRole('button', { name: 'Give extra access to Sneha Pillai' }).click();
  const panel = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Access on this project' }) });
  await expect(panel.getByLabel('Access for')).toHaveValue('USR-0012');
  await panel.getByLabel('Permission').selectOption({ label: 'Act as Engagement Manager on this project' });
  await expect(panel.getByRole('radio', { name: '90 days' })).toHaveCount(0);
  await expect(panel.getByText(/Level 2: Risk & Quality \(Fatima Sheikh\)/)).toBeVisible();
  await panel.getByLabel('Why is it needed?').fill('Daniel is on leave; Sneha runs Falcon day to day for two weeks.');
  await panel.getByRole('button', { name: 'Sponsor and send to Risk & Quality' }).click();
  await expect(page.getByText('Sponsored — level 1 is done. Now with Risk & Quality: Fatima Sheikh.')).toBeVisible();

  await loginAs(page, 'USR-0015');
  await bell(page).click();
  const item = page.getByRole('dialog', { name: 'Approvals and access updates' }).getByRole('listitem', { name: /Act as Engagement Manager on this project for Sneha Pillai/ });
  await item.getByRole('button', { name: /^Approve/ }).click();
  await item.getByRole('textbox').fill('Cover agreed; gates stay with Rajiv.');
  await item.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText(/Approved — access is live until/)).toBeVisible();

  await loginAs(page, 'USR-0012');
  await page.goto('/projects/PRJ-0008');
  await expect(page.getByRole('button', { name: /Act as Engagement Manager on this project · until/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit project' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Close project' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('admin resets the demo data after typing RESET', async ({ page, request }) => {
  const errors = trackErrors(page);
  await loginAs(page, 'USR-0018');
  await page.goto('/admin/data');
  await page.getByRole('button', { name: 'Reset demo data' }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg.getByRole('button', { name: 'Reset demo data' })).toBeDisabled();
  await dlg.getByLabel('Type RESET to confirm').fill('RESET');
  await dlg.getByRole('button', { name: 'Reset demo data' }).click();
  await expect(page.getByText(/Demo data restored/)).toBeVisible();
  await expect(dlg).toHaveCount(0);
  // Sneha's acting role from the previous test is gone; the seeded acting-role example is back.
  const tok = (await (await request.post('/api/auth/login', { data: { userId: 'USR-0012' } })).json()).token;
  const d = await (await request.get('/api/projects/PRJ-0008', { headers: { Authorization: `Bearer ${tok}` } })).json();
  expect(d.perms.canEditProject).toBe(false);
  const rt = (await (await request.post('/api/auth/login', { data: { userId: 'USR-0015' } })).json()).token;
  const inbox = await (await request.get('/api/access/requests?view=inbox', { headers: { Authorization: `Bearer ${rt}` } })).json();
  expect(inbox.some((g: any) => g.permission_code === 'role.LEAD')).toBe(true);
  expect(errors).toEqual([]);
});
