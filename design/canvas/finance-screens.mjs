/**
 * Finance, hand-authored screens (Cost dashboard stays generated).
 *
 *   Fin-Budget   where budget numbers come from (template → amounts →
 *                actuals), grouped lines, and a real Edit mode (versioned,
 *                approved), answers "how is this added or changed?"
 *   Fin-Cash     projection with its inputs visible; one small "Indicative"
 *                tag instead of a banner (§4.8 still labels it)
 *   Fin-Spend    how someone raises a request: form + live approver chain
 *                from the configured thresholds (§4.8)
 *   Fin-Reports  what a report draft is for, with every figure's source
 *
 * Run:  node finance-screens.mjs
 */
import fs from 'fs';
import path from 'path';
import { page as shellPage, P, av, px, SPRITE, ICON, docIcon, rightPanel, agentBlock, okDot, warnDot, moduleSidebar, topbar, chip, cb, TICK } from './shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);

const CSS = `
    .kpi { border: 1px solid #ededed; border-radius: 12px; padding: 12px 14px; background: #fff; min-width: 0; }
    .kpi i { font-style: normal; display: block; font-size: 11px; color: #999999; }
    .kpi b { display: block; font-size: 20px; font-weight: 500; margin-top: 5px; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
    .kpi span { display: block; font-size: 11px; color: #7c7c7c; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .step { flex: 1 1 0; min-width: 0; display: flex; gap: 10px; align-items: flex-start; }
    .step .nb { width: 20px; height: 20px; border-radius: 10px; background: #fff; border: 1px solid #e2e2e2; font-size: 11px; font-weight: 600; color: #525252; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .step .a { font-size: 12.5px; font-weight: 500; color: #171717; }
    .step .b { font-size: 11.5px; color: #7c7c7c; line-height: 1.45; margin-top: 2px; }
    .bg2 .hd, .bg2 .tr { display: grid; grid-template-columns: minmax(0, 1fr) 108px 200px 104px 140px; align-items: center; }
    .bg2 .hd { height: 30px; border-bottom: 1px solid #ededed; }
    .bg2 .hd > * { font-size: 10.5px; font-weight: 500; color: #7c7c7c; padding: 0 10px; }
    .bg2 .tr { height: 38px; border-bottom: 1px solid #f3f3f3; animation: none; }
    .bg2 .tr > * { font-size: 12.5px; color: #383838; padding: 0 10px; min-width: 0; display: flex; align-items: center; gap: 8px; }
    .bg2 .num { justify-content: flex-end; font-variant-numeric: tabular-nums; }
    .bg2 .grp { height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 10px; background: #fafafa; border-bottom: 1px solid #f3f3f3; font-size: 11.5px; font-weight: 500; color: #525252; }
    .ub { flex-grow: 1; height: 5px; border-radius: 3px; background: #ededed; overflow: hidden; }
    .ub div { height: 5px; border-radius: 3px; }
    .cell { height: 28px; width: 100%; border: 1px solid #e2e2e2; border-radius: 7px; background: #fff; display: flex; align-items: center; justify-content: flex-end; padding: 0 8px; font-variant-numeric: tabular-nums; }
    .cell.ch { border-color: #f5c46b; background: #fffbf0; }
    .inp { min-height: 34px; border-radius: 8px; background: #f3f3f3; display: flex; align-items: center; gap: 8px; padding: 0 11px; font-size: 13px; color: #171717; }
    .fl { font-size: 11px; font-weight: 500; color: #7c7c7c; margin-bottom: 6px; }
    .rq { display: flex; gap: 10px; padding: 10px; border-radius: 10px; }
    .rq.on { background: #f5faff; box-shadow: inset 0 0 0 1px #d6eafc; }
    .chain { display: flex; align-items: center; gap: 8px; }
    .chain .p { display: flex; align-items: center; gap: 8px; padding: 7px 10px 7px 7px; border-radius: 10px; background: #fff; border: 1px solid #ededed; min-width: 0; }
    .src { display: inline-flex; align-items: center; gap: 4px; height: 18px; padding: 0 6px; border-radius: 5px; background: #f3f3f3; color: #7c7c7c; font-size: 10.5px; font-weight: 500; vertical-align: 1px; white-space: nowrap; }
    .doc { font-size: 13.5px; line-height: 1.75; color: #2b343d; }
    .doc h3 { margin: 18px 0 6px; font-size: 13px; font-weight: 600; color: #171717; }
    .doc .ai { background: #f5faff; border-radius: 3px; box-shadow: 0 0 0 2px #f5faff; }
    .tb2 .hd, .tb2 .tr { display: grid; align-items: center; }
    .tb2 .hd { height: 28px; border-bottom: 1px solid #ededed; }
    .tb2 .hd > * { font-size: 10.5px; font-weight: 500; color: #7c7c7c; padding: 0 9px; }
    .tb2 .tr { height: 36px; border-bottom: 1px solid #f3f3f3; animation: none; }
    .tb2 .tr > * { font-size: 12.5px; color: #383838; padding: 0 9px; min-width: 0; display: flex; align-items: center; gap: 7px; }`;

