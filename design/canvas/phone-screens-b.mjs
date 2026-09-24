/**
 * Phone views, batch B: Publish, Accounting, Finance, Legal.
 * Writes <Desktop>-Phone.dc.html files and phones-b.json.
 * Run: node phone-screens-b.mjs
 */
import fs from 'fs';
import path from 'path';
import { P, docIcon, BRAND } from './shell.mjs';
import { phonePage, row, sec, kpis, bd, dot, pbar, btns, fld, chev, tick, warn, cbx, cover, pav, ini } from './phone-shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const out = [];
const add = (file, mod, title, o) => { fs.writeFileSync(path.join(DIR, file), phonePage({ module: mod, gen: 'phone-screens-b.mjs', title, ...o })); out.push({ file, mod, title }); };
const sheet = (scope, q, tool, a, act, chips = []) => ({ scope, q, tool, a, act, chips });
const ib = t => `<div style="width: 40px; height: 40px; border-radius: 11px; background: #f3f3f3; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${t}</div>`;

/* ---------- channel marks (compact) ---------- */
const L = {
  yt: '<rect width="36" height="36" rx="10" fill="#ff0000"/><path d="M14.5 12.2v11.6l9.6-5.8z" fill="#fff"/>',
  ig: '<defs><linearGradient id="igp" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".35" stop-color="#fa7e1e"/><stop offset=".6" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect width="36" height="36" rx="10" fill="url(#igp)"/><rect x="9.5" y="9.5" width="17" height="17" rx="5" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="18" cy="18" r="4" fill="none" stroke="#fff" stroke-width="2.2"/>',
  li: '<rect width="36" height="36" rx="10" fill="#0a66c2"/><rect x="10" y="15" width="3.6" height="11" fill="#fff"/><circle cx="11.8" cy="11.2" r="2.1" fill="#fff"/><path d="M16.6 15h3.4v1.6c.6-1.1 2-1.9 3.6-1.9 3 0 3.8 1.9 3.8 4.6V26h-3.6v-5.9c0-1.4-.3-2.4-1.7-2.4s-1.9 1-1.9 2.4V26h-3.6z" fill="#fff"/>',
  tt: '<rect width="36" height="36" rx="10" fill="#111"/><path d="M19.6 9.5h3.2c.3 2.3 1.8 3.8 4 4v3.2c-1.5 0-2.8-.4-4-1.2v6.2a5.6 5.6 0 1 1-5.6-5.6h.6v3.3a2.4 2.4 0 1 0 1.8 2.3z" fill="#fff"/>',
  x: '<rect width="36" height="36" rx="10" fill="#000"/><path d="M10.5 10h4.6l4.2 5.9 5-5.9h2.1l-6.2 7.3 7.3 10.2h-4.6l-4.6-6.4-5.5 6.4h-2.1l6.7-7.8z" fill="#fff"/>',
  wc: '<rect width="36" height="36" rx="10" fill="#07c160"/><ellipse cx="15" cy="15.5" rx="7" ry="5.8" fill="#fff"/><ellipse cx="21.5" cy="20.5" rx="6" ry="5" fill="#fff" stroke="#07c160" stroke-width="1.4"/>',
};
const lg = (k, s = 22) => `<svg viewBox="0 0 36 36" style="width: ${s}px; height: ${s}px; display: block; flex-shrink: 0; border-radius: ${Math.round(s * .28)}px;">${L[k]}</svg>`;
const CHN = { yt: 'YouTube', ig: 'Instagram', li: 'LinkedIn', tt: 'TikTok', x: 'X', wc: 'WeChat' };

