/**
 * "Get AI suggestion" button used inside edit side panels (Agent 3 owns this folder; Agent 2 uses it).
 * Calls POST /api/ai/suggest with `request`, shows the rationale + sources, and passes the draft to `onApply`.
 * The parent form decides how to merge the draft (user can still edit before saving).
 */
import type { SuggestRequest, SuggestResponse } from '@shared/types';

export interface AiSuggestButtonProps {
  request: SuggestRequest;
  onApply: (draft: SuggestResponse['draft'], response: SuggestResponse) => void;
  label?: string;
  disabled?: boolean;
}

export default function AiSuggestButton(_props: AiSuggestButtonProps) {
  return null; // placeholder until Agent 3 lands the real component
}