const NAV = [['budget', 'Budget'], ['cash', 'Cash-flow projection'], ['cost', 'Cost dashboard'], ['spend', 'Spend requests'], ['reports', 'Report drafts']];
const side = cur => moduleSidebar('Finance', NAV, cur, {
  badges: { spend: '<i>2</i>' },
  footer: `<div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;"><span style="font-size: 11px; color: #999999;">Q3 budget used</span><span style="font-size: 11px; color: #525252;">97%</span></div><div style="height: 4px; border-radius: 2px; background: #ededed;"><div style="width: 97%; height: 4px; border-radius: 2px; background: #db7706;"></div></div>`,
});
const page = o => shellPage({ module: 'Finance', gen: 'finance-screens.mjs', active: 'fin', me: 'michelle', extraCss: CSS, ...o });
const fmt = n => 'HK$' + n.toLocaleString('en-US');

/* =================================================================== */
/* BUDGET                                                              */
/* =================================================================== */
const LINES = [
  ['Production', [['Equipment', 320000, 284100, 38], ['Contractors', 380000, 412800, 51, 420000], ['Licensing & archive', 180000, 196400, 12], ['Travel & locations', 60000, 41200, 9]]],
  ['Platform', [['AI consumption', 120000, 88600, 'ledger'], ['Software subscriptions', 48000, 45900, 14]]],
  ['Studio', [['Lease', 210000, 210000, 3], ['Insurance', 24000, 24000, 1]]],
];
const used = (b, a) => Math.round(a / b * 100);
const budgetRows = edit => LINES.map(([dept, rows]) => {
  const tb = rows.reduce((s, r) => s + r[1], 0), ta = rows.reduce((s, r) => s + r[2], 0);
  return `            <div class="grp">${dept}<span class="cap" style="margin-left: auto; font-weight: 420;">${fmt(ta)} of ${fmt(tb)}</span></div>
${rows.map(([name, b, a, src, nb]) => { const u = used(b, a); const over = a > b; return `            <div class="tr">
              <div style="padding-left: 22px;"><span class="el" style="color: #171717;">${name.replace('&', '&amp;')}</span></div>
              <div class="num">${edit ? `<div class="cell${nb ? ' ch' : ''}">${fmt(nb || b)}</div>` : fmt(b)}</div>
              <div class="num" style="gap: 6px;">${fmt(a)}<span class="src">${src === 'ledger' ? 'ledger' : src + ' entries'}</span></div>
              <div class="num" style="color: ${over ? '#e03636' : '#383838'};">${over ? '−' + fmt(a - b).replace('HK$', 'HK$') : fmt(b - a)}</div>
              <div><div class="ub"><div style="width: ${Math.min(100, u)}%; background: ${over ? '#e03636' : u > 90 ? '#db7706' : '{{accent}}'};"></div></div><span style="width: 36px; text-align: right; font-size: 11.5px; color: ${over ? '#e03636' : '#7c7c7c'}; font-variant-numeric: tabular-nums;">${u}%</span></div>
            </div>`; }).join('\n')}${edit ? `
            <div class="tr" style="height: 34px;"><div style="padding-left: 22px; color: {{accent}}; font-size: 12px;">+ Add a line to ${dept}</div><div></div><div></div><div></div><div></div></div>` : ''}`;
}).join('\n');

