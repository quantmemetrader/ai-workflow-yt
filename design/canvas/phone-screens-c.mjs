/**
 * Phone views, batch C: Human Resources, Admin.
 * Writes <Desktop>-Phone.dc.html files and phones-c.json.
 * Run: node phone-screens-c.mjs
 */
import fs from 'fs';
import path from 'path';
import { P, docIcon, folderIcon, BRAND, px, SPRITE } from './shell.mjs';
import { phonePage, row, sec, kpis, bd, dot, pbar, btns, fld, chev, tick, warn, cbx, pav, ini } from './phone-shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const out = [];
const add = (file, mod, title, o) => { fs.writeFileSync(path.join(DIR, file), phonePage({ module: mod, gen: 'phone-screens-c.mjs', title, me: 'michelle', ...o })); out.push({ file, mod, title }); };
const sheet = (scope, q, tool, a, act, chips = []) => ({ scope, q, tool, a, act, chips });
const sw = on => `<div style="width: 44px; height: 26px; border-radius: 13px; padding: 3px; background: ${on ? '#171717' : '#e2e2e2'}; display: flex; justify-content: ${on ? 'flex-end' : 'flex-start'}; flex-shrink: 0;"><div style="width: 20px; height: 20px; border-radius: 10px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2);"></div></div>`;

/* =================================================================== */
/* HUMAN RESOURCES                                                     */
/* =================================================================== */
const HCH = ['Overview', 'Leave <b>2</b>', 'Hiring', 'Candidates', 'People'];
const hr = { tabLabel: 'HR', crumb: 'Human Resources · private' };
add('Hr-Gate-Phone.dc.html', 'hr', 'Overview', {
  ...hr, heading: 'This week', sub: 'You have HR access', chips: HCH, chipOn: 0,
  body: `<div style="padding-top: 14px;">${kpis([['Leave', '2', 'waiting for you'], ['Hiring', '3', 'interviews on 12 Sep'], ['Candidates', '1', 'consent ends in 22 d'], ['Employees', '2', 'onboarding items open']])}</div>
${sec('Out this week')}
${row({ lead: pav('chan', 36), title: 'Chan Ka-ming', sub: '<span>Annual leave · back Wed 9 Sep</span>', trail: bd('Back', 'grn') })}
${row({ lead: pav('leung', 36), title: 'Leung Chi-hang', sub: '<span>Asked for 14 to 16 Sep</span>', trail: bd('Waiting', 'amb'), sep: '' })}
${sec('Who can see HR')}
      <div class="card" style="margin: 0 16px;">
        <div style="font-size: 14px; line-height: 1.55; color: #525252;">HR holds personal data, so only people an admin gives <b style="font-weight: 500; color: #171717;">HR access</b> can open it. Everyone else sees “HR is private”.</div>
        <div style="display: flex; align-items: center; gap: 10px; margin-top: 12px;">${pav('michelle', 28)}<span style="font-size: 14px; flex-grow: 1;">Michelle Yip</span><span class="cap">since 12 Jan</span></div>
        <div style="display: flex; align-items: center; gap: 10px; margin-top: 10px;">${ini('PC', 28, '#e6f4ff', '#007be0')}<span style="font-size: 14px; flex-grow: 1;">Priscilla Cheung</span><span class="cap">since 9 Sep</span></div>
      </div>`,
  ask: 'Ask about HR…',
  sheet: sheet('HR · you have access', 'Anything to deal with before Friday?', 'Read leave, hiring, records · 0.5 s', 'Amy’s unpaid leave overlaps the Harbourfront shoot on the 22nd, so decide that one first. And one candidate’s consent ends on 2 Oct.', 'Open Amy’s request'),
});
const W = [[31, 1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12, 13], [14, 15, 16, 17, 18, 19, 20], [21, 22, 23, 24, 25, 26, 27], [28, 29, 30, 1, 2, 3, 4]];
const MARK = { '0-1': '#8fc3f1', '0-4': '#8fc3f1', '1-0': '#8fc3f1', '1-1': '#8fc3f1', '2-0': '#f5a524', '2-1': '#f5a524', '2-2': '#f5a524', '3-0': '#f5a524', '3-1': '#f5a524', '3-2': '#f5a524', '3-3': '#f5a524', '3-4': '#f5a524' };
add('Hr-Leave-Phone.dc.html', 'hr', 'Leave', {
  ...hr, heading: 'September 2026', sub: 'Production team', chips: HCH, chipOn: 1,
  body: `
      <div style="margin: 12px 16px 0; border: 1px solid #ededed; border-radius: 16px; padding: 10px 8px 6px;">
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center;" class="cap">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span>${d}</span>`).join('')}</div>
        ${W.map((wk, w) => `<div style="display: grid; grid-template-columns: repeat(7, 1fr); margin-top: 4px;">${wk.map((d, i) => { const out2 = (w === 0 && i === 0) || (w === 4 && i > 2); const today = w === 1 && i === 3; const m = MARK[`${w}-${i}`]; const hol = (w === 3 && i === 5) || (w === 4 && i === 3); return `<div style="height: 40px; display: flex; flex-direction: column; align-items: center; gap: 3px;"><span style="width: 28px; height: 28px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 13.5px; ${today ? 'background: var(--ac); color: #fff; font-weight: 500;' : out2 ? 'color: #c7c7c7;' : hol ? 'color: #e03636;' : ''}">${d}</span>${m ? `<span style="width: 18px; height: 4px; border-radius: 2px; background: ${m};"></span>` : ''}</div>`; }).join('')}</div>`).join('')}
      </div>
      <div style="display: flex; gap: 14px; padding: 8px 16px 0;" class="cap"><span style="display: flex; align-items: center; gap: 5px;"><span style="width: 12px; height: 4px; border-radius: 2px; background: #8fc3f1;"></span>Approved</span><span style="display: flex; align-items: center; gap: 5px;"><span style="width: 12px; height: 4px; border-radius: 2px; background: #f5a524;"></span>Waiting</span><span style="color: #e03636;">Holiday</span></div>
