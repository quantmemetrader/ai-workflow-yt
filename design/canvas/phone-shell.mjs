/**
 * Phone shell for every module, lifted from FilesPhone (the Database phone
 * view the user likes): header with back / search / more, large title,
 * sub-screen chips, agent bottom sheet (closed by default, toggles), and the
 * floating dock (ask pill + tab pill + dark agent FAB). 390 × 844.
 */
import { P } from './shell.mjs';

export const PCSS = `
    html, body { overflow: hidden; }
    body { margin: 0; font-family: Inter, 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif; font-weight: 420; letter-spacing: 0.02em; -webkit-font-smoothing: antialiased; }
    * { box-sizing: border-box; }
    p { margin: 0; }
    img { display: block; }
    .tab { flex: 1 1 0; min-width: 0; height: 46px; display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: 23px; color: #525252; }
    .tab svg { width: 20px; height: 20px; fill: currentColor; flex-shrink: 0; }
    .tab.on { flex: 2 1 0; background: #ffffff; color: #171717; box-shadow: 0 1px 3px rgba(23,23,23,0.10); }
    .tab.on span { font-size: 12.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ico { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .ico svg { width: 21px; height: 21px; stroke: #383838; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .chip { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 17px; font-size: 13.5px; white-space: nowrap; flex-shrink: 0; border: 1px solid #ededed; color: #525252; }
    .chip.on { background: #171717; border-color: #171717; color: #ffffff; }
    .chip b { font-weight: 500; opacity: .6; font-size: 12px; }
    .row { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 16px; }
    .rs { height: 1px; background: #f3f3f3; margin-left: 82px; }
    .rs.n { margin-left: 16px; }
    .th { width: 54px; height: 36px; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: #f3f3f3; position: relative; }
    .th img { width: 100%; height: 100%; object-fit: cover; }
    .ph { width: 54px; height: 36px; border-radius: 8px; flex-shrink: 0; background: #f3f3f3; display: flex; align-items: center; justify-content: center; }
    .nm { font-size: 14.5px; color: #171717; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { font-size: 12.5px; color: #999999; margin-top: 3px; display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; }
    .sub > span { overflow: hidden; text-overflow: ellipsis; }
    .av { border-radius: 50%; object-fit: cover; flex-shrink: 0; }
    .seg { width: 38px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
    .seg svg { width: 17px; height: 17px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .sec { display: flex; align-items: baseline; gap: 8px; padding: 18px 16px 8px; }
    .sec b { font-size: 15px; font-weight: 500; color: #171717; }
    .sec span { font-size: 12.5px; color: #999999; }
    .sec i { font-style: normal; margin-left: auto; font-size: 13px; color: var(--ac); white-space: nowrap; }
    .card { border: 1px solid #ededed; border-radius: 16px; background: #ffffff; padding: 14px; }
    .kp { border: 1px solid #ededed; border-radius: 14px; padding: 12px 13px; min-width: 0; background: #fff; }
    .kp i { font-style: normal; display: block; font-size: 12px; color: #999999; }
    .kp b { display: block; font-size: 19px; font-weight: 500; margin-top: 5px; font-variant-numeric: tabular-nums; letter-spacing: -.01em; white-space: nowrap; }
    .kp span { display: block; font-size: 11.5px; color: #7c7c7c; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bd { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 7px; font-size: 11.5px; font-weight: 500; white-space: nowrap; flex-shrink: 0; }
    .gray { background: #f3f3f3; color: #525252 } .blue { background: #e6f4ff; color: #007be0 } .grn { background: #e4faeb; color: #278f5e }
    .amb { background: #fff7d3; color: #b36b00 } .red { background: #ffe7e7; color: #e03636 } .vio { background: #f3f0ff; color: #6846e3 }
    .dot { width: 8px; height: 8px; border-radius: 4px; flex-shrink: 0; }
    .bp { height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 15px; font-weight: 500; background: var(--ac); color: #fff; flex: 1 1 0; }
    .bs { height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 15px; border: 1px solid #ededed; color: #383838; flex: 1 1 0; background: #fff; }
    .fld { padding: 0 16px 12px; }
    .fld .l { font-size: 12.5px; font-weight: 500; color: #7c7c7c; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
    .fld .v { min-height: 46px; border-radius: 12px; background: #f3f3f3; display: flex; align-items: center; gap: 8px; padding: 0 14px; font-size: 15px; color: #171717; }
    .pb { height: 5px; border-radius: 3px; background: #ededed; overflow: hidden; flex-grow: 1; }
    .pb div { height: 5px; border-radius: 3px; background: var(--ac); }
    .cap { font-size: 12.5px; color: #999999; }
    .mut { font-size: 13px; color: #7c7c7c; }
    .pill { position: absolute; height: 20px; padding: 0 7px; border-radius: 6px; background: rgba(23,23,23,.72); color: #fff; font-size: 11px; display: flex; align-items: center; white-space: nowrap; }
    .note { margin: 0 16px; padding: 12px 14px; border-radius: 14px; font-size: 13.5px; line-height: 1.5; }
    .kv { display: flex; justify-content: space-between; gap: 14px; padding: 12px 0; border-bottom: 1px solid #f3f3f3; font-size: 14px; color: #171717; }
    .kv span:first-child { color: #999999; }
    /* module dock: six making modules + "More", which pops the five business modules */
    .mdock { flex: 1 1 0; min-width: 0; height: 56px; border-radius: 28px; background: #f3f3f3; display: flex; align-items: center; gap: 2px; padding: 4px; --cut: #f3f3f3; }
    .mdi { flex: 1 1 0; min-width: 0; height: 48px; border-radius: 24px; display: flex; align-items: center; justify-content: center; gap: 7px; color: #8a8a8a; position: relative; cursor: pointer; }
    .mdi svg { width: 21px; height: 21px; fill: currentColor; flex-shrink: 0; }
    .mdi span { display: none; font-size: 13.5px; font-weight: 500; white-space: nowrap; }
    .mdi.on { flex: 0 0 auto; padding: 0 16px 0 14px; background: #ffffff; color: #171717; box-shadow: 0 1px 3px rgba(23,23,23,0.12); --cut: #ffffff; }
    .mdi.on span { display: block; }
    .mdi i { position: absolute; top: 10px; left: calc(50% + 5px); width: 7px; height: 7px; border-radius: 4px; background: #e03636; box-shadow: 0 0 0 2px #f3f3f3; }
    .mdi.on i { display: none; }
    .mmore { width: 56px; height: 56px; border-radius: 28px; background: #171717; color: #ffffff; --cut: #171717; flex-shrink: 0; display: flex; align-items: center; justify-content: center; position: relative; cursor: pointer; box-shadow: 0 4px 14px rgba(23,23,23,0.22); }
    .mmore svg { width: 23px; height: 23px; fill: currentColor; }
    .mmore svg.x { width: 22px; height: 22px; fill: none; stroke: #ffffff; stroke-width: 2.1; stroke-linecap: round; }
    .mmore i { position: absolute; top: 13px; right: 13px; width: 8px; height: 8px; border-radius: 4px; background: #e03636; box-shadow: 0 0 0 2px #171717; }
    .mpop { position: absolute; right: 12px; bottom: 94px; z-index: 5; width: 266px; background: #ffffff; border-radius: 20px; box-shadow: 0 12px 40px rgba(23,23,23,0.18), 0 2px 8px rgba(23,23,23,0.08); padding: 6px; }
    .mpop:after { content: ''; position: absolute; right: 20px; bottom: -6px; width: 14px; height: 14px; background: #ffffff; transform: rotate(45deg); border-radius: 3px; }
    .mph { font-size: 12px; font-weight: 500; color: #999999; padding: 8px 10px 4px; }
    .mpr { display: flex; align-items: center; gap: 11px; height: 52px; padding: 0 10px; border-radius: 14px; position: relative; z-index: 1; }
    .mpr.on { background: #f5f5f5; }
    .mic { width: 32px; height: 32px; border-radius: 10px; background: #f3f3f3; color: #383838; --cut: #f3f3f3; position: relative; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .mic svg { width: 17px; height: 17px; fill: currentColor; }
    .mpr.on .mic { background: #171717; color: #ffffff; --cut: #171717; }
    .mic .lk { position: absolute; right: -6px; bottom: -6px; width: 17px; height: 17px; border-radius: 9px; background: #ffffff; box-shadow: 0 0 0 1px #ededed; display: flex; align-items: center; justify-content: center; }
    .mic .lk svg { width: 10px; height: 10px; fill: none; stroke: #7c7c7c; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .mnm { font-size: 14.5px; font-weight: 500; color: #171717; white-space: nowrap; }
    .mmt { font-size: 12px; color: #999999; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    [data-scroll], [data-chips] { scrollbar-width: none; } [data-scroll]::-webkit-scrollbar, [data-chips]::-webkit-scrollbar { display: none; }
    .mpr b { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: #e03636; color: #ffffff; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center; }`;

