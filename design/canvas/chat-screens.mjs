/**
 * Chat module (Slack-style workspace: agent DM, channels, DMs,
 * announcements) and sign-in. Hand-authored.
 *
 * Spec hooks made visible rather than assumed:
 *   §2.2.5  agent output posted to a group surface uses only sources every
 *           member of that group can read
 *   §4.1    Traditional Chinese default with an English toggle
 *   §8      OIDC via the client's IdP, else email + password + TOTP;
 *           sessions expire
 *
 * Run:  node chat-screens.mjs
 */
import fs from 'fs';
import path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.join(DIR, 'Desktop.dc.html'), 'utf8');
const css = src.slice(src.indexOf('<style>') + 7, src.indexOf('</style>'));

const CHAT_CSS = `
    .ws { display: flex; align-items: center; gap: 8px; height: 29px; padding: 0 10px; border-radius: 7px; font-size: 13px; color: #525252; }
    .ws.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500; }
    .ws.unread { color: #171717; font-weight: 600; }
    .ws .hs { width: 13px; text-align: center; color: #999999; font-weight: 400; flex-shrink: 0; }
    .ws .ct { margin-left: auto; min-width: 18px; height: 17px; padding: 0 5px; border-radius: 9px; background: #e03636; color: #fff; font-size: 10px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
    .pr { position: relative; flex-shrink: 0; display: flex; }
    .pr i { position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px; border-radius: 5px; border: 2px solid #f8f8f8; }
    .on-g { background: #48bb74; } .on-a { background: #f5a623; } .on-o { background: #c7c7c7; }
    .msg { display: flex; gap: 11px; padding: 7px 22px; }
    .msg .mav { width: 36px; height: 36px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
    .msg .who { font-size: 13.5px; font-weight: 600; color: #171717; }
    .msg .when { font-size: 11px; color: #999999; margin-left: 7px; font-weight: 400; }
    .msg .txt { font-size: 13.5px; line-height: 1.55; color: #2b343d; margin-top: 2px; text-wrap: pretty; }
    .msg.cont { padding-top: 1px; }
    .msg.cont .mav { visibility: hidden; height: 0; }
    .rx { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px; border-radius: 12px; border: 1px solid #ededed; background: #fff; font-size: 12px; color: #525252; }
    .rx.me { border-color: #a7d7fd; background: #f2f9ff; color: #007be0; }
    .rxs { display: flex; gap: 5px; margin-top: 7px; flex-wrap: wrap; }
    .day { display: flex; align-items: center; gap: 10px; padding: 12px 22px 6px; }
    .day::before, .day::after { content: ''; flex: 1; height: 1px; background: #ededed; }
    .day span { font-size: 11px; font-weight: 500; color: #7c7c7c; padding: 3px 11px; border: 1px solid #ededed; border-radius: 12px; background: #fff; }
    .app { display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 4px; background: #f3f3f3; color: #7c7c7c; font-size: 9.5px; font-weight: 600; letter-spacing: .04em; margin-left: 6px; }
    .att { display: flex; align-items: center; gap: 11px; margin-top: 8px; padding: 8px 12px 8px 8px; border: 1px solid #ededed; border-radius: 10px; background: #fff; width: fit-content; max-width: 420px; }
    .att img { width: 78px; height: 44px; border-radius: 6px; object-fit: cover; }
    .ment { color: #007be0; background: #f2f9ff; border-radius: 4px; padding: 0 3px; font-weight: 500; }
    .ico2 { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
    .ico2 svg { width: 16px; height: 16px; stroke: #525252; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }`;

const AGENT_MARK = `<svg viewBox="0 0 24 24" style="width: 18px; height: 18px; stroke: #fff; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 4.2 19 8v8l-7 3.8L5 16V8z"/><path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8"/></svg>`;
const agentAvatar = size => `<div style="width: ${size}px; height: ${size}px; border-radius: ${Math.round(size * .28)}px; background: #171717; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${AGENT_MARK.replace(/18px/g, Math.round(size * .5) + 'px')}</div>`;
const initials = (txt, size, bg = '#e2e2e2', fg = '#525252') => `<div style="width: ${size}px; height: ${size}px; border-radius: ${Math.round(size * .28)}px; background: ${bg}; display: flex; align-items: center; justify-content: center; font-size: ${Math.round(size * .34)}px; font-weight: 600; color: ${fg}; flex-shrink: 0;">${txt}</div>`;

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
const rail = RAIL.map(([k, icon]) =>
  `    <div class="r${k === 'chat' ? ' on' : ''}${k === 'hr' ? ' no' : ''}"><svg viewBox="0 0 24 24">${icon}</svg></div>\n` +
  (k === 'pub' ? '    <div style="width: 22px; height: 1px; background: #e2e2e2; margin: 6px 0;"></div>\n' : '')).join('');

const CHANNELS = [
  ['announcements', 2, true], ['general', 0, true], ['production', 5, true],
  ['research', 0, false], ['publish-approvals', 0, false, true], ['random', 0, false],
];
const DMS = [
  ['pfp-amy.jpg', 'Amy Wong', 'on-g', 1], ['pfp-leung.jpg', 'Leung Chi-hang', 'on-a', 0],
  ['pfp-michelle.jpg', 'Michelle Yip', 'on-g', 0], [null, 'Vincent Chow', 'on-o', 0, 'guest'],
];
const LOCK = '<svg viewBox="0 0 24 24" style="width: 11px; height: 11px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0;"><path d="M6.8 10.5h10.4v8H6.8z"/><path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5"/></svg>';