${sec('Waiting for you', '2')}
${[['leung', 'Leung Chi-hang', 'Annual · 14 to 16 Sep · 3 days'], ['amy', 'Amy Wong', 'Unpaid · 21 to 25 Sep · overlaps a shoot']].map(([k, n, s]) => `
      <div style="display: flex; align-items: center; gap: 12px; padding: 10px 16px;">${pav(k, 38)}<div style="min-width: 0; flex-grow: 1;"><div class="nm">${n}</div><div class="sub"><span>${s}</span></div></div><div style="display: flex; gap: 6px;"><div style="width: 38px; height: 38px; border-radius: 12px; border: 1px solid #ededed; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #7c7c7c;">✕</div><div style="width: 38px; height: 38px; border-radius: 12px; background: var(--ac); display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 16 16" style="width: 15px; height: 15px; stroke: #fff; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;"><path d="M3.6 8.3 6.5 11.2 12.4 5.1"/></svg></div></div></div>`).join('')}`,
  ask: 'Apply for leave, or ask…',
  sheet: sheet('Leave · Production', 'Can I approve Leung’s days?', 'Checked cover and balance · 0.3 s', 'Yes. Chan covers edits that week and Leung keeps 9.5 days after this. Nothing else is scheduled.', 'Approve'),
});
add('Hr-Recruit-Phone.dc.html', 'hr', 'Recruitment', {
  ...hr, heading: 'Junior video editor', sub: 'Approved · HK$22k to 26k · 1 opening', chips: HCH, chipOn: 2,
  body: `
      <div style="display: flex; gap: 8px; padding: 14px 16px 4px; overflow: hidden;"><div class="chip">Applied <b>14</b></div><div class="chip">Screening <b>5</b></div><div class="chip on">Interview <b>3</b></div><div class="chip">Offer <b>0</b></div></div>
${[['CW', 'Cheung Wing-yan', 'TVB assistant editor, 3 yrs', 92, 'Sat 12 Sep 14:00'], ['HC', 'Ho Chun-kit', 'Documentary editor, subtitles', 86, 'Sat 12 Sep 16:00'], ['LT', 'Lam Tsz-ho', 'Short-form editor, café chain', 71, 'Not booked']].map(([i2, n, s, sc, t], i) => row({ lead: ini(i2, 40), title: n, sub: `<span>${s}</span>`, trail: `<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 5px;"><span style="font-size: 15px; font-weight: 500; color: var(--ac);">${sc}</span><span class="cap">${t}</span></div>`, sep: i < 2 ? 'i' : '' })).join('')}
      <div class="note" style="margin-top: 12px; background: #f5f5f5; color: #525252; font-size: 13px;">Only applications sent to Aura Farmers. Nothing is pulled from LinkedIn or anywhere else.</div>
