/**
 * The three hand-made phone screens (Database, Your agent, Trends) get the
 * same module dock + launcher as every generated phone. Safe to run twice.
 * Run: node patch-docks.mjs   (after editing phone-shell.mjs)
 */
import fs from 'fs';
import path from 'path';
import { PCSS, dock, launcher, dockLogic } from './phone-shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CSS = PCSS.slice(PCSS.indexOf('/* module dock'));
const EXTRA = { '.ico {': PCSS.match(/\.ico \{[^}]*\}\s*\.ico svg \{[^}]*\}/)[0], '.chip {': PCSS.match(/\.chip \{[^}]*\}\s*\.chip\.on \{[^}]*\}/)[0], '.cap {': PCSS.match(/\.cap \{[^}]*\}/)[0] };
const JOBS = [['FilesPhone.dc.html', 'files', 'Renders'], ['ChatPhone.dc.html', 'chat', 'Your agent'], ['TrendsPhone.dc.html', 'res', 'Trends']];

/* the <div> that opens at `start`, through its matching </div> */
function divEnd(src, start) {
  const re = /<div\b|<\/div>/g; re.lastIndex = start; let depth = 0, m;
  while ((m = re.exec(src))) { depth += m[0] === '</div>' ? -1 : 1; if (depth === 0) return m.index + 6; }
  throw new Error('unbalanced div');
}

for (const [file, mod, title] of JOBS) {
  const p = path.join(DIR, file);
  let src = fs.readFileSync(p, 'utf8');
  const had = src.includes('<!-- module-dock -->');
  /* 1 · the old tab pill becomes the dock */
  if (!had) {
    const firstTab = src.indexOf('class="tab');
    const start = src.lastIndexOf('<div style="flex: 1 1 0;', firstTab);
    if (firstTab < 0 || start < 0) throw new Error(file + ': tab pill not found');
    src = src.slice(0, start) + '<!-- module-dock -->' + dock(mod) + '<!-- /module-dock -->' + src.slice(divEnd(src, start));
  } else {
    src = src.replace(/<!-- module-dock -->[\s\S]*?<!-- \/module-dock -->/, '<!-- module-dock -->' + dock(mod) + '<!-- /module-dock -->');
  }
  /* 1b · the dark agent button next to the dock goes: the ask bar already opens the agent */
  const after = src.indexOf('<!-- /module-dock -->') + '<!-- /module-dock -->'.length;
  const fab = src.slice(after).match(/^\s*<div style="width: 50px; height: 50px; border-radius: 25px; background: #171717;/);
  if (fab) { const s0 = after + fab[0].indexOf('<div'); src = src.slice(0, after) + src.slice(divEnd(src, s0)); }
  /* 1c · the chat screen has its own composer, so the shell's ask bar would be a second one */
  if (mod === 'chat') {
    const ask = src.indexOf('<div style="height: 54px; border-radius: 27px; background: #f3f3f3;');
    if (ask > -1) src = src.slice(0, ask) + src.slice(divEnd(src, ask));
  }
  /* 2 · the launcher, just inside the root, before </x-dc> */
  src = src.replace(/<!-- launcher -->[\s\S]*?<!-- \/launcher -->\n?/, '');
  const xdc = src.indexOf('</x-dc>'), rootClose = src.lastIndexOf('</div>', xdc);
  src = src.slice(0, rootClose) + '<!-- launcher -->' + launcher(mod, title) + '<!-- /launcher -->\n' + src.slice(rootClose);
  /* 3 · styles */
  src = src.replace(/\/\* module dock[\s\S]*?\/\* \/module dock \*\//, '');
  let add = CSS + '\n    /* /module dock */';
  for (const [probe, rule] of Object.entries(EXTRA)) if (!src.slice(0, src.indexOf('</style>')).includes(probe)) add = rule + '\n    ' + add;
  src = src.replace('</style>', '    ' + add + '\n  </style>');
  /* 4 · popup + pressed-dock state in the screen's own logic (replaced on every run) */
  src = src.replace(" navOpen: (this.state || {}).nav === 'open', openNav: () => this.setState({ nav: 'open' }), closeNav: () => this.setState({ nav: 'closed' }), ", '');
  src = src.replace(/ \/\*nav\*\/[\s\S]*?\/\*\/nav\*\//, '');
  const NAV = ` /*nav*/ ${dockLogic(mod)} navOpen: (this.state || {}).nav === 'open', navClosed: (this.state || {}).nav !== 'open', toggleNav: () => this.setState({ nav: (this.state || {}).nav === 'open' ? 'closed' : 'open' }), openNav: () => this.setState({ nav: 'open' }), closeNav: () => this.setState({ nav: 'closed' }), /*/nav*/`;
  const i = src.indexOf('return {', src.indexOf('renderVals()'));
  if (i < 0) throw new Error(file + ': renderVals return not found');
  src = src.slice(0, i + 8) + NAV + src.slice(i + 8);
  fs.writeFileSync(p, src);
  console.log((had ? 'refreshed ' : 'patched ') + file);
}
