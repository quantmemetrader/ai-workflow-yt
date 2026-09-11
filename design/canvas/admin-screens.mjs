/**
 * Admin, hand-authored screens (the rest of Admin stays generated).
 *
 *   Adm-Tokens  one place for AI spend: totals, usage by module, API keys
 *               you can pause / resume (referenced, never displayed, §8),
 *               and a table switchable by bot · person · model (§4.11)
 *   Adm-Audit   what the audit log is, in plain words, then a readable feed
 *   Adm-Know    Knowledge & skills as folders of pixel files (§4.11 A2(a)),
 *               versions + rollback, and the assembled-prompt preview
 *
 * Run:  node admin-screens.mjs
 */
import fs from 'fs';
import path from 'path';
import { page as shellPage, P, av, px, SPRITE, ICON, docIcon, BRAND, rightPanel, agentBlock, okDot, CHEV } from './shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);

const CSS = `
    .kpi { border: 1px solid #ededed; border-radius: 12px; padding: 12px 14px; background: #fff; min-width: 0; }
    .kpi i { font-style: normal; display: block; font-size: 11px; color: #999999; }
    .kpi b { display: block; font-size: 20px; font-weight: 500; margin-top: 5px; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
    .kpi span { display: block; font-size: 11px; color: #7c7c7c; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sw { width: 30px; height: 17px; border-radius: 9px; padding: 2px; display: flex; flex-shrink: 0; cursor: pointer; transition: background .15s ease; }
    .sw div { width: 13px; height: 13px; border-radius: 7px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
    .kr { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f3f3f3; min-width: 0; }
    .kr:last-child { border-bottom: none; }
    .lg { width: 26px; height: 26px; border-radius: 7px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 10px; font-weight: 700; color: #fff; }
    .segs { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3f3f3; }
    .segs div { height: 24px; padding: 0 11px; border-radius: 6px; display: flex; align-items: center; font-size: 12px; cursor: pointer; }
    .tt2 .hd, .tt2 .tr { display: grid; align-items: center; }
    .tt2 .hd { height: 30px; border-bottom: 1px solid #ededed; }
    .tt2 .hd > * { font-size: 10.5px; font-weight: 500; color: #7c7c7c; padding: 0 10px; }
    .tt2 .tr { height: 44px; border-bottom: 1px solid #f3f3f3; animation: none; }
    .tt2 .tr > * { font-size: 12.5px; color: #383838; padding: 0 10px; min-width: 0; display: flex; align-items: center; gap: 8px; }
    .shr { height: 4px; border-radius: 2px; background: #ededed; flex-grow: 1; min-width: 30px; }
    .shr div { height: 4px; border-radius: 2px; }
    .ev { display: flex; align-items: center; gap: 11px; height: 46px; padding: 0 10px; border-radius: 9px; }
    .ev.on { background: #f5faff; box-shadow: inset 0 0 0 1px #d6eafc; }
    .ev .t { width: 38px; flex-shrink: 0; font-size: 11.5px; color: #999999; font-variant-numeric: tabular-nums; }
    .ev .s { flex-grow: 1; min-width: 0; font-size: 12.5px; color: #525252; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ev .s b { font-weight: 500; color: #171717; }
    .cat { height: 20px; padding: 0 7px; border-radius: 6px; font-size: 10.5px; font-weight: 500; display: inline-flex; align-items: center; flex-shrink: 0; }
    .day { font-size: 11px; font-weight: 500; color: #7c7c7c; margin: 14px 10px 4px; }
    .ic { display: flex; flex-direction: column; align-items: center; padding: 8px 4px 6px; border-radius: 10px; min-width: 0; }
    .icn { height: 60px; width: 72px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 5px; border-radius: 9px; }
    .ic.sel .icn { background: #f3f3f3; }
    .icl { margin-top: 7px; text-align: center; font-size: 12px; line-height: 1.4; color: #171717; max-width: 100%; }
    .icl span { padding: 1px 5px; border-radius: 5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
    .ic.sel .icl span { background: var(--ac); color: #fff; }
    .icm { display: flex; align-items: center; gap: 5px; margin-top: 4px; font-size: 11px; color: #999999; white-space: nowrap; }
    .fold { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 6px; border-radius: 10px; min-width: 0; }
    .fold.on { background: #f3f3f3; }
    .fold .fn { font-size: 12px; color: #171717; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .fold .fc2 { font-size: 11px; color: #999999; margin-top: -3px; }
    .pp { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; line-height: 1.65; color: #4a5763; }
    .pp .h { color: #999999; margin-top: 8px; display: flex; align-items: center; gap: 6px; }
    .pp .h:first-child { margin-top: 0; }`;

