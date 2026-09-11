/**
 * Video Edit, hand-authored screens.
 *
 *   Video-Library   every project (one per locked script), grid ⇄ list
 *   Video-Project   one project · Shots tab   (§4.5 locked script left,
 *                   shot cards right; sidebar shown collapsed here)
 *   Video-Bin       one project · Media tab   (filters, assign, remove → bin)
 *   Video-Queue     one project · Renders tab (pixel render floor + queue)
 *   Video-Preview   one project · Preview tab (all cuts, aspect switch, compare)
 *   Video-Audio     one project · Audio tab   (voice, takes, music, ducking)
 *   Video-Export    one project · Export tab  (formats, extras, archive)
 *
 * Run:  node video-screens.mjs
 */
import fs from 'fs';
import path from 'path';
import { page as shellPage, P, av, ICON, px, pxg, SPRITE, collapsible, toggleBtn, rightPanel, agentBlock, cb, okDot, warnDot, failDot, CHEV, SIMPLE, SPARK } from './shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);

const CSS = `
    .crop { background-repeat: no-repeat; background-color: #f3f3f3; }
    .bd.vio { background: #f3f0ff; color: #6846e3; }
    .costc { display: flex; align-items: center; gap: 7px; height: 28px; padding: 0 10px; border: 1px solid #ededed; border-radius: 8px; font-size: 12px; color: #383838; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .costc .m { width: 40px; height: 4px; border-radius: 2px; background: #ededed; }
    .costc .m div { height: 4px; border-radius: 2px; background: var(--ac); }
    .sth { position: relative; aspect-ratio: 16 / 9; border-radius: 9px; overflow: hidden; }
    .pill { position: absolute; height: 18px; padding: 0 6px; border-radius: 5px; background: rgba(255,255,255,.94); font-size: 10.5px; font-weight: 500; color: #171717; display: flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pill.dk { background: rgba(23,23,23,.72); color: #fff; }
    .stt { font-size: 12.5px; font-weight: 500; margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .srow { display: flex; align-items: center; gap: 6px; margin-top: 5px; min-width: 0; }
    .srow .st { margin-left: auto; display: flex; align-items: center; gap: 5px; font-size: 11px; color: #7c7c7c; white-space: nowrap; }
    .beat { display: flex; gap: 10px; padding: 8px 10px; border-radius: 8px; }
    .beat.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
    .beat .bnum { font-size: 10.5px; color: #999999; font-weight: 500; width: 36px; flex-shrink: 0; font-variant-numeric: tabular-nums; line-height: 1.5; }
    .beat .bnum b { display: block; font-weight: 500; color: #c7c7c7; }
    .beat .x { font-size: 12px; line-height: 1.45; color: #383838; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-width: 0; flex-grow: 1; }
    .seg2 { height: 34px; border-radius: 5px; position: relative; overflow: hidden; min-width: 0; display: flex; align-items: flex-end; padding: 0 0 3px 5px; font-size: 10px; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.4); }
    .qh { display: flex; align-items: center; gap: 8px; margin: 12px 0 2px; font-size: 11px; font-weight: 500; color: #7c7c7c; }
    .qh b { font-weight: 500; color: #c7c7c7; }
    .qr { display: grid; grid-template-columns: 26px minmax(0, 1fr) 92px 128px 46px 150px 74px; align-items: center; height: 40px; border-bottom: 1px solid #f3f3f3; font-size: 12.5px; color: #383838; }
    .qr > * { padding: 0 7px; min-width: 0; display: flex; align-items: center; gap: 7px; }
    .qr .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
    .qr .num { justify-content: flex-end; font-variant-numeric: tabular-nums; }
    .pos { width: 18px; height: 18px; border-radius: 5px; background: #f3f3f3; color: #525252; font-size: 10.5px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
    .pbar { height: 4px; border-radius: 2px; background: #ededed; flex-grow: 1; position: relative; overflow: hidden; }
    .pbar div { height: 4px; border-radius: 2px; background: var(--ac); }
    .floor { background-color: #fcfcfc; background-image: linear-gradient(45deg, #f5f5f5 25%, transparent 25%, transparent 75%, #f5f5f5 75%), linear-gradient(45deg, #f5f5f5 25%, transparent 25%, transparent 75%, #f5f5f5 75%); background-size: 12px 12px; background-position: 0 0, 6px 6px; }
    .lbl2 { font-size: 12px; font-weight: 500; color: #171717; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lbl3 { font-size: 11px; color: #999999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
    .ctile { min-width: 0; }
    .cth { position: relative; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; }
    .cn { font-size: 12px; color: #171717; margin-top: 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hov { position: absolute; inset: 0; background: rgba(23,23,23,.42); display: flex; align-items: center; justify-content: center; gap: 6px; }
    .hb { width: 28px; height: 28px; border-radius: 8px; background: rgba(255,255,255,.95); display: flex; align-items: center; justify-content: center; }
    .hb svg { width: 14px; height: 14px; stroke: #171717; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .slot { flex: 1 1 0; min-width: 0; }
    .slot .sb { height: 44px; border-radius: 7px; position: relative; overflow: hidden; background: #f5f5f5; display: flex; align-items: center; justify-content: center; }
    .slot .sl { font-size: 10.5px; color: #999999; margin-top: 5px; text-align: center; font-variant-numeric: tabular-nums; }
    .lane { position: relative; height: 40px; border-radius: 7px; background: #fafafa; overflow: hidden; }
    .tk { display: flex; align-items: center; gap: 9px; height: 34px; padding: 0 9px; border-radius: 8px; font-size: 12px; color: #383838; }
    .tk.on { background: #f8f8f8; }
    .play { width: 24px; height: 24px; border-radius: 12px; background: #fff; border: 1px solid #e2e2e2; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .play svg { width: 10px; height: 10px; fill: #171717; }
    .aspb { height: 26px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
    .cut { flex-shrink: 0; cursor: pointer; }
    .cut .cb2 { height: 68px; display: flex; align-items: flex-end; }
    .cut .ci { border-radius: 6px; overflow: hidden; position: relative; }

    /* pixel render floor */
    @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
    @keyframes steam { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(-4px); opacity: 0; } }
    @keyframes smoke { 0% { transform: translate(0, 0); opacity: .9; } 100% { transform: translate(2px, -6px); opacity: 0; } }
    @keyframes zz { 0% { transform: translate(0, 0); opacity: 0; } 30% { opacity: 1; } 100% { transform: translate(3px, -5px); opacity: 0; } }
    @keyframes belt { 0% { transform: translateX(0); } 100% { transform: translateX(14px); } }
    @keyframes roll { to { stroke-dashoffset: -4; } }
    @keyframes type { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(1px); } }
    .bob { animation: bob .9s steps(1, end) infinite; }
    .type { animation: type .3s steps(1, end) infinite; }
    .type2 { animation: type .3s steps(1, end) infinite .15s; }
    .blink { animation: blink 1s steps(1, end) infinite; }
    .steam { animation: steam 1.6s steps(4) infinite; }
    .smoke { animation: smoke 1.8s steps(6) infinite; }
    .smoke2 { animation: smoke 1.8s steps(6) infinite .9s; }
    .zz { animation: zz 2.4s steps(6) infinite; }
    .zz2 { animation: zz 2.4s steps(6) infinite 1.2s; }
    .belt { animation: belt 2.8s steps(14) infinite; }
    .roll { animation: roll .5s steps(2) infinite; }`;

/* ---------- imagery: crops of the covers we have ---------- */
const CROP = {
  H_FULL: ['history', 'cover', 50, 50], H_HEAD: ['history', 330, 57, 24], H_WING: ['history', 260, 40, 45], H_LETTERS: ['history', 230, 6, 42],
  H_ROBE: ['history', 300, 50, 84], H_TEX: ['history', 420, 94, 92], D_SEA: ['domore', 300, 38, 62], D_FIRE: ['domore', 320, 96, 16],
  D_DUSK: ['domore', 240, 74, 52], G_POST: ['goodday', 'cover', 50, 50], orange: ['orange', 'cover', 50, 50], porsche: ['porsche', 'cover', 50, 50],
  domore: ['domore', 'cover', 50, 50], goodday: ['goodday', 'cover', 50, 50], history: ['history', 'cover', 50, 50],
};
/* zoom stays gentle (max 1.4x): anything more blows a small part of the image up and it goes soft */
const crop = (k, style = '') => { const [f, s, x, y] = CROP[k]; const z = s === 'cover' ? 1 : Math.min(1.4, +(s / 100).toFixed(2)); return `<div class="crop" style="overflow: hidden;${style}"><img src="cover-${f}.jpg" style="width: 100%; height: 100%; object-fit: cover; object-position: ${x}% ${y}%;${z !== 1 ? ` transform: scale(${z}); transform-origin: ${x}% ${y}%;` : ''}"></div>`; };

