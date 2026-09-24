/**
 * Shared shell for hand-authored module screens (Script, Video Edit, …):
 * Espresso CSS lifted from Desktop.dc.html, the icon rail, right panel,
 * agent block, a collapsible left sidebar, the page wrapper, and a tiny
 * pixel-art engine (crisp SVG rects) for file icons and the render floor.
 */
import fs from 'fs';
import path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.join(DIR, 'Desktop.dc.html'), 'utf8');
export const css = src.slice(src.indexOf('<style>') + 7, src.indexOf('</style>'))
  .replace("font-family: Inter, system-ui, sans-serif;", "font-family: Inter, 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif;");

export const BASE_CSS = `
    .tabs { height: 40px; flex-shrink: 0; display: flex; align-items: stretch; gap: 20px; padding: 0 22px; border-bottom: 1px solid #ededed; }
    .tb { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #7c7c7c; border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
    .tb.on { color: #171717; font-weight: 500; border-color: #171717; }
    .tb b { font-size: 10.5px; font-weight: 500; color: #999999; }
    .tb i { font-style: normal; display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 8px; background: #e6f4ff; color: #007be0; font-size: 10px; font-weight: 500; }
    .rtab { height: 26px; padding: 0 11px; border-radius: 7px; display: flex; align-items: center; gap: 6px; font-size: 12px; color: #7c7c7c; }
    .rtab.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500; }
    .cap { font-size: 11px; color: #999999; }
    .seg { width: 30px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .seg svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .fc { height: 26px; padding: 0 10px; border-radius: 7px; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #525252; border: 1px solid #ededed; background: #fff; white-space: nowrap; }
    .fc b { font-weight: 500; color: #999999; font-size: 11px; }
    .fc.on { background: #171717; border-color: #171717; color: #fff; }
    .fc.on b { color: #c7c7c7; }
    .fc svg { width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .dot { width: 7px; height: 7px; border-radius: 4px; flex-shrink: 0; }
    .kbd { display: inline-flex; align-items: center; height: 18px; padding: 0 5px; border-radius: 4px; border: 1px solid #e2e2e2; font-size: 10.5px; color: #7c7c7c; background: #fafafa; }
    .ck { width: 18px; height: 18px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .ck svg { width: 11px; height: 11px; stroke: #fff; fill: none; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
    .cb { width: 16px; height: 16px; border-radius: 4px; border: 1px solid #999999; background: #fff; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
    .cb.on { border: none; background: #171717; }
    .cb svg { width: 11px; height: 11px; stroke: #fff; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .li { display: flex; gap: 11px; padding: 11px 0; border-bottom: 1px solid #f3f3f3; }
    .li .a { font-size: 12.5px; color: #171717; }
    .li .b { font-size: 11.5px; color: #999999; margin-top: 2px; }

    /* item switcher (left sidebar inside a document / project) */
    .sn { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 9px; border-radius: 8px; font-size: 12.5px; color: #525252; }
    .sn > span:not(.dot) { flex-grow: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sn.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500; }
    .sn img.av { width: 16px; height: 16px; border-radius: 8px; }
    .sg { display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 500; color: #999999; padding: 0 9px; margin: 14px 0 4px; }
    .sg svg { width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .ptog { width: 26px; height: 26px; border-radius: 7px; display: flex; align-items: center; justify-content: center; color: #7c7c7c; cursor: pointer; flex-shrink: 0; }
    .ptog:hover { background: #ededed; }
    .ptog svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .mini { width: 52px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 4px; }
    .mi { width: 36px; height: 36px; border-radius: 9px; display: flex; align-items: center; justify-content: center; position: relative; }
    .mi.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
    .mi .dot { position: absolute; right: 3px; bottom: 3px; box-shadow: 0 0 0 2px #f8f8f8; }
    .mi.on .dot { box-shadow: 0 0 0 2px #fff; }`;

/* ---------- people ---------- */
export const P = { amy: ['pfp-amy.jpg', 'Amy Wong'], leung: ['pfp-leung.jpg', 'Leung Chi-hang'], chan: ['pfp-chan.jpg', 'Chan Ka-ming'], michelle: ['pfp-michelle.jpg', 'Michelle Yip'] };
export const av = (k, s = 20, extra = '') => `<img class="av" src="${P[k][0]}" style="width: ${s}px; height: ${s}px;${extra}">`;

