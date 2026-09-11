/**
 * Script, hand-authored screens.
 *
 * Information architecture (replaces the four "stage" pages that all showed
 * one script):
 *   Script-Library   every script in a folder, Finder-style page previews,
 *                    grid ⇄ list, status filters
 *   Script-Brief     one script, Brief tab     (§4.4 brief intake)
 *   Script-Editor    one script, Draft tab     (§4.4 "split editor": draft
 *                    left, house-style sidebar right, inline suggestions,
 *                    rewrite-on-selection)
 *   Script-Versions  one script, Versions tab (diff any two, author + time)
 *   Script-Lock      one script, Approval tab (approver's view; lock hands
 *                    the single authorised version to Video Edit)
 *   Script-Locked    a different, locked script, read-only, approval record
 *
 * Inside a script the left sidebar lists every other script grouped by
 * status, so switching scripts is one click from any tab.
 *
 * Run:  node script-screens.mjs
 */
import fs from 'fs';
import path from 'path';
import { page as shellPage, ICON, collapsible, toggleBtn, SIMPLE } from './shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.join(DIR, 'Desktop.dc.html'), 'utf8');
const css = src.slice(src.indexOf('<style>') + 7, src.indexOf('</style>'))
  .replace("font-family: Inter, system-ui, sans-serif;", "font-family: Inter, 'PingFang HK', 'Noto Sans HK', system-ui, sans-serif;");

const EXTRA_CSS = `
    .tabs { height: 40px; flex-shrink: 0; display: flex; align-items: stretch; gap: 20px; padding: 0 22px; border-bottom: 1px solid #ededed; }
    .tb { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #7c7c7c; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tb.on { color: #171717; font-weight: 500; border-color: #171717; }
    .tb b { font-size: 10.5px; font-weight: 500; color: #999999; }
    .tb svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .rtab { height: 26px; padding: 0 11px; border-radius: 7px; display: flex; align-items: center; gap: 6px; font-size: 12px; color: #7c7c7c; }
    .rtab.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500; }
    .cap { font-size: 11px; color: #999999; }
    .seg { width: 30px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .seg svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .fc { height: 26px; padding: 0 10px; border-radius: 7px; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #525252; border: 1px solid #ededed; background: #fff; white-space: nowrap; }
    .fc b { font-weight: 500; color: #999999; font-size: 11px; }
    .fc.on { background: #171717; border-color: #171717; color: #fff; }
    .fc.on b { color: #c7c7c7; }
    .dot { width: 7px; height: 7px; border-radius: 4px; flex-shrink: 0; }

    /* Finder-style page previews */
    .well { height: 176px; border-radius: 10px; background: #f5f5f5; display: flex; align-items: center; justify-content: center; position: relative; }
    .tl.sel .well { background: #eaf4fd; box-shadow: 0 0 0 2px var(--ac); }
    .pg { width: 120px; height: 154px; background: #fff; border-radius: 3px; overflow: hidden; box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 2px 6px rgba(0,0,0,.08); position: relative; }
    .pgi { width: 480px; height: 616px; padding: 38px 36px; transform: scale(.25); transform-origin: 0 0; }
    .pgi h4 { margin: 0; font-size: 23px; font-weight: 600; line-height: 1.2; color: #171717; letter-spacing: -.01em; }
    .pgi .pm { font-size: 12px; color: #999999; margin-top: 8px; padding-bottom: 14px; border-bottom: 1.5px solid #ededed; }
    .pgi .pb { display: grid; grid-template-columns: 34px 132px 1fr; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f3f3f3; }
    .pgi .pb i { font-style: normal; font-size: 10px; color: #999999; font-weight: 600; }
    .pgi .pb span { font-size: 11px; line-height: 1.45; color: #7c7c7c; }
    .pgi .pb p { font-size: 13px; line-height: 1.45; color: #383838; }
    .pgi .pf { background: #f3f3f3; border-radius: 6px; padding: 9px 11px; margin-top: 10px; }
    .pgi .pf i { display: block; font-style: normal; font-size: 10px; color: #999999; font-weight: 600; margin-bottom: 4px; }
    .pgi .pf p { font-size: 13px; color: #383838; line-height: 1.4; }
    .stamp { position: absolute; top: 8px; right: 8px; height: 17px; padding: 0 5px; border-radius: 4px; display: flex; align-items: center; gap: 3px; font-size: 9px; font-weight: 600; letter-spacing: .04em; }
    .stamp svg { width: 9px; height: 9px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .tt { font-size: 12.5px; font-weight: 500; line-height: 1.35; color: #171717; margin-top: 10px; height: 34px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .fold { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 12px; border: 1px solid #ededed; border-radius: 10px; background: #fff; }
    .fold svg.fi { width: 30px; height: 24px; flex-shrink: 0; }

    /* icon grid (library) */
    .ic { display: flex; flex-direction: column; align-items: center; padding: 8px 4px 6px; border-radius: 10px; min-width: 0; }
    .icn { height: 62px; width: 76px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 6px; border-radius: 9px; }
    .ic.sel .icn { background: #f3f3f3; }
    .icl { margin-top: 7px; text-align: center; font-size: 12px; line-height: 1.4; color: #171717; max-width: 100%; }
    .icl span { padding: 1px 5px; border-radius: 5px; -webkit-box-decoration-break: clone; box-decoration-break: clone; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .ic.sel .icl span { background: var(--ac); color: #fff; }
    .icm { display: flex; align-items: center; gap: 5px; margin-top: 4px; font-size: 11px; color: #999999; white-space: nowrap; }
    .icm .dot { width: 6px; height: 6px; }

    /* script switcher */
    .sn { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 9px; border-radius: 8px; font-size: 12.5px; color: #525252; }
    .sn span { flex-grow: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sn span.dot { flex-grow: 0; }
    .sn.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500; }
    .sn img { width: 16px; height: 16px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
    .sg { display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 500; color: #999999; padding: 0 9px; margin: 14px 0 4px; }
    .sg svg { width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }

    /* editor */
    .tool { width: 28px; height: 28px; border-radius: 7px; display: flex; align-items: center; justify-content: center; color: #525252; }
    .tool svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .bt { display: grid; grid-template-columns: 58px 228px minmax(0, 1fr); gap: 0 20px; padding: 13px 0; border-bottom: 1px solid #f3f3f3; }
    .bt .bn { font-size: 10.5px; font-weight: 500; color: #999999; line-height: 1.5; font-variant-numeric: tabular-nums; }
    .bt .bn b { display: block; font-weight: 500; color: #c7c7c7; }
    .bt .vi { font-size: 12.5px; line-height: 1.55; color: #7c7c7c; }
    .bt .zh { font-size: 14px; line-height: 1.6; color: #171717; }
    .bt .en { font-size: 12.5px; line-height: 1.55; color: #7c7c7c; margin-top: 3px; }
    .wv { text-decoration: underline wavy #db7706; text-decoration-thickness: 1.4px; text-underline-offset: 3px; text-decoration-skip-ink: none; }
    .sl { background: #d6eafc; border-radius: 2px; box-shadow: 0 0 0 2px #d6eafc; }
    .ins { background: #e4faeb; color: #1f7a4d; border-radius: 2px; }
    .del { background: #ffe7e7; color: #c53030; text-decoration: line-through; border-radius: 2px; }
    .pop { position: absolute; background: #fff; border: 1px solid #e2e2e2; border-radius: 11px; box-shadow: 0 8px 24px rgba(0,0,0,.1), 0 1px 3px rgba(0,0,0,.06); z-index: 3; }
    .kbd { display: inline-flex; align-items: center; height: 18px; padding: 0 5px; border-radius: 4px; border: 1px solid #e2e2e2; font-size: 10.5px; color: #7c7c7c; background: #fafafa; }
    .qc { height: 24px; padding: 0 9px; border-radius: 7px; background: #f3f3f3; display: inline-flex; align-items: center; font-size: 11.5px; color: #525252; white-space: nowrap; }
    .sug { border: 1px solid #ededed; border-radius: 10px; background: #fff; padding: 10px 11px; }
    .sug .k { display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 500; color: #999999; }
    .sug .q { font-size: 12.5px; color: #171717; margin-top: 5px; line-height: 1.45; }
    .sug .w { font-size: 11.5px; color: #7c7c7c; margin-top: 3px; line-height: 1.45; }
    .mb { height: 4px; border-radius: 2px; background: #ededed; margin-top: 6px; position: relative; }
    .mb div { height: 4px; border-radius: 2px; }
    .ck { width: 18px; height: 18px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .ck svg { width: 11px; height: 11px; stroke: #fff; fill: none; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
    .li { display: flex; gap: 11px; padding: 11px 0; border-bottom: 1px solid #f3f3f3; }
    .li .a { font-size: 12.5px; color: #171717; }
    .li .b { font-size: 11.5px; color: #999999; margin-top: 2px; }
    .inp { height: 32px; border-radius: 8px; background: #f3f3f3; display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: 12.5px; color: #171717; }
    .inp svg { width: 12px; height: 12px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .fl { font-size: 11px; font-weight: 500; color: #7c7c7c; margin-bottom: 6px; }
    .df { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); border: 1px solid #ededed; border-radius: 10px; overflow: hidden; margin-bottom: 10px; }
    .df > div { padding: 11px 13px; font-size: 13px; line-height: 1.6; color: #383838; }
    .df > div:first-child { border-right: 1px solid #ededed; }
    .dh { grid-column: 1 / -1; padding: 7px 13px !important; background: #f8f8f8; border-bottom: 1px solid #ededed; font-size: 11px !important; color: #7c7c7c !important; display: flex; align-items: center; gap: 8px; }
    .vr { display: flex; gap: 10px; padding: 11px 12px; border-radius: 9px; }
    .vr.on { background: #f8f8f8; }
    .vr .bd { flex-grow: 0; }
    .ab { width: 18px; height: 18px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; flex-shrink: 0; }
    .shot { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #f3f3f3; }
    .shot i { font-style: normal; width: 22px; font-size: 10.5px; color: #999999; font-weight: 500; font-variant-numeric: tabular-nums; }
    .shot span { flex-grow: 1; min-width: 0; font-size: 12px; color: #383838; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`;

/* ---------- people ---------- */
const P = { amy: ['pfp-amy.jpg', 'Amy Wong'], leung: ['pfp-leung.jpg', 'Leung Chi-hang'], chan: ['pfp-chan.jpg', 'Chan Ka-ming'], michelle: ['pfp-michelle.jpg', 'Michelle Yip'] };
const av = (k, s = 20, extra = '') => `<img class="av" src="${P[k][0]}" style="width: ${s}px; height: ${s}px;${extra}">`;