${btns('Open job description', '')}`,
  ask: 'Ask about hiring…',
  sheet: sheet('Junior video editor · 3 interviews', 'Who should I meet first?', 'Ranked against the requisition · 0.4 s', 'Cheung Wing-yan: three years at TVB on Premiere and DaVinci, and her reel is all short-form. You decide; the ranking only uses the requisition.', 'Open her application'),
});
add('Hr-Candidates-Phone.dc.html', 'hr', 'Candidate records', {
  ...hr, heading: 'Candidates', sub: 'Kept only as long as they agreed', chips: HCH, chipOn: 3,
  body: `<div style="padding-top: 6px;"></div>
${[['CW', 'Cheung Wing-yan', 'Junior editor · until 28 Aug 2027', 97, 'In process', 'blue'], ['HC', 'Ho Chun-kit', 'Junior editor · until 26 Aug 2027', 96, 'In process', 'blue'], ['LS', 'Lee Sum-yi', 'Motion designer · until 2 Oct 2026', 6, '22 days left', 'amb'], ['YK', 'Yip Ka-lok', 'Producer · until 19 Jan 2027', 36, 'On file', 'gray'], ['FH', 'Fung Hiu-tung', 'Producer · ended 14 Jul', 0, 'Delete now', 'red']].map(([i2, n, s, p, b, tone], i) => row({ lead: ini(i2, 40), title: n, sub: `<span>${s}</span>`, trail: bd(b, tone), sep: i < 4 ? 'i' : '' })).join('')}
      <div class="note" style="margin-top: 10px; background: #fafafa; color: #525252;">When consent runs out the record is deleted, unless the person agrees to stay on file.</div>`,
  ask: 'Ask about candidates…',
  sheet: sheet('5 candidate records', 'Anyone from before who fits?', 'Searched 5 records · 0.3 s', 'Lee Sum-yi applied for motion designer and has 2 years of Premiere. Her consent ends on 2 Oct; I can draft an email asking to renew it.', 'Draft the email'),
});
add('Hr-Employees-Phone.dc.html', 'hr', 'Employee records', {
  ...hr, heading: 'Amy Wong', sub: 'Researcher · Production · onboarding 4 of 6', chips: HCH, chipOn: 4,
  body: `
      <div style="display: flex; align-items: center; gap: 14px; padding: 16px 16px 4px;">${pav('amy', 56)}<div><div style="font-size: 17px; font-weight: 500;">Amy Wong</div><div class="cap" style="margin-top: 2px;">Reports to Michelle Yip</div></div></div>
      <div style="padding-top: 10px;">${kpis([['Started', '6 Jan 2026'], ['Contract', 'EMP-0011', '', 'var(--ac)'], ['Leave left', '11.5 days'], ['Access', 'Research, Script']])}</div>
${sec('Onboarding', '2 open')}
${[['Laptop and accounts', 1], ['Contract signed', 1], ['House style walkthrough', 1], ['Sign the IP assignment', 0], ['Data privacy training · due 30 Sep', 0]].map(([t, d], i) => row({ lead: cbx(d), title: `<span style="${d ? 'color: #999999; text-decoration: line-through;' : ''}">${t}</span>`, sep: i < 4 ? 'n' : '', style: 'min-height: 50px;' })).join('')}`,
  ask: 'Ask about this person…',
  sheet: sheet('Amy Wong · record', 'What’s left for her onboarding?', 'Read her record · 0.2 s', 'She hasn’t signed the IP assignment, and privacy training is due 30 Sep. I can remind her in Chat.', 'Send a reminder'),
});

/* =================================================================== */
/* ADMIN                                                               */
/* =================================================================== */
const ACH = ['People', 'Access', 'Tokens', 'Budgets', 'Keys', 'Audit', 'Knowledge'];
const ad = { tabLabel: 'Admin', crumb: 'Admin' };
add('Adm-People-Phone.dc.html', 'admin', 'People', {
  ...ad, heading: 'People', sub: '12 employees · 1 guest', chips: ACH, chipOn: 0,
  body: `<div style="padding-top: 6px;"></div>