const TABS = {
  chat: ['Chat', '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-2.8-.4L4 21l1.4-4.1A8.2 8.2 0 0 1 3.6 11.5 8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>'],
  files: ['Files', '<path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z"/>'],
  res: ['Research', '<rect x="3.4" y="12.6" width="4.2" height="7.4" rx="1.5"/><rect x="9.9" y="8.4" width="4.2" height="11.6" rx="1.5"/><rect x="16.4" y="4" width="4.2" height="16" rx="1.5"/>'],
  more: ['More', '<circle cx="6.2" cy="6.2" r="2.1"/><circle cx="12" cy="6.2" r="2.1"/><circle cx="17.8" cy="6.2" r="2.1"/><circle cx="6.2" cy="12" r="2.1"/><circle cx="12" cy="12" r="2.1"/><circle cx="17.8" cy="12" r="2.1"/><circle cx="6.2" cy="17.8" r="2.1"/><circle cx="12" cy="17.8" r="2.1"/><circle cx="17.8" cy="17.8" r="2.1"/>'],
};
const I = {
  back: '<path d="m14.5 5.5-7 6.5 7 6.5"/>', search: '<circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/>',
  more: '<circle cx="12" cy="5.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18.5" r="1.4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>', plus: '<path d="M12 5.5v13M5.5 12h13"/>', menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
};
export const icon = (k, style = '') => `<div class="ico"${style ? ` style="${style}"` : ''}><svg viewBox="0 0 24 24">${I[k]}</svg></div>`;