const chatSidebar = active => `
  <div style="width: 256px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; padding: 10px 8px;">
    <div style="display: flex; align-items: center; gap: 7px; padding: 3px 8px 10px;">
      <span style="font-size: 14.5px; font-weight: 600;">Aura Farmers</span>
      <svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #7c7c7c; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>
      <div style="margin-left: auto; width: 28px; height: 28px; border-radius: 8px; background: #fff; border: 1px solid #ededed; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" style="width: 14px; height: 14px; stroke: #383838; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 20h8"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></div>
    </div>
    <div style="height: 30px; border: 1px solid #ededed; border-radius: 8px; background: #fff; display: flex; align-items: center; gap: 7px; padding: 0 9px; margin: 0 2px 12px;">
      <svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round;"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg>
      <span style="font-size: 12px; color: #999999; flex-grow: 1;">Jump to…</span><span style="font-size: 10.5px; color: #c7c7c7;">⌘K</span>
    </div>
    <div class="ws${active === 'agent' ? ' on' : ''}" style="gap: 9px;">${agentAvatar(18)}<span>Your agent</span><span style="margin-left: auto; font-size: 10.5px; color: #999999;">private</span></div>
    <div class="lbl" style="margin: 16px 0 5px;">Channels</div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
${CHANNELS.map(([n, ct, unread, priv]) => `      <div class="ws${active === n ? ' on' : unread && ct ? ' unread' : ''}"><span class="hs">${priv ? LOCK : '#'}</span><span>${n}</span>${ct && active !== n ? `<span class="ct">${ct}</span>` : ''}</div>`).join('\n')}
    </div>
    <div class="lbl" style="margin: 16px 0 5px;">Direct messages</div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
${DMS.map(([img, n, pres, unread, tag]) => `      <div class="ws${unread ? ' unread' : ''}" style="gap: 9px;"><span class="pr">${img ? `<img src="${img}" style="width: 20px; height: 20px; border-radius: 6px; object-fit: cover;">` : initials('VC', 20)}<i class="${pres}"></i></span><span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${n}</span>${tag ? `<span style="margin-left: auto; font-size: 10px; color: #999999;">${tag}</span>` : unread ? '<span class="ct">1</span>' : ''}</div>`).join('\n')}
    </div>
    <div style="margin-top: auto; display: flex; align-items: center; gap: 9px; padding: 10px 8px 2px; border-top: 1px solid #ededed;">
      <span class="pr"><img src="pfp-chan.jpg" style="width: 30px; height: 30px; border-radius: 9px; object-fit: cover;"><i class="on-g"></i></span>
      <div style="min-width: 0; flex-grow: 1;"><div style="font-size: 12.5px; font-weight: 500;">Chan Ka-ming</div><div style="font-size: 11px; color: #999999;">On set · Temple St</div></div>
      <div style="display: flex; gap: 2px; padding: 2px; border-radius: 7px; background: #ededed; font-size: 10.5px;"><span style="padding: 2px 6px; border-radius: 5px; background: #fff; font-weight: 500;">繁</span><span style="padding: 2px 6px; color: #7c7c7c;">EN</span></div>
    </div>
  </div>`;

const composer = (placeholder, disabled) => disabled ? `
        <div style="flex-shrink: 0; padding: 12px 22px 18px;">
          <div style="height: 50px; border: 1px dashed #e2e2e2; border-radius: 12px; background: #fafafa; display: flex; align-items: center; justify-content: center; gap: 8px;">${LOCK}<span style="font-size: 12.5px; color: #7c7c7c;">${placeholder}</span></div>
        </div>` : `
        <div style="flex-shrink: 0; padding: 8px 22px 18px;">
          <div style="border: 1px solid #d9d9d9; border-radius: 12px; background: #fff; box-shadow: 0 1px 1px rgba(5,5,6,.04);">
            <div style="display: flex; align-items: center; gap: 2px; padding: 6px 8px; border-bottom: 1px solid #f3f3f3;">
              <div class="ico2"><svg viewBox="0 0 24 24"><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/></svg></div>
              <div class="ico2"><svg viewBox="0 0 24 24"><path d="M10 5h8M6 19h8M14.5 5 9.5 19"/></svg></div>
              <div class="ico2"><svg viewBox="0 0 24 24"><path d="M9.5 14.5 14.5 9.5M8 11l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2"/></svg></div>
              <div class="ico2"><svg viewBox="0 0 24 24"><path d="M8 6.5h11M8 12h11M8 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/></svg></div>
              <div class="ico2"><svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4"/></svg></div>
            </div>
            <div style="padding: 11px 13px 4px; font-size: 13.5px; color: #999999;">${placeholder}</div>
            <div style="display: flex; align-items: center; gap: 2px; padding: 6px 8px 8px;">
              <div class="ico2"><svg viewBox="0 0 24 24"><path d="M12 5.5v13M5.5 12h13"/></svg></div>
              <div class="ico2"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4"/><path d="M8.6 14.2a4 4 0 0 0 6.8 0M9.4 9.8h.01M14.6 9.8h.01"/></svg></div>
              <div class="ico2"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.6"/><path d="M15.6 12v1.3a2.3 2.3 0 0 0 4.6 0V12a8.2 8.2 0 1 0-3.2 6.5"/></svg></div>
              <div class="ico2" style="gap: 6px; width: auto; padding: 0 8px;">${agentAvatar(18)}<span style="font-size: 12px; color: #525252;">Ask agent</span></div>
              <div style="flex-grow: 1;"></div>
              <div style="width: 32px; height: 32px; border-radius: 9px; background: #007be0; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" style="width: 15px; height: 15px; stroke: #fff; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 19V5.5M6 11.5 12 5.5l6 6"/></svg></div>
            </div>
          </div>
        </div>`;

