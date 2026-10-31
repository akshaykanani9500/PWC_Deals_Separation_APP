/** Default stage set for a new separation project (used when no template/AI suggestion is applied). */
export const DEFAULT_STAGES = [
  { name: 'Diligence', description: 'Find IT risks, costs and entanglement before the price is fixed.', gate_criteria: 'Diligence report signed by the partner; red flags closed or accepted.' },
  { name: 'Signing', description: 'Turn diligence into separation terms: blueprint, TSA catalogue, cost sharing, Day-1 scope.', gate_criteria: 'Deal signed; Day-1 scope and TSA catalogue baselined.' },
  { name: 'Day-1 Readiness', description: 'The business runs the morning after close: systems, access, network, licences, rehearsal.', gate_criteria: 'Go decision signed by partner and client; Day-1 issue log opened.' },
  { name: 'TSA Exit', description: 'Exit every TSA service on time and at least cost.', gate_criteria: 'All services exited or formally extended; stranded-cost plan approved.' },
  { name: 'Close-out', description: 'Close cleanly and turn the deal into reusable knowledge.', gate_criteria: 'Knowledge manager approval; DPO confirms consent and retention.' },
] as const;

/** Fixed "today" is NOT used: seed data is generated relative to the real date so overdue items stay meaningful. */
export const APP_NAME = 'Deals Separation Hub';
export const APP_TAGLINE = 'An app on the PwC Deals Stack';
