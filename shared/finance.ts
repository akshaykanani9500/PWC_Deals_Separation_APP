/**
 * Finance workspace reference data (v1.3), shared by server and client.
 * Everything here is illustrative demo data: rates are not PwC rates and every institution is fictional.
 */
import type { PersonaCode } from './types';

/** Standard hourly rate (USD) used to value effort. Demo numbers, not real PwC rates. */
export const RATE_CARD: { persona: PersonaCode; label: string; rate: number }[] = [
  { persona: 'PARTNER', label: 'Engagement Partner', rate: 520 },
  { persona: 'MANAGER', label: 'Engagement Manager', rate: 310 },
  { persona: 'LEAD', label: 'Workstream Lead (Senior Associate)', rate: 210 },
  { persona: 'ANALYST', label: 'Associate / Analyst', rate: 120 },
];
export const DEFAULT_RATE = 150;

export function rateFor(persona?: string | null): number {
  return RATE_CARD.find((r) => r.persona === persona)?.rate ?? DEFAULT_RATE;
}

/** How deal teams usually fund one-time separation cost. Shown in the "Funding options" tab. */
export const FUNDING_PLAYBOOK: { type: string; who: string; when: string; terms: string; watch: string }[] = [
  { type: 'Seller contribution (SPA)', who: 'Seller, under the sale and purchase agreement', when: 'Seller agreed to pay part of the separation cost (often IT stand-up) as part of the price.', terms: 'Fixed amount or cap; paid at or after close.', watch: 'Check the SPA clause and cap; costs above the cap fall to the buyer.' },
  { type: 'Buyer balance-sheet cash', who: 'Buyer treasury', when: 'Buyer is large enough to fund one-time cost from cash.', terms: 'Internal budget approval.', watch: 'Needs the buyer CFO sign-off before spend is committed.' },
  { type: 'Bridge loan', who: 'Bank (short term)', when: 'Money is needed before long-term financing is in place, e.g. Day-1 spend.', terms: '6-18 months, higher rate, refinanced later.', watch: 'Refinancing risk if the deal slips.' },
  { type: 'Term loan', who: 'Bank or lending syndicate', when: 'Large, planned spend such as a data-centre build or ERP stand-up.', terms: '3-7 years, covenants, scheduled repayment.', watch: 'Covenants can limit the new business in its first years.' },
  { type: 'Revolving credit facility', who: 'Bank', when: 'Working capital and uneven monthly separation spend.', terms: 'Draw and repay as needed; commitment fee.', watch: 'Usually sized for operations, not one-time projects.' },
  { type: 'Vendor / deferred payment', who: 'IT vendors and managed-service providers', when: 'New vendor contracts for the stand-alone business (hosting, service desk).', terms: 'Transition cost spread over the contract term.', watch: 'Longer lock-in; compare total cost, not just the first year.' },
  { type: 'Private equity equity', who: 'PE sponsor (for PE-backed buyers)', when: 'Carve-outs bought by a fund; sponsor injects equity for separation.', terms: 'Equity; return expected through the investment.', watch: 'Sponsor approval cycles; tight value-creation targets.' },
  { type: 'Venture / private credit', who: 'Credit funds, venture-debt lenders', when: 'Smaller or fast-growing spin-offs that banks will not lend to.', terms: 'Higher rate, sometimes warrants.', watch: 'Expensive; use for short gaps only.' },
  { type: 'Escrow / holdback release', who: 'Escrow agent per the SPA', when: 'Part of the price is held back and released when milestones (e.g. TSA exit) are met.', terms: 'Released on agreed milestones.', watch: 'Timing depends on hitting the milestones.' },
  { type: 'Government incentive', who: 'State / central schemes (e.g. for new facilities in India)', when: 'New sites, data centres or hiring in incentive zones.', terms: 'Grants, tax relief or subsidised land/power.', watch: 'Paperwork and claw-back conditions.' },
];

/** Fictional funding partners for the demo. Adding one creates an "Identified" funding line; nothing is sent anywhere. */
export const DEMO_FUNDERS: { name: string; kind: string; offers: string[]; typical: string }[] = [
  { name: 'Northbridge Bank (demo)', kind: 'Bank', offers: ['Bridge loan', 'Term loan', 'Revolving credit facility'], typical: 'Bridge 9-12 months at ~9.5%; term loans 3-5 years' },
  { name: 'Meridian Growth Partners (demo PE)', kind: 'Private equity', offers: ['Private equity equity'], typical: 'Equity for carve-outs above USD 50m' },
  { name: 'Arcadia Credit Fund (demo)', kind: 'Private credit / venture debt', offers: ['Venture / private credit'], typical: '12-36 months at 12-14%' },
  { name: 'Sahyadri Infra Finance (demo NBFC)', kind: 'NBFC / equipment finance', offers: ['Term loan', 'Vendor / deferred payment'], typical: 'IT equipment and data-centre leasing in India' },
  { name: 'Cloudline Managed Services (demo vendor)', kind: 'IT vendor', offers: ['Vendor / deferred payment'], typical: 'Transition cost spread over a 3-year service contract' },
];

/** Secured = money that can be counted on. */
export const SECURED_STATUSES = ['Committed', 'Drawn'];
export const PIPELINE_STATUSES = ['Identified', 'In discussion', 'Term sheet'];
