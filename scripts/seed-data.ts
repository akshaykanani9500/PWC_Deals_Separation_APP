/**
 * Deterministic demo data for the Deals Separation Hub.
 * All names are fictional; deals are modelled on Case 18 (Projects Phoenix and Rioja) and the BRD.
 * Dates are generated relative to the day the seed runs, so "overdue" and "upcoming" always make sense.
 */
import type { TableName } from '../shared/schema';
import { DEFAULT_STAGES } from '../shared/defaults';

type Row = Record<string, any>;
export type SeedData = Record<TableName, Row[]>;

// ---------- deterministic random ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(4, '0');
const DAY = 86400000;

export function generateSeed(now: Date = new Date()): SeedData {
  const rnd = mulberry32(20261031);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const iso = (ms: number) => new Date(ms).toISOString();
  const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const nowIso = iso(todayMs - 3600000);

  const counters: Record<string, number> = {};
  const id = (prefix: string) => `${prefix}-${pad((counters[prefix] = (counters[prefix] || 0) + 1))}`;
  const base = (createdMs = todayMs - 200 * DAY, by: string | null = 'USR-0018') => ({
    created_at: iso(createdMs), created_by: by, updated_at: null, updated_by: null, is_deleted: 'N',
  });

  // ---------- personas ----------
  const personaDefs = [
    ['EXEC', 'Deals Leader', 'Leader, Corporate Deals Technology', 'Sees every deal, the portfolio and the money. Creates new engagements and watches risk; does not edit day-to-day work.', '/', '#1D1B19'],
    ['PARTNER', 'Engagement Partner', 'Onshore Engagement Partner', 'Owns the client relationship. Full control of own deals, approves stage gates and AI output for clients, closes projects.', '/', '#D04A02'],
    ['MANAGER', 'Engagement Manager', 'Engagement Manager (AC)', 'Runs deals day to day: plans stages and activities, assigns people, keeps the tracker current, starts close-out.', '/', '#A83C02'],
    ['LEAD', 'Workstream Lead', 'Senior Associate, Workstream Lead', 'Leads a workstream (apps, network, Day-1, TSA). Edits activities and tasks in the stages they own.', '/', '#2C5F8A'],
    ['ANALYST', 'Analyst', 'Associate / Analyst (AC)', 'Cleans inventories and updates the tasks assigned to them. Read-only elsewhere; contacts are masked.', '/', '#2F7D4F'],
    ['KM', 'Knowledge Manager', 'Knowledge Management Lead', 'Reviews close-out learnings, redactions and tags before they enter the AI knowledge hub.', '/knowledge', '#5B3FD0'],
    ['RISK', 'Risk & Quality / DPO', 'Risk & Quality and Data Protection', 'Read-only on every deal. Sees the audit log and approves reuse consent at close-out.', '/audit', '#C8312A'],
    ['CLIENT', 'Client SMO Viewer', 'Client Separation Management Office', 'Read-only view of their own deal. No fees, no internal emails, contacts masked.', '/', '#C98A00'],
    ['ADMIN', 'Platform Admin', 'Deals Stack Platform Engineer', 'Runs the data layer: database driver, Google Sheet sync and Oracle export. No content edits.', '/admin/data', '#4A4642'],
  ] as const;
  const personas = personaDefs.map((p, i) => ({
    persona_id: `PER-${pad(i + 1)}`, code: p[0], name: p[1], title: p[2], description: p[3], home_route: p[4], accent_color: p[5], sort_order: i + 1,
  }));
  const per = (code: string) => personas.find((p) => p.code === code)!.persona_id;

  // ---------- users ----------
  const userDefs: [string, string, string, string, string, string][] = [
    ['Vikram Mehta', 'EXEC', 'vikram.mehta@pwc-demo.in', '+91 98200 11201', 'Mumbai', 'PwC India AC'],
    ['Sarah Whitfield', 'PARTNER', 'sarah.whitfield@pwc-demo.com', '+1 212 555 0147', 'New York', 'PwC US Deals'],
    ['Rajiv Khanna', 'PARTNER', 'rajiv.khanna@pwc-demo.in', '+91 98190 44312', 'Mumbai', 'PwC India Deals'],
    ['Ananya Rao', 'MANAGER', 'ananya.rao@pwc-demo.in', '+91 99000 23145', 'Bengaluru', 'PwC India AC'],
    ['Daniel Brooks', 'MANAGER', 'daniel.brooks@pwc-demo.com', '+1 415 555 0182', 'San Jose', 'PwC US Deals'],
    ['Kavya Iyer', 'MANAGER', 'kavya.iyer@pwc-demo.in', '+91 98450 67890', 'Kolkata', 'PwC India AC'],
    ['Arjun Nair', 'LEAD', 'arjun.nair@pwc-demo.in', '+91 97400 31120', 'Bengaluru', 'PwC India AC'],
    ['Priya Sharma', 'LEAD', 'priya.sharma@pwc-demo.in', '+91 98110 55673', 'Gurugram', 'PwC India AC'],
    ['Rohan Desai', 'LEAD', 'rohan.desai@pwc-demo.in', '+91 98220 78456', 'Mumbai', 'PwC India AC'],
    ['Neha Gupta', 'ANALYST', 'neha.gupta@pwc-demo.in', '+91 99870 12344', 'Kolkata', 'PwC India AC'],
    ['Karan Malhotra', 'ANALYST', 'karan.malhotra@pwc-demo.in', '+91 98760 33421', 'Gurugram', 'PwC India AC'],
    ['Sneha Pillai', 'ANALYST', 'sneha.pillai@pwc-demo.in', '+91 94470 88123', 'Bengaluru', 'PwC India AC'],
    ['Aditya Joshi', 'ANALYST', 'aditya.joshi@pwc-demo.in', '+91 98500 64579', 'Mumbai', 'PwC India AC'],
    ['Meera Krishnan', 'KM', 'meera.krishnan@pwc-demo.in', '+91 98410 22987', 'Chennai', 'PwC Knowledge Management'],
    ['Fatima Sheikh', 'RISK', 'fatima.sheikh@pwc-demo.in', '+91 98330 77654', 'Mumbai', 'PwC Risk & Quality'],
    ['Lisa Moreno', 'CLIENT', 'lisa.moreno@client-phoenix.example', '+1 646 555 0193', 'New York', 'Phoenix buyer SMO'],
    ['Kenji Watanabe', 'CLIENT', 'kenji.watanabe@client-rioja.example', '+1 408 555 0126', 'San Jose', 'Rioja integration office'],
    ['Rahul Verma', 'ADMIN', 'rahul.verma@pwc-demo.in', '+91 99300 45612', 'Bengaluru', 'PwC Deals Stack Platform'],
  ];
  const users = userDefs.map((u, i) => ({
    user_id: `USR-${pad(i + 1)}`, persona_id: per(u[1]), full_name: u[0], email: u[2], phone: u[3], location: u[4], org: u[5],
    preferred_language: u[4] === 'New York' || u[4] === 'San Jose' ? 'en' : 'en', dashboard_layout: null, is_active: 'Y',
    ...base(todayMs - 400 * DAY, null),
  }));
  const U = Object.fromEntries(users.map((u) => [u.full_name.split(' ')[0].toLowerCase(), u.user_id])) as Record<string, string>;
  const nameOf = (uid: string) => users.find((u) => u.user_id === uid)!.full_name;

  // ---------- activity library ----------
  type ActDef = { name: string; desc: string; tasks: string[] };
  const LIB: Record<string, ActDef[]> = {
    Diligence: [
      { name: 'Data room IT review', desc: 'Read the seller IT files, contracts and org charts in the virtual data room.', tasks: ['Index data room IT folders', 'Review master services agreements', 'Summarise IT org and headcount', 'Flag missing IT documents to seller', 'Log red flags in the diligence register', 'Partner review of findings'] },
      { name: '{apps}-application inventory baseline', desc: 'Build one reconciled list of in-scope applications with owners, hosting and users.', tasks: ['Collect CMDB and EA tool extracts', 'Run duplicate and gap quality check', 'Confirm business and IT owners', 'Tag Day-1 critical applications', 'Map applications to sites', 'Sign off baseline with client CIO'] },
      { name: 'IT run-cost baseline', desc: 'Establish current IT run cost of the business being separated.', tasks: ['Collect IT cost allocations', 'Split shared cost by usage', 'Estimate standalone run cost', 'Review cost model with finance', 'Document assumptions'] },
      { name: 'Entanglement and dependency map', desc: 'Find systems, data and contracts shared between parent and divested business.', tasks: ['Interview application owners', 'Map interfaces between applications', 'Identify shared infrastructure', 'Score entanglement per application', 'Highlight hard-to-split items'] },
      { name: 'Cyber and licence red flags', desc: 'Security gaps and non-transferable licences that change price or plan.', tasks: ['Review licence assignment clauses', 'List licences needing vendor consent', 'Check privileged access model', 'Assess cyber posture gaps', 'Brief partner on red flags'] },
    ],
    Signing: [
      { name: 'Separation blueprint and dispositions', desc: 'Assign each application one end state: clone & go, stand-up, consolidate, extract & sunset, commercial agreement.', tasks: ['Agree disposition criteria with client', 'Score applications against criteria', 'Draft recommended dispositions', 'Workshop dispositions with client CIO', 'Record approvals and overrides', 'Publish blueprint v1'] },
      { name: 'TSA service catalogue', desc: 'Define services the seller will provide after close, with price and term.', tasks: ['List candidate TSA services', 'Link services to applications and assets', 'Draft service descriptions', 'Price services with seller finance', 'Set extension terms', 'Hand catalogue to legal for SPA schedules'] },
      { name: 'One-time and stranded cost estimate', desc: 'Cost to separate and seller cost left behind.', tasks: ['Build one-time cost model', 'Estimate stranded IT cost', 'Benchmark against past deals', 'Review with buyer and seller CFOs'] },
      { name: 'Buyer-seller cost sharing scenarios', desc: 'Compare beneficiary-pays, even split, usage-based and avoided-cost credit bases.', tasks: ['Itemise shared cost lines', 'Model four sharing bases', 'Prepare control-board options paper', 'Record agreed basis per item'] },
      { name: 'Day-1 scope definition', desc: 'Decide what must work on the morning after close.', tasks: ['Draft Day-1 must-have list', 'Validate with business process owners', 'Freeze Day-1 scope', 'Set change-control process'] },
    ],
    'Day-1 Readiness': [
      { name: 'Day-1 critical system list ({apps} applications)', desc: 'Every system the business needs on Day-1, with owner and readiness state.', tasks: ['Confirm critical list with business', 'Assign owner per critical system', 'Test access for critical systems', 'Close open readiness gaps', 'Publish go / no-go checklist'] },
      { name: 'Identity and mailbox cut-over ({mailboxes} mailboxes)', desc: 'Accounts, groups and mailboxes moved so people can log in and email on Day-1.', tasks: ['Extract identity and group data', 'Map users to new tenant', 'Pilot mailbox migration', 'Run bulk mailbox migration', 'Validate privileged accounts', 'Hypercare for login issues'] },
      { name: 'Network circuit separation ({sites} sites)', desc: 'Circuits, IP ranges and firewall rules split per site; long lead times tracked.', tasks: ['Order new circuits from carriers', 'Track 90-180 day circuit lead times', 'Plan IP re-addressing', 'Update firewall rules', 'Cut over pilot site', 'Cut over remaining sites'] },
      { name: 'Licence and contract assignments', desc: 'Vendor consents and contract novations needed for Day-1.', tasks: ['Send consent requests to vendors', 'Chase pending vendor consents', 'Novate support contracts', 'Confirm licence keys for new entity', 'Record consent status per licence'] },
      { name: 'Mock Day-1 rehearsal', desc: 'Dress rehearsal of the cut-over weekend.', tasks: ['Write cut-over runbook', 'Run mock cut-over', 'Log rehearsal issues', 'Fix rehearsal issues', 'Go / no-go recommendation to control board'] },
    ],
    'TSA Exit': [
      { name: 'TSA service exit sequencing', desc: 'Compare exit orders by fees saved, dependencies and delivery risk.', tasks: ['Load TSA service register', 'Map dependencies between services', 'Model three exit sequences', 'Present sequence options to control board', 'Lock agreed exit order'] },
      { name: 'Application migration waves', desc: 'Move applications off seller infrastructure in planned waves.', tasks: ['Group applications into waves', 'Plan wave 1 cut-over', 'Execute wave 1', 'Plan wave 2 cut-over', 'Execute wave 2', 'Decommission seller access'] },
      { name: 'Extension risk and cost watch', desc: 'Early warning on services likely to need an extension (median uplift about 20%).', tasks: ['Flag services at risk of late exit', 'Cost extension scenarios', 'Agree mitigation with owners', 'Notify seller 60 days before exit'] },
      { name: 'Service exit sign-off', desc: 'Formal sign-off that each TSA service is exited and billing stops.', tasks: ['Collect exit evidence per service', 'Client sign-off per service', 'Seller billing stop confirmation', 'Update TSA register'] },
      { name: 'Stranded cost actions', desc: 'Help the seller remove cost left behind after exit.', tasks: ['List stranded cost items', 'Agree reduction actions', 'Track savings delivered'] },
    ],
    'Close-out': [
      { name: 'Final status and benefits report', desc: 'Outcome versus plan for the client.', tasks: ['Compile final status', 'Calculate benefits delivered', 'Partner review', 'Issue report to client'] },
      { name: 'Close-out metrics capture', desc: 'TSA term, extensions, one-time cost, Day-1 incidents for benchmarks.', tasks: ['Capture TSA term and extensions', 'Capture one-time cost', 'Capture Day-1 incidents', 'Validate metrics with manager'] },
      { name: 'Lessons learned and knowledge contribution', desc: 'Redacted, consent-checked learnings for the knowledge hub.', tasks: ['Run lessons-learned workshop', 'Draft lessons learned', 'Confirm client reuse consent', 'Redact client identifiers', 'Submit to knowledge manager'] },
      { name: 'Archive and access removal', desc: 'Retention, archive and removal of access.', tasks: ['Archive engagement files', 'Apply retention schedule', 'Remove team access', 'DPO confirmation'] },
    ],
  };

  // project-specific must-have activities
  const SPECIAL: Record<string, Record<string, ActDef[]>> = {
    Phoenix: {
      Signing: [{ name: '415-application disposition & wave plan', desc: 'Disposition for all 415 applications and the migration wave plan they drive.', tasks: ['Score 415 applications on criteria', 'Draft dispositions for payments core', 'Draft dispositions for card issuing apps', 'Approve dispositions with client CIO', 'Build migration wave plan', 'Publish disposition register'] }],
      'Day-1 Readiness': [
        { name: 'Solution Central product registration unblock (148 products)', desc: 'Stalled product registration system blocking next-quarter revenue; 148 products prioritised across geographies.', tasks: ['Prioritise 148 products by revenue', 'Fix registration data defects', 'Re-run registration for priority products', 'Confirm revenue enablement with business', 'Close Solution Central issue log'] },
        { name: 'End-user compute migration (productivity vs security)', desc: 'Device migration where security controls threatened productivity; trade-off decided by control board.', tasks: ['Document productivity vs security options', 'Control board decision on device policy', 'Pilot device migration', 'Bulk migrate devices', 'Track helpdesk tickets'] },
      ],
      Diligence: [{ name: 'Network data cleanse (35,000+ records)', desc: 'Remove duplicates and gaps across 35,000+ fragmented network records before migration.', tasks: ['Consolidate network extracts', 'De-duplicate records', 'Fill missing site codes', 'Verify IP ranges', 'Publish clean network inventory'] }],
    },
    Rioja: {
      'Day-1 Readiness': [
        { name: 'Engineering tool licence transfers (18 profiles)', desc: 'One missing engineering tool would stop design work on Day-1.', tasks: ['List 18 engineering equipment profiles', 'Request licence transfers from EDA vendors', 'Confirm tool access for design teams', 'Test design flow end to end', 'Sign off engineering readiness'] },
        { name: 'Order processing and financial reporting readiness', desc: 'Orders and month-end close must work from Day-1.', tasks: ['Map order-to-cash systems', 'Test order entry in new entity', 'Test financial close', 'Sign off with finance lead'] },
      ],
      Signing: [{ name: 'US$1.74M equipment & licensing funding gap split', desc: 'Split the US$1.74M gap between seller absorption and buyer investment.', tasks: ['Itemise US$1.74M gap', 'Model beneficiary-pays split', 'Model avoided-cost credit split', 'Control board decision on split', 'Record agreed basis per item'] }],
    },
  };

  // ---------- projects ----------
  interface PDef {
    code: string; alias: string; deal: string; ind: string; status: string; progress: number; durDays: number;
    partner: string; manager: string; leads: [string, string][]; analysts: string[]; client?: string;
    apps: number; sites: number; emp: number; mailboxes: string; fee: number; tsa: number; oneTime: number; gap: number;
    extraStage?: { name: string; desc: string; after: number; acts: ActDef[] }; closedAgoDays?: number; tags: string; sens: string; res: string;
    tsaServices?: number; desc: string; health?: 'green' | 'amber' | 'red';
  }
  const P: PDef[] = [
    { code: 'Phoenix', health: 'amber', alias: 'Global payments technology firm (acquirer of a Credit Issuing business)', deal: 'TSA exit', ind: 'Financial Services & Payments', status: 'Active', progress: 0.62, durDays: 420, partner: U.sarah, manager: U.ananya, leads: [[U.arjun, 'Day-1 Readiness, TSA Exit'], [U.priya, 'Signing']], analysts: [U.neha, U.karan], client: U.lisa, apps: 415, sites: 23, emp: 4600, mailboxes: '10,000+', fee: 3200000, tsa: 2100000, oneTime: 18500000, gap: 0, tags: 'tsa-exit,payments,rbi,pci-dss', sens: 'Restricted', res: 'US + India', tsaServices: 10, desc: 'TSA exit and IT separation for a global payments client that acquired a Credit Issuing business. 90-day contractual exit-planning mandate across ~415 applications, 4,600 conveying IT employees, 10,000+ mailboxes, 9,000+ data-centre assets and 23 sites.' },
    { code: 'Rioja', health: 'red', alias: 'Precision-timing semiconductor firm integrating a carved-out unit', deal: 'Day-1 readiness', ind: 'Semiconductors & High-Tech', status: 'At Risk', progress: 0.47, durDays: 300, partner: U.rajiv, manager: U.daniel, leads: [[U.rohan, 'Day-1 Readiness, Funding Gap Resolution']], analysts: [U.sneha, U.aditya], client: U.kenji, apps: 27, sites: 3, emp: 640, mailboxes: '700', fee: 1450000, tsa: 380000, oneTime: 4100000, gap: 1740000, tags: 'day-1,semiconductors,us-ear,funding-gap', sens: 'Restricted', res: 'US', extraStage: { name: 'Funding Gap Resolution', desc: 'Agree who pays for the US$1.74M equipment and licensing gap.', after: 2, acts: [{ name: 'Gap itemisation and evidence', desc: 'Every line of the gap with quotes and owner.', tasks: ['Collect vendor quotes', 'Tag each item buyer / seller benefit', 'Validate quantities with engineering', 'Publish itemised gap'] }, { name: 'Bridge financing options (Phase 3 idea)', desc: 'Explore bank bridge facility against verified Day-1 needs.', tasks: ['Summarise verified Day-1 needs', 'Independence check', 'Client decision on data release'] }] }, desc: 'Day-1 IT readiness for a semiconductor client integrating a business carved out of a peer. 3 conveying sites, 27 application systems, 300+ activities across 8 workstreams, 18 engineering equipment profiles and a US$1.74M funding gap.' },
    { code: 'Atlas', health: 'green', alias: 'Global consumer-health group spinning off its OTC brands', deal: 'Spin-off', ind: 'Healthcare & Life Sciences', status: 'Active', progress: 0.33, durDays: 480, partner: U.sarah, manager: U.kavya, leads: [[U.priya, 'Signing, Day-1 Readiness']], analysts: [U.karan, U.aditya], apps: 186, sites: 14, emp: 2100, mailboxes: '5,400', fee: 2100000, tsa: 0, oneTime: 9800000, gap: 0, tags: 'spin-off,healthcare,gdpr', sens: 'Confidential', res: 'EU + India', desc: 'IT separation for a spin-off of an OTC consumer-health business, including GDPR-sensitive pharmacovigilance data.' },
    { code: 'Borealis', health: 'green', alias: 'Regional bank selling its card-acquiring unit', deal: 'Sell-side carve-out', ind: 'Financial Services & Payments', status: 'Planning', progress: 0.07, durDays: 360, partner: U.rajiv, manager: U.ananya, leads: [], analysts: [U.neha], apps: 64, sites: 6, emp: 520, mailboxes: '900', fee: 980000, tsa: 0, oneTime: 2600000, gap: 0, tags: 'sell-side,rbi,pci-dss', sens: 'Restricted', res: 'India', desc: 'Sell-side perimeter and TSA design for a bank divesting its card-acquiring business. Payment data must stay in India (RBI).' },
    { code: 'Cobalt', health: 'red', alias: 'Industrial automation buyer acquiring a sensors division', deal: 'Buy-side carve-out', ind: 'Industrial Manufacturing', status: 'On Hold', progress: 0.24, durDays: 330, partner: U.rajiv, manager: U.kavya, leads: [[U.rohan, 'Diligence, Signing']], analysts: [U.sneha], apps: 48, sites: 5, emp: 860, mailboxes: '1,100', fee: 760000, tsa: 0, oneTime: 3100000, gap: 450000, tags: 'buy-side,on-hold,ot-systems', sens: 'Confidential', res: 'EU', desc: 'Buy-side separation planning for a sensors division with factory OT systems. On hold pending regulatory clearance.' },
    { code: 'Delta', health: 'green', alias: 'Telecom operator separating its tower and media unit', deal: 'Sell-side carve-out', ind: 'Telecom & Media', status: 'Active', progress: 0.71, durDays: 390, partner: U.sarah, manager: U.daniel, leads: [[U.arjun, 'TSA Exit']], analysts: [U.aditya, U.neha], apps: 132, sites: 41, emp: 1800, mailboxes: '3,900', fee: 1850000, tsa: 640000, oneTime: 7200000, gap: 0, tags: 'sell-side,telecom,tsa', sens: 'Confidential', res: 'India', tsaServices: 6, desc: 'Separation of a tower and media unit with 41 network sites and a TSA for billing and NOC services.' },
    { code: 'Everest', health: 'amber', alias: 'Retail group divesting its e-commerce logistics arm', deal: 'TSA exit', ind: 'Consumer & Retail', status: 'Closing', progress: 0.9, durDays: 360, partner: U.sarah, manager: U.ananya, leads: [[U.priya, 'TSA Exit, Close-out']], analysts: [U.karan], apps: 73, sites: 9, emp: 1250, mailboxes: '2,000', fee: 1100000, tsa: 290000, oneTime: 3900000, gap: 0, tags: 'tsa-exit,retail,closing', sens: 'Confidential', res: 'India', tsaServices: 6, desc: 'Final TSA exits for a logistics carve-out; warehouse management and e-commerce platform migrations nearly complete.' },
    { code: 'Falcon', health: 'amber', alias: 'Energy utility integrating an acquired renewables developer', deal: 'Integration', ind: 'Energy & Utilities', status: 'Active', progress: 0.44, durDays: 400, partner: U.rajiv, manager: U.daniel, leads: [[U.rohan, 'Day-1 Readiness']], analysts: [U.sneha], apps: 95, sites: 17, emp: 980, mailboxes: '1,400', fee: 1300000, tsa: 0, oneTime: 5400000, gap: 0, tags: 'integration,energy,scada', sens: 'Confidential', res: 'India', desc: 'Day-1 integration of a renewables developer: SCADA monitoring, asset registers and ERP consolidation.' },
    { code: 'Granite', alias: 'Payments processor exiting a seller TSA', deal: 'TSA exit', ind: 'Financial Services & Payments', status: 'Closed', progress: 1, durDays: 390, closedAgoDays: 150, partner: U.rajiv, manager: U.ananya, leads: [], analysts: [], apps: 210, sites: 11, emp: 1900, mailboxes: '4,200', fee: 1700000, tsa: 0, oneTime: 8100000, gap: 0, tags: 'closed,tsa-exit,payments', sens: 'Restricted', res: 'US + India', tsaServices: 8, desc: 'Closed TSA exit for a payments processor; 8 TSA services exited, one extension.' },
    { code: 'Horizon', alias: 'Semiconductor equipment maker standing up a carved-out unit', deal: 'Day-1 readiness', ind: 'Semiconductors & High-Tech', status: 'Closed', progress: 1, durDays: 280, closedAgoDays: 90, partner: U.sarah, manager: U.daniel, leads: [], analysts: [], apps: 34, sites: 4, emp: 720, mailboxes: '800', fee: 920000, tsa: 0, oneTime: 2900000, gap: 0, tags: 'closed,day-1,semiconductors', sens: 'Restricted', res: 'US', desc: 'Closed Day-1 programme for a semiconductor equipment carve-out with export-controlled design data.' },
    { code: 'Indigo', alias: 'Medical devices group spinning off a diagnostics business', deal: 'Spin-off', ind: 'Healthcare & Life Sciences', status: 'Closed', progress: 1, durDays: 450, closedAgoDays: 40, partner: U.rajiv, manager: U.kavya, leads: [], analysts: [], apps: 120, sites: 8, emp: 1500, mailboxes: '3,100', fee: 1500000, tsa: 0, oneTime: 6300000, gap: 0, tags: 'closed,spin-off,healthcare', sens: 'Confidential', res: 'EU + India', desc: 'Closed spin-off of a diagnostics business with GDPR and health-data controls.' },
  ];

  const out: SeedData = {
    personas, users, projects: [], project_members: [], stages: [], activities: [], tasks: [], contacts: [], communications: [],
    quick_notes: [], finance_entries: [], tsa_services: [], knowledge_items: [], chat_messages: [], audit_log: [],
  };

  const contactFirst = ['Michael', 'Jennifer', 'Thomas', 'Akira', 'Elena', 'Robert', 'Divya', 'Samuel', 'Grace', 'Hiro', 'Marta', 'Oliver', 'Shalini', 'Peter', 'Yuki'];
  const contactLast = ['Grant', 'Okafor', 'Lindqvist', 'Tanaka', 'Rossi', 'Chen', 'Bhatt', 'Fischer', 'Nguyen', 'Kowalski', 'Mendes', 'Hartley', 'Iyengar', 'Dubois', 'Sato'];
  const contactRoles: [string, string][] = [['Buyer', 'CIO'], ['Buyer', 'Separation Management Office lead'], ['Seller', 'Head of IT Separation'], ['Seller', 'TSA Service Manager'], ['Vendor', 'Carrier account manager'], ['Vendor', 'Licensing specialist']];

  for (const p of P) {
    const projectId = id('PRJ');
    const closed = p.status === 'Closed';
    const startMs = closed ? todayMs - (p.closedAgoDays! + p.durDays) * DAY : todayMs - Math.round(p.progress * p.durDays) * DAY;
    const endMs = startMs + p.durDays * DAY;
    const isUS = /New York|San Jose/.test(users.find((u) => u.user_id === p.partner)!.location);

    // stages (5 default + optional extra)
    const stageList: { name: string; description: string; gate_criteria: string; acts?: ActDef[] }[] = DEFAULT_STAGES.map((s) => ({ ...s }));
    if (p.extraStage) stageList.splice(p.extraStage.after + 1, 0, { name: p.extraStage.name, description: p.extraStage.desc, gate_criteria: 'Agreed split recorded with approvers.', acts: p.extraStage.acts });
    const nStages = stageList.length;
    const stageFloat = p.progress * nStages;
    const curIdx = closed ? nStages : Math.min(nStages - 1, Math.floor(stageFloat));
    const span = (endMs - startMs) / nStages;

    const contacts = contactRoles.map(([side, role], i) => {
      const fn = contactFirst[(i * 3 + p.code.length) % contactFirst.length];
      const ln = contactLast[(i * 5 + p.code.length * 2) % contactLast.length];
      const org = side === 'Buyer' ? `${p.code} buyer` : side === 'Seller' ? `${p.code} seller` : i === 4 ? 'Global carrier (demo)' : 'Software vendor (demo)';
      const phone = isUS || i % 2 === 0 ? `+1 ${between(201, 989)} 555 0${between(100, 199)}` : `+91 98${between(100, 999)} ${between(10000, 99999)}`;
      return {
        contact_id: id('CON'), project_id: projectId, full_name: `${fn} ${ln}`, org, role_title: role, side,
        email: `${fn.toLowerCase()}.${ln.toLowerCase()}@${p.code.toLowerCase()}-${side.toLowerCase()}.example`, phone,
        ...base(startMs),
      };
    });
    contacts.push({ contact_id: id('CON'), project_id: projectId, full_name: nameOf(p.partner), org: 'PwC', role_title: 'Engagement Partner', side: 'PwC', email: users.find((u) => u.user_id === p.partner)!.email, phone: users.find((u) => u.user_id === p.partner)!.phone, ...base(startMs) });
    out.contacts.push(...contacts);

    const team = [p.manager, ...p.leads.map((l) => l[0]), ...p.analysts];
    let firstCurrentStageId: string | null = null;

    stageList.forEach((s, si) => {
      const stageId = id('STG');
      const sStart = startMs + si * span;
      const sEnd = sStart + span;
      const stageDone = closed || si < curIdx;
      const stageCur = !closed && si === curIdx;
      const frac = stageDone ? 1 : stageCur ? Math.max(0.15, stageFloat - curIdx) : 0;
      if (stageCur) firstCurrentStageId = stageId;
      const leadForStage = p.leads.find(([, ws]) => ws.split(',').map((x) => x.trim()).includes(s.name))?.[0] ?? p.manager;
      out.stages.push({
        stage_id: stageId, project_id: projectId, name: s.name, description: s.description, sort_order: si + 1,
        status: 'Not Started', percent_complete: 0, owner_user_id: leadForStage, start_date: d(sStart), end_date: d(sEnd),
        gate_status: stageDone ? 'Approved' : stageCur && frac > 0.8 ? 'Pending Approval' : 'Not Ready', gate_criteria: s.gate_criteria,
        gate_approver_id: p.partner, ...base(startMs),
      });

      // pick activities
      const special = SPECIAL[p.code]?.[s.name] ?? [];
      const pool = s.acts ?? LIB[s.name] ?? LIB.Diligence;
      const nActs = s.acts ? s.acts.length : between(3, Math.min(5, pool.length));
      const chosen: ActDef[] = [...special];
      const shuffled = [...pool].sort(() => rnd() - 0.5);
      for (const a of shuffled) { if (chosen.length >= Math.max(nActs, special.length + 2)) break; if (!chosen.some((c) => c.name === a.name)) chosen.push(a); }
      const fill = (t: string) => t.replace('{apps}', String(p.apps)).replace('{sites}', String(p.sites)).replace('{mailboxes}', p.mailboxes);

      chosen.forEach((a, ai) => {
        const actId = id('ACT');
        const owner = ai === 0 ? leadForStage : pick(team);
        const aStart = sStart + (ai / chosen.length) * span * 0.4;
        const aDue = Math.min(sEnd, aStart + span * 0.75);
        const actName = fill(a.name);
        out.activities.push({
          activity_id: actId, project_id: projectId, stage_id: stageId, name: actName, description: a.desc, sort_order: ai + 1,
          status: 'Not Started', priority: si === 2 || ai === 0 ? 'High' : pick(['Medium', 'Medium', 'High', 'Low']), percent_complete: 0,
          owner_user_id: owner, start_date: d(aStart), due_date: d(aDue), summary: null, ...base(startMs),
        });

        const nTasks = Math.min(a.tasks.length, between(4, 8));
        const taskIds: string[] = [];
        a.tasks.slice(0, nTasks).forEach((title, ti) => {
          const taskId = id('TSK');
          taskIds.push(taskId);
          const tStart = aStart + (ti / nTasks) * (aDue - aStart) * 0.6;
          const tDue = aStart + ((ti + 1) / nTasks) * (aDue - aStart);
          let status = 'Not Started';
          let pct = 0;
          if (stageDone) { status = 'Done'; pct = 100; }
          else if (stageCur && p.status !== 'Planning') {
            const r = rnd();
            const doneP = frac * 0.9;
            if (tDue < todayMs - 20 * DAY && r < 0.75) { status = 'Done'; pct = 100; }
            else if (r < doneP) { status = 'Done'; pct = 100; }
            else if (r < doneP + 0.12) { status = 'Blocked'; pct = between(1, 5) * 10; }
            else if (r < doneP + 0.55) { status = 'In Progress'; pct = between(2, 8) * 10; }
          } else if (stageCur) {
            if (rnd() < 0.3) { status = 'In Progress'; pct = between(1, 4) * 10; }
          }
          if (p.status === 'On Hold' && status === 'In Progress' && rnd() < 0.4) status = 'Blocked';
          const assignee = pick(p.analysts.length ? [...p.analysts, ...p.analysts, owner] : [owner, p.manager]);
          const day1 = s.name === 'Day-1 Readiness' && rnd() < 0.45 ? 'Y' : 'N';
          const contact = pick(contacts);
          out.tasks.push({
            task_id: taskId, project_id: projectId, stage_id: stageId, activity_id: actId, title,
            description: `${title} for ${actName.toLowerCase()} on Project ${p.code}.`,
            assignee_user_id: assignee, status, priority: day1 === 'Y' ? pick(['High', 'Critical']) : pick(['Low', 'Medium', 'Medium', 'High']),
            start_date: d(tStart), due_date: d(tDue), completed_date: status === 'Done' ? d(Math.min(tDue, todayMs - DAY)) : null,
            effort_hours: between(4, 40), percent_complete: pct, day1_critical: day1,
            dependency_notes: status === 'Blocked' ? pick([`Waiting on ${contact.full_name} (${contact.org}) to confirm data.`, 'Waiting on vendor consent letter.', 'Blocked by seller change freeze until month-end.', 'Needs carrier circuit delivery date (lead time 90-180 days).', 'Waiting for control-board decision on cost split.']) : (rnd() < 0.3 ? 'Depends on previous task in this activity.' : null),
            done_notes: status === 'Done' ? pick(['Completed and reviewed by manager.', 'Signed off by client owner; evidence filed.', 'Done; quality check passed with no open defects.']) : pct > 0 ? `${pct}% done: first pass complete, review pending.` : null,
            pending_notes: status === 'Done' ? null : pick(['Final review with client owner.', 'Collect remaining evidence and update register.', 'Schedule walkthrough with seller IT.', 'Resolve two open data gaps.']),
            sort_order: ti + 1, ...base(startMs),
          });
        });

        // communications for activities that have started
        if (stageDone || stageCur) {
          const nComms = between(3, 6);
          for (let ci = 0; ci < nComms; ci++) {
            const contact = pick(contacts);
            const channel = pick(['Email', 'Email', 'Call', 'Meeting', 'Chat']);
            const when = Math.min(todayMs - between(0, 20) * DAY - between(1, 10) * 3600000, aStart + rnd() * (Math.min(aDue, todayMs) - aStart));
            const taskLink = rnd() < 0.5 ? pick(taskIds) : null;
            const topic = actName;
            let subject = '';
            let body = '';
            let dur: number | null = null;
            if (channel === 'Email') {
              subject = pick([`RE: ${topic} - open items`, `${topic}: status for this week`, `Action needed: ${topic}`, `FW: data request for ${topic}`]);
              body = pick([
                `Hi team,\n\nQuick update on ${topic}. We closed most of last week's items. Two points are still open: the owner sign-off and the missing source extract. Can we close both by Friday?\n\nRegards,\n${contact.full_name}`,
                `Hello,\n\nPlease find the updated tracker for ${topic}. The seller has confirmed the dates for the next cut-over. We still need the licence consent from the vendor before we can proceed.\n\nThanks,\n${nameOf(p.manager)}`,
                `Team,\n\nThe control board asked for a clear option paper on ${topic} with cost, risk and date. Please share your inputs by Wednesday so we can review before the meeting.\n\nBest,\n${nameOf(p.partner)}`,
              ]);
            } else if (channel === 'Call') {
              dur = between(10, 45);
              subject = `Call with ${contact.full_name} (${contact.phone})`;
              body = `Call with ${contact.full_name}, ${contact.role_title} at ${contact.org}, on ${contact.phone}. Discussed ${topic.toLowerCase()}. Agreed next steps: share evidence pack, confirm owner, and re-check dates in two days.`;
            } else if (channel === 'Meeting') {
              dur = between(30, 60);
              subject = `${topic} - working session`;
              body = `Working session with client and seller teams on ${topic.toLowerCase()}. Decisions: keep current plan; escalate one risk to control board. Attendees: ${nameOf(p.manager)}, ${contact.full_name}${p.client ? ', client SMO' : ''}.`;
            } else {
              subject = `Teams chat: ${topic}`;
              body = `${nameOf(owner)}: Uploaded the latest file for ${topic}. Can someone check the two red rows?\n${nameOf(pick(team))}: Checked, one was a duplicate, fixed now.`;
            }
            out.communications.push({
              comm_id: id('COM'), project_id: projectId, stage_id: stageId, activity_id: actId, task_id: taskLink, channel, subject, body,
              from_name: channel === 'Email' ? contact.full_name : nameOf(owner), to_name: channel === 'Email' ? `${nameOf(p.manager)}; ${nameOf(owner)}` : contact.full_name,
              contact_id: contact.contact_id, occurred_at: iso(Math.max(startMs, when)), duration_min: dur, ai_summary: null, ...base(Math.max(startMs, when), owner),
            });
          }
          if (stageCur || rnd() < 0.3) {
            out.quick_notes.push({
              note_id: id('NOT'), project_id: projectId, stage_id: stageId, activity_id: actId, task_id: null,
              body: pick([`Client wants a one-page view of ${actName.toLowerCase()} for the next control board.`, 'Remember: two items depend on vendor consent letters - chase on Monday.', 'Seller change freeze starts at month-end; plan cut-overs before it.', 'Owner changed on the client side; update contact list.']),
              pinned: rnd() < 0.3 ? 'Y' : 'N', ...base(todayMs - between(1, 15) * DAY, owner),
            });
          }
        }
      });
    });

    // shape health so the portfolio shows a realistic Green / Amber / Red mix
    if (p.health && p.health !== 'red') {
      const todayStr = d(todayMs);
      let blockedKept = 0;
      for (const t of out.tasks.filter((x) => x.project_id === projectId)) {
        const overdue = t.status !== 'Done' && t.due_date && t.due_date < todayStr;
        if (t.status === 'Blocked' && ++blockedKept > (p.health === 'green' ? 1 : 2)) { t.status = 'In Progress'; t.dependency_notes = null; }
        if (!overdue) continue;
        if (p.health === 'green') { t.status = 'Done'; t.percent_complete = 100; t.completed_date = t.due_date; t.done_notes = 'Completed and reviewed by manager.'; t.pending_notes = null; t.dependency_notes = null; }
        else { t.priority = 'Medium'; t.day1_critical = 'N'; if (t.status === 'Blocked') t.status = 'In Progress'; }
      }
      if (p.health === 'amber') {
        const open = out.tasks.filter((x) => x.project_id === projectId && x.status === 'In Progress');
        for (const t of open.slice(0, 2)) { t.due_date = d(todayMs - 4 * DAY); t.priority = 'Medium'; t.day1_critical = 'N'; }
      }
    }

    // project row
    const stageRows = out.stages.filter((s) => s.project_id === projectId);
    out.projects.push({
      project_id: projectId, code_name: `Project ${p.code}`, client_alias: p.alias, deal_type: p.deal, industry: p.ind, description: p.desc,
      status: p.status, rag: 'Green', percent_complete: 0, current_stage_id: firstCurrentStageId ?? stageRows[stageRows.length - 1].stage_id,
      partner_user_id: p.partner, manager_user_id: p.manager, start_date: d(startMs), target_close_date: d(endMs),
      closed_date: closed ? d(todayMs - p.closedAgoDays! * DAY) : null, currency: 'USD', fee_budget: p.fee,
      fee_billed: Math.round(p.fee * Math.min(1, p.progress * (0.92 + rnd() * 0.15))), tsa_monthly_cost: p.tsa || null,
      one_time_cost: p.oneTime, funding_gap: p.gap || null, apps_in_scope: p.apps, sites_in_scope: p.sites, employees_conveying: p.emp,
      sensitivity: p.sens, data_residency: p.res, clean_team_required: p.deal.startsWith('Sell') || p.deal === 'Spin-off' ? 'Y' : 'N',
      reuse_consent: closed ? 'Granted' : p.code === 'Everest' ? 'Granted' : 'Pending', tags: p.tags, ...base(startMs, U.vikram),
    });

    // members
    const addMember = (uid: string, role: string, ws?: string) => out.project_members.push({ member_id: id('MEM'), project_id: projectId, user_id: uid, member_role: role, workstream: ws ?? null, clean_team: role === 'Partner' || role === 'Manager' ? 'Y' : 'N', ...base(startMs) });
    addMember(p.partner, 'Partner');
    addMember(p.manager, 'Manager');
    for (const [l, ws] of p.leads) addMember(l, 'Workstream Lead', ws);
    for (const a of p.analysts) addMember(a, 'Analyst');
    if (p.client) addMember(p.client, 'Client Viewer');

    // finance (12 months ending this month, or ending at close)
    const endMonth = closed ? new Date(todayMs - p.closedAgoDays! * DAY) : new Date(todayMs);
    const months = Math.max(1, Math.round(p.durDays / 30));
    for (let m = 11; m >= 0; m--) {
      const dt = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - m, 1));
      if (dt.getTime() < startMs - 31 * DAY) continue;
      const planned = Math.round(p.fee / months);
      out.finance_entries.push({
        finance_id: id('FIN'), project_id: projectId, period_month: dt.toISOString().slice(0, 7), fee_planned: planned,
        fee_actual: Math.round(planned * (0.82 + rnd() * 0.33)), tsa_cost: p.tsa ? Math.round(p.tsa * (1 - (11 - m) * 0.02)) : 0,
        one_time_cost: Math.round((p.oneTime / months) * (0.7 + rnd() * 0.6)), hours_logged: between(380, 1400), ...base(dt.getTime()),
      });
    }

    // TSA services
    const tsaNames = ['Data-centre hosting', 'Service desk and end-user support', 'Network and WAN', 'Email and collaboration', 'ERP application support', 'Payroll processing', 'Card processing platform', 'Security operations (SOC)', 'Identity and access management', 'Billing platform'];
    for (let i = 0; i < (p.tsaServices || 0); i++) {
      const sStart = startMs + 60 * DAY;
      const exit = sStart + between(9, 24) * 30 * DAY;
      const svcStatus = closed ? (i === 2 ? 'Extended' : 'Exited') : exit < todayMs ? (rnd() < 0.3 ? 'Extended' : 'Exited') : exit < todayMs + 60 * DAY ? 'Exiting' : 'Active';
      out.tsa_services.push({
        service_id: id('TSA'), project_id: projectId, name: tsaNames[i % tsaNames.length], provider: `${p.code} seller`,
        monthly_fee: between(60, 340) * 1000, start_date: d(sStart), planned_exit_date: d(exit), extension_uplift_pct: pick([15, 20, 20, 25]),
        status: svcStatus, linked_apps: `${between(3, 40)} applications`, ...base(sStart),
      });
    }

    // a few recent audit rows for the activity feed
    if (!closed) {
      const someTasks = out.tasks.filter((t) => t.project_id === projectId && t.status !== 'Not Started').slice(-3);
      for (const t of someTasks) {
        out.audit_log.push({ audit_id: id('AUD'), actor_user_id: t.assignee_user_id, persona_code: null, action: 'task.update', entity_type: 'task', entity_id: t.task_id, project_id: projectId, details: JSON.stringify({ title: t.title, status: t.status }), ai_generated: 'N', created_at: iso(todayMs - between(1, 72) * 3600000) });
      }
    }
  }

  // persona codes on audit rows
  for (const a of out.audit_log) {
    const u = users.find((x) => x.user_id === a.actor_user_id);
    a.persona_code = personas.find((p) => p.persona_id === u?.persona_id)?.code ?? null;
  }

  // ---------- knowledge hub from the 3 closed projects ----------
  const closedProjects = out.projects.filter((p) => p.status === 'Closed');
  const labels: Record<string, string> = { 'Project Granite': 'Payments TSA exit (anonymised)', 'Project Horizon': 'Semiconductor Day-1 carve-out (anonymised)', 'Project Indigo': 'Healthcare spin-off (anonymised)' };
  for (const cp of closedProjects) {
    const label = labels[cp.code_name];
    const kb = (row: Row) => out.knowledge_items.push({
      knowledge_id: id('KNW'), source_project_id: cp.project_id, source_label: label, deal_type: cp.deal_type, industry: cp.industry,
      consent_status: 'Granted', review_status: 'Approved', reviewed_by: U.meera, reviewed_at: iso(todayMs - 20 * DAY), times_used: between(0, 9),
      ...base(todayMs - 30 * DAY, U.meera), ...row,
    });
    const stages = out.stages.filter((s) => s.project_id === cp.project_id);
    for (const s of stages) {
      const acts = out.activities.filter((a) => a.stage_id === s.stage_id).map((a) => ({
        name: a.name.replace(/Project \w+/g, 'the deal'), description: a.description, priority: a.priority,
        tasks: out.tasks.filter((t) => t.activity_id === a.activity_id).map((t) => ({ title: t.title, priority: t.priority, day1_critical: t.day1_critical, effort_hours: t.effort_hours })),
      }));
      kb({ item_type: 'Stage Template', stage_name: s.name, title: `${s.name} playbook - ${label}`, body: `${s.description} Worked well on a closed ${cp.deal_type?.toLowerCase()} in ${cp.industry}.`, payload: JSON.stringify({ stage: { name: s.name, description: s.description, gate_criteria: s.gate_criteria }, activities: acts }), tags: `${s.name.toLowerCase()},template,${cp.deal_type?.toLowerCase()}` });
    }
    const keyAct = out.activities.filter((a) => a.project_id === cp.project_id)[2];
    if (keyAct) {
      kb({ item_type: 'Activity Template', stage_name: stages.find((s) => s.stage_id === keyAct.stage_id)?.name, title: keyAct.name, body: keyAct.description, payload: JSON.stringify({ activity: { name: keyAct.name, description: keyAct.description, priority: keyAct.priority }, tasks: out.tasks.filter((t) => t.activity_id === keyAct.activity_id).map((t) => ({ title: t.title, priority: t.priority, day1_critical: t.day1_critical })) }), tags: 'activity,template' });
    }
    kb({ item_type: 'Lesson', stage_name: 'Day-1 Readiness', title: 'Start circuit orders in Signing, not Day-1', body: 'Network circuits took 120-170 days. Orders placed after signing put two sites at risk of missing Day-1. Place carrier orders as soon as site scope is known.', tags: 'network,lead-time,day-1' });
    kb({ item_type: 'Lesson', stage_name: 'TSA Exit', title: 'Sequence low-dependency TSA services first', body: 'Exiting low-dependency services (email, service desk) two months early saved fees and freed the team for the hard ERP exit. Model exit order before the TSA is signed.', tags: 'tsa,sequencing,cost' });
    kb({ item_type: 'Metric', stage_name: 'Close-out', title: `Close-out metrics - ${label}`, body: 'Standard close-out metrics for benchmarks.', payload: JSON.stringify({ tsa_term_months: between(14, 26), extensions: between(0, 2), extension_uplift_pct: 20, one_time_cost_pct_revenue: (1 + rnd() * 4).toFixed(1), day1_incidents: between(0, 4), apps_in_scope: cp.apps_in_scope }), tags: 'metrics,benchmark' });
    kb({ item_type: 'Risk', stage_name: 'Signing', title: 'Licence consents found late', body: 'Several vendor licences needed consent to assign. Found during Day-1 prep, they forced short-term TSA extensions. Check assignment clauses during diligence.', tags: 'licences,consent,risk' });
  }
  // pending review items (from the closing project)
  const everest = out.projects.find((p) => p.code_name === 'Project Everest')!;
  const pend = [
    ['Lesson', 'TSA Exit', 'Warehouse system cut-over needs a peak-season freeze window', 'Retail logistics cut-overs must avoid festive peak. Plan exits for low-volume weeks and agree the freeze window early.'],
    ['Activity Template', 'TSA Exit', 'Warehouse management system migration wave', 'Activity template: WMS migration with parallel run and rollback plan.'],
    ['Risk', 'Close-out', 'Seller kept admin access after exit', 'Seller admin accounts stayed active two weeks after service exit. Add an access-removal check to every service exit sign-off.'],
  ];
  for (const [type, stage, title, body] of pend) {
    out.knowledge_items.push({
      knowledge_id: id('KNW'), source_project_id: everest.project_id, source_label: 'Retail logistics TSA exit (anonymised)', item_type: type,
      deal_type: everest.deal_type, industry: everest.industry, stage_name: stage, title, body,
      payload: type === 'Activity Template' ? JSON.stringify({ activity: { name: title, description: body, priority: 'High' }, tasks: [{ title: 'Agree freeze window', priority: 'High' }, { title: 'Parallel run for two weeks', priority: 'High' }, { title: 'Rollback rehearsal', priority: 'Medium' }, { title: 'Decommission old WMS access', priority: 'Medium' }] }) : null,
      tags: 'pending', consent_status: 'Granted', review_status: 'Pending Review', reviewed_by: null, reviewed_at: null, times_used: 0,
      ...base(todayMs - 2 * DAY, everest.manager_user_id),
    });
  }

  // two sample Piku messages
  out.chat_messages.push(
    { message_id: id('MSG'), user_id: U.ananya, project_id: out.projects[0].project_id, context_type: 'project', context_id: out.projects[0].project_id, sender: 'user', body: 'What is blocked on Phoenix right now?', language: 'en', ai_mode: null, sources: null, ...base(todayMs - DAY, U.ananya) },
    { message_id: id('MSG'), user_id: U.ananya, project_id: out.projects[0].project_id, context_type: 'project', context_id: out.projects[0].project_id, sender: 'piku', body: 'Phoenix has a few blocked tasks, mostly waiting on vendor consents and carrier dates. Open the TSA Exit stage to see them.', language: 'en', ai_mode: 'offline', sources: null, ...base(todayMs - DAY + 5000, U.ananya) },
  );

  return out;
}