${[['michelle', 'Michelle Yip', 'admin', 'blue', 'Production · 2 min ago'], ['chan', 'Chan Ka-ming', 'builder', 'gray', 'Production · 14 min ago'], ['amy', 'Amy Wong', 'builder', 'gray', 'Research · 1 h ago'], ['leung', 'Leung Chi-hang', 'member', 'gray', 'Production · 3 h ago']].map(([k, n, r, t, s], i) => row({ lead: pav(k, 40), title: n, sub: `${dot('#30a46c')}<span>${s}</span>`, trail: bd(r, t), sep: 'i' })).join('')}
${row({ lead: ini('VC', 40), title: 'Vincent Chow', sub: '<span>Freelance guest · 4 d ago</span>', trail: bd('Ends 30 Sep', 'amb'), sep: '' })}
${btns('Add employee')}`,
  ask: 'Ask about people…',
  sheet: sheet('12 employees', 'Whose access should I review?', 'Read access and activity · 0.4 s', 'Vincent Chow’s guest access ends on 30 Sep and he still has #production. Remove it then, or extend it if the grading runs over.', 'Extend by 2 weeks'),
});
const MODS = [['Research', 1], ['Script', 1], ['Video Edit', 0], ['Publish', 1, 1], ['Accounting', 0], ['Finance', 0], ['Legal', 0], ['HR', 0]];
/* the entitlements matrix, like desktop: everyone × every module; names stay pinned while the grid slides */
const ENT_COLS = ['Res', 'Scr', 'Vid', 'Pub', 'Acc', 'Fin', 'Leg', 'HR'];
const ENT = [[pav('michelle', 30), 'Michelle Yip', 'admin', [1, 1, 1, 1, 1, 1, 1, 1]], [ini('PC', 30), 'Priscilla Cheung', 'Finance and HR', [0, 0, 0, 0, 1, 1, 0, 1]],
  [pav('chan', 30), 'Chan Ka-ming', 'builder', [1, 1, 1, 1, 0, 0, 0, 0]], [pav('amy', 30), 'Amy Wong', 'builder', [1, 1, 0, 2, 0, 0, 0, 0], 1],
  [pav('leung', 30), 'Leung Chi-hang', 'member', [0, 1, 1, 1, 0, 0, 0, 0]], [ini('VC', 30), 'Vincent Chow', 'guest · ends 30 Sep', [0, 0, 1, 0, 0, 0, 0, 0]]];
const cell = v => v === 2 ? '<span style="width: 20px; height: 20px; border-radius: 10px; background: #f5a524; box-shadow: 0 0 0 3px #fff3dc; display: inline-flex; align-items: center; justify-content: center;"><svg viewBox="0 0 16 16" style="width: 11px; height: 11px; stroke: #fff; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round;"><path d="M3.6 8.3 6.5 11.2 12.4 5.1"/></svg></span>'
  : v ? '<span style="width: 20px; height: 20px; border-radius: 10px; background: #171717; display: inline-flex; align-items: center; justify-content: center;"><svg viewBox="0 0 16 16" style="width: 11px; height: 11px; stroke: #fff; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round;"><path d="M3.6 8.3 6.5 11.2 12.4 5.1"/></svg></span>'
  : '<span style="width: 20px; height: 20px; border-radius: 10px; border: 1.5px solid #dcdcdc; display: inline-block; box-sizing: border-box;"></span>';
const pin = 'position: sticky; left: 0; z-index: 1; box-shadow: 1px 0 0 #ededed;';
const entMatrix = `
      <div data-chips style="margin: 14px 16px 0; border: 1px solid #ededed; border-radius: 14px; overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch;">
        <table style="border-collapse: separate; border-spacing: 0; min-width: 100%;">
          <tr><th style="${pin} background: #fafafa; text-align: left; font-size: 11.5px; font-weight: 500; color: #999999; padding: 10px 12px; min-width: 148px;">Person</th>${ENT_COLS.map(c => `<th style="background: #fafafa; font-size: 11.5px; font-weight: 500; color: #999999; padding: 10px 0; width: 44px; min-width: 44px;${c === 'HR' ? ' color: #b36b00;' : ''}">${c}</th>`).join('')}</tr>
