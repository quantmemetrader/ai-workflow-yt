/**
 * Build the live site from the canvas screens.
 * Each route gets one static page in public/app/ that carries its desktop
 * screen and its phone screen; site-runtime.js runs the screen's own logic,
 * picks desktop or phone by width, scales to fit, and wires navigation.
 * Clean URLs come from rewrites in next.config.ts.
 *
 * Run: node build-site.mjs   (from design/canvas)
 */
import fs from 'fs';
import path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(DIR, '..', '..', 'public', 'app');

/* path, module, desktop file, phone file, nav labels, global labels */
const R = [
  ['/login', 'login', 'Login', 'Login-Phone', [], ['Sign in to Aura Farmers']],
  ['/login/two-step', 'login', 'Login-Totp', 'Login-Totp-Phone', ['Continue', 'Sign in'], []],
  /* #production is where Chat opens, on phone and desktop */
  ['/chat/production', 'chat', 'Chat-Channel', 'Chat-Channel-Phone', ['production', '# production', 'Messages'], []],
  ['/chat', 'chat', 'Main', 'ChatPhone', ['Your agent', 'Conversation', 'Agent'], []],
  ['/chat/announcements', 'chat', 'Chat-Announce', 'Chat-Announce-Phone', ['announcements', '# announcements', 'Posts'], []],
  /* signing in lands on the Database */
  ['/files', 'files', 'FilesDesktop', 'FilesPhone', ['Renders', 'Database'], ['Open in Database', 'Upload to Database', 'Verify', 'Use a recovery code instead', 'Use company single sign-on']],
  /* on phones Research opens on Search & compare */
  ['/research', 'research', 'Res-Trends', 'Res-Compare-Phone', ['Trends dashboard', 'Trends'], []],
  ['/research/compare', 'research', 'Res-Compare', 'Res-Compare-Phone', ['Search & compare', 'Search &amp; compare', 'Compare'], []],
  ['/research/performance', 'research', 'Res-Perf', 'Res-Perf-Phone', ['Content performance', 'Performance'], []],
  ['/research/inbox', 'research', 'Res-Inbox', 'Res-Inbox-Phone', ['Comment inbox', 'Inbox'], []],
  ['/research/backlog', 'research', 'Res-Backlog', 'Res-Backlog-Phone', ['Topic backlog', 'Backlog'], []],
  ['/script', 'script', 'Script-Library', 'Script-Library-Phone', ['All scripts', 'Scripts', 'Library', '2026-Q3-campaign'], []],
  ['/script/brief', 'script', 'Script-Brief', 'Script-Brief-Phone', ['Brief', 'Brief intake'], []],
  ['/script/draft', 'script', 'Script-Editor', 'Script-Editor-Phone', ['Draft', 'Split editor', 'Sham Shui Po dai pai dong revival', 'Sham Shui Po dai pai dong'], []],
  ['/script/versions', 'script', 'Script-Versions', 'Script-Versions-Phone', ['Versions', 'Version history'], []],
  ['/script/approval', 'script', 'Script-Lock', 'Script-Lock-Phone', ['Approval', 'Approve & lock'], []],
  ['/script/locked', 'script', 'Script-Locked', 'Script-Locked-Phone', ['History of Greece · Ep 75'], []],
  /* every other script has its own page (phones see the laptop screen, so the phone file is a placeholder) */
  ...[['taipei-night-market', 'Taipei night-market crossover creators'], ['cantonese-voice-cloning', 'Cantonese voice cloning backlash'], ['good-day', 'Good day · collage teaser'],
    ['harbourfront', 'Harbourfront redevelopment hearing'], ['porsche-cat', 'Porsche cat · night drive'], ['cha-chaan-teng', 'Cha chaan teng menu inflation'],
    ['singapore-hawker', 'Singapore hawker succession'], ['do-more', 'Do more · brand spot'], ['orange-typography', 'Orange typography cut']]
    .map(([slug, t]) => [`/script/${slug}`, 'script', `Script-Doc-${slug}`, 'Script-Locked-Phone', [t], []]),
  ['/video', 'video', 'Video-Library', 'Video-Library-Phone', ['All projects', 'Projects', 'Video Edit'], ['Open project 003']],
  ['/video/shots', 'video', 'Video-Project', 'Video-Project-Phone', ['Shots', 'History of Greece · Ep 75', 'Open History of Greece'], []],
  ['/video/media', 'video', 'Video-Bin', 'Video-Bin-Phone', ['Media', 'Media bin'], []],
  ['/video/renders', 'video', 'Video-Queue', 'Video-Queue-Phone', ['Renders', 'Render queue'], []],
  ['/video/preview', 'video', 'Video-Preview', 'Video-Preview-Phone', ['Preview'], []],
  ['/video/audio', 'video', 'Video-Audio', 'Video-Audio-Phone', ['Audio', 'Audio panel'], []],
  ['/video/export', 'video', 'Video-Export', 'Video-Export-Phone', ['Export'], []],
  ['/publish', 'publish', 'Pub-Channels', 'Pub-Channels-Phone', ['Channel board', 'Board'], []],
  ['/publish/caption', 'publish', 'Pub-Composer', 'Pub-Composer-Phone', ['Caption', 'New post from a video'], ['Edit caption', '✎ Edit caption', 'Open Caption', 'Open the caption']],
  ['/publish/approvals', 'publish', 'Pub-Approvals', 'Pub-Approvals-Phone', ['Approval queue', 'Approvals', 'Open the approval'], []],
  ['/publish/log', 'publish', 'Pub-Log', 'Pub-Log-Phone', ['Publish log', 'Log'], []],
  ['/accounting', 'accounting', 'Acc-Inbox', 'Acc-Inbox-Phone', ['Document inbox', 'Inbox'], []],
  ['/accounting/drafts', 'accounting', 'Acc-Drafts', 'Acc-Drafts-Phone', ['Draft entries', 'Drafts'], []],
  ['/accounting/summary', 'accounting', 'Acc-Period', 'Acc-Period-Phone', ['Period summary', 'Summary'], []],
  ['/accounting/export', 'accounting', 'Acc-Export', 'Acc-Export-Phone', ['Export'], []],
  ['/finance', 'finance', 'Fin-Budget', 'Fin-Budget-Phone', ['Budget'], []],
  ['/finance/cash', 'finance', 'Fin-Cash', 'Fin-Cash-Phone', ['Cash-flow projection', 'Cash'], []],
  ['/finance/costs', 'finance', 'Fin-Cost', 'Fin-Cost-Phone', ['Cost dashboard', 'Costs'], []],
  ['/finance/spend', 'finance', 'Fin-Spend', 'Fin-Spend-Phone', ['Spend requests', 'Spend'], []],
  ['/finance/reports', 'finance', 'Fin-Reports', 'Fin-Reports-Phone', ['Report drafts', 'Reports'], []],
  ['/legal', 'legal', 'Legal-Draft', 'Legal-Draft-Phone', ['Document drafting', 'Drafting'], []],
  ['/legal/clause-review', 'legal', 'Legal-Clause', 'Legal-Clause-Phone', ['Clause review'], []],
  ['/legal/contracts', 'legal', 'Legal-Repo', 'Legal-Repo-Phone', ['Contract repository', 'Contracts'], []],
  ['/legal/compliance', 'legal', 'Legal-Compliance', 'Legal-Compliance-Phone', ['Compliance checklists', 'Compliance'], []],
  ['/hr', 'hr', 'Hr-Gate', 'Hr-Gate-Phone', ['Overview'], []],
  ['/hr/leave', 'hr', 'Hr-Leave', 'Hr-Leave-Phone', ['Leave'], []],
  ['/hr/recruitment', 'hr', 'Hr-Recruit', 'Hr-Recruit-Phone', ['Recruitment', 'Hiring'], []],
  ['/hr/candidates', 'hr', 'Hr-Candidates', 'Hr-Candidates-Phone', ['Candidate records', 'Candidates'], []],
  ['/hr/employees', 'hr', 'Hr-Employees', 'Hr-Employees-Phone', ['Employee records', 'People'], []],
  ['/admin', 'admin', 'Adm-People', 'Adm-People-Phone', ['People'], []],
  /* a person's name anywhere in Admin opens what they can access */
  ['/admin/access', 'admin', 'Adm-Ent', 'Adm-Ent-Phone', ['Entitlements matrix', 'Access', 'Michelle Yip', 'Chan Ka-ming', 'Amy Wong', 'Leung Chi-hang', 'Vincent Chow', 'Priscilla Cheung'], []],
  ['/admin/tokens', 'admin', 'Adm-Tokens', 'Adm-Tokens-Phone', ['Token dashboard', 'Tokens'], []],
  ['/admin/budgets', 'admin', 'Adm-Budgets', 'Adm-Budgets-Phone', ['Budgets'], []],
  ['/admin/keys', 'admin', 'Adm-Channels', 'Adm-Channels-Phone', ['Channels & credentials', 'Channels &amp; credentials', 'Keys'], []],
  ['/admin/audit', 'admin', 'Adm-Audit', 'Adm-Audit-Phone', ['Audit log', 'Audit'], []],
  ['/admin/knowledge', 'admin', 'Adm-Know', 'Adm-Know-Phone', ['Knowledge & skills', 'Knowledge &amp; skills', 'Knowledge'], []],
];

