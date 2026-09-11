/**
 * Explode Desktop.dc.html (the router prototype) into one standalone
 * .dc.html artboard per screen, so every screen can be edited on its own
 * in the canvas editor.
 *
 * Each generated file carries the same shell · rail, sidebar, top bar,
 * agent panel · with the active states and per-module agent copy baked in.
 * Run:  node build-screens.mjs
 */
import fs from 'fs';
import path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.join(DIR, 'Desktop.dc.html'), 'utf8');

/* ---------- pull the shared CSS ---------- */
const css = src.slice(src.indexOf('<style>') + 7, src.indexOf('</style>'));

/* ---------- pull the module + agent tables out of the logic ---------- */
const logic = src.slice(src.indexOf('const AGENT'), src.indexOf('class Component'));
const AGENT = eval(logic.slice(0, logic.indexOf('const M = {')) + '; AGENT');
const M = eval(logic.slice(logic.indexOf('const M = {')) + '; M');

/* ---------- pull each screen body out of its sc-if ---------- */
function screenBody(flag) {
  const open = `<sc-if value="{{${flag}}}" hint-placeholder-val="{{ true }}">`;
  const i = src.indexOf(open);
  if (i < 0) return null;
  let depth = 0, j = i + open.length, start = j;
  while (j < src.length) {
    if (src.startsWith('<sc-if', j)) { depth++; j += 6; continue; }
    if (src.startsWith('</sc-if>', j)) {
      if (depth === 0) return src.slice(start, j);
      depth--; j += 8; continue;
    }
    j++;
  }
  return null;
}

/* STRIP_HANDLERS · standalone screens carry no router handlers */
const strip = h => h.replace(/ onClick="\{\{[^}]*\}\}"/g, '');

/* ---------- flag name per (module, sub) ---------- */
const cap = s => s[0].toUpperCase() + s.slice(1);
const FLAG = {
  chat: () => 'isChat',
  files: () => 'isFiles',
  res: s => 'isRes' + cap(s),
  script: s => 'isScript' + cap(s),
  video: s => 'isVid' + cap(s),
  pub: s => 'isPub' + cap(s),
  acc: s => 'isAcc' + cap(s),
  fin: s => 'isFin' + cap(s),
  legal: s => 'isLegal' + cap(s),
  hr: s => 'isHr' + cap(s),
  admin: s => 'isAdm' + cap(s),
};

