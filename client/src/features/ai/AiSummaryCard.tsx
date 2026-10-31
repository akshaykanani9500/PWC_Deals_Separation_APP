/**
 * AI summary card for the right-hand panel (summary of chat/email/call history for a scope).
 * Agent 3 owns; Agent 2 places it: <AiSummaryCard scope="activity" id={activityId} />
 */
export interface AiSummaryCardProps { scope: 'project' | 'stage' | 'activity' | 'task'; id: string; compact?: boolean }
export default function AiSummaryCard(_props: AiSummaryCardProps) {
  return null; // placeholder until Agent 3 lands the real component
}