const budgetMain = `${topbar('Budget', 'Q3 2026 · July to September', chip('Q3 2026') + chip('All departments'))}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 14px 20px 0; overflow: hidden;">
        <div style="display: flex; gap: 14px; padding: 12px 14px; border-radius: 12px; background: #fafafa;">
          <div class="step"><span class="nb">1</span><div><div class="a">Template</div><div class="b">Lines and departments come from the client’s budget template. <span style="color: {{accent}};">Import a new one</span></div></div></div>
          <div class="step"><span class="nb">2</span><div><div class="a">Budget amounts</div><div class="b">Finance sets them here. Every change is a new version and needs approval.</div></div></div>
          <div class="step"><span class="nb">3</span><div><div class="a">Actuals</div><div class="b">Fill in by themselves from confirmed Accounting entries. Nobody types them.</div></div></div>
        </div>

        <sc-if value="{{viewing}}" hint-placeholder-val="{{ true }}">
        <div style="display: flex; align-items: center; gap: 10px; margin: 14px 0 8px;">
          <span class="bd gray">v3 · approved 1 Jul by Michelle Yip</span><span class="cap">3 versions</span>
          <div style="flex-grow: 1;"></div>
          <div class="btn s">Import template</div>
          <div class="btn" onClick="{{ startEdit }}" style="background: {{accent}}; color: #fff; font-weight: 500; cursor: pointer;"><svg viewBox="0 0 24 24"><path d="M4.5 19.5h4l10-10-4-4-10 10z"/><path d="m13 7 4 4"/></svg>Edit budget</div>
        </div>
        </sc-if>
        <sc-if value="{{editing}}" hint-placeholder-val="{{ false }}">
        <div style="display: flex; align-items: center; gap: 10px; margin: 14px 0 8px; padding: 8px 10px 8px 12px; border-radius: 10px; background: #fffbf0; border: 1px solid #f7dcb0;">
          <span style="font-size: 12.5px; color: #8a5a0d;"><b style="font-weight: 500;">Editing draft v4.</b> 1 change. Michelle Yip approves it before it replaces v3.</span>
          <div style="flex-grow: 1;"></div>
          <div class="btn s" onClick="{{ stopEdit }}" style="cursor: pointer; background: #fff;">Cancel</div>
          <div class="btn s" style="background: #fff;">Save draft</div>
          <div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Send for approval</div>
        </div>
        </sc-if>

        <div class="bg2" style="border: 1px solid #ededed; border-radius: 12px; overflow: hidden;">
          <div class="hd"><div>Line</div><div style="justify-content: flex-end; display: flex;">Budget</div><div style="justify-content: flex-end; display: flex;">Actual so far</div><div style="justify-content: flex-end; display: flex;">Left</div><div>Used</div></div>
          <sc-if value="{{viewing}}" hint-placeholder-val="{{ true }}">
${budgetRows(false)}
          </sc-if>
          <sc-if value="{{editing}}" hint-placeholder-val="{{ false }}">
${budgetRows(true)}
          </sc-if>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 10px;"><span class="cap">Total ${fmt(1342000)} budget · ${fmt(1303000)} spent · 97%</span><span class="cap">Actuals updated when an entry is confirmed</span></div>
      </div>
${rightPanel(['Agent', 'Versions'], 'Agent', agentBlock({
  scope: 'Budget · Q3 2026',
  q: 'Where will we go over by the end of Q3?',
  tool: 'Read budget v3, 128 entries · 0.8 s',
  a: `<p>Two lines are already over: <b style="font-weight: 500;">Contractors</b> by HK$32,800 (the two-camera night shoots) and <b style="font-weight: 500;">Licensing &amp; archive</b> by HK$16,400.</p><p style="margin-top: 8px;">Travel still has HK$18,800 left and Equipment HK$35,900, so the quarter lands about 3% under overall.</p>`,
  act: 'Draft a budget change',
  place: 'Ask about the budget…',
  guard: 'Uses only confirmed entries',
  cost: 'HK$0.02',
}))}
    </div>`;
