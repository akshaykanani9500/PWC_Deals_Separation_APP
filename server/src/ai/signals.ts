/**
 * v1.4 (C): keyword / context engine for the offline suggestion path. Reads what the user TYPED (name, client
 * description, description, residency, tags, stage/activity names) and maps it to specialist separation work.
 * Each signal adds activities to the right playbook stage, plus tags, risks and field hints for "Improve with AI".
 */
import type { Priority, YN } from '../../../shared/types';
import type { PlaybookActivity } from './playbook';

type T = [string, Priority, YN, number];
const A = (name: string, description: string, priority: Priority, tasks: T[]): PlaybookActivity => ({ name, description, priority, tasks });

export interface Signal {
  id: string;
  label: string;
  /** what the signal adds, for the "from your inputs" highlight */
  adds: string;
  re: RegExp;
  /** stage name (playbook) -> activities */
  acts: Record<string, PlaybookActivity[]>;
  tags: string[];
  risk: string;
  residency?: string;
  restricted?: boolean;
  cleanTeam?: boolean;
  regulated?: boolean;
}

export const SIGNALS: Signal[] = [
  {
    id: 'erp', label: 'ERP (SAP / S/4HANA)', adds: 'ERP clone / carve-out activities',
    re: /\b(sap|s\/?4\s?(hana)?|s4hana|s4|hana|erp|ecc|oracle (ebs|e-business|fusion)|jd ?edwards|dynamics 365|netsuite)\b/i,
    tags: ['ERP', 'SAP'], risk: 'ERP carve-out: company-code split and data selective deletion are on the critical path; book a clone window early.',
    acts: {
      Signing: [A('ERP separation approach (clone / carve-out / TSA)', 'Choose how the ERP (e.g. SAP S/4) is separated and what the seller runs under TSA.', 'Critical', [
        ['Assess ERP landscape: clients, company codes, custom code', 'High', 'N', 12], ['Compare clone-and-strip, greenfield and TSA options', 'Critical', 'N', 10],
        ['Agree ERP approach with client CIO and seller', 'Critical', 'Y', 4], ['Define ERP TSA services and exit date', 'High', 'N', 6], ['Estimate ERP one-time cost and timeline', 'High', 'N', 6]])],
      'Day-1 Readiness': [A('ERP clone & data carve-out', 'Build the separated ERP instance with only the carved-out entity data.', 'Critical', [
        ['Build ERP clone (system copy) for the carved-out entity', 'Critical', 'Y', 24], ['Run selective data deletion for retained company codes', 'Critical', 'Y', 20],
        ['Re-point ERP interfaces (banks, EDI, payroll)', 'High', 'Y', 16], ['Test order-to-cash and procure-to-pay end to end', 'Critical', 'Y', 18], ['Rehearse ERP cut-over and reconcile balances', 'Critical', 'Y', 12]])],
      'TSA Exit': [A('ERP standalone migration & TSA exit', 'Move from the seller-run ERP to the standalone instance and stop the ERP TSA.', 'High', [
        ['Plan ERP migration waves and freeze periods', 'High', 'N', 8], ['Migrate open items and master data', 'High', 'N', 16],
        ['Decommission seller ERP access', 'High', 'N', 4], ['Confirm ERP TSA exit sign-off', 'High', 'N', 2]])],
    },
  },
  {
    id: 'ot', label: 'Plants & OT systems', adds: 'OT / plant systems (MES, SCADA) activities',
    re: /\b(plants?|factor(y|ies)|manufacturing sites?|mills?|ot|mes|scada|plc|shop[- ]?floor|warehouses?|distribution cent(re|er)s?|industrial control)\b/i,
    tags: ['OT', 'Plants'], risk: 'Plant / OT cut-over: MES and SCADA changes need production downtime windows agreed with each plant.',
    acts: {
      Diligence: [A('OT & plant systems inventory', 'List MES, SCADA, historians and plant networks per site and how they depend on the seller.', 'High', [
        ['Inventory OT systems per plant (MES, SCADA, historians)', 'High', 'N', 12], ['Map plant network and OT/IT boundary', 'High', 'N', 8],
        ['Identify shared OT licences and support contracts', 'Medium', 'N', 4], ['Assess OT cyber posture per site', 'High', 'N', 6]])],
      'Day-1 Readiness': [A('Plant / OT cut-over & MES continuity', 'Plants keep producing on Day-1: OT network split, MES and quality systems work.', 'Critical', [
        ['Agree production downtime windows with each plant', 'Critical', 'Y', 4], ['Split plant networks and OT firewalls', 'Critical', 'Y', 14],
        ['Test MES and quality systems on the new network', 'Critical', 'Y', 12], ['Prepare plant-floor support and escalation', 'High', 'Y', 4], ['Confirm OT vendor support contracts transfer', 'High', 'Y', 4]])],
    },
  },
  {
    id: 'eu_privacy', label: 'EU data privacy (GDPR) & works council', adds: 'GDPR data transfer and works council consultation',
    re: /\b(germany|german|gmbh|eu|europe|european|gdpr|dsgvo|works councils?|betriebsrat|france|french|netherlands|dutch|italy|spain|poland|austria|belgium|ireland)\b/i,
    tags: ['GDPR', 'EU'], residency: 'EU', regulated: true,
    risk: 'EU employees and data: works council consultation must finish before Day-1 changes to employee systems; GDPR transfer basis needed for TSA data flows.',
    acts: {
      Signing: [A('GDPR data transfer & works council consultation', 'Lawful basis for moving personal data and consulting employee representatives before IT changes.', 'High', [
        ['Map personal data flows in TSA services (GDPR)', 'High', 'N', 8], ['Agree transfer mechanism (SCCs / DPA) for TSA data', 'High', 'Y', 6],
        ['Prepare works council consultation pack for IT changes', 'High', 'Y', 6], ['Run works council consultation and record outcome', 'Critical', 'Y', 4], ['Update records of processing for the new entity', 'Medium', 'N', 4]])],
    },
  },
  {
    id: 'healthcare', label: 'Healthcare / GxP validated systems', adds: 'validated systems (GxP / CSV) activities',
    re: /\b(healthcare|health ?care|hospitals?|pharma(ceutical)?s?|gxp|gmp|fda|csv|computer system validation|medical devices?|medtech|clinical|life sciences|hipaa|patients?)\b/i,
    tags: ['GxP', 'Healthcare'], restricted: true, regulated: true,
    risk: 'Validated (GxP) systems must be re-qualified after separation; an unvalidated change can stop product release.',
    acts: {
      Signing: [A('GxP validated systems & CSV plan', 'Identify validated systems and plan computer system validation for the separated estate.', 'Critical', [
        ['Inventory GxP-validated systems and their validation state', 'Critical', 'N', 10], ['Agree CSV approach (re-validate vs. leverage)', 'High', 'N', 6],
        ['Confirm regulatory notifications (FDA / EMA / CDSCO)', 'High', 'Y', 4], ['Plan quality-system (QMS) separation', 'High', 'N', 6]])],
      'Day-1 Readiness': [A('Validated systems re-qualification', 'Re-qualify validated systems on the new infrastructure before release decisions.', 'Critical', [
        ['Execute IQ/OQ on new infrastructure for validated systems', 'Critical', 'Y', 16], ['Update validation documents and change controls', 'High', 'Y', 10],
        ['QA sign-off for batch release systems', 'Critical', 'Y', 4], ['Confirm patient / health data protection controls', 'High', 'Y', 6]])],
    },
  },
  {
    id: 'pci', label: 'Payments / card data (PCI DSS)', adds: 'PCI DSS scope and cardholder data split',
    re: /\b(payments?|cards?|pci( dss)?|acquir(ing|er)|issuing|cardholder|wallets?|upi|merchant)\b/i,
    tags: ['PCI', 'Payments'], restricted: true, regulated: true,
    risk: 'Cardholder data: the separated environment must be PCI DSS compliant on Day-1; scope creep delays certification.',
    acts: {
      Signing: [A('PCI DSS scope & cardholder data split', 'Define the PCI scope of the separated business and how cardholder data is split.', 'High', [
        ['Map cardholder data environment (CDE) for the perimeter', 'High', 'N', 8], ['Agree PCI scope reduction approach (tokenisation)', 'High', 'N', 6],
        ['Plan QSA assessment for the new environment', 'High', 'Y', 4], ['Confirm scheme and acquirer notifications', 'Medium', 'N', 3]])],
    },
  },
  {
    id: 'cloud', label: 'Cloud (AWS / Azure / GCP)', adds: 'cloud landing zone and account split',
    re: /\b(cloud|aws|amazon web services|azure|gcp|google cloud|landing zone|kubernetes|saas)\b/i,
    tags: ['Cloud'], risk: 'Cloud estate: shared accounts, subscriptions and enterprise agreements must be split or re-papered before Day-1.',
    acts: {
      'Day-1 Readiness': [A('Cloud landing zone & account split', 'Stand up the buyer/standalone cloud landing zone and move or split shared accounts.', 'High', [
        ['Design cloud landing zone for the new entity', 'High', 'N', 10], ['Inventory shared cloud accounts / subscriptions', 'High', 'N', 6],
        ['Split or migrate workloads to new accounts', 'Critical', 'Y', 16], ['Re-paper cloud enterprise agreements and marketplace contracts', 'High', 'Y', 4], ['Set up cloud security baseline and logging', 'High', 'Y', 8]])],
    },
  },
  {
    id: 'm365', label: 'Microsoft 365 / mailboxes', adds: 'M365 tenant split and mailbox migration',
    re: /\b(mailbox(es)?|m365|office ?365|o365|microsoft 365|exchange|teams|tenant|email domains?|onedrive|sharepoint|intune)\b/i,
    tags: ['M365'], risk: 'Tenant split: mailbox and OneDrive migration waves plus domain cut-over need a tested rollback.',
    acts: {
      'Day-1 Readiness': [A('Microsoft 365 tenant split & mailbox migration', 'Separate the M365 tenant: identities, mailboxes, Teams and SharePoint data.', 'Critical', [
        ['Stand up target M365 tenant and domains', 'Critical', 'Y', 8], ['Plan mailbox / OneDrive migration waves', 'High', 'Y', 6],
        ['Migrate Teams and SharePoint sites in scope', 'High', 'Y', 14], ['Set up cross-tenant calendar sharing for TSA period', 'Medium', 'N', 4], ['Cut over MX records and test mail flow', 'Critical', 'Y', 4]])],
    },
  },
  {
    id: 'india_dpdp', label: 'India data protection (DPDP Act)', adds: 'DPDP Act data transfer review',
    re: /\b(india|indian|dpdp|rbi|sebi|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|delhi|gurugram|noida)\b/i,
    tags: ['DPDP', 'India'], residency: 'India', regulated: true,
    risk: 'DPDP Act 2023: personal data moved to the new entity needs a notice / consent check and a named data fiduciary.',
    acts: {
      Signing: [A('DPDP Act data transfer & consent review', 'Check notice, consent and data-fiduciary duties for personal data moving to the new entity (India).', 'High', [
        ['Identify personal data of Indian data principals in scope', 'High', 'N', 6], ['Check notice / consent basis for the transfer (DPDP Act 2023)', 'High', 'Y', 4],
        ['Name the data fiduciary and grievance officer for the new entity', 'Medium', 'N', 2], ['Review cross-border transfer restrictions', 'High', 'N', 3]])],
    },
  },
  {
    id: 'export', label: 'Export-controlled technology', adds: 'export-control data segregation',
    re: /\b(export[- ]control(led)?|ear|itar|semiconductors?|chip design|eda|defen[cs]e)\b/i,
    tags: ['Export control'], restricted: true,
    risk: 'Export-controlled data must be segregated before any foreign-national access in the new entity.',
    acts: {},
  },
  {
    id: 'clean_team', label: 'Competitively sensitive data', adds: 'clean-team rules',
    re: /\b(competitors?|clean[- ]?(team|room)|antitrust|competition law|competitively sensitive|gun[- ]jumping)\b/i,
    tags: ['Clean team'], cleanTeam: true, restricted: true,
    risk: 'Buyer and seller compete: only clean-team members may see pricing, customer and pipeline data before close.',
    acts: {},
  },
];

