/**
 * Guardrails for Piku and the other AI features.
 *  - capabilities(): what THIS user may and may not do on THIS screen (persona actions + row rules from
 *    services/access.ts). Used in every Gemini prompt and to answer "can I ...?" questions exactly.
 *  - permissionAnswer(): deterministic answers to "can I / please do X" questions. Piku never performs writes.
 *  - refusal(): polite refusals for other projects, other people's AI history, secrets, or "ignore the rules".
 */
import type { Db } from '../db/Db';
import type { AuthContext } from '../auth-types';
import type { Lang, PersonaCode, Project } from '../../../shared/types';
import { PERMISSIONS, type Action } from '../../../shared/permissions';
import { canAddActivityToStage, canAddTaskToActivity, canEditActivity, canEditTask } from '../services/access';
import type { Scope, ScopedData } from './data';
import { userName } from './data';
import { t } from './lang';

export const ROLE_NAME: Record<PersonaCode, string> = {
  EXEC: 'Deals Leader', PARTNER: 'Engagement Partner', MANAGER: 'Engagement Manager', LEAD: 'Workstream Lead',
  ANALYST: 'Analyst', KM: 'Knowledge Manager', RISK: 'Risk & Quality / DPO', CLIENT: 'Client SMO viewer', ADMIN: 'Platform Admin',
};

const has = (auth: AuthContext, a: Action) => (auth.actions as string[]).includes(a);

/** Roles (names) whose persona has an action. */
export function rolesWith(action: Action): string[] {
  return (Object.keys(PERMISSIONS) as PersonaCode[]).filter((c) => PERMISSIONS[c].actions.includes(action)).map((c) => ROLE_NAME[c]);
}

export interface Capabilities {
  role: string;
  can: string[];
  cannot: string[];
  /** quick flags used by guardrails and prompts */
  flags: {
    finance: boolean; contactsFull: boolean; contactsVisible: boolean; internalComms: boolean;
    editProject: boolean; closeProject: boolean; editStages: boolean; approveGate: boolean;
    addActivity: boolean; editActivity: boolean; addTask: boolean; editTask: boolean; taskFields: string[];
    ownTasksOnly: boolean; notes: boolean; aiSuggest: boolean; approveKnowledge: boolean; audit: boolean; admin: boolean; createProject: boolean;
    projectClosed: boolean;
  };
}

