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

/**
 * Fictional NON-BANK funding partners for the demo (banks are DEMO_BANKS below: Bank 1-4, used everywhere).
 * Adding one creates an "Identified" funding line; nothing is sent anywhere.
 */
export const DEMO_FUNDERS: { name: string; kind: string; offers: string[]; typical: string }[] = [
  { name: 'Meridian Growth Partners (demo PE)', kind: 'Private equity', offers: ['Private equity equity'], typical: 'Equity for carve-outs above USD 50m' },
  { name: 'Arcadia Credit Fund (demo)', kind: 'Private credit / venture debt', offers: ['Venture / private credit'], typical: '12-36 months at 12-14%' },
  { name: 'Sahyadri Infra Finance (demo NBFC)', kind: 'NBFC / equipment finance', offers: ['Term loan', 'Vendor / deferred payment'], typical: 'IT equipment and data-centre leasing in India' },
  { name: 'Cloudline Managed Services (demo vendor)', kind: 'IT vendor', offers: ['Vendor / deferred payment'], typical: 'Transition cost spread over a 3-year service contract' },
];

/** Secured = money that can be counted on. */
export const SECURED_STATUSES = ['Committed', 'Drawn'];
export const PIPELINE_STATUSES = ['Identified', 'In discussion', 'Term sheet'];

// ---------------------------------------------------------------------------------------------------------------
// v1.4: funding-gap analysis and bank outreach (all institutions and people below are fictional demo data).
// ---------------------------------------------------------------------------------------------------------------

/** Funding that the SELLER provides (everything else is raised or paid by the buyer / new business). */
export const SELLER_FUNDING_TYPES = ['Seller contribution (SPA)', 'Escrow / holdback release'];
export function fundingSide(sourceType?: string | null): 'Seller' | 'Buyer' {
  return SELLER_FUNDING_TYPES.includes(sourceType || '') ? 'Seller' : 'Buyer';
}

/** Rules behind the four cost-sharing scenarios (shown on screen next to the numbers). */
export const GAP_RULES = {
  /** Buyer share of use assumed for a Shared or untagged line when no usage % is recorded. */
  defaultUsagePct: 50,
  /** Avoided-cost credit: separation spend lets the buyer leave the TSA this many months earlier ... */
  avoidedTsaMonths: 3,
  /** ... and this share of the TSA fees the buyer avoids is credited against the seller's share. */
  avoidedCreditShare: 0.5,
  /** Beneficiary pays is recommended when at least this share of cost is tagged Seller or Buyer. */
  taggedForBeneficiary: 0.7,
  /** Usage-based is recommended when at least this share of cost sits on Shared / untagged lines. */
  sharedForUsage: 0.3,
  /** ... and when usage % is recorded on at least this share (by value) of those lines. */
  usageRecordedShare: 0.5,
} as const;

export type GapScenarioKey = 'beneficiary' | 'even' | 'usage' | 'avoided';
export const GAP_SCENARIOS: { key: GapScenarioKey; name: string; basis: string }[] = [
  { key: 'beneficiary', name: 'Beneficiary pays', basis: 'Each line is paid by the side it is tagged to. Shared or untagged lines go wholly to the side that uses them most; at exactly 50% use nobody is the main user, so the line is split 50 / 50.' },
  { key: 'even', name: 'Even split of shared lines', basis: 'Tagged lines stay with their side. Shared and untagged lines are split 50 / 50.' },
  { key: 'usage', name: 'Usage-based', basis: 'Tagged lines stay with their side. Shared and untagged lines are split by the buyer usage % on each line (50% when none is recorded).' },
  { key: 'avoided', name: 'Avoided-cost credit', basis: `Usage-based split, then the seller is credited ${GAP_RULES.avoidedCreditShare * 100}% of the TSA fees the buyer avoids by exiting ${GAP_RULES.avoidedTsaMonths} months earlier (moved from seller to buyer).` },
];

export interface DemoBank {
  code: string; name: string; short: string; kind: string;
  rm: { name: string; title: string; email: string; phone: string };
  products: string[]; terms: string; minTicket: number; maxTicket: number; region: string;
}
/** Fictional banks with fictional relationship managers (emails on .example domains, 555-style phone numbers). */
export const DEMO_BANKS: DemoBank[] = [
  { code: 'BANK1', name: 'Bank 1 (demo) – Northbridge Bank', short: 'Northbridge Bank (demo)', kind: 'Global bank',
    rm: { name: 'Alex Morgan', title: 'Director, Acquisition Finance', email: 'alex.morgan@bank1.example', phone: '+1 212 555 0101' },
    products: ['Bridge loan', 'Term loan', 'Revolving credit facility'], terms: 'Bridge 9-12 months at about 9.5%; term loans 3-5 years with covenants.',
    minTicket: 500000, maxTicket: 25000000, region: 'US and global' },
  { code: 'BANK2', name: 'Bank 2 (demo) – Harbourline Bank', short: 'Harbourline Bank (demo)', kind: 'Corporate bank',
    rm: { name: 'Priyanka Sethi', title: 'Vice President, M&A Financing', email: 'priyanka.sethi@bank2.example', phone: '+91 22 5550 0102' },
    products: ['Bridge loan', 'Revolving credit facility'], terms: 'Bridge up to 18 months in USD or INR at about 10%; RCF with a commitment fee.',
    minTicket: 100000, maxTicket: 10000000, region: 'India and Asia' },
  { code: 'BANK3', name: 'Bank 3 (demo) – Summit Ridge Bank', short: 'Summit Ridge Bank (demo)', kind: 'Lending syndicate lead',
    rm: { name: 'Jordan Ellis', title: 'Managing Director, Corporate Banking', email: 'jordan.ellis@bank3.example', phone: '+1 415 555 0103' },
    products: ['Term loan', 'Escrow / holdback release'], terms: 'Term loans 3-7 years; escrow agent for SPA holdbacks.',
    minTicket: 2000000, maxTicket: 60000000, region: 'US and EU' },
  { code: 'BANK4', name: 'Bank 4 (demo) – Lotus Equipment Finance', short: 'Lotus Equipment Finance (demo)', kind: 'Equipment and technology lender',
    rm: { name: 'Meenal Kapoor', title: 'Head, Technology & Equipment Finance', email: 'meenal.kapoor@bank4.example', phone: '+91 80 5550 0104' },
    products: ['Term loan', 'Vendor / deferred payment'], terms: 'IT equipment and licence finance over 24-48 months.',
    minTicket: 100000, maxTicket: 8000000, region: 'India' },
];
export const bankByCode = (code?: string | null) => DEMO_BANKS.find((b) => b.code === code);