/* ---------- shared admin shell ---------- */
const NAV = [['people', 'People'], ['ent', 'Entitlements matrix'], ['tokens', 'Token dashboard'], ['budgets', 'Budgets'], ['channels', 'Channels & credentials'], ['audit', 'Audit log'], ['know', 'Knowledge & skills']];
const sidebar = cur => `
  <div style="width: 212px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; padding: 10px 8px;">
    <div style="padding: 4px 9px 12px; font-size: 14px; font-weight: 500;">Admin</div>
    <div class="lbl" style="margin-bottom: 5px;">Screens</div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
${NAV.map(([k, l]) => `      <div class="n${k === cur ? ' on' : ''}"><span>${l.replace('&', '&amp;')}</span>${k === 'channels' ? '<i>1</i>' : ''}</div>`).join('\n')}
    </div>
    <div style="margin-top: auto; padding: 10px 9px 4px; border-top: 1px solid #ededed;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;"><span style="font-size: 11px; color: #999999;">Tenant spend · Sep</span><span style="font-size: 11px; color: #525252;">HK$1,284</span></div>
      <div style="height: 4px; border-radius: 2px; background: #ededed;"><div style="width: 32%; height: 4px; border-radius: 2px; background: {{accent}};"></div></div>
    </div>
  </div>`;
const topbar = (title, hint, right = '') => `
    <div class="bar">
      <span class="h1">${title}</span>
      <span class="mut">${hint}</span>
      <div style="flex-grow: 1;"></div>${right}
      <div style="width: 220px; height: 28px; border: 1px solid #ededed; border-radius: 8px; background: #f8f8f8; display: flex; align-items: center; gap: 7px; padding: 0 9px;">
        <svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round;"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg><span style="font-size: 12px; color: #999999;">Search</span>
      </div>
    </div>`;
const page = o => shellPage({ module: 'Admin', gen: 'admin-screens.mjs', active: 'admin', me: 'michelle', extraCss: CSS, ...o });
const sw = (i, pre) => `<div class="sw" onClick="{{ ${pre}t${i} }}" style="background: {{${pre}b${i}}}; justify-content: {{${pre}j${i}}};" title="Pause or resume"><div></div></div>`;

/* =================================================================== */
/* TOKEN DASHBOARD                                                     */
/* =================================================================== */
const KEYS = [
  ['openrouter', '', 'OpenRouter', 'sm://or/key#01f', 'Every chat and writing bot', 'HK$1,021', true],
  ['google', '', 'Google Vertex · Veo', 'sm://gcp/sa#9b2', 'Video director', 'HK$248', 'err'],
  ['elevenlabs', '', 'ElevenLabs', 'sm://el/key#3c8', 'Voice and music', 'HK$88', true],
  ['azure', '', 'Azure Speech', 'sm://az/key#7d0', 'Cantonese transcription', 'HK$36', true],
  ['openai', '', 'OpenAI', 'sm://oa/key#b21', 'Backup transcription', 'HK$0', false],
];
const BOTS = [
  ['#4c7cf0', 'Personal agents', 'Chat · one per employee', ['chan', 'amy', 'leung', 'michelle'], '+8', 'gemini-2.5-pro', '6.9 M', 'HK$486.20', 38],
  ['#e5484d', 'Video director', 'Video Edit', ['chan', 'leung'], '', 'gemini-2.5-pro · Veo', '4.1 M', 'HK$412.80', 32],
  ['#30a46c', 'Script writer', 'Script', ['amy', 'leung'], '', 'gemini-2.5-pro', '3.2 M', 'HK$186.40', 15],
  ['#f5a524', 'Research scout', 'Market Research', ['amy'], '', 'deepseek-v3', '2.6 M', 'HK$96.10', 7],
  ['#8e4ec6', 'Comment replier', 'Research · comment inbox', ['leung'], '', 'qwen-max', '1.1 M', 'HK$58.30', 5],
  ['#999999', 'Bookkeeper', 'Accounting', ['michelle'], '', 'glm-4.6', '0.5 M', 'HK$44.80', 3],
];
const PEOPLE = [
  ['chan', 'Production', 'Video director, personal', '1,842', '4.21 M', '0.88 M', 'HK$412.80', 69, 'M1 12 7 10l6 1 6-4 6 2 6-5 6 1 6-4'],
  ['amy', 'Production', 'Script writer, research scout', '1,204', '3.06 M', '0.61 M', 'HK$286.40', 72, 'M1 13 7 12l6-2 6 1 6-3 6 1 6-4 6 2'],
  ['leung', 'Production', 'Comment replier, video', '988', '2.44 M', '0.52 M', 'HK$188.10', 94, 'M1 14 7 12l6-1 6-3 6 1 6-4 6-2 6-5'],
  ['michelle', 'Management', 'Bookkeeper, personal', '412', '0.92 M', '0.18 M', 'HK$64.20', 32, 'M1 10 7 11l6-1 6 1 6-1 6 0 6-1 6 1'],
];
const MODELS = [['gemini-2.5-pro', 48, '{{accent}}', 'HK$616.60'], ['deepseek-v3', 22, '#383838', 'HK$282.60'], ['qwen-max', 16, '#8d99a6', 'HK$205.50'], ['glm-4.6', 14, '#c7c7c7', 'HK$179.90']];
const spark = (d, hot) => `<svg viewBox="0 0 48 18" style="width: 48px; height: 18px; flex-shrink: 0; fill: none; stroke: ${hot ? '#e03636' : '{{accent}}'}; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;"><path d="${d}"/></svg>`;