function shell(title, sidebarActive, header, stream, compose, right) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<!-- hand-authored: Chat · ${title}. Rebuild with chat-screens.mjs -->
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600&display=swap">
  <style>${css}${CHAT_CSS}</style>
</helmet>

<div style="width: 1440px; height: 900px; display: flex; background: #ffffff; color: #171717; overflow: hidden;">
  <div style="width: 52px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 3px;">
    <div style="width: 28px; height: 28px; border-radius: 8px; background: #171717; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 600; margin-bottom: 10px;">AF</div>
${rail}    <div style="flex-grow: 1;"></div>
    <img class="av" src="pfp-chan.jpg" style="width: 26px; height: 26px; border-radius: 13px;">
  </div>
${chatSidebar(sidebarActive)}
  <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column;">
${header}
    <div style="flex-grow: 1; min-height: 0; display: flex;">
      <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column;">
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; padding-bottom: 4px;">
${stream}
        </div>${compose}
      </div>
${right}
    </div>
  </div>
</div>
</x-dc>
<script data-dc-script data-props='{"$preview":{"width":1440,"height":900}}'>
class Component extends DCLogic {}
</${'script'}>
</body>
</html>
`;
}

const header = (icon, name, sub, extra) => `
    <div style="height: 56px; flex-shrink: 0; border-bottom: 1px solid #ededed; display: flex; align-items: center; gap: 11px; padding: 0 18px 0 22px;">
      ${icon}
      <div style="min-width: 0;">
        <div style="font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 7px;">${name}</div>
        <div style="font-size: 11.5px; color: #999999; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${sub}</div>
      </div>
      <div style="flex-grow: 1;"></div>
      ${extra}
      <div class="ico2"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg></div>
      <div class="ico2"><svg viewBox="0 0 24 24"><path d="m15 4 5 5-3.5 1.5-4 4 .5 4.5-1.5 1.5-4-4L4 20l3.5-3.5-4-4L5 11l4.5.5 4-4z"/></svg></div>
      <div class="ico2"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4"/><path d="M12 11v5M12 8h.01"/></svg></div>
    </div>`;

const faces = imgs => `<div style="display: flex; align-items: center; height: 30px; padding: 0 4px 0 3px; border: 1px solid #ededed; border-radius: 9px; gap: 7px;"><div style="display: flex;">${imgs.map((im, i) => `<img src="${im}" style="width: 22px; height: 22px; border-radius: 6px; object-fit: cover; border: 2px solid #fff; margin-left: ${i ? -7 : 0}px;">`).join('')}</div><span style="font-size: 12px; color: #525252; padding-right: 5px;">12</span></div>`;

const m = (img, who, when, txt, extra = '', cont = false, whoExtra = '') => `
          <div class="msg${cont ? ' cont' : ''}">
            ${img === 'agent' ? agentAvatar(36) : img.startsWith('pfp') || img.startsWith('cover') ? `<img class="mav" src="${img}">` : initials(img, 36)}
            <div style="min-width: 0; flex-grow: 1;">
              ${cont ? '' : `<div style="display: flex; align-items: baseline;"><span class="who">${who}</span>${whoExtra}<span class="when">${when}</span></div>`}
              <div class="txt">${txt}</div>${extra}
            </div>
          </div>`;

/* =================================================================== */
/* MAIN, your agent (private DM)                                      */
/* =================================================================== */
const mainStream = `
          <div class="day"><span>Today</span></div>