const budgetLogic = `
  renderVals() {
    var self = this, e = !!this.state.e;
    return this.side({ accent: this.accent(), viewing: !e, editing: e,
      startEdit: function () { self.setState({ e: true }); }, stopEdit: function () { self.setState({ e: false }); } });
  }`;

/* =================================================================== */
/* CASH-FLOW                                                           */
/* =================================================================== */
const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAL = [1.98, 2.06, 2.14, 2.41, 2.33, 2.61];
const HI = [0, 0, 0, 2.52, 2.51, 2.86], LO = [0, 0, 0, 2.30, 2.15, 2.36];
const X = i => 30 + i * 108, Y = v => 196 - (v - 1.6) * 130;
const cashChart = `
            <svg viewBox="0 0 600 220" preserveAspectRatio="none" style="width: 100%; height: 210px; display: block;">
              <g stroke="#f3f3f3" stroke-width="1"><path d="M30 40h570M30 92h570M30 144h570M30 196h570"/></g>
              <g fill="#999999" font-size="10" font-family="Inter, sans-serif"><text x="0" y="44">2.8 M</text><text x="0" y="96">2.4 M</text><text x="0" y="148">2.0 M</text><text x="0" y="200">1.6 M</text></g>
              <path d="M${X(2)} ${Y(BAL[2])} ${[3, 4, 5].map(i => `L${X(i)} ${Y(HI[i])}`).join(' ')} ${[5, 4, 3].map(i => `L${X(i)} ${Y(LO[i])}`).join(' ')} Z" fill="{{accent}}" opacity=".08"/>
              <path d="M${X(0)} 196 ${[0, 1, 2].map(i => `L${X(i)} ${Y(BAL[i])}`).join(' ')} L${X(2)} 196 Z" fill="{{accent}}" opacity=".1"/>
              <path d="${[0, 1, 2].map(i => `${i ? 'L' : 'M'}${X(i)} ${Y(BAL[i])}`).join(' ')}" fill="none" stroke="{{accent}}" stroke-width="2.2" stroke-linejoin="round"/>
              <path d="M${X(2)} ${Y(BAL[2])} ${[3, 4, 5].map(i => `L${X(i)} ${Y(BAL[i])}`).join(' ')}" fill="none" stroke="{{accent}}" stroke-width="2" stroke-dasharray="5 5" stroke-linejoin="round"/>
              <line x1="${X(2)}" y1="30" x2="${X(2)}" y2="196" stroke="#c7c7c7" stroke-dasharray="3 3"/>
              <circle cx="${X(2)}" cy="${Y(BAL[2])}" r="4" fill="#fff" stroke="{{accent}}" stroke-width="2"/>
              <g fill="#999999" font-size="10.5" font-family="Inter, sans-serif">${MONTHS.map((m, i) => `<text x="${X(i) - 8}" y="214">${m}</text>`).join('')}</g>
              <text x="${X(2) + 6}" y="38" fill="#7c7c7c" font-size="10.5" font-family="Inter, sans-serif">Today</text>
            </svg>`;