${ENT.map(([av, n, role, v, sel]) => `          <tr><td style="${pin} background: ${sel ? '#f2f8ff' : '#fff'}; padding: 9px 12px; border-top: 1px solid #f3f3f3;"><div style="display: flex; align-items: center; gap: 9px;">${av}<div style="min-width: 0;"><div class="nm" style="font-size: 13.5px;${sel ? ' font-weight: 500;' : ''}">${n}</div><div class="cap" style="font-size: 11.5px; white-space: nowrap;">${role}</div></div></div></td>${v.map(c => `<td style="text-align: center; border-top: 1px solid #f3f3f3; background: ${sel ? '#f2f8ff' : '#fff'};">${cell(c)}</td>`).join('')}</tr>`).join('\n')}
        </table>
      </div>
      <div style="display: flex; align-items: center; gap: 12px; padding: 10px 16px 0; font-size: 12px; color: #7c7c7c;"><span style="display: flex; align-items: center; gap: 5px;">${cell(1).replace(/20px/g, '14px')}Can open</span><span style="display: flex; align-items: center; gap: 5px;">${cell(2).replace(/20px/g, '14px')}Unsaved</span><span style="margin-left: auto;">Slide for more · 6 more people</span></div>
      <div class="note" style="margin-top: 12px; background: #fffbf0; color: #8a5a0d;">HR is a private scope. Only 2 people hold it, and the agent reads HR records only for them.</div>`;
add('Adm-Ent-Phone.dc.html', 'admin', 'Entitlements', {
  ...ad, heading: 'Access', sub: '12 people · 8 modules · 4 file groups', chips: ACH, chipOn: 1,
  body: `${entMatrix}
${sec('Amy Wong', 'tap a person to edit them')}
${MODS.map(([m, on, ch], i) => row({ title: `${m}${ch ? ' <span class="bd amb" style="height: 20px; margin-left: 6px;">Changed</span>' : ''}${m === 'HR' ? ' <span class="cap">· private scope</span>' : ''}`, trail: sw(on), sep: i < MODS.length - 1 ? 'n' : '', style: 'min-height: 50px;' })).join('')}
${sec('File groups')}
${[['Production files', 1], ['2026-Q3-campaign', 1], ['Confidential', 0]].map(([g, on], i) => row({ title: g, trail: sw(on), sep: i < 2 ? 'n' : '', style: 'min-height: 50px;' })).join('')}
${btns('Save', 'Discard')}`,
  ask: 'Ask about access…',
  sheet: sheet('Amy Wong · access', 'What does adding Publish give her?', 'Read entitlements · 0.2 s', 'She could compose posts and send them for approval. She still can’t approve her own, and every change lands in the audit log.', 'Save the change'),
});
add('Adm-Tokens-Phone.dc.html', 'admin', 'Token dashboard', {
  ...ad, heading: 'AI spend', sub: 'September · updated 4 min ago', chips: ACH, chipOn: 2,
  body: `<div style="padding-top: 14px;">${kpis([['Spent', 'HK$1,284', '+12% on August', ''], ['Tokens', '18.4 M', '6,112 requests']])}</div>