/** What the signed-in user can and cannot do on the current screen. */
export async function capabilities(db: Db, auth: AuthContext, scope: Scope): Promise<Capabilities> {
  const projectClosed = scope.project?.status === 'Closed';
  const open = !projectClosed;
  const editTaskInfo = scope.task ? await canEditTask(db, auth, scope.task) : null;
  const flags: Capabilities['flags'] = {
    finance: has(auth, 'finance.view') && auth.code !== 'CLIENT',
    contactsFull: has(auth, 'contacts.view.full'),
    contactsVisible: auth.code !== 'CLIENT',
    internalComms: has(auth, 'comms.view') && auth.code !== 'CLIENT',
    createProject: has(auth, 'project.create'),
    editProject: open && has(auth, 'project.edit'),
    closeProject: open && has(auth, 'project.close'),
    editStages: open && has(auth, 'stage.edit'),
    approveGate: open && has(auth, 'stage.gate.approve'),
    addActivity: scope.stage ? await canAddActivityToStage(db, auth, scope.stage) : open && has(auth, 'activity.edit') && auth.code !== 'LEAD',
    editActivity: scope.activity ? await canEditActivity(db, auth, scope.activity) : open && has(auth, 'activity.edit') && auth.code !== 'LEAD',
    addTask: scope.activity ? await canAddTaskToActivity(db, auth, scope.activity) : open && has(auth, 'task.edit') && auth.code !== 'LEAD',
    editTask: editTaskInfo ? editTaskInfo.canEdit : open && (has(auth, 'task.edit') || has(auth, 'task.edit.own')),
    taskFields: editTaskInfo ? (editTaskInfo.editableFields as string[]) : [],
    ownTasksOnly: !has(auth, 'task.edit') && has(auth, 'task.edit.own'),
    notes: open && has(auth, 'notes.add'),
    aiSuggest: has(auth, 'ai.suggest'),
    approveKnowledge: has(auth, 'knowledge.edit') || has(auth, 'closeout.approve'),
    audit: has(auth, 'audit.view'),
    admin: has(auth, 'admin.data'),
    projectClosed,
  };
  const can: string[] = [];
  const cannot: string[] = [];
  const put = (ok: boolean, yes: string, no: string) => (ok ? can : cannot).push(ok ? yes : no);
  put(true, 'view the projects you are staffed on' + (PERMISSIONS[auth.code].scope === 'all' ? ' (your role sees every project)' : ''), '');
  put(flags.finance, 'see fees, budgets, TSA costs and funding gaps', `see fees, budgets, TSA costs or funding gaps (only ${rolesWith('finance.view').join(', ')})`);
  put(flags.contactsFull, 'see contact phone numbers and emails', flags.contactsVisible ? 'see full phone numbers/emails (they are masked for your role)' : 'see contact details or internal emails (client view)');
  if (scope.type !== 'global') {
    put(flags.editProject, 'edit the project details', `edit the project (${rolesWith('project.edit').join(' or ')} on this project)`);
    put(flags.closeProject, 'close the project (Close project button)', `close the project (${rolesWith('project.close').join(' or ')} on this project)`);
    put(flags.editStages, 'add, rename, reorder or remove stages (Edit stages)', `change stages (${rolesWith('stage.edit').join(' or ')})`);
    put(flags.approveGate, 'approve stage gates', `approve stage gates (${rolesWith('stage.gate.approve').join(', ')})`);
    put(flags.addActivity, 'add or edit activities here (Edit activities)', auth.code === 'LEAD'
      ? 'add or edit activities outside the stages you lead'
      : `add or edit activities (${rolesWith('activity.edit').join(', ')})`);
    if (scope.activity || scope.task) put(flags.addTask, 'add tasks to this activity (Add task)', 'add tasks to this activity');
    if (scope.task) {
      if (flags.editTask) can.push(`edit this task: ${flags.taskFields.join(', ')}`);
      else cannot.push(flags.ownTasksOnly ? 'edit this task (you can only update status/notes on tasks assigned to you)' : 'edit this task');
    } else if (flags.ownTasksOnly) {
      can.push('update status, % complete and notes on tasks assigned to you');
      cannot.push('change titles, dates, assignees or other people\'s tasks');
    } else {
      put(flags.editTask, 'edit tasks', 'edit tasks');
    }
    put(flags.notes, 'add quick notes', 'add notes');
  } else {
    put(flags.createProject, 'create new projects (New project)', `create projects (${rolesWith('project.create').join(', ')})`);
  }
  put(flags.aiSuggest, 'use AI suggestions in edit panels', 'use AI suggestions in edit panels');
  if (flags.approveKnowledge) can.push('approve close-out learnings in the Knowledge hub');
  if (flags.audit) can.push('see the audit log');
  if (flags.admin) can.push('use the Data admin page');
  if (projectClosed) cannot.push('make changes - this project is closed (read-only)');
  return { role: ROLE_NAME[auth.code], can: can.filter(Boolean), cannot: cannot.filter(Boolean), flags };
}

/** Text block for prompts. */
export function permissionsBlock(c: Capabilities): string {
  return [`The user is a ${c.role}.`, `On this screen they CAN: ${c.can.join('; ') || '-'}.`, `They CANNOT: ${c.cannot.join('; ') || '-'}.`].join('\n');
}

// ---------------------------------------------------------------- deterministic guardrails

const ASK_PERMISSION = /\b(can i|could i|am i (allowed|able|permitted)|may i|do i have (access|permission|rights?)|is it possible for me|how (do|can) i|let me|am i supposed)\b|\b(kya (main|mai|me|mein) .*(kar|dekh) (sakta|sakti|sakte))\b|(क्या मैं|मैं .*(कर|देख) सकत)/i;
const IMPERATIVE = /^\s*(please\s+|pls\s+|kindly\s+)?(close|approve|delete|remove|edit|update|change|assign|reassign|create|add|mark|move|rename|reopen|archive|set)\b/i;
const WHAT_CAN_I = /\b(what can i (do|update|change|edit)|what am i allowed|my (permissions|access|rights)|what (are|is) my (role|access))\b|\b(main kya kar sakta|mera access)\b|(मैं क्या कर सकत|मेरी अनुमति)/i;