/* ---------- projects ---------- */
const VST = { render: ['Rendering', 'blue', '#007be0'], review: ['In review', 'amb', '#db7706'], hold: ['On hold', 'gray', '#999999'], wait: ['Waiting for script', 'gray', '#c7c7c7'], done: ['Exported', 'grn', '#278f5e'] };
const PROJ = [
  { id: 'grc', no: '003', t: 'History of Greece · Ep 75', st: 'render', cov: 'history', o: 'chan', dur: '3:48', sh: [6, 9], cost: 'HK$412.80', ch: 'YouTube · 16:9', ed: 'Rendering now', note: '2 jobs rendering' },
  { id: 'org', no: '006', t: 'Orange typography cut', st: 'review', cov: 'orange', o: 'leung', dur: '0:15', sh: [4, 4], cost: 'HK$38.20', ch: 'X · 1:1', ed: '2 h ago', note: 'Waiting on Michelle' },
  { id: 'gdy', no: '005', t: 'Good day · collage teaser', st: 'hold', cov: 'goodday', o: 'amy', dur: '0:20', sh: [5, 6], cost: 'HK$64.00', ch: 'Instagram · 9:16', ed: 'Yesterday', note: 'Script v2 needs re-approval' },
  { id: 'ssp', no: '004', t: 'Sham Shui Po dai pai dong revival', st: 'wait', cov: null, o: 'amy', dur: '3:45', sh: [0, 6], cost: 'HK$0.00', ch: 'YouTube · 16:9', ed: 'Not started', note: 'Opens when v4 is locked' },
  { id: 'prs', no: '002', t: 'Porsche cat · night drive', st: 'done', cov: 'porsche', o: 'chan', dur: '0:30', sh: [3, 3], cost: 'HK$96.40', ch: 'Instagram · 9:16', ed: '2 Sep', note: '3 formats archived' },
  { id: 'dmo', no: '001', t: 'Do more · brand spot', st: 'done', cov: 'domore', o: 'michelle', dur: '0:45', sh: [5, 5], cost: 'HK$120.10', ch: 'Instagram · 9:16', ed: '31 Aug', note: 'Published 1 Sep' },
];
const PD = Object.fromEntries(PROJ.map(p => [p.id, p]));
const vbadge = st => `<span class="bd ${VST[st][1]}">${VST[st][0]}</span>`;
const thumbSmall = (p, w, h) => p.cov
  ? crop(p.cov, ` width: ${w}px; height: ${h}px; border-radius: 4px; flex-shrink: 0;`)
  : `<div style="width: ${w}px; height: ${h}px; border-radius: 4px; background: #f3f3f3; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${ICON.clap(1)}</div>`;

/* ---------- shots of project 003 ---------- */
const SHOTS = [
  ['01', 'Aegean map, slow push', 'Generated', 'D_SEA', 'ready', '0:24', 24],
  ['02', 'Marble relief of rowers', 'Existing footage', null, 'need', '0:26', 26],
  ['03', 'Strait at dusk, drone', 'Generated', 'D_DUSK', 'run', '0:31', 31],
  ['04', 'Fire across the strait', 'Generated', 'D_FIRE', 'ready', '0:36', 36],
  ['05', 'Winged Victory, tilt up', 'Still', 'H_HEAD', 'ready', '0:28', 28],
  ['06', 'Wing detail, macro', 'B-roll', 'H_WING', 'ready', '0:22', 22],
  ['07', 'Salamis aftermath', 'Generated', null, 'fail', '0:33', 33],
  ['08', 'Title card', 'Still', 'H_LETTERS', 'ready', '0:10', 10],
  ['09', 'End card, subscribe', 'Still', 'H_FULL', 'ready', '0:18', 18],
];
const SHOT_ST = { ready: ['Ready', '#278f5e'], need: ['No clip', '#db7706'], run: ['Rendering 62%', '#007be0'], fail: ['Failed', '#e03636'] };
const srcBadge = s => `<span class="bd ${s === 'Generated' ? 'vio' : 'gray'}">${s}</span>`;
const BEATS = [
  ['01', '0:00', 'Map of the Aegean, slow push towards Salamis.'], ['02', '0:24', 'Marble relief of rowers, oars in unison.'],
  ['03', '0:50', 'Strait at dusk, wide, drone.'], ['04', '1:21', 'Battle plan: fire spreads across the strait.'],
  ['05', '1:57', 'Winged Victory statue, slow tilt up.'], ['06', '2:25', 'Wing detail, macro, shallow focus.'],
  ['07', '2:47', 'Salamis the morning after, wreckage on the water.'], ['08', '3:20', 'Title card: HISTORY.'], ['09', '3:30', 'End card with subscribe prompt.'],
];

/* ---------- module sidebar (library) ---------- */
const librarySidebar = `
  <div style="width: 212px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; padding: 10px 8px;">
    <div style="padding: 4px 9px 12px; font-size: 14px; font-weight: 500;">Video Edit</div>
    <div class="lbl" style="margin-bottom: 5px;">Library</div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
      <div class="n on"><span>All projects</span><b>6</b></div>
      <div class="n"><span>My projects</span><b>2</b></div>
      <div class="n"><span>Rendering now</span><i style="background: #e6f4ff; color: #007be0;">1</i></div>
      <div class="n"><span>Needs review</span><b>1</b></div>
    </div>
    <div class="lbl" style="margin: 16px 0 5px;">Campaigns</div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
      <div class="n"><span>2026-Q3-campaign</span><b>6</b></div>
      <div class="n"><span>2025 archive</span><b>14</b></div>
    </div>
    <div style="margin-top: auto; padding: 12px 9px 4px; border-top: 1px solid #ededed;">
      <div style="display: flex; align-items: center; gap: 10px;">${px([[SPRITE.BOT]], { s: 2, pal: { B: '#4c7cf0' } })}<div><div style="font-size: 12px; color: #171717;">2 jobs rendering</div><div class="cap" style="margin-top: 2px;">3 waiting · 1 needs you</div></div></div>
      <div style="display: flex; justify-content: space-between; margin-top: 12px;"><span class="cap">Video spend · Sep</span><span style="font-size: 11px; color: #525252;">HK$731 of 4,000</span></div>
      <div style="height: 4px; border-radius: 2px; background: #ededed; margin-top: 6px;"><div style="width: 18%; height: 4px; border-radius: 2px; background: {{accent}};"></div></div>
    </div>
  </div>`;

/* ---------- project switcher (collapsible) ---------- */
const GROUPS = [['Rendering', ['grc']], ['In review', ['org']], ['On hold', ['gdy']], ['Waiting for script', ['ssp']], ['Exported', ['prs', 'dmo']]];
const switcher = cur => collapsible(`
  <div style="width: 240px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; padding: 8px 8px 10px;">
    <div style="display: flex; align-items: center; gap: 6px; padding: 0 0 0 9px; font-size: 12px; color: #7c7c7c;"><svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #7c7c7c; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><path d="m14.5 6-6 6 6 6"/></svg>All projects<div style="margin-left: auto;">${toggleBtn('Hide the project list')}</div></div>
    <div style="padding: 8px 9px 10px; font-size: 14px; font-weight: 500;">Video Edit</div>
    <div style="height: 30px; border-radius: 8px; background: #fff; border: 1px solid #ededed; display: flex; align-items: center; gap: 7px; padding: 0 9px; margin: 0 1px;">
      <svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #999999; fill: none; stroke-width: 1.9; stroke-linecap: round;"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg><span style="font-size: 12px; color: #999999; flex-grow: 1;">Jump to a project</span><span class="kbd">⌘K</span>
    </div>
${GROUPS.map(([g, ids]) => `    <div class="sg"><svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>${g}<span style="margin-left: auto; font-weight: 420;">${ids.length}</span></div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
${ids.map(id => { const p = PD[id]; return `      <div class="sn${id === cur ? ' on' : ''}" style="height: 34px;">${thumbSmall(p, 30, 17)}<span>${p.t}</span>${av(p.o, 16)}</div>`; }).join('\n')}
    </div>`).join('\n')}
    <div style="margin-top: auto; padding: 10px 9px 2px; border-top: 1px solid #ededed;">
      <div class="cap" style="line-height: 1.5;">A project opens when its script is locked in Script.</div>
    </div>
  </div>`, `
  <div class="mini">
    ${toggleBtn('Show the project list')}
    <div style="width: 22px; height: 1px; background: #e2e2e2; margin: 6px 0 4px;"></div>
${PROJ.map(p => `    <div class="mi${p.id === cur ? ' on' : ''}" title="${p.t}">${thumbSmall(p, 28, 16)}<span class="dot" style="background: ${VST[p.st][2]}; width: 6px; height: 6px;"></span></div>`).join('\n')}
  </div>`);

/* ---------- project header + tabs ---------- */
const TABS = [['shots', 'Shots', '9'], ['media', 'Media', '42'], ['renders', 'Renders', '', '2'], ['preview', 'Preview'], ['audio', 'Audio'], ['export', 'Export']];
const header = (tab, actions, right) => `
    <div class="bar" style="height: 52px; gap: 10px;">
      <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; flex-shrink: 0; stroke: #7c7c7c; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><rect x="3.4" y="5.4" width="12.4" height="13.2" rx="2.1"/><path d="m16.6 13 4.6 2.8V8.2L16.6 11z"/></svg>
      <span class="h1" style="white-space: nowrap;">History of Greece · Ep 75</span>
      <span class="bd blue">003 · Rendering</span>
      <span class="mut" style="white-space: nowrap;">Script v6 · YouTube 16:9</span>
      <div style="flex-grow: 1;"></div>
      <div class="costc" title="Project cost so far, against its cap">HK$412.80<div class="m"><div style="width: 46%;"></div></div><span class="cap">of 900</span></div>
      <div style="display: flex; align-items: center;">${['chan', 'leung'].map((k, i) => `<div style="position: relative; margin-left: ${i ? -6 : 0}px;">${av(k, 24, ' box-shadow: 0 0 0 2px #fff;')}${i === 0 ? '<span style="position: absolute; right: -1px; bottom: -1px; width: 8px; height: 8px; border-radius: 4px; background: #278f5e; box-shadow: 0 0 0 2px #fff;"></span>' : ''}</div>`).join('')}</div>
      ${actions}
    </div>
    <div class="tabs">
${TABS.map(([k, l, n, live]) => `      <div class="tb${k === tab ? ' on' : ''}">${l}${n ? `<b>${n}</b>` : ''}${live ? `<i>${live}</i>` : ''}</div>`).join('\n')}
      <div style="flex-grow: 1;"></div>
      <div style="display: flex; align-items: center; gap: 10px;">${right}</div>
    </div>`;

const PLUS = '<svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round;"><path d="M12 6v12M6 12h12"/></svg>';
const TRASH_SVG = '<svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><path d="M5.5 7.5h13M9.5 7.5V5.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7M7 7.5l.8 11.2h8.4L17 7.5"/></svg>';
const RESTORE_SVG = '<svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3.8h3.8"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="#171717" stroke="none"/></svg>';

const page = o => shellPage({ module: 'Video Edit', gen: 'video-screens.mjs', active: 'video', extraCss: CSS, ...o });