/* =================================================================== */
/* PUBLISH                                                             */
/* =================================================================== */
const PCH = ['Board', 'Caption', 'Approvals', 'Log'];
const MK = { posted: ['#e4faeb', '#278f5e', '✓'], wait: ['#fff7d3', '#b36b00', '⧗'], priv: ['#f3f3f3', '#7c7c7c', '🔒'], fail: ['#ffe7e7', '#e03636', '!'] };
const mark = (k, st) => `<span style="display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px 0 4px; border-radius: 9px; background: ${MK[st][0]};">${lg(k, 20)}<span style="font-size: 12px; font-weight: 600; color: ${MK[st][1]};">${MK[st][2]}</span></span>`;
const VIDS = [['history', 'History of Greece · Ep 75', 'Waiting for Michelle · 12 Sep', [['yt', 'wait'], ['ig', 'wait'], ['li', 'wait']]], ['orange', 'Orange typography cut', 'Posted 31 Aug', [['x', 'posted'], ['yt', 'priv']]], ['goodday', 'Good day · collage teaser', 'LinkedIn needs a fix', [['ig', 'posted'], ['li', 'fail']]], ['porsche', 'Porsche cat · night drive', 'Posted 2 Sep', [['ig', 'posted']]], ['domore', 'Do more · brand spot', 'Posted 24 Aug', [['ig', 'posted'], ['wc', 'posted']]]];
add('Pub-Channels-Phone.dc.html', 'pub', 'Channel board', {
  tabLabel: 'Publish', crumb: 'Publish', heading: 'What’s going where', sub: '5 videos · 6 channels', chips: PCH, chipOn: 0,
  body: `
${VIDS.map(([c, t, s, ms], i) => `
      <div style="padding: 12px 16px; display: flex; gap: 12px;">${cover(c, ' width: 64px; height: 40px; border-radius: 8px;')}<div style="min-width: 0; flex-grow: 1;"><div class="nm">${t}</div><div class="cap" style="margin-top: 2px; color: ${i === 0 ? '#b36b00' : i === 2 ? '#e03636' : '#999999'};">${s}</div><div style="display: flex; gap: 6px; margin-top: 8px;">${ms.map(([k, st]) => mark(k, st)).join('')}</div></div></div>${i < 4 ? '<div class="rs" style="margin-left: 92px;"></div>' : ''}`).join('')}
${sec('Channels', '6 connected', 'Connect')}
${[['yt', 'Waiting on audit', '#f5a524', 82], ['ig', 'Connected', '#30a46c', 64], ['li', 'Connected', '#30a46c', 91], ['x', 'Connected', '#30a46c', 38]].map(([k, st, c, q], i) => row({ lead: lg(k, 32), title: CHN[k], sub: `${dot(c)}<span>${st}</span>`, trail: `<div style="width: 70px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;"><span class="cap">${q}% quota</span>${pbar(q)}</div>`, sep: i < 3 ? 'n' : '' })).join('')}`,
  ask: 'Ask about posting…',
  sheet: sheet('5 videos · 6 channels', 'What’s ready but not posted yet?', 'Checked 5 videos · 0.4 s', 'History of Greece Ep 75 is ready for YouTube, Instagram and LinkedIn on 12 Sep and waits for Michelle. Good day failed on LinkedIn because the file was too big.', 'Open the approval'),
});
add('Pub-Composer-Phone.dc.html', 'pub', 'Caption', {
  tabLabel: 'Publish', crumb: 'Publish · Caption', heading: 'History of Greece', sub: 'Ep 75 · export v3 · 16:9 and 9:16', chips: ['Master', 'YouTube •', 'Instagram •', 'LinkedIn'], chipOn: 1,
  body: `
      <div style="display: flex; align-items: center; gap: 10px; margin: 14px 16px 12px; padding: 10px 12px; border-radius: 14px; background: #fafafa;">${lg('yt', 22)}<span style="font-size: 13.5px; color: #525252; flex-grow: 1;">Editing the YouTube version</span><span style="font-size: 13px; color: var(--ac);">Reset</span></div>
${fld('Title <span style="margin-left: auto; font-weight: 420; color: #999999;">58 / 100</span>', 'The Battle of Salamis in 4 minutes | Ep 75', 'font-size: 14.5px;')}
${fld('Description <span style="margin-left: auto; font-weight: 420; color: #999999;">612 / 5,000</span>', 'In 480 BC a Persian fleet gathers off Attica. How did the Greeks win a strait barely a mile wide?', 'min-height: 72px; font-size: 14px; line-height: 1.5; padding: 10px 14px;')}
      <div class="fld"><div class="l">Thumbnail</div><div style="display: flex; gap: 10px;">${cover('letters', ' width: 104px; height: 58px; border-radius: 9px; box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--ac);')}${cover('head', ' width: 104px; height: 58px; border-radius: 9px;')}${cover('history', ' width: 104px; height: 58px; border-radius: 9px;')}</div></div>
      <div style="display: grid; grid-template-columns: 1fr 1fr;">${fld('Who sees it', 'Private for now', 'background: #fffbf0; font-size: 14px;')}${fld('When', 'Sat 12 Sep 19:30', 'font-size: 14px;')}</div>
${btns('Send for approval', 'Preview')}`,
  ask: 'Ask about this post…',
  sheet: sheet('Post · History of Greece Ep 75', 'Write a shorter Instagram caption', 'Drafted 3 options · 0.9 s', '“480 BC. One strait, two fleets. 海峡决定一切。” is 47 characters and keeps the Cantonese line.', 'Use it for Instagram'),
});
const ap = (c, t, chans, who, note, actions = true) => `
      <div class="card" style="margin: 12px 16px 0; padding: 12px;">
        <div style="display: flex; gap: 12px;">${cover(c, ' width: 88px; height: 50px; border-radius: 9px;')}<div style="min-width: 0; flex-grow: 1;"><div class="nm" style="font-weight: 500;">${t}</div><div style="display: flex; gap: 5px; margin-top: 6px;">${chans.map(k => lg(k, 18)).join('')}<span class="cap" style="margin-left: 4px;">Sat 12 Sep</span></div></div></div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 10px;">${pav(who, 20)}<span style="font-size: 13px; color: #525252; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${note}</span></div>
        ${actions ? '<div style="display: flex; gap: 8px; margin-top: 12px;"><div class="bs" style="height: 40px; font-size: 14px;">Changes</div><div class="bp" style="height: 40px; font-size: 14px;">Approve</div></div>' : ''}
        <div style="display: flex; justify-content: space-between; margin-top: 10px;"><span style="font-size: 13px; color: ${actions ? '#e03636' : '#999999'};">${actions ? 'Reject' : 'Waiting for Amy'}</span><span style="font-size: 13px; color: var(--ac);">✎ Edit caption</span></div>
      </div>`;