/* ---------- read one .dc.html ---------- */
function readScreen(name) {
  const src = fs.readFileSync(path.join(DIR, name + '.dc.html'), 'utf8');
  const helmet = src.slice(src.indexOf('<helmet>') + 8, src.indexOf('</helmet>'));
  const html = src.slice(src.indexOf('</helmet>') + 9, src.lastIndexOf('</x-dc>')).trim();
  const tag = src.match(/<script data-dc-script data-props='([^']*)'>/);
  const props = {};
  let w = 1440, h = 900;
  if (tag) {
    const spec = JSON.parse(tag[1]);
    for (const [k, v] of Object.entries(spec)) {
      if (k === '$preview') { w = v.width || w; h = v.height || h; continue; }
      if (v && 'default' in v) props[k] = v.default;
    }
  }
  const js = tag ? src.slice(src.indexOf(tag[0]) + tag[0].length, src.lastIndexOf('</script>')).trim() : 'class Component extends DCLogic { renderVals() { return {}; } }';
  const links = [...helmet.matchAll(/<link[^>]*>/g)].map(m => m[0]);
  const style = (helmet.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  return { html, props, w, h, js, links, style };
}

/* ---------- write pages ---------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const img of fs.readdirSync(DIR).filter(f => /\.(jpg|png)$/.test(f))) fs.copyFileSync(path.join(DIR, img), path.join(OUT, img));
/* the canvas keeps small images; the site gets full-resolution ones so big previews stay sharp */
const HI = path.join(DIR, 'hires');
if (fs.existsSync(HI)) for (const img of fs.readdirSync(HI)) fs.copyFileSync(path.join(HI, img), path.join(OUT, img));
fs.copyFileSync(path.join(DIR, 'site-runtime.js'), path.join(OUT, 'runtime.js'));
/* Traditional Chinese (HK): every i18n/*.json merged into one dictionary the runtime reads */
const ZH = {};
for (const f of fs.readdirSync(path.join(DIR, 'i18n')).filter(f => f.endsWith('.json')).sort()) Object.assign(ZH, JSON.parse(fs.readFileSync(path.join(DIR, 'i18n', f), 'utf8')));
fs.writeFileSync(path.join(OUT, 'zh.js'), 'window.__ZH = ' + JSON.stringify(ZH) + ';\n');