const FLOWS = [
  ['in', 'HK Tourism Board campaign, final invoice', '15 Oct', 480000, 'Confirmed', 'grn', 'michelle'],
  ['in', 'Kowloon Bay Mall retainer', 'Monthly', 120000, 'Confirmed', 'grn', 'michelle'],
  ['in', 'Harbourfront series pitch', '20 Nov', 260000, 'Possible', 'gray', 'amy'],
  ['out', 'Payroll', 'Monthly', 310000, 'Confirmed', 'grn', 'michelle'],
  ['out', 'Studio lease, Kwun Tong', 'Monthly', 70000, 'Confirmed', 'grn', 'michelle'],
  ['out', 'Second camera body', 'Oct', 46800, 'Awaiting approval', 'amb', 'chan'],
];
const cashMain = `${topbar('Cash-flow projection', 'the next three months', chip('Jul – Dec 2026'))}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 14px 20px 0; overflow: hidden;">
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;">
          <div class="kpi"><i>Cash today</i><b>HK$2,140,800</b><span>from bank statements, 9 Sep</span></div>
          <div class="kpi"><i>In 90 days</i><b>HK$2,610,400</b><span>could be 2.36 M to 2.86 M</span></div>
          <div class="kpi"><i>Lowest point</i><b>HK$2,330,000</b><span>end of November</span></div>
          <div class="kpi"><i>Runway</i><b>14 months</b><span>at the current burn</span></div>
        </div>
        <div class="card" style="padding: 12px 14px 8px; margin-top: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;"><span class="lbl" style="padding: 0;">Cash balance</span><span class="bd gray" style="height: 18px; font-size: 10.5px;">Indicative</span><span class="cap">Jul – Dec 2026 · bank statements, then the entries below</span><div style="flex-grow: 1;"></div><span class="cap"><b style="display: inline-block; width: 12px; height: 2px; border-radius: 1px; background: {{accent}}; vertical-align: 3px; margin-right: 2px;"></b> actual</span><span class="cap"><b style="color: {{accent}};">- -</b> projected, shaded = range</span></div>
${cashChart}
        </div>
        <div style="display: flex; align-items: center; margin: 14px 0 6px;"><span class="lbl" style="padding: 0;">What the projection is built from</span><span class="cap" style="margin-left: 8px;">6 entries · change one and the chart updates</span><div style="flex-grow: 1;"></div><div class="btn s" style="height: 28px;">+ Money in</div><div class="btn s" style="height: 28px; margin-left: 6px;">+ Money out</div></div>
        <div class="tb2" style="border: 1px solid #ededed; border-radius: 12px; overflow: hidden;">
          <div class="hd" style="grid-template-columns: 32px minmax(0, 1fr) 96px 120px 150px 110px;"><div></div><div>Entry</div><div>When</div><div style="justify-content: flex-end; display: flex;">Amount</div><div>How sure</div><div>Added by</div></div>
${FLOWS.map(([dir, name, when, amt, sure, tone, who]) => `          <div class="tr" style="grid-template-columns: 32px minmax(0, 1fr) 96px 120px 150px 110px;"><div><span style="width: 20px; height: 20px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; background: ${dir === 'in' ? '#e4faeb' : '#ffe7e7'}; color: ${dir === 'in' ? '#278f5e' : '#e03636'};">${dir === 'in' ? '+' : '−'}</span></div><div><span class="el" style="color: #171717;">${name}</span></div><div style="color: #7c7c7c;">${when}</div><div style="justify-content: flex-end; font-variant-numeric: tabular-nums; color: ${dir === 'in' ? '#278f5e' : '#383838'};">${dir === 'in' ? '+' : '−'}${fmt(amt)}</div><div><span class="bd ${tone}">${sure}</span></div><div>${av(who, 18)}<span class="el">${P[who][1].split(' ')[0]}</span></div></div>`).join('\n')}
        </div>
      </div>
${rightPanel(['Agent', 'Scenarios'], 'Agent', agentBlock({
  scope: 'Cash-flow · next 90 days',
  q: 'What if the Tourism Board pays a month late?',
  tool: 'Re-ran the projection · 0.2 s',
  a: `<p>The lowest point moves to <b style="font-weight: 500;">HK$1,850,000</b> in mid-November, still above the HK$1.5 M floor you set.</p><p style="margin-top: 8px;">Runway drops from 14 to 12 months. Nothing needs to move yet.</p>`,
  act: 'Save as a scenario',
  place: 'Ask a what-if…',
  guard: 'Projections are indicative',
  cost: 'HK$0.01',
}))}
    </div>`;

