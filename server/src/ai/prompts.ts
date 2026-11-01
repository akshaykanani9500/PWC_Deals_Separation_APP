/**
 * Screen-specific Piku prompts (starter chips and follow-ups). They name the record on screen and use its
 * real data (e.g. the blocked task), and respect the persona (no finance prompts without finance.view,
 * no email drafts for the client view, "What can I update here?" for analysts).
 */
import type { AuthContext } from '../auth-types';
import type { Lang, Task } from '../../../shared/types';
import { isOverdue, userName, type ScopedData } from './data';
import { t } from './lang';
import type { Capabilities } from './guardrails';

export interface PromptChip { label: string; prompt: string }

const short = (s: string, n = 42) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function screenPrompts(auth: AuthContext, data: ScopedData, cap: Capabilities, lang: Lang): PromptChip[] {
  const { scope } = data;
  const out: PromptChip[] = [];
  const add = (en: string, hi: string) => { const p = t(lang, en, hi); if (!out.some((x) => x.prompt === p)) out.push({ label: p, prompt: p }); };
  const open = data.tasks.filter((x) => x.status !== 'Done');
  const blocked = open.filter((x) => x.status === 'Blocked');
  const late = open.filter(isOverdue).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  const next = open.filter((x) => !isOverdue(x) && x.due_date).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  const mine = open.filter((x) => x.assignee_user_id === auth.user.user_id);
  const isClient = auth.code === 'CLIENT';
  const email = !isClient;
  const firstHot: Task | undefined = blocked[0] ?? late[0];

  if (scope.type === 'global') {
    if (isClient) {
      add('How is my project progressing?', 'मेरा प्रोजेक्ट कैसा चल रहा है?');
      add('What is due in the next two weeks?', 'अगले दो हफ़्तों में क्या होना है?');
      add('What are the biggest risks on my project?', 'मेरे प्रोजेक्ट के सबसे बड़े जोखिम क्या हैं?');
      return out;
    }
    add('Which of my projects need attention and why?', 'मेरे किन प्रोजेक्ट पर ध्यान देना है और क्यों?');
    if (mine.length || cap.flags.ownTasksOnly) add('What are my open tasks and what is due first?', 'मेरे खुले टास्क क्या हैं और पहले क्या करना है?');
    add('What is overdue across my projects?', 'मेरे सभी प्रोजेक्ट में क्या देरी में है?');
    if (cap.flags.finance) add('What is the total client TSA run-rate and funding gap?', 'कुल TSA खर्च और फंडिंग गैप कितना है?');
    if (auth.code === 'KM') add('What lessons did we learn from past TSA exits?', 'पिछले TSA exit से क्या सीखा?');
    return out.slice(0, 4);
  }

  const code = scope.project?.code_name ?? '';
  if (scope.type === 'project') {
    add(`What is blocking ${code} right now?`, `${code} में अभी क्या रुका हुआ है?`);
    add(`What is due next on ${code}?`, `${code} में आगे क्या होना है?`);
    if (!isClient) add(`Summarise ${code} for the partner`, `पार्टनर के लिए ${code} का सारांश दो`);
    else add(`Summarise ${code} for me`, `${code} का सारांश दो`);
    if (cap.flags.finance) add(`How is the ${code} fee budget tracking?`, `${code} का फीस बजट कैसा चल रहा है?`);
    if (cap.flags.ownTasksOnly) add(`What are my tasks on ${code}?`, `${code} में मेरे टास्क क्या हैं?`);
    return out.slice(0, 4);
  }

  if (scope.type === 'stage' && scope.stage) {
    const s = scope.stage.name;
    add(`How is ${s} going across its activities?`, `${s} की सभी गतिविधियाँ कैसी चल रही हैं?`);
    add(`Which activity in ${s} is furthest behind?`, `${s} में कौन सी गतिविधि सबसे पीछे है?`);
    if (cap.flags.ownTasksOnly) add('What can I update here?', 'मैं यहाँ क्या अपडेट कर सकता हूँ?');
    add(`What is needed to pass the ${s} gate?`, `${s} गेट पार करने के लिए क्या चाहिए?`);
    if (firstHot) add(`Who should I chase in ${s}?`, `${s} में किससे फ़ॉलो-अप करूँ?`);
    return out.slice(0, 4);
  }

  if (scope.type === 'activity' && scope.activity) {
    // On its own screen the activity is "this activity" - no truncated names in the chips.
    const full = scope.activity.name;
    const a = full.length <= 34 ? full : t(lang, 'this activity', 'इस गतिविधि');
    if (blocked[0]) add(`Why is '${short(blocked[0].title, 36)}' blocked and who owns it?`, `'${short(blocked[0].title, 36)}' क्यों रुका है और किसके पास है?`);
    else if (late[0]) add(`Why is '${short(late[0].title, 36)}' late and who owns it?`, `'${short(late[0].title, 36)}' देरी में क्यों है और किसके पास है?`);
    add(`Summarise ${a}`, `${a === 'इस गतिविधि' ? 'इस गतिविधि' : a} का सारांश दो`);
    if (cap.flags.ownTasksOnly) add('What can I update here?', 'मैं यहाँ क्या अपडेट कर सकता हूँ?');
    add(`What is due next in ${a}?`, `${a} में आगे क्या होना है?`);
    add(`What are the biggest risks in ${a}?`, `${a} में सबसे बड़े जोखिम क्या हैं?`);
    if (!cap.flags.ownTasksOnly && email) add('Draft a status email for this activity', 'इस गतिविधि का स्टेटस ईमेल ड्राफ्ट करो');
    return out.slice(0, 4);
  }

  if (scope.type === 'task' && scope.task) {
    const x = scope.task;
    const title = short(x.title, 36);
    add(`What is pending on '${title}'?`, `'${title}' में क्या बाकी है?`);
    if (x.dependency_notes || x.status === 'Blocked') add(`What is '${title}' waiting on?`, `'${title}' किस पर निर्भर है?`);
    add(`What has already happened on '${title}'?`, `'${title}' में अब तक क्या हुआ?`);
    if (cap.flags.ownTasksOnly) add('What can I update on this task?', 'मैं इस टास्क में क्या बदल सकता हूँ?');
    else if (email) add(`Draft a follow-up email to ${userName(data.users, x.assignee_user_id).split(' ')[0]}`, `${userName(data.users, x.assignee_user_id).split(' ')[0]} को फ़ॉलो-अप ईमेल लिखो`);
    return out.slice(0, 4);
  }
  return out;
}

/** Follow-ups after an answer: the screen prompts minus what was just asked. */
export function followUpPrompts(auth: AuthContext, data: ScopedData, cap: Capabilities, lang: Lang, asked: string): PromptChip[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]/g, '').trim();
  const a = norm(asked);
  return screenPrompts(auth, data, cap, lang).filter((p) => norm(p.prompt) !== a && !(a.length > 12 && norm(p.prompt).includes(a))).slice(0, 3);
}