/* ---------- status vocabulary ---------- */
const ST = {
  brief:   ['Brief', 'gray', '#c7c7c7'],
  draft:   ['Drafting', 'blue', '#007be0'],
  changes: ['Changes requested', 'red', '#e03636'],
  await:   ['Awaiting approval', 'amb', '#db7706'],
  locked:  ['Locked', 'grn', '#278f5e'],
};
const LOCK = '<svg viewBox="0 0 24 24" style="width: 10px; height: 10px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;"><path d="M6.8 10.5h10.4v8H6.8z"/><path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5"/></svg>';
const badge = st => `<span class="bd ${ST[st][1]}" style="gap: 4px;">${st === 'locked' ? LOCK : ''}${ST[st][0]}</span>`;

/* ---------- the folder: 11 scripts ---------- */
const DOCS = [
  { id: 'ssp', t: 'Sham Shui Po dai pai dong revival', st: 'draft', v: 4, o: 'amy', dur: '3:48', sc: 82, ch: 'YouTube · 16:9', ed: '2 min ago',
    b: [['Stall shutters rolling up at 6:40 am.', '（現場聲）', 'Natural sound only.'], ['Wide handheld along Pei Ho Street.', '深水埗曾經有過百檔大牌檔，今日只剩四檔。', 'Sham Shui Po once had over a hundred dai pai dong. Four are left.'], ['Mrs Ho at her counter, mid-shot.', '「張牌係我阿爸留低嘅。」', '“My father left me this licence.”'], ['Renewal letter on the counter.', '發牌委員會八月決定……', 'In August the licensing board ruled…']] },
  { id: 'tpe', t: 'Taipei night-market crossover creators', st: 'await', v: 3, o: 'leung', dur: '2:10', sc: 91, ch: 'Instagram · 9:16', ed: '2 h ago',
    b: [['Raohe market gate, neon, vertical.', '香港創作者過海開檔。', 'Hong Kong creators set up stalls across the strait.'], ['Creator plating egg waffles.', '一晚賣三百份。', 'Three hundred portions a night.'], ['Queue from above.', '排隊嘅大部分係本地人。', 'Most of the queue is local.']] },
  { id: 'grc', t: 'History of Greece · Ep 75', st: 'locked', v: 6, o: 'chan', dur: '3:48', sc: 94, ch: 'YouTube · 16:9', ed: '28 Aug',
    b: [['Map of the Aegean, slow push.', 'In 480 BC, a fleet gathers at Salamis.', '公元前480年，艦隊喺薩拉米斯集結。'], ['Trireme reconstruction, oars.', 'Three banks of rowers, one drum.', '三排槳手，一個鼓。'], ['Strait at dusk, wide.', 'The narrows decide everything.', '海峽決定一切。']] },
  { id: 'vcl', t: 'Cantonese voice cloning backlash', st: 'draft', v: 1, o: 'leung', dur: '2:55', sc: 64, ch: 'YouTube · 16:9', ed: 'Yesterday',
    b: [['Studio mic, dark room.', '一把聲，可以唔屬於你。', 'A voice that no longer belongs to you.'], ['Voice actor interview.', '「我聽到自己講我冇講過嘅嘢。」', '“I heard myself say things I never said.”'], ['Waveform graphic.', '三十秒錄音已經夠。', 'Thirty seconds of audio is enough.']] },
  { id: 'gdy', t: 'Good day · collage teaser', st: 'await', v: 2, o: 'amy', dur: '0:20', sc: 88, ch: 'Instagram · 9:16', ed: 'Yesterday',
    b: [['Paper cut-outs, stop motion.', '早晨。', 'Good morning.'], ['Collage of commuters.', '今日都係好日子。', 'Today is a good day too.']] },
  { id: 'hbf', t: 'Harbourfront redevelopment hearing', st: 'brief', o: 'leung', dur: 'target 4:00', ch: 'YouTube · 16:9', ed: '3 Sep', flag: 1,
    f: [['Topic', 'Harbourfront redevelopment hearing'], ['Angle', 'What residents actually asked for'], ['Channel', 'YouTube · 16:9 · 4 min'], ['Mandatory points', 'Quote the hearing record. Show both sides.']] },
  { id: 'prs', t: 'Porsche cat · night drive', st: 'locked', v: 3, o: 'chan', dur: '0:30', sc: 88, ch: 'Instagram · 9:16', ed: '2 Sep',
    b: [['Cat on the driver seat, neon.', '夜晚，佢揸車。', 'At night, the cat drives.'], ['Tail lights, Tsing Ma bridge.', '冇目的地。', 'No destination.']] },
  { id: 'cct', t: 'Cha chaan teng menu inflation', st: 'changes', v: 2, o: 'amy', dur: '2:40', sc: 77, ch: 'LinkedIn · 1:1', ed: '1 Sep',
    b: [['Menu board, 2016 vs 2026.', '奶茶十年貴咗一倍。', 'Milk tea has doubled in ten years.'], ['Owner counting receipts.', '租金先係問題。', 'Rent is the real problem.']] },
  { id: 'sgh', t: 'Singapore hawker succession', st: 'brief', o: 'michelle', dur: 'target 3:00', ch: 'LinkedIn · 1:1', ed: '31 Aug',
    f: [['Topic', 'Singapore hawker succession'], ['Angle', 'Compare with HK dai pai dong'], ['Channel', 'LinkedIn · 1:1 · 3 min'], ['Mandatory points', 'Cite the NEA succession scheme.']] },
  { id: 'dmo', t: 'Do more · brand spot', st: 'locked', v: 2, o: 'michelle', dur: '0:45', sc: 90, ch: 'Instagram · 9:16', ed: '31 Aug',
    b: [['Runner at dawn, Lion Rock.', '做多一步。', 'Do one more.'], ['Product close-up.', '由今朝開始。', 'Starting this morning.']] },
  { id: 'org', t: 'Orange typography cut', st: 'locked', v: 2, o: 'leung', dur: '0:15', sc: 86, ch: 'X · 1:1', ed: '30 Aug',
    b: [['Kinetic type, orange on black.', '字，都識郁。', 'Words move too.']] },
];
const D = Object.fromEntries(DOCS.map(d => [d.id, d]));

const miniPage = d => {
  const stamp = d.st === 'locked'
    ? `<div class="stamp" style="background: #e4faeb; color: #278f5e;">${LOCK.replace('width: 10px; height: 10px;', 'width: 8px; height: 8px;')}v${d.v}</div>`
    : d.st === 'await' ? '<div class="stamp" style="background: #fff7d3; color: #db7706;">REVIEW</div>'
    : d.st === 'changes' ? '<div class="stamp" style="background: #ffe7e7; color: #e03636;">CHANGES</div>'
    : d.st === 'brief' ? '<div class="stamp" style="background: #f3f3f3; color: #7c7c7c;">BRIEF</div>' : '';
  const inner = d.f
    ? `<div style="font-size: 11px; font-weight: 600; color: #999999; letter-spacing: .06em;">BRIEF</div><h4 style="margin-top: 6px;">${d.t}</h4><div class="pm">${d.ch} · owner ${P[d.o][1]}</div>${d.f.map(([k, v]) => `<div class="pf"><i>${k.toUpperCase()}</i><p>${v}</p></div>`).join('')}`
    : `<h4>${d.t}</h4><div class="pm">${d.ch} · ${d.dur} · v${d.v}</div>${d.b.map(([vi, a, b], i) => `<div class="pb"><i>${String(i + 1).padStart(2, '0')}</i><span>${vi}</span><div><p>${a}</p><span>${b}</span></div></div>`).join('')}`;
  return `<div class="pg"><div class="pgi">${inner}</div>${stamp}</div>`;
};

/* ---------- shell pieces ---------- */
const RAIL = [
  ['chat', '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-2.8-.4L4 21l1.4-4.1A8.2 8.2 0 0 1 3.6 11.5 8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>'],
  ['files', '<path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z"/>'],
  ['res', '<rect x="3.4" y="12.6" width="4.2" height="7.4" rx="1.5"/><rect x="9.9" y="8.4" width="4.2" height="11.6" rx="1.5"/><rect x="16.4" y="4" width="4.2" height="16" rx="1.5"/>'],
  ['script', '<path d="M6.4 3.4h7.4L18.6 8v12.6H6.4z"/><path d="M9.4 12.3h6M9.4 15.6h6" stroke="#f8f8f8" stroke-width="1.5" fill="none"/>'],
  ['video', '<rect x="3.4" y="5.4" width="12.4" height="13.2" rx="2.1"/><path d="m16.6 13 4.6 2.8V8.2L16.6 11z"/>'],
  ['pub', '<path d="M21.86 4.14a1.1 1.1 0 0 0-1.14-.18L2.9 11.13c-.86.34-.83 1.58.05 1.87l4.46 1.5 1.68 5.06c.24.72 1.15.93 1.68.38l2.4-2.5 4.4 3.23c.6.44 1.46.12 1.63-.6z"/>'],
  ['acc', '<rect x="5.4" y="3.4" width="13.2" height="17.2" rx="2"/><path d="M8.4 8h7.2M8.4 12h7.2M8.4 16h4" stroke="#f8f8f8" stroke-width="1.5" fill="none"/>'],
  ['fin', '<circle cx="12" cy="12" r="8.6"/><path d="M14.8 9.4c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.9-2.8 2.1 0 2.9 5.7 1.4 5.7 4.3 0 1.2-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-2.9-1.6M12 6.4v1.4M12 16.3v1.4" stroke="#f8f8f8" stroke-width="1.5" fill="none"/>'],
  ['legal', '<path d="M12 3.2 4.4 6.2v5.6c0 4.4 3.1 8.3 7.6 9.3 4.5-1 7.6-4.9 7.6-9.3V6.2z"/>'],
  ['hr', '<circle cx="12" cy="7.8" r="3.7"/><path d="M4.7 20.2a7.3 7.3 0 0 1 14.6 0z"/>'],
  ['admin', '<path d="M4 7.4h16M4 12h16M4 16.6h16" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="9" cy="7.4" r="2.2"/><circle cx="15" cy="16.6" r="2.2"/>'],
];
const rail = me => `
  <div style="width: 52px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 3px;">
    <div style="width: 28px; height: 28px; border-radius: 8px; background: #171717; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 600; margin-bottom: 10px;">AF</div>
${RAIL.map(([k, icon]) => `    <div class="r${k === 'script' ? ' on' : ''}${k === 'hr' ? ' no' : ''}"><svg viewBox="0 0 24 24">${icon}</svg></div>\n` + (k === 'pub' ? '    <div style="width: 22px; height: 1px; background: #e2e2e2; margin: 6px 0;"></div>\n' : '')).join('')}    <div style="flex-grow: 1;"></div>
    ${av(me, 26)}
  </div>`;