/* =================================================================== */
/* SPEND REQUESTS                                                      */
/* =================================================================== */
const REQS = [
  ['Drone permit and operator, Tai O', 'HK$18,500', 'Draft', 'gray', 'chan', 'now', 'on'],
  ['Second camera body', 'HK$46,800', 'With the CFO', 'amb', 'chan', '30 Aug'],
  ['Stock footage licence pack', 'HK$12,400', 'Approved', 'grn', 'leung', '28 Aug'],
  ['AI credit top-up', 'HK$30,000', 'More info asked', 'blue', 'amy', '27 Aug'],
];
const spendMain = `${topbar('Spend requests', 'ask for money, see who approves', '<div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">+ New request</div>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="width: 268px; flex-shrink: 0; border-right: 1px solid #ededed; padding: 12px 10px; overflow: hidden;">
        <div style="display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3f3f3; margin-bottom: 10px;">
          <div style="flex: 1; height: 26px; border-radius: 6px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 500;">Mine</div>
          <div style="flex: 1.4; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 12px; color: #7c7c7c; white-space: nowrap;">To approve <span class="bd red" style="height: 16px; font-size: 10px; padding: 0 5px;">2</span></div>
          <div style="flex: 1; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #7c7c7c;">All</div>
        </div>
${REQS.map(([t, amt, st, tone, who, when, on]) => `        <div class="rq${on ? ' on' : ''}">${av(who, 26)}<div style="min-width: 0; flex-grow: 1;"><div style="display: flex; align-items: baseline; gap: 8px;"><span style="font-size: 12.5px; font-weight: 500; color: #171717; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1; min-width: 0;">${t}</span><span class="cap" style="white-space: nowrap; flex-shrink: 0;">${when}</span></div><div style="display: flex; align-items: center; gap: 6px; margin-top: 5px;"><span style="font-size: 12px; font-variant-numeric: tabular-nums;">${amt}</span><span class="bd ${tone}" style="height: 18px; font-size: 10.5px;">${st}</span></div></div></div>`).join('\n')}
      </div>
      <div style="flex-grow: 1; min-width: 0; padding: 16px 22px 0; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 16px; font-weight: 500;">New spend request</span><span class="bd gray">Draft</span><span class="cap" style="margin-left: auto;">Saved 1 min ago</span></div>
        <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px;">
          <div style="grid-column: 1 / -1;"><div class="fl">What is it for?</div><div class="inp">Drone permit and licensed operator for the Tai O stilt houses shoot</div></div>
          <div><div class="fl">Amount</div><div class="inp" style="font-variant-numeric: tabular-nums;"><span style="color: #999999;">HK$</span>18,500</div></div>
          <div><div class="fl">Needed by</div><div class="inp">26 Sep 2026</div></div>
          <div><div class="fl">Budget line</div><div class="inp"><span style="flex-grow: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Travel &amp; locations</span><span class="cap" style="white-space: nowrap;">HK$18,800 left</span></div></div>
          <div><div class="fl">Project</div><div class="inp">Tai O stilt houses restoration</div></div>
          <div style="grid-column: 1 / -1;"><div class="fl">Why now</div><div class="inp" style="min-height: 56px; align-items: flex-start; padding-top: 9px; line-height: 1.5;">CAD permits take 10 working days. Booking this week keeps the 3 Oct shoot date.</div></div>
          <div style="grid-column: 1 / -1;"><div class="fl">Attachments</div><div style="display: flex; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; border: 1px solid #ededed; border-radius: 8px;">${docIcon('none', 1.2)}<span style="font-size: 12.5px;">skyview-quote.pdf</span><span class="cap">86 KB</span></div>
            <div style="display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border-radius: 8px; background: #f8f8f8; font-size: 12.5px; color: #525252;">+ Add file</div>
          </div></div>
        </div>
        <div style="margin-top: 18px; padding: 14px; border-radius: 12px; background: #fafafa;">
          <div style="display: flex; align-items: center; margin-bottom: 10px;"><span class="lbl" style="padding: 0;">Who will approve</span><span class="cap" style="margin-left: 8px;">worked out from the amount</span></div>
          <div class="chain">
            <div class="p">${av('chan', 22)}<div><div style="font-size: 12px;">You</div><div class="cap">Requester</div></div></div>
            <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; stroke: #c7c7c7; fill: none; stroke-width: 2; stroke-linecap: round;"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            <div class="p" style="border-color: #d6eafc;">${av('michelle', 22)}<div><div style="font-size: 12px;">Michelle Yip</div><div class="cap">Head of production</div></div></div>
            <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; stroke: #e2e2e2; fill: none; stroke-width: 2; stroke-linecap: round;"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            <div class="p" style="opacity: .45; border-style: solid;"><div style="width: 22px; height: 22px; border-radius: 11px; background: #ededed; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: #7c7c7c;">CF</div><div><div style="font-size: 12px;">CFO</div><div class="cap">Only above HK$40k</div></div></div>
          </div>
          <div style="display: flex; gap: 10px; margin-top: 12px; white-space: nowrap;"><span class="cap">Under HK$10k: team lead · up to 40k: plus head of production · over 40k: plus CFO</span></div>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 14px;"><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500; height: 32px;">Submit for approval</div><div class="btn s" style="height: 32px;">Save draft</div><span class="cap" style="align-self: center; margin-left: 6px;">You can’t approve your own request.</span></div>
      </div>
${rightPanel(['Agent', 'History'], 'Agent', agentBlock({
  scope: 'This request · draft',
  q: 'Is there budget left for this?',
  tool: 'Read budget v3, 9 entries · 0.3 s',
  a: `<p>Just. Travel &amp; locations has <b style="font-weight: 500;">HK$18,800</b> left for Q3, and this uses HK$18,500 of it.</p><p style="margin-top: 8px;">If the Harbourfront recce on 30 Sep goes ahead it won’t fit. Want me to note that for Michelle?</p>`,
  act: 'Add the note',
  place: 'Ask about this request…',
  guard: 'Uses only budgets you can see',
  cost: 'HK$0.01',
}))}
    </div>`;