type ActionKey = 'close' | 'gate' | 'stage' | 'activity' | 'addTask' | 'editTask' | 'delete' | 'finance' | 'contacts' | 'knowledge' | 'audit' | 'admin' | 'createProject' | 'editProject' | 'notes';

function detectAction(m: string): ActionKey | null {
  if (/\bclose\b.*\b(project|deal|this|it)\b|\bclose[- ]?out\b|प्रोजेक्ट बंद/i.test(m)) return 'close';
  if (/\bgate\b|गेट/i.test(m)) return 'gate';
  if (/\b(fee|fees|budget|billing|billed|finance|financials?|cost|costs|funding gap|margin|revenue|tsa cost|run-?rate)\b|फीस|बजट|लागत|खर्च/i.test(m)) return 'finance';
  if (/\b(phone|mobile|number|email address|contact details?|contacts)\b|फ़ोन|फोन|नंबर/i.test(m)) return 'contacts';
  if (/\b(approve|review)\b.*\b(knowledge|learning|lessons?)\b|knowledge hub/i.test(m)) return 'knowledge';
  if (/\baudit\b/i.test(m)) return 'audit';
  if (/\b(export|oracle|google sheet|data admin|database)\b/i.test(m)) return 'admin';
  if (/\b(new|create)\b.*\bproject\b/i.test(m)) return 'createProject';
  if (/\b(delete|remove)\b/i.test(m)) return 'delete';
  if (/\b(add|create|new)\b.*\btask\b/i.test(m)) return 'addTask';
  if (/\b(add|create|new|edit|rename|reorder)\b.*\bstages?\b/i.test(m)) return 'stage';
  if (/\b(add|create|new|edit|rename|reorder)\b.*\bactivit(y|ies)\b/i.test(m)) return 'activity';
  if (/\b(edit|update|change|mark|move|set|assign|reassign)\b.*\b(task|status|progress|due date|assignee|title|priority|done|complete)\b|\b(task|status)\b.*\b(edit|update|change)\b/i.test(m)) return 'editTask';
  if (/\b(edit|update|change)\b.*\bproject\b/i.test(m)) return 'editProject';
  if (/\b(note|notes)\b/i.test(m)) return 'notes';
  return null;
}

function teamFor(data: ScopedData, project?: Project): string {
  if (!project) return '';
  const p = data.users.get(project.partner_user_id ?? '')?.full_name;
  const m = data.users.get(project.manager_user_id ?? '')?.full_name;
  return [p && `${p} (Partner)`, m && `${m} (Manager)`].filter(Boolean).join(' or ');
}

/** Remove quoted text and the names of the records on screen, so "pending on 'Capture one-time cost'" is not a finance question. */
export function stripEntityNames(message: string, data: ScopedData): string {
  // quoted names only when the quote opens after a space/start (so "What's ... it's" is not treated as a quote)
  let m = message.replace(/(^|\s)["'‘“]([^"'’”\n]{2,160})["'’”](?=\s|[?.!,:;]|$)/g, '$1 ');
  const names = [data.scope.task?.title, data.scope.activity?.name, data.scope.stage?.name, ...data.activities.map((a) => a.name), ...data.tasks.slice(0, 300).map((x) => x.title)]
    .filter((x): x is string => !!x && x.length >= 6).sort((a, b) => b.length - a.length);
  for (const n of names) {
    const i = m.toLowerCase().indexOf(n.toLowerCase());
    if (i >= 0) m = m.slice(0, i) + ' ' + m.slice(i + n.length);
  }
  return m;
}