const line = (seed, base, lift) => { let s = seed, v = base, d = ''; for (let i = 0; i < 30; i++) { s = (s * 16807) % 2147483647; v = Math.max(6, v + ((s / 2147483647) - .45) * lift); d += `${i ? 'L' : 'M'}${(i * 20.7).toFixed(1)} ${(140 - v).toFixed(1)}`; } return d; };
const chart = `
            <svg viewBox="0 0 600 150" preserveAspectRatio="none" style="width: 100%; height: 150px; display: block; fill: none; stroke-linecap: round; stroke-linejoin: round;">
              <g stroke="#f3f3f3" stroke-width="1"><path d="M0 30h600M0 65h600M0 100h600M0 135h600"/></g>
              <path d="${line(11, 60, 14)}" stroke="{{accent}}" stroke-width="2"/>
              <path d="${line(5, 38, 9)}" stroke="#383838" stroke-width="1.6"/>
              <path d="${line(23, 26, 7)}" stroke="#8d99a6" stroke-width="1.6"/>
              <path d="${line(41, 14, 5)}" stroke="#c7c7c7" stroke-width="1.6"/>
            </svg>`;

const byBot = `
          <div class="tt2">
            <div class="hd" style="grid-template-columns: minmax(0, 1.5fr) 118px minmax(0, 1fr) 70px 92px 118px 54px;"><div>Bot</div><div>Used by</div><div>Model</div><div style="justify-content: flex-end;">Tokens</div><div style="justify-content: flex-end;">Cost</div><div>Share</div><div>On</div></div>
${BOTS.map(([c, name, where, who, more, model, tok, cost, share], i) => `            <div class="tr" style="grid-template-columns: minmax(0, 1.5fr) 118px minmax(0, 1fr) 70px 92px 118px 54px;">
              <div>${px([[SPRITE.BOT]], { s: 1.5, pal: { B: c, l: '#30a46c' } })}<div style="min-width: 0;"><div class="el" style="color: #171717; font-weight: 500;">${name}</div><div class="el cap">${where}</div></div></div>
              <div style="gap: 0;">${who.map((k, j) => av(k, 20, ` margin-left: ${j ? -5 : 0}px; box-shadow: 0 0 0 2px #fff;`)).join('')}${more ? `<span class="cap" style="margin-left: 6px;">${more}</span>` : ''}</div>
              <div><span class="el" style="font-family: ui-monospace, monospace; font-size: 11px; color: #525252;">${model}</span></div>
              <div style="justify-content: flex-end; font-variant-numeric: tabular-nums;">${tok}</div>
              <div style="justify-content: flex-end; font-variant-numeric: tabular-nums;">${cost}</div>
              <div><div class="shr"><div style="width: ${share * 2.4}%; background: ${c};"></div></div><span class="cap" style="width: 26px; text-align: right;">${share}%</span></div>
              <div>${sw(i, 'b')}</div>
            </div>`).join('\n')}
          </div>`;
const byPerson = `
          <div class="tt2">
            <div class="hd" style="grid-template-columns: minmax(170px, 1.3fr) minmax(0, 1.2fr) 70px 70px 84px 92px 60px 104px;"><div>Person</div><div>Bots they use</div><div style="justify-content: flex-end;">Requests</div><div style="justify-content: flex-end;">Prompt</div><div style="justify-content: flex-end;">Completion</div><div style="justify-content: flex-end;">Cost</div><div>Trend</div><div>Cap</div></div>
${PEOPLE.map(([k, team, bots, req, pr, co, cost, cap, d]) => `            <div class="tr" style="grid-template-columns: minmax(170px, 1.3fr) minmax(0, 1.2fr) 70px 70px 84px 92px 60px 104px;">
              <div>${av(k, 22)}<div style="min-width: 0;"><div class="el" style="color: #171717; font-weight: 500;">${P[k][1]}</div><div class="el cap">${team}</div></div></div>
              <div><span class="el" style="color: #7c7c7c;">${bots}</span></div>
              <div style="justify-content: flex-end; font-variant-numeric: tabular-nums;">${req}</div>
              <div style="justify-content: flex-end; font-variant-numeric: tabular-nums;">${pr}</div>
              <div style="justify-content: flex-end; font-variant-numeric: tabular-nums;">${co}</div>
              <div style="justify-content: flex-end; font-variant-numeric: tabular-nums;">${cost}</div>
              <div>${spark(d, cap > 90)}</div>
              <div><div class="shr"><div style="width: ${cap}%; background: ${cap > 90 ? '#e03636' : '{{accent}}'};"></div></div><span class="cap" style="width: 28px; text-align: right; color: ${cap > 90 ? '#e03636' : '#999999'};">${cap}%</span></div>
            </div>`).join('\n')}
          </div>`;