/* =================================================================== */
/* REPORT DRAFTS                                                       */
/* =================================================================== */
const REPORTS = [['August 2026', 'Draft · not shared', 'draft', 1], ['July 2026', 'Shared 5 Aug', 'locked'], ['Q2 2026 quarterly', 'Shared 8 Jul', 'locked'], ['June 2026', 'Shared 4 Jul', 'locked'], ['May 2026', 'Shared 5 Jun', 'locked']];
const reportsMain = `${topbar('Report drafts', 'the monthly management report, written for you to edit', '<div class="btn s">Regenerate</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Share as PDF</div>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="width: 236px; flex-shrink: 0; border-right: 1px solid #ededed; padding: 12px 10px; overflow: hidden; display: flex; flex-direction: column;">
        <div class="lbl" style="margin-bottom: 8px;">Monthly reports</div>
${REPORTS.map(([t, s, ic, on]) => `        <div style="display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 9px;${on ? ' background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1);' : ''}">${ICON[ic](1.6)}<div style="min-width: 0;"><div style="font-size: 12.5px; color: #171717;${on ? ' font-weight: 500;' : ''}">${t}</div><div class="cap" style="margin-top: 1px;">${s}</div></div></div>`).join('\n')}
        <div style="margin-top: auto; padding: 12px 8px 4px; border-top: 1px solid #ededed;">
          <div style="font-size: 12px; font-weight: 500;">What this is</div>
          <div class="cap" style="line-height: 1.55; margin-top: 4px;">On the 1st of each month the agent writes a draft from Budget, Cash-flow and Costs. You edit it, then share it. Nothing goes out by itself.</div>
        </div>
      </div>
      <div style="flex-grow: 1; min-width: 0; padding: 18px 28px 0; overflow: hidden; background: #fcfcfc;">
        <div style="max-width: 620px; margin: 0 auto; background: #fff; border: 1px solid #ededed; border-radius: 12px; padding: 22px 26px; box-shadow: 0 1px 2px rgba(0,0,0,.04);">
          <div style="display: flex; align-items: center; gap: 8px;"><span class="bd amb">Draft</span><span class="cap">Written 1 Sep by the agent · edited by Michelle Yip</span></div>
          <div style="font-size: 20px; font-weight: 600; margin-top: 10px; letter-spacing: -.01em;">Management report, August 2026</div>
          <div class="doc">
            <h3>Summary</h3>
            <p><span class="ai">August closed HK$35,900 under budget on equipment</span> <span class="src">Budget</span>, offset by an 8.6% overrun on contractors from the two-camera night shoots. AI spend stayed 26% below plan at HK$88,600 <span class="src">Token ledger</span>.</p>
            <h3>Budget against actual</h3>
          </div>
          <div class="tb2" style="margin-top: 4px;">
            <div class="hd" style="grid-template-columns: minmax(0, 1fr) 110px 110px 80px;"><div>Line</div><div style="justify-content: flex-end; display: flex;">Budget</div><div style="justify-content: flex-end; display: flex;">Actual</div><div style="justify-content: flex-end; display: flex;">Diff</div></div>
            <div class="tr" style="grid-template-columns: minmax(0, 1fr) 110px 110px 80px;"><div>Contractors</div><div style="justify-content: flex-end;">HK$126,700</div><div style="justify-content: flex-end;">HK$137,600</div><div style="justify-content: flex-end; color: #e03636;">+8.6%</div></div>
            <div class="tr" style="grid-template-columns: minmax(0, 1fr) 110px 110px 80px;"><div>Equipment</div><div style="justify-content: flex-end;">HK$106,700</div><div style="justify-content: flex-end;">HK$70,800</div><div style="justify-content: flex-end; color: #278f5e;">−33.6%</div></div>
            <div class="tr" style="grid-template-columns: minmax(0, 1fr) 110px 110px 80px; border: none;"><div>AI consumption</div><div style="justify-content: flex-end;">HK$40,000</div><div style="justify-content: flex-end;">HK$29,500</div><div style="justify-content: flex-end; color: #278f5e;">−26.2%</div></div>
          </div>
          <div class="doc">
            <h3>Cash and receivables</h3>
            <p>Cash stands at HK$2.14 M <span class="src">Cash-flow</span>. <span class="ai">78% of receivables are inside 30 days; one invoice of HK$46,200 is past 90 days and should be chased.</span> <span class="src">Accounting · ageing</span></p>
          </div>
        </div>
      </div>
${rightPanel(['Sources', 'Agent'], 'Sources', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 14px;">
          <div class="cap" style="line-height: 1.55; margin-bottom: 10px;">Every figure in the draft links back to where it came from. Blue text was written by the agent and hasn’t been edited yet.</div>
          <div class="li" style="padding: 10px 0;">${okDot}<div style="min-width: 0;"><div class="a">Budget v3</div><div class="b">8 lines · Q3 2026</div></div></div>
          <div class="li" style="padding: 10px 0;">${okDot}<div style="min-width: 0;"><div class="a">Accounting · 212 confirmed entries</div><div class="b">1 to 31 Aug · 3 still unconfirmed, left out</div></div></div>
          <div class="li" style="padding: 10px 0;">${okDot}<div style="min-width: 0;"><div class="a">Cash-flow projection</div><div class="b">Bank statement to 31 Aug</div></div></div>
          <div class="li" style="padding: 10px 0;">${okDot}<div style="min-width: 0;"><div class="a">Token ledger</div><div class="b">AI spend by module</div></div></div>
          <div class="li" style="padding: 10px 0; border: none;">${warnDot}<div style="min-width: 0;"><div class="a">Receivables ageing</div><div class="b">1 invoice needs a note from you</div></div></div>
          <div style="margin-top: 12px; padding: 11px 12px; border-radius: 10px; background: #fafafa;">
            <div style="font-size: 12px; font-weight: 500;">Shared with</div>
            <div style="display: flex; align-items: center; gap: 0; margin-top: 8px;">${['michelle', 'chan', 'amy'].map((k, i) => av(k, 22, ` margin-left: ${i ? -5 : 0}px; box-shadow: 0 0 0 2px #fafafa;`)).join('')}<span class="cap" style="margin-left: 8px;">Directors · when you press Share</span></div>
          </div>
        </div>`)}
    </div>`;

/* =================================================================== */
const out = [
  { file: 'Fin-Budget.dc.html', title: 'Budget', side: side('budget'), main: budgetMain, logic: budgetLogic },
  { file: 'Fin-Cash.dc.html', title: 'Cash-flow projection', side: side('cash'), main: cashMain },
  { file: 'Fin-Spend.dc.html', title: 'Spend requests', side: side('spend'), main: spendMain, me: 'chan' },
  { file: 'Fin-Reports.dc.html', title: 'Report drafts', side: side('reports'), main: reportsMain },
];
for (const o of out) fs.writeFileSync(path.join(DIR, o.file), page(o));
console.log('wrote', out.map(o => o.file).join(', '));