const FOLDER_SVG = `<svg class="fi" viewBox="0 0 30 24"><path d="M1.5 4.2A2.2 2.2 0 0 1 3.7 2h7.1a2.2 2.2 0 0 1 1.7.8l1.4 1.7h12.4a2.2 2.2 0 0 1 2.2 2.2v13.1a2.2 2.2 0 0 1-2.2 2.2H3.7a2.2 2.2 0 0 1-2.2-2.2z" fill="#8fc3f1"/><path d="M1.5 8.4a2.2 2.2 0 0 1 2.2-2.2h22.6a2.2 2.2 0 0 1 2.2 2.2v11.4a2.2 2.2 0 0 1-2.2 2.2H3.7a2.2 2.2 0 0 1-2.2-2.2z" fill="#b9dbf8"/></svg>`;

const librarySidebar = `
  <div style="width: 212px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; padding: 10px 8px;">
    <div style="display: flex; align-items: center; padding: 4px 9px 12px;"><span style="font-size: 14px; font-weight: 500;">Script</span>
      <div style="margin-left: auto; width: 24px; height: 24px; border-radius: 7px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #171717; fill: none; stroke-width: 2; stroke-linecap: round;"><path d="M12 6v12M6 12h12"/></svg></div>
    </div>
    <div class="lbl" style="margin-bottom: 5px;">Library</div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
      <div class="n"><span>All scripts</span><b>24</b></div>
      <div class="n"><span>Assigned to me</span><b>5</b></div>
      <div class="n"><span>Waiting on approval</span><i>2</i></div>
      <div class="n"><span>Shared with me</span><b>3</b></div>
    </div>
    <div class="lbl" style="margin: 16px 0 5px;">Folders</div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
      <div class="n on"><svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: #8fc3f1;"><path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z"/></svg><span>2026-Q3-campaign</span><b>11</b></div>
      <div class="n"><svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: #c7c7c7;"><path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z"/></svg><span>Brand spots</span><b>6</b></div>
      <div class="n"><svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: #c7c7c7;"><path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z"/></svg><span>History of Greece</span><b>5</b></div>
      <div class="n"><svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: #c7c7c7;"><path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z"/></svg><span>2025 archive</span><b>2</b></div>
    </div>
    <div style="margin-top: auto; padding: 11px 9px 4px; border-top: 1px solid #ededed;">
      <div class="lbl" style="padding: 0; margin-bottom: 7px;">House style</div>
      <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #383838;"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #7c7c7c; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><path d="M6.5 3.5h7.2L18.5 8v12.5h-12z"/><path d="M13.5 3.5V8h5"/></svg>Style guide v7</div>
      <div class="mut" style="line-height: 1.5; margin-top: 5px;">Prompt template plus 41 approved past scripts. Updated by admin, 1 Sep.</div>
    </div>
  </div>`;

/* script switcher shown inside a script */
const GROUPS = [['Drafting', ['ssp', 'vcl', 'cct']], ['Awaiting approval', ['tpe', 'gdy']], ['Briefs', ['hbf', 'sgh']], ['Locked', ['grc', 'prs', 'dmo', 'org']]];
const switcher = cur => collapsible(`
  <div style="width: 240px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; padding: 8px 8px 10px;">
    <div style="display: flex; align-items: center; gap: 6px; padding: 0 0 0 9px; font-size: 12px; color: #7c7c7c;"><svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #7c7c7c; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><path d="m14.5 6-6 6 6 6"/></svg>All scripts<div style="margin-left: auto;">${toggleBtn('Hide the script list')}</div></div>
    <div style="display: flex; align-items: center; gap: 7px; padding: 8px 9px 10px;"><svg viewBox="0 0 24 24" style="width: 15px; height: 15px; fill: #8fc3f1;"><path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z"/></svg><span style="font-size: 14px; font-weight: 500;">2026-Q3-campaign</span><span class="mut" style="margin-left: auto;">11</span></div>
    <div style="height: 30px; border-radius: 8px; background: #fff; border: 1px solid #ededed; display: flex; align-items: center; gap: 7px; padding: 0 9px; margin: 0 1px;">
      <svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #999999; fill: none; stroke-width: 1.9; stroke-linecap: round;"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg><span style="font-size: 12px; color: #999999; flex-grow: 1;">Jump to a script</span><span class="kbd">⌘K</span>
    </div>
${GROUPS.map(([g, ids]) => `    <div class="sg"><svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>${g}<span style="margin-left: auto; font-weight: 420;">${ids.length}</span></div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
${ids.map(id => { const d = D[id]; return `      <div class="sn${id === cur ? ' on' : ''}"><span class="dot" style="background: ${ST[d.st][2]};"></span><span>${d.t}</span>${d.flag ? '<span class="dot" style="width: 6px; height: 6px; background: #db7706; flex-grow: 0;" title="Sensitive"></span>' : ''}<img src="${P[d.o][0]}"></div>`; }).join('\n')}
    </div>`).join('\n')}
    <div style="margin-top: auto; padding: 10px 9px 2px; border-top: 1px solid #ededed; display: flex; align-items: center; gap: 8px;">
      <svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #7c7c7c; fill: none; stroke-width: 1.8; stroke-linecap: round;"><path d="M12 6v12M6 12h12"/></svg><span style="font-size: 12.5px; color: #525252; white-space: nowrap;">New script</span><span class="kbd" style="margin-left: auto;">N</span>
    </div>
  </div>`, `
  <div class="mini">
    ${toggleBtn('Show the script list')}
    <div style="width: 22px; height: 1px; background: #e2e2e2; margin: 6px 0 4px;"></div>
${GROUPS.flatMap(([, ids]) => ids).map(id => { const d = D[id]; return `    <div class="mi${id === cur ? ' on' : ''}" title="${d.t}">${ICON[d.st](1.5)}</div>`; }).join('\n')}
    <div style="flex-grow: 1;"></div>
    <div class="ptog" title="New script"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg></div>
  </div>`);

/* document header + tabs */
const TABS = [['brief', 'Brief'], ['draft', 'Draft'], ['versions', 'Versions', '4'], ['approval', 'Approval']];
const docHeader = ({ d, tab, verLabel, people, actions, right }) => `
    <div class="bar" style="height: 52px; gap: 10px;">
      <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; flex-shrink: 0; stroke: #7c7c7c; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><path d="M6.5 3.5h7.2L18.5 8v12.5h-12z"/><path d="M13.5 3.5V8h5"/><path d="M9.2 12.4h6.1M9.2 15.6h6.1"/></svg>
      <span class="h1" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;">${d.t}</span>
      ${verLabel}
      <span class="mut" style="white-space: nowrap;">${d.ch}</span>
      <div style="flex-grow: 1;"></div>
      <div style="display: flex; align-items: center;">${people.map((k, i) => `<div style="position: relative; margin-left: ${i ? -6 : 0}px;">${av(k, 24, ' box-shadow: 0 0 0 2px #fff;')}${i === 0 ? '<span style="position: absolute; right: -1px; bottom: -1px; width: 8px; height: 8px; border-radius: 4px; background: #278f5e; box-shadow: 0 0 0 2px #fff;"></span>' : ''}</div>`).join('')}</div>
      ${actions}
    </div>
    <div class="tabs">
${TABS.map(([k, l, n]) => `      <div class="tb${k === tab ? ' on' : ''}">${l}${n ? `<b>${n}</b>` : ''}</div>`).join('\n')}
      <div style="flex-grow: 1;"></div>
      <div style="display: flex; align-items: center; gap: 10px;">${right}</div>
    </div>`;

const rightPanel = (tabs, on, body) => `
      <div style="width: 320px; flex-shrink: 0; border-left: 1px solid #ededed; background: #fcfcfc; display: flex; flex-direction: column;">
        <div style="height: 44px; flex-shrink: 0; display: flex; align-items: center; gap: 2px; padding: 0 10px; border-bottom: 1px solid #ededed;">
${tabs.map(t => `          <div class="rtab${t === on ? ' on' : ''}">${t === 'Agent' ? '<svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: {{accent}}; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 4.2 19 8v8l-7 3.8L5 16V8z"/><path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8"/></svg>' : ''}${t}</div>`).join('\n')}
          <div style="flex-grow: 1;"></div>
          <svg viewBox="0 0 24 24" style="width: 15px; height: 15px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="m10 6 6 6-6 6"/></svg>
        </div>
${body}
      </div>`;

const agentBlock = ({ scope, q, tool, a, act, place, guard, cost, extra = '' }) => `
        <div style="flex-shrink: 0; padding: 11px 13px; border-bottom: 1px solid #f3f3f3;">
          <div style="display: inline-flex; align-items: center; gap: 7px; height: 25px; padding: 0 10px; border-radius: 7px; background: #fff; border: 1px solid #ededed; max-width: 100%;">
            <span style="width: 6px; height: 6px; border-radius: 3px; background: {{accent}}; flex-shrink: 0;"></span><span style="font-size: 11.5px; color: #525252; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${scope}</span>
          </div>
        </div>${extra}
        <div style="flex-grow: 1; min-height: 0; padding: 14px 13px 0; overflow: hidden;">
          <div style="display: flex; justify-content: flex-end; margin-bottom: 10px;"><div style="max-width: 244px; background: #f3f3f3; border-radius: 10px; padding: 8px 11px; font-size: 12px; line-height: 1.5; color: #383838;">${q}</div></div>
          <div style="display: inline-flex; align-items: center; gap: 7px; height: 23px; padding: 0 9px; border: 1px solid #ededed; border-radius: 7px; background: #fff; margin-bottom: 9px;">
            <svg viewBox="0 0 24 24" style="width: 11px; height: 11px; stroke: #278f5e; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round;"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg><span style="font-size: 11px; color: #525252;">${tool}</span>
          </div>
          <div style="font-size: 12px; line-height: 1.6; color: #383838; text-wrap: pretty;">${a}</div>
          <div style="display: flex; gap: 6px; margin-top: 11px;"><div class="btn" style="height: 27px; font-size: 12px; background: {{accent}}; color: #fff; font-weight: 500;">${act}</div><div class="btn s" style="height: 27px; font-size: 12px;">Not now</div></div>
        </div>
        <div style="flex-shrink: 0; padding: 11px 13px 9px;">
          <div style="border: 1px solid #e2e2e2; border-radius: 10px; background: #fff; padding: 9px 10px 7px; box-shadow: 0 1px 2px rgba(0,0,0,.06);">
            <div style="font-size: 12px; color: #999999;">${place}</div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 11px;"><span style="font-size: 10.5px; color: #999999;">gemini-2.5-pro</span><div style="width: 25px; height: 25px; border-radius: 7px; background: {{accent}}; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #fff; fill: none; stroke-width: 2.3; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 19V5.5M6 11.5 12 5.5l6 6"/></svg></div></div>
          </div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 9px 13px 11px; display: flex; align-items: center; gap: 7px;">
          <svg viewBox="0 0 24 24" style="width: 11px; height: 11px; flex-shrink: 0; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="M6.8 10.5h10.4v8H6.8z"/><path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5"/></svg>
          <span style="font-size: 10.5px; color: #999999;">${guard}</span><span style="margin-left: auto; font-size: 10.5px; color: #999999;">${cost}</span>
        </div>`;