const byModel = `
          <div style="display: flex; flex-direction: column; gap: 14px; padding: 8px 4px;">
${MODELS.map(([m, pct, c, cost]) => `            <div><div style="display: flex; align-items: baseline; gap: 10px; font-size: 12.5px;"><span style="font-family: ui-monospace, monospace; font-size: 12px;">${m}</span><span class="cap" style="margin-left: auto;">${cost}</span><span style="width: 36px; text-align: right; font-variant-numeric: tabular-nums;">${pct}%</span></div><div style="height: 6px; border-radius: 3px; background: #f3f3f3; margin-top: 6px;"><div style="width: ${pct * 2}%; height: 6px; border-radius: 3px; background: ${c};"></div></div></div>`).join('\n')}
            <div class="cap">Switch models per bot from Channels &amp; credentials, no deploy needed.</div>
          </div>`;

const tokensMain = `${topbar('Token dashboard', 'AI spend by bot, person and model', '<div class="chip">Person: All ' + CHEV.replace('<svg', '<svg style="width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2;"') + '</div><div class="chip">Team: All ' + CHEV.replace('<svg', '<svg style="width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2;"') + '</div><div class="chip">1 – 30 Sep 2026 ' + CHEV.replace('<svg', '<svg style="width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2;"') + '</div><div class="btn s">Export CSV</div>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 14px 20px 0; overflow: hidden;">
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;">
          <div class="kpi"><i>Spent this month</i><b>HK$1,284.60</b><span><span style="display: inline; color: #e03636;">+12%</span> on August</span></div>
          <div class="kpi"><i>Tokens</i><b>18.4 M</b><span>14.9 M prompt · 3.5 M completion</span></div>
          <div class="kpi"><i>Requests</i><b>6,112</b><span>204 a day on average</span></div>
          <div class="kpi"><i>API keys</i><b>3 of 5 on</b><span style="color: #e03636;">1 out of credit · 1 paused</span></div>
        </div>
        <div style="display: grid; grid-template-columns: minmax(0, 1fr) 318px; gap: 12px; margin-top: 12px;">
          <div class="card" style="padding: 12px 14px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;"><span class="lbl" style="padding: 0;">Spend by module</span><span class="cap">1–30 Sep · token ledger</span></div>
${chart}
            <div style="display: flex; gap: 14px; margin-top: 6px; flex-wrap: wrap;"><span class="cap"><b style="display: inline-block; width: 12px; height: 2px; border-radius: 1px; background: {{accent}}; vertical-align: 3px; margin-right: 2px;"></b> Video Edit</span><span class="cap"><b style="display: inline-block; width: 12px; height: 2px; border-radius: 1px; background: #383838; vertical-align: 3px; margin-right: 2px;"></b> Script</span><span class="cap"><b style="display: inline-block; width: 12px; height: 2px; border-radius: 1px; background: #8d99a6; vertical-align: 3px; margin-right: 2px;"></b> Research</span><span class="cap"><b style="display: inline-block; width: 12px; height: 2px; border-radius: 1px; background: #c7c7c7; vertical-align: 3px; margin-right: 2px;"></b> Other</span><span class="cap" style="margin-left: auto;">Updated 4 min ago · batched every 5 min</span></div>
          </div>
          <div class="card" style="padding: 10px 14px;">
            <div style="display: flex; align-items: center; margin-bottom: 2px;"><span class="lbl" style="padding: 0;">API keys</span><span class="cap" style="margin-left: auto;">Keys are never shown</span></div>
${KEYS.map(([ab, c, name, ref, use, cost, st], i) => `            <div class="kr">
              ${BRAND[ab](26)}
              <div style="min-width: 0; flex-grow: 1;"><div style="display: flex; align-items: center; gap: 6px;"><span style="font-size: 12.5px; color: #171717; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</span>${st === 'err' ? '<span class="bd red" style="height: 17px; font-size: 10px;">No credit</span>' : ''}</div><div class="cap" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${use} · ${cost}</div></div>
              ${st === 'err' ? '<span class="cap" style="color: #e03636;">Top up</span>' : sw(i, 'k')}
            </div>`).join('\n')}
          </div>
        </div>
        <div class="card" style="padding: 10px 14px 6px; margin-top: 12px;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
            <div class="segs">
              <div onClick="{{ vBot }}" style="background: {{sbBot}}; color: {{sfBot}}; box-shadow: {{ssBot}};">By bot</div>
              <div onClick="{{ vPerson }}" style="background: {{sbPerson}}; color: {{sfPerson}}; box-shadow: {{ssPerson}};">By person</div>
              <div onClick="{{ vModel }}" style="background: {{sbModel}}; color: {{sfModel}}; box-shadow: {{ssModel}};">By model</div>
            </div>
            <span class="cap">{{tableNote}}</span>
          </div>
          <sc-if value="{{isBot}}" hint-placeholder-val="{{ true }}">${byBot}
          </sc-if>
          <sc-if value="{{isPerson}}" hint-placeholder-val="{{ false }}">${byPerson}
          </sc-if>
          <sc-if value="{{isModel}}" hint-placeholder-val="{{ false }}">${byModel}
          </sc-if>
        </div>
      </div>
${rightPanel(['Agent', 'Alerts'], 'Agent', agentBlock({
  scope: 'Tenant · September',
  q: 'Why is spend up 12% on August?',
  tool: 'Read token ledger · 0.7 s',
  a: `<p>Almost all of it is the <b style="font-weight: 500;">Video director</b>: History of Greece used Veo for 4 generated shots, HK$138 more than last month.</p><p style="margin-top: 8px;">Leung Chi-hang is at 94% of his HK$200 cap. At this pace he stops in about two days, and you both get told when he does.</p>`,
  act: 'Raise his cap',
  place: 'Ask about AI spend…',
  guard: 'Figures lag up to 5 minutes',
  cost: 'HK$0.02',
}))}
    </div>`;

