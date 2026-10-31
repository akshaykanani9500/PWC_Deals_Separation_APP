/**
 * Data-access rules shared by REST routes (Agent 1) and AI features (Agent 3).
 * SIGNATURES ARE A CONTRACT - Agent 1 implements the bodies; do not change parameters or return types.
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { Project, Contact, Communication, Task, Activity, Stage } from '../../../shared/types';

/** Project ids this user may see (scope 'all' => every non-deleted project; 'member' => project_members rows). */
export async function visibleProjectIds(db: Db, auth: AuthContext): Promise<Set<string>> {
  throw new Error('not implemented yet (Agent 1)');
}

/** Throws an HttpError(403) when the project is not visible. Returns the project when it is. */
export async function assertProjectAccess(db: Db, auth: AuthContext, projectId: string): Promise<Project> {
  throw new Error('not implemented yet (Agent 1)');
}

/** Remove fields this persona may not receive (finance without finance.view; CLIENT hidden fields). */
export function sanitizeProject<T extends Partial<Project>>(project: T, auth: AuthContext): T {
  throw new Error('not implemented yet (Agent 1)');
}

/** Mask phone/email unless contacts.view.full. */
export function sanitizeContact(contact: Contact, auth: AuthContext): Contact {
  throw new Error('not implemented yet (Agent 1)');
}

/** CLIENT persona never sees internal communications (only channel 'Meeting' with to/from including Client side); others need comms.view. */
export function filterCommunications(comms: Communication[], auth: AuthContext): Communication[] {
  throw new Error('not implemented yet (Agent 1)');
}

/** Row-level edit rights. LEAD: activities/tasks in stages they own or are workstream lead for; ANALYST: own tasks only. */
export async function canEditStage(db: Db, auth: AuthContext, stage: Stage): Promise<boolean> { throw new Error('nyi'); }
export async function canEditActivity(db: Db, auth: AuthContext, activity: Activity): Promise<boolean> { throw new Error('nyi'); }
export async function canEditTask(db: Db, auth: AuthContext, task: Task): Promise<{ canEdit: boolean; canDelete: boolean; editableFields: (keyof Task)[] }> { throw new Error('nyi'); }