const TICK = '<svg viewBox="0 0 16 16"><path d="M3.6 8.3 6.5 11.2 12.4 5.1"/></svg>';
const okDot = `<div class="ck" style="background: #278f5e;">${TICK}</div>`;
const warnDot = '<div class="ck" style="background: #db7706;"><svg viewBox="0 0 16 16"><path d="M8 4.2v4.6M8 11.4v.2"/></svg></div>';

/* page wrapper, shared shell (collapsible sidebar lives there) */
const page = o => shellPage({ module: 'Script', gen: 'script-screens.mjs', active: 'script', extraCss: EXTRA_CSS, ...o });

/* =================================================================== */
/* LIBRARY                                                             */
/* =================================================================== */
/* Finder-style icon: small pixel file, name under it, one quiet meta line */
const tile = (d, sel) => `
          <div class="ic${sel ? ' sel' : ''}">
            <div class="icn">${ICON[d.st](3)}</div>
            <div class="icl"><span>${d.t}</span></div>
            <div class="icm"><span class="dot" style="background: ${ST[d.st][2]};"></span>${d.v ? 'v' + d.v : 'Brief'} · ${d.ed}</div>
          </div>`;
const folderTile = (name, meta) => `
          <div class="ic"><div class="icn">${ICON.folder(3)}</div><div class="icl"><span>${name}</span></div><div class="icm">${meta}</div></div>`;

const scoreCell = sc => sc == null ? '<span style="color: #c7c7c7;">–</span>'
  : `<div style="display: flex; align-items: center; gap: 8px; width: 100%;"><div style="flex-grow: 1; height: 4px; border-radius: 2px; background: #ededed;"><div style="width: ${sc}%; height: 4px; border-radius: 2px; background: ${sc < 70 ? '#db7706' : '{{accent}}'};"></div></div><span style="font-variant-numeric: tabular-nums; width: 18px; text-align: right;">${sc}</span></div>`;

const LG = 'grid-template-columns: minmax(0, 1fr) 150px 44px 64px 100px 132px 76px';
const listRow = (d, sel) => `
          <div class="tr" style="${LG}; height: 54px;${sel ? ' background: #f8f8f8;' : ''}">
            <div style="gap: 11px;"><div style="width: 26px; display: flex; justify-content: center; flex-shrink: 0;">${ICON[d.st](1.5)}</div><div style="min-width: 0;"><span class="el" style="color: #171717; font-weight: 500;">${d.t}</span><span class="el cap" style="margin-top: 2px;">${d.ch}${d.flag ? ' · <span style="color: #db7706;">sensitive</span>' : ''}</span></div></div>
            <div>${badge(d.st)}</div>
            <div class="num">${d.v ? 'v' + d.v : '–'}</div>
            <div class="num" style="color: ${d.v ? '#383838' : '#999999'};">${d.v ? d.dur : '–'}</div>
            <div>${scoreCell(d.sc)}</div>
            <div style="gap: 8px;">${av(d.o, 18)}<span class="el">${P[d.o][1]}</span></div>
            <div style="color: #7c7c7c;">${d.ed}</div>
          </div>`;

const libraryMain = `
    <div class="bar">
      <span style="font-size: 13px; color: #999999;">Scripts</span>
      <svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #c7c7c7; fill: none; stroke-width: 2; stroke-linecap: round;"><path d="m9.5 5.5 6 6.5-6 6.5"/></svg>
      <span class="h1">2026-Q3-campaign</span>
      <div style="flex-grow: 1;"></div>
      <div style="width: 200px; height: 28px; border: 1px solid #ededed; border-radius: 8px; background: #f8f8f8; display: flex; align-items: center; gap: 7px; padding: 0 9px;">
        <svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round;"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg><span style="font-size: 12px; color: #999999;">Search scripts</span>
      </div>
      <div style="display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3f3f3;">
        <div class="seg" onClick="{{ pickGrid }}" style="background: {{gridBg}}; color: {{gridFg}}; box-shadow: {{gridSh}};" title="Pages"><svg viewBox="0 0 24 24"><rect x="4.2" y="4.2" width="6.6" height="6.6" rx="1.6"/><rect x="13.2" y="4.2" width="6.6" height="6.6" rx="1.6"/><rect x="4.2" y="13.2" width="6.6" height="6.6" rx="1.6"/><rect x="13.2" y="13.2" width="6.6" height="6.6" rx="1.6"/></svg></div>
        <div class="seg" onClick="{{ pickList }}" style="background: {{listBg}}; color: {{listFg}}; box-shadow: {{listSh}};" title="List"><svg viewBox="0 0 24 24"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01"/></svg></div>
      </div>
      <div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round;"><path d="M12 6v12M6 12h12"/></svg>New script</div>
    </div>
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; padding: 16px 22px 0; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 16px;">
          <div class="fc on">All <b>11</b></div>
          <div class="fc"><span class="dot" style="background: #c7c7c7;"></span>Briefs <b>2</b></div>
          <div class="fc"><span class="dot" style="background: #007be0;"></span>Drafting <b>3</b></div>
          <div class="fc"><span class="dot" style="background: #db7706;"></span>Awaiting approval <b>2</b></div>
          <div class="fc"><span class="dot" style="background: #278f5e;"></span>Locked <b>4</b></div>
          <div style="flex-grow: 1;"></div>
          <span class="cap">Sort</span><div class="chip" style="height: 26px; font-size: 12px;">Last edited <svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg></div>
        </div>

        <sc-if value="{{isGrid}}" hint-placeholder-val="{{ true }}">
        <div class="lbl" style="padding: 0 4px;">Folders</div>
        <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px 6px; margin: 4px 0 20px;">
${folderTile('Shot notes', '7 docs')}
${folderTile('Interview transcripts', '4 docs')}
${folderTile('Approved references', '12 docs')}
        </div>
        <div class="lbl" style="padding: 0 4px;">Scripts · 11</div>
        <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px 6px; margin-top: 4px;">
${DOCS.map((d, i) => tile(d, i === 0)).join('')}
        </div>
        <div class="cap" style="margin-top: 22px; padding: 0 4px;">11 scripts · filtered to scripts you can read</div>
        </sc-if>

        <sc-if value="{{isList}}" hint-placeholder-val="{{ true }}">
        <div class="t">
          <div class="hd" style="${LG};"><div>Script</div><div>Status</div><div class="num">Ver.</div><div class="num">Length</div><div>House style</div><div>Owner</div><div>Edited</div></div>
${DOCS.map((d, i) => listRow(d, i === 0)).join('')}
        </div>
        <div class="cap" style="margin-top: 14px;">11 scripts · filtered to scripts you can read · house style scored against guide v7</div>
        </sc-if>
      </div>
${rightPanel(['Agent', 'Details'], 'Agent', agentBlock({
  scope: '2026-Q3-campaign · 11 scripts',
  q: 'What is holding this folder up?',
  tool: 'Read 11 scripts, 2 approval requests · 0.9 s',
  a: `<p>Two scripts have waited on ${av('michelle', 16, ' display: inline-block; vertical-align: -3px;')} <b style="font-weight: 500;">Michelle Yip</b> for more than a day:</p>
            <div style="margin: 9px 0; display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid #ededed; border-radius: 8px; background: #fff;"><span class="dot" style="background: #db7706;"></span><span style="flex-grow: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Taipei night-market crossover</span><span class="cap">26 h</span></div>
              <div style="display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid #ededed; border-radius: 8px; background: #fff;"><span class="dot" style="background: #db7706;"></span><span style="flex-grow: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Good day · collage teaser</span><span class="cap">31 h</span></div>
            </div>
            <p><b style="font-weight: 500;">Cantonese voice cloning</b> is the only draft under the house-style bar (64). Most of its flags are sound directions written into the voice-over column.</p>`,
  act: 'Remind Michelle',
  place: 'Ask about these scripts…',
  guard: 'Uses only scripts you can read',
  cost: 'HK$0.06',
}))}
    </div>`;

const libraryLogic = `
  renderVals() {
    var view = this.state.view || this.props.view || 'grid';
    var seg = function (on) { return { bg: on ? '#ffffff' : 'transparent', fg: on ? '#171717' : '#7c7c7c', sh: on ? '0px 1px 2px rgba(0, 0, 0, 0.1)' : 'none' }; };
    var g = seg(view === 'grid'), l = seg(view === 'list'), self = this;
    return this.side({
      accent: this.accent(), isGrid: view === 'grid', isList: view === 'list',
      pickGrid: function () { self.setState({ view: 'grid' }); }, pickList: function () { self.setState({ view: 'list' }); },
      gridBg: g.bg, gridFg: g.fg, gridSh: g.sh, listBg: l.bg, listFg: l.fg, listSh: l.sh
    });
  }`;

/* =================================================================== */
/* ONE SCRIPT, shared data                                            */
/* =================================================================== */
const ssp = D.ssp;
const verDraft = '<span class="bd blue">v4 · Drafting</span>';