const tokensLogic = `
  renderVals() {
    var self = this, st = this.state, view = st.view || 'bot', acc = this.accent();
    var keyOn = st.keys || [true, null, true, true, false];
    var botOn = st.bots || [true, true, true, true, true, true];
    var v = { accent: acc, isBot: view === 'bot', isPerson: view === 'person', isModel: view === 'model',
      tableNote: view === 'bot' ? 'Pause a bot to stop all its calls. People keep their files.' : view === 'person' ? 'Cap is each person\\'s monthly budget, set in Budgets.' : 'Share of September spend' };
    ['Bot', 'Person', 'Model'].forEach(function (k) {
      var on = view === k.toLowerCase();
      v['sb' + k] = on ? '#ffffff' : 'transparent'; v['sf' + k] = on ? '#171717' : '#7c7c7c'; v['ss' + k] = on ? '0px 1px 2px rgba(0, 0, 0, 0.1)' : 'none';
      v['v' + k] = function () { self.setState({ view: k.toLowerCase() }); };
    });
    keyOn.forEach(function (on, i) {
      v['kb' + i] = on ? '#171717' : '#e2e2e2'; v['kj' + i] = on ? 'flex-end' : 'flex-start';
      v['kt' + i] = function () { var n = keyOn.slice(); n[i] = !on; self.setState({ keys: n }); };
    });
    botOn.forEach(function (on, i) {
      v['bb' + i] = on ? '#171717' : '#e2e2e2'; v['bj' + i] = on ? 'flex-end' : 'flex-start';
      v['bt' + i] = function () { var n = botOn.slice(); n[i] = !on; self.setState({ bots: n }); };
    });
    return this.side(v);
  }`;