add('Pub-Approvals-Phone.dc.html', 'pub', 'Approval queue', {
  tabLabel: 'Publish', crumb: 'Publish', heading: 'Approvals', sub: '2 waiting for you', chips: PCH, chipOn: 2, me: 'michelle',
  body: `${ap('history', 'History of Greece · Ep 75', ['yt', 'ig', 'li'], 'chan', 'Chan asked 2 h ago · subtitles checked')}${ap('orange', 'Orange typography cut', ['yt'], 'leung', 'Leung asked yesterday · public version')}${ap('goodday', 'Good day · collage teaser', ['li'], 'amy', 'Amy is making a smaller file', false)}`,
  ask: 'Ask before you approve…',
  sheet: sheet('2 posts waiting', 'Is Ep 75 ready to approve?', 'Checked 3 posts · 0.3 s', 'Yes. Script v6 is locked, subtitles are attached and all three posts pass their channel’s rules. YouTube goes up private until its audit passes.', 'Approve all 3'),
});
add('Pub-Log-Phone.dc.html', 'pub', 'Publish log', {
  tabLabel: 'Publish', crumb: 'Publish', heading: 'Publish log', sub: 'Last 30 days · 6 posts', chips: PCH, chipOn: 3,
  body: [['2 Sep', [['ig', 'Porsche cat · night drive', 'Published', 'grn', '20:01 · instagram.com/p/C9x…']]], ['31 Aug', [['x', 'Orange typography cut', 'Published', 'grn', '19:30 · x.com/aurafarmers/…'], ['yt', 'Orange typography cut', 'Private', 'gray', 'Make public after the audit']]], ['11 Aug', [['ig', 'Good day · collage teaser', 'Published', 'grn', '18:00 · instagram.com/p/C8a…'], ['li', 'Good day · collage teaser', 'Failed', 'red', 'File over LinkedIn’s 200 MB limit']]]].map(([d, rs]) => `${sec(d)}
${rs.map(([k, t, st, tone, s], i) => row({ lead: lg(k, 32), title: t, sub: `<span${tone === 'red' ? ' style="color: #e03636;"' : ''}>${s}</span>`, trail: bd(st, tone), sep: i < rs.length - 1 ? 'n' : '' })).join('')}`).join('') + `
      <div class="note" style="margin-top: 8px; background: #fff7f7; color: #8a3b3b;">Retry is safe. Nothing was posted to LinkedIn, so there won’t be a duplicate. <span style="color: var(--ac);">Retry with a smaller file</span></div>`,
  ask: 'Ask about the log…',
  sheet: sheet('Publish log · 30 days', 'Why did Good day fail?', 'Read the platform response · 0.2 s', 'LinkedIn only accepts videos under 200 MB and the file was 312 MB. Nothing was posted, so retrying is safe.', 'Ask for a smaller file'),
});

