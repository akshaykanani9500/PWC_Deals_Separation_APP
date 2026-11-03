/**
 * Built-in separation playbook (the fallback "AI knowledge" when the hub has no closed deal to learn from).
 * 5 stages x 5 activities x 5 tasks, plus industry overlays. Task tuple: [title, priority, day1_critical, effort_hours].
 */
import { DEFAULT_STAGES } from '../../../shared/defaults';
import type { Priority, YN } from '../../../shared/types';

type T = [string, Priority, YN, number];
export interface PlaybookActivity { name: string; description: string; priority: Priority; tasks: T[] }
export interface PlaybookStage { name: string; description: string; gate_criteria: string; activities: PlaybookActivity[] }

const A = (name: string, description: string, priority: Priority, tasks: T[]): PlaybookActivity => ({ name, description, priority, tasks });

const ACTIVITIES: Record<string, PlaybookActivity[]> = {
  Diligence: [
    A('Data room review & IT information request', 'Read seller IT documents and request missing inventories.', 'High', [
      ['Issue IT information request list to seller', 'High', 'N', 6], ['Review IT org charts and shared-service agreements', 'Medium', 'N', 8],
      ['Log data-room gaps and follow-ups', 'Medium', 'N', 4], ['Confirm clean-team membership for sensitive files', 'High', 'N', 2], ['Summarise key IT findings for partner', 'Medium', 'N', 6]]),
    A('Application & infrastructure inventory baseline', 'Build one clean inventory of applications, servers, network and sites.', 'Critical', [
      ['Load seller application inventory and run quality checks', 'High', 'N', 12], ['De-duplicate applications across CMDB and EA exports', 'High', 'N', 10],
      ['Map applications to sites, servers and owners', 'High', 'N', 14], ['Tag Day-1 critical applications with business owners', 'Critical', 'Y', 8], ['Sign off baseline inventory with seller IT', 'Medium', 'N', 4]]),
    A('IT cost baseline & standalone cost estimate', 'Current IT run cost of the perimeter and the cost to stand alone.', 'High', [
      ['Collect IT cost allocations by service', 'High', 'N', 8], ['Model standalone IT run-rate', 'High', 'N', 12], ['Estimate one-time separation cost range', 'High', 'N', 10],
      ['Identify stranded-cost exposure for seller', 'Medium', 'N', 6], ['Review cost model with deal team', 'Medium', 'N', 3]]),
    A('Entanglement & dependency assessment', 'Find shared systems, interfaces, contracts and people that are hard to split.', 'High', [
      ['Score application entanglement (users, interfaces, hosting)', 'High', 'N', 10], ['Map interfaces between in-scope and retained apps', 'High', 'N', 12],
      ['List shared contracts needing assignment or consent', 'High', 'Y', 6], ['Identify shared network and data-centre assets', 'Medium', 'N', 8], ['Highlight top 10 separation hot-spots', 'High', 'N', 4]]),
    A('Cyber, licence & red-flag review', 'Security gaps and licences that cannot transfer.', 'High', [
      ['Review licence transferability for top vendors', 'High', 'Y', 10], ['Assess cyber posture and open audit findings', 'High', 'N', 8],
      ['Check personal and regulated data in scope (DPDP/GDPR)', 'High', 'N', 6], ['Draft red-flag list with severity', 'High', 'N', 4], ['Partner review of diligence report', 'Critical', 'N', 3]]),
  ],
  Signing: [
    A('Separation blueprint & disposition plan', 'Agree the end state for every in-scope application.', 'Critical', [
      ['Apply disposition criteria to each application', 'High', 'N', 16], ['Workshop dispositions with client CIO', 'High', 'N', 6],
      ['Record approved disposition and rationale per app', 'High', 'N', 8], ['Flag applications needing a TSA bridge', 'High', 'Y', 4], ['Baseline separation blueprint document', 'Medium', 'N', 6]]),
    A('TSA service catalogue & pricing', 'List the services the seller will provide after close, with price and term.', 'Critical', [
      ['Draft TSA service catalogue by tower', 'High', 'N', 12], ['Link each TSA service to applications and assets', 'High', 'N', 8],
      ['Agree pricing and mark-up basis', 'High', 'N', 6], ['Set exit dates and extension terms per service', 'High', 'N', 4], ['Hand catalogue to legal for TSA schedules', 'Medium', 'N', 2]]),
    A('One-time & stranded cost model', 'Who pays for separation and what cost is left behind.', 'High', [
      ['Build one-time cost model by workstream', 'High', 'N', 10], ['Estimate seller stranded IT cost', 'Medium', 'N', 6],
      ['Prepare cost-sharing scenarios (beneficiary pays, even split, usage)', 'High', 'N', 8], ['Agree funding owner per cost item', 'High', 'N', 4], ['Record agreed split and approvers', 'Medium', 'N', 2]]),
    A('Day-1 scope definition', 'Decide what must work on Day-1 and what can follow.', 'Critical', [
      ['Define Day-1 minimum viable operations', 'Critical', 'Y', 6], ['List Day-1 critical systems and owners', 'Critical', 'Y', 6],
      ['Confirm Day-1 access and identity approach', 'High', 'Y', 4], ['Agree Day-1 communication plan', 'Medium', 'N', 3], ['Baseline Day-1 scope with control board', 'High', 'N', 2]]),
    A('Deal document inputs (SPA / TSA schedules)', 'Numbers and service text for the lawyers.', 'Medium', [
      ['Provide IT schedules for the SPA', 'Medium', 'N', 4], ['Review TSA schedules for service gaps', 'High', 'N', 6],
      ['Check data-protection clauses for TSA data flows', 'High', 'N', 3], ['Confirm reverse-TSA needs', 'Medium', 'N', 3], ['Log signing-stage decisions', 'Low', 'N', 2]]),
  ],
  'Day-1 Readiness': [
    A('Day-1 critical systems readiness', 'Every must-work system is ready, tested and owned.', 'Critical', [
      ['Confirm readiness of each Day-1 critical application', 'Critical', 'Y', 10], ['Complete end-to-end business process tests', 'Critical', 'Y', 16],
      ['Close Sev-1 defects from testing', 'Critical', 'Y', 8], ['Prepare rollback plans per system', 'High', 'Y', 6], ['Get business owner sign-off', 'High', 'Y', 4]]),
    A('Identity, access & mailbox cut-over', 'Users can log in, email and collaborate on Day-1.', 'Critical', [
      ['Provision new domain and identities', 'Critical', 'Y', 12], ['Migrate mailboxes in waves', 'High', 'Y', 16],
      ['Set up access controls and privileged accounts', 'Critical', 'Y', 8], ['Validate SSO for critical apps', 'High', 'Y', 6], ['Prepare service-desk scripts for login issues', 'Medium', 'N', 4]]),
    A('Network, sites & end-user devices', 'Circuits, site connectivity and laptops ready in time.', 'High', [
      ['Order long-lead network circuits (90-180 days)', 'Critical', 'Y', 4], ['Plan site cut-over and firewall changes', 'High', 'Y', 8],
      ['Re-image or replace end-user devices', 'High', 'Y', 16], ['Test remote access and VPN', 'High', 'Y', 4], ['Confirm site-by-site readiness', 'High', 'Y', 4]]),
    A('Licence & contract assignments', 'Legal right to use every system on Day-1.', 'Critical', [
      ['Request vendor consents for licence assignment', 'Critical', 'Y', 6], ['Track consent responses and escalations', 'High', 'Y', 4],
      ['Procure new licences where transfer is not allowed', 'High', 'Y', 6], ['Assign third-party contracts', 'Medium', 'N', 4], ['Confirm engineering / specialist tool licences', 'Critical', 'Y', 4]]),
    A('Mock Day-1, go / no-go & hypercare', 'Rehearse the cut-over, decide go, support the first weeks.', 'Critical', [
      ['Run mock Day-1 rehearsal', 'Critical', 'Y', 12], ['Fix issues found in rehearsal', 'High', 'Y', 10],
      ['Prepare go / no-go pack for control board', 'Critical', 'N', 6], ['Staff hypercare command centre', 'High', 'N', 4], ['Open Day-1 issue log', 'Medium', 'N', 2]]),
  ],
  'TSA Exit': [
    A('TSA register & cost tracking', 'Every TSA service, its monthly cost and exit status in one place.', 'High', [
      ['Reconcile TSA invoices to the service register', 'Medium', 'N', 6], ['Track monthly TSA run-rate', 'Medium', 'N', 3],
      ['Flag services within 60 days of exit date', 'High', 'N', 2], ['Report TSA cost to control board', 'Medium', 'N', 3], ['Agree service-level issues with seller', 'Medium', 'N', 3]]),
    A('Exit sequence planning', 'Choose the cheapest safe order to exit services.', 'Critical', [
      ['Compare at least three exit sequences', 'High', 'N', 8], ['Check dependencies for each sequence', 'High', 'N', 6],
      ['Estimate fees saved per sequence', 'High', 'N', 4], ['Get control-board decision on sequence', 'Critical', 'N', 2], ['Publish exit roadmap', 'Medium', 'N', 3]]),
    A('Application migration waves', 'Move systems off the seller in planned waves.', 'Critical', [
      ['Group applications into migration waves', 'High', 'N', 8], ['Run wave dress rehearsals', 'High', 'N', 10],
      ['Execute migration wave and validate data', 'Critical', 'N', 16], ['Decommission seller access after each wave', 'High', 'N', 4], ['Capture lessons after each wave', 'Low', 'N', 2]]),
    A('Extension risk management', 'Avoid costly TSA extensions (~20% uplift).', 'High', [
      ['Identify services at risk of missing exit', 'High', 'N', 4], ['Cost a 3-month extension per at-risk service', 'High', 'N', 4],
      ['Agree mitigation or extension request', 'High', 'N', 3], ['Notify seller within contractual notice period', 'Critical', 'N', 2], ['Track extension decisions', 'Medium', 'N', 2]]),
    A('Service exit sign-off & stranded cost', 'Formally exit each service and act on seller stranded cost.', 'High', [
      ['Obtain exit sign-off per service', 'High', 'N', 3], ['Confirm data return and deletion by seller', 'High', 'N', 4],
      ['Stop TSA billing for exited services', 'High', 'N', 2], ['Plan seller stranded-cost reduction', 'Medium', 'N', 6], ['Close TSA governance forum', 'Low', 'N', 2]]),
  ],
  'Close-out': [
    A('Final status & benefits report', 'Outcome versus plan for the client.', 'Medium', [
      ['Compile final status against baseline', 'Medium', 'N', 6], ['Quantify TSA savings and cost outcome', 'Medium', 'N', 4],
      ['Present close-out to control board', 'Medium', 'N', 3], ['Hand over open items to client', 'Medium', 'N', 3], ['Partner sign-off on close-out', 'High', 'N', 1]]),
    A('Close-out metrics capture', 'Standard metrics for benchmarks.', 'Medium', [
      ['Record TSA term and extensions', 'Medium', 'N', 2], ['Record disposition mix', 'Low', 'N', 2], ['Record one-time and stranded cost', 'Medium', 'N', 2],
      ['Record Day-1 incidents', 'Low', 'N', 1], ['Record effort per 100 applications', 'Low', 'N', 1]]),
    A('Lessons learned', 'What worked and what did not.', 'Medium', [
      ['Run lessons-learned workshop', 'Medium', 'N', 3], ['Draft lessons with AI from project history', 'Low', 'N', 2], ['Review lessons with partner', 'Medium', 'N', 1],
      ['Propose playbook updates', 'Low', 'N', 2], ['Share lessons with practice', 'Low', 'N', 1]]),
    A('Consent, redaction & knowledge hub contribution', 'Safely reuse what we learned.', 'High', [
      ['Confirm client consent for reuse', 'High', 'N', 1], ['Redact client names, people data and fees', 'High', 'N', 3], ['Knowledge manager review', 'High', 'N', 2],
      ['Tag items by stage, sector and deal type', 'Medium', 'N', 1], ['Publish approved items to the hub', 'Medium', 'N', 1]]),
    A('Archive, retention & access removal', 'Close the record in line with contract and law.', 'Medium', [
      ['Archive project records', 'Medium', 'N', 2], ['Apply retention schedule', 'Medium', 'N', 1], ['Remove team access', 'High', 'N', 1],
      ['Delete data past retention with evidence', 'Medium', 'N', 2], ['DPO confirmation', 'Medium', 'N', 1]]),
  ],
};