/** "Can I ...?" / "please do X" / "show me the fees" (not allowed) -> exact answer from the permission model. */
export function permissionAnswer(message: string, cap: Capabilities, data: ScopedData, lang: Lang): string | null {
  const m = stripEntityNames(message, data).trim();
  const asks = ASK_PERMISSION.test(m);
  const imperative = IMPERATIVE.test(m);
  const f = cap.flags;
  const project = data.scope.project;
  const who = teamFor(data, project);
  const yes = (en: string, hi: string) => `**${t(lang, 'Yes', 'हाँ')}** - ${t(lang, en, hi)}`;
  const no = (en: string, hi: string) => `**${t(lang, 'No', 'नहीं')}** - ${t(lang, en, hi)}`;
  const noWrites = imperative ? t(lang, "I can't make changes myself - you stay in control. ", 'मैं खुद बदलाव नहीं करता - नियंत्रण आपके पास है। ') : '';

  if (WHAT_CAN_I.test(m)) {
    return [
      t(lang, `As **${cap.role}**, here is what you can do on this screen:`, `**${cap.role}** के रूप में आप इस स्क्रीन पर ये कर सकते हैं:`),
      ...cap.can.map((c) => `- ${c}`),
      cap.cannot.length ? t(lang, 'Not available to your role here:', 'आपकी भूमिका के लिए यहाँ उपलब्ध नहीं:') : '',
      ...cap.cannot.map((c) => `- ${c}`),
    ].filter(Boolean).join('\n');
  }

  const action = detectAction(m);
  // Data requests the role may not see are answered here too (not only "can I" questions).
  if (action === 'finance' && !f.finance && /\b(show|see|view|what|how much|tell|give|list|fees?|budget)\b|बताओ|दिखाओ|कितना/i.test(m)) {
    const canAsk = project && !/client/i.test(cap.role) && /analyst|lead|manager/i.test(cap.role);
    return no(`your role (${cap.role}) cannot see fees, budgets, TSA costs or funding gaps, so I can't share them. ${rolesWith('finance.view').join(', ')} can${who ? ` - for this project ask ${who}` : ''}.${canAsk ? ' If you need it for your work, use **Access** on the project page to request time-bound finance access; a Partner or Manager and then Risk & Quality must approve it.' : ''}`,
      `आपकी भूमिका (${cap.role}) फीस, बजट, TSA लागत या फंडिंग गैप नहीं देख सकती, इसलिए मैं ये नहीं बता सकता। ${rolesWith('finance.view').join(', ')} देख सकते हैं${who ? ` - इस प्रोजेक्ट के लिए ${who} से पूछें` : ''}।${canAsk ? ' काम के लिए ज़रूरी हो तो प्रोजेक्ट पेज पर **Access** से सीमित समय की फाइनेंस एक्सेस माँगें; पहले पार्टनर या मैनेजर और फिर Risk & Quality इसे मंज़ूर करेंगे।' : ''}`);
  }
  if (action === 'contacts' && !f.contactsVisible && /\b(phone|number|email|contact|call)\b|फ़ोन|फोन|नंबर/i.test(m)) {
    return no(`contact details and phone numbers are not shared in the client view. Please reach your PwC engagement manager${who ? ` (${who})` : ''} through your usual channel.`,
      `क्लाइंट व्यू में संपर्क विवरण और फ़ोन नंबर साझा नहीं होते। कृपया अपने PwC एंगेजमेंट मैनेजर${who ? ` (${who})` : ''} से संपर्क करें।`);
  }
  if (!asks && !imperative) return null;
  if (!action) return null;

  const closed = f.projectClosed ? t(lang, ' This project is closed, so it is read-only for everyone.', ' यह प्रोजेक्ट बंद है, इसलिए सभी के लिए केवल पढ़ने योग्य है।') : '';
  const out = (ok: boolean, yesEn: string, yesHi: string, noEn: string, noHi: string) => noWrites + (ok ? yes(yesEn, yesHi) : no(noEn + closed, noHi + closed));

  switch (action) {
    case 'close':
      return out(f.closeProject,
        `as ${cap.role} you can close ${project?.code_name ?? 'this project'}. Use **Close project** at the top of the project page; it walks you through consent, redaction and the knowledge review.`,
        `${cap.role} के रूप में आप ${project?.code_name ?? 'यह प्रोजेक्ट'} बंद कर सकते हैं। प्रोजेक्ट पेज पर ऊपर **Close project** इस्तेमाल करें।`,
        `your role (${cap.role}) cannot close projects. ${rolesWith('project.close').join(' or ')} on the project can${who ? ` - here: ${who}` : ''}.`,
        `आपकी भूमिका (${cap.role}) प्रोजेक्ट बंद नहीं कर सकती। प्रोजेक्ट के ${rolesWith('project.close').join(' या ')} कर सकते हैं${who ? ` - यहाँ: ${who}` : ''}।`);
    case 'gate':
      return out(f.approveGate,
        'you can approve stage gates. Open the stage and use **Approve gate** in the gate strip once the criteria are met.',
        'आप स्टेज गेट मंज़ूर कर सकते हैं। स्टेज खोलें और गेट पट्टी में **Approve gate** दबाएँ।',
        `your role (${cap.role}) cannot approve gates. ${rolesWith('stage.gate.approve').join(', ')} can${who ? ` (${who})` : ''}. ${f.editStages ? 'You can use **Request approval**.' : ''}`,
        `आपकी भूमिका (${cap.role}) गेट मंज़ूर नहीं कर सकती। ${rolesWith('stage.gate.approve').join(', ')} कर सकते हैं।`);
    case 'stage':
      return out(f.editStages,
        'you can change stages with **Edit stages** next to the stage tabs (add, rename, reorder, remove).',
        'आप स्टेज टैब के पास **Edit stages** से चरण बदल सकते हैं।',
        `your role (${cap.role}) cannot change stages. ${rolesWith('stage.edit').join(' or ')} can${who ? ` (${who})` : ''}.`,
        `आपकी भूमिका (${cap.role}) चरण नहीं बदल सकती। ${rolesWith('stage.edit').join(' या ')} बदल सकते हैं।`);
    case 'activity':
      return out(f.addActivity || f.editActivity,
        'you can add or edit activities with **Edit activities** at the end of the activity bar.',
        'आप गतिविधि पट्टी के अंत में **Edit activities** से गतिविधियाँ जोड़/बदल सकते हैं।',
        cap.role === ROLE_NAME.LEAD ? 'as Workstream Lead you can only add or edit activities in the stages you lead, and this is not one of them.' : `your role (${cap.role}) cannot add or edit activities. ${rolesWith('activity.edit').join(', ')} can.`,
        cap.role === ROLE_NAME.LEAD ? 'वर्कस्ट्रीम लीड के रूप में आप केवल अपने चरणों में गतिविधियाँ बदल सकते हैं।' : `आपकी भूमिका (${cap.role}) गतिविधियाँ नहीं बदल सकती।`);
    case 'addTask':
      return out(f.addTask,
        'you can add tasks with **Add task** above the task list (or the quick-add row).',
        'आप टास्क सूची के ऊपर **Add task** से टास्क जोड़ सकते हैं।',
        f.ownTasksOnly ? `your role (${cap.role}) can update tasks assigned to you, but cannot add tasks. Ask the activity owner or the manager${who ? ` (${who})` : ''}.` : `you cannot add tasks to this activity.`,
        f.ownTasksOnly ? `आपकी भूमिका (${cap.role}) अपने टास्क अपडेट कर सकती है, पर नए टास्क नहीं जोड़ सकती।` : 'आप इस गतिविधि में टास्क नहीं जोड़ सकते।');
    case 'editTask': {
      if (data.scope.task) {
        const assignee = userName(data.users, data.scope.task.assignee_user_id);
        return out(f.editTask,
          `you can edit "${data.scope.task.title}": ${readableFields(f.taskFields)}. Change them in the task panel and press **Save changes**.`,
          `आप "${data.scope.task.title}" में ये बदल सकते हैं: ${readableFields(f.taskFields)}। टास्क पैनल में बदलें और **Save changes** दबाएँ।`,
          f.ownTasksOnly ? `this task is assigned to ${assignee}; as ${cap.role} you can only update status, % complete and notes on tasks assigned to you.` : `your role (${cap.role}) cannot edit this task.`,
          f.ownTasksOnly ? `यह टास्क ${assignee} के पास है; ${cap.role} के रूप में आप केवल अपने टास्क की स्थिति और नोट्स बदल सकते हैं।` : `आपकी भूमिका (${cap.role}) यह टास्क नहीं बदल सकती।`);
      }
      return out(f.editTask,
        f.ownTasksOnly ? 'you can update status, % complete and notes on tasks assigned to you (open the task, or use the status dropdown in the table). Other fields and other people\'s tasks are read-only for your role.' : 'you can edit tasks here - open a task row, or change status inline in the table / drag it on the Board.',
        f.ownTasksOnly ? 'आप अपने टास्क की स्थिति, % और नोट्स बदल सकते हैं।' : 'आप यहाँ टास्क बदल सकते हैं - टास्क खोलें या टेबल में स्थिति बदलें।',
        `your role (${cap.role}) cannot edit tasks.`, `आपकी भूमिका (${cap.role}) टास्क नहीं बदल सकती।`);
    }
    case 'delete':
      return out(!!data.scope.task ? f.taskFields.includes('title') : f.editStages || f.addActivity,
        'you can delete items you are allowed to edit from their edit panel (deletes are soft: history is kept in the audit log).',
        'आप जिन चीज़ों को बदल सकते हैं उन्हें उनके एडिट पैनल से हटा सकते हैं।',
        `your role (${cap.role}) cannot delete this.`, `आपकी भूमिका (${cap.role}) इसे हटा नहीं सकती।`);
    case 'finance':
      return out(f.finance, 'you can see finance - use **Finance** on the project page, or ask me about fees, TSA run-rate or the funding gap.',
        'आप वित्त देख सकते हैं - प्रोजेक्ट पेज पर **Finance** खोलें।',
        `your role (${cap.role}) cannot see finance. ${rolesWith('finance.view').join(', ')} can.`, `आपकी भूमिका (${cap.role}) वित्त नहीं देख सकती।`);
    case 'contacts':
      return out(f.contactsFull, 'you can see full contact details in the Contacts section of the right panel.',
        'आप दाएँ पैनल में पूरे संपर्क विवरण देख सकते हैं।',
        f.contactsVisible ? `contacts are visible to you but phone numbers and emails are masked for your role (${cap.role}).` : 'contact details are not shared in the client view.',
        f.contactsVisible ? `आपकी भूमिका के लिए फ़ोन/ईमेल छिपे हुए हैं।` : 'क्लाइंट व्यू में संपर्क विवरण साझा नहीं होते।');
    case 'knowledge':
      return out(f.approveKnowledge, 'you can approve learnings in the **Knowledge hub** (Pending Review items).', 'आप **Knowledge hub** में सीख मंज़ूर कर सकते हैं।',
        `only ${rolesWith('knowledge.edit').concat(rolesWith('closeout.approve')).filter((v, i, a) => a.indexOf(v) === i).join(' or ')} can approve knowledge items.`, 'केवल नॉलेज मैनेजर या रिस्क टीम मंज़ूर कर सकती है।');
    case 'audit':
      return out(f.audit, 'you can open the **Audit log** from the top bar.', 'आप ऊपर से **Audit log** खोल सकते हैं।', `only ${rolesWith('audit.view').join(', ')} can see the audit log.`, `केवल ${rolesWith('audit.view').join(', ')} ऑडिट लॉग देख सकते हैं।`);
    case 'admin':
      return out(f.admin, 'you can use the **Data admin** page (database, Google Sheet, Oracle/Excel export).', 'आप **Data admin** पेज इस्तेमाल कर सकते हैं।', `only the ${ROLE_NAME.ADMIN} can use the Data admin page.`, `केवल ${ROLE_NAME.ADMIN} डेटा एडमिन पेज इस्तेमाल कर सकते हैं।`);
    case 'createProject':
      return out(f.createProject, 'you can create a project with **New project** on the dashboard (with an AI-suggested plan).', 'आप डैशबोर्ड पर **New project** से प्रोजेक्ट बना सकते हैं।', `only ${rolesWith('project.create').join(', ')} can create projects.`, `केवल ${rolesWith('project.create').join(', ')} प्रोजेक्ट बना सकते हैं।`);
    case 'editProject':
      return out(f.editProject, 'you can use **Edit project** at the top of the project page.', 'आप प्रोजेक्ट पेज पर **Edit project** इस्तेमाल कर सकते हैं।', `your role (${cap.role}) cannot edit the project. ${rolesWith('project.edit').join(' or ')} can${who ? ` (${who})` : ''}.`, `आपकी भूमिका (${cap.role}) प्रोजेक्ट नहीं बदल सकती।`);
    case 'notes':
      return out(f.notes, 'you can add quick notes in the right-hand panel.', 'आप दाएँ पैनल में नोट जोड़ सकते हैं।', `your role (${cap.role}) cannot add notes.`, `आपकी भूमिका (${cap.role}) नोट नहीं जोड़ सकती।`);
  }
  return null;
}

