/**
 * Functions owned by Agent 3 (AI) that Agent 1's routes call.
 * Agent 3 implements them in server/src/ai/*.ts and re-exports here. Each works WITHOUT a Gemini key
 * (deterministic offline fallback) and reports which mode was used.
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { CloseoutPreview, Project } from '../../../shared/types';

/** Build the close-out preview: metrics, redacted knowledge items, lessons-learned draft. */
export async function buildCloseoutPreview(db: Db, auth: AuthContext, project: Project): Promise<CloseoutPreview> {
  throw new Error('not implemented yet (Agent 3)');
}

/** Redact client names, people, emails, phones and money amounts tied to the client from free text. */
export function redactText(text: string, knownEntities: string[]): { text: string; redactions: { original: string; redacted: string }[] } {
  throw new Error('not implemented yet (Agent 3)');
}