/* =================================================================== */
/* ACCOUNTING                                                          */
/* =================================================================== */
const ACH = ['Inbox <b>9</b>', 'Drafts', 'Summary', 'Export'];
add('Acc-Inbox-Phone.dc.html', 'acc', 'Document inbox', {
  tabLabel: 'Accounting', crumb: 'Accounting', heading: 'Broadway Photo', sub: 'Receipt · 31 Aug · 1 field to check', chips: ACH, chipOn: 0,
  body: `
      <div style="margin: 14px 16px 0; padding: 16px; border-radius: 16px; background: #f3f3f3; display: flex; justify-content: center;"><div style="width: 230px; background: #fff; border-radius: 4px; box-shadow: 0 6px 18px rgba(0,0,0,.08); padding: 14px 16px; font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; line-height: 1.6; color: #2b2b2b;">
        <div style="text-align: center; font-weight: 700;"><span style="box-shadow: 0 0 0 2px #30a46c; border-radius: 3px;">BROADWAY PHOTO SUPPLY</span></div>
        <div style="text-align: center; color: #7c7c7c;">Mong Kok · 2332 1234</div>
        <div style="border-top: 1px dashed #c7c7c7; margin: 8px 0;"></div>
        <div style="display: flex; justify-content: space-between;"><span>DATE</span><span style="box-shadow: 0 0 0 2px #30a46c; border-radius: 3px;">31/08/2026</span></div>
        <div style="display: flex; justify-content: space-between;"><span>RODE NTG5 MIC</span><span>3,480.00</span></div>
        <div style="display: flex; justify-content: space-between;"><span>WINDSHIELD x2</span><span>800.00</span></div>
        <div style="border-top: 1px dashed #c7c7c7; margin: 8px 0;"></div>
        <div style="display: flex; justify-content: space-between; font-weight: 700;"><span>TOTAL HKD</span><span style="box-shadow: 0 0 0 2px #30a46c; border-radius: 3px;">4,280.00</span></div>
        <div style="display: flex; justify-content: space-between;"><span>PAID</span><span style="box-shadow: 0 0 0 2px #f5a524; border-radius: 3px;">VISA ****4412</span></div>
      </div></div>
${sec('What the agent read')}
${[['Supplier', 'Broadway Photo Supply', 1], ['Amount', 'HK$4,280.00 · no tax in HK', 1], ['Paid with', 'Visa ending 4412 · whose card?', 0], ['Account', '6120 · Production equipment', 1]].map(([l, v, ok], i) => row({ lead: ok ? tick() : warn(), title: v, sub: `<span>${l}${ok ? ' · read clearly' : ' · please check'}</span>`, trail: chev, sep: i < 3 ? 'n' : '', style: 'min-height: 58px;' })).join('')}
${btns('Confirm as draft')}`,
  ask: 'Ask about this receipt…',
  sheet: sheet('Broadway Photo Supply receipt', 'Whose card is this?', 'Checked company cards · 0.2 s', 'Visa 4412 isn’t a company card. It’s probably Chan Ka-ming’s own, so this becomes an expense claim for him.', 'Make it an expense claim'),
});
const entry = (d, t, lines, st, tone) => `
      <div class="card" style="margin: 12px 16px 0; padding: 0; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #f3f3f3;">${cbx(tone === 'blue')}<div style="min-width: 0; flex-grow: 1;"><div class="nm" style="font-size: 14px; font-weight: 500;">${t}</div><div class="cap">${d}</div></div>${bd(st, tone)}</div>
${lines.map(([c, n, dr, cr]) => `        <div style="display: flex; align-items: center; gap: 8px; padding: 9px 14px; font-size: 13.5px;"><span style="font-family: ui-monospace, monospace; font-size: 11.5px; color: #999999;">${c}</span><span style="flex-grow: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n}</span><span style="font-variant-numeric: tabular-nums; color: ${dr ? '#171717' : '#999999'};">${dr ? 'Dr ' + dr : 'Cr ' + cr}</span></div>`).join('\n')}
      </div>`;
add('Acc-Drafts-Phone.dc.html', 'acc', 'Draft entries', {
  tabLabel: 'Accounting', crumb: 'Accounting · August 2026', heading: 'Draft entries', sub: '12 drafts · every entry balances', chips: ACH, chipOn: 1,
  body: `${entry('31 Aug · receipt', 'Broadway Photo Supply', [['6120', 'Production equipment', '4,280.00'], ['2110', 'Expense claims · Chan', '', '4,280.00']], 'Draft', 'blue')}${entry('28 Aug · invoice', 'Cathay Pacific', [['6500', 'Travel', '9,640.00'], ['2100', 'Accounts payable', '', '9,640.00']], 'Draft', 'blue')}${entry('24 Aug · invoice', 'HK Film Archive', [['6210', 'Licensing and archive', '1,200.00'], ['1010', 'HSBC business', '', '1,200.00']], 'Approved', 'grn')}
${btns('Approve 2 selected')}`,
  ask: 'Ask about these entries…',
  sheet: sheet('12 draft entries', 'Which bank lines have no receipt?', 'Matched 89 bank lines · 0.5 s', 'Three: a crew lunch at Ming’s Kitchen (HK$3,210), an FPS transfer to W Chan (HK$6,500) and a bank fee (HK$2,700).', 'Find the receipts'),
});
add('Acc-Period-Phone.dc.html', 'acc', 'Period summary', {
  tabLabel: 'Accounting', crumb: 'Accounting', heading: 'August 2026', sub: '128 confirmed entries', chips: ACH, chipOn: 2,
  body: `<div style="padding-top: 14px;">${kpis([['Money in', 'HK$1.84 M', '8 invoices'], ['Money out', 'HK$1.20 M', '128 entries'], ['Left over', 'HK$635,700', '34.5% of money in', '#278f5e'], ['Not counted yet', '9 docs', 'about HK$38,420', '#b36b00']])}</div>