/* ---------- rail icons, in order ---------- */
const RAIL = [
  ['chat', '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-2.8-.4L4 21l1.4-4.1A8.2 8.2 0 0 1 3.6 11.5 8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>', 'Chat'],
  ['files', '<path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z"/>', 'Database'],
  ['res', '<rect x="3.4" y="12.6" width="4.2" height="7.4" rx="1.5"/><rect x="9.9" y="8.4" width="4.2" height="11.6" rx="1.5"/><rect x="16.4" y="4" width="4.2" height="16" rx="1.5"/>', 'Market Research'],
  ['script', '<path d="M6.4 3.4h7.4L18.6 8v12.6H6.4z"/><path d="M9.4 12.3h6M9.4 15.6h6" stroke="#f8f8f8" stroke-width="1.5" fill="none"/>', 'Script'],
  ['video', '<rect x="3.4" y="5.4" width="12.4" height="13.2" rx="2.1"/><path d="m16.6 13 4.6 2.8V8.2L16.6 11z"/>', 'Video Edit'],
  ['pub', '<path d="M21.86 4.14a1.1 1.1 0 0 0-1.14-.18L2.9 11.13c-.86.34-.83 1.58.05 1.87l4.46 1.5 1.68 5.06c.24.72 1.15.93 1.68.38l2.4-2.5 4.4 3.23c.6.44 1.46.12 1.63-.6z"/>', 'Publish'],
  ['acc', '<rect x="5.4" y="3.4" width="13.2" height="17.2" rx="2"/><path d="M8.4 8h7.2M8.4 12h7.2M8.4 16h4" stroke="#f8f8f8" stroke-width="1.5" fill="none"/>', 'Accounting'],
  ['fin', '<circle cx="12" cy="12" r="8.6"/><path d="M14.8 9.4c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.9-2.8 2.1 0 2.9 5.7 1.4 5.7 4.3 0 1.2-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-2.9-1.6M12 6.4v1.4M12 16.3v1.4" stroke="#f8f8f8" stroke-width="1.5" fill="none"/>', 'Finance'],
  ['legal', '<path d="M12 3.2 4.4 6.2v5.6c0 4.4 3.1 8.3 7.6 9.3 4.5-1 7.6-4.9 7.6-9.3V6.2z"/>', 'Legal'],
  ['hr', '<circle cx="12" cy="7.8" r="3.7"/><path d="M4.7 20.2a7.3 7.3 0 0 1 14.6 0z"/>', 'Human Resources'],
  ['admin', '<path d="M4 7.4h16M4 12h16M4 16.6h16" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="9" cy="7.4" r="2.2"/><circle cx="15" cy="16.6" r="2.2"/>', 'Admin'],
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function build(mod, sub, label, hint, body) {
  const a = AGENT[mod] || AGENT.chat;
  const rail = RAIL.map(([k, icon]) => {
    const on = k === mod ? ' on' : '';
    const dim = k === 'hr' && mod !== 'hr' ? ' no' : '';
    const rule = k === 'pub' ? '<div style="width: 22px; height: 1px; background: #e2e2e2; margin: 6px 0;"></div>' : '';
    return `    <div class="r${on}${dim}"><svg viewBox="0 0 24 24">${icon}</svg></div>\n${rule ? '    ' + rule + '\n' : ''}`;
  }).join('');

  const nav = M[mod][1].map(([k, l]) =>
    `      <div class="n${k === sub ? ' on' : ''}"><span>${esc(l)}</span></div>`).join('\n');

  const tips = a[8].map(t =>
    `            <div style="min-height: 30px; padding: 7px 10px; border: 1px solid #ededed; border-radius: 8px; background: #fff; font-size: 12px; line-height: 1.45; color: #383838;">${esc(t)}</div>`).join('\n');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600&display=swap">
  <style>${css}</style>
</helmet>

<div style="width: 1440px; height: 900px; display: flex; background: #ffffff; color: #171717; overflow: hidden;">

  <!-- rail -->
  <div style="width: 52px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 3px;">
    <div style="width: 28px; height: 28px; border-radius: 8px; background: #171717; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 600; margin-bottom: 10px;">AF</div>
${rail}    <div style="flex-grow: 1;"></div>
    <img class="av" src="pfp-chan.jpg" style="width: 26px; height: 26px; border-radius: 13px;">
  </div>

  <!-- sidebar -->
  <div style="width: 212px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; padding: 10px 8px;">
    <div style="padding: 4px 9px 12px; font-size: 14px; font-weight: 500;">${esc(M[mod][0])}</div>
    <div class="lbl" style="margin-bottom: 5px;">Screens</div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
${nav}
    </div>
    <div style="margin-top: auto; padding: 10px 9px 4px; border-top: 1px solid #ededed;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
        <span style="font-size: 11px; color: #999999;">Your usage</span>
        <span style="font-size: 11px; color: #525252;">62%</span>
      </div>
      <div style="height: 4px; border-radius: 2px; background: #ededed;"><div style="width: 62%; height: 4px; border-radius: 2px; background: {{accent}};"></div></div>
    </div>
  </div>

  <!-- main -->
  <div style="flex-grow: 1; display: flex; flex-direction: column; min-width: 0;">
    <div class="bar">
      <span class="h1">${esc(label)}</span>
      <span class="mut">${esc(hint)}</span>
      <div style="flex-grow: 1;"></div>
      <div style="width: 260px; height: 28px; border: 1px solid #ededed; border-radius: 8px; background: #f8f8f8; display: flex; align-items: center; gap: 7px; padding: 0 9px;">
        <svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round;"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg>
        <span style="font-size: 12px; color: #999999;">Search</span>
      </div>
      <div style="position: relative; display: flex;">
        <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; stroke: #525252; fill: none; stroke-width: 1.7; stroke-linecap: round;"><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9z"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/></svg>
        <div style="position: absolute; top: 0; right: 0; width: 5px; height: 5px; border-radius: 3px; background: #e03636;"></div>
      </div>
    </div>

    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; display: flex; flex-direction: column; min-width: 0;">
${body}
      </div>

      <!-- agent -->
      <div style="width: 316px; flex-shrink: 0; border-left: 1px solid #ededed; background: #fcfcfc; display: flex; flex-direction: column;">
        <div style="height: 42px; flex-shrink: 0; display: flex; align-items: center; gap: 2px; padding: 0 10px; border-bottom: 1px solid #ededed;">
          <div style="height: 25px; padding: 0 10px; border-radius: 7px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500;">
            <svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: {{accent}}; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 4.2 19 8v8l-7 3.8L5 16V8z"/><path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8"/></svg>Agent
          </div>
          <div style="height: 25px; padding: 0 10px; border-radius: 7px; display: flex; align-items: center; font-size: 12px; color: #7c7c7c;">Sources</div>
          <div style="flex-grow: 1;"></div>
          <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="m10 6 6 6-6 6"/></svg>
        </div>
        <div style="flex-shrink: 0; padding: 11px 13px; border-bottom: 1px solid #f3f3f3;">
          <div style="display: inline-flex; align-items: center; gap: 7px; height: 25px; padding: 0 10px; border-radius: 7px; background: #fff; border: 1px solid #ededed;">
            <span style="width: 6px; height: 6px; border-radius: 3px; background: {{accent}};"></span>
            <span style="font-size: 11.5px; color: #525252;">${esc(a[0])}</span>
          </div>
        </div>
        <div style="flex-shrink: 0; padding: 13px 13px 3px;">
          <div class="lbl" style="padding: 0; margin-bottom: 8px;">Try here</div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
${tips}
          </div>
        </div>
        <div style="flex-grow: 1; min-height: 0; padding: 14px 13px 0; overflow: hidden;">
          <div style="display: flex; justify-content: flex-end; margin-bottom: 10px;">
            <div style="max-width: 240px; background: #f3f3f3; border-radius: 10px; padding: 8px 11px; font-size: 12px; line-height: 1.5; color: #383838;">${esc(a[4])}</div>
          </div>
          <div style="display: inline-flex; align-items: center; gap: 7px; height: 23px; padding: 0 9px; border: 1px solid #ededed; border-radius: 7px; background: #fff; margin-bottom: 9px;">
            <svg viewBox="0 0 24 24" style="width: 11px; height: 11px; stroke: #278f5e; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round;"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>
            <span style="font-size: 11px; color: #525252;">${esc(a[5])}</span>
          </div>
          <p style="font-size: 12px; line-height: 1.6; color: #383838; text-wrap: pretty;">${esc(a[6])}</p>
          <div style="display: flex; gap: 6px; margin-top: 11px;">
            <div class="btn p" style="height: 27px; font-size: 12px;">${esc(a[7])}</div>
            <div class="btn s" style="height: 27px; font-size: 12px;">Not now</div>
          </div>
        </div>
        <div style="flex-shrink: 0; padding: 11px 13px 9px;">
          <div style="border: 1px solid #e2e2e2; border-radius: 10px; background: #fff; padding: 9px 10px 7px; box-shadow: 0 1px 1px rgba(5,5,6,.04);">
            <div style="font-size: 12px; color: #999999;">${esc(a[1])}</div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 11px;">
              <span style="font-size: 10.5px; color: #999999;">gemini-2.5-pro</span>
              <div style="width: 25px; height: 25px; border-radius: 7px; background: {{accent}}; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #fff; fill: none; stroke-width: 2.3; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 19V5.5M6 11.5 12 5.5l6 6"/></svg></div>
            </div>
          </div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 9px 13px 11px; display: flex; align-items: center; gap: 7px;">
          <svg viewBox="0 0 24 24" style="width: 11px; height: 11px; flex-shrink: 0; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="M6.8 10.5h10.4v8H6.8z"/><path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5"/></svg>
          <span style="font-size: 10.5px; color: #999999; line-height: 1.4;">${esc(a[2])}</span>
          <span style="margin-left: auto; font-size: 10.5px; color: #999999; white-space: nowrap;">${esc(a[3])}</span>
        </div>
      </div>
    </div>
  </div>
</div>
</x-dc>
<script data-dc-script data-props='{"accent":{"editor":"color","default":"#007BE0","options":["#007BE0","#171717","#278F5E","#6846E3"],"section":"Theme"},"$preview":{"width":1440,"height":900}}'>
class Component extends DCLogic {
  renderVals() {
    const raw = this.props.accent ?? '#007BE0';
    return { accent: /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#007BE0' };
  }
}
</${'script'}>
</body>
</html>
`;
}

/* ---------- generate ---------- */
const NAME = { chat: 'Chat', files: 'Db', res: 'Res', script: 'Script', video: 'Video',
               pub: 'Pub', acc: 'Acc', fin: 'Fin', legal: 'Legal', hr: 'Hr', admin: 'Adm' };
const artboards = [];
let row = 0, made = 0, missing = [], kept = [];

/* Script is a library of many scripts; its stages are tabs inside one script */
const SCRIPT_ROW = [
  ['Script-Library.dc.html', 'Script · Library (all scripts)'],
  ['Script-Brief.dc.html', 'Script · one script · Brief tab'],
  ['Script-Editor.dc.html', 'Script · one script · Draft tab'],
  ['Script-Versions.dc.html', 'Script · one script · Versions tab'],
  ['Script-Lock.dc.html', 'Script · one script · Approval (approver)'],
  ['Script-Locked.dc.html', 'Script · a locked script (read-only)'],
];

/* Video Edit: a library of projects; one project's tabs follow */
const VIDEO_ROW = [
  ['Video-Library.dc.html', 'Video Edit · Library (all projects)'],
  ['Video-Project.dc.html', 'Video Edit · one project · Shots (sidebar collapsed)'],
  ['Video-Bin.dc.html', 'Video Edit · one project · Media'],
  ['Video-Queue.dc.html', 'Video Edit · one project · Renders'],
  ['Video-Preview.dc.html', 'Video Edit · one project · Preview'],
  ['Video-Audio.dc.html', 'Video Edit · one project · Audio'],
  ['Video-Export.dc.html', 'Video Edit · one project · Export'],
];

for (const mod of Object.keys(M)) {
  const [modName, subs] = M[mod];
  /* Database: the hand-built list / grid / gallery screen is the only desktop version */
  if (mod === 'files') {
    artboards.push({ file: 'FilesDesktop.dc.html', title: 'Database · list / grid / gallery', x: 0, y: row * 1020, w: 1440, h: 900, is_interactive: true });
    artboards.push({ file: 'FilesPhone.dc.html', title: 'Database · phone', x: 1540, y: row * 1020, w: 390, h: 844, is_interactive: true });
    made += 2; row++; continue;
  }
  if (mod === 'video') {
    VIDEO_ROW.forEach(([file, title], col) => { artboards.push({ file, title, x: col * 1540, y: row * 1020, w: 1440, h: 900, is_interactive: true }); made++; kept.push(file); });
    row++; continue;
  }
  if (mod === 'script') {
    SCRIPT_ROW.forEach(([file, title], col) => { artboards.push({ file, title, x: col * 1540, y: row * 1020, w: 1440, h: 900, is_interactive: true }); made++; kept.push(file); });
    row++; continue;
  }
  subs.forEach(([sub, label, hint], col) => {
    const flag = FLAG[mod](sub);
    const body = screenBody(flag);
    if (!body) { missing.push(flag); return; }
    const file = mod === 'chat' ? 'Main.dc.html' : `${NAME[mod]}-${sub[0].toUpperCase() + sub.slice(1)}.dc.html`;
    /* HAND_AUTHORED · never overwrite a screen that has been rebuilt by hand */
    const dest = path.join(DIR, file);
    if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8').includes('hand-authored')) { kept.push(file); artboards.push({ file, title: `${modName} · ${label}`, x: col * 1540, y: row * 1020, w: 1440, h: 900, is_interactive: true }); made++; return; }
    fs.writeFileSync(dest, build(mod, sub, label, hint, strip(body)));
    artboards.push({ file, title: `${modName} · ${label}`, x: col * 1540, y: row * 1020, w: 1440, h: 900 });
    made++;
  });
  row++;
}

/* phones: one per desktop screen, in a band to the right of each module's row */
const PHONE_X = 11000;
const PH = ['phones-a.json', 'phones-b.json', 'phones-c.json', 'phones-nav.json'].flatMap(f => fs.existsSync(path.join(DIR, f)) ? JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) : []);
PH.unshift({ file: 'ChatPhone.dc.html', mod: 'chat', title: 'Your agent' });
const perMod = {};
const phoneBoards = PH.map(p => {
  const r = Object.keys(M).indexOf(p.mod), i = perMod[p.mod] = (perMod[p.mod] ?? -1) + 1;
  /* navbar ideas get their own row above everything, from the left edge */
  if (p.mod === 'nav') return { file: p.file, title: `Navbar idea ${p.title}`, x: i * 470, y: -1020, w: 390, h: 844, is_interactive: true };
  return { file: p.file, title: `${M[p.mod][0]} · ${p.title} · phone`, x: PHONE_X + i * 470, y: r * 1020, w: 390, h: 844, is_interactive: true };
});

const canvas = {
  artboards: [
    ...artboards,
    { file: 'Chat-Channel.dc.html',  title: 'Chat · #production',    x: 1540, y: 0, w: 1440, h: 900 },
    { file: 'Chat-Announce.dc.html', title: 'Chat · #announcements', x: 3080, y: 0, w: 1440, h: 900 },
    { file: 'Login.dc.html',       title: 'Sign in',          x: 4620, y: 0,    w: 1440, h: 900 },
    { file: 'Login-Totp.dc.html',  title: 'Sign in · two-step', x: 6160, y: 0, w: 1440, h: 900 },
    ...phoneBoards,
  ],
  annotations: [{ id: 'nav-ideas', x: -430, y: -1000, w: 360, text: 'Phone navbar ideas A to E: the same Script screen with five different bottom bars. Pick one and every phone screen gets it.' }].concat(Object.keys(M).map((mod, i) => ({
    id: `mod-${mod}`, x: -430, y: i * 1020 + 20, w: 360,
    text: mod === 'chat' ? 'Chat · your agent, #production, #announcements, sign-in'
      : mod === 'video' ? 'Video Edit: a library of projects; open one and Shots · Media · Renders · Preview · Audio · Export are its tabs.'
      : mod === 'script' ?'Script · a library of every script; open one and Brief · Draft · Versions · Approval are its tabs. The left list switches scripts.' :`${M[mod][0]} · ${M[mod][1].length} screen${M[mod][1].length > 1 ? 's' : ''}`,
  }))),
  launch: { view: 'canvas' },
};
fs.writeFileSync(path.join(DIR, 'canvas.json'), JSON.stringify(canvas, null, 2) + '\n');

console.log(`generated ${made} screen artboards (${kept.length} hand-authored kept: ${kept.join(', ')})`);
if (missing.length) console.log('MISSING bodies for:', missing);
console.log('artboards in canvas.json:', canvas.artboards.length);
