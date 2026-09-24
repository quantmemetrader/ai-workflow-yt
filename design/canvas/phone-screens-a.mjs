/**
 * Phone views, batch A: Chat, Market Research, Script, Video Edit.
 * One phone artboard per desktop screen, same data, FilesPhone style.
 * Writes <Desktop>-Phone.dc.html files and phones-a.json (for the canvas).
 * Run: node phone-screens-a.mjs
 */
import fs from 'fs';
import path from 'path';
import { P, docIcon, folderIcon, px, SPRITE } from './shell.mjs';
import { phonePage, row, sec, kpis, bd, dot, pbar, btns, fld, chev, tick, warn, cbx, cover, pav, ini } from './phone-shell.mjs';
import { TOPICS, catName, pickLogic, phoneFilters, phoneSheets, PHONE_PICK_CSS } from './research-filters.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const out = [];
const seen = {};
const add = (file, mod, title, o) => { seen[file] = o; fs.writeFileSync(path.join(DIR, file), phonePage({ module: mod, gen: 'phone-screens-a.mjs', title, ...o })); out.push({ file, mod, title }); };
const sheet = (scope, q, tool, a, act, chips = []) => ({ scope, q, tool, a, act, chips });

/* =================================================================== */
/* CHAT                                                                */
/* =================================================================== */
const msg = (k, name, t, text, extra = '') => `
      <div style="display: flex; gap: 11px; padding: 10px 16px;">${k === 'agent' ? '<div style="width: 34px; height: 34px; border-radius: 10px; background: #171717; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><svg viewBox="0 0 24 24" style="width: 17px; height: 17px; stroke: #fff; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 4.2 19 8v8l-7 3.8L5 16V8z"/><path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8"/></svg></div>' : pav(k, 34)}
        <div style="min-width: 0; flex-grow: 1;"><div style="display: flex; align-items: baseline; gap: 7px;"><span style="font-size: 14.5px; font-weight: 500;">${name}</span><span class="cap">${t}</span></div><div style="font-size: 14.5px; line-height: 1.5; color: #383838; margin-top: 3px;">${text}</div>${extra}</div>
      </div>`;