/* ---------- small components ---------- */
const COV = { history: [1, 50, 50], head: [3.3, 57, 24, 'history'], wing: [2.6, 40, 45, 'history'], letters: [2.3, 6, 42, 'history'], robe: [3, 50, 84, 'history'], sea: [3, 38, 62, 'domore'], fire: [3.2, 96, 16, 'domore'], dusk: [2.4, 74, 52, 'domore'], orange: [1, 50, 50], porsche: [1, 50, 50], domore: [1, 50, 50], goodday: [1, 50, 50] };
export const cover = (k, style = '') => { const [z0, x, y, f = k] = COV[k]; const z = Math.min(1.4, z0); return `<div style="overflow: hidden; position: relative; flex-shrink: 0; background: #f3f3f3;${style}"><img src="cover-${f}.jpg" style="width: 100%; height: 100%; object-fit: cover; object-position: ${x}% ${y}%;${z !== 1 ? ` transform: scale(${z}); transform-origin: ${x}% ${y}%;` : ''}"></div>`; };
export const pav = (k, s = 17, extra = '') => `<img class="av" src="${P[k][0]}" style="width: ${s}px; height: ${s}px;${extra}">`;
export const ini = (t, s = 36, bg = '#ededed', fg = '#525252') => `<div style="width: ${s}px; height: ${s}px; border-radius: 50%; background: ${bg}; color: ${fg}; font-size: ${Math.round(s * .36)}px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${t}</div>`;
export const row = ({ lead = '', title, sub = '', trail = '', sep = 'i', style = '' }) => `
      <div class="row"${style ? ` style="${style}"` : ''}>${lead}<div style="min-width: 0; flex-grow: 1;"><div class="nm">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${trail}</div>${sep ? `<div class="rs${sep === 'n' ? ' n' : ''}"></div>` : ''}`;