/* ---------------- DRAFT (the "split editor") ---------------- */
const BEATS = [
  ['01', '0:00', 'Stall shutters rolling up at 6:40 am. No narration for the first four seconds.', '（現場聲）', 'Natural sound only.'],
  ['02', '0:12', 'Wide, handheld, along Pei Ho Street, <span class="wv">{{b2}}</span>.', '深水埗曾經有過百檔大牌檔，今日只剩四檔。', 'Sham Shui Po once had over a hundred dai pai dong. Four are left.'],
  ['03', '0:31', 'Mrs Ho at her counter, mid-shot. <span class="wv">Keep the ambient market noise under her.</span>', '何太：「張牌係我阿爸留低嘅，我唔會交返出去。」', 'Mrs Ho: “My father left me this licence. I’m not giving it back.”'],
  ['04', '1:04', 'Cutaway: the renewal letter on the counter. Tight, shallow depth of field.', '發牌委員會八月決定，<span class="ins">現有牌照可以轉讓俾直系親屬</span>。', 'In August the licensing board ruled that <span class="ins">existing licences may pass to immediate family</span>.'],
  ['05', '1:22', 'Archive: the same street in 1998. Credit HK Film Archive on screen.', '廿幾年前，呢條街朝早六點已經坐滿人。', 'Twenty-odd years ago this street was full by six in the morning.'],
  ['06', '1:48', 'Four stall signs, one after another: 坤記, 華姐, 德昌, 新興.', '佢哋唔係懷舊，係仲喺度做緊生意。', '<span class="sl">They aren’t nostalgia. They’re still open for business.</span>'],
];
const beatRow = ([n, tc, vi, zh, en]) => `
            <div class="bt"${n === '06' ? ' style="position: relative;"' : n === '02' ? ' style="position: relative;"' : ''}>
              <div class="bn">${n}<b>${tc}</b></div>
              <div class="vi">${vi}</div>
              <div><div class="zh">${zh}</div><div class="en">${en}</div></div>${n === '02' ? `
              <sc-if value="{{pending}}" hint-placeholder-val="{{ true }}">
              <div class="pop" style="left: 60px; top: 58px; width: 318px; padding: 11px 12px;">
                <div style="display: flex; align-items: center; gap: 6px;"><span class="dot" style="background: #db7706;"></span><span style="font-size: 11px; font-weight: 500; color: #7c7c7c;">House style · concrete time of day</span><span class="cap" style="margin-left: auto;">1 of 4</span></div>
                <div style="font-size: 12.5px; line-height: 1.55; margin-top: 7px;"><span class="del">morning light before the crowds arrive</span> <span class="ins">at 6:40 am, before the first customers</span></div>
                <div class="cap" style="margin-top: 5px; line-height: 1.45;">Guide v7 §3.2: name the hour; 9 of 41 approved scripts do.</div>
                <div style="display: flex; gap: 6px; margin-top: 10px;"><div class="btn" onClick="{{ accept }}" style="height: 26px; font-size: 12px; background: #171717; color: #fff; font-weight: 500; cursor: pointer;">Accept <span style="opacity: .55; font-weight: 420;">⏎</span></div><div class="btn s" onClick="{{ reject }}" style="height: 26px; font-size: 12px; cursor: pointer;">Reject</div><div style="margin-left: auto; display: flex; gap: 4px; align-items: center;"><span class="kbd">↑</span><span class="kbd">↓</span></div></div>
              </div>
              </sc-if>` : ''}${n === '06' ? `
              <div class="pop" style="right: -6px; top: calc(100% - 6px); width: 386px; padding: 5px;">
                <div style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 8px;">
                  <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; flex-shrink: 0; stroke: {{accent}}; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="m12 3.5 1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16v4M16.5 18h4"/></svg>
                  <span style="font-size: 12.5px; color: #171717; flex-grow: 1;">end on the stall owner, not the narrator<span style="display: inline-block; width: 1.5px; height: 14px; background: {{accent}}; vertical-align: -2px; margin-left: 1px;"></span></span><span class="kbd">⏎</span>
                </div>
                <div style="display: flex; gap: 5px; padding: 3px 6px 5px; border-top: 1px solid #f3f3f3;"><span class="qc">Shorter</span><span class="qc">Warmer</span><span class="qc">More formal</span><span class="qc">轉做書面語</span></div>
              </div>` : ''}
            </div>`;

const draftMain = `${docHeader({
  d: ssp, tab: 'draft', verLabel: verDraft, people: ['amy', 'leung'],
  actions: '<div class="btn s">Share</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Send for approval</div>',
  right: '<span class="cap">Saved · 2 min ago</span><span class="bd amb" style="font-variant-numeric: tabular-nums;">3:48 / 3:45 target</span>',
})}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column;">
        <div style="height: 42px; flex-shrink: 0; display: flex; align-items: center; gap: 2px; padding: 0 20px; border-bottom: 1px solid #f3f3f3;">
          <div class="chip" style="height: 28px; font-size: 12px; border: none; background: #f3f3f3;">Beat <svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg></div>
          <div style="width: 1px; height: 18px; background: #ededed; margin: 0 6px;"></div>
          <div class="tool"><svg viewBox="0 0 24 24"><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/></svg></div>
          <div class="tool"><svg viewBox="0 0 24 24"><path d="M14 5h-4M14 19h-4M13.5 5l-3 14"/></svg></div>
          <div class="tool"><svg viewBox="0 0 24 24"><path d="M5 7.5h14M5 12h14M5 16.5h9"/></svg></div>
          <div style="width: 1px; height: 18px; background: #ededed; margin: 0 6px;"></div>
          <div class="tool"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg></div>
          <div class="tool"><svg viewBox="0 0 24 24"><path d="M4 7a2 2 0 0 1 2-2h3.6l1.8 2.2H18a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg></div>
          <div style="flex-grow: 1;"></div>
          <div style="display: flex; align-items: center; gap: 7px; height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid #ededed;"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: {{accent}}; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="m12 3.5 1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/></svg><span style="font-size: 12px; color: #525252;">Rewrite selection</span><span class="kbd">⌘J</span></div>
          <span class="cap" style="margin-left: 10px;">繁中 + EN subtitles</span>
        </div>
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 20px 30px 0 30px;">
          <div style="display: flex; align-items: baseline; gap: 10px;"><div style="font-size: 20px; font-weight: 600; letter-spacing: -.01em;">${ssp.t}</div></div>
          <div style="display: flex; align-items: center; gap: 12px; margin-top: 8px; padding-bottom: 12px; font-size: 12px; color: #7c7c7c;">
            <span style="display: flex; align-items: center; gap: 6px;">${av('amy', 16)}Amy Wong</span><span style="color: #e2e2e2;">|</span><span>Operator interview · warm, documentary</span><span style="color: #e2e2e2;">|</span><span>6 beats · 412 words · 3:48 spoken</span>
          </div>
          <div class="bt" style="padding: 8px 0; border-bottom: 1px solid #ededed; border-top: 1px solid #ededed;">
            <div class="bn" style="color: #7c7c7c;">Beat</div><div class="bn" style="color: #7c7c7c;">Visual</div><div class="bn" style="color: #7c7c7c;">Voice-over · 粵語 / English subtitle</div>
          </div>
${BEATS.map(beatRow).join('')}
        </div>
      </div>
${rightPanel(['House style', 'Agent', 'Comments'], 'House style', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 14px 14px 0;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <svg viewBox="0 0 64 64" style="width: 62px; height: 62px; flex-shrink: 0; transform: rotate(-90deg);"><circle cx="32" cy="32" r="26" fill="none" stroke="#ededed" stroke-width="6"/><circle cx="32" cy="32" r="26" fill="none" stroke="{{accent}}" stroke-width="6" stroke-linecap="round" stroke-dasharray="{{dash}} 163.4"/></svg>
            <div><div style="display: flex; align-items: baseline; gap: 5px;"><span style="font-size: 26px; font-weight: 500; font-variant-numeric: tabular-nums;">{{score}}</span><span class="mut">/ 100</span></div><div class="cap" style="margin-top: 2px;">Conformance to guide v7 · was 76 at v3</div></div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px;">
            <div style="border: 1px solid #ededed; border-radius: 9px; padding: 9px 10px; background: #fff;"><div class="cap">Spoken duration</div><div style="font-size: 14px; font-weight: 500; margin-top: 4px; font-variant-numeric: tabular-nums;">3:48 <span style="font-size: 11px; font-weight: 420; color: #db7706;">+3 s</span></div><div class="mb"><div style="width: 100%; background: #db7706;"></div><span style="position: absolute; left: 98.7%; top: -3px; width: 1.5px; height: 10px; background: #171717;"></span></div></div>
            <div style="border: 1px solid #ededed; border-radius: 9px; padding: 9px 10px; background: #fff;"><div class="cap">Reading level</div><div style="font-size: 14px; font-weight: 500; margin-top: 4px;">Grade 8 <span style="font-size: 11px; font-weight: 420; color: #278f5e;">on target</span></div><div class="mb"><div style="width: 66%; background: #278f5e;"></div></div></div>
            <div style="border: 1px solid #ededed; border-radius: 9px; padding: 9px 10px; background: #fff;"><div class="cap">Flagged terms</div><div style="font-size: 14px; font-weight: 500; margin-top: 4px;">{{flags}} <span style="font-size: 11px; font-weight: 420; color: #999999;">open</span></div></div>
            <div style="border: 1px solid #ededed; border-radius: 9px; padding: 9px 10px; background: #fff;"><div class="cap">Mandatory points</div><div style="font-size: 14px; font-weight: 500; margin-top: 4px;">3 / 3 <span style="font-size: 11px; font-weight: 420; color: #278f5e;">covered</span></div></div>
          </div>
          <div style="display: flex; align-items: center; margin: 16px 0 8px;"><span class="lbl" style="padding: 0;">Suggestions</span><span class="cap" style="margin-left: auto;">Accept all · Reject all</span></div>
          <div style="display: flex; flex-direction: column; gap: 7px;">
            <sc-if value="{{pending}}" hint-placeholder-val="{{ true }}">
            <div class="sug" style="box-shadow: 0 0 0 2px #eff6ff; border-color: #bfdbfe;"><div class="k"><span class="dot" style="background: #db7706;"></span>Beat 02 · time of day</div><div class="q">“morning light” → “at 6:40 am”</div></div>
            </sc-if>
            <sc-if value="{{accepted}}" hint-placeholder-val="{{ false }}">
            <div class="sug" style="background: #f8f8f8;"><div class="k"><span class="ck" style="width: 14px; height: 14px; border-radius: 7px; background: #278f5e;"><svg viewBox="0 0 16 16" style="width: 9px; height: 9px;"><path d="M3.6 8.3 6.5 11.2 12.4 5.1"/></svg></span>Beat 02 · accepted just now</div><div class="q" style="color: #7c7c7c;">“at 6:40 am, before the first customers”</div></div>
            </sc-if>
            <div class="sug"><div class="k"><span class="dot" style="background: #db7706;"></span>Beat 03 · sound direction</div><div class="q">“Keep the ambient market noise under her”</div><div class="w">Sound belongs in the shot list. Move it to Video Edit?</div><div style="display: flex; gap: 6px; margin-top: 8px;"><div class="btn s" style="height: 25px; font-size: 11.5px;">Move to shot list</div><div class="btn s" style="height: 25px; font-size: 11.5px;">Keep</div></div></div>
            <div class="sug"><div class="k"><span class="dot" style="background: #007be0;"></span>Beat 05 · length</div><div class="q">Trim 3 s to hit 3:45</div><div class="w">Drop “朝早六點”. The archive shot already says it.</div></div>
            <div class="sug"><div class="k"><span class="dot" style="background: #c7c7c7;"></span>Beat 06 · register</div><div class="q">“做緊生意” is spoken Cantonese</div><div class="w">Fine for VO; subtitles use written form per guide §5.</div></div>
          </div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 10px 14px 12px; display: flex; align-items: center; gap: 7px;">
          <svg viewBox="0 0 24 24" style="width: 12px; height: 12px; flex-shrink: 0; stroke: #999999; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><path d="M6.5 3.5h7.2L18.5 8v12.5h-12z"/><path d="M13.5 3.5V8h5"/></svg>
          <span style="font-size: 10.5px; color: #999999; line-height: 1.4;">Guide v7 + 41 approved scripts · no fine-tuning</span>
        </div>`)}
    </div>`;

const draftLogic = `
  renderVals() {
    var st = this.state.s || 'pending', self = this;
    return this.side({
      accent: this.accent(),
      pending: st === 'pending', accepted: st === 'accepted',
      b2: st === 'accepted' ? 'at 6:40 am, before the first customers' : 'morning light before the crowds arrive',
      score: st === 'accepted' ? 85 : 82, dash: st === 'accepted' ? '138.9' : '134',
      flags: st === 'pending' ? 4 : 3,
      accept: function () { self.setState({ s: 'accepted' }); },
      reject: function () { self.setState({ s: 'rejected' }); }
    });
  }`;

/* ---------------- BRIEF ---------------- */
const briefMain = `${docHeader({
  d: ssp, tab: 'brief', verLabel: verDraft, people: ['amy', 'leung'],
  actions: '<div class="btn s">Share</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="m12 3.5 1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/></svg>Generate v5 from brief</div>',
  right: '<span class="cap">Brief last changed 2 Sep by Amy Wong</span>',
})}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; display: flex; gap: 22px; padding: 20px 22px 0; overflow: hidden;">
        <div style="flex-grow: 1; min-width: 0;">
          <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 14px;">
            <div style="grid-column: 1 / -1;"><div class="fl">Topic</div><div class="inp"><span style="flex-grow: 1;">Sham Shui Po dai pai dong revival</span><span class="bd blue" style="height: 20px;">From backlog · heat 94</span></div></div>
            <div><div class="fl">Angle</div><div class="inp"><span style="flex-grow: 1;">Operator interview</span><svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg></div></div>
            <div><div class="fl">Target channel</div><div class="inp"><span style="flex-grow: 1;">YouTube · 16:9</span><svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg></div></div>
            <div><div class="fl">Target duration</div><div class="inp"><span style="flex-grow: 1; font-variant-numeric: tabular-nums;">3 min 45 s</span><span class="cap">±5%</span></div></div>
            <div><div class="fl">Language</div><div class="inp"><span style="flex-grow: 1;">粵語 VO · 繁中 + English subtitles</span></div></div>
            <div style="grid-column: 1 / -1;"><div class="fl">Tone</div><div style="display: flex; gap: 6px; flex-wrap: wrap;"><span class="fc on">Warm</span><span class="fc on">Documentary</span><span class="fc">Playful</span><span class="fc">Urgent</span><span class="fc">Formal</span><span class="fc" style="border-style: dashed; color: #999999;">+ Tone</span></div></div>
          </div>
          <div style="display: flex; align-items: center; margin: 20px 0 4px;"><span class="fl" style="margin: 0;">Mandatory points</span><span class="cap" style="margin-left: auto;">Checked against every draft</span></div>
          <div class="li"><div class="ck" style="background: #278f5e;">${TICK}</div><div style="flex-grow: 1;"><div class="a">Name the four remaining stalls</div><div class="b">In v4 · beat 06</div></div></div>
          <div class="li"><div class="ck" style="background: #278f5e;">${TICK}</div><div style="flex-grow: 1;"><div class="a">Quote the licensing board decision verbatim</div><div class="b">In v4 · beat 04 · matches the 14 Aug minutes</div></div></div>
          <div class="li"><div class="ck" style="background: #278f5e;">${TICK}</div><div style="flex-grow: 1;"><div class="a">Credit the HK Film Archive for the 1998 footage</div><div class="b">In v4 · beat 05 · on-screen credit</div></div></div>
          <div style="font-size: 12px; color: #999999; padding: 9px 0;">+ Add a point</div>
          <div style="display: flex; align-items: center; margin: 12px 0 4px;"><span class="fl" style="margin: 0;">Things to avoid</span><span class="cap" style="margin-left: auto;">0 hits in v4</span></div>
          <div class="li"><div class="ck" style="background: #f3f3f3;"><svg viewBox="0 0 16 16" style="stroke: #999999;"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></div><div><div class="a">No speculation about the planning dispute</div></div></div>
          <div class="li" style="border: none;"><div class="ck" style="background: #f3f3f3;"><svg viewBox="0 0 16 16" style="stroke: #999999;"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></div><div><div class="a">No named officials</div></div></div>
        </div>
        <div style="width: 262px; flex-shrink: 0;">
          <div class="card" style="padding: 14px;">
            <div style="display: flex; align-items: center; gap: 7px;"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #7c7c7c; fill: #7c7c7c;"><rect x="3.4" y="12.6" width="4.2" height="7.4" rx="1.5"/><rect x="9.9" y="8.4" width="4.2" height="11.6" rx="1.5"/><rect x="16.4" y="4" width="4.2" height="16" rx="1.5"/></svg><span class="lbl" style="padding: 0;">From the topic backlog</span></div>
            <div style="display: flex; align-items: baseline; gap: 8px; margin-top: 10px;"><span style="font-size: 24px; font-weight: 500;">94</span><span class="cap">heat</span><span style="font-size: 12px; color: #278f5e; margin-left: auto;">+38.2% 14 d</span></div>
            <svg viewBox="0 0 230 44" style="width: 100%; height: 44px; margin-top: 6px;"><path d="M0 40 L20 38 L40 39 L60 35 L80 36 L100 30 L120 31 L140 22 L160 24 L180 14 L200 12 L230 4 L230 44 L0 44Z" fill="{{accent}}" opacity=".08"/><path d="M0 40 L20 38 L40 39 L60 35 L80 36 L100 30 L120 31 L140 22 L160 24 L180 14 L200 12 L230 4" fill="none" stroke="{{accent}}" stroke-width="1.6" stroke-linejoin="round"/></svg>
            <div class="cap" style="margin-top: 4px;">29 Aug – 11 Sep · GDELT, YouTube, Google Trends</div>
            <div class="kv" style="margin-top: 8px;"><span>Adopted</span><span>2 Sep · Amy Wong</span></div>
            <div class="kv"><span>Due to Video</span><span>12 Sep</span></div>
            <div class="kv" style="border: none;"><span>Sensitivity</span><span>None flagged</span></div>
          </div>
          <div class="card" style="padding: 14px; margin-top: 12px;">
            <div class="lbl" style="padding: 0; margin-bottom: 8px;">Research carried over</div>
            <div style="font-size: 12px; line-height: 1.55; color: #383838;">Licensing board minutes, 14 Aug</div><div class="cap" style="margin-bottom: 8px;">gov.hk · PDF · cited in beat 04</div>
            <div style="font-size: 12px; line-height: 1.55; color: #383838;">Street, 1998 · archive plate</div><div class="cap" style="margin-bottom: 8px;">HK Film Archive · licensed to 2027</div>
            <div style="font-size: 12px; line-height: 1.55; color: #383838;">Operator interview notes</div><div class="cap">Database · Interview transcripts</div>
          </div>
        </div>
      </div>