${sec('Where the money went')}
${[['Contractors', 412800], ['Production equipment', 284100], ['Licensing and archive', 196400], ['AI consumption', 88600]].map(([n, v], i) => `<div style="padding: 7px 16px;"><div style="display: flex; justify-content: space-between; font-size: 14px;"><span>${n}</span><span style="font-variant-numeric: tabular-nums;">HK$${v.toLocaleString('en-US')}</span></div><div style="margin-top: 6px;">${pbar(Math.round(v / 412800 * 100), i ? '#8d99a6' : '')}</div></div>`).join('')}
${sec('Who owes us', 'HK$318,400')}
      <div style="display: flex; gap: 2px; height: 12px; margin: 0 16px; border-radius: 6px; overflow: hidden;"><div style="flex: 78; background: var(--ac);"></div><div style="flex: 11; background: #8fc3f1;"></div><div style="flex: 6; background: #d4d4d4;"></div><div style="flex: 5; background: #e5484d;"></div></div>
      <div class="note" style="margin-top: 12px; background: #fff7f7; color: #8a3b3b;">Harbour City promo · HK$46,200 is 96 days late.</div>`,
  ask: 'Ask about the month…',
  sheet: sheet('August 2026', 'Anything unusual this month?', 'Read 128 entries · 0.6 s', 'Contractors are 8.6% over budget from the night shoots, and one invoice is 96 days unpaid. I can draft a reminder.', 'Draft the reminder'),
});
add('Acc-Export-Phone.dc.html', 'acc', 'Export', {
  tabLabel: 'Accounting', crumb: 'Accounting', heading: 'Export to Xero', sub: 'August 2026 · 34 approved entries', chips: ACH, chipOn: 3,
  body: `
      <div style="display: flex; align-items: center; gap: 12px; margin: 14px 16px 0; padding: 12px 14px; border-radius: 16px; border: 1.5px solid var(--ac); background: #f5faff;">${BRAND.xero(34)}<div style="flex-grow: 1;"><div style="font-size: 15px; font-weight: 500;">Xero · bank statement CSV</div><div class="cap">Your accounting software</div></div>${tick('var(--ac)')}</div>
      <div style="padding-top: 12px;">${kpis([['Going in', '34 entries', 'all approved'], ['Left out', '12 drafts', 'not approved yet'], ['Balance', 'Matches', 'debits equal credits', '#278f5e'], ['File', 'CSV', '34 rows · 6 KB']])}</div>
${sec('File preview', 'first 3 rows')}
      <div style="margin: 0 16px; border: 1px solid #ededed; border-radius: 14px; overflow: hidden; font-family: ui-monospace, Menlo, monospace; font-size: 12px;">${[['Date', 'Amount', 'Payee'], ['31/08', '-4280.00', 'Broadway Photo'], ['28/08', '-9640.00', 'Cathay Pacific'], ['01/08', '120000.00', 'Kowloon Bay Mall']].map((r, i) => `<div style="display: grid; grid-template-columns: 60px 90px minmax(0, 1fr); gap: 10px; padding: 9px 12px; ${i ? 'border-top: 1px solid #f3f3f3;' : 'background: #fafafa; color: #999999;'}">${r.map(c => `<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${c}</span>`).join('')}</div>`).join('')}</div>
${btns('Download for Xero')}`,
  ask: 'Ask about this export…',
  sheet: sheet('Export · August 2026', 'Will this import cleanly?', 'Checked 34 rows against Xero · 0.4 s', 'Yes. Every row uses an account code in your Xero chart. The one US-dollar row (Adobe) is converted at the bank’s rate.', 'Download for Xero'),
});

/* =================================================================== */
/* FINANCE                                                             */
/* =================================================================== */
const FCH = ['Budget', 'Cash', 'Costs', 'Spend <b>2</b>', 'Reports'];
add('Fin-Budget-Phone.dc.html', 'fin', 'Budget', {
  tabLabel: 'Finance', crumb: 'Finance', heading: 'Budget · Q3 2026', sub: 'v3 · approved 1 Jul by Michelle', chips: FCH, chipOn: 0,
  body: `
      <div class="note" style="margin-top: 14px; background: #fafafa; color: #525252;">Lines come from the client’s template. Finance sets the amounts here. Actuals fill in from confirmed Accounting entries.</div>
${[['Production', [['Equipment', 320000, 284100], ['Contractors', 380000, 412800], ['Licensing and archive', 180000, 196400], ['Travel and locations', 60000, 41200]]], ['Platform', [['AI consumption', 120000, 88600], ['Software', 48000, 45900]]]].map(([g, ls]) => `${sec(g)}
${ls.map(([n, b, a], i) => { const u = Math.round(a / b * 100), over = a > b; return `<div style="padding: 8px 16px;${i < ls.length - 1 ? ' border-bottom: 1px solid #f3f3f3;' : ''}"><div style="display: flex; justify-content: space-between; font-size: 14.5px;"><span>${n}</span><span style="color: ${over ? '#e03636' : '#171717'}; font-variant-numeric: tabular-nums;">${u}%</span></div><div style="margin: 7px 0 5px;">${pbar(Math.min(100, u), over ? '#e03636' : u > 90 ? '#f5a524' : '')}</div><div class="cap">HK$${a.toLocaleString('en-US')} of HK$${b.toLocaleString('en-US')}</div></div>`; }).join('')}`).join('')}
${btns('Edit budget', 'Import template')}`,
  ask: 'Ask about the budget…',
  sheet: sheet('Budget · Q3 2026', 'Where will we go over?', 'Read budget v3 · 0.8 s', 'Contractors are over by HK$32,800 and licensing by HK$16,400. Travel and equipment still have room, so the quarter lands about 3% under.', 'Draft a budget change'),
});
add('Fin-Cash-Phone.dc.html', 'fin', 'Cash-flow projection', {
  tabLabel: 'Finance', crumb: 'Finance', heading: 'Cash flow', sub: 'Next three months', chips: FCH, chipOn: 1,
  body: `<div style="padding-top: 14px;">${kpis([['Cash today', 'HK$2.14 M', 'bank, 9 Sep'], ['In 90 days', 'HK$2.61 M', '2.36 to 2.86 M']])}</div>
      <div style="margin: 12px 16px 0;" class="card"><div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;"><span style="font-size: 14px; font-weight: 500;">Cash balance</span>${bd('Indicative')}</div>
        <svg viewBox="0 0 334 120" style="width: 100%; height: 120px; display: block;"><path d="M200 62 L260 40 L300 48 L334 22 L334 58 L300 80 L260 70 Z" fill="var(--ac)" opacity=".1"/><path d="M0 96 L70 88 L140 80 L200 62" fill="none" stroke="var(--ac)" stroke-width="2.2"/><path d="M200 62 L260 54 L300 64 L334 40" fill="none" stroke="var(--ac)" stroke-width="2" stroke-dasharray="5 5"/><circle cx="200" cy="62" r="4" fill="#fff" stroke="var(--ac)" stroke-width="2"/></svg>
        <div style="display: flex; justify-content: space-between;" class="cap"><span>Jul</span><span>Sep · today</span><span>Dec</span></div></div>