export const TICK = '<svg viewBox="0 0 16 16"><path d="M3.6 8.3 6.5 11.2 12.4 5.1"/></svg>';
export const okDot = `<div class="ck" style="background: #278f5e;">${TICK}</div>`;
export const warnDot = '<div class="ck" style="background: #db7706;"><svg viewBox="0 0 16 16"><path d="M8 4.2v4.6M8 11.4v.2"/></svg></div>';
export const failDot = '<div class="ck" style="background: #e03636;"><svg viewBox="0 0 16 16"><path d="M5 5l6 6M11 5l-6 6"/></svg></div>';
export const cb = on => on ? `<div class="cb on">${TICK}</div>` : '<div class="cb"></div>';
export const LOCK = '<svg viewBox="0 0 24 24" style="width: 10px; height: 10px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;"><path d="M6.8 10.5h10.4v8H6.8z"/><path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5"/></svg>';
export const PANEL = '<svg viewBox="0 0 24 24"><rect x="3.8" y="4.8" width="16.4" height="14.4" rx="2.6"/><path d="M9.6 4.8v14.4"/></svg>';
export const CHEV = '<svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>';
export const AGENT_ICON = '<svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: {{accent}}; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 4.2 19 8v8l-7 3.8L5 16V8z"/><path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8"/></svg>';
export const SPARK = '<svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="m12 3.5 1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/></svg>';

/* ---------- pixel-art engine ---------- */
export const PAL = {
  k: '#262626', w: '#ffffff', g: '#d9d9d9', G: 'rgba(0,0,0,0.13)', b: '#2f54c8', y: '#f5d547', d: '#fbeaa0', Y: '#c9a830',
  r: '#e5484d', t: '#efc690', a: '#f5a524', n: '#30a46c', s: '#e6e9ee', S: '#aab3bf', e: '#262626', m: '#262626',
  B: '#4c7cf0', l: '#30a46c', o: '#b86b30', O: '#8e4f22', h: '#d08a4c', c: '#1e2a36', C: '#33414f', x: '#6b7c8f', z: '#9aa5b1',
};
const rects = (rows, x0, y0, pal) => {
  let g = '';
  rows.forEach((r, j) => {
    let i = 0;
    while (i < r.length) {
      const c = r[i];
      if (c === '.') { i++; continue; }
      let k = i; while (k < r.length && r[k] === c) k++;
      g += `<rect x="${x0 + i}" y="${y0 + j}" width="${k - i}" height="1" fill="${pal[c]}"/>`;
      i = k;
    }
  });
  return g;
};
/** layers: [[rows, x, y, gClass?], …]  →  one crisp SVG, `s` screen px per art pixel */
export function px(layers, { s = 3, pal = {}, style = '' } = {}) {
  const P2 = { ...PAL, ...pal };
  let W = 0, H = 0;
  for (const [rows, x = 0, y = 0] of layers) { H = Math.max(H, y + rows.length); W = Math.max(W, x + Math.max(...rows.map(r => r.length))); }
  const body = layers.map(([rows, x = 0, y = 0, cls]) => cls ? `<g class="${cls}">${rects(rows, x, y, P2)}</g>` : rects(rows, x, y, P2)).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W * s}" height="${H * s}" shape-rendering="crispEdges" style="display: block; flex-shrink: 0;${style}">${body}</svg>`;
}
/** a sprite as a <g> for composing scenes inside a larger pixel SVG */
export const pxg = (rows, x, y, pal = {}, cls = '') => `<g${cls ? ` class="${cls}"` : ''}>${rects(rows, x, y, { ...PAL, ...pal })}</g>`;