${rightPanel(['Agent', 'Comments'], 'Agent', agentBlock({
  scope: 'This brief + backlog research',
  q: 'Is anything from the research missing in this brief?',
  tool: 'Read brief, backlog card, 3 sources · 1.1 s',
  a: `<p>All three mandatory points trace back to a source. One thing isn’t in the brief: the 1998 archive plate is licensed for broadcast only until <b style="font-weight: 500;">March 2027</b>.</p><p style="margin-top: 8px;">If this video should stay up longer, it needs a note for Publish. Add it to “Things to avoid”?</p>`,
  act: 'Add the note',
  place: 'Ask about this brief…',
  guard: 'Uses only sources you can read',
  cost: 'HK$0.03',
}))}
    </div>`;

/* ---------------- VERSIONS ---------------- */
const VERS = [
  ['v4', 'amy', 'Tone pass on beats 2, 4 and 6', '2 Sep 09:40', 'blue', 'Current', 'B'],
  ['v3', 'leung', 'Added the archive credit', '1 Sep 18:20', 'gray', '', 'A'],
  ['v2', 'amy', 'Cut beat 07 (market wide)', '1 Sep 15:12', 'gray', '', ''],
  ['v1', 'chan', 'First draft from the brief', '1 Sep 14:02', 'gray', 'Agent', ''],
];
const versionsMain = `${docHeader({
  d: ssp, tab: 'versions', verLabel: verDraft, people: ['amy', 'leung'],
  actions: '<div class="btn s">Restore v3</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Open v4</div>',
  right: '<span class="cap">Comparing</span><div class="chip" style="height: 26px;"><span class="ab" style="background: #ffe7e7; color: #e03636;">A</span>v3 <svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg></div><div class="chip" style="height: 26px;"><span class="ab" style="background: #e4faeb; color: #278f5e;">B</span>v4 <svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg></div>',
})}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="width: 232px; flex-shrink: 0; border-right: 1px solid #ededed; padding: 14px 10px; overflow: hidden;">
        <div class="lbl" style="margin-bottom: 8px;">History · 4 versions</div>