/* =================================================================== */
/* LIBRARY                                                             */
/* =================================================================== */
const projTile = (p, sel) => `
          <div class="card" style="min-width: 0;">
            <div class="sth" style="border-radius: 10px;${sel ? ' box-shadow: 0 0 0 2px #fff, 0 0 0 4px {{accent}};' : ''}">
              ${p.cov ? crop(p.cov, ` position: absolute; inset: 0;${p.st === 'hold' ? ' filter: grayscale(1); opacity: .55;' : ''}`) : `<div style="position: absolute; inset: 0; background: #f7f7f7; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;">${ICON.clap(3)}<span class="cap">Opens when the script is locked</span></div>`}
              <div class="pill" style="top: 8px; left: 8px;">${p.no}</div>
              <div class="pill" style="bottom: 8px; left: 8px;"><span class="dot" style="width: 6px; height: 6px; background: ${VST[p.st][2]};"></span>${VST[p.st][0]}</div>
              ${p.cov ? `<div class="pill dk" style="bottom: 8px; right: 8px;">${p.dur}</div>` : ''}
              ${p.st === 'render' ? '<div style="position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255,255,255,.5);"><div style="width: 67%; height: 3px; background: {{accent}};"></div></div>' : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 10px;">
              <div style="min-width: 0; flex-grow: 1;"><div style="font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.t}</div>
              <div class="cap" style="margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.sh[0]} of ${p.sh[1]} shots · ${p.note}</div></div>
              ${av(p.o, 20)}
            </div>
          </div>`;
const LG = 'grid-template-columns: minmax(0, 1fr) 138px 110px 64px 90px 124px 96px';
const projRow = (p, sel) => `
          <div class="tr" style="${LG}; height: 54px;${sel ? ' background: #f8f8f8;' : ''}">
            <div style="gap: 11px;">${thumbSmall(p, 56, 32)}<div style="min-width: 0;"><span class="el" style="color: #171717; font-weight: 500;">${p.t}</span><span class="el cap" style="margin-top: 2px;">${p.no} · ${p.ch}</span></div></div>
            <div>${vbadge(p.st)}</div>
            <div style="gap: 8px;"><div class="pbar" style="max-width: 54px;"><div style="width: ${Math.round(p.sh[0] / p.sh[1] * 100)}%;"></div></div><span style="font-variant-numeric: tabular-nums;">${p.sh[0]}/${p.sh[1]}</span></div>
            <div class="num">${p.dur}</div>
            <div class="num">${p.cost}</div>
            <div style="gap: 8px;">${av(p.o, 18)}<span class="el">${P[p.o][1]}</span></div>
            <div style="color: #7c7c7c;">${p.ed}</div>
          </div>`;

const libraryMain = `
    <div class="bar">
      <span style="font-size: 13px; color: #999999;">Projects</span>
      <svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #c7c7c7; fill: none; stroke-width: 2; stroke-linecap: round;"><path d="m9.5 5.5 6 6.5-6 6.5"/></svg>
      <span class="h1">2026-Q3-campaign</span>
      <div style="flex-grow: 1;"></div>
      <div style="width: 200px; height: 28px; border: 1px solid #ededed; border-radius: 8px; background: #f8f8f8; display: flex; align-items: center; gap: 7px; padding: 0 9px;">
        <svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round;"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg><span style="font-size: 12px; color: #999999;">Search projects</span>
      </div>
      <div style="display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3f3f3;">
        <div class="seg" onClick="{{ pickGrid }}" style="background: {{gridBg}}; color: {{gridFg}}; box-shadow: {{gridSh}};" title="Covers"><svg viewBox="0 0 24 24"><rect x="4.2" y="4.2" width="6.6" height="6.6" rx="1.6"/><rect x="13.2" y="4.2" width="6.6" height="6.6" rx="1.6"/><rect x="4.2" y="13.2" width="6.6" height="6.6" rx="1.6"/><rect x="13.2" y="13.2" width="6.6" height="6.6" rx="1.6"/></svg></div>
        <div class="seg" onClick="{{ pickList }}" style="background: {{listBg}}; color: {{listFg}}; box-shadow: {{listSh}};" title="List"><svg viewBox="0 0 24 24"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01"/></svg></div>
      </div>
    </div>
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; padding: 16px 22px 0; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 18px;">
          <div class="fc on">All <b>6</b></div>
          <div class="fc"><span class="dot" style="background: #007be0;"></span>Rendering <b>1</b></div>
          <div class="fc"><span class="dot" style="background: #db7706;"></span>In review <b>1</b></div>
          <div class="fc"><span class="dot" style="background: #999999;"></span>On hold <b>1</b></div>
          <div class="fc"><span class="dot" style="background: #c7c7c7;"></span>Waiting <b>1</b></div>
          <div class="fc"><span class="dot" style="background: #278f5e;"></span>Exported <b>2</b></div>
          <div style="flex-grow: 1;"></div>
          <span class="cap">Projects start when a script is locked</span>
        </div>
        <sc-if value="{{isGrid}}" hint-placeholder-val="{{ true }}">
        <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 26px 18px;">
${PROJ.map((p, i) => projTile(p, i === 0)).join('')}
        </div>
        <div class="cap" style="margin-top: 24px;">6 projects · filtered to projects you can open</div>
        </sc-if>
        <sc-if value="{{isList}}" hint-placeholder-val="{{ true }}">
        <div class="t">
          <div class="hd" style="${LG};"><div>Project</div><div>Status</div><div>Shots</div><div class="num">Length</div><div class="num">Cost</div><div>Owner</div><div>Updated</div></div>
${PROJ.map((p, i) => projRow(p, i === 0)).join('')}
        </div>
        <div class="cap" style="margin-top: 14px;">6 projects · costs include generation, voice, transcription and rendering</div>
        </sc-if>
      </div>
${rightPanel(['Agent', 'Details'], 'Agent', agentBlock({
  scope: '2026-Q3-campaign · 6 projects',
  q: 'Which projects are at risk this week?',
  tool: 'Read 6 projects, render queue · 0.7 s',
  a: `<p><b style="font-weight: 500;">History of Greece</b> publishes on 12 Sep and has two gaps: shot 02 has no clip yet, and shot 07 failed because the Veo quota on the client’s Google account is used up.</p><p style="margin-top: 8px;"><b style="font-weight: 500;">Orange typography cut</b> is finished and has waited on Michelle for 2 hours.</p>`,
  act: 'Open History of Greece',
  place: 'Ask about these projects…',
  guard: 'Uses only projects you can open',
  cost: 'HK$0.04',
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
/* SHOTS                                                               */
/* =================================================================== */
const shotThumb = ([n, t, src, img, st, dur]) => {
  let inner;
  if (st === 'need') inner = `<div style="position: absolute; inset: 0; background: #f7f7f7; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; box-shadow: inset 0 0 0 1.5px #f5d08a; border-radius: 9px;">${ICON.film(2)}<span style="font-size: 11px; color: #8a5a0d;">Drop a clip from Media</span></div>`;
  else if (st === 'fail') inner = `<div style="position: absolute; inset: 0; background: #fff6f6; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;">${px([[SPRITE.BOT]], { s: 2, pal: { l: '#e5484d', B: '#c9ced6' } })}<span style="font-size: 11px; color: #c53030;">Quota ran out</span></div>`;
  else inner = crop(img, ' position: absolute; inset: 0;') + (st === 'run' ? '<div style="position: absolute; inset: 0; background: rgba(255,255,255,.35);"></div><div style="position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255,255,255,.6);"><div style="width: 62%; height: 3px; background: {{accent}};"></div></div>' : '');
  return `<div class="sth">${inner}<div class="pill" style="top: 7px; left: 7px;">${n}</div><div class="pill dk" style="bottom: 7px; right: 7px;">${dur}</div></div>`;
};
const shotCard = (s, sel) => `
          <div style="min-width: 0;${sel ? ' padding: 6px; margin: -6px; border-radius: 13px; background: #f5faff; box-shadow: inset 0 0 0 1.5px {{accent}};' : ''}">
            ${shotThumb(s)}
            <div class="stt">${s[1]}</div>
            <div class="srow">${srcBadge(s[2])}<span class="st"><span class="dot" style="width: 6px; height: 6px; background: ${SHOT_ST[s[4]][1]};"></span>${SHOT_ST[s[4]][0]}</span></div>
          </div>`;
const timeline = `
        <div style="display: flex; align-items: center; margin: 22px 0 8px;"><span class="lbl" style="padding: 0;">Timeline</span><span class="cap" style="margin-left: 8px;">9 shots · 3:48 · target 3:50</span><span class="cap" style="margin-left: auto;">Drag to reorder</span></div>
        <div style="display: flex; gap: 3px; min-width: 0; overflow: hidden; border-radius: 6px;">
${SHOTS.map(([n, , , img, st, , sec]) => `          <div class="seg2" style="flex: ${sec} 1 0; ${img ? '' : `background: ${st === 'fail' ? '#ffe7e7' : '#fff3d6'}; color: ${st === 'fail' ? '#c53030' : '#8a5a0d'}; text-shadow: none;`}">${img ? crop(img, ' position: absolute; inset: 0; z-index: 0;') + (st === 'run' ? '<div style="position: absolute; inset: 0; background: rgba(255,255,255,.4);"></div>' : '') : ''}<span style="position: relative;">${n}</span></div>`).join('\n')}
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 6px;"><span class="cap">0:00</span><span class="cap">1:00</span><span class="cap">2:00</span><span class="cap">3:00</span><span class="cap">3:48</span></div>`;

