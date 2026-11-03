/**
 * v1.4 finance: funding-gap analysis, bank outreach and finance for new / low-data projects, through the real UI.
 * Rioja = PRJ-0002 (Partner Rajiv USR-0003, Manager Daniel USR-0005).
 */
import { test, expect, type Page } from '@playwright/test';
import { apiPost, trackErrors } from './helpers';

const RIOJA = 'PRJ-0002';

async function loginAs(page: Page, userId: string) {
  await page.goto('/login');
  await page.locator('#person').selectOption(userId);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('Rioja overview shows the funding gap, four split scenarios and a recommendation', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAs(page, 'USR-0005');
  await page.goto(`/projects/${RIOJA}/finance`);
  await expect(page.getByText('Funding gap $1.74M')).toBeVisible();
  const table = page.getByRole('table', { name: 'Cost-sharing scenarios' });
  for (const name of ['Beneficiary pays', 'Even split of shared lines', 'Usage-based', 'Avoided-cost credit']) await expect(table.getByText(name)).toBeVisible();
  await expect(table.getByText('Recommended')).toHaveCount(1);
  await expect(page.getByText(/^Recommended: /)).toBeVisible();
  await page.getByRole('tab', { name: 'Gap & split' }).click();
  await expect(page.getByText('AI summary')).toBeVisible();
  await expect(page.getByText(/AI-generated \(offline\)/)).toBeVisible();
  await expect(page.getByText('How similar past deals handled it')).toBeVisible();
  // evidence rows open the cost line
  await page.getByRole('button', { name: /^IT infrastructure:/ }).click();
  await expect(page).toHaveURL(/tab=funding&cost=CST-/);
  expect(errors).toEqual([]);
});

test('manager drafts a bank request; partner marks it sent and records a term sheet', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAs(page, 'USR-0005');
  await page.goto(`/projects/${RIOJA}/finance?tab=options`);
  await page.getByRole('button', { name: /Request financing from Bank 1/ }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByLabel('Amount (USD) *')).toHaveValue('174000');
  await panel.getByRole('button', { name: 'Draft email with AI' }).click();
  await expect(panel.getByLabel('Body')).toHaveValue(/Project Rioja/);
  await expect(panel.getByRole('button', { name: 'Mark as sent' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.getByText('Financing request saved as draft')).toBeVisible();
  const row = page.getByRole('row', { name: /Bank 1 \(demo\)/ });
  await expect(row.getByText('Draft', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Mark sent' })).toHaveCount(0);

  await loginAs(page, 'USR-0003');
  await page.goto(`/projects/${RIOJA}/finance?tab=options`);
  const prow = page.getByRole('row', { name: /Bank 1 \(demo\)/ });
  await prow.getByRole('button', { name: 'Mark sent' }).click();
  await expect(page.getByText(/Marked as sent to Alex Morgan/)).toBeVisible();
  await expect(prow.getByText('Sent', { exact: true })).toBeVisible();
  await prow.getByRole('button', { name: 'Term sheet received' }).click();
  const ts = page.getByRole('dialog');
  await ts.getByLabel('Interest rate %').fill('9.75');
  await ts.getByLabel('Tenor (months)').fill('12');
  await ts.getByRole('button', { name: 'Record term sheet' }).click();
  await expect(page.getByText('Term sheet recorded: funding line added to Costs & funding')).toBeVisible();
  await page.getByRole('tab', { name: 'Costs & funding' }).click();
  await expect(page.locator('tr', { hasText: 'Bank 1 (demo) – Northbridge Bank' }).filter({ hasText: 'Term sheet' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('new project with finance fields shows numbers; a project without data offers set-up', async ({ page, request }) => {
  const errors = trackErrors(page);
  await loginAs(page, 'USR-0003');
  await page.getByRole('button', { name: 'New project' }).click();
  const panel = page.getByRole('dialog');
  await panel.getByPlaceholder('e.g. Project Atlas').fill('Project Zircon');
  await panel.getByRole('button', { name: /Finance \(optional\)/ }).click();
  await panel.getByLabel('PwC fee budget (USD)').fill('600000');
  await panel.getByLabel('One-time separation cost estimate (USD)').fill('2500000');
  await panel.getByLabel('Known funding gap (USD)').fill('400000');
  await panel.getByLabel('Seller cap from the SPA (USD)').fill('1000000');
  await panel.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Project Project Zircon created').or(page.getByText('Project Zircon created'))).toBeVisible();
  const pid = /projects\/(PRJ-\d+)/.exec(page.url())![1];
  await page.goto(`/projects/${pid}/finance`);
  await expect(page.getByText('Funding gap $400K')).toBeVisible();
  await expect(page.getByText('$600K').first()).toBeVisible();
  await expect(page.getByText('$2.5M').first()).toBeVisible();

  const empty = await apiPost(request, 'PARTNER', '/projects', { code_name: 'Project Basalt' });
  await loginAs(page, 'USR-0002');
  await page.goto(`/projects/${empty.project.project_id}/finance`);
  await expect(page.getByText(/Not enough finance data/)).toBeVisible();
  await expect(page.getByText('Not set').first()).toBeVisible();
  await page.getByRole('button', { name: 'Set up finance' }).first().click();
  const sp = page.getByRole('dialog');
  await sp.getByLabel('One-time separation cost estimate (USD)').fill('1000000');
  await sp.getByLabel('Amount, line 1').fill('600000');
  await sp.getByLabel('Amount, line 2').fill('400000');
  await sp.getByRole('button', { name: 'Save finance set-up' }).click();
  await expect(page.getByText('Finance set up: figures saved')).toBeVisible();
  await expect(page.getByText('Funding gap $1M')).toBeVisible();
  expect(errors).toEqual([]);
});