export const SPRITE = {
  DOC: ['kkkkkkkkkk.....', 'kwwwwwwwwkk....', 'kwwwwwwwwkgk...', 'kwbbbbbwwkggk..', 'kwwwwwwwwkkkkk.', 'kwbbbbbbbbbbwk.', 'kwwwwwwwwwwwwk.', 'kwbbbbbbbbbbwk.', 'kwwwwwwwwwwwwk.', 'kwbbbbbbbbbbwk.', 'kwwwwwwwwwwwwk.', 'kwbbbbbbbwwwwk.', 'kwwwwwwwwwwwwkG', 'kwwwwwwwwwwwwkG', 'kkkkkkkkkkkkkkG', '.GGGGGGGGGGGGGG'],
  NOTE: ['.k.k.k.k.k.k.', 'kSkSkSkSkSkSk', 'kkkkkkkkkkkkk', 'kwwwwwwwwwwwk', 'kwgggggggggwk', 'kwwwwwwwwwwwk', 'kwgggggggggwk', 'kwwwwwwwwwwwk', 'kwgggggggggwk', 'kwwwwwwwwwwwk', 'kwgggggggggwk', 'kwwwwwwwwwwwk', 'kwggggggwwwwk', 'kwwwwwwwwwwwkG', 'kkkkkkkkkkkkkG', '.GGGGGGGGGGGGG'],
  PENCIL: ['.....rr', '....yyr', '...yyy.', '..yyy..', '.tyy...', 'kt.....'],
  LOCK: ['..kkk..', '.k...k.', '.k...k.', 'kkkkkkk', 'knnnnnk', 'knnwnnk', 'knnnnnk', 'kkkkkkk'],
  CLOCK: ['..kkk..', '.kaaak.', 'kaawaak', 'kaawwak', 'kaaaaak', '.kaaak.', '..kkk..'],
  BANG: ['..kkk..', '.krwrk.', 'krrwrrk', 'krrwrrk', 'krrrrrk', '.krwrk.', '..kkk..'],
  FOLDER: ['.kkkkk............', 'kdddddk...........', 'kyyyyyykkkkkkkkkk.', 'kyyyyyyyyyyyyyyyyk', 'kkkkkkkkkkkkkkkkkk',
    ...Array.from({ length: 7 }, (_, i) => 'kw' + (i % 2 ? 'dy' : 'yd').repeat(7) + (i % 2 ? 'dk' : 'yk')),
    'kYYYYYYYYYYYYYYYYk', 'kkkkkkkkkkkkkkkkkk', '.GGGGGGGGGGGGGGGGG'],
  CLAP: ['kkkkkkkkkk', 'kwkkwkkwkk', 'kkkkkkkkkk', 'kssssssssk', 'ksSSSSSssk', 'kssssssssk', 'ksSSSssssk', 'kssssssssk', 'kkkkkkkkkk'],
  BOT: ['.....ll.....', '.....kk.....', '..kkkkkkkk..', '.kssssssssk.', '.kseesseesk.', '.kssssssssk.', '.ksssmmsssk.', '..kkkkkkkk..', '.kkBBBBBBkk.', 'kSkBBBBBBkSk', 'kSkBBBBBBkSk', '.k.kkkkkk.k.'],
  FILM: ['kkkkkkkkkkkkkk', 'kwkwkwkwkwkwkk', 'kkkkkkkkkkkkkk', 'kSSSSSSSSSSSSk', 'kSxxxxSSxxxxSk', 'kSxxxxSSxxxxSk', 'kSSSSSSSSSSSSk', 'kkkkkkkkkkkkkk', 'kwkwkwkwkwkwkk', 'kkkkkkkkkkkkkk'],
  TRASH: ['...kkkk...', 'kkkkkkkkkk', '.kSSSSSSk.', '.kSkSkSSk.', '.kSkSkSSk.', '.kSkSkSSk.', '.kSSSSSSk.', '..kkkkkk..'],
};
/* ---------- modern file + folder icons (macOS-like: white page with a
   tiny text preview, soft blue folder). Same sizing unit as the pixel set:
   a page is 14s × 18s px, a folder 18s × 14s px. ---------- */
