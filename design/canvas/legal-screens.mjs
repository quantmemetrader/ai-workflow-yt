/**
 * Legal, Clause review, hand-authored (the other Legal screens stay generated).
 * Makes it obvious WHICH document is under review and WHAT it is compared
 * with: a queue of inbound documents on the left, a "this vs your template"
 * header, numbered marks in the text, and the departures list on the right.
 * Output is a marked-up view plus a summary list, never a verdict (§4.9).
 * The no-legal-advice disclaimer is a contract term (Clause 8.4) and stays.
 *
 * Run:  node legal-screens.mjs
 */
import fs from 'fs';
import path from 'path';
import { page as shellPage, av, px, SPRITE, ICON, rightPanel, agentBlock, moduleSidebar, topbar } from './shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CSS = `
    .qd { display: flex; gap: 10px; padding: 9px; border-radius: 10px; }
    .qd.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
    .clz { font-size: 13px; line-height: 1.8; color: #2b343d; margin-bottom: 14px; }
    .clz b { font-weight: 600; color: #171717; }
    .mk { display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border-radius: 9px; font-size: 10px; font-weight: 600; color: #fff; vertical-align: 1px; margin-right: 3px; }
    .hl { border-radius: 3px; padding: 1px 2px; }
    .dp { padding: 11px 12px; border-radius: 11px; background: #fff; border: 1px solid #ededed; }
    .dp.on { border-color: #d6eafc; box-shadow: 0 0 0 3px #eff6ff; }
    .qt { font-size: 11.5px; line-height: 1.5; color: #525252; padding: 6px 8px; border-radius: 7px; background: #f8f8f8; margin-top: 6px; }
    .qt i { font-style: normal; display: block; font-size: 10px; font-weight: 600; color: #999999; letter-spacing: .03em; margin-bottom: 2px; }`;

const NAV = [['draft', 'Document drafting'], ['clause', 'Clause review'], ['repo', 'Contract repository'], ['compliance', 'Compliance checklists']];
const side = moduleSidebar('Legal', NAV, 'clause', {
  badges: { clause: '<i>2</i>' },
  footer: '<div class="cap" style="line-height: 1.5;">This module doesn’t give legal advice. It points out differences for you to judge.</div>',
});

const QUEUE = [
  ['Freelance contributor agreement', 'From Vincent Chow · 9 Sep', '4 differences', 'amb', 1],
  ['Location release', 'From Tai O Rural Committee · 8 Sep', '2 differences', 'amb'],
  ['Music licence', 'From Aegean Sounds Ltd · 2 Sep', 'Reviewed', 'grn'],
  ['Equipment hire terms', 'From Broadway Rentals · 28 Aug', 'Reviewed', 'grn'],
];
const MK = { amb: '#db7706', red: '#e03636', gray: '#7c7c7c' };
const HL = { amb: '#fff3d6', red: '#ffe7e7', gray: '#f0f0f0' };
const mark = (n, tone, text) => `<span class="mk" style="background: ${MK[tone]};">${n}</span><span class="hl" style="background: ${HL[tone]};">${text}</span>`;

const main = `${topbar('Clause review', 'an incoming document, checked against your template', '<div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Upload a document</div>')}
    <div style="height: 34px; flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 0 20px; background: #f8f8f8; border-bottom: 1px solid #ededed; font-size: 12px; color: #525252;">
      <svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #7c7c7c; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 3.2 4.4 6.2v5.6c0 4.4 3.1 8.3 7.6 9.3 4.5-1 7.6-4.9 7.6-9.3V6.2z"/></svg>
      This module doesn’t give legal advice. It marks where a document differs from your template; the decision is yours.
    </div>
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="width: 250px; flex-shrink: 0; border-right: 1px solid #ededed; background: #fcfcfc; padding: 12px 10px; overflow: hidden; display: flex; flex-direction: column;">
        <div class="lbl" style="margin-bottom: 8px;">Documents to review</div>
${QUEUE.map(([t, from, st, tone, on]) => `        <div class="qd${on ? ' on' : ''}">${ICON[tone === 'grn' ? 'locked' : 'await'](1.6)}<div style="min-width: 0;"><div style="font-size: 12.5px; color: #171717;${on ? ' font-weight: 500;' : ''} white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t}</div><div class="cap" style="margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${from}</div><span class="bd ${tone}" style="height: 18px; font-size: 10.5px; margin-top: 5px;">${st}</span></div></div>`).join('\n')}
        <div style="margin-top: auto; padding: 10px 6px 2px; border-top: 1px solid #ededed;" class="cap">Upload a PDF or Word file, or forward it to legal@aurafarmers.hk</div>
      </div>
      <div style="flex-grow: 1; min-width: 0; padding: 14px 22px 0; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; border: 1px solid #ededed;">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">${ICON.await(2)}<div style="min-width: 0;"><div class="cap">Their document</div><div style="font-size: 12.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">contributor-agreement_vchow.pdf</div><div class="cap">Vincent Chow · 6 pages · received 9 Sep</div></div></div>
          <div style="display: flex; flex-direction: column; align-items: center; gap: 2px; flex-shrink: 0;"><svg viewBox="0 0 24 24" style="width: 18px; height: 18px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="M4 9h14l-4-4M20 15H6l4 4"/></svg><span class="cap" style="font-size: 10px;">compared with</span></div>
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">${ICON.locked(2)}<div style="min-width: 0;"><div class="cap">Your template</div><div style="font-size: 12.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Freelance contributor agreement v4</div><div class="cap">plus your positions: HK law, 30-day notice</div></div></div>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; margin: 14px 0 10px;"><span class="lbl" style="padding: 0;">Their text, marked</span><span class="cap"><span class="mk" style="background: #db7706; width: 12px; height: 12px; font-size: 0;"></span>different</span><span class="cap"><span class="mk" style="background: #e03636; width: 12px; height: 12px; font-size: 0;"></span>missing</span><span class="cap"><span class="mk" style="background: #7c7c7c; width: 12px; height: 12px; font-size: 0;"></span>against your positions</span><span class="cap" style="margin-left: auto;">Page 2 of 6</span></div>
        <div style="padding: 18px 22px; border-radius: 12px; background: #fff; border: 1px solid #ededed; box-shadow: 0 1px 2px rgba(0,0,0,.03);">
          <p class="clz"><b>1. Parties.</b> This agreement is between Aura Farmers Limited (the “Company”) and Vincent Chow (the “Contributor”).</p>
          <p class="clz"><b>4. Intellectual property.</b> All footage, stills and derivative works created under this engagement ${mark(1, 'amb', 'vest in the Contributor until final payment is received in full')}.</p>
          <p class="clz"><b>6. Fees.</b> The Company shall pay HK$28,000 within 30 days of a valid invoice.</p>
          <p class="clz"><b>7. Termination.</b> Either party may terminate on ${mark(2, 'amb', 'seven (7) days’')} written notice.</p>
          <div class="clz" style="padding: 9px 11px; border-radius: 8px; background: #fff7f7; border: 1px solid #ffdcdc;"><b>9. Confidentiality.</b> ${mark(3, 'red', 'Not in this document.')} <span style="color: #8a3b3b;">Your template has a confidentiality clause here.</span></div>
          <p class="clz" style="margin-bottom: 0;"><b>12. Governing law.</b> This agreement is governed by the laws of ${mark(4, 'gray', 'Singapore')}.</p>
        </div>
      </div>
${rightPanel(['Differences', 'Agent'], 'Differences', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 12px 12px 0; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; padding: 0 2px 2px;"><span style="font-size: 12.5px; font-weight: 500;">4 differences</span><span class="cap">2 changed · 1 missing · 1 position</span></div>
          <div class="dp on"><div style="display: flex; align-items: center; gap: 7px;"><span class="mk" style="background: #db7706;">1</span><span style="font-size: 12.5px; font-weight: 500;">4. Who owns the footage</span></div>
            <div class="qt"><i>THEIRS</i>Owned by Vincent until he is paid in full</div><div class="qt"><i>YOUR TEMPLATE</i>Owned by the Company from the moment it’s made</div>
            <div style="display: flex; gap: 6px; margin-top: 8px;"><div class="btn s" style="height: 25px; font-size: 11.5px;">Ask for ours</div><div class="btn s" style="height: 25px; font-size: 11.5px;">Accept theirs</div></div></div>
          <div class="dp"><div style="display: flex; align-items: center; gap: 7px;"><span class="mk" style="background: #db7706;">2</span><span style="font-size: 12.5px; font-weight: 500;">7. Notice to end it</span></div><div class="cap" style="margin-top: 4px; line-height: 1.5;">7 days here; your template says 30.</div></div>
          <div class="dp"><div style="display: flex; align-items: center; gap: 7px;"><span class="mk" style="background: #e03636;">3</span><span style="font-size: 12.5px; font-weight: 500;">9. Confidentiality</span></div><div class="cap" style="margin-top: 4px; line-height: 1.5;">Missing. Your template clause 9 has no match.</div></div>
          <div class="dp"><div style="display: flex; align-items: center; gap: 7px;"><span class="mk" style="background: #7c7c7c;">4</span><span style="font-size: 12.5px; font-weight: 500;">12. Which country’s law</span></div><div class="cap" style="margin-top: 4px; line-height: 1.5;">Singapore; your position is Hong Kong SAR.</div></div>
        </div>
        <div style="flex-shrink: 0; padding: 12px;"><div class="btn" style="width: 100%; justify-content: center; height: 32px; background: {{accent}}; color: #fff; font-weight: 500;">Export marked-up PDF + list</div></div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 10px 14px 12px;" class="cap">Marked and explained, never a verdict. Not legal advice.</div>`)}
    </div>`;

const out = [{ file: 'Legal-Clause.dc.html', title: 'Clause review', side, main }];
for (const o of out) fs.writeFileSync(path.join(DIR, o.file), shellPage({ module: 'Legal', gen: 'legal-screens.mjs', active: 'legal', me: 'michelle', extraCss: CSS, ...o }));
console.log('wrote', out.map(o => o.file).join(', '));
