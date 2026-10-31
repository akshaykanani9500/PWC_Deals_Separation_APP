/**
 * Quick AI actions for a scope: "Draft email", "Schedule meeting", "Call prep". Agent 3 owns; Agent 2 places it.
 */
export interface AiActionsProps { scope: 'project' | 'stage' | 'activity' | 'task'; id: string }
export default function AiActions(_props: AiActionsProps) {
  return null; // placeholder until Agent 3 lands the real component
}