const DOC_LINES = [20, 27, 24, 28, 18, 26, 23, 27, 15, 25, 22, 26];
const BADGE = {
  draft: ['#007be0', '<path d="M-2.6 2.6 1.9-1.9" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M1.1-2.7l1.6 1.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>'],
  await: ['#f5a524', '<path d="M0-3.2V0l2.1 1.4" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'],
  changes: ['#e5484d', '<path d="M0-3.3v3.5" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="0" cy="2.7" r=".95" fill="#fff"/>'],
  locked: ['#30a46c', '<rect x="-2.7" y="-.5" width="5.4" height="4" rx="1" fill="#fff"/><path d="M-1.6-.5v-1.2a1.6 1.6 0 0 1 3.2 0v1.2" stroke="#fff" stroke-width="1.3" fill="none"/>'],
  skill: ['#6846e3', '<path d="M.9-3.9-2.4.7H0l-.9 3.2L2.4-.7H0z" fill="#fff"/>'],
  example: ['#0ea5e9', '<path d="M-3.1-2.4h6.2v3.9H-.3L-2.1 3v-1.5h-1z" fill="#fff"/>'],
  style: ['#d6409f', '<circle r="2.3" fill="none" stroke="#fff" stroke-width="1.5"/>'],
};
export function docIcon(kind = 'none', s = 3, off = false) {
  const W = +(14 * s).toFixed(1), H = +(18 * s).toFixed(1);
  const line = off ? '#ececec' : '#d6d6d6';
  let g = `<rect x="6" y="7" width="15" height="2.4" rx="1.2" fill="${off ? '#dcdcdc' : '#8f8f8f'}"/>`;
  let y = 13.5;
  if (kind === 'brief') {
    for (let i = 0; i < 4; i++) { g += `<rect x="6" y="${y}" width="30" height="6" rx="1.6" fill="#f2f2f2"/><rect x="8.2" y="${y + 2.3}" width="${9 + i * 4}" height="1.4" rx=".7" fill="#cdcdcd"/>`; y += 8.4; }
  } else {
    DOC_LINES.forEach((w, i) => { if (y > 49) return; g += `<rect x="6" y="${y.toFixed(1)}" width="${w}" height="1.35" rx=".7" fill="${line}"/>`; y += i % 4 === 3 ? 4.8 : 3.2; });
  }
  const b = BADGE[kind];
  if (b) g += `<g transform="translate(34.5 46.5)"><circle r="7.4" fill="${off ? '#c7c7c7' : b[0]}" stroke="#fff" stroke-width="1.8"/>${b[1]}</g>`;
  return `<svg viewBox="0 0 42 54" width="${W}" height="${H}" style="display: block; flex-shrink: 0; overflow: visible; filter: drop-shadow(0 .5px 1px rgba(0,0,0,.18)) drop-shadow(0 2px 5px rgba(0,0,0,.06));${off ? ' opacity: .6;' : ''}"><rect x=".5" y=".5" width="41" height="53" rx="3.5" fill="#fff" stroke="rgba(0,0,0,.07)"/>${g}</svg>`;
}
export function folderIcon(s = 3) {
  const W = +(18 * s).toFixed(1), H = +(14 * s).toFixed(1);
  return `<svg viewBox="0 0 60 46" width="${W}" height="${H}" style="display: block; flex-shrink: 0; filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.14));"><defs><linearGradient id="mfold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fcdf9"/><stop offset="1" stop-color="#5eacee"/></linearGradient></defs><path d="M2 5a4 4 0 0 1 4-4h14.2a4 4 0 0 1 3.1 1.5L26.4 6H54a4 4 0 0 1 4 4v5H2z" fill="#4e9ce0"/><rect x="1" y="10.5" width="58" height="34.5" rx="4.5" fill="url(#mfold)"/><rect x="1.5" y="10.5" width="57" height="1.8" rx=".9" fill="#bfe3ff"/></svg>`;
}
export const ICON = {
  draft: (s = 3) => docIcon('draft', s),
  brief: (s = 3) => docIcon('brief', s),
  await: (s = 3) => docIcon('await', s),
  changes: (s = 3) => docIcon('changes', s),
  locked: (s = 3) => docIcon('locked', s),
  folder: (s = 3) => folderIcon(s),
  clap: (s = 3) => px([[SPRITE.CLAP]], { s }),
  film: (s = 3) => px([[SPRITE.FILM]], { s }),
  trash: (s = 2) => px([[SPRITE.TRASH]], { s }),
};

/* ---------- rail ---------- */
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
export const rail = (me, active) => `
  <div style="width: 52px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 3px;">
    <div style="width: 28px; height: 28px; border-radius: 8px; background: #171717; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 600; margin-bottom: 10px;">AF</div>
${RAIL.map(([k, icon]) => `    <div class="r${k === active ? ' on' : ''}${k === 'hr' ? ' no' : ''}"><svg viewBox="0 0 24 24">${icon}</svg></div>\n` + (k === 'pub' ? '    <div style="width: 22px; height: 1px; background: #e2e2e2; margin: 6px 0;"></div>\n' : '')).join('')}    <div style="flex-grow: 1;"></div>
    ${av(me, 26)}
  </div>`;