const react = items => `<div style="display: flex; gap: 6px; margin-top: 8px;">${items.map(([e, n, on]) => `<span style="height: 26px; padding: 0 9px; border-radius: 13px; border: 1px solid ${on ? '#bfdbfe' : '#ededed'}; background: ${on ? '#eff6ff' : '#fff'}; display: inline-flex; align-items: center; gap: 5px; font-size: 13px;">${e}<span style="font-size: 12px; color: #525252;">${n}</span></span>`).join('')}</div>`;
add('Chat-Channel-Phone.dc.html', 'chat', '#production', {
  tab: 'chat', crumb: 'Aura Farmers workspace', heading: '# production', sub: '12 members · 3 online now',
  right: `<div style="display: flex;">${['amy', 'leung', 'chan'].map((k, i) => pav(k, 28, ` margin-left: ${i ? -8 : 0}px; box-shadow: 0 0 0 2px #fff;`)).join('')}</div>`,
  chips: ['Your agent', '# production', '# announcements'], chipOn: 1,
  body: `
      <div style="padding: 12px 16px 2px;" class="cap">Today</div>
${msg('chan', 'Chan Ka-ming', '10:14', 'Rough cut v2 is up. Beats 3 and 5 still need footage.', `<div style="display: flex; gap: 10px; align-items: center; margin-top: 8px; padding: 8px; border: 1px solid #ededed; border-radius: 12px;">${cover('history', ' width: 72px; height: 40px; border-radius: 7px;')}<div style="min-width: 0;"><div class="nm" style="font-size: 13.5px;">rough_cut_v2.mp4</div><div class="cap">3:52 · 1.2 GB</div></div></div>${react([['🔥', 4, 1], ['👀', 2]])}`)}
${msg('leung', 'Leung Chi-hang', '10:33', 'Subtitles for ep75 are done: zh-HK and English. Uploading now.')}
${msg('amy', 'Amy Wong', '11:02', '<span style="color: var(--ac); background: #eff6ff; border-radius: 4px; padding: 0 3px;">@Agent</span> which beats still have no clip?')}
${msg('agent', 'Agent', '11:02', 'Beat 03 needs the strait at dusk, and beat 07 failed on Veo because the quota ran out. Everything else has footage.', `<div style="margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: #f8f8f8; font-size: 12.5px; color: #7c7c7c; line-height: 1.45;">Used only sources all 12 members of #production can read · 2 files left out</div>`)}
      <div style="display: flex; align-items: center; gap: 8px; padding: 6px 16px;"><span style="display: flex; gap: 3px;"><span class="dot" style="width: 5px; height: 5px; background: #c7c7c7;"></span><span class="dot" style="width: 5px; height: 5px; background: #c7c7c7;"></span><span class="dot" style="width: 5px; height: 5px; background: #c7c7c7;"></span></span><span class="cap">Michelle is typing</span></div>`,
  ask: 'Message #production…',
  sheet: sheet('#production · 12 members', 'Summarise what I missed this morning', 'Read 38 messages · 0.6 s', 'Rough cut v2 is up. Subtitles are done in both languages. Two beats still need footage, 03 and 07.', 'Post summary to thread', ['What did I miss?', 'Open tasks']),
});
add('Chat-Announce-Phone.dc.html', 'chat', '#announcements', {
  tab: 'chat', crumb: 'Aura Farmers workspace', heading: '# announcements', sub: 'Admins post · everyone reads', chips: ['Your agent', '# production', '# announcements'], chipOn: 2,
  body: `
      <div style="margin: 14px 16px 0; padding: 14px; border-radius: 16px; background: #fffbf0; border: 1px solid #f7dcb0;">
        <div style="display: flex; align-items: center; gap: 9px;">${pav('michelle', 30)}<div style="flex-grow: 1;"><div style="font-size: 14.5px; font-weight: 500;">Michelle Yip</div><div class="cap">Pinned · 1 Sep</div></div>${bd('Pinned', 'amb')}</div>
        <div style="font-size: 15px; line-height: 1.55; color: #383838; margin-top: 10px;">From Monday every script goes through Approval before it reaches Video Edit. No more locking by chat message.</div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 12px;"><div style="display: flex;">${['chan', 'amy', 'leung'].map((k, i) => pav(k, 22, ` margin-left: ${i ? -6 : 0}px; box-shadow: 0 0 0 2px #fffbf0;`)).join('')}</div><span class="cap">Seen by 11 of 12</span></div>
      </div>
${sec('Earlier')}
${msg('michelle', 'Michelle Yip', '28 Aug', 'The HK Tourism Board campaign is confirmed. Kick-off on 15 Sep, details in the brief.', react([['🎉', 9], ['🙌', 5]]))}
${msg('michelle', 'Michelle Yip', '21 Aug', 'Office closed on 26 Sep for the day after Mid-Autumn.', react([['🥮', 12, 1]]))}`,
  ask: 'Only admins can post here',
  sheet: sheet('#announcements', 'Anything here I need to act on?', 'Read 6 posts · 0.2 s', 'One thing: scripts now need approval before Video Edit. Your two drafts will go through Michelle.', 'Open my drafts'),
});
const brandTop = `<div style="display: flex; align-items: center; justify-content: space-between; padding: 22px 20px 0;"><div style="width: 36px; height: 36px; border-radius: 10px; background: #171717; color: #fff; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center;">AF</div><div style="display: flex; gap: 2px; padding: 2px; border-radius: 9px; background: #f3f3f3;"><span style="height: 30px; padding: 0 11px; border-radius: 7px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); font-size: 13px; display: flex; align-items: center;">简体中文</span><span style="height: 30px; padding: 0 11px; font-size: 13px; color: #7c7c7c; display: flex; align-items: center;">English</span></div></div>`;
/* sign-in: the desktop login's left panel (tilted collage of our own videos + headline), then the form */
const tile = (k, mt = 0) => `<div style="aspect-ratio: 16 / 10; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px 1px rgba(5,5,6,0.08);${mt ? ` margin-top: ${mt}px;` : ''}"><img src="cover-${k}.jpg" style="width: 100%; height: 100%; object-fit: cover;"></div>`;
add('Login-Phone.dc.html', 'chat', 'Sign in', { bare: true, body: `
  ${brandTop}
  <div style="padding: 26px 20px 0;">
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; transform: rotate(-3deg); margin: 0 -22px;">
      ${tile('history')}${tile('porsche', 14)}${tile('orange')}
      ${tile('goodday', -14)}${tile('domore')}<div style="aspect-ratio: 16 / 10; border-radius: 10px; background: #ffffff; border: 1px solid #ededed; margin-top: -14px; display: flex; flex-direction: column; justify-content: center; padding: 0 10px;"><div style="font-size: 17px; font-weight: 500; letter-spacing: -0.02em;">1.28M</div><div style="font-size: 9.5px; color: #999999; margin-top: 2px; white-space: nowrap;">views · last 28 days</div></div>
    </div>
  </div>
  <div style="padding: 30px 20px 0;">
    <div style="font-size: 24px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.22; text-wrap: balance;">One workspace for every video, every script, and every agent.</div>
    <div style="height: 22px;"></div>
    <div class="l" style="font-size: 12.5px; font-weight: 500; color: #7c7c7c; margin-bottom: 6px;">Work email</div><div class="fld" style="padding: 0;"><div class="v">chan.kaming@aurafarmers.hk</div></div>
    <div style="display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 500; color: #7c7c7c; margin: 14px 0 6px;"><span>Password</span><span style="color: var(--ac); font-weight: 420;">Forgot?</span></div><div class="fld" style="padding: 0;"><div class="v" style="letter-spacing: .2em;">••••••••••</div></div>
    <div class="bp" style="flex: none; margin-top: 20px; height: 50px;">Continue</div>
    <div style="text-align: center; margin-top: 16px; font-size: 14px; color: var(--ac);">Use company single sign-on</div>
  </div>
  <div style="margin-top: auto; padding: 0 20px 30px; text-align: center;" class="cap">Two-step sign-in is required. Sessions end after 12 hours without activity.</div>` });
add('Login-Totp-Phone.dc.html', 'chat', 'Sign in · two-step', { bare: true, body: `
  ${brandTop}
  <div style="padding: 56px 20px 0;">
    <div style="font-size: 28px; font-weight: 500; letter-spacing: -.01em;">Enter your code</div>
    <div style="font-size: 15px; color: #7c7c7c; margin-top: 10px; line-height: 1.5;">Open your authenticator app and type the 6-digit code for Aura Farmers.</div>
    <div style="display: flex; gap: 8px; margin-top: 30px;">${['4', '8', '1', '9', '2', '6'].map((d, i) => `<div style="flex: 1; height: 58px; border-radius: 12px; background: ${d ? '#fff' : '#f3f3f3'}; ${d ? 'border: 1px solid #e2e2e2;' : ''}${i === 6 ? ' box-shadow: 0 0 0 2px var(--ac), 0 0 0 5px #eff6ff; background: #fff;' : ''} display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 500;">${d}</div>`).join('')}</div>
    <div style="display: flex; align-items: center; gap: 10px; margin-top: 22px;">${cbx(true)}<span style="font-size: 14.5px;">Trust this phone for 30 days</span></div>
    <div class="bp" style="flex: none; margin-top: 26px; height: 50px;">Verify</div>
    <div style="text-align: center; margin-top: 18px; font-size: 14px; color: var(--ac);">Use a recovery code instead</div>
  </div>
  <div style="margin-top: auto; padding: 0 20px 36px; text-align: center;" class="cap">Signed in as amy.wong@aurafarmers.hk · <span style="color: var(--ac);">Not you?</span></div>` });

/* =================================================================== */
/* MARKET RESEARCH                                                     */
/* =================================================================== */
const RCH = ['Compare', 'Performance', 'Inbox', 'Backlog'];
const line = (seed, base, lift, liftAt, W = 358, H = 150) => { let s = seed, v = base, pts = []; for (let i = 0; i < 40; i++) { s = (s * 16807) % 2147483647; v = Math.max(8, v + ((s / 2147483647) - .47) * 9); const b = i >= liftAt ? lift * (1 - Math.exp(-(i - liftAt) / 4)) : 0; pts.push([(i / 39 * W).toFixed(1), (H - 8 - (v + b) * (H - 16) / 130).toFixed(1)]); } return pts; };
const path2 = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
const SER = [['Dai pai dong', 'var(--ac)', 11, 40, 55, 24, '+38%'], ['Night market', '#383838', 5, 36, 30, 26, '+21%'], ['Hawker succession', '#8d99a6', 23, 34, 8, 20, '+3%'], ['Cha chaan teng', '#c7c7c7', 41, 42, -10, 18, '−7%']];
/* phones have no Trends screen, so the ranked topics sit under Compare; the Category picker hides the rest */
const trending = `
${sec('Trending now', 'ranked by heat')}
${TOPICS.map(([n, h, ch, up, , cat], i) => `<sc-if value="{{w_${i}}}" hint-placeholder-val="{{ true }}">${row({ lead: `<span style="width: 22px; font-size: 13px; color: #c7c7c7; font-variant-numeric: tabular-nums; flex-shrink: 0;">${String(i + 1).padStart(2, '0')}</span>`, title: n, sub: `<span>${catName(cat)}</span>`, trail: `<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;"><span style="font-size: 15px; font-weight: 500;">${h}</span><span style="font-size: 12.5px; color: ${up ? '#278f5e' : '#e03636'};">${ch}</span></div>` })}</sc-if>`).join('')}
<sc-if value="{{wNone}}" hint-placeholder-val="{{ false }}"><div style="padding: 28px 16px; text-align: center; font-size: 14px; color: #999999;">No topics in these categories yet</div></sc-if>`;
add('Res-Compare-Phone.dc.html', 'res', 'Search & compare', {
  tab: 'res', crumb: 'Market Research', heading: 'Compare', sub: '4 topics · HK · last 40 days', chips: RCH, chipOn: 0,
  body: `${phoneFilters}
      <div style="padding: 14px 16px 0;"><div class="card" style="padding: 12px 12px 8px;">
        <div class="cap" style="margin-bottom: 6px;">Search interest, indexed to 100 · Google Trends, GDELT</div>
        <svg viewBox="0 0 334 150" style="width: 100%; height: 150px; display: block; fill: none; stroke-linecap: round; stroke-linejoin: round;"><g stroke="#f3f3f3"><path d="M0 40h334M0 80h334M0 120h334"/></g>${SER.map(([, c, sd, b, l, at]) => `<path d="${path2(line(sd, b, l, at, 334, 150))}" stroke="${c}" stroke-width="${c === 'var(--ac)' ? 2.2 : 1.6}"/>`).join('')}<line x1="200" y1="10" x2="200" y2="146" stroke="#c7c7c7" stroke-dasharray="3 3"/></svg>
        <div style="display: flex; justify-content: space-between;" class="cap"><span>2 Aug</span><span>27 Aug · licence ruling</span><span>10 Sep</span></div>
      </div></div>
${sec('Topics', 'change over 14 days', '+ Add')}
${SER.map(([n, c, , , , , ch], i) => row({ lead: `<span style="width: 14px; height: 4px; border-radius: 2px; background: ${c}; flex-shrink: 0;"></span>`, title: n, sub: `<span>Index ${[184, 142, 108, 91][i]} · peak ${['29 Aug', '3 Sep', '1 Sep', '12 Aug'][i]}</span>`, trail: `<span style="font-size: 14px; font-weight: 500; color: ${ch.startsWith('−') ? '#e03636' : '#278f5e'};">${ch}</span>`, sep: i < 3 ? 'n' : '' })).join('')}
${trending}`,
  ask: 'Ask about these topics…',
  extraCss: PHONE_PICK_CSS, overlay: phoneSheets, logic: pickLogic(TOPICS.map(t => t[5])),
  sheet: sheet('4 topics · 40 days', 'Why did dai pai dong jump?', 'Read 212 articles · 0.9 s', 'It broke from its baseline on 27 Aug, the day the licensing board ruled licences can pass to family. Night market rose with it.', 'Add to backlog'),
});
const PV = [['history', 'History of Greece · Ep 74', '412k views · 52% watched', '+24%'], ['porsche', 'Porsche cat · night drive', '288k views · 61% watched', '+18%'], ['goodday', 'Good day · teaser', '96k views · 38% watched', '−6%']];
/* daily views chart: headline, range switch, gridlines with labels, the Ep 75 spike called out, comments as bars below */
function perfChart() {
  const V = [22, 24, 21, 26, 25, 23, 27, 26, 29, 31, 28, 30, 33, 35, 96, 88, 72, 64, 58, 55, 52, 50, 49, 51, 48, 47, 50, 53];
  const C = [40, 42, 38, 45, 44, 41, 47, 45, 52, 55, 50, 53, 58, 60, 180, 160, 130, 110, 95, 90, 86, 82, 80, 83, 79, 76, 81, 85];
  const L = 34, W = 324, T = 16, H = 132, max = 100, n = V.length;
  const x = i => +(L + i * (W - L - 6) / (n - 1)).toFixed(1), y = v => +(T + H - v / max * H).toFixed(1);
  const pts = V.map((v, i) => [x(i), y(v)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  const grid = [0, 25, 50, 75, 100].map(g => `<line x1="${L}" x2="${W}" y1="${y(g)}" y2="${y(g)}" stroke="#f0f0f0"/><text x="${L - 7}" y="${y(g) + 3.5}" text-anchor="end" font-size="10" fill="#a3a3a3">${g ? g + 'k' : '0'}</text>`).join('');
  const bars = C.map((c, i) => `<rect x="${x(i) - 3}" y="${T + H + 34 - c / 180 * 26}" width="6" height="${c / 180 * 26}" rx="1.5" fill="${i === 14 ? 'var(--ac)' : '#d9d9d9'}"/>`).join('');
  const [sx, sy] = pts[14];
  return `<div class="card" style="padding: 14px 14px 10px;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;">
          <div><div class="cap">Daily views</div><div style="display: flex; align-items: baseline; gap: 8px; margin-top: 3px;"><span style="font-size: 24px; font-weight: 500; letter-spacing: -0.02em;">1.28M</span><span style="font-size: 12px; font-weight: 500; color: #278f5e; background: #e4faeb; border-radius: 6px; padding: 2px 6px;">+18%</span></div><div class="cap" style="margin-top: 2px;">vs previous 28 days</div></div>
          <div style="display: flex; gap: 2px; padding: 2px; border-radius: 9px; background: #f3f3f3; flex-shrink: 0;">${['7 d', '28 d', '90 d'].map(r => `<span style="height: 26px; padding: 0 9px; border-radius: 7px; font-size: 12px; display: flex; align-items: center; ${r === '28 d' ? 'background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500;' : 'color: #7c7c7c;'}">${r}</span>`).join('')}</div>
        </div>
        <svg viewBox="0 0 ${W} ${T + H + 56}" style="width: 100%; display: block; margin-top: 10px; overflow: visible;">
          <defs><linearGradient id="pv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--ac)" stop-opacity=".22"/><stop offset="1" stop-color="var(--ac)" stop-opacity="0"/></linearGradient></defs>
          ${grid}
          <path d="${d} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)}Z" fill="url(#pv)"/>
          <path d="${d}" fill="none" stroke="var(--ac)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
          <line x1="${sx}" x2="${sx}" y1="${T}" y2="${T + H}" stroke="#171717" stroke-dasharray="3 3" opacity=".35"/>
          <circle cx="${sx}" cy="${sy}" r="4.5" fill="#fff" stroke="var(--ac)" stroke-width="2.4"/>
          <g transform="translate(${sx + 8} ${sy - 4})"><rect width="104" height="34" rx="8" fill="#171717"/><text x="9" y="14" font-size="10.5" fill="#a3a3a3">Ep 75 published</text><text x="9" y="27" font-size="11.5" font-weight="600" fill="#fff">28 Aug · 96k</text></g>
          ${bars}
          <text x="${x(0)}" y="${T + H + 52}" font-size="10" fill="#a3a3a3">14 Aug</text><text x="${sx}" y="${T + H + 52}" font-size="10" fill="#a3a3a3" text-anchor="middle">28 Aug</text><text x="${x(n - 1)}" y="${T + H + 52}" font-size="10" fill="#a3a3a3" text-anchor="end">10 Sep</text>
        </svg>
        <div style="display: flex; gap: 14px; margin-top: 6px; font-size: 12px; color: #7c7c7c;"><span style="display: flex; align-items: center; gap: 6px;"><span style="width: 14px; height: 3px; border-radius: 2px; background: var(--ac);"></span>Views</span><span style="display: flex; align-items: center; gap: 6px;"><span style="width: 6px; height: 10px; border-radius: 1.5px; background: #d9d9d9;"></span>Comments</span><span style="margin-left: auto;">All channels</span></div>
      </div>`;
}
add('Res-Perf-Phone.dc.html', 'res', 'Content performance', {
  tab: 'res', crumb: 'Market Research', heading: 'Performance', sub: 'Your videos · last 28 days', chips: RCH, chipOn: 1,
  body: `
      <div style="padding-top: 14px;">${kpis([['Views', '1.28 M', '+18% on the month before'], ['Watched through', '46%', 'of the average video'], ['Engagement rate', '5.2%', 'likes, shares, comments'], ['Comments', '2,140', '27 need a reply']])}</div>
      <div style="padding: 12px 16px 0;">${perfChart()}</div>
${sec('Top and bottom', '', 'All videos')}
${PV.map(([c, t, s, ch], i) => row({ lead: cover(c, ' width: 54px; height: 36px; border-radius: 8px;'), title: t, sub: `<span>${s}</span>`, trail: `<span style="font-size: 13.5px; font-weight: 500; color: ${ch.startsWith('−') ? '#e03636' : '#278f5e'};">${ch}</span>`, sep: i < 2 ? 'i' : '' })).join('')}`,
  ask: 'Ask about performance…',
  sheet: sheet('Your channels · 28 days', 'What made Ep 74 do so well?', 'Read analytics for 11 videos · 0.7 s', 'People kept watching past the first minute: 52% watched through, about 14 points above your average. The cold open with no narration seems to work.', 'Use it for Ep 75'),
});
const CM = [['KL', 'yt', 'This episode is great, when is the next one?', 'grn', 'Positive', 'Thank you! Ep 75 goes up on 12 Sep.'], ['WS', 'ig', '背景音乐好大声，听唔清楚旁白', 'amb', 'Complaint', ''], ['BP', 'ig', 'Do you take sponsorships? We are a F&amp;B group.', 'blue', 'Business lead', ''], ['TM', 'yt', 'First!!!', 'gray', 'Neutral', '']];
const LG = { yt: '#ff0000', ig: '#d62976' };
add('Res-Inbox-Phone.dc.html', 'res', 'Comment inbox', {
  tab: 'res', crumb: 'Market Research', heading: 'Comment inbox', sub: '27 waiting · replies need approval', chips: RCH, chipOn: 2,
  body: `
      <div style="display: flex; gap: 8px; padding: 12px 16px 4px; overflow: hidden;"><div class="chip on">All <b>27</b></div><div class="chip">Leads <b>2</b></div><div class="chip">Complaints <b>4</b></div><div class="chip">繁中 <b>11</b></div></div>
${CM.map(([i2, ch, text, tone, lab, draft], i) => `
      <div style="padding: 12px 16px; ${i === 0 ? 'background: #fcfcfc;' : ''}">
        <div style="display: flex; gap: 11px;">${ini(i2, 34)}<div style="min-width: 0; flex-grow: 1;"><div style="display: flex; align-items: center; gap: 7px;"><span style="width: 8px; height: 8px; border-radius: 2px; background: ${LG[ch]};"></span><span class="cap">${ch === 'yt' ? 'YouTube' : 'Instagram'} · Ep 74</span><span style="margin-left: auto;">${bd(lab, tone)}</span></div><div style="font-size: 14.5px; line-height: 1.5; margin-top: 5px;">${text}</div>
        ${draft ? `<div style="margin-top: 10px; padding: 10px 12px; border-radius: 12px; background: #f5faff;"><div class="cap" style="color: var(--ac); margin-bottom: 3px;">Drafted reply</div><div style="font-size: 14px; line-height: 1.5;">${draft}</div><div style="display: flex; gap: 8px; margin-top: 10px;"><div class="bs" style="height: 38px; font-size: 13.5px;">Edit</div><div class="bp" style="height: 38px; font-size: 13.5px;">Approve and send</div></div></div>` : ''}</div></div>
      </div><div class="rs n"></div>`).join('')}`,
  ask: 'Ask about comments…',
  sheet: sheet('Comment inbox · 27', 'Any business leads?', 'Read 27 comments · 0.4 s', 'Two. The strongest is @brandpartner_hk asking about sponsorship; their account links to a Causeway Bay F&amp;B group. I drafted a reply for you to approve.', 'Open the draft'),
});
const BL = [['Adopted', [['94', 'Sham Shui Po dai pai dong revival', 'amy', 'Due 12 Sep', 'red']]], ['Briefing', [['81', 'Harbourfront redevelopment hearing', 'leung', 'Due 3 Oct', ''], ['71', 'Singapore hawker succession', 'michelle', 'Blocked', 'amb']]], ['Scripting', [['76', 'Cantonese voice cloning backlash', 'leung', 'Due 26 Sep', '']]], ['Handed to Video', [['88', 'Taipei night-market crossover', 'leung', 'In review', '']]]];
add('Res-Backlog-Phone.dc.html', 'res', 'Topic backlog', {
  tab: 'res', crumb: 'Market Research', heading: 'Topic backlog', sub: '9 topics · hands off to Script', chips: RCH, chipOn: 3,
  body: BL.map(([g, items]) => `${sec(g, `${items.length}`)}
${items.map(([h, t, o, due, tone], i) => row({ lead: `<div style="width: 40px; height: 40px; border-radius: 11px; background: #f5faff; color: var(--ac); font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${h}</div>`, title: t, sub: `${pav(o, 16)}<span>${P[o][1]}</span>`, trail: tone ? bd(due, tone) : `<span class="cap">${due}</span>`, sep: i < items.length - 1 ? 'i' : '' })).join('')}`).join(''),
  ask: 'Ask about the backlog…',
  sheet: sheet('Backlog · 9 topics', 'What will miss its date?', 'Read 9 topics · 0.3 s', 'Dai pai dong is due in 2 days and still has no brief. At the usual 3 days from brief to lock, it will miss 12 Sep.', 'Start the brief'),
});

/* =================================================================== */
/* SCRIPT                                                              */
/* =================================================================== */
const ST = { brief: ['Brief', '#c7c7c7'], draft: ['Drafting', '#007be0'], changes: ['Changes asked', '#e03636'], await: ['Awaiting approval', '#f5a524'], locked: ['Locked', '#30a46c'] };
const DOCS = [['Sham Shui Po dai pai dong revival', 'draft', 'v4 · 2 min ago'], ['Taipei night-market crossover', 'await', 'v3 · 2 h ago'], ['History of Greece · Ep 75', 'locked', 'v6 · 28 Aug'], ['Cantonese voice cloning backlash', 'draft', 'v1 · Yesterday'], ['Good day · collage teaser', 'await', 'v2 · Yesterday'], ['Harbourfront redevelopment', 'brief', 'Brief · 3 Sep'], ['Cha chaan teng menu inflation', 'changes', 'v2 · 1 Sep'], ['Porsche cat · night drive', 'locked', 'v3 · 2 Sep']];
const STABS = ['Brief', 'Draft', 'Versions', 'Approval'];
add('Script-Library-Phone.dc.html', 'script', 'Library', {
  tabLabel: 'Script', crumb: 'Scripts', heading: '2026-Q3-campaign', sub: '11 scripts · 3 folders', chips: ['All <b>11</b>', 'Drafting <b>3</b>', 'Awaiting <b>2</b>', 'Locked <b>4</b>'],
  body: `
      <div style="display: flex; gap: 18px; padding: 16px 16px 6px;">${['Shot notes', 'Transcripts', 'References'].map(n => `<div style="display: flex; flex-direction: column; align-items: center; gap: 7px; width: 80px;">${folderIcon(3)}<span style="font-size: 12.5px; text-align: center;">${n}</span></div>`).join('')}</div>
${sec('Scripts', 'last edited')}
${DOCS.map(([t, st, m], i) => row({ lead: `<div style="width: 44px; display: flex; justify-content: center; flex-shrink: 0;">${docIcon(st, 2.2)}</div>`, title: t, sub: `${dot(ST[st][1])}<span>${ST[st][0]} · ${m}</span>`, trail: chev, sep: i < DOCS.length - 1 ? 'i' : '' })).join('')}`,
  ask: 'Ask about these scripts…',
  sheet: sheet('2026-Q3-campaign · 11 scripts', 'What’s holding this folder up?', 'Read 11 scripts · 0.9 s', 'Two scripts have waited on Michelle for more than a day: Taipei night-market and Good day. Cantonese voice cloning is the only draft under the house-style bar.', 'Remind Michelle'),
});
const sspHead = { tabLabel: 'Script', crumb: 'Scripts · 2026-Q3-campaign', heading: 'Dai pai dong revival', sub: 'v4 · Drafting · YouTube 16:9 · 3:48' };
add('Script-Brief-Phone.dc.html', 'script', 'Brief', {
  ...sspHead, chips: STABS, chipOn: 0,
  body: `<div style="padding-top: 14px;"></div>
${fld('Topic', 'Sham Shui Po dai pai dong revival<span style="margin-left: auto;">' + bd('Backlog · 94', 'blue') + '</span>')}
${fld('Angle', 'Operator interview')}
      <div style="display: grid; grid-template-columns: 1fr 1fr;">${fld('Channel', 'YouTube 16:9')}${fld('Length', '3:45 ±5%')}</div>
      <div class="fld"><div class="l">Tone</div><div style="display: flex; gap: 8px;"><div class="chip on">Warm</div><div class="chip on">Documentary</div><div class="chip">Playful</div></div></div>
${sec('Must include', 'checked in every draft')}
${['Name the four remaining stalls', 'Quote the board decision word for word', 'Credit the HK Film Archive'].map((t, i) => row({ lead: tick(), title: t, sub: `<span>In v4 · beat 0${[6, 4, 5][i]}</span>`, sep: i < 2 ? 'n' : '' })).join('')}
${btns('Generate v5 from brief')}`,
  ask: 'Ask about this brief…',
  sheet: sheet('Brief + backlog research', 'Is anything missing from this brief?', 'Read brief and 3 sources · 1.1 s', 'The 1998 archive plate is licensed only until March 2027. If the video should stay up longer, it needs a note for Publish.', 'Add the note'),
});
add('Script-Editor-Phone.dc.html', 'script', 'Draft', {
  ...sspHead, chips: STABS, chipOn: 1,
  body: `
      <div style="display: flex; align-items: center; gap: 12px; margin: 12px 16px 4px; padding: 10px 12px; border-radius: 14px; background: #fafafa;">
        <svg viewBox="0 0 40 40" style="width: 38px; height: 38px; transform: rotate(-90deg); flex-shrink: 0;"><circle cx="20" cy="20" r="16" fill="none" stroke="#ededed" stroke-width="4.5"/><circle cx="20" cy="20" r="16" fill="none" stroke="var(--ac)" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="82 100.5"/></svg>
        <div style="flex-grow: 1;"><div style="font-size: 15px; font-weight: 500;">82 house style</div><div class="cap">4 suggestions · 3:48 of 3:45</div></div>${bd('+3 s', 'amb')}
      </div>
${[['01', '0:00', 'Shutters rolling up at 6:40 am.', '（现场声）', 'Natural sound only.'], ['02', '0:12', 'Wide, handheld, Pei Ho Street, <span style="text-decoration: underline wavy #f5a524; text-underline-offset: 3px;">morning light before the crowds</span>.', '深水埗曾经有过百档大牌档，今日只剩四档。', 'Sham Shui Po once had over a hundred. Four are left.'], ['03', '0:31', 'Mrs Ho at her counter, mid-shot.', '「张牌系我阿爸留低嘅。」', '“My father left me this licence.”']].map(([n, t, vi, zh, en], i) => `
      <div style="padding: 12px 16px; border-bottom: 1px solid #f3f3f3;">
        <div style="display: flex; gap: 8px;" class="cap"><b style="font-weight: 500; color: #7c7c7c;">Beat ${n}</b><span>${t}</span></div>
        <div style="font-size: 13.5px; color: #7c7c7c; margin-top: 5px; line-height: 1.5;">${vi}</div>
        <div style="font-size: 15.5px; margin-top: 6px; line-height: 1.55;">${zh}</div><div style="font-size: 13.5px; color: #7c7c7c; margin-top: 2px;">${en}</div>
        ${i === 1 ? `<div style="margin-top: 10px; padding: 11px 12px; border-radius: 12px; border: 1px solid #f7dcb0; background: #fffbf0;"><div class="cap" style="color: #b36b00;">House style · name the hour</div><div style="font-size: 14px; margin-top: 4px;"><s style="color: #e03636;">morning light</s> → <span style="color: #278f5e;">at 6:40 am</span></div><div style="display: flex; gap: 8px; margin-top: 10px;"><div class="bs" style="height: 36px; font-size: 13.5px;">Reject</div><div class="bp" style="height: 36px; font-size: 13.5px; background: #171717;">Accept</div></div></div>` : ''}
      </div>`).join('')}`,
  ask: 'Rewrite a line, or ask…',
  sheet: sheet('Beat 02 selected', 'Make the closing line warmer', 'Rewrote 1 line · 0.8 s', '“佢哋唔系怀旧，系仲喺度做紧生意。” becomes “佢哋唔系回忆，系每朝六点开档嘅生活。” Same length, keeps the stall owners as the subject.', 'Use it', ['Shorter', 'Warmer', '书面语']),
});
add('Script-Versions-Phone.dc.html', 'script', 'Versions', {
  ...sspHead, chips: STABS, chipOn: 2,
  body: `
      <div style="display: flex; align-items: center; gap: 8px; padding: 14px 16px 6px;"><div class="chip">${bd('A', 'red')} v3</div><span class="cap">compared with</span><div class="chip">${bd('B', 'grn')} v4</div></div>
      <div style="padding: 6px 0 0;">${kpis([['Words', '<span style="color: #278f5e;">+38</span> <span style="color: #e03636;">−14</span>'], ['House style', '76 → 82']])}</div>
      <div style="padding: 12px 16px 0; display: flex; flex-direction: column; gap: 10px;">
        <div class="card"><div class="cap">Beat 02 · visual</div><div style="font-size: 14.5px; line-height: 1.55; margin-top: 6px;">Wide, handheld, Pei Ho Street <span style="background: #ffe7e7; color: #c53030; text-decoration: line-through;">at dawn</span> <span style="background: #e4faeb; color: #1f7a4d;">morning light before the crowds arrive</span>.</div></div>
        <div class="card"><div class="cap">Beat 04 · voice-over</div><div style="font-size: 14.5px; line-height: 1.55; margin-top: 6px;">发牌委员会八月决定，<span style="background: #ffe7e7; color: #c53030; text-decoration: line-through;">放宽续牌</span><span style="background: #e4faeb; color: #1f7a4d;">现有牌照可以转让俾直系亲属</span>。</div></div>
      </div>
${sec('History', '4 versions')}
${[['v4', 'amy', 'Tone pass on beats 2, 4, 6', '2 Sep 09:40'], ['v3', 'leung', 'Added the archive credit', '1 Sep 18:20'], ['v2', 'amy', 'Cut beat 07', '1 Sep 15:12'], ['v1', 'chan', 'First draft from the brief', '1 Sep 14:02']].map(([v, o, t, w], i) => row({ lead: `<div style="width: 40px; height: 40px; border-radius: 11px; background: #f3f3f3; font-size: 14px; font-weight: 500; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${v}</div>`, title: t, sub: `${pav(o, 16)}<span>${P[o][1]} · ${w}</span>`, sep: i < 3 ? 'i' : '' })).join('')}`,
  ask: 'Ask about these versions…',
  sheet: sheet('v3 → v4', 'What changed between v3 and v4?', 'Compared v3 and v4 · 0.4 s', 'Amy’s tone pass touched beats 2, 4 and 6. Beat 04 now quotes the ruling exactly. Spoken length went up 6 s to 3:48.', 'Trim 3 seconds'),
});
add('Script-Lock-Phone.dc.html', 'script', 'Approval', {
  ...sspHead, sub: 'v4 · Awaiting your approval', chips: STABS, chipOn: 3, me: 'michelle',
  body: `
      <div style="display: flex; gap: 11px; margin: 14px 16px 4px; padding: 12px; border-radius: 14px; background: #fafafa;">${pav('amy', 32)}<div><div style="font-size: 14.5px; font-weight: 500;">Amy Wong <span class="cap" style="font-weight: 420;">sent v4 · 2 h ago</span></div><div style="font-size: 14px; line-height: 1.5; color: #383838; margin-top: 4px;">Tone pass done and the ruling is quoted exactly.</div></div></div>
${sec('Before you lock', '5 of 6 pass')}
${[['All 3 must-include points are in', 1], ['Nothing from “things to avoid”', 1], ['Length within 5% of target', 1], ['Sources credited', 1], ['You didn’t write this version', 1], ['2 house-style suggestions still open', 0]].map(([t, ok], i) => row({ lead: ok ? tick() : warn(), title: t, sep: i < 5 ? 'n' : '' })).join('')}
      <div class="note" style="margin-top: 10px; background: #fffbf0; color: #8a5a0d;">Locking makes v4 the one authorised version and sends it to Video Edit. It becomes read-only.</div>
${btns('Approve and lock', 'Ask for changes')}`,
  ask: 'Ask before you approve…',
  sheet: sheet('v4 · approval check', 'Anything I should read closely?', 'Read v4, brief, 2 sources · 0.8 s', 'Beat 04 quotes the board’s ruling, and it matches the 14 Aug minutes exactly. The two open suggestions are style only.', 'Open beat 04'),
});
add('Script-Locked-Phone.dc.html', 'script', 'Locked script', {
  tabLabel: 'Script', crumb: 'Scripts · History of Greece', heading: 'Ep 75 · Salamis', sub: 'v6 · Locked · approved 28 Aug', chips: STABS, chipOn: 1,
  body: `
      <div class="note" style="margin-top: 14px; background: #f3fbf6; color: #1f6b47; display: flex; gap: 10px; align-items: flex-start;">${tick()}<span><b style="font-weight: 500;">v6 is the authorised version.</b> Approved by Michelle Yip and sent to Video Edit.</span></div>
${[['01', '0:00', 'Map of the Aegean, slow push.', 'In 480 BC, a Persian fleet gathers off Attica.'], ['02', '0:24', 'Marble relief of rowers.', 'Three banks of rowers. One drum.'], ['03', '0:50', 'Strait at dusk, drone.', 'The Greeks choose the narrows.'], ['04', '1:21', 'Fire spreads across the strait.', 'Themistocles lets a rumour reach the king.']].map(([n, t, vi, vo]) => `
      <div style="padding: 12px 16px; border-bottom: 1px solid #f3f3f3;"><div style="display: flex; gap: 8px;" class="cap"><b style="font-weight: 500; color: #7c7c7c;">Beat ${n}</b><span>${t}</span></div><div style="font-size: 13.5px; color: #7c7c7c; margin-top: 5px;">${vi}</div><div style="font-size: 15px; margin-top: 5px; line-height: 1.5;">${vo}</div></div>`).join('')}
${btns('', 'Start v7')}`,
  ask: 'Ask about this script…',
  sheet: sheet('History of Greece · v6', 'Where is this script now?', 'Read the approval record · 0.2 s', 'Video Edit has it as project 003. The rough cut is rendering and it’s scheduled to publish on 12 Sep.', 'Open project 003'),
});

/* =================================================================== */
/* VIDEO EDIT                                                          */
/* =================================================================== */
const VCH = ['Shots', 'Media', 'Renders', 'Preview', 'Audio', 'Export'];
const vHead = { tabLabel: 'Video', crumb: 'Video Edit · 2026-Q3-campaign', heading: 'History of Greece', sub: 'Ep 75 · Rendering · HK$412 of HK$900' };
const PROJ = [['history', 'History of Greece · Ep 75', 'Rendering', '#007be0', '6 of 9 shots'], ['orange', 'Orange typography cut', 'In review', '#f5a524', '4 of 4 shots'], ['goodday', 'Good day · collage teaser', 'On hold', '#999999', 'Script v2 needs approval'], ['porsche', 'Porsche cat · night drive', 'Exported', '#30a46c', '3 formats'], ['domore', 'Do more · brand spot', 'Exported', '#30a46c', 'Published 1 Sep'], [null, 'Sham Shui Po revival', 'Waiting for script', '#c7c7c7', 'Opens when v4 is locked']];
add('Video-Library-Phone.dc.html', 'video', 'Library', {
  tabLabel: 'Video', crumb: 'Video Edit', heading: 'Projects', sub: '2026-Q3-campaign · 6 projects', chips: ['All <b>6</b>', 'Rendering <b>1</b>', 'In review <b>1</b>', 'Exported <b>2</b>'],
  body: `
      <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 12px; padding: 14px 16px;">
${PROJ.map(([c, t, st, col, m]) => `        <div class="ptile" style="min-width: 0;"><div style="position: relative; border-radius: 12px; overflow: hidden; aspect-ratio: 16 / 10; background: #f3f3f3;">${c ? cover(c, ' position: absolute; inset: 0;' + (st === 'On hold' ? ' filter: grayscale(1); opacity: .6;' : '')) : `<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;">${px([[SPRITE.CLAP]], { s: 2.5 })}</div>`}<span style="position: absolute; left: 7px; bottom: 7px; height: 20px; padding: 0 7px; border-radius: 6px; background: rgba(255,255,255,.95); font-size: 11px; font-weight: 500; display: flex; align-items: center; gap: 5px;"><span class="dot" style="width: 6px; height: 6px; background: ${col};"></span>${st}</span></div><div style="font-size: 13.5px; font-weight: 500; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t}</div><div class="cap" style="margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${m}</div></div>`).join('\n')}
      </div>`,
  ask: 'Ask about these projects…',
  sheet: sheet('6 projects', 'Which projects are at risk this week?', 'Read 6 projects and the queue · 0.7 s', 'History of Greece publishes on 12 Sep: shot 02 has no clip and shot 07 failed because the Veo quota ran out. Orange typography has waited on Michelle for 2 hours.', 'Open History of Greece'),
});
const SH = [['01', 'Aegean map, slow push', 'sea', 'Generated', 'Ready', '#30a46c', '0:24'], ['02', 'Marble relief of rowers', null, 'Footage', 'No clip', '#f5a524', '0:26'], ['03', 'Strait at dusk, drone', 'dusk', 'Generated', 'Rendering 62%', '#007be0', '0:31'], ['04', 'Fire across the strait', 'fire', 'Generated', 'Ready', '#30a46c', '0:36'], ['05', 'Winged Victory, tilt up', 'head', 'Still', 'Ready', '#30a46c', '0:28'], ['07', 'Salamis aftermath', null, 'Generated', 'Failed', '#e03636', '0:33']];
add('Video-Project-Phone.dc.html', 'video', 'Shots', {
  ...vHead, chips: VCH, chipOn: 0,
  body: `
      <div style="display: flex; gap: 2px; margin: 14px 16px 4px; border-radius: 6px; overflow: hidden;">${[24, 26, 31, 36, 28, 22, 33, 10, 18].map((s, i) => `<div style="flex: ${s} 1 0; height: 26px; background: ${i === 1 ? '#fff3d6' : i === 6 ? '#ffe7e7' : i === 2 ? '#cfe6fb' : '#e4faeb'}; font-size: 10px; font-weight: 600; color: #525252; display: flex; align-items: center; justify-content: center;">${String(i + 1).padStart(2, '0')}</div>`).join('')}</div>
      <div style="display: flex; justify-content: space-between; padding: 0 16px;" class="cap"><span>9 shots · 6 ready</span><span>3:48</span></div>
${SH.map(([n, t, c, src, st, col, d], i) => row({ lead: `<div style="position: relative;">${c ? cover(c, ' width: 64px; height: 40px; border-radius: 8px;') : `<div style="width: 64px; height: 40px; border-radius: 8px; background: ${st === 'Failed' ? '#fff6f6' : '#fffbf0'}; display: flex; align-items: center; justify-content: center;">${px([[st === 'Failed' ? SPRITE.BOT : SPRITE.FILM]], { s: 1.6, pal: { l: '#e5484d', B: '#c9ced6' } })}</div>`}<span class="pill" style="left: 4px; top: 4px; height: 16px; font-size: 10px; background: rgba(255,255,255,.95); color: #171717;">${n}</span></div>`, title: t, sub: `${dot(col)}<span>${st} · ${src} · ${d}</span>`, trail: chev, sep: i < SH.length - 1 ? 'i' : '' }).replace('margin-left: 82px', 'margin-left: 92px')).join('')}`,
  ask: 'Ask about these shots…',
  sheet: sheet('Project 003 · 9 shots', 'What’s stopping the rough cut?', 'Read shots, media, queue · 0.6 s', 'Shot 02 has no clip; marble_relief_rowers.mov fits. Shot 07 failed three times because the Veo quota on the client’s account is used up.', 'Assign the clip to 02'),
});
const CL = [['robe', 'marble_relief_rowers.mov', '4K · 0:48', '', 1], ['head', 'winged_victory_tilt.mov', '4K · 1:12', 'In 05'], ['wing', 'wing_detail_macro.mov', '4K · 0:31', 'In 06'], ['sea', 'aegean_map_push.mp4', 'Generated · 0:24', 'In 01'], ['dusk', 'strait_dusk_v2.mp4', 'Generated · 0:31', ''], ['fire', 'fire_over_strait.mp4', 'Generated · 0:36', 'In 04']];
add('Video-Bin-Phone.dc.html', 'video', 'Media', {
  ...vHead, chips: VCH, chipOn: 1,
  body: `
      <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 14px 16px;">
${CL.map(([c, n, m, used, sel]) => `        <div style="min-width: 0;"><div style="position: relative; border-radius: 12px; overflow: hidden; aspect-ratio: 16 / 10;${sel ? ' box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--ac);' : ''}">${cover(c, ' position: absolute; inset: 0;')}${used ? `<span class="pill" style="left: 6px; top: 6px; background: rgba(255,255,255,.95); color: #171717;">${used}</span>` : ''}</div><div style="font-size: 13px; margin-top: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n}</div><div class="cap">${m}</div></div>`).join('\n')}
      </div>
      <div style="position: absolute; left: 12px; right: 12px; bottom: 10px; display: flex; align-items: center; gap: 11px; padding: 10px; border-radius: 16px; background: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.14), 0 0 0 1px #ededed;">${cover('robe', ' width: 56px; height: 36px; border-radius: 8px;')}<div style="min-width: 0; flex-grow: 1;"><div style="font-size: 13.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">marble_relief_rowers</div><div class="cap">Fits shot 02</div></div><div class="bp" style="flex: none; height: 38px; padding: 0 14px; font-size: 13.5px;">Assign</div></div>`,
  ask: 'Ask about this media…',
  sheet: sheet('42 clips you can see', 'Which clip fits shot 02?', 'Searched 42 clips · 0.4 s', 'marble_relief_rowers.mov: 4K, unused, and matches “marble relief of rowers”. Trim 0:12 to 0:38 to fit 0:26.', 'Assign to shot 02'),
});
const bot = (lamp, body) => px([[SPRITE.BOT]], { s: 2.6, pal: { l: lamp, B: body } });
add('Video-Queue-Phone.dc.html', 'video', 'Renders', {
  ...vHead, chips: VCH, chipOn: 2,
  extraCss: `
    @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
    @keyframes zz { 0% { transform: translate(0, 0); opacity: 0; } 30% { opacity: 1; } 100% { transform: translate(6px, -12px); opacity: 0; } }
    .bob { animation: bob .9s steps(1, end) infinite; } .zz { animation: zz 2.4s steps(6) infinite; }`,
  body: `
      <div style="margin: 14px 16px 0; padding: 14px 12px 12px; border-radius: 16px; background-color: #fcfcfc; background-image: linear-gradient(45deg, #f5f5f5 25%, transparent 25%, transparent 75%, #f5f5f5 75%), linear-gradient(45deg, #f5f5f5 25%, transparent 25%, transparent 75%, #f5f5f5 75%); background-size: 12px 12px; background-position: 0 0, 6px 6px; border: 1px solid #f0f0f0;">
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; text-align: center;">
          ${[['#30a46c', '#4c7cf0', 'Veo Fast', '62%', 'bob'], ['#30a46c', '#4c7cf0', 'FFmpeg', '34%', 'bob'], ['#9aa5b1', '#aab8d6', 'Azure', 'Idle', 'zz'], ['#e5484d', '#c9ced6', 'Veo Lite', 'Stopped', '']].map(([l, b, n, s, a]) => `<div style="display: flex; flex-direction: column; align-items: center; gap: 6px; position: relative;"><div class="${a === 'bob' ? 'bob' : ''}">${bot(l, b)}</div>${a === 'zz' ? '<span class="zz" style="position: absolute; top: -6px; right: 10px; font-size: 12px; font-weight: 700; color: #9aa5b1;">z</span>' : ''}<div style="height: 6px; width: 46px; border-radius: 1px; background: #b86b30;"></div><div style="font-size: 12px; font-weight: 500;">${n}</div><div style="font-size: 11.5px; color: ${s === 'Stopped' ? '#e03636' : '#7c7c7c'};">${s}</div></div>`).join('')}
        </div>
      </div>
${sec('Needs you', '1')}
      <div style="margin: 0 16px; padding: 12px 14px; border-radius: 14px; background: #fff7f7; border: 1px solid #ffdcdc;"><div style="font-size: 14.5px; font-weight: 500;">Shot 07 · Salamis aftermath</div><div style="font-size: 13.5px; color: #8a3b3b; margin-top: 4px; line-height: 1.5;">The Veo quota on the client’s Google account ran out. Retries stopped after 3 tries.</div><div style="display: flex; gap: 8px; margin-top: 10px;"><div class="bs" style="height: 38px; font-size: 13.5px;">Retry</div><div class="bp" style="height: 38px; font-size: 13.5px;">Use Veo Fast · HK$22</div></div></div>
${sec('Working', '2')}
${[['Shot 03 · strait at dusk', 'Veo 3.1 Fast · try 1 of 3', 62], ['Rough cut v3 · 16:9', 'FFmpeg · try 1 of 3', 34]].map(([t, s, p], i) => row({ lead: `<div style="width: 40px; height: 40px; border-radius: 11px; background: #e6f4ff; color: #007be0; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${p}%</div>`, title: t, sub: `<span>${s}</span>`, trail: `<div style="width: 56px;">${pbar(p)}</div>`, sep: i < 1 ? 'i' : '' })).join('')}`,
  ask: 'Ask about the queue…',
  sheet: sheet('Render queue · project 003', 'Why did shot 07 fail?', 'Read the provider response · 0.3 s', 'The Veo 3.1 Lite quota on the client’s Google Cloud account ran out. It isn’t a platform fault, so it stopped instead of burning more tries.', 'Rerun on Veo Fast'),
});
add('Video-Preview-Phone.dc.html', 'video', 'Preview', {
  ...vHead, chips: VCH, chipOn: 3,
  body: `
      <div style="margin: 14px 16px 0; position: relative; border-radius: 14px; overflow: hidden; aspect-ratio: 16 / 9;">${cover('head', ' position: absolute; inset: 0;')}<div style="position: absolute; left: 10%; right: 10%; bottom: 8%; text-align: center;"><span style="display: inline-block; background: rgba(23,23,23,.78); color: #fff; font-size: 13px; line-height: 1.45; padding: 3px 9px; border-radius: 5px;">到入夜，波斯舰队已经溃散。</span></div></div>
      <div style="display: flex; align-items: center; gap: 12px; padding: 14px 16px 0;"><div style="width: 40px; height: 40px; border-radius: 20px; background: #171717; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><svg viewBox="0 0 24 24" style="width: 15px; height: 15px;"><path d="M8 5.5v13l10.5-6.5z" fill="#fff"/></svg></div><span style="font-size: 13px; font-variant-numeric: tabular-nums;">1:57</span><div style="flex-grow: 1; position: relative;">${pbar(52)}<span style="position: absolute; left: 52%; top: -5px; width: 15px; height: 15px; margin-left: -7px; border-radius: 8px; background: #fff; box-shadow: 0 0 0 2px var(--ac);"></span></div><span class="cap">3:48</span></div>
      <div style="display: flex; gap: 8px; padding: 14px 16px 0;"><div style="display: flex; gap: 2px; padding: 2px; border-radius: 10px; background: #f3f3f3;">${['16:9', '9:16', '1:1'].map((a, i) => `<span style="height: 32px; padding: 0 12px; border-radius: 8px; font-size: 13px; display: flex; align-items: center; ${i === 0 ? 'background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1);' : 'color: #7c7c7c;'}">${a}</span>`).join('')}</div><div class="chip" style="margin-left: auto;">Compare v2</div></div>
${sec('All cuts', '3 versions')}
      <div style="display: flex; gap: 12px; padding: 0 16px; align-items: flex-end;">${[['head', 112, 63, 'v3 · 16:9', 1], ['head', 36, 63, 'v3 · 9:16'], ['head', 63, 63, 'v3 · 1:1'], ['wing', 112, 63, 'v2 · 16:9']].map(([c, w, h, l, on]) => `<div style="flex-shrink: 0;">${cover(c, ` width: ${w}px; height: ${h}px; border-radius: 8px;${on ? ' box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--ac);' : ''}`)}<div style="font-size: 12px; margin-top: 7px;">${l}</div></div>`).join('')}</div>
${sec('On this cut', '2 comments')}
${row({ lead: pav('michelle', 32), title: 'Hold the statue one more second', sub: '<span>Michelle Yip · at 1:57</span>', sep: '' })}`,
  ask: 'Ask about this cut…',
  sheet: sheet('Rough cut v3', 'What changed from v2?', 'Compared two cuts · 0.5 s', 'Shots 03, 05 and 07 changed, it’s 4 s shorter, and the music is re-mixed under beat 04.', 'Send v3 for review'),
});
const wv = (seed, n, h, col) => { let s = seed, d = ''; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; const a = Math.max(2, (0.25 + s / 2147483647 * .75) * h); d += `M${(i * 4 + 2)} ${(20 - a / 2).toFixed(1)}v${a.toFixed(1)}`; } return `<svg viewBox="0 0 ${n * 4 + 4} 40" preserveAspectRatio="none" style="width: 100%; height: 40px; display: block;"><path d="${d}" stroke="${col}" stroke-width="2" stroke-linecap="round"/></svg>`; };
add('Video-Audio-Phone.dc.html', 'video', 'Audio', {
  ...vHead, chips: VCH, chipOn: 4,
  body: `
${sec('Mix', '3 tracks · 3:48')}
      <div style="padding: 0 16px; display: flex; flex-direction: column; gap: 10px;">
        ${[['Voice-over', 'Ryan, en-GB', '#525252', 7], ['Music', 'Aegean Drift', '#c7c7c7', 3], ['Effects', 'Oars, wind, fire', '#a896f0', 11]].map(([t, s, c, sd]) => `<div><div style="display: flex; justify-content: space-between; font-size: 13px;"><span style="font-weight: 500;">${t}</span><span class="cap">${s}</span></div><div style="margin-top: 5px; border-radius: 10px; background: #fafafa; overflow: hidden; position: relative;">${wv(sd, 80, 30, c)}${t === 'Music' ? '<svg viewBox="0 0 100 40" preserveAspectRatio="none" style="position: absolute; inset: 0; width: 100%; height: 40px;"><polyline points="0,8 8,8 11,28 30,28 33,8 40,8 43,28 70,28 73,8 100,8" fill="none" stroke="var(--ac)" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>' : ''}</div></div>`).join('')}
      </div>
      <div style="margin: 14px 16px 0;" class="card"><div style="display: flex; align-items: baseline; gap: 8px;"><span style="font-size: 15px; font-weight: 500;">Ducking</span><span style="font-size: 22px; font-weight: 500; margin-left: auto;">−14</span><span class="cap">dB under voice</span></div><div style="position: relative; margin-top: 14px;">${pbar(58)}<span style="position: absolute; left: 58%; top: -6px; width: 17px; height: 17px; margin-left: -8px; border-radius: 9px; background: #fff; box-shadow: 0 0 0 2px var(--ac), 0 1px 3px rgba(0,0,0,.2);"></span></div></div>
${sec('Beat 05 takes')}
      <div style="display: flex; gap: 8px; padding: 0 16px;"><div class="chip">Take 1</div><div class="chip">Take 2</div><div class="chip on">Take 3 · in use</div></div>`,
  ask: 'Ask about the mix…',
  sheet: sheet('Audio · project 003', 'Is the music too loud anywhere?', 'Measured the mix · 1.2 s', 'Only between 1:21 and 1:26: the fire effect and music sit 3 dB over the voice. Ducking the effect by 4 dB fixes it.', 'Duck the effect'),
});
add('Video-Export-Phone.dc.html', 'video', 'Export', {
  ...vHead, chips: VCH, chipOn: 5,
  body: `
${sec('Formats')}
${[['16:9', '3840 × 2160 · ~510 MB', 1, 56, 32], ['9:16', '2160 × 3840 · ~500 MB', 1, 20, 36], ['1:1', '2160 × 2160 · not needed', 0, 32, 32]].map(([f, s, on, w, h], i) => row({ lead: `<div style="width: 56px; height: 40px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${cover('history', ` width: ${w}px; height: ${h}px; border-radius: 5px;${on ? '' : ' opacity: .4;'}`)}</div>`, title: f, sub: `<span>${s}</span>`, trail: cbx(on), sep: i < 2 ? 'i' : '' })).join('')}
${sec('Also make')}
${[['Subtitles, 繁中 and English', 1], ['Voice-over stem', 1], ['Cover images, 3 sizes', 1], ['Music stem', 0]].map(([t, on], i) => row({ title: t, trail: cbx(on), sep: i < 3 ? 'n' : '', style: 'min-height: 52px;' })).join('')}
      <div class="note" style="margin-top: 12px; background: #fffbf0; color: #8a5a0d;">Shots 03 and 07 aren’t ready. The export starts by itself when they are. About HK$6.40.</div>
${btns('Export when ready')}`,
  ask: 'Ask about this export…',
  sheet: sheet('Export · project 003', 'Which formats does Publish need?', 'Read the caption · 0.4 s', 'YouTube needs 16:9 and Instagram Reels 9:16, both ticked. Nothing asks for 1:1.', 'Open the caption'),
});

/* the dock's "More", open: the business modules pop up above it */
add('Script-Library-Nav-Phone.dc.html', 'script', 'Library · More open', { ...seen['Script-Library-Phone.dc.html'], nav: 'open' });
fs.writeFileSync(path.join(DIR, 'phones-a.json'), JSON.stringify(out, null, 1));
console.log('wrote', out.length, 'phones');