${sec('API keys', 'never shown')}
${[['openrouter', 'OpenRouter', 'All writing bots · HK$1,021', 1], ['google', 'Google Vertex · Veo', 'Out of credit', 'err'], ['elevenlabs', 'ElevenLabs', 'Voice and music · HK$88', 1], ['openai', 'OpenAI', 'Backup transcription · paused', 0]].map(([k, n, s, on], i) => row({ lead: BRAND[k](34), title: n, sub: `<span${on === 'err' ? ' style="color: #e03636;"' : ''}>${s}</span>`, trail: on === 'err' ? bd('Top up', 'red') : sw(on), sep: i < 3 ? 'i' : '' }).replace('margin-left: 82px', 'margin-left: 62px')).join('')}
${sec('By bot')}
${[['#e5484d', 'Video director', 'HK$412.80', 32], ['#4c7cf0', 'Personal agents', 'HK$486.20', 38], ['#30a46c', 'Script writer', 'HK$186.40', 15]].map(([c, n, v, p], i) => row({ lead: px([[SPRITE.BOT]], { s: 2.4, pal: { B: c } }), title: n, sub: `<div style="width: 120px;">${pbar(p * 2.4, c)}</div><span>${p}%</span>`, trail: `<span style="font-size: 14px; font-variant-numeric: tabular-nums;">${v}</span>`, sep: i < 2 ? 'n' : '' })).join('')}`,
  ask: 'Ask about AI spend…',
  sheet: sheet('Tenant · September', 'Why is spend up 12%?', 'Read the token ledger · 0.7 s', 'Almost all of it is the Video director: History of Greece used Veo for 4 generated shots. Leung is at 94% of his cap.', 'Raise his cap'),
});
add('Adm-Budgets-Phone.dc.html', 'admin', 'Budgets', {
  ...ad, heading: 'Budgets', sub: 'Monthly AI caps · stop and notify', chips: ACH, chipOn: 3,
  body: `
      <div class="note" style="margin-top: 14px; background: #fffbf0; color: #8a5a0d;">At a cap, the platform stops further use and tells both the admin and the person.</div>
${[[null, 'Team · Production', 687.1, 800, 86], ['leung', 'Leung Chi-hang', 188.1, 200, 94], ['chan', 'Chan Ka-ming', 412.8, 600, 69], ['amy', 'Amy Wong', 286.4, 400, 72]].map(([k, n, s, c, p], i) => `
      <div style="padding: 12px 16px;${i < 3 ? ' border-bottom: 1px solid #f3f3f3;' : ''}"><div style="display: flex; align-items: center; gap: 10px;">${k ? pav(k, 30) : ini('PR', 30)}<span style="font-size: 14.5px; flex-grow: 1;">${n}</span><span style="font-size: 14px; font-weight: 500; color: ${p > 90 ? '#e03636' : p > 80 ? '#b36b00' : '#171717'};">${p}%</span></div><div style="margin: 9px 0 5px;">${pbar(p, p > 90 ? '#e03636' : p > 80 ? '#f5a524' : '')}</div><div class="cap">HK$${s.toFixed(2)} of HK$${c}.00</div></div>`).join('')}`,
  ask: 'Ask about budgets…',
  sheet: sheet('4 caps', 'Who will hit their cap first?', 'Projected this month · 0.3 s', 'Leung Chi-hang, in about two days at his current rate. You’ll both be notified when he does.', 'Raise his cap to HK$260'),
});
add('Adm-Channels-Phone.dc.html', 'admin', 'Channels and credentials', {
  ...ad, heading: 'Keys and connections', sub: 'Keys are referenced, never shown', chips: ACH, chipOn: 4,
  body: `
      <div class="note" style="margin-top: 14px; background: #fff7f7; color: #8a3b3b;"><b style="font-weight: 500;">Vertex AI is out of credit.</b> Generation jobs stopped. Not a platform fault: the client tops up and it resumes.</div>
${sec('Connections')}
${[['google', 'Google Vertex · Veo', 'sm://gcp/sa#9b2 · rotated 14 Mar', 'No credit', 'red'], ['openrouter', 'OpenRouter', 'sm://or/key#01f · rotated 1 Jul', 'Connected', 'grn'], ['elevenlabs', 'ElevenLabs', 'sm://el/key#3c8 · rotated 2 Aug', 'Connected', 'grn'], ['azure', 'Azure Speech', 'sm://az/key#7d0 · rotated 12 Jun', 'Connected', 'grn']].map(([k, n, s, b, t], i) => row({ lead: BRAND[k](34), title: n, sub: `<span style="font-family: ui-monospace, monospace; font-size: 11.5px;">${s}</span>`, trail: bd(b, t), sep: i < 3 ? 'i' : '' }).replace('margin-left: 82px', 'margin-left: 62px')).join('')}`,
  ask: 'Ask about connections…',
  sheet: sheet('8 connections', 'Which keys are overdue for rotation?', 'Read rotation dates · 0.1 s', 'The Vertex service account was last rotated on 14 Mar, past the 90-day rule. The rest are within it.', 'Rotate Vertex key'),
});
add('Adm-Audit-Phone.dc.html', 'admin', 'Audit log', {
  ...ad, heading: 'Audit log', sub: 'Who did what, and when', chips: ACH, chipOn: 5,
  body: `
      <div class="note" style="margin-top: 14px; background: #fafafa; color: #525252;">Every access, share, approval and settings change is recorded here. Nobody can edit or delete an entry, admins included.</div>