${m('pfp-chan.jpg', 'Chan Ka-ming', '14:20', 'Compare last month’s Cantonese shorts against the 16:9 cuts, watch-through and engagement, same date range.')}
${m('agent', 'Agent', '14:20', `<div style="display: inline-flex; align-items: center; gap: 8px; height: 26px; padding: 0 10px; border: 1px solid #ededed; border-radius: 8px; background: #f8f8f8; margin: 2px 0 8px;"><svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #278f5e; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round;"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg><span style="font-size: 12px; color: #525252;">Ran <b style="font-weight: 600;">Market Research</b> · read 3 files · 4.2 s</span></div><br>The 9:16 cuts hold attention better but convert engagement worse. Across 28 Jul – 24 Aug, shorts averaged <b style="font-weight: 600;">52.4%</b> watch-through against <b style="font-weight: 600;">41.2%</b> for the 16:9 versions of the same six scripts, but the long cuts drew nearly double the comments per thousand views.`,
  `<div style="border: 1px solid #ededed; border-radius: 10px; overflow: hidden; margin-top: 10px; max-width: 560px;">
                <div style="display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); background: #f8f8f8; border-bottom: 1px solid #ededed;"><div style="padding: 8px 13px; font-size: 11px; font-weight: 500; color: #7c7c7c;">Metric</div><div style="padding: 8px 13px; font-size: 11px; font-weight: 500; color: #7c7c7c; text-align: right;">9:16 shorts</div><div style="padding: 8px 13px; font-size: 11px; font-weight: 500; color: #7c7c7c; text-align: right;">16:9 cuts</div></div>
                <div style="display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); border-bottom: 1px solid #f3f3f3;"><div style="padding: 9px 13px; font-size: 13px;">Views</div><div style="padding: 9px 13px; font-size: 13px; text-align: right; font-variant-numeric: tabular-nums;">846,200</div><div style="padding: 9px 13px; font-size: 13px; text-align: right; font-variant-numeric: tabular-nums;">438,100</div></div>
                <div style="display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); border-bottom: 1px solid #f3f3f3;"><div style="padding: 9px 13px; font-size: 13px;">Watch-through</div><div style="padding: 9px 13px; font-size: 13px; text-align: right; color: #278f5e; font-weight: 500;">52.4%</div><div style="padding: 9px 13px; font-size: 13px; text-align: right;">41.2%</div></div>
                <div style="display: grid; grid-template-columns: repeat(3, minmax(0,1fr));"><div style="padding: 9px 13px; font-size: 13px;">Comments / 1k views</div><div style="padding: 9px 13px; font-size: 13px; text-align: right;">1.8</div><div style="padding: 9px 13px; font-size: 13px; text-align: right; color: #278f5e; font-weight: 500;">3.4</div></div>
              </div>
              <div style="display: flex; gap: 6px; margin-top: 10px;"><span class="chip" style="height: 24px; font-size: 11.5px; color: #007be0; border-color: #a7d7fd; background: #f2f9ff;">Q3-performance-export.csv</span><span class="chip" style="height: 24px; font-size: 11.5px; color: #007be0; border-color: #a7d7fd; background: #f2f9ff;">shorts-brief-v4.md</span></div>`, false, '<span class="app">APP</span>')}
${m('pfp-chan.jpg', 'Chan Ka-ming', '14:26', 'Post that table into #production so the team sees it.')}
${m('agent', 'Agent', '14:26', 'Before I post: #production has a guest member (Vincent Chow). Posting to a group only uses sources <b style="font-weight: 600;">every member</b> can read, so I’d drop shorts-brief-v4.md, Vincent can’t open it. The table itself stays.', `<div style="display: flex; gap: 7px; margin-top: 10px;"><div class="btn p" style="height: 30px;">Post without the brief</div><div class="btn s" style="height: 30px;">Keep it private</div></div>`, false, '<span class="app">APP</span>')}`;

const mainRight = `
      <div style="width: 300px; flex-shrink: 0; border-left: 1px solid #ededed; background: #fcfcfc; display: flex; flex-direction: column;">
        <div style="height: 44px; flex-shrink: 0; display: flex; align-items: center; padding: 0 16px; border-bottom: 1px solid #ededed;"><span class="lbl" style="padding: 0;">Sources used · 4</span></div>
        <div style="padding: 13px; display: flex; flex-direction: column; gap: 8px;">
${[['Q3-performance-export.csv', '2026-Q3-campaign / Exports', 'Editor', 'blue'], ['shorts-brief-v4.md', '2026-Q3-campaign / Scripts', 'Viewer', 'gray'], ['YouTube Analytics · Aug', 'Connected channel · live', 'Viewer', 'gray'], ['house-style-v6.md', 'Knowledge · tenant', 'Viewer', 'gray']].map(([n, p, r, c]) => `          <div style="border: 1px solid #ededed; border-radius: 9px; background: #fff; padding: 10px 11px;"><div style="font-size: 12.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${n}</div><div style="font-size: 11px; color: #999999; margin-top: 2px;">${p}</div><span class="bd ${c}" style="margin-top: 8px;">${r}</span></div>`).join('\n')}
          <p class="mut" style="line-height: 1.55; margin-top: 4px;">Filtered to what you can read. Two further files matched and were withheld.</p>
        </div>
      </div>`;

/* =================================================================== */
/* #production                                                          */
/* =================================================================== */
const prodStream = `
          <div class="day"><span>Yesterday</span></div>
${m('pfp-michelle.jpg', 'Michelle Yip', '18:02', 'Reminder: shoot for project 004 is locked for <b style="font-weight: 600;">Sat 12 Sep, 06:30</b> at Temple St. Call sheet is pinned.')}
          <div class="day"><span>Today</span></div>