${sec('Built from', '6 entries', '+ Add')}
${[['in', 'Tourism Board final invoice', '15 Oct', '+480,000', 'Confirmed', 'grn'], ['in', 'Harbourfront series pitch', '20 Nov', '+260,000', 'Possible', 'gray'], ['out', 'Payroll', 'Monthly', '−310,000', 'Confirmed', 'grn'], ['out', 'Second camera body', 'Oct', '−46,800', 'Waiting', 'amb']].map(([d, n, w, a, s, t], i) => row({ lead: `<div style="width: 34px; height: 34px; border-radius: 10px; background: ${d === 'in' ? '#e4faeb' : '#ffe7e7'}; color: ${d === 'in' ? '#278f5e' : '#e03636'}; font-size: 18px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${d === 'in' ? '+' : '−'}</div>`, title: n, sub: `<span>${w} · HK$${a}</span>`, trail: bd(s, t), sep: i < 3 ? 'i' : '' }).replace('margin-left: 82px', 'margin-left: 62px')).join('')}`,
  ask: 'Ask a what-if…',
  sheet: sheet('Cash flow · 90 days', 'What if the Tourism Board pays late?', 'Re-ran the projection · 0.2 s', 'The lowest point drops to HK$1.85 M in mid-November, still above your HK$1.5 M floor. Runway goes from 14 to 12 months.', 'Save as a scenario'),
});
add('Fin-Cost-Phone.dc.html', 'fin', 'Cost dashboard', {
  tabLabel: 'Finance', crumb: 'Finance', heading: 'Costs', sub: 'Jan to Aug 2026 · by category', chips: FCH, chipOn: 2,
  body: `
      <div style="margin: 14px 16px 0;" class="card"><div class="cap" style="margin-bottom: 10px;">Monthly cost · confirmed entries + token ledger</div>
        <div style="display: flex; align-items: flex-end; gap: 8px; height: 150px;">${[[56, 38, 22, 14], [62, 44, 26, 16], [70, 40, 30, 18], [84, 52, 28, 22], [92, 48, 34, 26], [104, 56, 30, 24], [118, 60, 36, 28], [96, 66, 40, 30]].map(v => { const tot = v.reduce((a, b) => a + b, 0), k = 150 / 260; return `<div style="flex: 1; display: flex; flex-direction: column-reverse; gap: 2px; height: ${Math.round(tot * k)}px;">${v.map((h, j) => `<div style="height: ${Math.round(h * k)}px; background: ${['var(--ac)', '#8d99a6', '#c7c7c7', '#e2e2e2'][j]}; border-radius: ${j === 3 ? '4px 4px 0 0' : j === 0 ? '0 0 4px 4px' : '0'};"></div>`).join('')}</div>`; }).join('')}</div>
        <div style="display: flex; justify-content: space-between; margin-top: 6px;" class="cap">${['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A'].map(m => `<span style="flex: 1; text-align: center;">${m}</span>`).join('')}</div></div>
${sec('August')}
${[['Contractors', 'HK$137,600', 'var(--ac)'], ['Equipment', 'HK$70,800', '#8d99a6'], ['Licensing', 'HK$65,400', '#c7c7c7'], ['AI consumption', 'HK$29,500', '#e2e2e2']].map(([n, v, c], i) => row({ lead: `<span style="width: 12px; height: 12px; border-radius: 4px; background: ${c}; flex-shrink: 0;"></span>`, title: n, trail: `<span style="font-size: 14px; font-variant-numeric: tabular-nums;">${v}</span>`, sep: i < 3 ? 'n' : '', style: 'min-height: 50px;' })).join('')}`,
  ask: 'Ask about costs…',
  sheet: sheet('Costs · 2026', 'Why did July spike?', 'Read 8 months · 0.5 s', 'July had the two-camera night shoots: contractors rose to HK$118k and equipment hire doubled. AI spend stayed flat.', 'Show July in detail'),
});
add('Fin-Spend-Phone.dc.html', 'fin', 'Spend requests', {
  tabLabel: 'Finance', crumb: 'Finance · Spend requests', heading: 'New request', sub: 'Draft · saved 1 min ago', chips: FCH, chipOn: 3,
  body: `<div style="padding-top: 14px;"></div>