/* ---------- collapsible left sidebar ---------- */
export const collapsible = (open, closed) => `
<sc-if value="{{sideOpen}}" hint-placeholder-val="{{ true }}">${open}
</sc-if>
<sc-if value="{{sideClosed}}" hint-placeholder-val="{{ false }}">${closed}
</sc-if>`;
export const toggleBtn = title => `<div class="ptog" onClick="{{ toggleSide }}" title="${title}">${PANEL}</div>`;

/* ---------- simplified brand marks for providers and tools ---------- */
const bsvg = (s, body) => `<svg viewBox="0 0 26 26" width="${s}" height="${s}" style="display: block; flex-shrink: 0;">${body}</svg>`;
export const BRAND = {
  openrouter: (s = 26) => bsvg(s, '<rect width="26" height="26" rx="7" fill="#111"/><path d="M5.5 13h2.8c2 0 2.7-1.1 3.7-2.8s2-2.6 4.2-2.6h2.3M5.5 13h2.8c2 0 2.7 1.1 3.7 2.8s2 2.6 4.2 2.6h2.3" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><path d="m17.6 5.6 2.5 2-2.5 2M17.6 16.4l2.5 2-2.5 2" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
  google: (s = 26) => bsvg(s, '<rect x=".5" y=".5" width="25" height="25" rx="6.5" fill="#fff" stroke="#e6e6e6"/><g fill="none" stroke-width="2.8"><path d="M8.1 9.6A6 6 0 0 1 17.6 9.1" stroke="#ea4335"/><path d="M8.1 16.4A6 6 0 0 1 8.1 9.6" stroke="#fbbc05"/><path d="M17.6 16.9A6 6 0 0 1 8.1 16.4" stroke="#34a853"/><path d="M19 13A6 6 0 0 1 17.6 16.9M13 13h6.2" stroke="#4285f4"/></g>'),
  elevenlabs: (s = 26) => bsvg(s, '<rect width="26" height="26" rx="7" fill="#000"/><rect x="9.6" y="7.5" width="2.3" height="11" rx="1.1" fill="#fff"/><rect x="14.1" y="7.5" width="2.3" height="11" rx="1.1" fill="#fff"/>'),
  azure: (s = 26) => bsvg(s, '<rect x=".5" y=".5" width="25" height="25" rx="6.5" fill="#fff" stroke="#e6e6e6"/><path d="M11.2 6.2h4.1L9.6 20.3H5.3z" fill="#0a5fc4"/><path d="M15.9 9.2 20.7 20.3H11l5.6-1.6-2.3-4.1z" fill="#2c9cf2"/>'),
  openai: (s = 26) => bsvg(s, '<rect width="26" height="26" rx="7" fill="#0d0d0d"/><g fill="none" stroke="#fff" stroke-width="1.45"><ellipse cx="13" cy="13" rx="6.2" ry="2.9"/><ellipse cx="13" cy="13" rx="6.2" ry="2.9" transform="rotate(60 13 13)"/><ellipse cx="13" cy="13" rx="6.2" ry="2.9" transform="rotate(120 13 13)"/></g>'),
  xero: (s = 26) => bsvg(s, '<circle cx="13" cy="13" r="13" fill="#13b5ea"/><text x="13" y="16" text-anchor="middle" font-family="Inter, sans-serif" font-size="8.4" font-weight="600" fill="#fff">xero</text>'),
  hsbc: (s = 26) => bsvg(s, '<rect x=".5" y=".5" width="25" height="25" rx="6.5" fill="#fff" stroke="#e6e6e6"/><path d="M4 13 9 8v10zM22 13l-5 5V8zM9 8h8l-4 5zM9 18h8l-4-5z" fill="#db0011"/><path d="M9 8h8l-4 5zM9 18h8l-4-5z" fill="#fff"/><path d="M4 13 9 8v10zM22 13l-5 5V8z" fill="#db0011"/>'),
  visa: (s = 26) => bsvg(s, '<rect x=".5" y=".5" width="25" height="25" rx="6.5" fill="#1a1f71"/><text x="13" y="16.2" text-anchor="middle" font-family="Inter, sans-serif" font-size="8" font-style="italic" font-weight="700" fill="#fff">VISA</text>'),
};

/* ---------- module sidebar + top bar (for stage-style modules) ---------- */
export const moduleSidebar = (title, nav, cur, { badges = {}, footer = '' } = {}) => `
  <div style="width: 212px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; padding: 10px 8px;">
    <div style="padding: 4px 9px 12px; font-size: 14px; font-weight: 500;">${title}</div>
    <div class="lbl" style="margin-bottom: 5px;">Screens</div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
${nav.map(([k, l]) => `      <div class="n${k === cur ? ' on' : ''}"><span>${l.replace('&', '&amp;')}</span>${badges[k] || ''}</div>`).join('\n')}
    </div>
    <div style="margin-top: auto; padding: 10px 9px 4px; border-top: 1px solid #ededed;">${footer}</div>
  </div>`;
export const topbar = (title, hint, right = '') => `
    <div class="bar">
      <span class="h1">${title}</span>
      <span class="mut">${hint}</span>
      <div style="flex-grow: 1;"></div>${right}
      <div style="width: 200px; height: 28px; border: 1px solid #ededed; border-radius: 8px; background: #f8f8f8; display: flex; align-items: center; gap: 7px; padding: 0 9px;">
        <svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round;"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg><span style="font-size: 12px; color: #999999;">Search</span>
      </div>
    </div>`;
export const chip = (label, withChev = true) => `<div class="chip">${label}${withChev ? ' <svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>' : ''}</div>`;

/* ---------- right panel + agent ---------- */
export const rightPanel = (tabs, on, body) => `
      <div style="width: 320px; flex-shrink: 0; border-left: 1px solid #ededed; background: #fcfcfc; display: flex; flex-direction: column;">
        <div style="height: 44px; flex-shrink: 0; display: flex; align-items: center; gap: 2px; padding: 0 10px; border-bottom: 1px solid #ededed;">
${tabs.map(t => `          <div class="rtab${t === on ? ' on' : ''}">${t === 'Agent' ? AGENT_ICON : ''}${t}</div>`).join('\n')}
          <div style="flex-grow: 1;"></div>
          <svg viewBox="0 0 24 24" style="width: 15px; height: 15px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="m10 6 6 6-6 6"/></svg>
        </div>
${body}
      </div>`;

export const agentBlock = ({ scope, q, tool, a, act, place, guard, cost, extra = '' }) => `
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

/* ---------- page ---------- */
export const SIMPLE = `
  renderVals() { return this.side({ accent: this.accent() }); }`;

export function page({ module, title, gen, me, active, side, main, logic = SIMPLE, props = '', extraCss = '', collapsed = false }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<!-- hand-authored: ${module} · ${title}. Rebuild with ${gen} -->
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600&family=Noto+Sans+HK:wght@400;500&display=swap">
  <style>${css}${BASE_CSS}${extraCss}</style>
</helmet>

<div style="--ac: {{accent}}; width: 1440px; height: 900px; display: flex; background: #ffffff; color: #171717; overflow: hidden;">
${rail(me, active)}
${side}
  <div style="flex-grow: 1; display: flex; flex-direction: column; min-width: 0;">
${main}
  </div>
</div>
</x-dc>
<script data-dc-script data-props='{"accent":{"editor":"color","default":"#007BE0","options":["#007BE0","#171717","#278F5E","#6846E3"],"section":"Theme"},"sidebar":{"editor":"enum","options":["open","collapsed"],"default":"${collapsed ? 'collapsed' : 'open'}","section":"Layout"}${props},"$preview":{"width":1440,"height":900}}'>
class Component extends DCLogic {
  constructor(props) { super(props); this.state = {}; }
  accent() { var raw = this.props.accent || '#007BE0'; return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#007BE0'; }
  side(v) {
    var self = this;
    var c = this.state.c != null ? this.state.c : this.props.sidebar === 'collapsed';
    v.sideOpen = !c; v.sideClosed = c;
    v.toggleSide = function () { self.setState({ c: !c }); };
    return v;
  }${logic}
}
</${'script'}>
</body>
</html>
`;
}
