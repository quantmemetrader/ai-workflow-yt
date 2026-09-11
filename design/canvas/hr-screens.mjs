/**
 * Human Resources, hand-authored, all five screens (§4.10).
 *
 *   Hr-Gate        Overview: what needs you, and who can see HR (the hr
 *                  scope explained, with what everyone else sees)
 *   Hr-Leave       a real month calendar, requests to approve, balances
 *   Hr-Recruit     one requisition as a hiring pipeline + JD draft
 *   Hr-Candidates  past applicants with consent and retention timelines
 *   Hr-Employees   an employee record with checklists and documents
 *
 * Applicants never borrow employee photos: they get initials. Nothing is
 * sourced from LinkedIn or anywhere external (Schedule A3(8)).
 * Run:  node hr-screens.mjs
 */
import fs from 'fs';
import path from 'path';
import { page as shellPage, P, av, px, SPRITE, ICON, docIcon, rightPanel, agentBlock, okDot, warnDot, moduleSidebar, topbar, chip, cb, LOCK } from './shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CSS = `
    .kpi { border: 1px solid #ededed; border-radius: 12px; padding: 13px 14px; background: #fff; min-width: 0; }
    .kpi .t { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 500; color: #171717; }
    .kpi b { display: block; font-size: 22px; font-weight: 500; margin-top: 8px; font-variant-numeric: tabular-nums; }
    .kpi span.s { display: block; font-size: 11.5px; color: #7c7c7c; margin-top: 3px; line-height: 1.45; }
    .ini { border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; flex-shrink: 0; color: #525252; background: #ededed; }
    .cal { border: 1px solid #ededed; border-radius: 12px; overflow: hidden; }
    .cal .dh { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-bottom: 1px solid #ededed; background: #fafafa; }
    .cal .dh div { height: 28px; display: flex; align-items: center; padding: 0 9px; font-size: 11px; font-weight: 500; color: #7c7c7c; }
    .wk { position: relative; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-bottom: 1px solid #f0f0f0; height: 112px; }
    .wk:last-child { border-bottom: none; }
    .dc { border-right: 1px solid #f3f3f3; padding: 6px 8px; min-width: 0; }
    .dc:last-child { border-right: none; }
    .dn { font-size: 12px; color: #383838; width: 22px; height: 22px; border-radius: 11px; display: flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
    .hol { font-size: 10.5px; color: #e03636; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lv { position: absolute; height: 22px; border-radius: 6px; display: flex; align-items: center; gap: 6px; padding: 0 7px 0 3px; font-size: 11.5px; overflow: hidden; white-space: nowrap; }
    .lv img { width: 16px; height: 16px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
    .kb { flex: 1 1 0; min-width: 0; background: #fafafa; border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
    .kb .kh { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 500; color: #525252; padding: 2px 2px 4px; }
    .kc { background: #fff; border: 1px solid #ededed; border-radius: 10px; padding: 10px; }
    .kc .nm { font-size: 12.5px; font-weight: 500; color: #171717; }
    .kc .sm { font-size: 11.5px; color: #7c7c7c; line-height: 1.45; margin-top: 3px; }
    .mt { height: 4px; border-radius: 2px; background: #ededed; flex-grow: 1; }
    .mt div { height: 4px; border-radius: 2px; }
    .ht .hd, .ht .tr { display: grid; align-items: center; }
    .ht .hd { height: 30px; border-bottom: 1px solid #ededed; }
    .ht .hd > * { font-size: 10.5px; font-weight: 500; color: #7c7c7c; padding: 0 10px; }
    .ht .tr { height: 50px; border-bottom: 1px solid #f3f3f3; animation: none; }
    .ht .tr > * { font-size: 12.5px; color: #383838; padding: 0 10px; min-width: 0; display: flex; align-items: center; gap: 8px; }
    .emp { display: flex; align-items: center; gap: 10px; padding: 8px 9px; border-radius: 9px; }
    .emp.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); }`;

const NAV = [['gate', 'Overview'], ['leave', 'Leave'], ['recruit', 'Recruitment'], ['candidates', 'Candidate records'], ['employees', 'Employee records']];
const side = cur => moduleSidebar('Human Resources', NAV, cur, {
  badges: { leave: '<i>2</i>' },
  footer: `<div style="display: flex; align-items: center; gap: 8px;"><span style="color: #278f5e; display: flex;">${LOCK}</span><span style="font-size: 11.5px; color: #525252;">You have HR access</span></div><div class="cap" style="margin-top: 4px; line-height: 1.45;">Private. 2 people can open these screens.</div>`,
});
const page = o => shellPage({ module: 'Human Resources', gen: 'hr-screens.mjs', active: 'hr', me: 'michelle', extraCss: CSS, ...o });
const ini = (t, s = 22, bg = '#ededed', fg = '#525252') => `<div class="ini" style="width: ${s}px; height: ${s}px; font-size: ${Math.round(s * .4)}px; background: ${bg}; color: ${fg};">${t}</div>`;

/* =================================================================== */
/* OVERVIEW (was "Access")                                             */
/* =================================================================== */
const overviewMain = `${topbar('Human Resources', 'what needs you this week')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 16px 20px 0; overflow: hidden;">
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;">
          <div class="kpi"><div class="t">Leave</div><b>2</b><span class="s">requests waiting for you, both next fortnight</span></div>
          <div class="kpi"><div class="t">Hiring</div><b>3</b><span class="s">junior editor interviews on 12 Sep</span></div>
          <div class="kpi"><div class="t">Candidate records</div><b>1</b><span class="s">consent ends in 22 days, then deleted</span></div>
          <div class="kpi"><div class="t">Employees</div><b>2</b><span class="s">onboarding items open for Amy Wong</span></div>
        </div>
        <div class="lbl" style="padding: 0; margin: 20px 0 8px;">Out this week</div>
        <div style="display: flex; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #ededed; border-radius: 12px; min-width: 0; flex: 1;">${av('chan', 28)}<div style="min-width: 0;"><div style="font-size: 12.5px; font-weight: 500;">Chan Ka-ming</div><div class="cap">Annual leave · back Wed 9 Sep</div></div><span class="bd grn" style="margin-left: auto;">Back</span></div>
          <div style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #ededed; border-radius: 12px; min-width: 0; flex: 1;">${av('leung', 28)}<div style="min-width: 0;"><div style="font-size: 12.5px; font-weight: 500;">Leung Chi-hang</div><div class="cap">Asked for 14 to 16 Sep</div></div><span class="bd amb" style="margin-left: auto;">Waiting</span></div>
        </div>

        <div class="lbl" style="padding: 0; margin: 22px 0 8px;">Who can see HR</div>
        <div style="display: flex; gap: 14px; padding: 16px; border-radius: 14px; background: #fafafa;">
          <div style="flex: 1.3; min-width: 0;">
            <div style="font-size: 13.5px; font-weight: 500;">HR is private, because it holds personal data</div>
            <div style="font-size: 12.5px; line-height: 1.6; color: #525252; margin-top: 6px;">Only people an admin gives <b style="font-weight: 500;">HR access</b> can open these five screens. The agent only reads HR records when one of them asks it to. Everyone else still applies for their own leave from Chat.</div>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 14px;">
              <div style="display: flex; align-items: center; gap: 10px;">${av('michelle', 26)}<div><div style="font-size: 12.5px;">Michelle Yip</div><div class="cap">Head of production · given 12 Jan</div></div></div>
              <div style="display: flex; align-items: center; gap: 10px;">${ini('PC', 26, '#e6f4ff', '#007be0')}<div><div style="font-size: 12.5px;">Priscilla Cheung</div><div class="cap">Finance and HR · given 9 Sep</div></div></div>
            </div>
            <div style="font-size: 12px; color: {{accent}}; margin-top: 12px;">Change who has access in Admin</div>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div class="cap" style="margin-bottom: 8px;">What everyone else sees if they open HR</div>
            <div style="border: 1px solid #ededed; border-radius: 12px; background: #fff; padding: 22px 18px; text-align: center;">
              <div style="display: flex; justify-content: center;">${docIcon('locked', 2.4)}</div>
              <div style="font-size: 13px; font-weight: 500; margin-top: 12px;">HR is private</div>
              <div class="cap" style="line-height: 1.5; margin-top: 4px;">It holds personal records. Ask an admin if you need access.</div>
              <div style="display: flex; gap: 6px; justify-content: center; margin-top: 12px;"><div class="btn s" style="height: 26px; font-size: 12px;">Apply for leave instead</div><div class="btn s" style="height: 26px; font-size: 12px;">Ask for access</div></div>
            </div>
          </div>
        </div>
      </div>
${rightPanel(['Agent'], 'Agent', agentBlock({
  scope: 'HR · you have access',
  q: 'Anything I should deal with before Friday?',
  tool: 'Read leave, hiring, records · 0.5 s',
  a: `<p>Two things. <b style="font-weight: 500;">Amy’s unpaid leave</b> (21 to 25 Sep) overlaps the Harbourfront shoot on the 22nd, so decide that one first.</p><p style="margin-top: 8px;">And applicant 0087’s consent ends on 2 Oct. Their record is deleted then unless they agree to stay on file.</p>`,
  act: 'Open Amy’s request',
  place: 'Ask about HR…',
  guard: 'Reads HR records only for people with HR access',
  cost: 'HK$0.01',
}))}
    </div>`;

/* =================================================================== */
/* LEAVE, a real month calendar                                       */
/* =================================================================== */
const WEEKS = [[31, 1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12, 13], [14, 15, 16, 17, 18, 19, 20], [21, 22, 23, 24, 25, 26, 27], [28, 29, 30, 1, 2, 3, 4]];
const OUT = (w, i) => (w === 0 && i === 0) || (w === 4 && i >= 3);
const HOLS = { '3-5': 'Day after Mid-Autumn', '4-3': 'National Day' };
const BARS = [
  // week, fromCol, toCol, lane, who, label, kind
  [0, 1, 1, 0, 'michelle', 'Michelle · sick', 'ok'],
  [0, 4, 4, 0, 'chan', 'Chan · annual', 'ok'],
  [1, 0, 1, 0, 'chan', 'Chan · annual', 'ok'],
  [2, 0, 2, 0, 'leung', 'Leung Chi-hang · annual · waiting for you', 'wait'],
  [3, 0, 4, 0, 'amy', 'Amy Wong · unpaid · waiting for you', 'wait'],
  [3, 2, 2, 1, 'leung', 'Leung · half day', 'ok'],
];
const TODAY = [1, 3];
const cal = `
        <div class="cal">
          <div class="dh">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div>${d}</div>`).join('')}</div>
${WEEKS.map((days, w) => `          <div class="wk">
${days.map((d, i) => { const today = TODAY[0] === w && TODAY[1] === i; const hol = HOLS[`${w}-${i}`]; return `            <div class="dc" style="${i >= 5 ? 'background: #fcfcfc;' : ''}"><div class="dn" style="${OUT(w, i) ? 'color: #c7c7c7;' : ''}${today ? ' background: var(--ac); color: #fff; font-weight: 500;' : ''}">${d}</div>${hol ? `<div class="hol">${hol}</div>` : ''}</div>`; }).join('\n')}
${BARS.filter(b => b[0] === w).map(([, a, z, lane, who, label, kind]) => `            <div class="lv" style="left: calc(${(a / 7 * 100).toFixed(3)}% + 4px); width: calc(${((z - a + 1) / 7 * 100).toFixed(3)}% - 8px); top: ${34 + lane * 26}px; ${kind === 'ok' ? 'background: #e6f4ff; color: #0b5cad;' : 'background: #fff3d6; color: #8a5a0d; box-shadow: inset 3px 0 0 #f5a524;'}"><img src="${P[who][0]}">${label}</div>`).join('\n')}
          </div>`).join('\n')}
        </div>`;
const leaveMain = `${topbar('Leave', 'team calendar, requests and balances', '<div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Apply for leave</div>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 12px 20px 0; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
          <div style="display: flex; gap: 2px;"><div class="ptog" style="border: 1px solid #ededed;"><svg viewBox="0 0 24 24"><path d="m14.5 6-6 6 6 6"/></svg></div><div class="ptog" style="border: 1px solid #ededed;"><svg viewBox="0 0 24 24"><path d="m9.5 6 6 6-6 6"/></svg></div></div>
          <span style="font-size: 16px; font-weight: 500;">September 2026</span>
          <div class="btn s" style="height: 26px;">Today</div>
          <div style="flex-grow: 1;"></div>
          <span class="cap" style="display: flex; align-items: center; gap: 5px;"><span style="width: 10px; height: 10px; border-radius: 3px; background: #e6f4ff;"></span>Approved</span>
          <span class="cap" style="display: flex; align-items: center; gap: 5px;"><span style="width: 10px; height: 10px; border-radius: 3px; background: #fff3d6; box-shadow: inset 2px 0 0 #f5a524;"></span>Waiting</span>
          <span class="cap" style="display: flex; align-items: center; gap: 5px;"><span style="width: 10px; height: 10px; border-radius: 3px; background: #ffe7e7;"></span>Public holiday</span>
          ${chip('Production team')}
        </div>
${cal}
      </div>
${rightPanel(['Requests', 'Agent'], 'Requests', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 12px;">
          <div style="display: flex; align-items: center; margin-bottom: 8px;"><span style="font-size: 12.5px; font-weight: 500;">Waiting for you</span><span class="bd red" style="margin-left: 8px; height: 18px;">2</span></div>
          <div class="kc" style="padding: 12px;">
            <div style="display: flex; align-items: center; gap: 9px;">${av('leung', 26)}<div style="min-width: 0;"><div class="nm">Leung Chi-hang</div><div class="cap">Annual · Mon 14 to Wed 16 Sep · 3 days</div></div></div>
            <div class="sm" style="margin-top: 8px;">Chan covers edits that week. 9.5 days left after this.</div>
            <div style="display: flex; gap: 6px; margin-top: 10px;"><div class="btn" style="flex: 1; justify-content: center; height: 28px; background: {{accent}}; color: #fff; font-weight: 500;">Approve</div><div class="btn s" style="flex: 1; justify-content: center; height: 28px;">Decline</div></div>
          </div>
          <div class="kc" style="padding: 12px; margin-top: 8px;">
            <div style="display: flex; align-items: center; gap: 9px;">${av('amy', 26)}<div style="min-width: 0;"><div class="nm">Amy Wong</div><div class="cap">Unpaid · Mon 21 to Fri 25 Sep · 5 days</div></div></div>
            <div style="display: flex; gap: 7px; margin-top: 8px; padding: 7px 8px; border-radius: 8px; background: #fffbf0;">${warnDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 15px; height: 15px; border-radius: 8px')}<span style="font-size: 11.5px; color: #8a5a0d; line-height: 1.45;">Overlaps the Harbourfront shoot on 22 Sep.</span></div>
            <div style="display: flex; gap: 6px; margin-top: 10px;"><div class="btn" style="flex: 1; justify-content: center; height: 28px; background: {{accent}}; color: #fff; font-weight: 500;">Approve</div><div class="btn s" style="flex: 1; justify-content: center; height: 28px;">Decline</div></div>
          </div>
          <div class="lbl" style="padding: 0; margin: 18px 0 8px;">Your balance</div>
          ${[['Annual', 11.5, 14], ['Sick', 10, 10], ['Time off in lieu', 2, 2]].map(([t, l, of]) => `<div style="margin-bottom: 11px;"><div style="display: flex; justify-content: space-between; font-size: 12px;"><span>${t}</span><span style="font-variant-numeric: tabular-nums;">${l} of ${of} days</span></div><div class="mt" style="margin-top: 6px;"><div style="width: ${l / of * 100}%; background: {{accent}};"></div></div></div>`).join('')}
          <div class="cap" style="line-height: 1.5;">Leave types and how days build up are set by the client.</div>
        </div>`)}
    </div>`;

/* =================================================================== */
/* RECRUITMENT, pipeline                                              */
/* =================================================================== */
const CARD = (id, nm, sm, score, src, extra = '') => `<div class="kc"><div style="display: flex; align-items: center; gap: 8px;">${ini(nm.split(' ').map(s => s[0]).join('').slice(0, 2), 24)}<div style="min-width: 0; flex-grow: 1;"><div class="nm" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${nm}</div><div class="cap">#${id} · ${src}</div></div></div><div class="sm">${sm}</div><div style="display: flex; align-items: center; gap: 7px; margin-top: 8px;"><div class="mt"><div style="width: ${score}%; background: {{accent}};"></div></div><span style="font-size: 11px; color: #525252; font-variant-numeric: tabular-nums;">${score}</span></div>${extra}</div>`;
const recruitMain = `${topbar('Recruitment', 'one role, from application to offer', '<div class="btn s">New requisition</div>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 14px 20px 0; overflow: hidden; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid #ededed; border-radius: 12px;">
          <div style="min-width: 0;"><div style="display: flex; align-items: center; gap: 8px;"><span style="font-size: 14px; font-weight: 500;">Junior video editor</span><span class="bd grn">Approved</span></div><div class="cap" style="margin-top: 3px;">Production · 1 opening · HK$22k to 26k · posted on the careers page and JobsDB (Aura Farmers account)</div></div>
          <div style="flex-grow: 1;"></div>
          <div style="display: flex; align-items: center; gap: 6px;">${av('amy', 22)}<svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #c7c7c7; fill: none; stroke-width: 2;"><path d="M5 12h14M13 6l6 6-6 6"/></svg>${av('michelle', 22)}<span class="cap" style="margin-left: 4px;">approved 28 Aug</span></div>
        </div>
        <div style="display: flex; align-items: center; gap: 7px; margin: 10px 2px 12px;" class="cap"><span style="color: #278f5e; display: flex;">${LOCK}</span>Only applications sent to Aura Farmers. Nothing is pulled from LinkedIn or anywhere else.</div>
        <div style="display: flex; gap: 10px; min-height: 0; flex-grow: 1; padding-bottom: 14px;">
          <div class="kb"><div class="kh">Applied<span class="cap">14</span></div>
            ${CARD('0156', 'Wong Hoi-lam', 'Freelance editor 2 yrs · Premiere · Cantonese, English', 64, 'Careers page')}
            ${CARD('0155', 'Tsang Ka-yan', 'Film graduate · DaVinci · reels portfolio', 58, 'JobsDB')}
            <div class="cap" style="padding: 4px 2px;">12 more · sorted by match</div>
          </div>
          <div class="kb"><div class="kh">Screening<span class="cap">5</span></div>
            ${CARD('0151', 'Lam Tsz-ho', 'In-house editor at a café chain · short-form', 71, 'Careers page')}
            ${CARD('0149', 'Chow Wing-sze', 'Motion graphics, After Effects · 3 yrs', 69, 'Referral')}
          </div>
          <div class="kb" style="background: #f5faff;"><div class="kh">Interview<span class="cap">3</span></div>
            ${CARD('0142', 'Cheung Wing-yan', 'TVB assistant editor 3 yrs · Premiere, DaVinci', 92, 'Careers page', '<div style="display: flex; align-items: center; gap: 6px; margin-top: 8px;" class="cap"><span class="bd blue" style="height: 18px;">Sat 12 Sep · 14:00</span></div>')}
            ${CARD('0138', 'Ho Chun-kit', 'Documentary editor · Cantonese subtitles', 86, 'Referral', '<div style="display: flex; align-items: center; gap: 6px; margin-top: 8px;" class="cap"><span class="bd blue" style="height: 18px;">Sat 12 Sep · 16:00</span></div>')}
          </div>
          <div class="kb"><div class="kh">Offer<span class="cap">0</span></div>
            <div style="flex-grow: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; padding: 10px;">${ICON.draft(2)}<span class="cap" style="line-height: 1.5;">Move someone here after interviews. The offer letter is drafted in Legal.</span></div>
          </div>
        </div>
      </div>
${rightPanel(['Job description', 'Agent'], 'Job description', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 14px;">
          <div style="display: flex; align-items: center; gap: 8px;"><span class="bd amb">Draft</span><span class="cap">From the role brief · 28 Aug</span></div>
          <div style="font-size: 14px; font-weight: 500; margin-top: 10px;">Junior video editor</div>
          <div style="font-size: 12px; line-height: 1.65; color: #383838; margin-top: 8px;">You’ll cut short documentaries and social edits for Hong Kong brands, from rough cut to final subtitles.</div>
          <div class="lbl" style="padding: 0; margin: 12px 0 6px;">You’ll need</div>
          <div style="font-size: 12px; line-height: 1.7; color: #383838;">· 2+ years editing in Premiere or DaVinci<br>· Cantonese and English, spoken and written<br>· A reel of short-form work</div>
          <div class="lbl" style="padding: 0; margin: 12px 0 6px;">Posted on</div>
          <div style="display: flex; gap: 6px;"><span class="bd gray">Careers page</span><span class="bd gray">JobsDB</span></div>
          <div class="btn s" style="width: 100%; justify-content: center; margin-top: 14px;">Edit description</div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 10px 14px 12px;" class="cap">Ranking uses the requisition only. You make every decision.</div>`)}
    </div>`;

/* =================================================================== */
/* CANDIDATE RECORDS                                                   */
/* =================================================================== */
const CANDS = [
  ['Cheung Wing-yan', '0142', 'Junior video editor', 'Careers page', '28 Aug 2026', '28 Aug 2027', 97, 'In process', 'blue'],
  ['Ho Chun-kit', '0138', 'Junior video editor', 'Referral', '26 Aug 2026', '26 Aug 2027', 96, 'In process', 'blue'],
  ['Lee Sum-yi', '0087', 'Motion designer', 'Careers page', '2 Oct 2025', '2 Oct 2026', 6, 'Consent ends in 22 days', 'amb'],
  ['Yip Ka-lok', '0071', 'Producer', 'Referral', '19 Jan 2026', '19 Jan 2027', 36, 'Kept on file', 'gray'],
  ['Fung Hiu-tung', '0061', 'Producer', 'Careers page', '14 Jul 2025', '14 Jul 2026', 0, 'Delete now', 'red'],
];
const candMain = `${topbar('Candidate records', 'past applicants, kept only as long as they agreed', chip('Any role'))}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 14px 20px 0; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 12px;">
          <div class="fc on">All <b>5</b></div><div class="fc">In process <b>2</b></div><div class="fc">Consent ending <b>1</b></div><div class="fc" style="color: #e03636;">Delete now <b>1</b></div>
          <div style="flex-grow: 1;"></div><span class="cap">Referrals and applications sent to the client only</span>
        </div>
        <div class="ht" style="border: 1px solid #ededed; border-radius: 12px; overflow: hidden;">
          <div class="hd" style="grid-template-columns: minmax(170px, 1.2fr) minmax(0, 1fr) 104px 160px 176px;"><div>Candidate</div><div>Applied for</div><div>Source</div><div>Consent</div><div>What happens next</div></div>
${CANDS.map(([nm, id, role, src, from, to, pct, st, tone]) => `          <div class="tr" style="grid-template-columns: minmax(170px, 1.2fr) minmax(0, 1fr) 104px 160px 176px;">
            <div>${ini(nm.split(' ').map(s => s[0]).join('').slice(0, 2), 26)}<div style="min-width: 0;"><div class="el" style="color: #171717; font-weight: 500;">${nm}</div><div class="cap" style="white-space: nowrap;">#${id} · ${from}</div></div></div>
            <div><span class="el">${role}</span></div>
            <div style="color: #7c7c7c; white-space: nowrap;">${src}</div>
            <div style="flex-direction: column; align-items: stretch; gap: 4px;"><div class="mt"><div style="width: ${pct}%; background: ${pct < 10 ? '#e03636' : pct < 20 ? '#db7706' : '{{accent}}'};"></div></div><span class="cap">until ${to}</span></div>
            <div><span class="bd ${tone}">${st}</span></div>
          </div>`).join('\n')}
        </div>
        <div style="display: flex; gap: 12px; margin-top: 14px; padding: 12px 14px; border-radius: 12px; background: #fafafa;">
          ${docIcon('await', 2)}
          <div style="font-size: 12.5px; line-height: 1.55; color: #525252;"><b style="font-weight: 500; color: #171717;">Each record has an end date.</b> When consent runs out, the record is deleted unless the person agrees to stay on file. You get a reminder 30 days before.</div>
        </div>
      </div>
${rightPanel(['Agent'], 'Agent', agentBlock({
  scope: 'Candidate records',
  q: 'Is anyone from before a good fit for the editor role?',
  tool: 'Searched 5 records you hold · 0.3 s',
  a: `<p><b style="font-weight: 500;">Lee Sum-yi</b> (#0087) applied for motion designer last October and has 2 years of Premiere. Her consent ends on 2 Oct.</p><p style="margin-top: 8px;">I can draft an email asking if she’d like to be considered, and to renew consent. I won’t look anywhere outside these records.</p>`,
  act: 'Draft the email',
  place: 'Ask about candidates…',
  guard: 'Only applications the client received',
  cost: 'HK$0.01',
}))}
    </div>`;

/* =================================================================== */
/* EMPLOYEE RECORDS                                                    */
/* =================================================================== */
const EMPS = [['amy', 'Researcher', 1], ['chan', 'Senior editor'], ['leung', 'Editor'], ['michelle', 'Head of production'], ['PC', 'Finance and HR', 0, 'Priscilla Cheung'], ['KW', 'Junior producer', 0, 'Kelly Wan']];
const CHECK = [[1, 'Laptop and accounts set up', 'IT · 6 Jan'], [1, 'Contract signed', 'EMP-0011 in Legal'], [1, 'Platform access: Research, Script', 'Admin · 7 Jan'], [1, 'House style walkthrough', 'Michelle · 9 Jan'], [0, 'Sign the IP assignment', 'Legal · waiting on Amy'], [0, 'Data privacy (PDPO) training', 'Due 30 Sep']];
const empMain = `${topbar('Employee records', '12 people', '<div class="btn s">Add employee</div>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="width: 240px; flex-shrink: 0; border-right: 1px solid #ededed; background: #fcfcfc; padding: 12px 10px; overflow: hidden;">
        <div style="height: 30px; border-radius: 8px; background: #fff; border: 1px solid #ededed; display: flex; align-items: center; gap: 7px; padding: 0 9px; margin-bottom: 10px;"><svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #999999; fill: none; stroke-width: 1.9; stroke-linecap: round;"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg><span style="font-size: 12px; color: #999999;">Find a person</span></div>
${EMPS.map(([k, role, on, name]) => `        <div class="emp${on ? ' on' : ''}">${P[k] ? av(k, 28) : ini(k, 28, '#e6f4ff', '#007be0')}<div style="min-width: 0;"><div style="font-size: 12.5px; color: #171717;${on ? ' font-weight: 500;' : ''}">${P[k] ? P[k][1] : name}</div><div class="cap">${role}</div></div></div>`).join('\n')}
        <div class="cap" style="padding: 8px 9px;">6 more</div>
      </div>
      <div style="flex-grow: 1; min-width: 0; padding: 16px 22px 0; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 14px;">${av('amy', 52)}<div style="min-width: 0;"><div style="font-size: 17px; font-weight: 500;">Amy Wong</div><div class="cap" style="margin-top: 3px;">Researcher · Production · reports to Michelle Yip</div></div><div style="flex-grow: 1;"></div><span class="bd amb">Onboarding · 4 of 6</span></div>
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 16px;">
          <div class="kpi" style="padding: 10px 12px;"><div class="cap">Started</div><div style="font-size: 13px; margin-top: 4px;">6 Jan 2026</div></div>
          <div class="kpi" style="padding: 10px 12px;"><div class="cap">Contract</div><div style="font-size: 13px; margin-top: 4px; color: {{accent}};">EMP-0011</div></div>
          <div class="kpi" style="padding: 10px 12px;"><div class="cap">Annual leave left</div><div style="font-size: 13px; margin-top: 4px;">11.5 days</div></div>
          <div class="kpi" style="padding: 10px 12px;"><div class="cap">Platform access</div><div style="font-size: 13px; margin-top: 4px;">Research, Script</div></div>
        </div>
        <div style="display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 14px; margin-top: 16px;">
          <div class="card" style="padding: 12px 14px;">
            <div style="display: flex; align-items: center; margin-bottom: 2px;"><span class="lbl" style="padding: 0;">Onboarding checklist</span><span class="cap" style="margin-left: auto;">2 open</span></div>
${CHECK.map(([done, t, s]) => `            <div style="display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #f3f3f3;">${cb(done)}<div style="min-width: 0;"><div style="font-size: 12.5px; color: ${done ? '#7c7c7c' : '#171717'};${done ? ' text-decoration: line-through; text-decoration-color: #c7c7c7;' : ''}">${t}</div><div class="cap">${s}</div></div></div>`).join('\n')}
          </div>
          <div class="card" style="padding: 12px 14px;">
            <div class="lbl" style="padding: 0; margin-bottom: 6px;">Documents</div>
            ${[['Employment contract', 'Signed 2 Jan', 'locked'], ['IP assignment', 'Waiting for signature', 'await'], ['NDA', 'Signed 2 Jan', 'locked']].map(([t, s, ic]) => `<div style="display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f3f3f3;">${ICON[ic](1.5)}<div><div style="font-size: 12.5px;">${t}</div><div class="cap">${s}</div></div></div>`).join('')}
            <div class="lbl" style="padding: 0; margin: 14px 0 6px;">Offboarding</div>
            <div class="cap">Not started. The checklist appears when a leaving date is set.</div>
          </div>
        </div>
      </div>
${rightPanel(['Agent'], 'Agent', agentBlock({
  scope: 'Amy Wong · employee record',
  q: 'What’s left for Amy’s onboarding?',
  tool: 'Read her record · 0.2 s',
  a: `<p>Two items: she hasn’t signed the <b style="font-weight: 500;">IP assignment</b> (sent 3 Sep), and the privacy training is due 30 Sep.</p><p style="margin-top: 8px;">I can remind her in Chat with a link to both.</p>`,
  act: 'Send a reminder',
  place: 'Ask about this person…',
  guard: 'Reads HR records only for people with HR access',
  cost: 'HK$0.01',
}))}
    </div>`;

const out = [
  { file: 'Hr-Gate.dc.html', title: 'Overview', side: side('gate'), main: overviewMain },
  { file: 'Hr-Leave.dc.html', title: 'Leave', side: side('leave'), main: leaveMain },
  { file: 'Hr-Recruit.dc.html', title: 'Recruitment', side: side('recruit'), main: recruitMain },
  { file: 'Hr-Candidates.dc.html', title: 'Candidate records', side: side('candidates'), main: candMain },
  { file: 'Hr-Employees.dc.html', title: 'Employee records', side: side('employees'), main: empMain },
];
for (const o of out) fs.writeFileSync(path.join(DIR, o.file), page(o));
console.log('wrote', out.map(o => o.file).join(', '));
