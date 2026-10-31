/**
 * Functions owned by Agent 3 (AI) that Agent 1's routes call.
 * Each works WITHOUT a Gemini key (deterministic offline fallback) and reports which mode was used.
 */
export { buildCloseoutPreview } from './closeout';
export { redactText } from './redact';
