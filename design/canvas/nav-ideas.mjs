/**
 * Phone navbar ideas, side by side on one canvas row, so one can be picked.
 * Each is the Script library phone with a different bottom navigation.
 * Writes Nav-Idea-*.dc.html + phones-nav.json. Run after phone-screens-a.mjs.
 */
import fs from 'fs';
import path from 'path';
import { dock, MI, MODS } from './phone-shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const base = fs.readFileSync(path.join(DIR, 'Script-Library-Phone.dc.html'), 'utf8');
const ORIG = dock('script');
if (!base.includes(ORIG)) throw new Error('dock markup not found in Script-Library-Phone.dc.html');

const out = [];
const ic = (k, s = 20, c = 'currentColor') => `<svg viewBox="0 0 24 24" style="width: ${s}px; height: ${s}px; fill: ${c}; flex-shrink: 0;">${MI[k]}</svg>`;
const stroke = (d, s = 20) => `<svg viewBox="0 0 24 24" style="width: ${s}px; height: ${s}px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0;">${d}</svg>`;
const X = '<path d="M7 7l10 10M17 7 7 17"/>';
const SEARCH = '<circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/>';
const SPARK = '<rect x="3.2" y="10" width="1.9" height="4" rx=".95"/><rect x="6.9" y="7.4" width="1.9" height="9.2" rx=".95"/><rect x="10.6" y="4.6" width="1.9" height="14.8" rx=".95"/><rect x="14.3" y="8.2" width="1.9" height="7.6" rx=".95"/><path d="m19.6 3.6.86 2.18 2.18.86-2.18.86-.86 2.18-.86-2.18L16.56 6.64l2.18-.86z"/>';

function make(file, title, { css = '', row, overlay = '', hideAsk = false }) {
  let src = base.replace(ORIG, row).replace('</style>', css + '\n  </style>');
  if (overlay) { const x = src.indexOf('</x-dc>'), rc = src.lastIndexOf('</div>', x); src = src.slice(0, rc) + overlay + '\n' + src.slice(rc); }
  if (hideAsk) src = src.replace('<div style="height: 54px; border-radius: 27px; background: #f3f3f3;', '<div style="visibility: hidden; height: 54px; border-radius: 27px; background: #f3f3f3;');
  src = src.replace(/hand-authored phone: [^-]*-->/, `hand-authored phone: navbar idea · ${title}. Rebuild with nav-ideas.mjs -->`);
  fs.writeFileSync(path.join(DIR, file), src);
  out.push({ file, mod: 'nav', title });
}

/* A · what is built now: icon bar, pressed one named, black briefcase for the business modules */
make('Nav-Idea-A-Phone.dc.html', 'A · Bar + briefcase (current)', { row: ORIG });

/* B · Fan: one black button; pressing it fans all 11 modules out in two arcs */
{
  /* 4 on the inner ring, 7 on the outer, both inside 145°..35° so nothing leaves the screen or touches */
  const cx = 195, cy = 844 - 26 - 28, inner = MODS.slice(0, 4), outer = MODS.slice(4);
  const place = (list, r, a0, a1) => list.map((m, i) => { const a = (a0 + (a1 - a0) * i / (list.length - 1)) * Math.PI / 180; return [m, cx + r * Math.cos(a), cy - r * Math.sin(a)]; });
  const bubble = ([[k, name, , badge], x, y]) => `<div style="position: absolute; left: ${Math.round(x - 25)}px; top: ${Math.round(y - 25)}px; width: 50px; display: flex; flex-direction: column; align-items: center; gap: 5px;"><div style="width: 50px; height: 50px; border-radius: 25px; background: ${k === 'script' ? '#171717' : '#ffffff'}; color: ${k === 'script' ? '#ffffff' : '#383838'}; --cut: ${k === 'script' ? '#171717' : '#ffffff'}; box-shadow: 0 4px 14px rgba(23,23,23,0.12), 0 0 0 1px rgba(23,23,23,0.04); display: flex; align-items: center; justify-content: center; position: relative;">${ic(k, 21)}${badge ? `<b style="position: absolute; top: -3px; right: -3px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: #e03636; color: #fff; font-size: 10.5px; font-weight: 600; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 2px #fff;">${badge}</b>` : ''}</div><span style="font-size: 11px; font-weight: 500; color: #383838; white-space: nowrap;">${name}</span></div>`;
  make('Nav-Idea-B-Phone.dc.html', 'B · Fan out', {
    hideAsk: true,
    row: `<div style="flex: 1 1 0; height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 22px;"><div style="color: #8a8a8a; --cut: #fff;">${ic('chat', 23)}</div><div style="color: #8a8a8a; --cut: #fff;">${ic('files', 23)}</div><div style="width: 56px;"></div><div style="color: #8a8a8a;">${stroke(SEARCH, 23)}</div><div style="color: #8a8a8a;">${stroke('<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>', 23)}</div></div>`,
    overlay: `
  <div style="position: absolute; inset: 0; z-index: 4; background: linear-gradient(to top, rgba(255,255,255,0.98) 30%, rgba(255,255,255,0.80) 70%, rgba(255,255,255,0.55));"></div>
  <div style="position: absolute; inset: 0; z-index: 5;">
    ${place(inner, 112, 145, 35).map(bubble).join('')}
    ${place(outer, 204, 145, 35).map(bubble).join('')}
    <div style="position: absolute; left: ${cx - 28}px; top: ${cy - 28}px; width: 56px; height: 56px; border-radius: 28px; background: #171717; color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 18px rgba(23,23,23,0.28);"><svg viewBox="0 0 24 24" style="width: 22px; height: 22px; fill: none; stroke: #fff; stroke-width: 2.1; stroke-linecap: round;">${X}</svg></div>
    <div style="position: absolute; left: 0; right: 0; top: ${cy - 290}px; text-align: center; font-size: 13px; color: #999999;">Pick a module</div>
  </div>` });
}