${VERS.map(([v, o, note, when, tone, tag, ab]) => `        <div class="vr${ab === 'B' ? ' on' : ''}">
          ${ab ? `<span class="ab" style="background: ${ab === 'A' ? '#ffe7e7; color: #e03636' : '#e4faeb; color: #278f5e'};">${ab}</span>` : '<span class="ab" style="border: 1px solid #e2e2e2;"></span>'}
          <div style="min-width: 0; flex-grow: 1;">
            <div style="display: flex; align-items: center; gap: 6px;"><span style="font-size: 12.5px; font-weight: 500;">${v}</span>${tag ? `<span class="bd ${tone}" style="height: 18px; font-size: 10.5px;">${tag}</span>` : ''}</div>
            <div style="font-size: 12px; color: #383838; margin-top: 3px; line-height: 1.4;">${note}</div>
            <div style="display: flex; align-items: center; gap: 6px; margin-top: 5px;">${av(o, 14)}<span class="cap">${o === 'chan' ? 'Agent · for Chan K.' : P[o][1]} · ${when}</span></div>
          </div>
        </div>`).join('\n')}
        <div style="margin-top: 12px; padding: 10px 12px; border-radius: 9px; background: #f8f8f8;"><div class="cap" style="line-height: 1.5;">Every save is a version. Locking makes one of them the authorised script.</div></div>
      </div>
      <div style="flex-grow: 1; min-width: 0; padding: 16px 20px 0; overflow: hidden;">
        <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px;">
          <div class="stat" style="padding: 9px 11px;"><i>Words</i><b style="font-size: 16px;"><span style="color: #278f5e;">+38</span> <span style="color: #e03636;">−14</span></b></div>
          <div class="stat" style="padding: 9px 11px;"><i>Beats changed</i><b style="font-size: 16px;">3 of 6</b></div>
          <div class="stat" style="padding: 9px 11px;"><i>Spoken</i><b style="font-size: 16px;">+6 s</b></div>
          <div class="stat" style="padding: 9px 11px;"><i>House style</i><b style="font-size: 16px;">76 → 82</b></div>
          <div class="stat" style="padding: 9px 11px;"><i>Flags</i><b style="font-size: 16px;">7 → 4</b></div>
        </div>
        <div class="df">
          <div class="dh"><b style="font-weight: 500; color: #383838;">Beat 02</b> · 0:12 · visual<span style="margin-left: auto;">Amy Wong · 2 Sep 09:40</span></div>
          <div>Wide, handheld, along Pei Ho Street <span class="del">at dawn</span>.</div>
          <div>Wide, handheld, along Pei Ho Street, <span class="ins">morning light before the crowds arrive</span>.</div>
        </div>
        <div class="df">
          <div class="dh"><b style="font-weight: 500; color: #383838;">Beat 04</b> · 1:04 · voice-over<span style="margin-left: auto;">Amy Wong · 2 Sep 09:40</span></div>
          <div>發牌委員會八月決定<span class="del">放寬續牌</span>。<div class="cap" style="margin-top: 4px;">In August the licensing board <span class="del">relaxed renewals</span>.</div></div>
          <div>發牌委員會八月決定，<span class="ins">現有牌照可以轉讓俾直系親屬</span>。<div class="cap" style="margin-top: 4px;">In August the licensing board ruled that <span class="ins">existing licences may pass to immediate family</span>.</div></div>
        </div>
        <div class="df">
          <div class="dh"><b style="font-weight: 500; color: #383838;">Beat 06</b> · 1:48 · voice-over<span style="margin-left: auto;">Amy Wong · 2 Sep 09:40</span></div>
          <div style="color: #c7c7c7; font-style: italic;">Not in v3</div>
          <div><span class="ins">佢哋唔係懷舊，係仲喺度做緊生意。</span><div class="cap" style="margin-top: 4px;"><span class="ins">They aren’t nostalgia. They’re still open for business.</span></div></div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border: 1px dashed #e2e2e2; border-radius: 9px;"><svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round;"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg><span class="cap">3 unchanged beats: 01, 03, 05</span></div>
      </div>
${rightPanel(['Agent', 'Comments'], 'Agent', agentBlock({
  scope: 'v3 → v4 · Sham Shui Po',
  q: 'What changed between v3 and v4?',
  tool: 'Diffed v3 and v4 · 0.4 s',
  a: `<p>Amy’s tone pass touched three beats:</p><ul style="margin: 6px 0 0; padding-left: 16px;"><li>Beat 02 swaps “at dawn” for a softer line, house style now flags it as vague.</li><li>Beat 04 quotes the board’s decision exactly, which the brief requires.</li><li>Beat 06 adds a closing line.</li></ul><p style="margin-top: 8px;">Spoken length rose 6 s to 3:48, 3 s over target.</p>`,
  act: 'Trim 3 seconds',
  place: 'Ask about these versions…',
  guard: 'Uses only versions you can read',
  cost: 'HK$0.02',
}))}
    </div>`;

/* ---------------- APPROVAL (approver's view) ---------------- */
const SHOTS = [['01', 'Shutters rolling up', 'Existing footage', 'gray'], ['02', 'Pei Ho Street, handheld', 'B-roll', 'gray'], ['03', 'Mrs Ho interview', 'Existing footage', 'gray'], ['04', 'Renewal letter, macro', 'Still', 'gray'], ['05', 'Street, 1998', 'Archive · licensed', 'amb'], ['06', 'Four stall signs', 'Generated clip', 'blue']];
const approvalMain = `${docHeader({
  d: ssp, tab: 'approval', verLabel: '<span class="bd amb">v4 · Awaiting approval</span>', people: ['michelle', 'amy'],
  actions: '<div class="btn s">Request changes</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><path d="M6.8 10.5h10.4v8H6.8z"/><path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5"/></svg>Approve &amp; lock v4</div>',
  right: '<span class="cap">Requested by Amy Wong · 2 Sep 09:52</span>',
})}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; display: flex; gap: 22px; padding: 18px 22px 0; overflow: hidden;">
        <div style="flex-grow: 1; min-width: 0;">
          <div style="display: flex; gap: 11px; padding: 12px 13px; border: 1px solid #ededed; border-radius: 11px; background: #fff;">
            ${av('amy', 28)}
            <div style="min-width: 0;"><div style="display: flex; align-items: baseline; gap: 8px;"><span style="font-size: 12.5px; font-weight: 500;">Amy Wong</span><span class="cap">sent v4 for approval · 2 h ago</span></div>
            <div style="font-size: 12.5px; line-height: 1.55; color: #383838; margin-top: 4px;">Tone pass done and the board decision is quoted exactly. The two open flags are sound notes, happy for them to move to the shot list.</div></div>
          </div>
          <div style="display: flex; align-items: center; margin: 18px 0 2px;"><span class="lbl" style="padding: 0;">Before you lock</span><span class="cap" style="margin-left: auto;">5 of 6 pass</span></div>
          <div class="li">${okDot}<div style="flex-grow: 1;"><div class="a">All 3 mandatory points are in the script</div><div class="b">Beats 04, 05, 06 · checked against the brief</div></div></div>
          <div class="li">${okDot}<div style="flex-grow: 1;"><div class="a">Nothing from “things to avoid”</div><div class="b">2 rules · 0 hits</div></div></div>
          <div class="li">${okDot}<div style="flex-grow: 1;"><div class="a">Length within ±5% of target</div><div class="b">3:48 against 3:45 · +1.3%</div></div></div>
          <div class="li">${okDot}<div style="flex-grow: 1;"><div class="a">Sources credited</div><div class="b">HK Film Archive on screen in beat 05</div></div></div>
          <div class="li">${okDot}<div style="flex-grow: 1;"><div class="a">You aren’t the author of this version</div><div class="b">v4 written by Amy Wong · you’re the designated approver</div></div></div>
          <div class="li" style="border: none;">${warnDot}<div style="flex-grow: 1;"><div class="a">2 house-style flags still open</div><div class="b">Beat 02 time of day · beat 03 sound direction. Neither changes meaning</div></div><div class="btn s" style="height: 26px; font-size: 12px; align-self: center;">Review</div></div>
          <div style="display: flex; gap: 10px; margin-top: 14px; padding: 12px 13px; border-radius: 11px; background: #fdfaf3; border: 1px solid #f7dcb0;">
            <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; flex-shrink: 0; stroke: #db7706; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; margin-top: 1px;"><path d="M6.8 10.5h10.4v8H6.8z"/><path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5"/></svg>
            <div style="font-size: 12.5px; line-height: 1.55; color: #8a5a0d;">Locking makes v4 the single authorised version and sends it to Video Edit. It becomes read-only. Any later change creates v5 and needs your approval again.</div>
          </div>
        </div>
        <div style="width: 276px; flex-shrink: 0;">
          <div class="card" style="padding: 14px;">
            <div style="display: flex; align-items: center; gap: 7px;"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px; fill: #7c7c7c;"><rect x="3.4" y="5.4" width="12.4" height="13.2" rx="2.1"/><path d="m16.6 13 4.6 2.8V8.2L16.6 11z"/></svg><span class="lbl" style="padding: 0;">What Video Edit receives</span></div>
            <div style="font-size: 12.5px; margin-top: 8px;">New project <b style="font-weight: 500;">004</b> · 6 shot cards</div>
            <div style="margin-top: 6px;">
${SHOTS.map(([n, s, k, c]) => `              <div class="shot"><i>${n}</i><span>${s}</span><span class="bd ${c}" style="height: 18px; font-size: 10.5px; flex-grow: 0;">${k}</span></div>`).join('\n')}
            </div>
          </div>
          <div class="card" style="padding: 12px 14px; margin-top: 12px;">
            <div class="lbl" style="padding: 0; margin-bottom: 4px;">Approval record</div>
            <div class="kv"><span>Version</span><span>v4 · sha256 4e1b…c07a</span></div>
            <div class="kv"><span>Approver</span><span>Michelle Yip</span></div>
            <div class="kv" style="border: none;"><span>Stored in</span><span>Audit log · permanent</span></div>
          </div>
        </div>
      </div>
${rightPanel(['Agent', 'Comments'], 'Agent', agentBlock({
  scope: 'v4 · approval check',
  q: 'Anything I should read closely before locking?',
  tool: 'Read v4, brief, 2 sources · 0.8 s',
  a: `<p>Beat 04 is the one to read: it quotes the board’s ruling, and the wording matches the 14 Aug minutes exactly.</p><p style="margin-top: 8px;">The two open flags are style, not substance. Locking now still lets Video Edit move the sound note into the shot list.</p>`,
  act: 'Open beat 04',
  place: 'Ask before you approve…',
  guard: 'Uses only sources you can read',
  cost: 'HK$0.02',
}))}
    </div>`;

/* ---------------- A LOCKED SCRIPT (read-only) ---------------- */
const grc = D.grc;
const GBEATS = [
  ['01', '0:00', 'Map of the Aegean, slow push towards Salamis.', 'In 480 BC, a Persian fleet gathers off the coast of Attica.', '公元前480年，波斯艦隊喺阿提卡海岸集結。'],
  ['02', '0:18', 'Trireme reconstruction, oars in unison.', 'Three banks of rowers. One drum. Two hundred men to a ship.', '三排槳手，一個鼓，每艘船兩百人。'],
  ['03', '0:41', 'Strait at dusk, wide, drone.', 'The Greeks choose the narrows. Here, numbers stop mattering.', '希臘人揀咗海峽。喺呢度，數量唔再重要。'],
  ['04', '1:21', 'Battle plan: fire spreads across the strait.', 'Themistocles lets a rumour reach the Persian king.', '地米斯托克利故意放出消息。'],
  ['05', '1:57', 'Winged Victory statue, slow tilt up.', 'By nightfall, the Persian fleet is broken.', '到入夜，波斯艦隊已經潰散。'],
];
const lockedMain = `${docHeader({
  d: grc, tab: 'draft', verLabel: `<span class="bd grn" style="gap: 4px;">${LOCK}v6 · Locked</span>`, people: ['chan'],
  actions: '<div class="btn s">Export PDF</div><div class="btn s"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>Start v7</div>',
  right: '<span class="cap">Read-only · approved 28 Aug 16:02</span>',
})}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; overflow: hidden; padding: 18px 30px 0; background: #fff;">
        <div style="display: flex; align-items: center; gap: 11px; padding: 11px 13px; border-radius: 11px; background: #f3fbf6; border: 1px solid #c9ecd6; margin-bottom: 18px;">
          <div class="ck" style="background: #278f5e; width: 22px; height: 22px; border-radius: 11px;">${LOCK.replace('width: 10px; height: 10px; stroke: currentColor', 'width: 11px; height: 11px; stroke: #fff')}</div>
          <div style="flex-grow: 1; font-size: 12.5px; line-height: 1.5; color: #1f6b47;"><b style="font-weight: 500;">v6 is the authorised version.</b> Approved by Michelle Yip and handed to Video Edit · project 003. Editing starts v7, which needs approval again.</div>
        </div>
        <div style="font-size: 20px; font-weight: 600; letter-spacing: -.01em;">${grc.t}</div>
        <div style="display: flex; align-items: center; gap: 12px; margin-top: 8px; padding-bottom: 12px; font-size: 12px; color: #7c7c7c;">
          <span style="display: flex; align-items: center; gap: 6px;">${av('chan', 16)}Chan Ka-ming</span><span style="color: #e2e2e2;">|</span><span>Series explainer · confident, measured</span><span style="color: #e2e2e2;">|</span><span>9 beats · 486 words · 3:48 spoken</span>
        </div>
        <div class="bt" style="padding: 8px 0; border-bottom: 1px solid #ededed; border-top: 1px solid #ededed;">
          <div class="bn" style="color: #7c7c7c;">Beat</div><div class="bn" style="color: #7c7c7c;">Visual</div><div class="bn" style="color: #7c7c7c;">Voice-over · English / 繁中 subtitle</div>
        </div>
