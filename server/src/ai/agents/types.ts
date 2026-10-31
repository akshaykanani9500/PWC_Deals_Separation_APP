import type { Db } from '../../db/Db';
import type { AuthContext } from '../../auth-types';
import type { Lang } from '../../../../shared/types';
import type { ScopedData } from '../data';
import type { Intent, Domain } from '../router';

export interface PikuSource { type: string; id: string; label: string; href?: string }

/** What every domain agent returns: lines in the user's language, English facts for Gemini, and sources. */
export interface AgentOutput {
  agent: Domain;
  lines: string[];
  facts: string[];
  sources: PikuSource[];
}

export interface AgentInput {
  db: Db;
  auth: AuthContext;
  data: ScopedData;
  intents: Intent[];
  lang: Lang;
  message: string;
}

export function emptyOutput(agent: Domain): AgentOutput {
  return { agent, lines: [], facts: [], sources: [] };
}
