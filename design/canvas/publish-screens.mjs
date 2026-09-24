/**
 * Publish, hand-authored, all four screens (§4.6). Built around the VIDEOS
 * being posted, so it's always clear which video a screen is about.
 *
 *   Pub-Channels   what's going where: videos × channels grid, then the
 *                  channels themselves as a quiet list (state, quota, audit)
 *   Pub-Composer   one video's post: which export, master + per-channel
 *                  versions, preview; list of other videos to switch to
 *   Pub-Approvals  requests as cards with approve / request changes /
 *                  reject and a small "Edit caption" button
 *   Pub-Log        what went where, the platform's answer, safe retries
 *
 * Run:  node publish-screens.mjs
 */
import fs from 'fs';
import path from 'path';
import { page as shellPage, P, av, rightPanel, agentBlock, moduleSidebar, topbar, chip, collapsible, toggleBtn, okDot, warnDot, TICK } from './shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CSS = `
    .logo { width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0; display: block; }
    .sec { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
    .sec b { font-size: 13px; font-weight: 500; color: #171717; }
    .grid .gh, .grid .gr { display: grid; grid-template-columns: minmax(0, 1fr) repeat(6, 76px); align-items: center; }
    .grid .gh { height: 40px; border-bottom: 1px solid #ededed; }
    .grid .gh > div:nth-child(n+2) { display: flex; justify-content: center; }
    .grid .gr { height: 52px; border-bottom: 1px solid #f3f3f3; }
    .grid .gr:last-child { border-bottom: none; }
    .grid .gr > div:nth-child(n+2) { display: flex; flex-direction: column; align-items: center; gap: 3px; }
    .cell { width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
    .cell svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .cd { font-size: 10px; color: #999999; white-space: nowrap; }
    .cl .ch2, .cl .cr { display: grid; grid-template-columns: minmax(0, 1.2fr) 150px minmax(0, 1fr) 128px 96px; align-items: center; }
    .cl .ch2 { height: 28px; border-bottom: 1px solid #ededed; }
    .cl .ch2 > * { font-size: 10.5px; font-weight: 500; color: #7c7c7c; padding: 0 10px; }
    .cl .cr { height: 40px; border-bottom: 1px solid #f3f3f3; }
    .cl .cr:last-child { border-bottom: none; }
    .cl .cr > * { font-size: 12.5px; color: #383838; padding: 0 10px; min-width: 0; display: flex; align-items: center; gap: 8px; }
    .el { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
    .qm { height: 4px; border-radius: 2px; background: #ededed; flex-grow: 1; }
    .qm div { height: 4px; border-radius: 2px; background: var(--ac); }
    .ctab { height: 40px; display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #7c7c7c; border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
    .ctab.on { color: #171717; font-weight: 500; border-color: #171717; }
    .ctab .od { width: 6px; height: 6px; border-radius: 3px; background: #f5a524; }
    .fl { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 500; color: #7c7c7c; margin-bottom: 6px; }
    .fl .cnt { margin-left: auto; font-weight: 420; color: #999999; font-variant-numeric: tabular-nums; }
    .inp { min-height: 34px; border-radius: 8px; background: #f3f3f3; display: flex; align-items: center; gap: 8px; padding: 0 11px; font-size: 13px; color: #171717; }
    .tagc { height: 24px; padding: 0 9px; border-radius: 7px; background: #fff; border: 1px solid #e2e2e2; font-size: 12px; display: inline-flex; align-items: center; }
    .ap { border: 1px solid #ededed; border-radius: 14px; background: #fff; padding: 12px; display: flex; gap: 14px; align-items: center; }
    .ap.on { border-color: #d6eafc; box-shadow: 0 0 0 3px #eff6ff; }
    .ibtn { height: 30px; padding: 0 10px; border-radius: 8px; border: 1px solid #ededed; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #525252; white-space: nowrap; }
    .ibtn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .lg2 .lr { display: grid; grid-template-columns: 52px minmax(0, 1fr) 130px 40px minmax(0, 1.1fr); align-items: center; height: 48px; border-bottom: 1px solid #f3f3f3; font-size: 12.5px; color: #383838; }
    .lg2 .lr > * { min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 8px; }
    .day { font-size: 11px; font-weight: 500; color: #7c7c7c; margin: 14px 0 2px 8px; }`;

/* ---------- brand marks ---------- */
const LOGO = {
  yt: '<svg class="logo" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#ff0000"/><path d="M14.5 12.2v11.6l9.6-5.8z" fill="#fff"/></svg>',
  ig: '<svg class="logo" viewBox="0 0 36 36"><defs><linearGradient id="igg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".35" stop-color="#fa7e1e"/><stop offset=".6" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect width="36" height="36" rx="10" fill="url(#igg)"/><rect x="9.5" y="9.5" width="17" height="17" rx="5" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="18" cy="18" r="4" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="23.2" cy="12.8" r="1.3" fill="#fff"/></svg>',
  li: '<svg class="logo" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#0a66c2"/><rect x="10" y="15" width="3.6" height="11" fill="#fff"/><circle cx="11.8" cy="11.2" r="2.1" fill="#fff"/><path d="M16.6 15h3.4v1.6c.6-1.1 2-1.9 3.6-1.9 3 0 3.8 1.9 3.8 4.6V26h-3.6v-5.9c0-1.4-.3-2.4-1.7-2.4s-1.9 1-1.9 2.4V26h-3.6z" fill="#fff"/></svg>',
  tt: '<svg class="logo" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#111"/><path d="M19.6 9.5h3.2c.3 2.3 1.8 3.8 4 4v3.2c-1.5 0-2.8-.4-4-1.2v6.2a5.6 5.6 0 1 1-5.6-5.6h.6v3.3a2.4 2.4 0 1 0 1.8 2.3z" fill="#25f4ee" transform="translate(-.8 -.6)"/><path d="M19.6 9.5h3.2c.3 2.3 1.8 3.8 4 4v3.2c-1.5 0-2.8-.4-4-1.2v6.2a5.6 5.6 0 1 1-5.6-5.6h.6v3.3a2.4 2.4 0 1 0 1.8 2.3z" fill="#fe2c55" transform="translate(.8 .6)"/><path d="M19.6 9.5h3.2c.3 2.3 1.8 3.8 4 4v3.2c-1.5 0-2.8-.4-4-1.2v6.2a5.6 5.6 0 1 1-5.6-5.6h.6v3.3a2.4 2.4 0 1 0 1.8 2.3z" fill="#fff"/></svg>',
  x: '<svg class="logo" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#000"/><path d="M10.5 10h4.6l4.2 5.9 5-5.9h2.1l-6.2 7.3 7.3 10.2h-4.6l-4.6-6.4-5.5 6.4h-2.1l6.7-7.8z" fill="#fff"/></svg>',
  wc: '<svg class="logo" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#07c160"/><ellipse cx="15" cy="15.5" rx="7" ry="5.8" fill="#fff"/><ellipse cx="21.5" cy="20.5" rx="6" ry="5" fill="#fff" stroke="#07c160" stroke-width="1.4"/><circle cx="12.6" cy="14.4" r=".95" fill="#07c160"/><circle cx="17.2" cy="14.4" r=".95" fill="#07c160"/><circle cx="19.6" cy="19.8" r=".8" fill="#07c160"/><circle cx="23.4" cy="19.8" r=".8" fill="#07c160"/></svg>',
  xhs: '<svg class="logo" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#ff2442"/><text x="18" y="21.5" text-anchor="middle" font-family="PingFang SC, Noto Sans SC, sans-serif" font-size="9.5" font-weight="700" fill="#fff">小红书</text></svg>',
  bili: '<svg class="logo" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#00a1d6"/><rect x="9" y="12.5" width="18" height="13" rx="3.2" fill="none" stroke="#fff" stroke-width="2"/><path d="m13.5 9.2 2.4 2.8M22.5 9.2l-2.4 2.8" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M14.3 17.6v2.2M21.7 17.6v2.2" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
};
const logo = (k, s) => LOGO[k].replace('<svg class="logo"', `<svg class="logo" style="width: ${s}px; height: ${s}px; border-radius: ${Math.round(s * .28)}px;"`);
const CHN = { yt: 'YouTube', ig: 'Instagram', li: 'LinkedIn', tt: 'TikTok', x: 'X', wc: 'WeChat', xhs: 'Xiaohongshu', bili: 'Bilibili' };

/* ---------- covers ---------- */
const CROP = { history: ['history', 1, 50, 50], head: ['history', 3.3, 57, 24], letters: ['history', 2.3, 6, 42], orange: ['orange', 1, 50, 50], porsche: ['porsche', 1, 50, 50], domore: ['domore', 1, 50, 50], goodday: ['goodday', 1, 50, 50] };
const crop = (k, style = '') => { const [f, z0, x, y] = CROP[k]; const z = Math.min(1.4, z0); return `<div style="overflow: hidden; position: relative; flex-shrink: 0; background: #f3f3f3;${style}"><img src="cover-${f}.jpg" style="width: 100%; height: 100%; object-fit: cover; object-position: ${x}% ${y}%;${z !== 1 ? ` transform: scale(${z}); transform-origin: ${x}% ${y}%;` : ''}"></div>`; };

/* ---------- the videos ---------- */
const VID = {
  grc: ['History of Greece · Ep 75', 'history', '3:48', 'Export v3 · 16:9 and 9:16'],
  org: ['Orange typography cut', 'orange', '0:15', 'Export v2 · 1:1'],
  gdy: ['Good day · collage teaser', 'goodday', '0:20', 'Export v2 · 9:16 and 1:1'],
  prs: ['Porsche cat · night drive', 'porsche', '0:30', 'Export v3 · 9:16'],
  dmo: ['Do more · brand spot', 'domore', '0:45', 'Export v2 · 9:16'],
};

const NAV = [['channels', 'Channel board'], ['composer', 'Caption'], ['approvals', 'Approval queue'], ['log', 'Publish log']];
const side = cur => moduleSidebar('Publish', NAV, cur, {
  badges: { approvals: '<i>2</i>' },
  footer: '<div class="cap" style="line-height: 1.5;">Nothing leaves the platform without an approval record.</div>',
});
const page = o => shellPage({ module: 'Publish', gen: 'publish-screens.mjs', active: 'pub', extraCss: CSS, ...o });
const layout = (top, body, panel) => `${top}
    <div style="flex-grow: 1; display: flex; min-height: 0;"><div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden;">${body}</div>${panel}</div>`;
const EDIT = '<svg viewBox="0 0 24 24"><path d="M4.5 19.5h4l10-10-4-4-10 10z"/><path d="m13 7 4 4"/></svg>';

/* =================================================================== */
/* CHANNEL BOARD                                                       */
/* =================================================================== */
const CELL = {
  posted: ['#e4faeb', '#278f5e', '<path d="M3.6 8.3 6.5 11.2 12.4 5.1"/>', 'Posted'],
  sched: ['#e6f4ff', '#007be0', '<circle cx="8" cy="8" r="5.2"/><path d="M8 5.4V8l1.8 1.2"/>', 'Scheduled'],
  wait: ['#fff7d3', '#b36b00', '<path d="M5 3h6M5 13h6M5.5 3.2c0 2.6 5 2.8 5 4.8S5.5 10.2 5.5 12.8M10.5 3.2c0 2.6-5 2.8-5 4.8s5 2.2 5 4.8"/>', 'Waiting for approval'],
  priv: ['#f3f3f3', '#7c7c7c', '<rect x="4.2" y="7.2" width="7.6" height="5.6" rx="1.3"/><path d="M5.8 7.2V5.8a2.2 2.2 0 0 1 4.4 0v1.4"/>', 'Private only'],
  fail: ['#ffe7e7', '#e03636', '<path d="M8 4v5M8 11.6v.2"/>', 'Failed'],
};
const COLS = ['yt', 'ig', 'li', 'tt', 'x', 'wc'];
const ROWS = [
  ['grc', 'Waiting for Michelle', { yt: ['wait', '12 Sep'], ig: ['wait', '12 Sep'], li: ['wait', '12 Sep'] }],
  ['org', 'Posted · 31 Aug', { yt: ['priv', 'audit'], x: ['posted', '31 Aug'] }],
  ['gdy', 'Needs a fix', { ig: ['posted', '11 Aug'], li: ['fail', 'retry'] }],
  ['prs', 'Posted · 2 Sep', { ig: ['posted', '2 Sep'] }],
  ['dmo', 'Posted · 24 Aug', { ig: ['posted', '24 Aug'], wc: ['posted', 'draft'] }],
];
const cellHtml = c => c
  ? `<div class="cell" style="background: ${CELL[c[0]][0]}; color: ${CELL[c[0]][1]};" title="${CELL[c[0]][3]}"><svg viewBox="0 0 16 16">${CELL[c[0]][2]}</svg></div><span class="cd">${c[1]}</span>`
  : '<div class="cell"><span style="width: 5px; height: 5px; border-radius: 3px; background: #e2e2e2;"></span></div><span class="cd">&nbsp;</span>';
const CHS = [
  ['yt', '@aurafarmers', ['#f5a524', 'Waiting on audit'], 'Posts go up private for now', 82, '28 Aug'],
  ['ig', '@aurafarmers.hk', ['#30a46c', 'Connected'], 'Reels, insights', 64, '2 Sep'],
  ['li', 'Aura Farmers Ltd', ['#30a46c', 'Connected'], 'Page posts', 91, '11 Aug'],
  ['tt', '@aurafarmers', ['#f5a524', 'Waiting on audit'], 'Lands in the TikTok inbox', 100, 'Never'],
  ['x', '@aurafarmers', ['#30a46c', 'Connected'], 'Posts, media', 38, '31 Aug'],
  ['wc', 'Aura Farmers 官方号', ['#30a46c', 'Connected'], 'Drafts, comments', 70, '24 Aug'],
  ['xhs', 'No publishing API', ['#c7c7c7', 'Manual'], 'We export an asset pack', null, '19 Aug'],
  ['bili', 'No publishing API', ['#c7c7c7', 'Manual'], 'We export an asset pack', null, 'Never'],
];
const channelsBody = `
      <div style="flex-grow: 1; min-height: 0; padding: 14px 20px 0; overflow: hidden;">
        <div class="sec"><b>What’s going where</b><span class="cap">every exported video and each channel</span>
          <div style="margin-left: auto; display: flex; gap: 12px;">${['posted', 'sched', 'wait', 'priv', 'fail'].map(k => `<span class="cap" style="display: flex; align-items: center; gap: 5px;"><span style="width: 9px; height: 9px; border-radius: 3px; background: ${CELL[k][0]}; box-shadow: inset 0 0 0 1.5px ${CELL[k][1]};"></span>${CELL[k][3]}</span>`).join('')}</div>
        </div>
        <div class="grid" style="border: 1px solid #ededed; border-radius: 12px; padding: 0 6px;">
          <div class="gh"><div class="cap" style="padding-left: 6px;">Video</div>${COLS.map(k => `<div title="${CHN[k]}">${logo(k, 22)}</div>`).join('')}</div>
${ROWS.map(([id, st, cells], i) => { const [t, cov, dur, ex] = VID[id]; return `          <div class="gr"><div style="display: flex; align-items: center; gap: 10px; min-width: 0; padding-left: 6px;">${crop(cov, ' width: 64px; height: 36px; border-radius: 6px;')}<div style="min-width: 0;"><div class="el" style="font-size: 12.5px; font-weight: 500;">${t}</div><div class="cap el" style="margin-top: 2px;">${ex} · <span style="color: ${i === 0 ? '#b36b00' : i === 2 ? '#e03636' : '#7c7c7c'};">${st}</span></div></div></div>${COLS.map(k => `<div>${cellHtml(cells[k])}</div>`).join('')}</div>`; }).join('\n')}
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;"><span class="cap">Not ready yet: Sham Shui Po dai pai dong revival, still in Video Edit.</span><span class="cap" style="margin-left: auto; color: {{accent}};">Open Caption</span></div>

        <div class="sec" style="margin-top: 20px;"><b>Channels</b><span class="cap">8 accounts, all registered in the client’s name</span></div>
        <div class="cl" style="border: 1px solid #ededed; border-radius: 12px; overflow: hidden;">
          <div class="ch2"><div>Channel</div><div>Status</div><div>What we can do</div><div>Today’s quota</div><div>Last post</div></div>
${CHS.map(([k, h, [dc, st], can, q, last]) => `          <div class="cr"><div>${logo(k, 24)}<div style="min-width: 0;"><div class="el" style="color: #171717;">${CHN[k]}</div><div class="el cap">${h}</div></div></div><div><span class="dot" style="width: 7px; height: 7px; background: ${dc};"></span><span class="el">${st}</span></div><div><span class="el" style="color: #7c7c7c;">${can}</span></div><div>${q == null ? '<span class="cap">Not used</span>' : `<div class="qm"><div style="width: ${q}%;"></div></div><span class="cap" style="width: 30px; text-align: right;">${q}%</span>`}</div><div style="color: #7c7c7c;">${last}</div></div>`).join('\n')}
        </div>
      </div>`;
const channelsTop = topbar('Channel board', 'which video is going to which channel', '<div class="btn s">Connect a channel</div>');

/* =================================================================== */
/* COMPOSER                                                            */
/* =================================================================== */
const POSTS = [['Drafting', [['grc', 'Draft · 3 channels', 1]]], ['Waiting for approval', [['org', 'YouTube public version']]], ['Needs a fix', [['gdy', 'LinkedIn · file too large']]], ['Posted', [['prs', 'Instagram'], ['dmo', 'Instagram, WeChat']]]];
const switcher = collapsible(`
  <div style="width: 240px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; padding: 8px 8px 10px;">
    <div style="display: flex; align-items: center; padding: 0 0 0 9px;"><span style="font-size: 14px; font-weight: 500;">Captions</span><div style="margin-left: auto;">${toggleBtn('Hide the post list')}</div></div>
    <div class="btn" style="justify-content: center; margin: 10px 1px 2px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717;"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>New post from a video</div>
${POSTS.map(([g, items]) => `    <div class="sg"><svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>${g}<span style="margin-left: auto; font-weight: 420;">${items.length}</span></div>
${items.map(([id, sub, on]) => `    <div class="sn${on ? ' on' : ''}" style="height: 44px; align-items: center;">${crop(VID[id][1], ' width: 36px; height: 20px; border-radius: 4px;')}<span style="display: flex; flex-direction: column; min-width: 0;"><span class="el">${VID[id][0]}</span><span class="cap el" style="font-weight: 420;">${sub}</span></span></div>`).join('\n')}`).join('\n')}
    <div class="sg"><svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>Not ready yet<span style="margin-left: auto; font-weight: 420;">1</span></div>
    <div class="sn" style="height: 44px; opacity: .55;"><div style="width: 36px; height: 20px; border-radius: 4px; background: #ededed; flex-shrink: 0;"></div><span style="display: flex; flex-direction: column; min-width: 0;"><span class="el">Sham Shui Po revival</span><span class="cap el" style="font-weight: 420;">Still in Video Edit</span></span></div>
  </div>`, `
  <div class="mini">
    ${toggleBtn('Show the post list')}
    <div style="width: 22px; height: 1px; background: #e2e2e2; margin: 6px 0 4px;"></div>
${['grc', 'org', 'gdy', 'prs', 'dmo'].map(id => `    <div class="mi${id === 'grc' ? ' on' : ''}" title="${VID[id][0]}">${crop(VID[id][1], ' width: 28px; height: 16px; border-radius: 3px;')}</div>`).join('\n')}
  </div>`);
const composerBody = `
    <div style="height: 64px; flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding: 0 20px; border-bottom: 1px solid #ededed;">
      ${crop('history', ' width: 72px; height: 40px; border-radius: 7px;')}
      <div style="min-width: 0;"><div style="display: flex; align-items: center; gap: 8px;"><span style="font-size: 14.5px; font-weight: 500;">History of Greece · Ep 75</span><span class="bd gray">Draft</span></div><div class="cap" style="margin-top: 3px;">Export v3 from Video Edit · 16:9 and 9:16 · 3:48</div></div>
      <div style="flex-grow: 1;"></div>
      <span class="cap" style="white-space: nowrap;">Saved 1 min ago</span>
      <div class="btn s">Preview all</div>
      <div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Send for approval</div>
    </div>
    <div style="height: 40px; flex-shrink: 0; display: flex; align-items: stretch; gap: 20px; padding: 0 20px; border-bottom: 1px solid #ededed;">
      <div class="ctab"><svg viewBox="0 0 24 24" style="width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.8;"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>Master<span class="cap">shared text</span></div>
      <div class="ctab on">${logo('yt', 16)}YouTube<span class="od" title="Changed for YouTube"></span></div>
      <div class="ctab">${logo('ig', 16)}Instagram<span class="od"></span></div>
      <div class="ctab">${logo('li', 16)}LinkedIn</div>
      <div class="ctab" style="color: {{accent}};">+ Add channel</div>
    </div>
    <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 14px 20px 0;">
      <div style="display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px; background: #fafafa; margin-bottom: 14px;"><span style="font-size: 12.5px; color: #525252;">You’re editing the <b style="font-weight: 500; color: #171717;">YouTube</b> version. Anything you leave alone follows Master.</span><span class="cap" style="margin-left: auto; color: {{accent}}; white-space: nowrap;">Reset to Master</span></div>
      <div class="fl">Title<span class="bd amb" style="height: 18px; font-size: 10.5px;">Changed for YouTube</span><span class="cnt">58 / 100</span></div>
      <div class="inp">The Battle of Salamis in 4 minutes | History of Greece Ep 75</div>
      <div class="fl" style="margin-top: 14px;">Description<span class="cnt">612 / 5,000</span></div>
      <div class="inp" style="min-height: 74px; align-items: flex-start; padding-top: 9px; line-height: 1.55; font-size: 12.5px;">In 480 BC a Persian fleet gathers off Attica. How did the Greeks win in a strait barely a mile wide? Chapters: 0:00 The fleet · 0:50 The narrows · 1:57 Nightfall.</div>
      <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; margin-top: 14px;">
        <div><div class="fl">Tags<span class="cnt">6 / 15</span></div><div style="display: flex; gap: 5px; flex-wrap: wrap;"><span class="tagc">history</span><span class="tagc">greece</span><span class="tagc">salamis</span><span class="tagc">粤语字幕</span><span class="tagc" style="border-style: solid; color: #999999;">+ Tag</span></div></div>
        <div><div class="fl">Video file</div><div class="inp" style="font-size: 12.5px;">${crop('history', ' width: 32px; height: 18px; border-radius: 3px;')}16:9 · 3:48<span class="cap" style="margin-left: auto;">繁中 + EN subtitles</span></div></div>
      </div>
      <div class="fl" style="margin-top: 14px;">Thumbnail<span class="cnt">1280 × 720</span></div>
      <div style="display: flex; gap: 10px;">
        <div style="box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--ac); border-radius: 7px;">${crop('letters', ' width: 112px; height: 63px; border-radius: 7px;')}</div>
        ${crop('head', ' width: 112px; height: 63px; border-radius: 7px;')}
        ${crop('history', ' width: 112px; height: 63px; border-radius: 7px;')}
        <div style="width: 112px; height: 63px; border-radius: 7px; background: #f8f8f8; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #525252;">Upload</div>
      </div>
      <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; margin-top: 14px;">
        <div><div class="fl">Who can see it</div><div class="inp" style="background: #fffbf0; box-shadow: inset 0 0 0 1px #f7dcb0; font-size: 12.5px;">Private until YouTube’s audit passes</div></div>
        <div><div class="fl">When</div><div class="inp" style="font-size: 12.5px;">Sat 12 Sep · 19:30 HKT<span class="cap" style="margin-left: auto;">busiest hour</span></div></div>
      </div>
    </div>`;
const composerPanel = rightPanel(['Preview', 'Agent'], 'Preview', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 14px;">
          <div class="cap" style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">${logo('yt', 14)}How it will look on YouTube</div>
          <div style="position: relative;">${crop('letters', ' width: 100%; aspect-ratio: 16 / 9; border-radius: 10px;')}<span style="position: absolute; right: 6px; bottom: 6px; background: rgba(0,0,0,.8); color: #fff; font-size: 10.5px; padding: 1px 5px; border-radius: 4px;">3:48</span></div>
          <div style="display: flex; gap: 9px; margin-top: 10px;"><div style="width: 30px; height: 30px; border-radius: 15px; background: #171717; color: #fff; font-size: 10px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">AF</div><div style="min-width: 0;"><div style="font-size: 13px; font-weight: 500; line-height: 1.35;">The Battle of Salamis in 4 minutes | History of Greece Ep 75</div><div class="cap" style="margin-top: 3px;">Aura Farmers · 48.2k subscribers · Sat 12 Sep</div></div></div>
          <div class="lbl" style="padding: 0; margin: 16px 0 4px;">Checks for YouTube</div>
          <div class="li" style="padding: 7px 0;">${okDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 15px; height: 15px; border-radius: 8px')}<div class="a" style="font-size: 12px;">Title and description within limits</div></div>
          <div class="li" style="padding: 7px 0;">${okDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 15px; height: 15px; border-radius: 8px')}<div class="a" style="font-size: 12px;">Thumbnail is 1280 × 720</div></div>
          <div class="li" style="padding: 7px 0;">${okDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 15px; height: 15px; border-radius: 8px')}<div class="a" style="font-size: 12px;">Subtitles attached</div></div>
          <div class="li" style="padding: 7px 0; border: none;">${warnDot.replace('width: 18px; height: 18px; border-radius: 9px', 'width: 15px; height: 15px; border-radius: 8px')}<div class="a" style="font-size: 12px;">Goes up private until the audit passes</div></div>
          <div class="lbl" style="padding: 0; margin: 12px 0 6px;">Also in this post</div>
          <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 6px;">${logo('ig', 18)}Instagram Reel · 9:16<span class="cap" style="margin-left: auto;">caption changed</span></div>
          <div style="display: flex; align-items: center; gap: 8px; font-size: 12px;">${logo('li', 18)}LinkedIn · 16:9<span class="cap" style="margin-left: auto;">follows Master</span></div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 10px 14px 12px;" class="cap">Nothing is posted until Michelle Yip approves it.</div>`);

/* =================================================================== */
/* APPROVAL QUEUE                                                      */
/* =================================================================== */
const apCard = ({ id, chans, when, who, ago, note, on, actions = true }) => { const [t, cov, dur] = VID[id]; return `
        <div class="ap${on ? ' on' : ''}">
          <div style="position: relative;">${crop(cov, ' width: 128px; height: 72px; border-radius: 9px;')}<span style="position: absolute; right: 5px; bottom: 5px; background: rgba(0,0,0,.72); color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 4px;">${dur}</span></div>
          <div style="min-width: 0; flex-grow: 1;">
            <div style="font-size: 13.5px; font-weight: 500;">${t}</div>
            <div style="display: flex; align-items: center; gap: 6px; margin-top: 6px;">${chans.map(k => logo(k, 18)).join('')}<span class="cap" style="margin-left: 4px;">${chans.map(k => CHN[k]).join(', ')} · ${when}</span></div>
            <div style="display: flex; align-items: center; gap: 7px; margin-top: 7px;">${av(who, 18)}<span style="font-size: 12px; color: #525252; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><b style="font-weight: 500; color: #171717;">${P[who][1]}</b> ${ago}${note ? ` · “${note}”` : ''}</span></div>
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0;">
            ${actions ? `<div style="display: flex; gap: 6px;"><div class="btn" style="background: {{accent}}; color: #fff; font-weight: 500;">Approve</div><div class="btn s">Request changes</div></div>` : ''}
            <div style="display: flex; gap: 10px; align-items: center;">${actions ? '<span style="font-size: 12px; color: #e03636;">Reject</span>' : ''}<div class="ibtn">${EDIT}Edit caption</div></div>
          </div>
        </div>`; };
const approvalsBody = `
      <div style="flex-grow: 1; min-height: 0; padding: 14px 20px 0; overflow: hidden; display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 6px;"><div class="fc on">Waiting for you <b>2</b></div><div class="fc">Waiting for others <b>1</b></div><div class="fc">Decided <b>14</b></div><div style="flex-grow: 1;"></div><span class="cap">Every decision is saved with your name and the time</span></div>
${apCard({ id: 'grc', chans: ['yt', 'ig', 'li'], when: 'Sat 12 Sep, 19:30', who: 'chan', ago: 'asked 2 h ago', note: 'Subtitles checked by Leung', on: 1 })}
${apCard({ id: 'org', chans: ['yt'], when: 'as soon as the audit passes', who: 'leung', ago: 'asked yesterday', note: 'Public version of the 31 Aug draft' })}
        <div class="sec" style="margin: 8px 0 0;"><b>Waiting for others</b></div>
${apCard({ id: 'gdy', chans: ['li'], when: 'retry', who: 'amy', ago: 'is making a smaller file', actions: false })}
        <div class="sec" style="margin: 8px 0 0;"><b>Decided recently</b><span class="cap" style="margin-left: auto; color: {{accent}};">See all 14</span></div>
        <div style="border: 1px solid #ededed; border-radius: 12px; padding: 2px 12px;">
          ${[['prs', ['ig'], 'Approved by you · 1 Sep'], ['org', ['x'], 'Approved by you · 31 Aug'], ['dmo', ['ig', 'wc'], 'Approved by you · 23 Aug']].map(([id, ch, s], i) => `<div style="display: flex; align-items: center; gap: 10px; height: 44px;${i < 2 ? ' border-bottom: 1px solid #f3f3f3;' : ''}">${crop(VID[id][1], ' width: 44px; height: 25px; border-radius: 4px;')}<span style="font-size: 12.5px; flex-grow: 1; min-width: 0;" class="el">${VID[id][0]}</span>${ch.map(k => logo(k, 16)).join('')}<span class="bd grn" style="margin-left: 6px;">${s}</span></div>`).join('')}
        </div>
      </div>`;
const approvalsPanel = rightPanel(['Preview', 'Agent'], 'Preview', `
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 14px;">
          <div style="font-size: 13px; font-weight: 500;">You’re approving 3 posts</div>
          <div class="cap" style="margin-top: 3px;">History of Greece · Ep 75 · Sat 12 Sep, 19:30</div>
          ${[['yt', 'The Battle of Salamis in 4 minutes | History of Greece Ep 75', 'Private until the audit passes'], ['ig', '480 BC. One strait, two fleets. 海峡决定一切。 #history #greece', 'Reel · 9:16'], ['li', 'How a narrow strait decided a war: our new History of Greece episode.', 'Follows Master']].map(([k, txt, s]) => `<div style="margin-top: 12px; padding: 10px 11px; border: 1px solid #ededed; border-radius: 11px; background: #fff;"><div style="display: flex; align-items: center; gap: 7px;">${logo(k, 18)}<span style="font-size: 12px; font-weight: 500;">${CHN[k]}</span><span class="cap" style="margin-left: auto;">${s}</span></div><div style="font-size: 12px; line-height: 1.5; color: #383838; margin-top: 7px;">${txt}</div></div>`).join('')}
          <div style="margin-top: 14px; padding: 10px 11px; border-radius: 10px; background: #fafafa;"><div style="font-size: 12px; font-weight: 500;">Before you approve</div><div class="cap" style="line-height: 1.5; margin-top: 4px;">Script v6 is locked, subtitles are attached, and all three posts pass their channel’s rules.</div></div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 10px 14px 12px;" class="cap">Nothing leaves the platform without an approval record.</div>`);

/* =================================================================== */
/* PUBLISH LOG                                                         */
/* =================================================================== */
const LOG = [
  ['2 Sep', [['20:01', 'prs', 'ig', 'michelle', ['grn', 'Published'], 'instagram.com/p/C9xK2…']]],
  ['31 Aug', [
    ['19:30', 'org', 'x', 'michelle', ['grn', 'Published'], 'x.com/aurafarmers/status/18…'],
    ['19:30', 'org', 'yt', 'michelle', ['gray', 'Private draft'], 'Make public after the audit'],
  ]],
  ['24 Aug', [['12:00', 'dmo', 'wc', 'michelle', ['gray', 'Saved as draft'], 'Posted by hand in WeChat']]],
  ['11 Aug', [
    ['18:00', 'gdy', 'ig', 'michelle', ['grn', 'Published'], 'instagram.com/p/C8aT1…'],
    ['18:00', 'gdy', 'li', 'michelle', ['red', 'Failed'], 'fail'],
  ]],
];
const logBody = `
      <div style="flex-grow: 1; min-height: 0; padding: 12px 20px 0; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 6px;"><div class="fc on">All <b>6</b></div><div class="fc">Published <b>3</b></div><div class="fc">Drafts <b>2</b></div><div class="fc" style="color: #e03636;">Failed <b>1</b></div><div style="flex-grow: 1;"></div>${chip('Any channel')}</div>
        <div class="lg2">
${LOG.map(([d, rows]) => `          <div class="day">${d}</div>
${rows.map(([t, id, k, who, [tone, st], res]) => `          <div class="lr"><div class="cap">${t}</div><div>${crop(VID[id][1], ' width: 44px; height: 25px; border-radius: 4px;')}<span class="el" style="color: #171717;">${VID[id][0]}</span></div><div>${logo(k, 20)}<span class="el">${CHN[k]}</span></div><div>${av(who, 20)}</div><div><span class="bd ${tone}">${st}</span>${res === 'fail' ? '<span class="el" style="color: #e03636; font-size: 12px;">File over LinkedIn’s 200 MB limit</span>' : `<span class="el" style="color: ${res.includes('.') ? 'var(--ac)' : '#7c7c7c'}; font-size: 12px;">${res}</span>`}</div></div>${res === 'fail' ? `
          <div style="margin: 6px 0 4px 60px; padding: 10px 12px; border-radius: 10px; background: #fff7f7; border: 1px solid #ffdcdc; display: flex; align-items: center; gap: 12px;"><div style="min-width: 0; flex-grow: 1;"><div style="font-family: ui-monospace, monospace; font-size: 11px; color: #941f1f;">LinkedIn 422 · asset exceeds 200 MB for video/mp4</div><div style="font-size: 12px; color: #8a3b3b; margin-top: 4px;">Retry is safe. Nothing was posted, so there won’t be a duplicate.</div></div><div class="btn s" style="background: #fff;">Retry with a smaller file</div></div>` : ''}`).join('\n')}`).join('\n')}
        </div>
      </div>`;

/* =================================================================== */
const agent = (scope, q, tool, a, act, place) => rightPanel(['Agent'], 'Agent', agentBlock({ scope, q, tool, a, act, place, guard: 'Uses only posts you can see', cost: 'HK$0.01' }));
const out = [
  { file: 'Pub-Channels.dc.html', title: 'Channel board', me: 'leung', side: side('channels'),
    main: layout(channelsTop, channelsBody, agent('Publish · 5 videos, 8 channels', 'What’s ready but not posted yet?', 'Checked 5 videos, 8 channels · 0.4 s', '<p><b style="font-weight: 500;">History of Greece Ep 75</b> has captions ready for YouTube, Instagram and LinkedIn on 12 Sep and waits for Michelle’s approval.</p><p style="margin-top: 8px;">Good day failed on LinkedIn because the file was too big. Amy is making a smaller one. Nothing else is ready; Sham Shui Po is still in Video Edit.</p>', 'Open the approval', 'Ask about posting…')) },
  { file: 'Pub-Composer.dc.html', title: 'Caption', me: 'chan', side: switcher, main: `<div style="flex-grow: 1; display: flex; min-height: 0;"><div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden;">${composerBody}</div>${composerPanel}</div>` },
  { file: 'Pub-Approvals.dc.html', title: 'Approval queue', me: 'michelle', side: side('approvals'), main: layout(topbar('Approval queue', 'posts waiting for a decision'), approvalsBody, approvalsPanel) },
  { file: 'Pub-Log.dc.html', title: 'Publish log', me: 'leung', side: side('log'), main: layout(topbar('Publish log', 'what went where, and what the platform said'), logBody, agent('Publish log · last 30 days', 'Why did Good day fail on LinkedIn?', 'Read the platform response · 0.2 s', '<p>LinkedIn only accepts videos under 200 MB, and the 9:16 file was 312 MB.</p><p style="margin-top: 8px;">Nothing was posted, so retrying is safe. I can ask Video Edit for a 1:1 version at a lower bitrate, which comes in around 90 MB.</p>', 'Ask for a smaller file', 'Ask about the log…')) },
];
for (const o of out) fs.writeFileSync(path.join(DIR, o.file), page(o));
console.log('wrote', out.map(o => o.file).join(', '));