${fld('What is it for?', 'Drone permit and operator, Tai O shoot', 'font-size: 14.5px;')}
      <div style="display: grid; grid-template-columns: 1fr 1fr;">${fld('Amount', 'HK$18,500')}${fld('Needed by', '26 Sep')}</div>
${fld('Budget line', 'Travel and locations<span class="cap" style="margin-left: auto;">HK$18,800 left</span>', 'font-size: 14.5px;')}
${sec('Who will approve', 'from the amount')}
${[['chan', 'You', 'Requester'], ['michelle', 'Michelle Yip', 'Head of production · 10k to 40k']].map(([k, n, r], i) => row({ lead: pav(k, 34), title: n, sub: `<span>${r}</span>`, trail: i ? bd('Next', 'blue') : '', sep: 'i' })).join('')}
${row({ lead: ini('CF', 34), title: 'CFO', sub: '<span>Only above HK$40k · skipped</span>', sep: '', style: 'opacity: .45;' })}
${btns('Submit for approval', 'Save draft')}`,
  ask: 'Ask about this request…',
  sheet: sheet('Spend request · draft', 'Is there budget left?', 'Read budget v3 · 0.3 s', 'Just. Travel and locations has HK$18,800 left and this uses HK$18,500. The Harbourfront recce on 30 Sep won’t fit.', 'Add a note for Michelle'),
});
add('Fin-Reports-Phone.dc.html', 'fin', 'Report drafts', {
  tabLabel: 'Finance', crumb: 'Finance · Report drafts', heading: 'August report', sub: 'Draft · written for you to edit', chips: FCH, chipOn: 4,
  body: `
      <div class="note" style="margin-top: 14px; background: #fafafa; color: #525252;">On the 1st of each month the agent drafts this from Budget, Cash flow and Costs. You edit it, then share it.</div>
${sec('Summary')}
      <div style="padding: 0 16px; font-size: 15px; line-height: 1.65; color: #2b343d;"><span style="background: #f5faff; box-shadow: 0 0 0 2px #f5faff; border-radius: 3px;">August closed HK$35,900 under budget on equipment</span> <span class="bd gray" style="height: 20px;">Budget</span>, offset by an 8.6% overrun on contractors. AI spend stayed 26% below plan <span class="bd gray" style="height: 20px;">Token ledger</span>.</div>
${sec('Cash and receivables')}
      <div style="padding: 0 16px; font-size: 15px; line-height: 1.65; color: #2b343d;">Cash stands at HK$2.14 M. One invoice of HK$46,200 is past 90 days and should be chased <span class="bd gray" style="height: 20px;">Accounting</span>.</div>
${sec('Earlier reports')}
${[['July 2026', 'Shared 5 Aug'], ['Q2 2026 quarterly', 'Shared 8 Jul']].map(([t, s], i) => row({ lead: `<div style="width: 40px; display: flex; justify-content: center;">${docIcon('locked', 2)}</div>`, title: t, sub: `<span>${s}</span>`, trail: chev, sep: i < 1 ? 'i' : '' })).join('')}`,
  ask: 'Ask about this report…',
  sheet: sheet('August report · draft', 'Make the summary shorter', 'Rewrote 1 paragraph · 0.7 s', 'August came in HK$35,900 under on equipment, 8.6% over on contractors. AI spend is 26% below plan.', 'Use it'),
});

/* =================================================================== */
/* LEGAL                                                               */
/* =================================================================== */
const LCH = ['Drafting', 'Clause review <b>2</b>', 'Contracts', 'Compliance'];
const disc = '<div class="note" style="margin-top: 14px; background: #f5f5f5; color: #525252; font-size: 13px;">This module doesn’t give legal advice. It points out differences for you to judge.</div>';
add('Legal-Draft-Phone.dc.html', 'legal', 'Document drafting', {
  tabLabel: 'Legal', crumb: 'Legal', heading: 'Drafting', sub: 'From the client’s approved templates', chips: LCH, chipOn: 0,
  body: `${disc}
${sec('Templates', '3 approved')}
${[['Freelance contributor agreement', 'v4 · approved'], ['Location release', 'v2 · approved'], ['Music licence addendum', 'v1 · approved']].map(([t, s], i) => row({ lead: `<div style="width: 40px; display: flex; justify-content: center;">${docIcon('locked', 2)}</div>`, title: t, sub: `<span>${s}</span>`, trail: chev, sep: i < 2 ? 'i' : '' })).join('')}
${sec('New draft', 'Freelance contributor agreement')}
${fld('Counterparty', 'Vincent Chow')}
      <div style="display: grid; grid-template-columns: 1fr 1fr;">${fld('Work', 'Colour grading')}${fld('Fee', 'HK$28,000')}</div>