const shotsMain = `${header('shots',
  `<div class="btn s">${PLUS}Add shot</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Render rough cut</div>`,
  '<span class="cap">6 of 9 ready</span><div style="width: 80px;" class="pbar"><div style="width: 67%;"></div></div>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="width: 262px; flex-shrink: 0; border-right: 1px solid #ededed; background: #fcfcfc; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; gap: 8px; padding: 14px 14px 8px;"><span class="lbl" style="padding: 0;">Locked script</span><span class="bd grn" style="gap: 4px;"><svg viewBox="0 0 24 24" style="width: 10px; height: 10px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;"><path d="M6.8 10.5h10.4v8H6.8z"/><path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5"/></svg>v6</span><span style="margin-left: auto; font-size: 11.5px; color: {{accent}};">Open</span></div>
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 0 6px; display: flex; flex-direction: column; gap: 1px;">
${BEATS.map(([n, tc, x]) => { const st = SHOTS[+n - 1][4]; return `          <div class="beat${n === '02' ? ' on' : ''}"><div class="bnum">${n}<b>${tc}</b></div><div class="x">${x}</div><span class="dot" style="width: 6px; height: 6px; margin-top: 5px; background: ${SHOT_ST[st][1]};"></span></div>`; }).join('\n')}
        </div>
        <div style="flex-shrink: 0; padding: 10px 14px 12px; border-top: 1px solid #f3f3f3;" class="cap">Each beat is one shot. Changing a beat needs a new script version.</div>
      </div>
      <div style="flex-grow: 1; min-width: 0; padding: 16px 20px 0; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 14px;">
          <div class="fc on">All <b>9</b></div><div class="fc">Ready <b>6</b></div><div class="fc">Needs a clip <b>1</b></div><div class="fc">Rendering <b>1</b></div><div class="fc">Failed <b>1</b></div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px 14px;">
${SHOTS.map(s => shotCard(s, s[0] === '02')).join('')}
          <div style="min-width: 0;">
            <div class="sth" style="background: #f8f8f8; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: #525252;">
              <div style="width: 28px; height: 28px; border-radius: 14px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); display: flex; align-items: center; justify-content: center;">${PLUS}</div>
              <span style="font-size: 12px;">Add shot</span>
            </div>
            <div class="stt" style="font-weight: 420; color: #999999;">Add a cutaway</div>
          </div>
        </div>
${timeline}
      </div>
${rightPanel(['Agent', 'Shot'], 'Agent', agentBlock({
  scope: 'Shot 02 · Marble relief of rowers',
  q: 'What’s stopping the rough cut?',
  tool: 'Read 9 shots, media bin, queue · 0.6 s',
  a: `<p>Two shots:</p><div style="margin: 8px 0; display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; gap: 9px; padding: 8px 9px; border: 1px solid #ededed; border-radius: 9px; background: #fff;">${crop('H_ROBE', ' width: 52px; height: 30px; border-radius: 5px; flex-shrink: 0;')}<div style="min-width: 0;"><div style="font-size: 12px; color: #171717;">02 has no clip</div><div class="cap" style="margin-top: 2px;">marble_relief_rowers.mov fits: 4K, 0:48, unused</div></div></div>
              <div style="display: flex; gap: 9px; padding: 8px 9px; border: 1px solid #ededed; border-radius: 9px; background: #fff;"><div style="width: 52px; height: 30px; border-radius: 5px; background: #fff6f6; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${px([[SPRITE.BANG]], { s: 2 })}</div><div style="min-width: 0;"><div style="font-size: 12px; color: #171717;">07 failed 3 times</div><div class="cap" style="margin-top: 2px;">Veo quota on the client’s account is used up</div></div></div>
            </div><p>I can assign the clip now. Shot 07 waits for a top-up, or can move to Veo 3.1 Fast.</p>`,
  act: 'Assign the clip to 02',
  place: 'Ask about these shots…',
  guard: 'Uses only clips you can open',
  cost: 'HK$0.03',
}))}
    </div>`;

/* =================================================================== */
/* MEDIA                                                               */
/* =================================================================== */
const CLIPS = [
  ['marble_relief_rowers.mov', 'H_ROBE', '4K', '0:48', ''],
  ['winged_victory_tilt.mov', 'H_HEAD', '4K', '1:12', '05'],
  ['wing_detail_macro.mov', 'H_WING', '4K', '0:31', '06'],
  ['title_card_history.png', 'H_LETTERS', '4K still', '', '08'],
  ['end_card_subscribe.png', 'H_FULL', '4K still', '', '09'],
  ['aegean_map_push.mp4', 'D_SEA', 'Generated', '0:24', '01'],
  ['strait_dusk_v2.mp4', 'D_DUSK', 'Generated', '0:31', ''],
  ['fire_over_strait.mp4', 'D_FIRE', 'Generated', '0:36', '04'],
  ['marble_texture_loop.mov', 'H_TEX', '4K', '0:20', ''],
  ['museum_postcards_scan.jpg', 'G_POST', '2400×1600', '', ''],
];
const clipTile = ([name, img, res, dur, used], i) => `
          <div class="ctile">
            <div class="cth"${i === 0 ? ' style="box-shadow: 0 0 0 2px #fff, 0 0 0 4px {{accent}};"' : ''}>${crop(img, ' position: absolute; inset: 0;')}
              ${used ? `<div class="pill" style="top: 6px; left: 6px;">In ${used}</div>` : ''}
              ${dur ? `<div class="pill dk" style="bottom: 6px; right: 6px;">${dur}</div>` : ''}
              ${i === 1 ? `<div class="hov"><div class="hb" title="Play">${PLAY_SVG}</div><div class="hb" title="Assign to a shot"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg></div><div class="hb" title="Remove from project"><svg viewBox="0 0 24 24"><path d="M5.5 7.5h13M9.5 7.5V5.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7M7 7.5l.8 11.2h8.4L17 7.5"/></svg></div></div><div style="position: absolute; top: 6px; right: 6px;">${cb(false)}</div>` : ''}
              ${i === 0 ? `<div style="position: absolute; top: 6px; right: 6px;">${cb(true)}</div>` : ''}
            </div>
            <div class="cn">${name}</div>
            <div class="cap" style="margin-top: 2px;">${res}${used ? '' : ' · unused'}</div>
          </div>`;
const mediaMain = `${header('media',
  `<div class="btn s"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 17V6.5M7.5 11 12 6.5l4.5 4.5M5 18.5h14"/></svg>Upload to Database</div>`,
  '<span class="cap">42 of 57 files visible to you</span>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 14px 20px 0; overflow: hidden; display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 14px;">
          <div style="width: 190px; height: 28px; border: 1px solid #ededed; border-radius: 8px; background: #f8f8f8; display: flex; align-items: center; gap: 7px; padding: 0 9px;"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round;"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg><span style="font-size: 12px; color: #999999;">Search clips</span></div>
          <div class="fc">Type: All ${CHEV}</div><div class="fc">Duration ${CHEV}</div><div class="fc">Resolution: 4K ${CHEV}</div>
          <div class="fc on">marble <svg viewBox="0 0 24 24" style="stroke: #c7c7c7;"><path d="M6 6l12 12M18 6 6 18"/></svg></div>
          <div style="flex-grow: 1;"></div>
          <div class="fc" style="color: #7c7c7c;">${RESTORE_SVG.replace('stroke: currentColor', 'stroke: #7c7c7c')}Removed <b>3</b></div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 18px 14px;">
${CLIPS.map(clipTile).join('')}
        </div>
        <div style="margin-top: 22px; padding: 14px 14px 12px; border-radius: 12px; background: #fafafa;">
          <div style="display: flex; align-items: center; margin-bottom: 10px;"><span class="lbl" style="padding: 0;">Drop onto a shot</span><span class="cap" style="margin-left: 8px;">2 shots have no clip</span><span class="cap" style="margin-left: auto;">or select a clip and press A</span></div>
          <div style="display: flex; gap: 6px; position: relative;">
${SHOTS.map(([n, , , img, st]) => `            <div class="slot"><div class="sb" style="${n === '02' ? 'background: #eaf4fd; box-shadow: inset 0 0 0 2px {{accent}};' : st === 'fail' ? 'background: #fff0f0;' : ''}">${img ? crop(img, ' position: absolute; inset: 0;') : n === '02' ? `<span style="font-size: 11px; font-weight: 500; color: {{accent}};">Drop here</span>` : `<span style="font-size: 10.5px; color: #c53030;">Failed</span>`}</div><div class="sl">${n}</div></div>`).join('\n')}
            <div style="position: absolute; left: 104px; top: 12px; width: 64px; height: 36px; border-radius: 6px; overflow: hidden; transform: rotate(-4deg); box-shadow: 0 10px 22px rgba(0,0,0,.22); opacity: .92;">${crop('H_ROBE', ' width: 100%; height: 100%;')}</div>
            <svg viewBox="0 0 24 24" style="position: absolute; left: 156px; top: 34px; width: 18px; height: 18px;"><path d="M5 3l12 8-5.5 1.2L15 19l-2.5 1.2-3.4-6.7L5 17z" fill="#171717" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; margin-top: 14px; padding: 10px 12px; border-radius: 10px; border: 1px solid #f3f3f3;">
          ${ICON.trash(2)}
          <div style="flex-grow: 1; min-width: 0;"><div style="font-size: 12.5px; color: #171717;">3 clips removed from this project</div><div class="cap" style="margin-top: 1px;">Kept in the Database. Restore them here for 30 days.</div></div>
          <div class="btn s" style="height: 27px;">${RESTORE_SVG}Restore</div>
        </div>
      </div>
