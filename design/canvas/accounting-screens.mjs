/**
 * Accounting, hand-authored, all four screens (§4.7).
 * A bookkeeping assistant, not a ledger of record: everything is a draft
 * until a person confirms it, and nothing posts anywhere by itself.
 *
 *   Acc-Inbox   the real receipt with what the agent read outlined on it,
 *               and a plain "check these fields" form (no bare percentages)
 *   Acc-Drafts  entries as debit/credit cards tied to their document,
 *               bulk approve, and bank matching alongside
 *   Acc-Period  where money went, who owes us, what isn't counted yet
 *   Acc-Export  the Xero file previewed row by row before download
 *
 * Run:  node accounting-screens.mjs
 */
import fs from 'fs';
import path from 'path';
import { page as shellPage, P, av, docIcon, BRAND, rightPanel, agentBlock, okDot, warnDot, failDot, moduleSidebar, topbar, chip, cb, TICK } from './shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CSS = `
    .steps { display: flex; gap: 14px; padding: 12px 14px; border-radius: 12px; background: #fafafa; }
    .step { flex: 1 1 0; min-width: 0; display: flex; gap: 10px; align-items: flex-start; }
    .step .nb { width: 20px; height: 20px; border-radius: 10px; background: #fff; border: 1px solid #e2e2e2; font-size: 11px; font-weight: 600; color: #525252; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .step .a { font-size: 12.5px; font-weight: 500; color: #171717; }
    .step .b { font-size: 11.5px; color: #7c7c7c; line-height: 1.45; margin-top: 2px; }
    .di { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px; }
    .di.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
    .di .t { font-size: 12.5px; color: #171717; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .di .m { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
    .desk { background: #f3f3f3; border-radius: 14px; display: flex; align-items: flex-start; justify-content: center; padding: 26px 0; overflow: hidden; }
    .rc { width: 330px; background: #fff; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08); padding: 22px 24px 26px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: #2b2b2b; line-height: 1.6; }
    .rc .c { text-align: center; }
    .rc .rl { display: flex; justify-content: space-between; gap: 10px; }
    .rc hr { border: none; border-top: 1px dashed #c7c7c7; margin: 10px 0; }
    .fx { position: relative; border-radius: 3px; box-shadow: 0 0 0 2px #30a46c; background: rgba(48,164,108,.07); }
    .fx.w { box-shadow: 0 0 0 2px #f5a524; background: rgba(245,165,36,.09); }
    .fx::after { content: attr(data-l); position: absolute; left: calc(100% + 12px); top: 50%; transform: translateY(-50%); height: 17px; padding: 0 7px; border-radius: 5px; background: #30a46c; color: #fff; font-family: Inter, sans-serif; font-size: 10px; font-weight: 600; line-height: 17px; white-space: nowrap; }
    .fx.b::after { left: calc(100% + 8px); }
    .fx.w::after { background: #f5a524; }
    .fld { padding: 9px 0; border-bottom: 1px solid #f3f3f3; }
    .fld .l { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500; color: #7c7c7c; }
    .fld .v { height: 32px; margin-top: 5px; border-radius: 8px; background: #f3f3f3; display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: 12.5px; color: #171717; }
    .fld .v.w { background: #fffbf0; box-shadow: inset 0 0 0 1px #f7dcb0; }
    .fld .n { font-size: 11px; color: #8a5a0d; margin-top: 5px; line-height: 1.45; }
    .ok { color: #278f5e; font-size: 11px; font-weight: 500; margin-left: auto; display: flex; align-items: center; gap: 4px; }
    .ok svg, .ck2 svg { width: 11px; height: 11px; stroke: currentColor; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .ck2 { color: #b36b00; font-size: 11px; font-weight: 500; margin-left: auto; display: flex; align-items: center; gap: 4px; }
    .en { border: 1px solid #ededed; border-radius: 12px; background: #fff; overflow: hidden; }
    .en .eh { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid #f3f3f3; }
    .en .jl { display: grid; grid-template-columns: minmax(0, 1fr) 118px 118px; align-items: center; height: 32px; padding: 0 12px; font-size: 12.5px; color: #383838; }
    .en .jl > div:nth-child(n+2) { text-align: right; font-variant-numeric: tabular-nums; }
    .en .jl.h { height: 26px; font-size: 10.5px; font-weight: 500; color: #999999; background: #fcfcfc; }
    .code { font-family: ui-monospace, monospace; font-size: 11px; color: #7c7c7c; margin-right: 6px; }
    .kpi { border: 1px solid #ededed; border-radius: 12px; padding: 12px 14px; background: #fff; min-width: 0; }
    .kpi i { font-style: normal; display: block; font-size: 11px; color: #999999; }
    .kpi b { display: block; font-size: 20px; font-weight: 500; margin-top: 5px; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
    .kpi span { display: block; font-size: 11px; color: #7c7c7c; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hb { display: grid; grid-template-columns: 170px minmax(0, 1fr) 96px; align-items: center; gap: 10px; height: 30px; font-size: 12.5px; }
    .hb .tr2 { height: 10px; border-radius: 5px; background: #f3f3f3; overflow: hidden; }
    .hb .tr2 div { height: 10px; border-radius: 5px; }
    .csv { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
    .csv .cr { display: grid; grid-template-columns: 90px 96px minmax(0, 1fr) 70px 110px; gap: 12px; padding: 0 14px; height: 30px; align-items: center; border-bottom: 1px solid #f3f3f3; color: #383838; }
    .csv .cr:last-child { border-bottom: none; }
    .csv .cr.h { color: #999999; background: #fafafa; }
    .csv .cr > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`;

const NAV = [['inbox', 'Document inbox'], ['drafts', 'Draft entries'], ['period', 'Period summary'], ['export', 'Export']];
const side = cur => moduleSidebar('Accounting', NAV, cur, {
  badges: { inbox: '<i>9</i>', drafts: '<b>12</b>' },
  footer: '<div class="cap" style="line-height: 1.5;">Drafts only. Nothing is posted anywhere until a person confirms it.</div>',
});
const page = o => shellPage({ module: 'Accounting', gen: 'accounting-screens.mjs', active: 'acc', me: 'michelle', extraCss: CSS, ...o });
const OKI = '<span class="ok"><svg viewBox="0 0 16 16"><path d="M3.6 8.3 6.5 11.2 12.4 5.1"/></svg>Read clearly</span>';
const CHK = '<span class="ck2"><svg viewBox="0 0 16 16"><path d="M8 4v5M8 11.6v.2"/></svg>Please check</span>';

/* =================================================================== */
/* DOCUMENT INBOX                                                      */
/* =================================================================== */
const DOCS = [
  ['Broadway Photo Supply', 'Receipt · 31 Aug', 'HK$4,280', 'Check 1 field', 'amb', 1],
  ['Cathay Pacific', 'Invoice · 28 Aug', 'HK$9,640', 'Ready', 'grn'],
  ['HK Film Archive', 'Invoice · 24 Aug', 'HK$1,200', 'Ready', 'grn'],
  ['Kowloon Bay Mall', 'Our invoice · 1 Sep', 'HK$120,000', 'Ready', 'grn'],
  ['Wellcome', 'Receipt · 22 Aug', 'HK$386', 'Business cost?', 'gray'],
  ['Taxi receipt', 'Photo · 20 Aug', 'Unreadable', 'Retake the photo', 'red'],
  ['Adobe', 'Invoice · 19 Aug', 'US$89.99', 'Ready', 'grn'],
];
const DOT = { grn: ['#30a46c', '#278f5e'], amb: ['#f5a524', '#b36b00'], gray: ['#c7c7c7', '#7c7c7c'], red: ['#e5484d', '#e03636'] };
const inboxTop = topbar('Document inbox', 'receipts and invoices, read for you', '<div class="btn s">Forward to receipts@aurafarmers.hk</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Upload</div>');
const inboxMain = `
    <div style="flex-grow: 1; display: flex; flex-direction: column; min-height: 0; padding: 14px 20px 0;">
      <div class="steps">
        <div class="step"><span class="nb">1</span><div><div class="a">Send it in</div><div class="b">Upload, drag in, or forward an email. Photos from your phone work too.</div></div></div>
        <div class="step"><span class="nb">2</span><div><div class="a">The agent reads it</div><div class="b">Supplier, date, amount and items, plus the account it thinks it belongs to.</div></div></div>
        <div class="step"><span class="nb">3</span><div><div class="a">You check and confirm</div><div class="b">It becomes a draft entry. Your fixes teach the next suggestion.</div></div></div>
      </div>
      <div style="flex-grow: 1; display: flex; gap: 16px; min-height: 0; margin-top: 14px;">
        <div style="width: 250px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0;">
          <div style="display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3f3f3; margin-bottom: 8px;">
            <div style="flex: 1; height: 26px; border-radius: 6px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 500;">To check <span class="cap">9</span></div>
            <div style="flex: 1; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; color: #7c7c7c;">Confirmed <span class="cap">34</span></div>
          </div>
${DOCS.map(([t, m, amt, st, tone, on]) => `          <div class="di${on ? ' on' : ''}">${docIcon(tone === 'red' ? 'changes' : tone === 'amb' ? 'await' : 'none', 1.5)}<div style="min-width: 0; flex-grow: 1;"><div style="display: flex; align-items: baseline; gap: 8px;"><span class="t" style="flex-grow: 1; min-width: 0;${on ? ' font-weight: 500;' : ''}">${t}</span><span style="font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap;">${amt}</span></div><div class="m"><span class="dot" style="width: 6px; height: 6px; background: ${DOT[tone][0]};"></span><span style="font-size: 11.5px; color: ${DOT[tone][1]}; white-space: nowrap;">${st}</span><span class="cap" style="margin-left: auto; white-space: nowrap;">${m}</span></div></div></div>`).join('\n')}
          <div class="cap" style="padding: 8px 10px;">2 more</div>
        </div>
        <div class="desk" style="flex-grow: 1; min-width: 0; margin-bottom: 14px;">
          <div class="rc">
            <div class="c" style="font-size: 13px; font-weight: 700; letter-spacing: .04em;"><span class="fx" data-l="Supplier">BROADWAY PHOTO SUPPLY</span></div>
            <div class="c" style="margin-top: 3px;">百老匯攝影器材有限公司</div>
            <div class="c" style="color: #7c7c7c;">Mong Kok, Kowloon · 2332 1234</div>
            <hr>
            <div class="rl"><span>INVOICE</span><span class="fx" data-l="Invoice no.">BP-208841</span></div>
            <div class="rl" style="margin-top: 4px;"><span>DATE</span><span class="fx" data-l="Date">31/08/2026 15:42</span></div>
            <hr>
            <div class="fx" data-l="2 items" style="padding: 3px 4px; margin: 0 -4px;">
              <div class="rl"><span>RODE NTG5 SHOTGUN MIC</span><span>3,480.00</span></div>
              <div style="color: #7c7c7c;">1 x 3,480.00</div>
              <div class="rl" style="margin-top: 4px;"><span>RYCOTE WINDSHIELD KIT</span><span>800.00</span></div>
              <div style="color: #7c7c7c;">2 x 400.00</div>
            </div>
            <hr>
            <div class="rl"><span>SUBTOTAL</span><span>4,280.00</span></div>
            <div class="rl" style="font-weight: 700; font-size: 13px; margin-top: 4px;"><span>TOTAL HKD</span><span class="fx" data-l="Amount">4,280.00</span></div>
            <div class="rl" style="margin-top: 8px;"><span>PAID</span><span class="fx w" data-l="Check">VISA ****4412</span></div>
            <hr>
            <div class="c" style="color: #7c7c7c;">THANK YOU · 多謝惠顧</div>
          </div>
        </div>
      </div>
    </div>`;
const inboxPanel = rightPanel(['Check fields', 'Agent'], 'Check fields', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 10px 14px 0;">
          <div style="display: flex; align-items: center; gap: 8px; padding-bottom: 6px;"><span style="font-size: 13px; font-weight: 500;">Broadway Photo Supply</span><span class="bd amb" style="margin-left: auto;">1 to check</span></div>
          <div class="fld"><div class="l">Supplier${OKI}</div><div class="v">Broadway Photo Supply</div></div>
          <div class="fld"><div class="l">Date${OKI}</div><div class="v">31 Aug 2026</div></div>
          <div class="fld"><div class="l">Amount${OKI}</div><div class="v" style="font-variant-numeric: tabular-nums;"><span style="color: #999999;">HK$</span>4,280.00<span class="cap" style="margin-left: auto;">no tax in HK</span></div></div>
          <div class="fld"><div class="l">Paid with${CHK}</div><div class="v w">${BRAND.visa(18)}Visa ending 4412<span class="cap" style="margin-left: auto;">whose card?</span></div><div class="n">This card isn’t on file as a company card. If it’s personal, this becomes an expense claim for Chan Ka-ming.</div></div>
          <div class="fld" style="border: none;"><div class="l">Account<span class="cap" style="margin-left: auto; font-weight: 420;">suggested</span></div><div class="v"><span class="code">6120</span>Production equipment<svg viewBox="0 0 24 24" style="width: 11px; height: 11px; stroke: #999999; fill: none; stroke-width: 2; margin-left: auto;"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg></div><div class="cap" style="margin-top: 5px; line-height: 1.45;">The last 14 receipts from this shop went here. Also possible: <span style="color: {{accent}};">6150 Small tools</span></div></div>
        </div>
        <div style="flex-shrink: 0; padding: 12px 14px;">
          <div class="btn" style="width: 100%; justify-content: center; height: 34px; background: {{accent}}; color: #fff; font-weight: 500;">Confirm as a draft entry</div>
          <div style="display: flex; justify-content: space-between; margin-top: 9px;"><span class="cap">Skip for now</span><span class="cap">Not a business cost</span></div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 10px 14px 12px;" class="cap">Confirming doesn’t post anything. An accountant approves draft entries later.</div>`);

/* =================================================================== */
/* DRAFT ENTRIES                                                       */
/* =================================================================== */
const ENTRIES = [
  { sel: 1, date: '31 Aug', doc: 'Broadway Photo Supply · receipt', who: 'chan', st: ['Draft', 'blue'], lines: [['6120', 'Production equipment', '4,280.00', ''], ['2110', 'Expense claims · Chan Ka-ming', '', '4,280.00']] },
  { sel: 1, date: '28 Aug', doc: 'Cathay Pacific · invoice', who: 'amy', st: ['Draft', 'blue'], warn: 'No payment found in the bank yet', lines: [['6500', 'Travel', '9,640.00', ''], ['2100', 'Accounts payable', '', '9,640.00']] },
  { sel: 1, date: '1 Sep', doc: 'Kowloon Bay Mall · our invoice #0412', who: 'michelle', st: ['Draft', 'blue'], lines: [['1200', 'Accounts receivable', '120,000.00', ''], ['4000', 'Production income', '', '120,000.00']] },
  { date: '24 Aug', doc: 'HK Film Archive · licence invoice', who: 'amy', st: ['Approved', 'grn'], lines: [['6210', 'Licensing and archive', '1,200.00', ''], ['1010', 'HSBC business account', '', '1,200.00']] },
];
const entry = e => `
          <div class="en"${e.st[0] === 'Approved' ? ' style="opacity: .75;"' : ''}>
            <div class="eh">${e.st[0] === 'Approved' ? '<div style="width: 16px;"></div>' : cb(!!e.sel)}<span style="font-size: 12px; color: #7c7c7c; width: 44px; flex-shrink: 0;">${e.date}</span>${docIcon('none', 1.1)}<span style="font-size: 12.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;">${e.doc}</span>${e.warn ? `<span class="bd amb" style="white-space: nowrap;">${e.warn}</span>` : ''}<div style="flex-grow: 1;"></div>${av(e.who, 18)}<span class="bd ${e.st[1]}">${e.st[0]}</span></div>
            <div class="jl h"><div>Account</div><div>Debit</div><div>Credit</div></div>
${e.lines.map(([c, n, d, cr]) => `            <div class="jl"><div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><span class="code">${c}</span>${n}</div><div>${d || '<span style="color: #d4d4d4;">–</span>'}</div><div>${cr || '<span style="color: #d4d4d4;">–</span>'}</div></div>`).join('\n')}
          </div>`;
const draftsTop = topbar('Draft entries', 'confirmed documents, turned into journal lines', chip('August 2026'));
const draftsMain = `
    <div style="flex-grow: 1; min-height: 0; padding: 14px 20px 0; overflow: hidden;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
        <div class="fc on">Draft <b>12</b></div><div class="fc">Approved <b>34</b></div><div class="fc">All <b>46</b></div>
        <div style="flex-grow: 1;"></div>
        <span class="cap">3 selected · every entry balances</span>
        <div class="btn s">Edit</div>
        <div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Approve 3</div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
${ENTRIES.map(entry).join('')}
      </div>
      <div class="cap" style="margin-top: 12px;">8 more drafts · each one links back to the document it came from</div>
    </div>`;
const BANK = [
  ['18 Aug', 'SQ*MINGS KITCHEN', '−3,210.00', 'Looks like a crew lunch'],
  ['22 Aug', 'FPS TRANSFER · W CHAN', '−6,500.00', 'Maybe a freelancer payment'],
  ['29 Aug', 'HSBC SERVICE CHARGE', '−2,700.00', 'Bank fee'],
];
const draftsPanel = rightPanel(['Bank matching', 'Agent'], 'Bank matching', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 12px 14px 0;">
          <div style="display: flex; align-items: center; gap: 9px; margin-bottom: 10px;">${BRAND.hsbc(22)}<div><div style="font-size: 12.5px; font-weight: 500;">HSBC business ····2201</div><div class="cap">Statement to 31 Aug · 86 of 89 lines matched</div></div></div>
          <div class="lbl" style="padding: 0; margin: 12px 0 6px;">Money left the bank, no receipt yet</div>
${BANK.map(([d, t, a, g]) => `          <div style="padding: 9px 10px; border: 1px solid #ededed; border-radius: 10px; background: #fff; margin-bottom: 6px;"><div style="display: flex; align-items: baseline; gap: 8px;"><span class="cap" style="width: 44px; white-space: nowrap; flex-shrink: 0;">${d}</span><span style="font-size: 12px; font-family: ui-monospace, monospace; flex-grow: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t}</span><span style="font-size: 12px; font-variant-numeric: tabular-nums;">${a}</span></div><div style="display: flex; align-items: center; gap: 6px; margin-top: 6px;"><span class="cap" style="flex-grow: 1;">${g}</span><span style="font-size: 11.5px; color: {{accent}};">Find receipt</span></div></div>`).join('\n')}
          <div class="lbl" style="padding: 0; margin: 14px 0 6px;">Receipt, but no payment yet</div>
          <div style="padding: 9px 10px; border: 1px solid #f7dcb0; border-radius: 10px; background: #fffbf0;"><div style="display: flex; align-items: baseline; gap: 8px;"><span style="font-size: 12px; flex-grow: 1;">Cathay Pacific</span><span style="font-size: 12px; font-variant-numeric: tabular-nums;">9,640.00</span></div><div class="cap" style="margin-top: 4px; line-height: 1.45; color: #8a5a0d;">Probably paid on a personal card. Ask Amy, or mark as an expense claim.</div></div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 10px 14px 12px;" class="cap">Matching only suggests. You decide what each line is.</div>`);

/* =================================================================== */
/* PERIOD SUMMARY                                                      */
/* =================================================================== */
const SPEND = [['6310 Contractors', 412800], ['6120 Production equipment', 284100], ['6210 Licensing and archive', 196400], ['6700 Studio lease', 70000], ['6400 AI consumption', 88600], ['6500 Travel', 62300]];
const maxS = 412800;
const periodTop = topbar('Period summary', 'August 2026 at a glance', chip('August 2026'));
const periodMain = `
    <div style="flex-grow: 1; min-height: 0; padding: 14px 20px 0; overflow: hidden;">
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;">
        <div class="kpi"><i>Money in</i><b>HK$1,840,200</b><span>8 invoices</span></div>
        <div class="kpi"><i>Money out</i><b>HK$1,204,500</b><span>128 confirmed entries</span></div>
        <div class="kpi"><i>Left over</i><b style="color: #278f5e;">HK$635,700</b><span>34.5% of money in</span></div>
        <div class="kpi" style="background: #fffbf0; border-color: #f7dcb0;"><i>Not counted yet</i><b>9 documents</b><span style="color: #8a5a0d;">about HK$38,420 of costs</span></div>
      </div>
      <div style="display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 12px; margin-top: 12px;">
        <div class="card" style="padding: 14px;">
          <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px;"><span class="lbl" style="padding: 0;">Where the money went</span><span class="cap">1–31 Aug · confirmed entries</span></div>
${SPEND.map(([n, v]) => `          <div class="hb"><span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n}</span><div class="tr2"><div style="width: ${(v / maxS * 100).toFixed(1)}%; background: ${n.startsWith('6310') ? '{{accent}}' : '#8d99a6'};"></div></div><span style="text-align: right; font-variant-numeric: tabular-nums;">HK$${v.toLocaleString('en-US')}</span></div>`).join('\n')}
          <div class="cap" style="margin-top: 6px;">Contractors ran 8.6% over budget this month.</div>
        </div>
        <div class="card" style="padding: 14px;">
          <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px;"><span class="lbl" style="padding: 0;">Who owes us</span><span class="cap">HK$318,400 · as of 31 Aug</span></div>
          <div style="display: flex; height: 14px; border-radius: 7px; overflow: hidden; gap: 2px;"><div style="flex: 78; background: {{accent}};"></div><div style="flex: 11; background: #8fc3f1;"></div><div style="flex: 6; background: #d4d4d4;"></div><div style="flex: 5; background: #e5484d;"></div></div>
          <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-top: 8px;">
            <div><div style="font-size: 12.5px; font-variant-numeric: tabular-nums;">78%</div><div class="cap">under 30 days</div></div>
            <div><div style="font-size: 12.5px;">11%</div><div class="cap">30 to 60</div></div>
            <div><div style="font-size: 12.5px;">6%</div><div class="cap">60 to 90</div></div>
            <div><div style="font-size: 12.5px; color: #e03636;">5%</div><div class="cap">over 90</div></div>
          </div>
          <div style="margin-top: 12px; padding: 10px; border-radius: 10px; background: #fff7f7; border: 1px solid #ffdcdc; display: flex; align-items: center; gap: 10px;">${failDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 16px; height: 16px; border-radius: 8px')}<div style="min-width: 0; flex-grow: 1;"><div style="font-size: 12.5px;">Harbour City promo · invoice #0377</div><div class="cap">HK$46,200 · 96 days late</div></div><span style="font-size: 11.5px; color: {{accent}}; white-space: nowrap;">Draft a reminder</span></div>
          <div style="display: flex; align-items: baseline; gap: 8px; margin-top: 14px;"><span class="lbl" style="padding: 0;">What we owe</span><span class="cap">HK$84,900 · all within terms</span></div>
        </div>
      </div>
      <div class="card" style="padding: 14px; margin-top: 12px;">
        <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px;"><span class="lbl" style="padding: 0;">Money in, by client</span><span class="cap">1–31 Aug · invoices sent</span><span class="cap" style="margin-left: auto;">5 clients · 8 invoices</span></div>
${[['HK Tourism Board', 960000, 'Campaign, final stage'], ['Harbour City', 342000, 'Promo series'], ['Cathay Holidays', 268200, 'Destination shorts'], ['Sino Group', 150000, 'Brand film'], ['Kowloon Bay Mall', 120000, 'Monthly retainer']].map(([n, v, w], i) => `        <div class="hb" style="grid-template-columns: 170px minmax(0, 1fr) 150px 96px;"><span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n}</span><div class="tr2"><div style="width: ${(v / 960000 * 100).toFixed(1)}%; background: ${i ? '#8d99a6' : '{{accent}}'};"></div></div><span class="cap" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${w}</span><span style="text-align: right; font-variant-numeric: tabular-nums;">HK$${v.toLocaleString('en-US')}</span></div>`).join('\n')}
      </div>
    </div>`;

/* =================================================================== */
/* EXPORT                                                              */
/* =================================================================== */
const ROWS = [['31/08/2026', '-4280.00', 'Broadway Photo Supply', '6120', 'BP-208841'], ['28/08/2026', '-9640.00', 'Cathay Pacific', '6500', 'CX-55012'], ['24/08/2026', '-1200.00', 'HK Film Archive', '6210', 'HKFA-2291'], ['19/08/2026', '-703.12', 'Adobe', '6600', 'ADB-88710'], ['01/08/2026', '120000.00', 'Kowloon Bay Mall', '4000', 'INV-0402']];
const exportTop = topbar('Export', 'approved entries, in the format your accountant imports', '<div class="btn s">Mark as imported</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Download for Xero</div>');
const exportMain = `
    <div style="flex-grow: 1; min-height: 0; padding: 14px 20px 0; overflow: hidden;">
      <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; border: 1.5px solid {{accent}}; background: #f5faff;">${BRAND.xero(30)}<div style="min-width: 0;"><div style="font-size: 13px; font-weight: 500;">Xero · bank statement CSV</div><div class="cap">Your designated software · set by Admin</div></div><div style="margin-left: auto; width: 16px; height: 16px; border-radius: 8px; border: 5px solid {{accent}}; background: #fff;"></div></div>
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; border: 1px solid #ededed;">${docIcon('none', 1.6)}<div style="min-width: 0;"><div style="font-size: 13px;">Plain journal CSV</div><div class="cap">For any other software</div></div><div style="margin-left: auto; width: 16px; height: 16px; border-radius: 8px; border: 1.5px solid #c7c7c7;"></div></div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px;">
        <div class="kpi"><i>Going in</i><b>34 entries</b><span>every approved entry, 1–31 Aug</span></div>
        <div class="kpi"><i>Left out</i><b>12 drafts</b><span>not approved yet · <span style="display: inline; color: {{accent}};">review</span></span></div>
        <div class="kpi"><i>Balance check</i><b style="color: #278f5e;">Debits = credits</b><span>HK$1,204,500.00 both sides</span></div>
      </div>
      <div style="display: flex; align-items: baseline; gap: 8px; margin: 16px 0 8px;"><span class="lbl" style="padding: 0;">File preview</span><span class="cap">aura-farmers_2026-08_xero.csv · first 5 of 34 rows</span></div>
      <div class="csv" style="border: 1px solid #ededed; border-radius: 12px; overflow: hidden;">
        <div class="cr h"><div>*Date</div><div>*Amount</div><div>Payee</div><div>Account</div><div>Reference</div></div>
${ROWS.map(r => `        <div class="cr">${r.map((c, i) => `<div${i === 1 ? ` style="text-align: right; color: ${c.startsWith('-') ? '#383838' : '#278f5e'};"` : ''}>${c}</div>`).join('')}</div>`).join('\n')}
      </div>
      <div style="display: flex; align-items: baseline; gap: 8px; margin: 16px 0 6px;"><span class="lbl" style="padding: 0;">Earlier exports</span></div>
      <div class="li" style="padding: 9px 0;">${okDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 16px; height: 16px; border-radius: 8px')}<div style="flex-grow: 1;"><div class="a">July 2026 · 41 entries</div><div class="b">Downloaded by Michelle Yip on 3 Aug · imported into Xero</div></div><span class="cap" style="align-self: center;">EXP-2026-07-001</span></div>
      <div class="li" style="padding: 9px 0; border: none;">${okDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 16px; height: 16px; border-radius: 8px')}<div style="flex-grow: 1;"><div class="a">June 2026 · 38 entries</div><div class="b">Downloaded on 2 Jul · imported into Xero</div></div><span class="cap" style="align-self: center;">EXP-2026-06-001</span></div>
    </div>`;

/* =================================================================== */
const agent = (scope, q, tool, a, act, place) => rightPanel(['Agent'], 'Agent', agentBlock({ scope, q, tool, a, act, place, guard: 'Suggestions only · you confirm', cost: 'HK$0.01' }));
const layout = (top, body, panel) => `${top}
    <div style="flex-grow: 1; display: flex; min-height: 0;"><div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column;">${body}</div>${panel}</div>`;
const out = [
  { file: 'Acc-Inbox.dc.html', title: 'Document inbox', side: side('inbox'), main: layout(inboxTop, inboxMain, inboxPanel) },
  { file: 'Acc-Drafts.dc.html', title: 'Draft entries', side: side('drafts'), main: layout(draftsTop, draftsMain, draftsPanel) },
  { file: 'Acc-Period.dc.html', title: 'Period summary', side: side('period'), main: layout(periodTop, periodMain, agent('Accounting · August 2026', 'Anything unusual this month?', 'Read 128 entries · 0.6 s', '<p>Two things. <b style="font-weight: 500;">Contractors</b> are 8.6% over budget, all from the two-camera night shoots.</p><p style="margin-top: 8px;">And one invoice, Harbour City promo for HK$46,200, is 96 days unpaid. I can draft a polite reminder.</p>', 'Draft the reminder', 'Ask about the month…')) },
  { file: 'Acc-Export.dc.html', title: 'Export', side: side('export'), main: layout(exportTop, exportMain, agent('Export · August 2026', 'Will this import cleanly into Xero?', 'Checked 34 rows against Xero · 0.4 s', '<p>Yes. All 34 rows use account codes that exist in your Xero chart, and every date is in August.</p><p style="margin-top: 8px;">One row is in US dollars (Adobe). I converted it at the bank’s rate on 19 Aug and kept the original in the description.</p>', 'Download for Xero', 'Ask about this export…')) },
];
for (const o of out) fs.writeFileSync(path.join(DIR, o.file), page(o));
console.log('wrote', out.map(o => o.file).join(', '));