${m('pfp-chan.jpg', 'Chan Ka-ming', '10:14', 'Rough cut v2 is up. Beats 3 and 5 still need footage.', `<div class="att"><img src="cover-history.jpg"><div style="min-width: 0;"><div style="font-size: 12.5px; font-weight: 500;">roughcut-004_v2.mp4</div><div style="font-size: 11px; color: #999999; margin-top: 2px;">402 MB · 3:48 · Renders</div></div></div><div class="rxs"><span class="rx">👀 3</span><span class="rx me">🙌 4</span></div>`)}
${m('pfp-amy.jpg', 'Amy Wong', '10:21', 'I can grab B-roll at Temple St tomorrow morning before the stalls open.', `<div class="rxs"><span class="rx me">👍 5</span><span class="rx">🔥 2</span></div>`)}
${m('pfp-amy.jpg', '', '', 'Anyone need anything specific? Thinking wide shots of the shutters going up.', '', true)}
${m('pfp-leung.jpg', 'Leung Chi-hang', '10:33', 'Subtitles for ep75 are done: zh-HK and English. Uploading now.', `<div class="att"><div style="width: 44px; height: 44px; border-radius: 6px; background: #f3f3f3; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" style="width: 18px; height: 18px; stroke: #999999; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><path d="M7 4.5h7L18 9v10.5H7z"/><path d="M13.6 4.5V9H18"/></svg></div><div><div style="font-size: 12.5px; font-weight: 500;">subtitles_zh-HK.srt</div><div style="font-size: 11px; color: #999999; margin-top: 2px;">14 KB · v2</div></div></div>`)}
${m('pfp-chan.jpg', 'Chan Ka-ming', '11:02', '<span class="ment">@Agent</span> what’s still open on project 004?')}
${m('agent', 'Agent', '11:02', 'Three things before Saturday:', `<div style="margin-top: 7px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #2b343d;">
                <div style="display: flex; gap: 9px;"><span style="width: 16px; height: 16px; border: 1px solid #999999; border-radius: 4px; flex-shrink: 0; margin-top: 1px;"></span>Beat 3, Mrs Ho interview, not yet assigned</div>
                <div style="display: flex; gap: 9px;"><span style="width: 16px; height: 16px; border: 1px solid #999999; border-radius: 4px; flex-shrink: 0; margin-top: 1px;"></span>Beat 5, archive upscale failed: the client’s Vertex account is out of credit</div>
                <div style="display: flex; gap: 9px;"><span style="width: 16px; height: 16px; border-radius: 4px; background: #171717; flex-shrink: 0; margin-top: 1px; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 16 16" style="width: 11px; height: 11px; stroke: #fff; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;"><path d="M3.6 8.3 6.5 11.2 12.4 5.1"/></svg></span>Subtitles, done, thanks Leung</div>
              </div>
              <div style="display: flex; align-items: center; gap: 7px; margin-top: 10px; padding: 7px 10px; border-radius: 8px; background: #f8f8f8; width: fit-content;">${LOCK}<span style="font-size: 11.5px; color: #7c7c7c;">Used only sources all 12 members of #production can read · 2 files excluded</span></div>`, false, '<span class="app">APP</span>')}
${m('pfp-michelle.jpg', 'Michelle Yip', '11:09', 'Approving the 9:16 cut now. Leung, can you do the 1:1 after lunch?', `<div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;"><div style="display: flex;"><img src="pfp-leung.jpg" style="width: 20px; height: 20px; border-radius: 6px; object-fit: cover;"><img src="pfp-chan.jpg" style="width: 20px; height: 20px; border-radius: 6px; object-fit: cover; margin-left: -5px; border: 2px solid #fff;"></div><a href="#" style="font-size: 12.5px; font-weight: 600;">3 replies</a><span style="font-size: 11.5px; color: #999999;">Last reply 11:24</span></div>`)}
          <div style="display: flex; align-items: center; gap: 8px; padding: 4px 22px 2px 69px;"><span style="display: flex; gap: 3px;"><span style="width: 5px; height: 5px; border-radius: 3px; background: #c7c7c7;"></span><span style="width: 5px; height: 5px; border-radius: 3px; background: #c7c7c7;"></span><span style="width: 5px; height: 5px; border-radius: 3px; background: #c7c7c7;"></span></span><span style="font-size: 11.5px; color: #999999;">Amy Wong is typing…</span></div>`;

const thread = `
      <div style="width: 340px; flex-shrink: 0; border-left: 1px solid #ededed; display: flex; flex-direction: column;">
        <div style="height: 50px; flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid #ededed;">
          <span style="font-size: 14px; font-weight: 600;">Thread</span><span style="font-size: 12px; color: #999999;"># production</span>
          <div style="flex-grow: 1;"></div>
          <svg viewBox="0 0 24 24" style="width: 15px; height: 15px; stroke: #7c7c7c; fill: none; stroke-width: 1.8; stroke-linecap: round;"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </div>
        <div style="flex-grow: 1; min-height: 0; overflow: hidden; padding: 8px 0;">
${m('pfp-michelle.jpg', 'Michelle Yip', '11:09', 'Approving the 9:16 cut now. Leung, can you do the 1:1 after lunch?')}
          <div style="display: flex; align-items: center; gap: 10px; padding: 8px 22px;"><span style="font-size: 11.5px; color: #999999;">3 replies</span><span style="flex: 1; height: 1px; background: #ededed;"></span></div>