${rightPanel(['Clip', 'Agent'], 'Clip', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 14px;">
          <div style="position: relative; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden;">${crop('H_ROBE', ' position: absolute; inset: 0;')}<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;"><div style="width: 38px; height: 38px; border-radius: 19px; background: rgba(255,255,255,.94); display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" style="width: 14px; height: 14px;"><path d="M8 5.5v13l10.5-6.5z" fill="#171717"/></svg></div></div><div class="pill dk" style="bottom: 8px; right: 8px;">0:48</div></div>
          <div style="font-size: 13px; font-weight: 500; margin-top: 12px;">marble_relief_rowers.mov</div>
          <div style="display: flex; gap: 5px; margin-top: 8px;"><span class="bd gray">marble</span><span class="bd gray">relief</span><span class="bd gray">rowers</span></div>
          <div class="kv" style="margin-top: 10px;"><span>Resolution</span><span>3840 × 2160 · 25 fps</span></div>
          <div class="kv"><span>Codec · size</span><span>ProRes 422 · 2.1 GB</span></div>
          <div class="kv"><span>Owner</span><span>Leung Chi-hang</span></div>
          <div class="kv"><span>Your access</span><span>Can use in projects</span></div>
          <div class="kv" style="border: none;"><span>Used in</span><span>Not used yet</span></div>
          <div style="display: flex; gap: 9px; margin-top: 10px; padding: 10px 11px; border-radius: 10px; background: #f5faff;">
            <span style="color: {{accent}}; margin-top: 1px;">${SPARK}</span>
            <div style="font-size: 12px; line-height: 1.5; color: #383838;">Matches shot 02, <b style="font-weight: 500;">Marble relief of rowers</b>. Trim 0:12 to 0:38 to fit 0:26.</div>
          </div>
          <div class="btn" style="width: 100%; justify-content: center; height: 32px; margin-top: 12px; background: {{accent}}; color: #fff; font-weight: 500;">Assign to shot 02</div>
          <div style="display: flex; gap: 6px; margin-top: 7px;"><div class="btn s" style="flex: 1; justify-content: center;">Open in Database</div><div class="btn s" style="flex: 1; justify-content: center; color: #e03636;">${TRASH_SVG}Remove</div></div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 10px 14px 12px;" class="cap">15 files in this folder are restricted and hidden from you.</div>`)}
    </div>`;

/* =================================================================== */
/* RENDERS, pixel render floor + real queue                           */
/* =================================================================== */
const station = ({ state, pct = 0 }) => {
  const lamp = state === 'work' ? '#30a46c' : state === 'fail' ? '#e5484d' : '#9aa5b1';
  const screenBg = state === 'fail' ? '#401818' : state === 'idle' ? '#141b22' : '#1e2a36';
  let g = '';
  g += '<rect x="3" y="42" width="42" height="1" fill="rgba(0,0,0,0.08)"/>';
  g += pxg(SPRITE.BOT, 6, state === 'fail' ? 14 : 13, { l: lamp, B: state === 'fail' ? '#c9ced6' : state === 'idle' ? '#aab8d6' : '#4c7cf0' }, state === 'work' ? 'bob' : '');
  if (state === 'work') g += '<g class="type"><rect x="15" y="23" width="2" height="1" fill="#aab3bf"/></g><g class="type2"><rect x="4" y="23" width="2" height="1" fill="#aab3bf"/></g>';
  // desk
  g += '<rect x="1" y="25" width="46" height="1" fill="#d08a4c"/><rect x="1" y="26" width="46" height="2" fill="#b86b30"/><rect x="3" y="28" width="42" height="11" fill="#8e4f22"/>';
  g += '<rect x="27" y="31" width="15" height="1" fill="#6f3c18"/><rect x="33" y="34" width="3" height="1" fill="#d08a4c"/><rect x="3" y="39" width="3" height="3" fill="#6f3c18"/><rect x="42" y="39" width="3" height="3" fill="#6f3c18"/>';
  // keyboard
  g += '<rect x="7" y="24" width="10" height="1" fill="#4a4a4a"/>';
  // monitor
  g += `<rect x="24" y="9" width="21" height="15" fill="#262626"/><rect x="25" y="10" width="19" height="12" fill="${screenBg}"/><rect x="33" y="24" width="3" height="1" fill="#262626"/>`;
  if (state === 'work') {
    const w = Math.max(1, Math.round(15 * pct));
    g += '<rect x="27" y="12" width="9" height="1" fill="#6b7c8f"/><rect x="27" y="14" width="13" height="1" fill="#6b7c8f"/><rect x="27" y="16" width="6" height="1" fill="#6b7c8f"/>';
    g += `<rect x="27" y="19" width="15" height="2" fill="#33414f"/><rect x="27" y="19" width="${w}" height="2" fill="{{accent}}"/><rect class="blink" x="${27 + w}" y="19" width="1" height="2" fill="#ffffff"/>`;
    g += '<rect x="18" y="22" width="3" height="3" fill="#ffffff"/><rect x="18" y="22" width="3" height="1" fill="#e6e9ee"/><rect x="21" y="23" width="1" height="1" fill="#aab3bf"/>';
    g += '<g class="steam"><rect x="19" y="20" width="1" height="1" fill="#c7c7c7"/></g>';
  } else if (state === 'fail') {
    g += '<rect x="33" y="12" width="2" height="5" fill="#ff6b6b"/><rect x="33" y="18" width="2" height="2" fill="#ff6b6b"/>';
    g += '<g class="smoke"><rect x="37" y="6" width="2" height="2" fill="#b0b0b0"/></g><g class="smoke2"><rect x="40" y="5" width="3" height="3" fill="#c7c7c7"/></g>';
  } else {
    g += '<rect x="27" y="15" width="4" height="1" fill="#2a3640"/>';
    g += '<g class="zz"><rect x="16" y="9" width="3" height="1" fill="#9aa5b1"/><rect x="17" y="10" width="1" height="1" fill="#9aa5b1"/><rect x="16" y="11" width="3" height="1" fill="#9aa5b1"/></g>';
    g += '<g class="zz2"><rect x="19" y="6" width="2" height="1" fill="#b7bfc9"/><rect x="19" y="7" width="2" height="1" fill="#b7bfc9"/></g>';
  }
  return `<svg viewBox="0 0 48 44" width="144" height="132" shape-rendering="crispEdges" style="display: block;">${g}</svg>`;
};
const belt = (() => {
  let g = '<rect x="0" y="30" width="50" height="1" fill="#262626"/><rect x="0" y="31" width="50" height="3" fill="#6b6b6b"/>';
  g += '<path class="roll" d="M0 35.5H50" stroke="#9a9a9a" stroke-width="1" stroke-dasharray="2 2"/>';
  g += '<rect x="4" y="36" width="2" height="6" fill="#4a4a4a"/><rect x="44" y="36" width="2" height="6" fill="#4a4a4a"/><rect x="0" y="42" width="50" height="1" fill="rgba(0,0,0,0.08)"/>';
  g += `<g class="belt">${[-12, 2, 16, 30].map(x => pxg(SPRITE.CLAP, x, 21)).join('')}</g>`;
  return `<svg viewBox="0 0 50 44" width="150" height="132" shape-rendering="crispEdges" style="display: block;">${g}</svg>`;
})();
const STATIONS = [
  { state: 'work', pct: .62, who: 'Veo 3.1 Fast', job: 'Shot 03 · strait at dusk', line: '<div class="pbar" style="max-width: 70px;"><div style="width: 62%;"></div></div><span style="font-size: 11px; color: #525252; font-variant-numeric: tabular-nums;">62% · 3 min</span>' },
  { state: 'work', pct: .34, who: 'FFmpeg render', job: 'Rough cut v3 · 16:9', line: '<div class="pbar" style="max-width: 70px;"><div style="width: 34%;"></div></div><span style="font-size: 11px; color: #525252; font-variant-numeric: tabular-nums;">34% · 6 min</span>' },
  { state: 'idle', who: 'Azure Speech', job: 'Nothing waiting', line: '<span class="cap">Idle since 10:12</span>' },
  { state: 'fail', who: 'Veo 3.1 Lite', job: 'Shot 07 · Salamis aftermath', line: '<span style="font-size: 11px; color: #e03636;">Quota used up · stopped</span>' },
];
const Q_COLS = `<div class="qr" style="height: 28px; border-bottom: 1px solid #ededed; font-size: 10.5px; font-weight: 500; color: #7c7c7c;"><div></div><div>Job</div><div>Type</div><div>Provider</div><div class="num">Tries</div><div>Progress</div><div class="num">Cost</div></div>`;
const queueMain = `${header('renders',
  '<div class="btn s">Pause queue</div>',
  '<span class="cap">This batch HK$58.60 · rolls up to the project</span>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 14px 18px 0; overflow: hidden;">
        <div class="floor" style="border-radius: 14px; border: 1px solid #f0f0f0; padding: 14px 14px 12px;">
          <div style="display: grid; grid-template-columns: 150px repeat(4, 144px); gap: 0 6px; justify-content: space-between;">
            <div>${belt}</div>
${STATIONS.map(s => `            <div>${station(s)}</div>`).join('\n')}
            <div style="padding-top: 6px; min-width: 0;"><div class="lbl2">Up next · 3</div><div class="lbl3">Moves when a desk frees up</div></div>
${STATIONS.map(s => `            <div style="padding-top: 6px; min-width: 0;"><div class="lbl2">${s.who}</div><div class="lbl3">${s.job}</div><div style="display: flex; align-items: center; gap: 6px; margin-top: 5px;">${s.line}</div></div>`).join('\n')}
          </div>
        </div>

        <div class="qh" style="color: #e03636;">Needs you<b>1</b></div>
        ${Q_COLS}
        <div class="qr" style="background: #fffafa;"><div>${failDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 16px; height: 16px; border-radius: 8px')}</div><div><span class="nm" style="color: #171717;">gen_shot07_salamis_aftermath</span></div><div><span class="bd vio">Generation</span></div><div style="color: #7c7c7c;">Veo 3.1 Lite</div><div class="num">3 / 3</div><div><span style="font-size: 11.5px; color: #e03636;">Stopped</span></div><div class="num">HK$0.00</div></div>
        <div style="margin: 6px 0 4px 33px; padding: 10px 12px; border-radius: 9px; background: #fff7f7; border: 1px solid #ffdcdc;">
          <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #941f1f;">RESOURCE_EXHAUSTED · quota for veo-3.1-lite in asia-east2 · Google Cloud account aura-farmers-media</div>
          <div style="font-size: 11.5px; color: #8a3b3b; margin-top: 5px; line-height: 1.45;">The client’s quota ran out, so retries stopped and Admin was told on the Credentials screen. It resumes after a top-up.</div>
          <div style="display: flex; gap: 6px; margin-top: 8px;"><div class="btn s" style="height: 26px; font-size: 12px; background: #fff;">Retry</div><div class="btn s" style="height: 26px; font-size: 12px; background: #fff;">Use Veo 3.1 Fast · est. HK$22</div><div class="btn s" style="height: 26px; font-size: 12px; background: #fff;">Credential status</div></div>
        </div>

        <div class="qh">Working<b>2</b></div>
        <div class="qr"><div><span class="pos" style="background: #e6f4ff; color: #007be0;">▶</span></div><div><span class="nm" style="color: #171717;">gen_shot03_strait_dusk_v3</span></div><div><span class="bd vio">Generation</span></div><div style="color: #7c7c7c;">Veo 3.1 Fast</div><div class="num">1 / 3</div><div><div class="pbar"><div style="width: 62%;"></div></div><span style="font-size: 11px; color: #7c7c7c; font-variant-numeric: tabular-nums;">62%</span></div><div class="num">HK$18.40</div></div>
        <div class="qr"><div><span class="pos" style="background: #e6f4ff; color: #007be0;">▶</span></div><div><span class="nm" style="color: #171717;">render_roughcut_v3_16x9</span></div><div><span class="bd gray">Render</span></div><div style="color: #7c7c7c;">FFmpeg</div><div class="num">1 / 3</div><div><div class="pbar"><div style="width: 34%;"></div></div><span style="font-size: 11px; color: #7c7c7c; font-variant-numeric: tabular-nums;">34%</span></div><div class="num">HK$2.10</div></div>

        <div class="qh">Up next<b>3</b></div>
        <div class="qr"><div><span class="pos">1</span></div><div><span class="nm">render_roughcut_v3_9x16</span></div><div><span class="bd gray">Render</span></div><div style="color: #7c7c7c;">FFmpeg</div><div class="num">0</div><div><span class="cap">Starts in about 6 min</span></div><div class="num" style="color: #999999;">~HK$2.10</div></div>
        <div class="qr"><div><span class="pos">2</span></div><div><span class="nm">subtitles_burnin_zh-HK</span></div><div><span class="bd gray">Render</span></div><div style="color: #7c7c7c;">FFmpeg</div><div class="num">0</div><div><span class="cap">After 1</span></div><div class="num" style="color: #999999;">~HK$0.80</div></div>
        <div class="qr"><div><span class="pos">3</span></div><div><span class="nm">voice_take4_beat05</span></div><div><span class="bd gray">Voice</span></div><div style="color: #7c7c7c;">Azure Speech</div><div class="num">0</div><div><span class="cap">Waiting for a script note</span></div><div class="num" style="color: #999999;">~HK$1.20</div></div>

        <div style="display: flex; align-items: center; gap: 8px; height: 36px; margin-top: 10px; padding: 0 10px; border-radius: 9px; background: #fafafa;"><svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><path d="m9.5 5.5 6 6.5-6 6.5"/></svg><span style="font-size: 12px; color: #525252;">Done today</span><span class="cap">6 jobs · HK$34.00</span>${okDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 14px; height: 14px; border-radius: 7px; margin-left: auto')}</div>
      </div>
${rightPanel(['Agent', 'Costs'], 'Agent', agentBlock({
  scope: 'Render queue · project 003',
  q: 'Why did shot 07 fail, and what do I do?',
  tool: 'Read job log, provider response · 0.3 s',
  a: `<p>The Veo 3.1 Lite quota on the client’s Google Cloud account ran out. It isn’t a platform fault, so I stopped after 3 tries instead of burning more.</p><p style="margin-top: 8px;">Two ways forward: the client tops up and you press Retry, or I rerun it on Veo 3.1 Fast now, which still has quota, for about HK$22.</p>`,
  act: 'Rerun on Veo 3.1 Fast',
  place: 'Ask about the queue…',
  guard: 'Uses only jobs you can see',
  cost: 'HK$0.01',
}))}
    </div>`;

/* =================================================================== */
/* PREVIEW                                                             */
/* =================================================================== */
const CUTS = [
  ['v3', '16:9', 114, 64, 'H_HEAD', '3:48 · 2 h ago', 'a169'],
  ['v3', '9:16', 36, 64, 'H_HEAD', 'Preview', 'a916'],
  ['v3', '1:1', 64, 64, 'H_HEAD', 'Preview', 'a11'],
  ['v2', '16:9', 114, 64, 'H_WING', '3:52 · 1 Sep', ''],
  ['v1', '16:9', 114, 64, 'H_ROBE', '4:05 · 30 Aug', ''],
];
const previewMain = `${header('preview',
  '<div class="btn s">Share cut</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Send v3 for review</div>',
  '<span class="cap">Rough cut v3 · rendered 2 h ago</span>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 16px 20px 0; overflow: hidden; display: flex; flex-direction: column;">
        <div style="height: 392px; flex-shrink: 0; border-radius: 14px; background: #f5f5f5; display: flex; align-items: center; justify-content: center; gap: 18px; position: relative;">
          <sc-if value="{{single}}" hint-placeholder-val="{{ true }}">
            <div style="width: {{fw}}px; height: {{fh}}px; border-radius: 8px; overflow: hidden; position: relative; box-shadow: 0 6px 20px rgba(0,0,0,.12);">${crop('H_FULL', ' position: absolute; inset: 0;')}
              <div style="position: absolute; left: 8%; right: 8%; bottom: 7%; text-align: center;"><span style="display: inline-block; background: rgba(23,23,23,.78); color: #fff; font-size: 14px; line-height: 1.45; padding: 4px 10px; border-radius: 5px;">到入夜，波斯艦隊已經潰散。<br><span style="font-size: 12px; opacity: .8;">By nightfall, the Persian fleet is broken.</span></span></div>
            </div>
          </sc-if>
          <sc-if value="{{compare}}" hint-placeholder-val="{{ false }}">
            <div><div class="cap" style="margin-bottom: 7px;">v2 · 1 Sep</div><div style="width: {{cw}}px; height: {{ch}}px; border-radius: 8px; overflow: hidden; position: relative;">${crop('H_WING', ' position: absolute; inset: 0;')}</div></div>
            <div><div class="cap" style="margin-bottom: 7px; color: #171717;">v3 · now <span style="color: #278f5e;">shot 05 reframed · −4 s</span></div><div style="width: {{cw}}px; height: {{ch}}px; border-radius: 8px; overflow: hidden; position: relative; box-shadow: 0 0 0 2px {{accent}};">${crop('H_FULL', ' position: absolute; inset: 0;')}</div></div>
          </sc-if>
          <div style="position: absolute; top: 12px; left: 12px; display: flex; gap: 6px;"><span class="pill" style="position: static;">Shot 05</span><span class="pill" style="position: static;">1:57</span></div>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; margin-top: 14px;">
          <div style="width: 34px; height: 34px; border-radius: 17px; background: #171717; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px;"><path d="M8 5.5v13l10.5-6.5z" fill="#fff"/></svg></div>
          <span style="font-size: 12px; color: #171717; font-variant-numeric: tabular-nums;">1:57</span>
          <div style="flex-grow: 1; min-width: 0; position: relative; height: 22px; display: flex; align-items: center;">
            <div style="display: flex; gap: 2px; width: 100%;">${SHOTS.map(([, , , , st, , sec], i) => `<div style="flex: ${sec} 1 0; height: 5px; border-radius: 2px; background: ${i < 4 ? '{{accent}}' : i === 4 ? 'linear-gradient(90deg, {{accent}} 0 10%, #e2e2e2 10%)' : '#e2e2e2'};"></div>`).join('')}</div>
            <div style="position: absolute; left: 51.8%; top: 4px; width: 14px; height: 14px; border-radius: 7px; background: #fff; box-shadow: 0 0 0 2px {{accent}}, 0 1px 3px rgba(0,0,0,.2);"></div>
            <div style="position: absolute; left: 13%; top: -3px; width: 6px; height: 6px; border-radius: 3px; background: #db7706;" title="Comment"></div>
            <div style="position: absolute; left: 53%; top: -3px; width: 6px; height: 6px; border-radius: 3px; background: #db7706;" title="Comment"></div>
          </div>
          <span class="cap" style="font-variant-numeric: tabular-nums;">3:48</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 12px;">
          <div style="display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3f3f3;">
            <div class="aspb" onClick="{{ a169 }}" style="background: {{b169}}; color: {{f169}}; box-shadow: {{s169}};"><span style="width: 14px; height: 8px; border: 1.5px solid currentColor; border-radius: 2px;"></span>16:9</div>
            <div class="aspb" onClick="{{ a916 }}" style="background: {{b916}}; color: {{f916}}; box-shadow: {{s916}};"><span style="width: 7px; height: 12px; border: 1.5px solid currentColor; border-radius: 2px;"></span>9:16</div>
            <div class="aspb" onClick="{{ a11 }}" style="background: {{b11}}; color: {{f11}}; box-shadow: {{s11}};"><span style="width: 10px; height: 10px; border: 1.5px solid currentColor; border-radius: 2px;"></span>1:1</div>
          </div>
          <div class="fc on" style="height: 30px;">字幕 繁中 + EN</div>
          <div class="fc" style="height: 30px;">Safe area</div>
          <div style="flex-grow: 1;"></div>
          <div class="btn s" onClick="{{ toggleCompare }}" style="cursor: pointer; {{cmpStyle}}"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="7.5" height="14" rx="1.6"/><rect x="13" y="5" width="7.5" height="14" rx="1.6"/></svg>{{cmpLabel}}</div>
        </div>
        <div style="display: flex; align-items: center; margin: 20px 0 10px;"><span class="lbl" style="padding: 0;">All cuts</span><span class="cap" style="margin-left: 8px;">3 versions · every aspect ratio</span></div>
        <div style="display: flex; gap: 16px; align-items: flex-end;">
${CUTS.map(([v, ar, w, h, img, meta, fn], i) => `          <div class="cut"${fn ? ` onClick="{{ ${fn} }}"` : ''}><div class="cb2"><div class="ci" style="width: ${w}px; height: ${h}px;${fn ? ` box-shadow: {{ring_${fn}}};` : ''}">${crop(img, ' position: absolute; inset: 0;')}</div></div><div style="font-size: 12px; margin-top: 7px; color: #171717;">${v} · ${ar}</div><div class="cap" style="margin-top: 1px;">${meta}</div></div>`).join('\n')}
        </div>
      </div>
${rightPanel(['Cuts', 'Agent', 'Comments'], 'Cuts', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 14px;">
          <div style="padding: 12px; border-radius: 11px; background: #fff; border: 1px solid #ededed;">
            <div style="display: flex; align-items: center; gap: 7px;"><span style="font-size: 13px; font-weight: 500;">v3 · rough cut</span><span class="bd blue">Current</span><span class="cap" style="margin-left: auto;">3:48</span></div>
            <div style="display: flex; gap: 5px; margin-top: 9px;"><span class="bd gray">16:9</span><span class="bd gray">9:16</span><span class="bd gray">1:1</span></div>
            <div class="cap" style="margin-top: 9px; line-height: 1.5;">Changed from v2: shots 03, 05 and 07, 4 s shorter, music re-mixed under beat 04.</div>
          </div>
          <div class="li" style="padding: 12px 2px;">${crop('H_WING', ' width: 56px; height: 32px; border-radius: 5px; flex-shrink: 0;')}<div style="min-width: 0; flex-grow: 1;"><div class="a">v2 · 1 Sep 22:44</div><div class="b">3:52 · reviewed by Michelle</div></div></div>
          <div class="li" style="padding: 12px 2px;">${crop('H_ROBE', ' width: 56px; height: 32px; border-radius: 5px; flex-shrink: 0;')}<div style="min-width: 0; flex-grow: 1;"><div class="a">v1 · 30 Aug</div><div class="b">4:05 · first assembly</div></div></div>
          <div style="display: flex; align-items: center; margin: 16px 0 8px;"><span class="lbl" style="padding: 0;">On this cut</span><span class="cap" style="margin-left: auto;">2 comments</span></div>
          <div style="display: flex; gap: 9px; padding: 9px 0;">${av('michelle', 22)}<div style="min-width: 0;"><div style="font-size: 12px;"><b style="font-weight: 500;">Michelle Yip</b> <span class="cap">at 1:57</span></div><div style="font-size: 12px; color: #383838; margin-top: 3px; line-height: 1.5;">Hold the statue one more second before the cut.</div></div></div>
          <div style="display: flex; gap: 9px; padding: 9px 0;">${av('leung', 22)}<div style="min-width: 0;"><div style="font-size: 12px;"><b style="font-weight: 500;">Leung Chi-hang</b> <span class="cap">at 0:31</span></div><div style="font-size: 12px; color: #383838; margin-top: 3px; line-height: 1.5;">Dusk shot is the v2 render until 03 finishes.</div></div></div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 10px 14px 12px;" class="cap">Every render is kept in the Database with the project.</div>`)}
    </div>`;

const previewLogic = `
  renderVals() {
    var ar = this.state.ar || '169', cmp = !!this.state.cmp, self = this;
    var dims = { '169': [620, 349], '916': [196, 349], '11': [349, 349] }[ar];
    var cdims = { '169': [330, 186], '916': [150, 267], '11': [240, 240] }[ar];
    var seg = function (on) { return { b: on ? '#ffffff' : 'transparent', f: on ? '#171717' : '#7c7c7c', s: on ? '0px 1px 2px rgba(0, 0, 0, 0.1)' : 'none' }; };
    var A = seg(ar === '169'), B = seg(ar === '916'), C = seg(ar === '11');
    var pick = function (k) { return function () { self.setState({ ar: k }); }; };
    var ring = function (k) { return ar === k ? '0 0 0 2px #fff, 0 0 0 4px ' + self.accent() : 'none'; };
    return this.side({
      accent: this.accent(), single: !cmp, compare: cmp,
      fw: dims[0], fh: dims[1], cw: cdims[0], ch: cdims[1],
      a169: pick('169'), a916: pick('916'), a11: pick('11'),
      b169: A.b, f169: A.f, s169: A.s, b916: B.b, f916: B.f, s916: B.s, b11: C.b, f11: C.f, s11: C.s,
      ring_a169: ring('169'), ring_a916: ring('916'), ring_a11: ring('11'),
      toggleCompare: function () { self.setState({ cmp: !cmp }); },
      cmpLabel: cmp ? 'Exit compare' : 'Compare with v2',
      cmpStyle: cmp ? 'background: #171717; color: #ffffff; border-color: #171717;' : ''
    });
  }`;

/* =================================================================== */
/* AUDIO                                                               */
/* =================================================================== */
const TOTAL = 228;
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);
const wave = (W, H, from, to, amp, color, gap = 3) => {
  let d = '';
  for (let x = from; x < to; x += gap) { const a = Math.max(1.2, (0.25 + rnd() * 0.75) * amp); d += `M${x.toFixed(1)} ${(H / 2 - a / 2).toFixed(1)}v${a.toFixed(1)}`; }
  return `<path d="${d}" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>`;
};
const LW = 600;
const tx = s => (s / TOTAL) * LW;
const VO = [[2, 21], [26, 48], [52, 78], [84, 115], [118, 150], [152, 170], [172, 198], [204, 208], [212, 224]];
const voLane = `<svg viewBox="0 0 ${LW} 40" preserveAspectRatio="none" style="width: 100%; height: 40px; display: block;">${VO.map(([a, b]) => `<rect x="${tx(a)}" y="4" width="${tx(b) - tx(a)}" height="32" rx="4" fill="#eef1f4"/>` + wave(LW, 40, tx(a) + 3, tx(b) - 3, 26, '#525252')).join('')}</svg>`;
const env = (() => { const pts = [[0, 7]]; VO.forEach(([a, b]) => { pts.push([tx(a) - 4, 7], [tx(a) + 3, 27], [tx(b) - 3, 27], [tx(b) + 4, 7]); }); pts.push([LW, 7]); return pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' '); })();
const musicLane = `<svg viewBox="0 0 ${LW} 40" preserveAspectRatio="none" style="width: 100%; height: 40px; display: block;"><rect x="0" y="4" width="${LW}" height="32" rx="4" fill="#f5f5f5"/>${wave(LW, 40, 4, LW - 4, 22, '#c7c7c7', 2.6)}<polyline points="${env}" fill="none" stroke="{{accent}}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const SFX = [[26, 50, 'Oars'], [52, 80, 'Wind'], [84, 116, 'Fire'], [172, 196, 'Waves']];
const sfxLane = `<svg viewBox="0 0 ${LW} 40" preserveAspectRatio="none" style="width: 100%; height: 40px; display: block;">${SFX.map(([a, b]) => `<rect x="${tx(a)}" y="9" width="${tx(b) - tx(a)}" height="22" rx="5" fill="#f3f0ff"/>` + wave(LW, 40, tx(a) + 4, tx(b) - 4, 12, '#a896f0', 3)).join('')}</svg>`;
const sfxLabels = SFX.map(([a, , l]) => `<span style="position: absolute; left: ${(a / TOTAL * 100).toFixed(1)}%; top: 3px; margin-left: 6px; font-size: 10px; font-weight: 500; color: #6846e3;">${l}</span>`).join('');
const PH = (117 / TOTAL * 100).toFixed(1);
const audioMain = `${header('audio',
  '<div class="btn s">Play from 1:57</div><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Save mix</div>',
  '<span class="cap">Loudness −14 LUFS · YouTube target</span>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 16px 20px 0; overflow: hidden;">
        <div style="display: grid; grid-template-columns: 1.15fr 1fr .85fr; gap: 12px;">
          <div class="card" style="padding: 12px;">
            <div style="display: flex; align-items: center; margin-bottom: 6px;"><span class="lbl" style="padding: 0;">Voice</span><span class="cap" style="margin-left: auto;">English VO</span></div>
            <div class="tk on"><div class="play">${PLAY_SVG}</div><span style="flex-grow: 1; min-width: 0;">Azure · Ryan, en-GB</span>${okDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 16px; height: 16px; border-radius: 8px')}</div>
            <div class="tk"><div class="play">${PLAY_SVG}</div><span style="flex-grow: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">ElevenLabs · Chan’s clone</span><span class="cap">client account</span></div>
            <div class="tk"><div class="play">${PLAY_SVG}</div><span style="flex-grow: 1; min-width: 0;">Azure · WanLung, 粵語</span><span class="cap">dub</span></div>
          </div>
          <div class="card" style="padding: 12px;">
            <div style="display: flex; align-items: center; margin-bottom: 6px;"><span class="lbl" style="padding: 0;">Music</span><span class="cap" style="margin-left: auto;">From beat 01</span></div>
            <div class="tk on"><div class="play">${PLAY_SVG}</div><span style="flex-grow: 1; min-width: 0;">Aegean Drift</span><span class="bd grn">Cleared</span></div>
            <div class="tk"><div class="play">${PLAY_SVG}</div><span style="flex-grow: 1; min-width: 0;">Low Strings 04</span><span class="bd grn">Cleared</span></div>
            <div class="cap" style="padding: 7px 9px 0; line-height: 1.45;">Both licensed for commercial use.</div>
          </div>
          <div class="card" style="padding: 12px;">
            <div class="lbl" style="padding: 0;">Ducking</div>
            <div style="display: flex; align-items: baseline; gap: 6px; margin-top: 8px;"><span style="font-size: 22px; font-weight: 500;">−14</span><span class="mut">dB under voice</span></div>
            <div style="height: 4px; border-radius: 2px; background: #ededed; margin-top: 12px; position: relative;"><div style="width: 58%; height: 4px; border-radius: 2px; background: {{accent}};"></div><div style="position: absolute; left: 58%; top: -5px; width: 14px; height: 14px; margin-left: -7px; border-radius: 7px; background: #fff; box-shadow: 0 0 0 2px {{accent}}, 0 1px 3px rgba(0,0,0,.2);"></div></div>
            <div class="kv" style="margin-top: 12px; font-size: 12px;"><span>Fade in · out</span><span>120 · 400 ms</span></div>
          </div>
        </div>

        <div class="card" style="padding: 12px 14px 14px; margin-top: 14px;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;"><span class="lbl" style="padding: 0;">Mix</span><span class="cap">3:48 · 3 tracks</span><div style="flex-grow: 1;"></div><span class="cap">Blue line = music level</span></div>
          <div style="display: grid; grid-template-columns: 116px minmax(0, 1fr); gap: 8px 12px; align-items: center;">
            <div></div>
            <div style="display: flex; gap: 2px;">${SHOTS.map(([n, , , , , , sec]) => `<div style="flex: ${sec} 1 0; min-width: 0; height: 18px; border-radius: 4px; background: ${n === '05' ? '#e6f4ff' : '#f5f5f5'}; font-size: 10px; font-weight: 500; color: ${n === '05' ? '#007be0' : '#999999'}; display: flex; align-items: center; padding-left: 5px;">${n}</div>`).join('')}</div>
            <div><div style="font-size: 12px; color: #171717;">Voice-over</div><div class="cap">Ryan · 9 takes</div></div>
            <div class="lane" style="background: transparent;">${voLane}<div style="position: absolute; top: 0; bottom: 0; left: ${PH}%; width: 1.5px; background: {{accent}};"></div></div>
            <div><div style="font-size: 12px; color: #171717;">Music</div><div class="cap">Aegean Drift</div></div>
            <div class="lane" style="background: transparent;">${musicLane}<div style="position: absolute; top: 0; bottom: 0; left: ${PH}%; width: 1.5px; background: {{accent}};"></div></div>
            <div><div style="font-size: 12px; color: #171717;">Effects</div><div class="cap">4 cues</div></div>
            <div class="lane" style="background: transparent;">${sfxLane}${sfxLabels}<div style="position: absolute; top: 0; bottom: 0; left: ${PH}%; width: 1.5px; background: {{accent}};"></div></div>
            <div></div>
            <div style="display: flex; justify-content: space-between;"><span class="cap">0:00</span><span class="cap">1:00</span><span class="cap">2:00</span><span class="cap">3:00</span><span class="cap">3:48</span></div>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 8px; margin-top: 14px;">
          <span class="lbl" style="padding: 0;">Beat 05 takes</span><span class="cap">“By nightfall, the Persian fleet is broken.”</span>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 9px;">
          <div class="fc" style="height: 32px;"><div class="play" style="width: 20px; height: 20px;">${PLAY_SVG}</div>Take 1 · 0:27</div>
          <div class="fc" style="height: 32px;"><div class="play" style="width: 20px; height: 20px;">${PLAY_SVG}</div>Take 2 · 0:29</div>
          <div class="fc on" style="height: 32px;"><div class="play" style="width: 20px; height: 20px; border: none;">${PLAY_SVG}</div>Take 3 · 0:28 · in use</div>
          <div class="fc" style="height: 32px; color: {{accent}};">${SPARK}New take</div>
        </div>
      </div>
${rightPanel(['Agent', 'Comments'], 'Agent', agentBlock({
  scope: 'Audio · project 003',
  q: 'Is the music too loud anywhere?',
  tool: 'Measured the mix · 1.2 s',
  a: `<p>Only once. Between <b style="font-weight: 500;">1:21 and 1:26</b> the fire effect and music together sit 3 dB over the voice, so “Themistocles” is hard to hear.</p><p style="margin-top: 8px;">Ducking the effect by 4 dB there fixes it without touching the music.</p>`,
  act: 'Duck the effect',
  place: 'Ask about the mix…',
  guard: 'Uses only this project',
  cost: 'HK$0.02',
}))}
    </div>`;

/* =================================================================== */
/* EXPORT                                                              */
/* =================================================================== */
const fmt = (on, ar, w, h, spec, size) => `
          <div class="card" style="padding: 12px;${on ? '' : ' background: #fcfcfc;'}">
            <div style="height: 110px; border-radius: 9px; background: #f5f5f5; display: flex; align-items: center; justify-content: center;"><div style="width: ${w}px; height: ${h}px; border-radius: 5px; overflow: hidden; position: relative;${on ? '' : ' opacity: .45;'}">${crop('H_FULL', ' position: absolute; inset: 0;')}</div></div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 11px;">${cb(on)}<span style="font-size: 13px; font-weight: 500;">${ar}</span><span class="cap" style="margin-left: auto;">${size}</span></div>
            <div class="cap" style="margin-top: 5px;">${spec}</div>
          </div>`;
const extra = (on, name, meta, right = '') => `
          <div style="display: flex; align-items: center; gap: 11px; padding: 10px 0; border-bottom: 1px solid #f3f3f3;">${cb(on)}<div style="min-width: 0; flex-grow: 1;"><div style="font-size: 12.5px; color: ${on ? '#171717' : '#7c7c7c'};">${name}</div><div class="cap" style="margin-top: 2px;">${meta}</div></div>${right}</div>`;
const exportMain = `${header('export',
  '<div class="btn s">Estimate only</div>',
  '<span class="cap">Archives to the Database with the project</span>')}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; padding: 16px 20px 0; overflow: hidden; display: flex; gap: 18px;">
        <div style="flex-grow: 1; min-width: 0;">
          <div class="lbl" style="padding: 0; margin-bottom: 9px;">Formats</div>
          <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;">
${fmt(true, '16:9', 150, 84, '3840 × 2160 · H.264 · 18 Mbps', '~510 MB')}
${fmt(true, '9:16', 54, 96, '2160 × 3840 · H.264 · 18 Mbps', '~500 MB')}
${fmt(false, '1:1', 90, 90, '2160 × 2160 · H.264 · 14 Mbps', '~390 MB')}
          </div>
          <div class="lbl" style="padding: 0; margin: 18px 0 2px;">Also produce</div>
${extra(true, 'Subtitles · 繁中', 'subtitles_zh-HK.srt · from the locked script')}
${extra(true, 'Subtitles · English', 'subtitles_en.srt')}
${extra(true, 'Voice-over stem', 'voiceover_en_take-mix.wav · 48 kHz')}
${extra(false, 'Music stem', 'Off · the licence covers the mixed video only')}
${extra(true, 'Cover images', '3 sizes, from shot 08', `<div style="display: flex; gap: 5px; align-items: flex-end;">${crop('H_LETTERS', ' width: 48px; height: 27px; border-radius: 4px;')}${crop('H_HEAD', ' width: 17px; height: 30px; border-radius: 4px;')}${crop('H_FULL', ' width: 27px; height: 27px; border-radius: 4px;')}</div>`)}
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 14px; padding: 10px 12px; border-radius: 10px; background: #fafafa;">${ICON.folder(1.5)}<div style="min-width: 0; flex-grow: 1;"><div style="font-size: 12.5px;">Database · 2026-Q3-campaign · Renders</div><div class="cap" style="margin-top: 1px;">Same access as the project: 4 people</div></div><span style="font-size: 12px; color: {{accent}};">Change</span></div>
        </div>
        <div style="width: 250px; flex-shrink: 0;">
          <div class="card" style="padding: 14px;">
            <div class="lbl" style="padding: 0;">This export</div>
            <div class="kv" style="margin-top: 8px;"><span>Videos</span><span>2</span></div>
            <div class="kv"><span>Subtitle files</span><span>2</span></div>
            <div class="kv"><span>Audio stems</span><span>1</span></div>
            <div class="kv"><span>Cover images</span><span>3</span></div>
            <div class="kv" style="border: none;"><span>Estimate</span><span>HK$6.40 · ~9 min</span></div>
            <div style="display: flex; gap: 9px; margin-top: 10px; padding: 10px; border-radius: 9px; background: #fdfaf3; border: 1px solid #f7dcb0;">${warnDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 16px; height: 16px; border-radius: 8px')}<div style="font-size: 11.5px; line-height: 1.5; color: #8a5a0d;">Shots 03 and 07 aren’t ready. Export starts by itself when they are.</div></div>
            <div class="btn" style="width: 100%; justify-content: center; height: 32px; margin-top: 12px; background: {{accent}}; color: #fff; font-weight: 500;">Export when ready</div>
            <div class="btn s" style="width: 100%; justify-content: center; margin-top: 7px;">Export now with placeholders</div>
          </div>
          <div class="lbl" style="padding: 0; margin: 18px 0 4px;">Earlier exports</div>
          <div class="li" style="padding: 10px 0;">${okDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 16px; height: 16px; border-radius: 8px')}<div style="min-width: 0;"><div class="a">v2 · 1 Sep</div><div class="b">16:9, 9:16 · 7 files archived</div></div></div>
          <div class="li" style="padding: 10px 0; border: none;">${okDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 16px; height: 16px; border-radius: 8px')}<div style="min-width: 0;"><div class="a">v1 · 30 Aug</div><div class="b">16:9 draft · 2 files archived</div></div></div>
        </div>
      </div>
${rightPanel(['Agent', 'Comments'], 'Agent', agentBlock({
  scope: 'Export · project 003',
  q: 'Which formats does Publish need?',
  tool: 'Read the Publish composer · 0.4 s',
  a: `<p>Two posts are scheduled for 12 Sep: <b style="font-weight: 500;">YouTube</b> needs 16:9 and <b style="font-weight: 500;">Instagram Reels</b> needs 9:16. Both are ticked.</p><p style="margin-top: 8px;">Nothing asks for 1:1, so it’s off. LinkedIn would need it if you add that channel.</p>`,
  act: 'Open the composer',
  place: 'Ask about this export…',
  guard: 'Uses only this project',
  cost: 'HK$0.01',
}))}
    </div>`;

/* =================================================================== */
const out = [
  { file: 'Video-Library.dc.html', title: 'Library', me: 'chan', side: librarySidebar, main: libraryMain, logic: libraryLogic, props: ',"view":{"editor":"enum","options":["grid","list"],"default":"grid","section":"View"}' },
  { file: 'Video-Project.dc.html', title: 'Shots', me: 'chan', side: switcher('grc'), main: shotsMain, collapsed: true },
  { file: 'Video-Bin.dc.html', title: 'Media', me: 'chan', side: switcher('grc'), main: mediaMain },
  { file: 'Video-Queue.dc.html', title: 'Renders', me: 'chan', side: switcher('grc'), main: queueMain },
  { file: 'Video-Preview.dc.html', title: 'Preview', me: 'chan', side: switcher('grc'), main: previewMain, logic: previewLogic, collapsed: true },
  { file: 'Video-Audio.dc.html', title: 'Audio', me: 'chan', side: switcher('grc'), main: audioMain, collapsed: true },
  { file: 'Video-Export.dc.html', title: 'Export', me: 'chan', side: switcher('grc'), main: exportMain, collapsed: true },
];
for (const o of out) fs.writeFileSync(path.join(DIR, o.file), page(o));
console.log('wrote', out.map(o => o.file).join(', '));