export interface SignalHit { signal: Signal; matched: string[] }

/** Find signals in free text. Returns each signal once, with the words that triggered it. */
export function detectSignals(text: string): SignalHit[] {
  if (!text.trim()) return [];
  const out: SignalHit[] = [];
  for (const s of SIGNALS) {
    const g = new RegExp(s.re.source, 'gi');
    const matched = Array.from(new Set((text.match(g) ?? []).map((m) => m.trim()))).slice(0, 4);
    if (matched.length) out.push({ signal: s, matched });
  }
  return out;
}

/** Signal activities that belong to one playbook stage. */
export function signalActivities(hits: SignalHit[], stageName: string): (PlaybookActivity & { signal: string })[] {
  return hits.flatMap((h) => (h.signal.acts[stageName] ?? []).map((a) => ({ ...a, signal: h.signal.label })));
}

/** Numbers typed in the description, e.g. "3 plants", "120 applications", "1,500 employees". */
export function scaleFromText(text: string): { apps?: number; sites?: number; employees?: number } {
  const n = (re: RegExp) => { const m = text.match(re); return m ? Number(m[1].replace(/,/g, '')) : undefined; };
  return {
    apps: n(/(\d[\d,]*)\s*\+?\s*(?:applications|apps|systems)\b/i),
    sites: n(/(\d[\d,]*)\s*\+?\s*(?:plants|sites|factories|locations|offices|warehouses)\b/i),
    employees: n(/(\d[\d,]*)\s*\+?\s*(?:employees|people|staff|fte|ftes|users)\b/i),
  };
}