${m('pfp-leung.jpg', 'Leung Chi-hang', '11:14', 'Yes, will it need new subtitles or can I reflow the zh-HK file?')}
${m('pfp-michelle.jpg', 'Michelle Yip', '11:18', 'Reflow is fine. Keep the burn-in off for LinkedIn.')}
${m('pfp-chan.jpg', 'Chan Ka-ming', '11:24', 'I’ll queue the render so it’s ready when you’re back 👍', `<div class="rxs"><span class="rx">✅ 2</span></div>`)}
        </div>
        <div style="flex-shrink: 0; padding: 10px 14px 16px;">
          <div style="border: 1px solid #d9d9d9; border-radius: 11px; padding: 10px 12px; font-size: 13px; color: #999999;">Reply…</div>
          <div style="display: flex; align-items: center; gap: 7px; margin-top: 8px;"><span style="width: 15px; height: 15px; border: 1px solid #999999; border-radius: 4px;"></span><span style="font-size: 11.5px; color: #7c7c7c;">Also send to # production</span></div>
        </div>
      </div>`;

/* =================================================================== */
/* #announcements                                                       */
/* =================================================================== */
const post = (img, who, role, when, title, body, media, reacts, seen) => `
          <div style="margin: 8px 22px; border: 1px solid #ededed; border-radius: 14px; background: #fff; padding: 16px 18px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <img src="${img}" style="width: 34px; height: 34px; border-radius: 10px; object-fit: cover;">
              <div><div style="font-size: 13.5px; font-weight: 600;">${who} <span class="bd blue" style="margin-left: 4px;">${role}</span></div><div style="font-size: 11.5px; color: #999999; margin-top: 1px;">${when}</div></div>
            </div>
            <div style="font-size: 15.5px; font-weight: 600; margin-top: 13px; letter-spacing: -0.01em;">${title}</div>
            <p style="font-size: 13.5px; line-height: 1.6; color: #383838; margin-top: 6px; text-wrap: pretty;">${body}</p>${media}
            <div style="display: flex; align-items: center; gap: 6px; margin-top: 13px;">
              ${reacts}
              <div style="flex-grow: 1;"></div>
              <div style="display: flex;">${seen.map((s, i) => `<img src="${s}" style="width: 20px; height: 20px; border-radius: 10px; object-fit: cover; border: 2px solid #fff; margin-left: ${i ? -6 : 0}px;">`).join('')}</div>
              <span style="font-size: 11.5px; color: #999999;">Seen by 11 of 12</span>
            </div>
          </div>`;

const annStream = `
          <div style="margin: 10px 22px 4px; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 11px; background: #f8f8f8;">
            <svg viewBox="0 0 24 24" style="width: 15px; height: 15px; stroke: #525252; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="m15 4 5 5-3.5 1.5-4 4 .5 4.5-1.5 1.5-4-4L4 20l3.5-3.5-4-4L5 11l4.5.5 4-4z"/></svg>
            <span style="font-size: 12.5px; color: #383838; flex-grow: 1;"><b style="font-weight: 600;">Pinned</b> · Office closed Wed 16 Sep for Mid-Autumn Festival</span>
            <span style="font-size: 11.5px; color: #999999;">3 pinned</span>
          </div>
${post('pfp-michelle.jpg', 'Michelle Yip', 'admin', 'Today · 09:30', 'Your agent can now post into channels',
  'Mention <span class="ment">@Agent</span> in any channel and it will answer there. It only ever uses sources that <b style="font-weight: 600;">every member of that channel</b> can open, so a guest in the room means it works from less, and it will tell you what it left out.',
  '', '<span class="rx me">🎉 9</span><span class="rx">🙏 4</span><span class="rx">👀 2</span>', ['pfp-chan.jpg', 'pfp-amy.jpg', 'pfp-leung.jpg'])}
${post('pfp-michelle.jpg', 'Michelle Yip', 'admin', 'Mon · 18:12', 'Q3 campaign kick-off: night markets',
  'Five episodes, three formats each, first publish 12 Sep. Briefs are in Script; the shoot calendar is in #production.',
  '<img src="cover-porsche.jpg" style="width: 100%; max-width: 520px; aspect-ratio: 16/7; object-fit: cover; border-radius: 10px; margin-top: 12px;">',
  '<span class="rx me">🔥 11</span><span class="rx">🚀 6</span>', ['pfp-amy.jpg', 'pfp-chan.jpg', 'pfp-leung.jpg'])}`;

const members = `
      <div style="width: 300px; flex-shrink: 0; border-left: 1px solid #ededed; background: #fcfcfc; display: flex; flex-direction: column;">
        <div style="height: 50px; flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid #ededed;"><span style="font-size: 14px; font-weight: 600;">Members</span><span style="font-size: 12px; color: #999999;">12</span></div>
        <div style="padding: 12px 10px; display: flex; flex-direction: column; gap: 2px;">
          <div class="lbl" style="margin: 2px 0 6px;">Can post · 2</div>
${[['pfp-michelle.jpg', 'Michelle Yip', 'admin', 'on-g', 'Head of production'], [null, 'Ray Tsang', 'admin', 'on-o', 'Finance']].map(([im, n, r, p, t]) => `          <div style="display: flex; align-items: center; gap: 10px; padding: 6px 8px;"><span class="pr">${im ? `<img src="${im}" style="width: 30px; height: 30px; border-radius: 9px; object-fit: cover;">` : initials('RT', 30)}<i class="${p}" style="border-color: #fcfcfc;"></i></span><div style="min-width: 0;"><div style="font-size: 12.5px; font-weight: 500;">${n}</div><div style="font-size: 11px; color: #999999;">${t}</div></div><span class="bd blue" style="margin-left: auto;">${r}</span></div>`).join('\n')}
          <div class="lbl" style="margin: 12px 0 6px;">Everyone else · 10</div>
