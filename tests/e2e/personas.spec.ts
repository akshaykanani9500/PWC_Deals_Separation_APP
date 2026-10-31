/**
 * Every persona: login -> dashboard widgets -> project table scope -> project -> stage tabs -> activity tabs ->
 * task table -> task side panel, and the edit controls each role should (not) get. Forbidden pages show 403.
 */
import { test, expect } from '@playwright/test';
import { PERMISSIONS } from '../../shared/permissions';
import { PEOPLE, type PersonaKey, loginUI, apiGet, trackErrors } from './helpers';

const PERSONAS = Object.keys(PEOPLE) as PersonaKey[];
const can = (p: PersonaKey, a: string) => (PERMISSIONS[p].actions as string[]).includes(a);

for (const persona of PERSONAS) {
  test(`${persona}: login, dashboard, project drill-down and permissions`, async ({ page, request }) => {
    const errors = trackErrors(page);
    await loginUI(page, persona);

    // Header shows who is signed in
    await expect(page.getByText(PEOPLE[persona].name).first()).toBeVisible();

    // Dashboard widgets
    await expect(page.getByText('Active projects').first()).toBeVisible();
    const finance = page.getByText('TSA run-rate per month');
    if (can(persona, 'finance.view')) await expect(finance).toBeVisible();
    else {
      await expect(finance).toHaveCount(0);
      await expect(page.getByText('Finance figures are hidden for your role.')).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(can(persona, 'project.create') ? 1 : 0);

    // Project table = exactly the projects this persona may see
    const visible = await apiGet<any[]>(request, persona, '/projects');
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();
    await expect(rows).toHaveCount(visible.length);
    const shown = await page.locator('table tbody tr a[href^="/projects/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(new Set(shown)).toEqual(new Set(visible.map((p) => `/projects/${p.project_id}`)));

    // Open the first project
    const first = visible.find((p) => p.status !== 'Closed') ?? visible[0];
    await page.locator(`table tbody a[href="/projects/${first.project_id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${first.project_id}/stages/STG-`));
    await expect(page.getByRole('heading', { name: first.code_name })).toBeVisible();

    const detail = await apiGet<any>(request, persona, `/projects/${first.project_id}`);
    // Stage tabs
    const stageTabs = page.getByRole('tablist', { name: 'Stages' }).getByRole('tab');
    await expect(stageTabs).toHaveCount(detail.stages.length);
    expect(detail.stages.length).toBeGreaterThanOrEqual(5);
    const editStages = page.getByRole('button', { name: 'Edit stages' });
    if (detail.perms.canEditStages) await expect(editStages).toBeEnabled(); else await expect(editStages).toBeDisabled();
    expect(detail.perms.canEditStages).toBe(can(persona, 'stage.edit'));

    // Header buttons
    await expect(page.getByRole('button', { name: 'Finance' })).toHaveCount(can(persona, 'finance.view') ? 1 : 0);
    await expect(page.getByRole('button', { name: 'Close project' })).toHaveCount(detail.perms.canClose ? 1 : 0);
    const editProject = page.getByRole('button', { name: 'Edit project' });
    if (await editProject.count()) {
      if (detail.perms.canEditProject) await expect(editProject).toBeEnabled(); else await expect(editProject).toBeDisabled();
    }

    // Activity tabs (first activity)
    const actTabs = page.getByRole('tablist', { name: 'Activities' }).getByRole('tab');
    await expect(actTabs.first()).toBeVisible();
    await actTabs.first().click();
    await expect(page).toHaveURL(/\/activities\/ACT-/);
    const activityId = page.url().match(/activities\/(ACT-\d+)/)![1];
    const act = await apiGet<any>(request, persona, `/activities/${activityId}`);

    // Task table
    const taskRows = page.locator('main table tbody tr, table tbody tr').filter({ has: page.locator('td') });
    await expect(taskRows.first()).toBeVisible();
    const addTask = page.getByRole('button', { name: 'Add task' });
    if (act.perms.canAddTask) await expect(addTask).toBeEnabled(); else await expect(addTask).toBeDisabled();

    // Task side panel
    await taskRows.first().locator('td').first().click();
    await expect(page).toHaveURL(/[?&]task=TSK-/);
    const taskId = new URL(page.url()).searchParams.get('task')!;
    const td = await apiGet<any>(request, persona, `/tasks/${taskId}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: td.task.title })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toHaveCount(td.perms.canEdit ? 1 : 0);
    if (!td.perms.canEdit) await expect(dialog.getByLabel('Title')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Persona-specific must-haves
    if (persona === 'ANALYST' || persona === 'CLIENT' || persona === 'EXEC' || persona === 'KM' || persona === 'RISK' || persona === 'ADMIN') {
      expect(detail.perms.canEditStages).toBe(false);
    }
    if (persona === 'CLIENT') {
      expect(visible).toHaveLength(1);
      expect(visible[0].fee_budget).toBeUndefined();
    }

    // Forbidden pages
    for (const [path, action] of [['/audit', 'audit.view'], ['/admin/data', 'admin.data'], ['/knowledge', 'knowledge.view']] as const) {
      await page.goto(path);
      if (can(persona, action)) await expect(page.getByText('This is outside your access')).toHaveCount(0);
      else await expect(page.getByText('This is outside your access')).toBeVisible();
    }

    // A project outside a member-scope persona's staffing shows 403
    if (PERMISSIONS[persona].scope === 'member') {
      const all = await apiGet<any[]>(request, 'EXEC', '/projects');
      const outside = all.find((p) => !visible.some((v) => v.project_id === p.project_id));
      if (outside) {
        await page.goto(`/projects/${outside.project_id}`);
        await expect(page.getByText('This is outside your access')).toBeVisible();
      }
    }
    expect(errors, 'no client-side crashes').toEqual([]);
  });
}