/* C · Module + screens: the black square is the module you are in; the bar holds that module's screens */
{
  const SUBS = [['Library', '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>'],
    ['Brief', '<path d="M7 3.8h7.5L18.5 8v12.2H7z"/><path d="M9.8 12h5.4M9.8 15.5h5.4"/>'],
    ['Draft', '<path d="M4.5 19.5 5.3 16 15.8 5.5a2 2 0 0 1 2.8 2.8L8 18.7z"/><path d="m14 7.3 2.8 2.8"/>'],
    ['Versions', '<circle cx="12" cy="12" r="8"/><path d="M12 7.6V12l3 2"/>'],
    ['Approval', '<circle cx="12" cy="12" r="8"/><path d="m8.4 12.3 2.4 2.4 4.8-5"/>']];
  make('Nav-Idea-C-Phone.dc.html', 'C · Module + its screens', {
    css: `    .cbar { flex: 1 1 0; min-width: 0; height: 56px; border-radius: 28px; background: #f3f3f3; display: flex; align-items: center; gap: 2px; padding: 4px; }
    .cti { flex: 1 1 0; min-width: 0; height: 48px; border-radius: 24px; display: flex; align-items: center; justify-content: center; gap: 7px; color: #8a8a8a; }
    .cti.on { flex: 0 0 auto; padding: 0 16px 0 14px; background: #fff; color: #171717; box-shadow: 0 1px 3px rgba(23,23,23,0.12); }
    .cti span { display: none; font-size: 13.5px; font-weight: 500; } .cti.on span { display: block; }`,
    row: `<div style="width: 56px; height: 56px; border-radius: 18px; background: #171717; color: #fff; --cut: #171717; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; flex-shrink: 0; box-shadow: 0 4px 14px rgba(23,23,23,0.22);">${ic('script', 21, '#fff')}<svg viewBox="0 0 24 24" style="width: 11px; height: 11px; fill: none; stroke: #999; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round;"><path d="m7 14.5 5-5 5 5"/></svg></div><div class="cbar">${SUBS.map(([n, d], i) => `<div class="cti${i === 0 ? ' on' : ''}">${stroke(d, 21)}<span>${n}</span></div>`).join('')}</div>` });
}