export const sec = (t, sub = '', link = '') => `<div class="sec"><b>${t}</b>${sub ? `<span>${sub}</span>` : ''}${link ? `<i>${link}</i>` : ''}</div>`;
export const kpis = items => `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 0 16px;">${items.map(([l, v, s = '', c = '']) => `<div class="kp"><i>${l}</i><b${c ? ` style="color: ${c};"` : ''}>${v}</b>${s ? `<span>${s}</span>` : ''}</div>`).join('')}</div>`;
export const bd = (t, tone = 'gray') => `<span class="bd ${tone}">${t}</span>`;
export const dot = c => `<span class="dot" style="background: ${c};"></span>`;
export const pbar = (pct, color = '') => `<div class="pb"><div style="width: ${pct}%;${color ? ` background: ${color};` : ''}"></div></div>`;
export const btns = (p, s) => `<div style="display: flex; gap: 10px; padding: 14px 16px;">${s ? `<div class="bs">${s}</div>` : ''}${p ? `<div class="bp">${p}</div>` : ''}</div>`;
export const fld = (l, v, extra = '') => `<div class="fld"><div class="l">${l}</div><div class="v"${extra ? ` style="${extra}"` : ''}>${v}</div></div>`;
export const chev = '<svg viewBox="0 0 24 24" style="width: 16px; height: 16px; stroke: #c7c7c7; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0;"><path d="m9.5 5.5 6 6.5-6 6.5"/></svg>';
export const tick = (c = '#278f5e') => `<div style="width: 22px; height: 22px; border-radius: 11px; background: ${c}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><svg viewBox="0 0 16 16" style="width: 12px; height: 12px; stroke: #fff; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round;"><path d="M3.6 8.3 6.5 11.2 12.4 5.1"/></svg></div>`;
export const warn = (c = '#f5a524') => `<div style="width: 22px; height: 22px; border-radius: 11px; background: ${c}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><svg viewBox="0 0 16 16" style="width: 12px; height: 12px; stroke: #fff; fill: none; stroke-width: 2.4; stroke-linecap: round;"><path d="M8 4.2v4.6M8 11.4v.2"/></svg></div>`;
export const cbx = on => on ? `<div style="width: 20px; height: 20px; border-radius: 5px; background: #171717; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><svg viewBox="0 0 16 16" style="width: 13px; height: 13px; stroke: #fff; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;"><path d="M3.6 8.3 6.5 11.2 12.4 5.1"/></svg></div>` : '<div style="width: 20px; height: 20px; border-radius: 5px; border: 1.5px solid #999999; flex-shrink: 0;"></div>';

/* ---------- navigation: module dock + launcher ---------- */
/* the same glyphs as the desktop rail; inner cut-lines take the colour of whatever they sit on */
const CUT = 'style="stroke: var(--cut); stroke-width: 1.5; fill: none;"';
export const MI = {
  chat: TABS.chat[1], files: TABS.files[1], res: TABS.res[1],
  script: `<path d="M6.4 3.4h7.4L18.6 8v12.6H6.4z"/><path d="M9.4 12.3h6M9.4 15.6h6" ${CUT}/>`,
  video: '<rect x="3.4" y="5.4" width="12.4" height="13.2" rx="2.1"/><path d="m16.6 13 4.6 2.8V8.2L16.6 11z"/>',
  pub: '<path d="M21.86 4.14a1.1 1.1 0 0 0-1.14-.18L2.9 11.13c-.86.34-.83 1.58.05 1.87l4.46 1.5 1.68 5.06c.24.72 1.15.93 1.68.38l2.4-2.5 4.4 3.23c.6.44 1.46.12 1.63-.6z"/>',
  acc: `<rect x="5.4" y="3.4" width="13.2" height="17.2" rx="2"/><path d="M8.4 8h7.2M8.4 12h7.2M8.4 16h4" ${CUT}/>`,
  fin: `<circle cx="12" cy="12" r="8.6"/><path d="M14.8 9.4c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.9-2.8 2.1 0 2.9 5.7 1.4 5.7 4.3 0 1.2-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-2.9-1.6M12 6.4v1.4M12 16.3v1.4" ${CUT}/>`,
  legal: '<path d="M12 3.2 4.4 6.2v5.6c0 4.4 3.1 8.3 7.6 9.3 4.5-1 7.6-4.9 7.6-9.3V6.2z"/>',
  hr: '<circle cx="12" cy="7.8" r="3.7"/><path d="M4.7 20.2a7.3 7.3 0 0 1 14.6 0z"/>',
  admin: '<path d="M4 7.4h16M4 12h16M4 16.6h16" style="stroke: currentColor; stroke-width: 1.7; fill: none; stroke-linecap: round;"/><circle cx="9" cy="7.4" r="2.2"/><circle cx="15" cy="16.6" r="2.2"/>',
};
/* key, name, one live fact, count waiting on you */
export const MODS = [
  ['chat', 'Chat', '3 unread', 3], ['files', 'Database', '4.2 GB · 18 new'], ['res', 'Research', '9 topics'],
  ['script', 'Script', '2 to approve', 2], ['video', 'Video', '2 rendering'], ['pub', 'Publish', '3 to approve', 3],
  ['acc', 'Accounting', '1 to check', 1], ['fin', 'Finance', 'Q3 · 97% used'], ['legal', 'Legal', '1 to review'],
  ['hr', 'HR', 'Private'], ['admin', 'Admin', '12 people'],
];
const LOCK_SVG = '<span class="lk"><svg viewBox="0 0 24 24"><path d="M6.8 10.5h10.4v8H6.8z"/><path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5"/></svg></span>';
const GRID_SVG = '<rect x="4" y="4" width="7" height="7" rx="2.2"/><rect x="13" y="4" width="7" height="7" rx="2.2"/><rect x="4" y="13" width="7" height="7" rx="2.2"/><rect x="13" y="13" width="7" height="7" rx="2.2"/>';
const MAKE = MODS.slice(0, 6), RUN = MODS.slice(6);