${[['Today', [['michelle', '<b>Michelle</b> gave Priscilla access to Finance', '10:14', 'Access', 'blue'], ['michelle', '<b>Michelle</b> opened master-004.mov without being given it', '09:02', 'Admin access', 'amb']]], ['Yesterday', [['chan', '<b>Chan</b> shared Renders with Production', '17:41', 'Files', 'gray'], ['amy', '<b>Amy</b> rolled house style back to v5', '11:20', 'Knowledge', 'grn']]]].map(([d, evs]) => `${sec(d)}
${evs.map(([k, s, t, c, tone], i) => `
      <div style="display: flex; gap: 12px; padding: 10px 16px;${c === 'Admin access' ? ' background: #fffbf0;' : ''}">${pav(k, 32)}<div style="min-width: 0; flex-grow: 1;"><div style="font-size: 14px; line-height: 1.45; color: #525252;">${s.replace(/<b>/g, '<b style="font-weight: 500; color: #171717;">')}</div><div style="display: flex; align-items: center; gap: 8px; margin-top: 5px;"><span class="cap">${t}</span>${bd(c, tone)}</div></div></div>`).join('')}`).join('')}`,
  ask: 'Ask the audit log…',
  sheet: sheet('Audit log · 30 days', 'Has anyone opened files they weren’t given?', 'Searched 48,210 entries · 0.9 s', 'Only Michelle, twice, both as admin. Admins are allowed to, but it’s always recorded here.', 'Show both'),
});
add('Adm-Know-Phone.dc.html', 'admin', 'Knowledge and skills', {
  ...ad, heading: 'Knowledge', sub: 'What the bots are taught', chips: ACH, chipOn: 6,
  body: `
      <div style="display: flex; gap: 14px; padding: 16px 16px 6px; overflow: hidden;">${[['Skills', 9, 1], ['Style guides', 4], ['Examples', 12], ['Scripts', 41]].map(([n, c, on]) => `<div style="display: flex; flex-direction: column; align-items: center; gap: 6px; width: 76px; flex-shrink: 0; padding: 6px 0; border-radius: 12px;${on ? ' background: #f3f3f3;' : ''}">${folderIcon(2.8)}<span style="font-size: 12.5px;">${n}</span><span class="cap" style="margin-top: -4px;">${c}</span></div>`).join('')}</div>
${sec('Skills', '9 files')}
${[['script-beats-procedure.md', 'Script · v3', 1], ['comment-reply-procedure.md', 'Research · v2', 1], ['receipt-extraction.md', 'Accounting · v4', 1], ['old-caption-rules.md', 'Off · v1', 0]].map(([n, s, on], i) => row({ lead: `<div style="width: 40px; display: flex; justify-content: center;">${docIcon('skill', 2, !on)}</div>`, title: n, sub: `<span>${s}</span>`, trail: sw(on), sep: i < 3 ? 'i' : '' })).join('')}
      <div class="note" style="margin-top: 10px; background: #fafafa; color: #525252;">The Script writer gets 4,180 of its 8,000-token limit from these files. <span style="color: var(--ac);">Preview</span></div>`,
  ask: 'Ask about knowledge…',
  sheet: sheet('Knowledge · 70 files', 'What does the Script writer receive?', 'Assembled the prompt · 0.3 s', 'Instructions first, then house style v5, then the relevant skills and 3 closest approved scripts: 4,180 of 8,000 tokens.', 'Open the preview'),
});

fs.writeFileSync(path.join(DIR, 'phones-c.json'), JSON.stringify(out, null, 1));
console.log('wrote', out.length, 'phones');