/* =================================================================== */
/* AUDIT LOG                                                           */
/* =================================================================== */
const CAT = { Access: ['#e6f4ff', '#007be0'], Files: ['#f3f3f3', '#525252'], Publishing: ['#f3f0ff', '#6846e3'], Knowledge: ['#e4faeb', '#278f5e'], Money: ['#fff7d3', '#b36b00'], Settings: ['#f3f3f3', '#525252'] };
const EVENTS = [
  ['Today · 9 Sep', [
    ['10:14', 'michelle', '<b>Michelle Yip</b> gave <b>Priscilla Cheung</b> access to Finance', 'Access'],
    ['09:02', 'michelle', '<b>Michelle Yip</b> opened <b>master-004.mov</b>, a file she wasn’t given', 'Files', 'on'],
    ['08:40', null, '<b>System</b> warned <b>Leung Chi-hang</b> at 90% of his monthly AI cap', 'Money'],
  ]],
  ['Yesterday · 8 Sep', [
    ['17:41', 'chan', '<b>Chan Ka-ming</b> shared <b>Renders</b> with Production as editors', 'Files'],
    ['15:20', 'michelle', '<b>Michelle Yip</b> approved the X post for <b>Orange typography cut</b>', 'Publishing'],
    ['11:20', 'amy', '<b>Amy Wong</b> rolled <b>house-style</b> back from v6 to v5', 'Knowledge'],
  ]],
  ['7 Sep', [
    ['15:08', 'leung', '<b>Leung Chi-hang</b> sent <b>Porsche cat</b> to X', 'Publishing'],
    ['09:30', 'michelle', '<b>Michelle Yip</b> paused the <b>OpenAI</b> key', 'Settings'],
  ]],
];
const auditMain = `${topbar('Audit log', 'who did what, and when', '<div class="btn s">Export</div>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 14px 20px 0; overflow: hidden; display: flex; flex-direction: column;">
        <div style="display: flex; gap: 14px; align-items: center; padding: 14px 16px; border-radius: 12px; background: #fafafa;">
          ${docIcon('locked', 2.4)}
          <div style="min-width: 0; flex-grow: 1;">
            <div style="font-size: 13.5px; font-weight: 500;">A permanent record of everything that happens in the platform</div>
            <div style="font-size: 12.5px; line-height: 1.55; color: #525252; margin-top: 4px;">Every access, share, approval and settings change is written here with who did it and when. Nobody can edit or delete an entry, admins included. Use it to answer “who changed this?” or “who opened that file?”</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; margin: 14px 0 2px;">
          <div class="fc on">All</div><div class="fc">Access</div><div class="fc">Files</div><div class="fc">Publishing</div><div class="fc">Knowledge</div><div class="fc">Money</div><div class="fc">Settings</div>
          <div style="flex-grow: 1;"></div>
          <div class="fc">Anyone ${CHEV.replace('<svg', '<svg style="width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2;"')}</div><div class="fc">Last 7 days ${CHEV.replace('<svg', '<svg style="width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2;"')}</div>
        </div>
        <div style="display: flex; gap: 16px; min-height: 0; flex-grow: 1;">
          <div style="flex-grow: 1; min-width: 0;">
${EVENTS.map(([day, evs]) => `            <div class="day">${day}</div>
${evs.map(([t, who, s, cat, on]) => `            <div class="ev${on ? ' on' : ''}"><span class="t">${t}</span>${who ? av(who, 22) : px([[SPRITE.BOT]], { s: 1.8, pal: { B: '#9aa5b1', l: '#9aa5b1' } })}<span class="s">${s}</span>${on ? '<span class="bd amb" style="height: 20px;">Admin access</span>' : ''}<span class="cat" style="background: ${CAT[cat][0]}; color: ${CAT[cat][1]};">${cat}</span></div>`).join('\n')}`).join('\n')}
          </div>
          <div style="width: 262px; flex-shrink: 0; padding-top: 14px;">
            <div class="card" style="padding: 14px;">
              <div style="display: flex; align-items: center; gap: 8px;">${av('michelle', 26)}<div style="min-width: 0;"><div style="font-size: 12.5px; font-weight: 500;">Michelle Yip</div><div class="cap">Admin · 9 Sep 09:02</div></div></div>
              <div style="font-size: 12.5px; line-height: 1.55; color: #383838; margin-top: 12px;">Opened <b style="font-weight: 500;">master-004.mov</b> in Renders. The file wasn’t shared with her. Admins can open any file, and every time they do it lands here.</div>
              <div class="kv" style="margin-top: 10px; font-size: 12px;"><span>Action</span><span style="font-family: ui-monospace, monospace; font-size: 11px;">file.read</span></div>
              <div class="kv" style="font-size: 12px;"><span>From</span><span>203.0.113.7 · Hong Kong</span></div>
              <div class="kv" style="font-size: 12px;"><span>Device</span><span>Chrome on macOS</span></div>
              <div class="kv" style="font-size: 12px; border: none;"><span>Entry</span><span style="display: flex; align-items: center; gap: 5px;">#48,210 ${okDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 14px; height: 14px; border-radius: 7px')}</span></div>
              <div class="cap" style="line-height: 1.5; margin-top: 4px;">The tick means this entry still matches the chain of entries before it, so nothing has been altered.</div>
              <div style="display: flex; gap: 6px; margin-top: 12px;"><div class="btn s" style="flex: 1; justify-content: center; height: 28px;">Open file</div><div class="btn s" style="flex: 1; justify-content: center; height: 28px;">Her activity</div></div>
            </div>
          </div>
        </div>
      </div>
${rightPanel(['Agent', 'Saved views'], 'Agent', agentBlock({
  scope: 'Audit log · last 30 days',
  q: 'Has anyone opened files they weren’t given this month?',
  tool: 'Searched 48,210 entries · 0.9 s',
  a: `<p>Only Michelle Yip, twice, both as admin: <b style="font-weight: 500;">master-004.mov</b> today and <b style="font-weight: 500;">payroll-aug.xlsx</b> on 2 Sep.</p><p style="margin-top: 8px;">Admins are allowed to, but it is always recorded here, so the rest of the team can see it happened.</p>`,
  act: 'Show both entries',
  place: 'Ask the audit log…',
  guard: 'Entries can’t be edited or deleted',
  cost: 'HK$0.01',
}))}
    </div>`;