/* D · App grid: a pop-up of soft tinted module tiles, like a home screen */
{
  const TINT = { chat: ['#e6f2fd', '#007be0'], files: ['#e3f5fb', '#1283b8'], res: ['#efeafd', '#6846e3'], script: ['#fff4e0', '#c77700'], video: ['#fde8ef', '#d6336c'], pub: ['#e4f7ec', '#278f5e'],
    acc: ['#e2f6f4', '#0f8a80'], fin: ['#eef7e0', '#5b8c12'], legal: ['#eceff3', '#4a5a6d'], hr: ['#fdebe6', '#c4512d'], admin: ['#f0f0f0', '#525252'] };
  const tile = ([k, name, , badge]) => `<div style="display: flex; flex-direction: column; align-items: center; gap: 7px; min-width: 0;"><div style="width: 60px; height: 60px; border-radius: 18px; background: ${TINT[k][0]}; color: ${TINT[k][1]}; --cut: ${TINT[k][0]}; display: flex; align-items: center; justify-content: center; position: relative;${k === 'script' ? ' box-shadow: 0 0 0 2px #fff, 0 0 0 4px #171717;' : ''}">${ic(k, 26)}${badge ? `<b style="position: absolute; top: -5px; right: -5px; min-width: 19px; height: 19px; padding: 0 5px; border-radius: 10px; background: #e03636; color: #fff; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 2px #fff;">${badge}</b>` : ''}</div><span style="font-size: 12px; font-weight: 500; color: #383838; white-space: nowrap;">${name}</span></div>`;
  make('Nav-Idea-D-Phone.dc.html', 'D · App grid', {
    row: `<div style="flex: 1 1 0; height: 56px; border-radius: 28px; background: #f3f3f3; display: flex; align-items: center; justify-content: space-around; padding: 0 10px; color: #8a8a8a; --cut: #f3f3f3;">${ic('chat', 22)}${stroke(SEARCH, 22)}<div style="width: 44px; height: 44px; border-radius: 22px; background: #171717; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" style="width: 21px; height: 21px; fill: #fff;">${SPARK}</svg></div>${ic('files', 22)}<div style="width: 44px; height: 44px; border-radius: 22px; background: #ffffff; color: #171717; box-shadow: 0 1px 3px rgba(23,23,23,0.12); display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: #171717;"><rect x="4" y="4" width="7" height="7" rx="2.2"/><rect x="13" y="4" width="7" height="7" rx="2.2"/><rect x="4" y="13" width="7" height="7" rx="2.2"/><rect x="13" y="13" width="7" height="7" rx="2.2"/></svg></div></div>`,
    overlay: `
  <div style="position: absolute; inset: 0 0 82px 0; z-index: 4; background: rgba(23,23,23,0.18);"></div>
  <div style="position: absolute; left: 12px; right: 12px; bottom: 94px; z-index: 5; background: #ffffff; border-radius: 28px; padding: 18px 16px 20px; box-shadow: 0 16px 44px rgba(23,23,23,0.2);">
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 0 4px 16px;"><span style="font-size: 17px; font-weight: 500;">Modules</span><span style="font-size: 12.5px; color: #999999;">5 things wait on you</span></div>
    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: 18px;">${MODS.map(tile).join('')}</div>
  </div>` });
}

/* E · Island: one dark pill you swipe between modules; dots show where you are */
{
  const i = MODS.findIndex(m => m[0] === 'script');
  make('Nav-Idea-E-Phone.dc.html', 'E · Swipe island', {
    row: `<div style="flex: 1 1 0; display: flex; flex-direction: column; align-items: center; gap: 9px;">
        <div style="display: flex; gap: 5px; align-items: center;">${MODS.map((m, j) => `<span style="height: 6px; width: ${j === i ? 18 : 6}px; border-radius: 3px; background: ${j === i ? '#171717' : '#d4d4d4'};"></span>`).join('')}</div>
        <div style="display: flex; align-items: center; gap: 14px; width: 100%;">
          <div style="width: 48px; height: 48px; border-radius: 24px; background: #f3f3f3; color: #b0b0b0; --cut: #f3f3f3; display: flex; align-items: center; justify-content: center;">${ic('res', 21)}</div>
          <div style="flex: 1 1 0; height: 56px; border-radius: 28px; background: #171717; color: #ffffff; --cut: #171717; display: flex; align-items: center; gap: 10px; padding: 0 8px 0 18px; box-shadow: 0 6px 18px rgba(23,23,23,0.24);">${ic('script', 21, '#fff')}<div style="min-width: 0; flex-grow: 1;"><div style="font-size: 14.5px; font-weight: 500;">Script</div><div style="font-size: 11.5px; color: #a3a3a3; margin-top: 1px; white-space: nowrap;">2 to approve</div></div><div style="height: 30px; padding: 0 11px; border-radius: 15px; background: #2e2e2e; font-size: 12px; display: flex; align-items: center; gap: 5px;"><svg viewBox="0 0 24 24" style="width: 12px; height: 12px; fill: none; stroke: #fff; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round;"><path d="m7 14.5 5-5 5 5"/></svg>All</div></div>
          <div style="width: 48px; height: 48px; border-radius: 24px; background: #f3f3f3; color: #b0b0b0; --cut: #f3f3f3; display: flex; align-items: center; justify-content: center;">${ic('video', 21)}</div>
        </div>
      </div>` });
}

fs.writeFileSync(path.join(DIR, 'phones-nav.json'), JSON.stringify(out, null, 1));
console.log('wrote', out.length, 'navbar ideas');
