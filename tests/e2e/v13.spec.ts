/**
 * v1.3: full-screen finance workspace and two-level access governance, through the real UI.
 * Rioja = PRJ-0002 (Partner Rajiv USR-0003, Manager Daniel USR-0005, Analyst Sneha USR-0012), Risk = Fatima USR-0015.
 */
import { test, expect, type Page } from '@playwright/test';
import { trackErrors } from './helpers';

const RIOJA = 'PRJ-0002';

async function loginAs(page: Page, userId: string) {
  await page.goto('/login');
  await page.locator('#person').selectOption(userId);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('manager: finance workspace opens from the project, every tab renders, view only', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAs(page, 'USR-0005');
  await page.goto(`/projects/${RIOJA}`);
  await page.getByRole('link', { name: 'Finance', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${RIOJA}/finance`));
  await expect(page.getByRole('heading', { name: 'Finance · Project Rioja' })).toBeVisible();
  await expect(page.getByText('View only').first()).toBeVisible();
  await expect(page.getByText('Fee budget').first()).toBeVisible();
  await expect(page.getByText('Where the time and money go, stage by stage')).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Finance sections' });
  for (const [tab, text] of [['Time & fees', 'Who did the work and who billed it'], ['Billing', 'Who billed what'], ['Costs & funding', 'Sources and uses at a glance'],
    ['Funding options', 'How M&A deal teams usually fund separation cost'], ['TSA charges', 'TSA services']] as const) {
    await tabs.getByRole('tab', { name: tab }).click();
    await expect(page.getByText(text).first()).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Add funding' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add to funding plan' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('partner: add a demo funding partner to the plan, edit it, remove it', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAs(page, 'USR-0003');
  await page.goto(`/projects/${RIOJA}/finance?tab=options`);
  await expect(page.getByText('You can edit')).toBeVisible();
  await page.getByRole('button', { name: 'Add to funding plan' }).first().click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: 'Add funding source' })).toBeVisible();
  await panel.getByLabel('Amount (USD) *').fill('250000');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Funding source added')).toBeVisible();
  await page.getByRole('tablist', { name: 'Finance sections' }).getByRole('tab', { name: 'Costs & funding' }).click();
  const row = page.locator('tr', { hasText: 'Northbridge Bank (demo)' }).filter({ hasText: 'Identified' }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('dialog').getByLabel('Status *').selectOption('Term sheet');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Funding source saved')).toBeVisible();
  const edited = page.locator('tr', { hasText: 'Northbridge Bank (demo)' }).filter({ hasText: 'Term sheet' }).first();
  await edited.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Funding source removed')).toBeVisible();
  expect(errors).toEqual([]);
});

test('analyst is locked out, Risk & Quality approves her request, then finance opens for her', async ({ page }) => {
  const errors = trackErrors(page);
  // 1. Analyst: locked screen with a request button; a seeded request (L1 done) is already waiting for Risk.
  await loginAs(page, 'USR-0012');
  await page.goto(`/projects/${RIOJA}/finance`);
  await expect(page.getByText('Finance is restricted on this project')).toBeVisible();
  await page.getByRole('button', { name: 'Request finance access' }).click();
  await expect(page.getByRole('dialog').getByText('Waiting for approval (1)')).toBeVisible();
  await page.keyboard.press('Escape');

  // 2. Risk & Quality: inbox shows it; approve level 2.
  await loginAs(page, 'USR-0015');
  await expect(page.getByRole('link', { name: /Access/ })).toBeVisible();
  await page.getByRole('link', { name: /Access/ }).click();
  await expect(page.getByRole('heading', { name: 'Access & approvals' })).toBeVisible();
  const card = page.getByRole('article', { name: /See project finance for Sneha Pillai/ });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Approve (level 2)' }).click();
  await card.getByRole('textbox').fill('Need-to-know confirmed.');
  await card.getByRole('button', { name: 'Approve and switch on' }).click();
  await expect(page.getByText(/Approved — access is live until/)).toBeVisible(); // v1.4 toast names the end date

  // 3. Analyst again: finance is open, view only, with the approval chip.
  await loginAs(page, 'USR-0012');
  await page.goto(`/projects/${RIOJA}`);
  await expect(page.getByRole('button', { name: /See project finance · until/ })).toBeVisible();
  await page.getByRole('link', { name: 'Finance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Finance · Project Rioja' })).toBeVisible();
  await expect(page.getByText(/Access approved until/)).toBeVisible();
  await expect(page.getByText('View only').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('manager sponsors access for an analyst from the project Access panel', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAs(page, 'USR-0005');
  await page.goto(`/projects/${RIOJA}`);
  await page.getByRole('button', { name: 'Access & approvals' }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: 'Access on this project' })).toBeVisible();
  await panel.getByLabel('Access for').selectOption({ label: 'Aditya Joshi (Analyst)' });
  await panel.getByLabel('Permission').selectOption({ label: 'See full phone numbers and emails' });
  await panel.getByLabel('Why is it needed?').fill('Aditya runs the vendor consent calls this week.');
  // v1.4 risk tiers: full contacts are level-1 only, so a sponsoring manager switches it on straight away
  await panel.getByRole('button', { name: 'Sponsor and switch on' }).click();
  await expect(page.getByText(/Live now — sponsored by you \(level 1 only\)/)).toBeVisible();
  await expect(panel.getByRole('article', { name: /See full phone numbers and emails for Aditya Joshi/ })).toBeVisible();
  expect(errors).toEqual([]);
});