${[['pfp-chan.jpg', 'Chan Ka-ming', 'on-g', 'On set · Temple St'], ['pfp-amy.jpg', 'Amy Wong', 'on-g', 'Research'], ['pfp-leung.jpg', 'Leung Chi-hang', 'on-a', 'Away · back 14:00'], [null, 'Priscilla Cheung', 'on-g', 'Finance'], [null, 'Jason Ho', 'on-o', 'Accounting'], [null, 'Vincent Chow', 'on-o', 'Guest · until 30 Sep']].map(([im, n, p, t]) => `          <div style="display: flex; align-items: center; gap: 10px; padding: 6px 8px;"><span class="pr">${im ? `<img src="${im}" style="width: 30px; height: 30px; border-radius: 9px; object-fit: cover;">` : initials(n.split(' ').map(w => w[0]).join('').slice(0, 2), 30)}<i class="${p}" style="border-color: #fcfcfc;"></i></span><div style="min-width: 0;"><div style="font-size: 12.5px; font-weight: 500;">${n}</div><div style="font-size: 11px; color: #999999;">${t}</div></div></div>`).join('\n')}
        </div>
      </div>`;

/* =================================================================== */
/* LOGIN                                                                */
/* =================================================================== */
const loginShell = (title, form) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<!-- hand-authored: ${title}. Rebuild with chat-screens.mjs -->
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600&display=swap">
  <style>${css}
    .fld { height: 44px; border: 1px solid #d9d9d9; border-radius: 10px; background: #fff; display: flex; align-items: center; padding: 0 13px; font-size: 14px; color: #171717; }
    .fld.focus { border-color: #2b7fff; box-shadow: 0 0 0 3px #EFF6FF; }
    .flbl { font-size: 12.5px; font-weight: 500; color: #383838; margin-bottom: 7px; display: flex; justify-content: space-between; }
    .otp { width: 52px; height: 60px; border: 1px solid #d9d9d9; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; }
  </style>
</helmet>

<div style="width: 1440px; height: 900px; display: flex; background: #ffffff; color: #171717; overflow: hidden;">
  <div style="width: 660px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; padding: 44px 52px;">
    <div style="display: flex; align-items: center; gap: 10px;">
      <div style="width: 32px; height: 32px; border-radius: 9px; background: #171717; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 12px; font-weight: 600;">AF</div>
      <span style="font-size: 15px; font-weight: 600;">Aura Farmers</span>
    </div>
    <div style="margin-top: auto;">
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; transform: rotate(-3deg); margin: 0 -8px 44px;">
        <img src="cover-history.jpg" style="width: 100%; aspect-ratio: 16/10; object-fit: cover; border-radius: 12px; box-shadow: 0 2px 8px 1px rgba(5,5,6,.07);">
        <img src="cover-porsche.jpg" style="width: 100%; aspect-ratio: 16/10; object-fit: cover; border-radius: 12px; box-shadow: 0 2px 8px 1px rgba(5,5,6,.07); margin-top: 22px;">
        <img src="cover-orange.jpg" style="width: 100%; aspect-ratio: 16/10; object-fit: cover; border-radius: 12px; box-shadow: 0 2px 8px 1px rgba(5,5,6,.07);">
        <img src="cover-goodday.jpg" style="width: 100%; aspect-ratio: 16/10; object-fit: cover; border-radius: 12px; box-shadow: 0 2px 8px 1px rgba(5,5,6,.07); margin-top: -22px;">
        <img src="cover-domore.jpg" style="width: 100%; aspect-ratio: 16/10; object-fit: cover; border-radius: 12px; box-shadow: 0 2px 8px 1px rgba(5,5,6,.07);">
        <div style="width: 100%; aspect-ratio: 16/10; border-radius: 12px; background: #fff; border: 1px solid #ededed; margin-top: -22px; display: flex; flex-direction: column; justify-content: center; padding: 0 16px;"><div style="font-size: 22px; font-weight: 500; letter-spacing: -0.02em;">1.28M</div><div style="font-size: 11px; color: #999999; margin-top: 2px;">views · last 28 days</div></div>
      </div>
      <div style="font-size: 30px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.2; max-width: 460px; text-wrap: pretty;">One workspace for every video, every script, and every agent.</div>
      <p style="font-size: 14px; line-height: 1.6; color: #7c7c7c; margin-top: 12px; max-width: 440px; text-wrap: pretty;">Your agent works with exactly your permissions, nothing it reads, cites or posts is anything you couldn’t open yourself.</p>
    </div>
  </div>

  <div style="flex-grow: 1; display: flex; flex-direction: column; padding: 32px 44px;">
    <div style="display: flex; justify-content: flex-end;">
      <div style="display: flex; gap: 2px; padding: 3px; border-radius: 9px; background: #f3f3f3; font-size: 12px;"><span style="padding: 4px 11px; border-radius: 6px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); font-weight: 500;">繁體中文</span><span style="padding: 4px 11px; color: #7c7c7c;">English</span></div>
    </div>
    <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center;">
      <div style="width: 380px;">${form}</div>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 11.5px; color: #999999;">
      <span>Sessions expire after 12 hours of inactivity</span><span>Protected by your organisation’s identity provider</span>
    </div>
  </div>
</div>
</x-dc>
<script data-dc-script data-props='{"$preview":{"width":1440,"height":900}}'>
class Component extends DCLogic {}
</${'script'}>
</body>
</html>
`;