/** Industry overlays add activities to a stage. */
export const OVERLAYS: Record<string, Record<string, PlaybookActivity[]>> = {
  'Financial Services & Payments': {
    Signing: [A('Payments regulatory & data localisation review', 'RBI outsourcing rules, payment-data storage in India and PCI DSS scope.', 'High', [
      ['Map payment-system data flows and storage locations', 'High', 'N', 8], ['Check RBI outsourcing obligations for TSA services', 'High', 'N', 6],
      ['Confirm PCI DSS scope for cardholder data', 'High', 'Y', 6], ['Agree data-localisation approach with client compliance', 'High', 'N', 3], ['Record regulatory flags on affected records', 'Medium', 'N', 2]])],
    'Day-1 Readiness': [A('Card & payments continuity', 'Card issuing, processing and settlement work on Day-1.', 'Critical', [
      ['Test card authorisation and settlement end to end', 'Critical', 'Y', 12], ['Confirm scheme and processor notifications', 'High', 'Y', 4],
      ['Validate fraud and AML monitoring feeds', 'Critical', 'Y', 6], ['Confirm PCI controls on new environment', 'High', 'Y', 6], ['Prepare regulator Day-1 notification', 'High', 'N', 3]])],
  },
  'Semiconductors & High-Tech': {
    Signing: [A('Export-controlled design data review', 'Flag US EAR-controlled technical data and deemed-export risk.', 'High', [
      ['Classify design data by export-control category', 'High', 'N', 8], ['Identify foreign-national access to controlled data', 'High', 'N', 4],
      ['Agree segregation for controlled repositories', 'High', 'Y', 6], ['Check licences needed for data transfer', 'High', 'N', 4], ['Record export-control flags on records', 'Medium', 'N', 2]])],
    'Day-1 Readiness': [A('Engineering tools & equipment readiness', 'EDA tools, lab equipment and licence servers ready on Day-1.', 'Critical', [
      ['Inventory engineering tool profiles and licence servers', 'Critical', 'Y', 8], ['Secure EDA licence transfers or new licences', 'Critical', 'Y', 6],
      ['Agree funding split for engineering equipment gap', 'High', 'Y', 4], ['Test design flows on the new environment', 'Critical', 'Y', 10], ['Confirm order-processing and financial reporting systems', 'Critical', 'Y', 6]])],
  },
  // v1.4 (C): overlays for every industry in the picker (Healthcare was promised in rationales but missing).
  'Healthcare & Life Sciences': {
    Signing: [A('GxP validated systems & CSV plan', 'Identify validated systems and plan computer system validation for the separated estate.', 'Critical', [
      ['Inventory GxP-validated systems and their validation state', 'Critical', 'N', 10], ['Agree CSV approach (re-validate vs. leverage)', 'High', 'N', 6],
      ['Confirm regulatory notifications (FDA / EMA / CDSCO)', 'High', 'Y', 4], ['Plan quality-system (QMS) separation', 'High', 'N', 6]])],
    'Day-1 Readiness': [A('Validated systems re-qualification', 'Re-qualify validated systems on the new infrastructure before release decisions.', 'Critical', [
      ['Execute IQ/OQ on new infrastructure for validated systems', 'Critical', 'Y', 16], ['Update validation documents and change controls', 'High', 'Y', 10],
      ['QA sign-off for batch release systems', 'Critical', 'Y', 4], ['Confirm patient / health data protection controls', 'High', 'Y', 6]])],
  },
  'Consumer & Retail': {
    'Day-1 Readiness': [A('Stores, POS & e-commerce continuity', 'Tills, loyalty, e-commerce and supply-chain feeds keep trading on Day-1.', 'Critical', [
      ['Test POS and payment terminals on the new network', 'Critical', 'Y', 10], ['Confirm e-commerce platform, domains and payment gateway', 'Critical', 'Y', 8],
      ['Split loyalty and customer data (consent checked)', 'High', 'Y', 8], ['Validate supplier EDI and replenishment feeds', 'High', 'Y', 6], ['Avoid peak trading weeks for cut-over', 'High', 'N', 2]])],
  },
  'Industrial Manufacturing': {
    Diligence: [A('OT & plant systems inventory', 'List MES, SCADA, historians and plant networks per site and how they depend on the seller.', 'High', [
      ['Inventory OT systems per plant (MES, SCADA, historians)', 'High', 'N', 12], ['Map plant network and OT/IT boundary', 'High', 'N', 8],
      ['Identify shared OT licences and support contracts', 'Medium', 'N', 4], ['Assess OT cyber posture per site', 'High', 'N', 6]])],
    'Day-1 Readiness': [A('Plant / OT cut-over & MES continuity', 'Plants keep producing on Day-1: OT network split, MES and quality systems work.', 'Critical', [
      ['Agree production downtime windows with each plant', 'Critical', 'Y', 4], ['Split plant networks and OT firewalls', 'Critical', 'Y', 14],
      ['Test MES and quality systems on the new network', 'Critical', 'Y', 12], ['Prepare plant-floor support and escalation', 'High', 'Y', 4], ['Confirm OT vendor support contracts transfer', 'High', 'Y', 4]])],
  },
  'Energy & Utilities': {
    Signing: [A('Critical infrastructure & regulator obligations', 'Grid / plant control systems, NERC-CIP or CEA cyber rules and regulator approvals.', 'High', [
      ['Identify critical-infrastructure systems in scope', 'High', 'N', 6], ['Check regulator approval and licence transfer needs', 'High', 'Y', 4],
      ['Plan control-room (SCADA / EMS) separation', 'Critical', 'N', 8], ['Agree cyber-security obligations for the new operator', 'High', 'N', 4]])],
  },
  'Telecom & Media': {
    'Day-1 Readiness': [A('Network, OSS/BSS & subscriber continuity', 'Billing, provisioning and subscriber data work on Day-1.', 'Critical', [
      ['Separate OSS/BSS instances or agree TSA', 'Critical', 'Y', 12], ['Test billing and provisioning end to end', 'Critical', 'Y', 10],
      ['Split subscriber data (consent checked)', 'High', 'Y', 8], ['Confirm spectrum / licence and interconnect agreements', 'High', 'Y', 4]])],
  },
};

export const PLAYBOOK: PlaybookStage[] = DEFAULT_STAGES.map((s) => ({
  name: s.name, description: s.description, gate_criteria: s.gate_criteria, activities: ACTIVITIES[s.name] ?? [],
}));

/** Stage from the playbook by (fuzzy) name, plus overlay activities for the industry. */
export function playbookStage(name: string, industry?: string): PlaybookStage | undefined {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = PLAYBOOK.find((s) => {
    const k = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return k === n || n.includes(k) || k.includes(n) || (n.includes('day1') && k.includes('day1')) || (n.includes('tsa') && k.includes('tsa')) || (n.includes('close') && k.includes('close'));
  });
  if (!base) return undefined;
  const extra = industry ? OVERLAYS[industry]?.[base.name] ?? [] : [];
  return { ...base, activities: [...base.activities, ...extra] };
}

export function allPlaybookActivities(industry?: string): (PlaybookActivity & { stage: string })[] {
  return PLAYBOOK.flatMap((s) => (playbookStage(s.name, industry)?.activities ?? []).map((a) => ({ ...a, stage: s.name })));
}