/* =================================================================== */
/* KNOWLEDGE & SKILLS                                                  */
/* =================================================================== */
const BOLT = ['..kkk', '.kyyk', 'kyyk.', 'kkyyk', '.kyk.', 'kyk..', 'kk...'];
const BUBBLE = ['kkkkkkk', 'kwwwwwk', 'kwbwbwk', 'kwwwwwk', 'kkkkkkk', '.kk....', 'k......'];
const BRUSH = ['....kk', '...krk', '..krk.', '.kkk..', 'kttk..', 'kkk...'];
const OFF = { k: '#b0b0b0', b: '#c7c7c7', w: '#fafafa' };
const fileIcon = (kind, off) => docIcon(kind, 3, !!off);
const FOLDERS = [['Instructions', 3], ['Style guides', 4], ['Skills', 9, 'on'], ['Worked examples', 12], ['Approved scripts', 41, 'kb'], ['Brand guidelines', 6, 'kb']];
const FILES = [
  ['script-beats-procedure.md', 'Module · Script', 'v3', 1],
  ['comment-reply-procedure.md', 'Module · Research', 'v2'],
  ['receipt-extraction.md', 'Module · Accounting', 'v4'],
  ['shot-list-from-beats.md', 'Module · Video', 'v1'],
  ['cantonese-subtitles.md', 'Role · Editor', 'v2'],
  ['job-description-draft.md', 'Module · HR', 'v1'],
  ['clause-review-steps.md', 'Module · Legal', 'v2'],
  ['monthly-report-outline.md', 'Module · Finance', 'v1'],
  ['old-caption-rules.md', 'Tenant', 'v1', 0, 'off'],
];
const knowMain = `${topbar('Knowledge &amp; skills', 'what the bots are taught', '<div class="btn s">New folder</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Upload Markdown</div>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 12px 20px 0; overflow: hidden; display: flex; flex-direction: column;">
        <div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px;">
${FOLDERS.map(([n, c, f]) => `          <div class="fold${f === 'on' ? ' on' : ''}">${ICON.folder(2.5)}<div class="fn">${n}</div><div class="fc2">${c} ${f === 'kb' ? 'docs · searched' : 'files'}</div></div>`).join('\n')}
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin: 12px 2px 4px;">
          <span style="font-size: 12px; color: #999999;">Knowledge &amp; skills</span><svg viewBox="0 0 24 24" style="width: 11px; height: 11px; stroke: #c7c7c7; fill: none; stroke-width: 2; stroke-linecap: round;"><path d="m9.5 5.5 6 6.5-6 6.5"/></svg><span style="font-size: 13px; font-weight: 500;">Skills</span>
          <span class="cap">Step-by-step procedures, each with examples</span>
          <div style="flex-grow: 1;"></div><div class="fc">Scope: All ${CHEV.replace('<svg', '<svg style="width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2;"')}</div>
        </div>
        <div style="display: flex; gap: 16px; min-height: 0; flex-grow: 1;">
          <div style="flex-grow: 1; min-width: 0;">
            <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px 4px;">
${FILES.map(([n, scope, v, sel, off]) => `              <div class="ic${sel ? ' sel' : ''}"${off ? ' style="opacity: .6;"' : ''}><div class="icn">${fileIcon('skill', off)}</div><div class="icl"><span>${n}</span></div><div class="icm">${off ? 'Off' : scope.replace('Module · ', '')} · ${v}</div></div>`).join('\n')}
            </div>
            <div style="display: flex; gap: 14px; margin-top: 12px; padding: 0 4px;"><span class="cap" style="display: flex; align-items: center; gap: 6px;"><span class="dot" style="background: #6846e3;"></span>Skill</span><span class="cap" style="display: flex; align-items: center; gap: 6px;"><span class="dot" style="background: #0ea5e9;"></span>Example</span><span class="cap" style="display: flex; align-items: center; gap: 6px;"><span class="dot" style="background: #d6409f;"></span>Style</span><span class="cap">Grey files are switched off</span></div>
          </div>
          <div style="width: 264px; flex-shrink: 0;">
            <div class="card" style="padding: 14px;">
              <div style="display: flex; align-items: center; gap: 10px;">${fileIcon('skill')}<div style="min-width: 0;"><div style="font-size: 12.5px; font-weight: 500; word-break: break-all;">script-beats-procedure.md</div><div class="cap" style="margin-top: 2px;">Skill · 6 steps · 3 examples</div></div></div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding: 9px 10px; border-radius: 9px; background: #f8f8f8;"><span style="font-size: 12.5px;">Active</span><div class="sw" style="background: #171717; justify-content: flex-end;"><div></div></div></div>
              <div class="kv" style="margin-top: 6px; font-size: 12px;"><span>Applies to</span><span>Script writer bot</span></div>
              <div class="kv" style="font-size: 12px; border: none;"><span>Scope</span><span>Module · Script</span></div>
              <div class="lbl" style="padding: 0; margin: 10px 0 4px;">Versions</div>
              <div class="li" style="padding: 8px 0;"><span class="bd blue" style="height: 18px;">v3</span><div style="min-width: 0; flex-grow: 1;"><div class="a" style="font-size: 12px;">Added the beat-length rule</div><div class="b">Amy Wong · 2 Sep</div></div></div>
              <div class="li" style="padding: 8px 0;"><span class="bd gray" style="height: 18px;">v2</span><div style="min-width: 0; flex-grow: 1;"><div class="a" style="font-size: 12px;">Three new examples</div><div class="b">Amy Wong · 21 Aug</div></div><span style="font-size: 11.5px; color: {{accent}}; align-self: center;">Diff</span></div>
              <div class="li" style="padding: 8px 0; border: none;"><span class="bd gray" style="height: 18px;">v1</span><div style="min-width: 0; flex-grow: 1;"><div class="a" style="font-size: 12px;">First upload</div><div class="b">Michelle Yip · 2 Jul</div></div><span style="font-size: 11.5px; color: {{accent}}; align-self: center;">Roll back</span></div>
            </div>
          </div>
        </div>
      </div>
${rightPanel(['Prompt preview', 'Agent'], 'Prompt preview', `
        <div style="flex-shrink: 0; padding: 11px 13px; border-bottom: 1px solid #f3f3f3; display: flex; align-items: center; gap: 8px;">
          <span class="cap">What the</span><div class="fc" style="height: 25px;">${px([[SPRITE.BOT]], { s: 1, pal: { B: '#30a46c' } })}Script writer ${CHEV.replace('<svg', '<svg style="width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2;"')}</div><span class="cap">receives</span>
        </div>
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 12px 13px;">
          <div class="pp" style="background: #f8f8f8; border-radius: 10px; padding: 12px;">
            <div class="h">1 · Instructions</div>
            You write for Aura Farmers, a Hong Kong video studio. Output Traditional Chinese with Hong Kong usage.
            <div class="h">2 · Style guide · house-style v5</div>
            Name the hour instead of mood words. Sound direction belongs in the shot list. Stay within 5% of the target length.
            <div class="h">3 · Skills, found when relevant</div>
            script-beats-procedure.md · 6 steps
            <div class="h">4 · Examples, found when relevant</div>
            cantonese-tone-examples.md · 4 excerpts<br>Approved scripts · 3 closest of 41
          </div>
          <div style="margin-top: 12px;"><div style="display: flex; justify-content: space-between;"><span class="cap">4,180 of 8,000 tokens</span><span class="cap">52%</span></div><div style="height: 4px; border-radius: 2px; background: #ededed; margin-top: 6px;"><div style="width: 52%; height: 4px; border-radius: 2px; background: {{accent}};"></div></div></div>
          <div class="cap" style="line-height: 1.5; margin-top: 10px;">Sections always go in this order. If a file would push past the limit, the oldest examples drop first.</div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 10px 14px 12px;" class="cap">Every upload, switch and rollback is in the Audit log.</div>`)}
    </div>`;

/* =================================================================== */
const out = [
  { file: 'Adm-Tokens.dc.html', title: 'Token dashboard', side: sidebar('tokens'), main: tokensMain, logic: tokensLogic },
  { file: 'Adm-Audit.dc.html', title: 'Audit log', side: sidebar('audit'), main: auditMain },
  { file: 'Adm-Know.dc.html', title: 'Knowledge & skills', side: sidebar('know'), main: knowMain },
];
for (const o of out) fs.writeFileSync(path.join(DIR, o.file), page(o));
console.log('wrote', out.map(o => o.file).join(', '));
