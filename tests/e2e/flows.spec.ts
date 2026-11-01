/**
 * End-to-end business flows: AI-planned project, AI-suggested stages/activities, analyst task edit,
 * Piku in English and Hindi without leaks, and the close-out -> knowledge -> reuse loop.
 * Tests run in order on one seeded database.
 */
import { test, expect, type Page } from '@playwright/test';
import { PEOPLE, loginUI, apiGet, apiPost, token, trackErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

async function askPiku(page: Page, question: string) {
  const bubble = page.getByTestId('piku-bubble');
  if (await bubble.isVisible()) await bubble.click();
  const panel = page.getByTestId('piku-panel');
  await expect(panel).toBeVisible();
  const before = await panel.getByTestId('piku-answer').count();
  await panel.getByTestId('piku-input').fill(question);
  await panel.getByTestId('piku-send').click();
  await expect(panel.getByTestId('piku-answer')).toHaveCount(before + 1, { timeout: 15000 });
  const answer = panel.getByTestId('piku-answer').last();
  return {
    text: (await answer.innerText()).trim(),
    sources: await answer.getByTestId('piku-source').evaluateAll((els) => els.map((e) => e.getAttribute('data-href') || '')),
  };
}

test('MANAGER creates a project from an AI-suggested plan', async ({ page, request }) => {
  const errors = trackErrors(page);
  await loginUI(page, 'MANAGER');
  await page.getByRole('button', { name: 'New project' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Code name').fill('Project Orion E2E');
  await dlg.getByLabel('Client (described, no real name)').fill('Global payments firm selling its prepaid card unit');
  await dlg.getByLabel('Deal type').selectOption('TSA exit');
  await dlg.getByLabel('Industry').selectOption('Financial Services & Payments');
  await dlg.getByRole('button', { name: 'Suggest a plan from past deals' }).click();
  await expect(dlg.getByTestId('ai-suggest-result')).toBeVisible({ timeout: 15000 });
  await dlg.getByTestId('ai-suggest-apply').click();
  await expect(dlg.getByText(/Based on:/)).toBeVisible();
  await dlg.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Project Orion E2E' })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/PRJ-\d+\/stages\/STG-/);
  const pid = page.url().match(/projects\/(PRJ-\d+)/)![1];
  const detail = await apiGet(request, 'MANAGER', `/projects/${pid}`);
  expect(detail.stages.length).toBeGreaterThanOrEqual(5);
  const stage = await apiGet(request, 'MANAGER', `/stages/${detail.stages[0].stage_id}`);
  expect(stage.activities.length, 'AI plan created activities').toBeGreaterThan(0);
  expect(stage.activities.reduce((n: number, a: any) => n + a.task_count, 0), 'AI plan created tasks').toBeGreaterThan(0);
  // audit marks the creation as AI-assisted
  const audit = await apiGet<any[]>(request, 'RISK', `/audit?projectId=${pid}`);
  expect(audit.some((a) => a.ai_generated === 'Y')).toBe(true);
  expect(errors).toEqual([]);
});

test('MANAGER adds AI-suggested stages and activities and saves them', async ({ page, request }) => {
  await loginUI(page, 'MANAGER');
  await page.goto('/projects/PRJ-0004');
  const before = await apiGet(request, 'MANAGER', '/projects/PRJ-0004');

  // Stages
  await page.getByRole('button', { name: 'Edit stages' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Suggest stages' }).click();
  await expect(dlg.getByTestId('ai-suggest-result')).toBeVisible({ timeout: 15000 });
  await dlg.getByTestId('ai-suggest-apply').click();
  const addSel = dlg.getByRole('button', { name: 'Add selected to the list' });
  if (await addSel.isEnabled()) {
    await addSel.click();
  } else {
    // nothing new to suggest: add one stage by hand so the save path is still exercised
    await dlg.getByRole('button', { name: /Add stage/ }).click();
    await dlg.getByLabel('Stage name').last().fill('Hypercare');
  }
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg).toHaveCount(0);
  const afterStages = await apiGet(request, 'MANAGER', '/projects/PRJ-0004');
  expect(afterStages.stages.length).toBeGreaterThan(before.stages.length);

  // Activities in the first stage
  await page.goto(`/projects/PRJ-0004/stages/${afterStages.stages[0].stage_id}`);
  const stageBefore = await apiGet(request, 'MANAGER', `/stages/${afterStages.stages[0].stage_id}`);
  await page.getByRole('button', { name: 'Edit activities' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Suggest activities' }).click();
  await expect(dlg.getByTestId('ai-suggest-result')).toBeVisible({ timeout: 15000 });
  await dlg.getByTestId('ai-suggest-apply').click();
  const addActs = dlg.getByRole('button', { name: 'Add selected to the list' });
  if (await addActs.isEnabled()) {
    await addActs.click();
  } else {
    // the stage already covers every suggested activity: add one by hand so the save path is still exercised
    await dlg.getByRole('button', { name: /Add activity/ }).click();
    await dlg.getByLabel('Activity name').last().fill('Clean-room data access review');
  }
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg).toHaveCount(0);
  const stageAfter = await apiGet(request, 'MANAGER', `/stages/${afterStages.stages[0].stage_id}`);
  expect(stageAfter.activities.length).toBeGreaterThan(stageBefore.activities.length);
  await expect(page.getByRole('tablist', { name: 'Activities' }).getByRole('tab')).toHaveCount(stageAfter.activities.length);
});

test('ANALYST can only change status and notes on own task', async ({ page, request }) => {
  const errors = trackErrors(page);
  // find a task assigned to the analyst on Phoenix
  const t = await token(request, 'ANALYST');
  const exec = await apiGet<any[]>(request, 'ANALYST', '/projects');
  expect(exec.some((p) => p.project_id === 'PRJ-0001')).toBe(true);
  const proj = await apiGet(request, 'ANALYST', '/projects/PRJ-0001');
  let own: any = null;
  for (const s of proj.stages) {
    const sd = await apiGet(request, 'ANALYST', `/stages/${s.stage_id}`);
    for (const a of sd.activities) {
      const ad = await apiGet(request, 'ANALYST', `/activities/${a.activity_id}`);
      own = ad.tasks.find((x: any) => x.assignee_user_id === PEOPLE.ANALYST.id && x.status !== 'Done');
      if (own) break;
    }
    if (own) break;
  }
  expect(own, 'analyst has an open task').toBeTruthy();

  await loginUI(page, 'ANALYST');
  await page.goto(`/projects/PRJ-0001/stages/${own.stage_id}/activities/${own.activity_id}?task=${own.task_id}`);
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('heading', { name: own.title })).toBeVisible();
  await expect(dlg.getByLabel('Title')).toBeDisabled();
  await expect(dlg.getByLabel('Assignee')).toBeDisabled();
  await expect(dlg.getByLabel('Due date')).toBeDisabled();
  await dlg.getByLabel('Status').selectOption('Blocked');
  await dlg.getByLabel('What is still pending').fill('Waiting for vendor consent letter (e2e).');
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await apiGet(request, 'ANALYST', `/tasks/${own.task_id}`)).task.status).toBe('Blocked');
  const after = await apiGet(request, 'ANALYST', `/tasks/${own.task_id}`);
  expect(after.task.pending_notes).toContain('vendor consent');

  // API refuses a title change
  const res = await request.patch(`/api/tasks/${own.task_id}`, { headers: { Authorization: `Bearer ${t}` }, data: { title: 'hacked' } });
  expect(res.status()).toBe(403);
  // and someone else's task
  const other = (await apiGet(request, 'MANAGER', `/activities/${own.activity_id}`)).tasks.find((x: any) => x.assignee_user_id !== PEOPLE.ANALYST.id);
  if (other) {
    const r2 = await request.patch(`/api/tasks/${other.task_id}`, { headers: { Authorization: `Bearer ${t}` }, data: { status: 'Done' } });
    expect(r2.status()).toBe(403);
  }
  expect(errors).toEqual([]);
});

for (const who of ['ANALYST', 'CLIENT'] as const) {
  test(`${who}: Piku answers in English and Hindi without leaking other projects`, async ({ page, request }) => {
    await loginUI(page, who);
    const visible = new Set((await apiGet<any[]>(request, who, '/projects?includeClosed=1')).map((p) => p.project_id));
    const all = await apiGet<any[]>(request, 'EXEC', '/projects?includeClosed=1');
    const hidden = all.filter((p) => !visible.has(p.project_id));

    const en = await askPiku(page, 'What is overdue across my projects?');
    expect(en.text.length).toBeGreaterThan(20);
    expect(en.text).toMatch(/AI-generated/i);
    expect(en.sources.length, 'answer cites sources').toBeGreaterThan(0);

    const hi = await askPiku(page, 'मेरे प्रोजेक्ट का स्टेटस बताओ');
    expect(hi.text).toMatch(/[ऀ-ॿ]/); // Devanagari answer

    for (const p of hidden.slice(0, 3)) {
      const r = await askPiku(page, `What is the status and fee of ${p.code_name}?`);
      for (const href of [...en.sources, ...hi.sources, ...r.sources]) expect(href).not.toContain(p.project_id);
      if (p.client_alias) expect(r.text).not.toContain(p.client_alias);
    }
    if (who === 'CLIENT') {
      const r = await askPiku(page, 'Give me the phone number of the seller IT lead and the TSA fees');
      expect(r.text).not.toMatch(/\+?\d[\d\s-]{8,}\d/);
      expect(r.text).not.toMatch(/\$\s?\d|USD\s?\d|₹\s?\d/);
    }
  });
}

test('close-out -> knowledge pending -> KM approves -> AI suggestion reuses it', async ({ page, request }) => {
  // PARTNER closes Project Everest (Closing) with consent
  await loginUI(page, 'PARTNER');
  await page.goto('/projects/PRJ-0007');
  await page.getByRole('button', { name: 'Close project' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Reuse consent').selectOption('Granted');
  await expect(dlg.getByLabel('Lessons learned')).not.toHaveValue('');
  await dlg.getByRole('button', { name: /Close and send \d+ items? for review/ }).click();
  await expect(dlg).toHaveCount(0);
  const p = await apiGet(request, 'PARTNER', '/projects/PRJ-0007');
  expect(p.project.status).toBe('Closed');
  await expect(page.getByRole('button', { name: 'Close project' })).toHaveCount(0);

  // KM sees pending items from it and approves a stage template
  const pending = (await apiGet<any[]>(request, 'KM', '/knowledge?status=Pending%20Review'))
    .filter((k) => k.deal_type === 'TSA exit' && k.industry === 'Consumer & Retail');
  expect(pending.length).toBeGreaterThan(0);
  const target = pending.find((k) => k.item_type === 'Stage Template') ?? pending[0];
  expect(target.source_project_id).toBeUndefined();
  await loginUI(page, 'KM');
  await page.goto('/knowledge');
  await page.getByLabel('Review status').selectOption('Pending Review');
  await page.locator('tbody tr', { hasText: target.title }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve for reuse' }).click();
  await expect.poll(async () => (await apiGet<any[]>(request, 'KM', '/knowledge')).find((k) => k.knowledge_id === target.knowledge_id)?.review_status)
    .toBe('Approved');

  // A new TSA-exit retail project now gets suggestions based on it
  const sug = await apiPost(request, 'MANAGER', '/ai/suggest', { kind: 'project', hints: { deal_type: 'TSA exit', industry: 'Consumer & Retail' } });
  expect(sug.sources.map((s: any) => s.id)).toContain(target.knowledge_id);

  await loginUI(page, 'MANAGER');
  await page.getByRole('button', { name: 'New project' }).click();
  const np = page.getByRole('dialog');
  await np.getByLabel('Deal type').selectOption('TSA exit');
  await np.getByLabel('Industry').selectOption('Consumer & Retail');
  await np.getByRole('button', { name: 'Suggest a plan from past deals' }).click();
  await expect(np.getByTestId('ai-suggest-result')).toBeVisible({ timeout: 15000 });
  await expect(np.getByTestId('ai-suggest-result')).toContainText(target.source_label);
});