const CASE_SVG = `<path d="M9.2 5h5.6a1.7 1.7 0 0 1 1.7 1.7V8.2" style="fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round;"/><path d="M7.5 8.2V6.7A1.7 1.7 0 0 1 9.2 5" style="fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round;"/><rect x="3.3" y="8.2" width="17.4" height="11.6" rx="2.6"/><path d="M3.3 13.2h17.4" ${CUT}/><rect x="10.6" y="12" width="2.8" height="2.4" rx=".6" style="fill: var(--cut);"/>`;
const dockKeys = mod => MAKE.map(m => m[0]).concat(RUN.some(m => m[0] === mod) ? [mod] : []);

/* the dock: icons only, the pressed one grows into a pill with its name.
   A business module you are in sits at the end of the bar; "More" is the separate black button. */
export function dock(mod) {
  const cur = RUN.find(m => m[0] === mod);
  const item = ([k, name, , badge]) => `<div class="mdi{{dc_${k}}}" data-mod="${k}" onClick="{{ dk_${k} }}"><svg viewBox="0 0 24 24">${MI[k]}</svg><span>${name}</span>${badge && k !== mod ? '<i></i>' : ''}</div>`;
  return `<div class="mdock">${MAKE.concat(cur ? [cur] : []).map(item).join('')}</div>` +
    `<div class="mmore" onClick="{{ toggleNav }}" title="More"><sc-if value="{{navClosed}}" hint-placeholder-val="{{ true }}"><svg viewBox="0 0 24 24">${CASE_SVG}</svg>${RUN.some(m => m[3]) ? '<i></i>' : ''}</sc-if><sc-if value="{{navOpen}}" hint-placeholder-val="{{ false }}"><svg class="x" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg></sc-if></div>`;
}
/* logic fields for the dock: which item is pressed (defaults to the current module) */
export const dockLogic = mod => `...(function (c, d) { var dk = (c.state || {}).dock || d, o = {}; ${JSON.stringify(dockKeys(mod))}.forEach(function (k) { o['dc_' + k] = dk === k ? ' on' : ''; o['dk_' + k] = function () { c.setState({ dock: k }); }; }); return o; })(this, '${mod}'),`;

/* "More" pops a small card with the business modules and what is waiting in each */
export function launcher(mod) {
  const row = ([k, n, meta, badge]) => `<div class="mpr${k === mod ? ' on' : ''}" data-mod="${k}"><div class="mic"><svg viewBox="0 0 24 24">${MI[k]}</svg>${k === 'hr' ? LOCK_SVG : ''}</div><div style="min-width: 0;"><div class="mnm">${n}</div><div class="mmt">${meta}</div></div>${badge ? `<b>${badge}</b>` : ''}</div>`;
  return `
  <sc-if value="{{navOpen}}" hint-placeholder-val="{{ false }}">
  <div style="position: absolute; inset: 0 0 82px 0; background: rgba(23,23,23,0.14); z-index: 4;" onClick="{{ closeNav }}"></div>
  <div class="mpop"><div class="mph">Run the business</div>${RUN.map(row).join('')}</div>
  </sc-if>`;
}

