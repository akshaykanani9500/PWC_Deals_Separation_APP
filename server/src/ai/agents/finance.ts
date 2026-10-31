/** Finance agent: fees, TSA run-rate, one-time cost, funding gap, TSA services. Needs finance.view for money. */
import { can, hrefFor, loadTsa } from '../data';
import { fmtDate, fmtMoney, t, todayIso } from '../lang';
import type { AgentInput, AgentOutput } from './types';
import { emptyOutput } from './types';

export async function financeAgent(input: AgentInput): Promise<AgentOutput> {
  const { db, auth, data, lang, intents } = input;
  const out = emptyOutput('finance');
  const money = can(auth, 'finance.view') && auth.code !== 'CLIENT';
  const wantsFinance = intents.includes('finance');
  const wantsTsa = intents.includes('tsa');

  if (wantsFinance) {
    if (!money) {
      out.lines.push(t(lang,
        'Finance details are not available for your role. Please ask the engagement partner or manager.',
        'आपकी भूमिका के लिए वित्तीय जानकारी उपलब्ध नहीं है। कृपया एंगेजमेंट पार्टनर या मैनेजर से पूछें।'));
      out.facts.push('The user is not allowed to see finance data. Do not mention any amounts.');
    } else {
      const projects = data.projects.filter((p) => p.status !== 'Closed' || data.scope.type !== 'global');
      const sum = (k: 'fee_budget' | 'fee_billed' | 'tsa_monthly_cost' | 'one_time_cost' | 'funding_gap') =>
        projects.reduce((s, p) => s + Number((p as any)[k] ?? 0), 0);
      const cur = projects[0]?.currency || 'USD';
      if (data.scope.type === 'global') {
        out.lines.push(t(lang,
          `Across ${projects.length} project(s): fee budget ${fmtMoney(sum('fee_budget'), cur)}, billed ${fmtMoney(sum('fee_billed'), cur)}; client TSA run-rate ${fmtMoney(sum('tsa_monthly_cost'), cur)}/month; open funding gaps ${fmtMoney(sum('funding_gap'), cur)}.`,
          `${projects.length} प्रोजेक्ट में कुल: फीस बजट ${fmtMoney(sum('fee_budget'), cur)}, बिल किया ${fmtMoney(sum('fee_billed'), cur)}; क्लाइंट TSA खर्च ${fmtMoney(sum('tsa_monthly_cost'), cur)}/माह; फंडिंग गैप ${fmtMoney(sum('funding_gap'), cur)}।`));
        out.facts.push(`Portfolio finance: fee budget ${sum('fee_budget')}, billed ${sum('fee_billed')}, TSA monthly ${sum('tsa_monthly_cost')}, funding gap ${sum('funding_gap')} (${cur}).`);
        const top = [...projects].sort((a, b) => Number(b.funding_gap ?? 0) - Number(a.funding_gap ?? 0)).filter((p) => Number(p.funding_gap ?? 0) > 0).slice(0, 4);
        for (const p of top) out.lines.push(`- ${p.code_name}: ${t(lang, 'funding gap', 'फंडिंग गैप')} ${fmtMoney(p.funding_gap, p.currency)}`);
      } else {
        const p = data.projects[0];
        if (p) {
          const burn = p.fee_budget ? Math.round((Number(p.fee_billed ?? 0) / Number(p.fee_budget)) * 100) : 0;
          out.lines.push(t(lang,
            `**${p.code_name}** finance: fee budget ${fmtMoney(p.fee_budget, p.currency)}, billed ${fmtMoney(p.fee_billed, p.currency)} (${burn}% used). Client TSA run-rate ${fmtMoney(p.tsa_monthly_cost, p.currency)}/month, one-time separation cost ${fmtMoney(p.one_time_cost, p.currency)}, open funding gap ${fmtMoney(p.funding_gap, p.currency)}.`,
            `**${p.code_name}** वित्त: फीस बजट ${fmtMoney(p.fee_budget, p.currency)}, बिल किया ${fmtMoney(p.fee_billed, p.currency)} (${burn}% इस्तेमाल)। क्लाइंट TSA खर्च ${fmtMoney(p.tsa_monthly_cost, p.currency)}/माह, एकमुश्त अलगाव लागत ${fmtMoney(p.one_time_cost, p.currency)}, फंडिंग गैप ${fmtMoney(p.funding_gap, p.currency)}।`));
          out.facts.push(`${p.code_name} finance: fee budget ${p.fee_budget}, billed ${p.fee_billed} (${burn}% used), TSA monthly ${p.tsa_monthly_cost}, one-time cost ${p.one_time_cost}, funding gap ${p.funding_gap} ${p.currency}.`);
          out.sources.push({ type: 'project', id: p.project_id, label: `${p.code_name} finance`, href: hrefFor('project', { projectId: p.project_id }) });
        }
      }
    }
  }

  if (wantsTsa) {
    if (auth.code === 'CLIENT') {
      out.lines.push(t(lang, 'TSA commercial details are not shared in the client view.', 'क्लाइंट व्यू में TSA की व्यावसायिक जानकारी साझा नहीं की जाती।'));
    } else {
      const services = (await loadTsa(db, data.scope)).filter((s) => s.status !== 'Exited');
      const today = todayIso();
      if (!services.length) {
        out.lines.push(t(lang, 'No active TSA services are recorded here.', 'यहाँ कोई सक्रिय TSA सेवा दर्ज नहीं है।'));
      } else {
        const total = services.reduce((s, x) => s + Number(x.monthly_fee ?? 0), 0);
        out.lines.push(money
          ? t(lang, `${services.length} active TSA service(s), ${fmtMoney(total)}/month in total:`, `${services.length} सक्रिय TSA सेवाएँ, कुल ${fmtMoney(total)}/माह:`)
          : t(lang, `${services.length} active TSA service(s):`, `${services.length} सक्रिय TSA सेवाएँ:`));
        for (const p of data.projects.filter((p) => services.some((x) => x.project_id === p.project_id)).slice(0, 3)) {
          out.sources.push({ type: 'project', id: p.project_id, label: `${p.code_name} TSA`, href: hrefFor('project', { projectId: p.project_id }) });
        }
        const sorted = [...services].sort((a, b) => (a.planned_exit_date || '').localeCompare(b.planned_exit_date || ''));
        for (const s of sorted.slice(0, 8)) {
          const days = s.planned_exit_date ? Math.round((Date.parse(s.planned_exit_date) - Date.parse(today)) / 864e5) : null;
          const ext3 = Number(s.monthly_fee ?? 0) * (1 + Number(s.extension_uplift_pct ?? 20) / 100) * 3;
          const line = `${s.name} (${s.provider ?? '-'}): ${t(lang, 'exit', 'निकास')} ${fmtDate(s.planned_exit_date)}${days !== null ? ` (${days >= 0 ? `${days} ${t(lang, 'days', 'दिन')}` : t(lang, 'past date', 'तारीख निकल चुकी')})` : ''}, ${s.status}${money ? `, ${fmtMoney(s.monthly_fee)}/${t(lang, 'mo', 'माह')}; ${t(lang, '3-month extension would cost', '3 माह विस्तार की लागत')} ~${fmtMoney(ext3)}` : ''}`;
          out.lines.push(`- ${line}`);
          out.facts.push(`TSA service ${s.name}: provider ${s.provider}, exit ${s.planned_exit_date}, status ${s.status}${money ? `, monthly fee ${s.monthly_fee}, uplift ${s.extension_uplift_pct}%` : ''}`);
        }
      }
    }
  }
  return out;
}