const ROUTES = R.map(([p, module, , , labels, global]) => ({ path: p, module, labels, global }));
const safe = s => s.replace(/<\/script/gi, '<\\/script');
for (const [p, module, desk, phone, labels] of R) {
  const d = readScreen(desk), m = readScreen(phone);
  const links = [...new Set([...d.links, ...m.links])].join('\n');
  const title = (module === 'login' ? 'Sign in' : (labels[0] || module)).replace('&amp;', '&');
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<base href="/app/">
<title>${title} · Aura Farmers</title>
${links}
<style id="css-desktop" media="not all">${d.style}</style>
<style id="css-phone" media="not all">${m.style}</style>
<style>html, body { margin: 0; height: 100%; background: #ffffff; overflow: hidden; } body { display: flex; align-items: center; justify-content: center; } #stage { position: relative; flex-shrink: 0; overflow: hidden; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.04); }</style>
</head>
<body>
<div id="stage"><div id="dc-root"></div></div>
<script>
window.__ROUTES = ${JSON.stringify(ROUTES)};
window.__PAGE = ${safe(JSON.stringify({ path: p, module, title, desktop: { html: d.html, props: d.props, w: d.w, h: d.h }, phone: { html: m.html, props: m.props, w: m.w, h: m.h } }))};
window.__F = {
  desktop: function () {
${safe(d.js)}
return Component; },
  phone: function () {
${safe(m.js)}
return Component; }
};
</script>
<script src="/app/zh.js"></script>
<script src="/app/runtime.js"></script>
</body>
</html>
`;
  const file = path.join(OUT, p.slice(1) + '.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, page);
}
console.log(`wrote ${R.length} pages to public/app`);