/* ---------- page ---------- */
const SCRIPT_LOGIC = `
<script data-dc-script data-props='{"accent":{"editor":"color","default":"#007BE0","options":["#007BE0","#171717","#278F5E","#6846E3"],"section":"Theme"},"$preview":{"width":390,"height":844}}'>
class Component extends DCLogic {
  renderVals() { var raw = this.props.accent || '#007BE0'; return { accent: /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#007BE0' }; }
}
</${'script'}>`;
function bareDoc({ module, gen, title, body, extraCss }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<!-- hand-authored phone: ${module} · ${title}. Rebuild with ${gen} -->
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600&family=Noto+Sans+HK:wght@400;500&display=swap">
  <style>${PCSS}${extraCss}</style>
</helmet>
<div style="--ac: {{accent}}; width: 390px; height: 844px; display: flex; flex-direction: column; background: #ffffff; color: #171717; overflow: hidden; position: relative;">
${body}
</div>
</x-dc>${SCRIPT_LOGIC}
</body>
</html>
`;
}

export function phonePage({ module, gen, title, crumb, heading, sub = '', right = '', chips = [], chipOn = 0, body, ask, sheet, me = 'chan', headerIcons = ['search', 'more'], back = true, extraCss = '', bare = false, nav = 'closed', overlay = '', logic = '' }) {
  if (bare) return bareDoc({ module, gen, title, body, extraCss });
  const s = sheet;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<!-- hand-authored phone: ${module} · ${title}. Rebuild with ${gen} -->
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600&family=Noto+Sans+HK:wght@400;500&display=swap">
  <style>${PCSS}${extraCss}</style>
</helmet>

<div style="--ac: {{accent}}; width: 390px; height: 844px; display: flex; flex-direction: column; background: #ffffff; color: #171717; overflow: hidden; position: relative;">

  <div style="flex-shrink: 0; background: #ffffff;">
    <div style="height: 56px; display: flex; align-items: center; padding: 0 6px 0 4px;">
      ${back ? icon('back') : icon('menu')}
      <div style="min-width: 0; flex-grow: 1;"><div style="font-size: 12px; color: #999999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${crumb}</div></div>
      ${headerIcons.map(k => icon(k)).join('\n      ')}
    </div>
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 0 16px 14px;">
      <div style="min-width: 0;">
        <div style="font-size: 26px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${heading}</div>
        ${sub ? `<div style="font-size: 13px; color: #999999; margin-top: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${sub}</div>` : ''}
      </div>${right}
    </div>
${chips.length ? `    <div data-chips style="display: flex; gap: 8px; padding: 0 16px 14px; overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; position: relative;">${chips.map((c, i) => `<div class="chip${i === chipOn ? ' on' : ''}">${c}</div>`).join('')}</div>\n` : ''}    <div style="height: 1px; background: #ededed;"></div>
  </div>

  <div data-scroll style="flex-grow: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; position: relative;">
${body}
  </div>

  <sc-if value="{{sheetOpen}}" hint-placeholder-val="{{ false }}">
  <div style="position: absolute; inset: 0 0 76px 0; background: rgba(23,23,23,0.28); z-index: 1;" onClick="{{ closeSheet }}"></div>
  <div style="position: absolute; left: 0; right: 0; bottom: 76px; z-index: 2; height: 500px; background: #ffffff; border-radius: 22px 22px 0 0; box-shadow: 0 -8px 32px rgba(23,23,23,0.16); display: flex; flex-direction: column;">
    <div style="flex-shrink: 0; padding: 8px 0 0; display: flex; justify-content: center;"><div style="width: 38px; height: 4px; border-radius: 2px; background: #e2e2e2;"></div></div>
    <div style="flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 10px 16px 12px;">
      <div style="width: 30px; height: 30px; border-radius: 9px; background: #171717; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><svg viewBox="0 0 24 24" style="width: 16px; height: 16px; stroke: #ffffff; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 4.2 19 8v8l-7 3.8L5 16V8z"/><path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8"/></svg></div>
      <div style="min-width: 0; flex-grow: 1;"><div style="font-size: 15px; font-weight: 500;">Agent</div><div style="font-size: 12px; color: #999999; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${s.scope}</div></div>
      <div class="ico" style="width: 36px; height: 36px;" onClick="{{ closeSheet }}"><svg viewBox="0 0 24 24">${I.close}</svg></div>
    </div>
    <div style="flex-shrink: 0; display: flex; gap: 8px; padding: 0 16px 14px; overflow: hidden;">${(s.chips || []).map(c => `<div class="chip">${c}</div>`).join('')}</div>
    <div style="flex-grow: 1; min-height: 0; padding: 0 16px; overflow: hidden;">
      <div style="display: flex; justify-content: flex-end; margin-bottom: 14px;"><div style="max-width: 280px; background: #f3f3f3; border-radius: 14px; padding: 10px 13px; font-size: 15px; line-height: 1.5; color: #383838;">${s.q}</div></div>
      <div style="display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 11px; border: 1px solid #ededed; border-radius: 9px; background: #f8f8f8; margin-bottom: 12px;"><svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #278f5e; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round;"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg><span style="font-size: 12.5px; color: #525252;">${s.tool}</span></div>
      <div style="font-size: 15px; line-height: 1.55; color: #383838; text-wrap: pretty;">${s.a}</div>
      <div style="display: flex; gap: 10px; margin-top: 16px;"><div class="bp" style="height: 44px; font-size: 14px;">${s.act}</div><div class="bs" style="height: 44px; font-size: 14px;">Not now</div></div>
    </div>
    <div style="flex-shrink: 0; padding: 12px 16px 14px;">
      <div style="border: 1px solid #e2e2e2; border-radius: 14px; background: #ffffff; padding: 11px 12px 9px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
        <div style="font-size: 15px; color: #999999;">${ask}</div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 13px;"><span style="font-size: 11.5px; color: #999999;">${s.guard || 'Uses only what you can see'}</span><div style="width: 40px; height: 40px; border-radius: 12px; background: {{accent}}; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" style="width: 18px; height: 18px; stroke: #ffffff; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 19V5.5M6 11.5 12 5.5l6 6"/></svg></div></div>
      </div>
    </div>
  </div>
  </sc-if>

  <div style="flex-shrink: 0; padding: 10px 12px 0; background: #ffffff; position: relative; z-index: 3;">
    <div style="height: 54px; border-radius: 27px; background: #f3f3f3; display: flex; align-items: center; padding: 0 7px 0 20px; gap: 10px;" onClick="{{ openSheet }}">
      <span style="font-size: 15.5px; color: #7c7c7c; flex-grow: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ask}</span>
      <div style="width: 40px; height: 40px; border-radius: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><svg viewBox="0 0 24 24" style="width: 21px; height: 21px; fill: #171717;"><rect x="9.1" y="2.6" width="5.8" height="11.4" rx="2.9"/><path d="M5.6 11.2a.95.95 0 0 1 1.9 0 4.5 4.5 0 0 0 9 0 .95.95 0 0 1 1.9 0 6.4 6.4 0 0 1-5.45 6.33v2.62a.95.95 0 0 1-1.9 0v-2.62A6.4 6.4 0 0 1 5.6 11.2z"/></svg></div>
    </div>
    <div style="display: flex; align-items: center; gap: 12px; margin-top: 10px;">
      ${dock(module)}
    </div>
    <div style="height: 26px;"></div>
  </div>
${launcher(module, title)}${overlay}
</div>
</x-dc>
<script data-dc-script data-props='{"accent":{"editor":"color","default":"#007BE0","options":["#007BE0","#171717","#278F5E","#6846E3"],"section":"Theme"},"agent":{"editor":"enum","options":["closed","open"],"default":"closed","section":"View"},"nav":{"editor":"enum","options":["closed","open"],"default":"${nav}","section":"View"},"$preview":{"width":390,"height":844}}'>
class Component extends DCLogic {
  constructor(props) { super(props); this.state = {}; }
  /* every chip stays in the row; the row slides so the current one is in view */
  componentDidMount() { try { var c = document.querySelector('[data-chips] .chip.on'); if (c && c.parentNode.scrollWidth > c.parentNode.clientWidth) c.parentNode.scrollLeft = Math.max(0, c.offsetLeft - 16); } catch (e) {} }
  renderVals() {
    var raw = this.props.accent || '#007BE0', self = this;
    var agent = this.state.agent || this.props.agent || 'closed';
    var nav = this.state.nav || this.props.nav || 'closed';
    return {
      ${dockLogic(module)}${logic}
      accent: /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#007BE0',
      sheetOpen: agent === 'open' && nav !== 'open',
      openSheet: function () { self.setState({ agent: 'open', nav: 'closed' }); },
      closeSheet: function () { self.setState({ agent: 'closed' }); },
      navOpen: nav === 'open',
      navClosed: nav !== 'open',
      toggleNav: function () { self.setState({ nav: nav === 'open' ? 'closed' : 'open', agent: 'closed' }); },
      openNav: function () { self.setState({ nav: 'open', agent: 'closed' }); },
      closeNav: function () { self.setState({ nav: 'closed' }); }
    };
  }
}
</${'script'}>
</body>
</html>
`;
}