${btns('Draft from template')}`,
  ask: 'Ask about drafting…',
  sheet: sheet('Legal · drafting', 'Which template for a freelancer?', 'Read 3 templates · 0.2 s', 'Freelance contributor agreement v4. Fill in the counterparty, the work and the fee; everything else comes from the template.', 'Start the draft'),
});
add('Legal-Clause-Phone.dc.html', 'legal', 'Clause review', {
  tabLabel: 'Legal', crumb: 'Legal · Clause review', heading: 'Contributor agreement', sub: 'From Vincent Chow · 4 differences', chips: LCH, chipOn: 1,
  body: `
      <div style="display: flex; align-items: center; gap: 10px; margin: 14px 16px 0; padding: 12px; border-radius: 16px; border: 1px solid #ededed;"><div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">${docIcon('await', 1.6)}<div style="min-width: 0;"><div class="cap">Theirs</div><div style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">vchow_agreement.pdf</div></div></div><span class="cap">vs</span><div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">${docIcon('locked', 1.6)}<div style="min-width: 0;"><div class="cap">Your template</div><div style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Contributor v4</div></div></div></div>
${sec('Differences', '2 changed · 1 missing · 1 position')}
${[['1', '#db7706', '4. Who owns the footage', 'Theirs: Vincent until paid. Yours: the Company from creation.'], ['2', '#db7706', '7. Notice to end it', '7 days here; your template says 30.'], ['3', '#e03636', '9. Confidentiality', 'Missing. Your template has one.'], ['4', '#7c7c7c', '12. Which country’s law', 'Singapore; your position is Hong Kong.']].map(([n, c, t, s], i) => row({ lead: `<div style="width: 28px; height: 28px; border-radius: 14px; background: ${c}; color: #fff; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${n}</div>`, title: t, sub: `<span>${s}</span>`, trail: chev, sep: i < 3 ? 'n' : '' })).join('')}
${disc}`,
  ask: 'Ask about this document…',
  sheet: sheet('Contributor agreement · 4 differences', 'Which difference matters most?', 'Compared with template v4 · 0.6 s', 'Number 1: until he’s paid, Vincent would own the footage, so you couldn’t publish on time if payment slips. This is a difference, not legal advice.', 'Ask for our wording'),
});
add('Legal-Repo-Phone.dc.html', 'legal', 'Contract repository', {
  tabLabel: 'Legal', crumb: 'Legal', heading: 'Contracts', sub: '4 signed · 1 renewal soon', chips: LCH, chipOn: 2,
  body: `<div style="padding-top: 6px;"></div>
${[['Archive footage licence', 'HK Film Archive · renews 24 Nov', 'In 21 days', 'amb'], ['Freelance contributor agreement', 'Vincent Chow · renews 12 Jun 2027', 'Reminder 90 d', 'gray'], ['Music catalogue subscription', 'ElevenLabs · renews 1 Jan 2027', 'Reminder 60 d', 'gray'], ['Studio lease', 'Kwun Tong Industrial · ends 31 Mar 2027', 'Reminder 120 d', 'gray']].map(([t, s, b, tone], i) => row({ lead: `<div style="width: 40px; display: flex; justify-content: center;">${docIcon('locked', 2)}</div>`, title: t, sub: `<span>${s}</span>`, trail: bd(b, tone), sep: i < 3 ? 'i' : '' })).join('')}
${disc}`,
  ask: 'Ask about contracts…',
  sheet: sheet('4 contracts', 'What renews this quarter?', 'Read 4 contracts · 0.2 s', 'The HK Film Archive licence renews on 24 Nov. Its notice period is 30 days, so decide by 25 Oct.', 'Set a reminder'),
});
add('Legal-Compliance-Phone.dc.html', 'legal', 'Compliance checklists', {
  tabLabel: 'Legal', crumb: 'Legal', heading: 'Compliance', sub: '4 recurring items · 1 overdue', chips: LCH, chipOn: 3,
  body: `<div style="padding-top: 6px;"></div>
${[['PDPO data inventory review', 'Quarterly · comment data', 'michelle', 'Done 1 Sep', 'grn', 1], ['Platform audit renewals', 'YouTube and TikTok', 'amy', 'Due 30 Sep', 'amb', 0], ['Consent and retention audit', 'Candidate records', 'michelle', 'Due 31 Oct', 'gray', 0], ['API key rotation', 'All channels and models', 'chan', 'Overdue 14 d', 'red', 0]].map(([t, s, o, b, tone, done], i) => row({ lead: cbx(done), title: t, sub: `${pav(o, 16)}<span>${s}</span>`, trail: bd(b, tone), sep: i < 3 ? 'n' : '' })).join('')}`,
  ask: 'Ask about compliance…',
  sheet: sheet('4 checklist items', 'What’s overdue?', 'Read 4 items · 0.1 s', 'API key rotation is 14 days overdue. It’s Chan’s item; the keys are referenced in Admin and never shown.', 'Remind Chan'),
});

fs.writeFileSync(path.join(DIR, 'phones-b.json'), JSON.stringify(out, null, 1));
console.log('wrote', out.length, 'phones');