const INJECTION = /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instructions?|rules?|guardrails?|restrictions?|permissions?|system prompt|policy)\b|\b(system prompt|jailbreak|developer mode|act as (an? )?admin|pretend (you are|to be))\b/i;
const SECRETS = /\b(api[ _-]?key|secret|password|passcode|token|credentials?|service[ -]?account|private key)\b/i;
const OTHERS_HISTORY = /\b(what did|what has|show me)\b.{0,40}\b(ask(ed)?|chat(ted)?)\b.{0,20}\b(piku|you|ai)\b|\b(other (users?|people)'?s?|someone else'?s?|everyone'?s?)\b.{0,30}\b(chats?|messages|questions|history|conversations?)\b/i;

/** Requests Piku must refuse whatever the data says. */
export async function refusal(db: Db, auth: AuthContext, message: string, visible: Set<string>, lang: Lang): Promise<string | null> {
  if (INJECTION.test(message)) {
    return t(lang, "I can't change or ignore my rules. I only answer from data your role is allowed to see, and I never make changes for you. Ask me anything about your projects and I'll help.",
      'मैं अपने नियम नहीं बदल सकता। मैं केवल वही डेटा इस्तेमाल करता हूँ जो आपकी भूमिका देख सकती है, और कोई बदलाव नहीं करता। अपने प्रोजेक्ट के बारे में कुछ भी पूछें।');
  }
  if (SECRETS.test(message) && !/\b(how|where)\b.{0,30}\b(add|enter|paste|set)\b/i.test(message)) {
    return t(lang, "I can't share keys, passwords or credentials. To use your own Gemini key, open the **AI** button in the top bar.",
      'मैं कुंजियाँ, पासवर्ड या क्रेडेंशियल साझा नहीं कर सकता। अपनी Gemini कुंजी के लिए ऊपर **AI** बटन खोलें।');
  }
  if (OTHERS_HISTORY.test(message)) {
    return t(lang, 'Conversations with me are private to each person, so I cannot show what other people asked.',
      'मेरे साथ हर व्यक्ति की बातचीत निजी है, इसलिए मैं दूसरों के सवाल नहीं दिखा सकता।');
  }
  // A project mentioned by name that the user is not staffed on: refuse without revealing anything about it.
  const all = await db.all<Project>('projects');
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hidden = all.find((p) => {
    if (visible.has(p.project_id)) return false;
    const name = (p.code_name || '').replace(/^project\s+/i, '').trim();
    if (name.length < 3) return false;
    // "project delta" (any case) or a capitalised "Delta" - so ordinary words like "delta" or "horizon" don't trigger it
    return new RegExp(`\\bproject\\s+${esc(name)}\\b`, 'i').test(message) || new RegExp(`\\b${esc(name)}\\b`).test(message);
  });
  if (hidden) {
    return t(lang, `I can only answer about projects you are staffed on, so I can't share anything about "${hidden.code_name}". If you need access, ask the engagement partner or manager.`,
      `मैं केवल उन्हीं प्रोजेक्ट के बारे में बता सकता हूँ जिन पर आप हैं, इसलिए "${hidden.code_name}" के बारे में कुछ नहीं बता सकता। एक्सेस के लिए एंगेजमेंट पार्टनर या मैनेजर से पूछें।`);
  }
  return null;
}

const FIELD_LABELS: Record<string, string> = {
  status: 'status', percent_complete: '% complete', done_notes: 'what has happened', pending_notes: 'what is pending',
  dependency_notes: 'what it is waiting on', title: 'title', description: 'description', assignee_user_id: 'assignee',
  priority: 'priority', due_date: 'due date', start_date: 'start date', effort_hours: 'effort', day1_critical: 'Day-1 flag',
};
function readableFields(fields: string[]): string {
  return fields.map((f) => FIELD_LABELS[f] ?? f.replace(/_/g, ' ')).join(', ');
}
