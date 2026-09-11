/**
 * One-off copy pass: remove em dashes from everything a viewer can see.
 *   1. exact rewrites where a comma would read badly
 *   2. chart legend dashes → a drawn line sample
 *   3. empty table cells "—" → "–"
 *   4. canvas labels (build-screens.mjs) " — " → " · "
 *   5. everything else " — " → ", "
 * Reports anything left over. Run: node dash-sweep.mjs
 */
import fs from 'fs';
import path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const FILES = ['Desktop.dc.html', 'ChatPhone.dc.html', 'build-screens.mjs', 'script-screens.mjs', 'video-screens.mjs', 'research-screens.mjs', 'chat-screens.mjs',
  'admin-screens.mjs', 'finance-screens.mjs', 'legal-screens.mjs', 'hr-screens.mjs', 'publish-screens.mjs', 'shell.mjs'];

const EXACT = [
  ['Retry is safe — no partial post', 'Retry is safe: no partial post'],
  ['Drafts only — nothing posts', 'Drafts only. Nothing posts'],
  ['Draft journal lines — a human', 'Draft journal lines. A human'],
  ['Production — equipment', 'Production · equipment'],
  ['Production — contractors', 'Production · contractors'],
  ['Platform audit renewals — YouTube', 'Platform audit renewals: YouTube'],
  ['Top-level screen — this is', 'Top-level screen. This is'],
  ['Vertex AI — the client', 'Vertex AI: the client'],
  ['not a platform fault — the account holder', 'not a platform fault. The account holder'],
  ['plain rollback — this area', 'plain rollback. This area'],
  ['all three attempts — the client', 'all three attempts: the client'],
  ['Personal data — a dedicated', 'Personal data, so a dedicated'],
  ['HR — no access', 'HR · no access'],
  ['Cutaway — the renewal', 'Cutaway: the renewal'],
  ['§3.2 — name the hour', '§3.2: name the hour'],
  ['” — the archive shot', '”. The archive shot'],
  ['Street, 1998 — archive plate', 'Street, 1998 · archive plate'],
  ['unchanged beats — 01', 'unchanged beats: 01'],
  ['sound direction — neither changes', 'sound direction. Neither changes'],
  ['read-only — any later change', 'read-only. Any later change'],
  ['the one to read — it quotes', 'the one to read: it quotes'],
  ['Battle plan — fire spreads', 'Battle plan: fire spreads'],
  ['Rough cut v2 is up — beats', 'Rough cut v2 is up. Beats'],
  ['ep75 are done — zh-HK', 'ep75 are done: zh-HK'],
  ['#announcements — react or reply', '#announcements. React or reply'],
  ['files withheld — no access', 'files withheld · no access'],
  ['Sensitive — carries', 'Sensitive: carries'],
  ['Operator interview — Mrs Ho', 'Operator interview: Mrs Ho'],
];

let total = 0;
for (const f of FILES) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) continue;
  let s = fs.readFileSync(p, 'utf8');
  const before = (s.match(/—/g) || []).length;
  for (const [a, b] of EXACT) s = s.split(a).join(b);
  // legend samples: <b style="color:X">—</b> or ―
  s = s.replace(/<b style="color: ?([^";]+);?">[—―]<\/b>/g, '<b style="display: inline-block; width: 12px; height: 2px; border-radius: 1px; background: $1; vertical-align: 3px; margin-right: 2px;"></b>');
  // empty cells
  s = s.replace(/>—</g, '>–<').replace(/'—'/g, "'–'");
  // canvas labels
  if (f === 'build-screens.mjs') s = s.split(' — ').join(' · ');
  // everything else
  s = s.split(' — ').join(', ');
  const left = (s.match(/.{0,40}—.{0,30}/g) || []);
  const after = left.length;
  total += before - after;
  fs.writeFileSync(p, s);
  console.log(`${f}: ${before} → ${after}`);
  left.forEach(l => console.log('   left:', l.trim()));
}
console.log('removed', total);