${GBEATS.map(([n, tc, vi, en, zh]) => `
        <div class="bt"><div class="bn">${n}<b>${tc}</b></div><div class="vi">${vi}</div><div><div class="zh" style="font-size: 13.5px;">${en}</div><div class="en">${zh}</div></div></div>`).join('')}
        <div class="cap" style="padding: 12px 0;">4 more beats · 06–09</div>
      </div>
${rightPanel(['Record', 'Agent'], 'Record', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 14px;">
          <div class="lbl" style="padding: 0; margin-bottom: 8px;">Approval record</div>
          <div style="display: flex; align-items: center; gap: 10px; padding: 10px 11px; border: 1px solid #ededed; border-radius: 10px; background: #fff;">${av('michelle', 28)}<div style="flex-grow: 1;"><div style="font-size: 12.5px; font-weight: 500;">Michelle Yip</div><div class="cap">Approved &amp; locked · 28 Aug 16:02</div></div>${okDot}</div>
          <div class="kv" style="margin-top: 10px;"><span>Version</span><span>v6 · sha256 91ac…2f3d</span></div>
          <div class="kv"><span>Written by</span><span>Chan Ka-ming</span></div>
          <div class="kv"><span>House style</span><span>94 / 100</span></div>
          <div class="kv"><span>Length</span><span>3:48 · target 3:50</span></div>
          <div class="kv" style="border: none;"><span>Mandatory points</span><span>4 / 4</span></div>
          <div class="lbl" style="padding: 0; margin: 16px 0 8px;">Downstream</div>
          <div class="li" style="padding: 9px 0;"><img src="cover-history.jpg" style="width: 52px; height: 30px; border-radius: 5px; object-fit: cover; flex-shrink: 0;"><div style="min-width: 0;"><div class="a" style="font-size: 12px;">Video Edit · project 003</div><div class="b">Rough cut rendered · 16:9, 9:16, 1:1</div></div></div>
          <div class="li" style="padding: 9px 0; border: none;"><div style="width: 52px; height: 30px; border-radius: 5px; background: #f3f3f3; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px; fill: #999999;"><path d="M21.86 4.14a1.1 1.1 0 0 0-1.14-.18L2.9 11.13c-.86.34-.83 1.58.05 1.87l4.46 1.5 1.68 5.06c.24.72 1.15.93 1.68.38l2.4-2.5 4.4 3.23c.6.44 1.46.12 1.63-.6z"/></svg></div><div style="min-width: 0;"><div class="a" style="font-size: 12px;">Publish · YouTube</div><div class="b">Scheduled 12 Sep 19:00</div></div></div>
          <div class="lbl" style="padding: 0; margin: 14px 0 8px;">Earlier versions</div>
          <div class="kv"><span>v5 · Chan Ka-ming</span><span>27 Aug</span></div>
          <div class="kv" style="border: none;"><span>v1–v4</span><span>21–26 Aug</span></div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 10px 14px 12px; display: flex; align-items: center; gap: 7px;">
          ${LOCK.replace('width: 10px; height: 10px; stroke: currentColor', 'width: 11px; height: 11px; stroke: #999999')}<span style="font-size: 10.5px; color: #999999;">Records are permanent · in the audit log</span>
        </div>`)}
    </div>`;

/* =================================================================== */
/* ---------------- every other script gets its own page (live site), so the switcher always opens it ---------------- */
const SLUG = { tpe: 'taipei-night-market', vcl: 'cantonese-voice-cloning', gdy: 'good-day', hbf: 'harbourfront', prs: 'porsche-cat', cct: 'cha-chaan-teng', sgh: 'singapore-hawker', dmo: 'do-more', org: 'orange-typography' };
const BANNER = {
  locked: d => ['#f3fbf6', '#c9ecd6', '#1f6b47', `<b style="font-weight: 500;">v${d.v} is the authorised version.</b> Approved by Michelle Yip and handed to Video Edit. Editing starts v${d.v + 1}, which needs approval again.`],
  await: d => ['#fffbf0', '#f7dcb0', '#8a5a0d', `<b style="font-weight: 500;">Waiting for Michelle Yip.</b> ${P[d.o][1]} sent v${d.v} for approval, ${d.ed.toLowerCase()}.`],
  changes: d => ['#fff7f7', '#ffdcdc', '#8a3b3b', '<b style="font-weight: 500;">Changes requested.</b> Michelle Yip: “Tighten the opening and say where the menu prices come from.”'],
  draft: d => ['#f5faff', '#d6eafc', '#0b5cad', `<b style="font-weight: 500;">Draft v${d.v}.</b> House style ${d.sc} / 100 · last edited ${d.ed.toLowerCase()}.`],
  brief: d => ['#fafafa', '#ededed', '#525252', '<b style="font-weight: 500;">Brief only.</b> Generate the first draft when the brief is ready.'],
};
const ACT = {
  locked: d => `<div class="btn s">Export PDF</div><div class="btn s">Start v${d.v + 1}</div>`,
  await: () => '<div class="btn s">Share</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Remind Michelle</div>',
  changes: d => `<div class="btn s">See comments</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Send v${d.v + 1} for approval</div>`,
  draft: () => '<div class="btn s">Share</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Send for approval</div>',
  brief: () => '<div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Generate first draft</div>',
};
const docMain = d => { const [bg, bc, fg, txt] = BANNER[d.st](d); return `${docHeader({
  d, tab: d.st === 'brief' ? 'brief' : 'draft',
  verLabel: `<span class="bd ${ST[d.st][1]}" style="gap: 4px;">${d.st === 'locked' ? LOCK : ''}${d.v ? 'v' + d.v + ' · ' : ''}${ST[d.st][0]}</span>`,
  people: [d.o], actions: ACT[d.st](d), right: `<span class="cap">Updated ${d.ed}</span>` })}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; overflow: hidden; padding: 18px 30px 0;">
        <div style="padding: 11px 13px; border-radius: 11px; background: ${bg}; border: 1px solid ${bc}; margin-bottom: 18px; font-size: 12.5px; line-height: 1.5; color: ${fg};">${txt}</div>
        <div style="font-size: 20px; font-weight: 600; letter-spacing: -.01em;">${d.t}</div>
        <div style="display: flex; align-items: center; gap: 12px; margin-top: 8px; padding-bottom: 12px; font-size: 12px; color: #7c7c7c;"><span style="display: flex; align-items: center; gap: 6px;">${av(d.o, 16)}${P[d.o][1]}</span><span style="color: #e2e2e2;">|</span><span>${d.ch}</span><span style="color: #e2e2e2;">|</span><span>${d.dur}</span></div>
${d.b ? `        <div class="bt" style="padding: 8px 0; border-bottom: 1px solid #ededed; border-top: 1px solid #ededed;"><div class="bn" style="color: #7c7c7c;">Beat</div><div class="bn" style="color: #7c7c7c;">Visual</div><div class="bn" style="color: #7c7c7c;">Voice-over</div></div>
${d.b.map(([vi, a, b2], i) => `        <div class="bt"><div class="bn">${String(i + 1).padStart(2, '0')}</div><div class="vi">${vi}</div><div><div class="zh" style="font-size: 13.5px;">${a}</div><div class="en">${b2}</div></div></div>`).join('\n')}`
    : `        <div style="max-width: 560px;">${d.f.map(([k, v]) => `<div class="kv" style="font-size: 13px;"><span>${k}</span><span>${v}</span></div>`).join('')}</div>`}
      </div>
${rightPanel(['Details', 'Agent'], 'Details', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 14px;">
          <div class="kv"><span>Status</span><span>${ST[d.st][0]}</span></div>
          <div class="kv"><span>Version</span><span>${d.v ? 'v' + d.v : 'Brief'}</span></div>
          <div class="kv"><span>Owner</span><span>${P[d.o][1]}</span></div>
          <div class="kv"><span>Channel</span><span>${d.ch}</span></div>
          <div class="kv"><span>Length</span><span>${d.dur}</span></div>
          <div class="kv" style="border: none;"><span>House style</span><span>${d.sc != null ? d.sc + ' / 100' : 'Not scored yet'}</span></div>
        </div>`)}
    </div>`; };

const simple = SIMPLE;
const out = [
  { file: 'Script-Library.dc.html',  title: 'Library',  me: 'amy',      side: librarySidebar,   main: libraryMain, logic: libraryLogic, props: ',"view":{"editor":"enum","options":["grid","list"],"default":"grid","section":"View"}' },
  { file: 'Script-Brief.dc.html',    title: 'Brief',    me: 'amy',      side: switcher('ssp'),  main: briefMain,   logic: simple },
  { file: 'Script-Editor.dc.html',   title: 'Draft',    me: 'amy',      side: switcher('ssp'),  main: draftMain,   logic: draftLogic },
  { file: 'Script-Versions.dc.html', title: 'Versions', me: 'amy',      side: switcher('ssp'),  main: versionsMain, logic: simple },
  { file: 'Script-Lock.dc.html',     title: 'Approval', me: 'michelle', side: switcher('ssp'),  main: approvalMain, logic: simple },
  { file: 'Script-Locked.dc.html',   title: 'Locked',   me: 'amy',      side: switcher('grc'),  main: lockedMain,  logic: simple },
  ...Object.entries(SLUG).map(([id, slug]) => ({ file: `Script-Doc-${slug}.dc.html`, title: D[id].t, me: 'amy', side: switcher(id), main: docMain(D[id]), logic: simple })),
];
for (const o of out) fs.writeFileSync(path.join(DIR, o.file), page(o));
console.log('wrote', out.map(o => o.file).join(', '));