const signIn = `
        <div style="font-size: 26px; font-weight: 500; letter-spacing: -0.02em;">Sign in</div>
        <p style="font-size: 14px; color: #7c7c7c; margin-top: 7px;">Use your Aura Farmers work account.</p>
        <div class="flbl" style="margin-top: 28px;">Work email</div>
        <div class="fld focus">chan.kaming@aurafarmers.hk<span style="width: 1px; height: 18px; background: #171717; margin-left: 1px;"></span></div>
        <div class="flbl" style="margin-top: 16px;"><span>Password</span><a href="#" style="font-weight: 400;">Forgot password?</a></div>
        <div class="fld" style="letter-spacing: .22em; color: #525252;">••••••••••••<div style="flex-grow: 1;"></div><svg viewBox="0 0 24 24" style="width: 17px; height: 17px; stroke: #999999; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg></div>
        <div style="height: 46px; margin-top: 22px; border-radius: 11px; background: #007be0; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 500;">Continue</div>
        <div style="text-align: center; margin-top: 14px; font-size: 13px;"><a href="#">Use company single sign-on</a></div>
        <div style="display: flex; align-items: center; gap: 9px; margin-top: 16px; padding: 11px 13px; border-radius: 10px; background: #f8f8f8;">
          <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; flex-shrink: 0; stroke: #525252; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><rect x="6.5" y="3" width="11" height="18" rx="2.2"/><path d="M11 17.5h2"/></svg>
          <span style="font-size: 12.5px; color: #525252; line-height: 1.45;">Next you’ll enter the 6-digit code from your authenticator app.</span>
        </div>`;

const totp = `
        <a href="#" style="font-size: 12.5px; display: inline-flex; align-items: center; gap: 5px; color: #525252;"><svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round;"><path d="m14.5 5.5-7 6.5 7 6.5"/></svg>Back</a>
        <div style="width: 52px; height: 52px; border-radius: 15px; background: #f3f3f3; display: flex; align-items: center; justify-content: center; margin-top: 22px;"><svg viewBox="0 0 24 24" style="width: 24px; height: 24px; stroke: #383838; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><rect x="6.5" y="3" width="11" height="18" rx="2.2"/><path d="M11 17.5h2"/></svg></div>
        <div style="font-size: 26px; font-weight: 500; letter-spacing: -0.02em; margin-top: 18px;">Two-step verification</div>
        <p style="font-size: 14px; line-height: 1.55; color: #7c7c7c; margin-top: 8px;">Enter the 6-digit code from your authenticator app for <b style="font-weight: 500; color: #383838;">chan.kaming@aurafarmers.hk</b>.</p>
        <div style="display: flex; gap: 9px; margin-top: 26px; align-items: center;">
          <div class="otp">4</div><div class="otp">8</div><div class="otp">1</div>
          <span style="width: 10px; height: 2px; background: #c7c7c7; border-radius: 1px;"></span>
          <div class="otp">9</div><div class="otp">2</div><div class="otp">6</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 16px;"><div style="width: 16px; height: 16px; border-radius: 4px; background: #171717; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 16 16" style="width: 11px; height: 11px; stroke: #fff; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;"><path d="M3.6 8.3 6.5 11.2 12.4 5.1"/></svg></div><span style="font-size: 13px; color: #525252;">Trust this browser for 30 days</span></div>
        <div style="height: 46px; margin-top: 22px; border-radius: 11px; background: #007be0; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 500;">Verify</div>
        <div style="display: flex; justify-content: space-between; margin-top: 16px; font-size: 12.5px;"><span style="color: #999999;">Code refreshes in 18 s</span><a href="#">Use a recovery code</a></div>`;

/* ---------- write ---------- */
const files = {
  'Main.dc.html': shell('Your agent', 'agent',
    header(agentAvatar(32), 'Your agent <span class="app" style="margin-left: 0;">APP</span>', 'Private · only you can see this · works with exactly your permissions',
      '<span class="chip" style="height: 28px; font-size: 11.5px; font-family: ui-monospace, monospace;">gemini-2.5-pro</span>'),
    mainStream, composer('Message your agent, or name a module to run…'), mainRight),
  'Chat-Channel.dc.html': shell('#production', 'production',
    header('<div style="width: 32px; height: 32px; border-radius: 9px; background: #f3f3f3; display: flex; align-items: center; justify-content: center; font-size: 17px; color: #525252;">#</div>', 'production', 'Night market revival · shoot Sat 12 Sep 06:30 · 1 guest in this channel',
      faces(['pfp-michelle.jpg', 'pfp-chan.jpg', 'pfp-amy.jpg', 'pfp-leung.jpg'])),
    prodStream, composer('Message #production'), thread),
  'Chat-Announce.dc.html': shell('#announcements', 'announcements',
    header('<div style="width: 32px; height: 32px; border-radius: 9px; background: #fff7d3; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" style="width: 17px; height: 17px; stroke: #db7706; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="M4 10v4h3l6 4V6L7 10z"/><path d="M16.5 9a4 4 0 0 1 0 6"/></svg></div>', 'announcements <span class="bd amb">Admins post</span>', 'Company-wide updates · everyone is a member · read receipts on',
      faces(['pfp-michelle.jpg', 'pfp-chan.jpg', 'pfp-amy.jpg', 'pfp-leung.jpg'])),
    annStream, composer('Only admins can post in #announcements. React or reply in a thread', true), members),
  'Login.dc.html': loginShell('Sign in', signIn),
  'Login-Totp.dc.html': loginShell('Sign in · two-step', totp),
};
for (const [f, html] of Object.entries(files)) fs.writeFileSync(path.join(DIR, f), html);
console.log('wrote', Object.keys(files).join(', '));
