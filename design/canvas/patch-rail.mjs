/**
 * FilesDesktop.dc.html is hand-made and kept its first rail (outline icons,
 * one briefcase for the business side). This swaps in the shared rail from
 * shell.mjs, so Files shows the same 11 icons as every other screen, and
 * adds the rail styles it needs. Safe to run again.
 * Run: node patch-rail.mjs
 */
import fs from 'fs';
import path from 'path';
import { rail } from './shell.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const file = path.join(DIR, 'FilesDesktop.dc.html');
let html = fs.readFileSync(file, 'utf8');

const RAIL = /  <!-- rail -->\n  <div style="width: 52px;[\s\S]*?<img class="av"[^>]*>\n  <\/div>/;
if (!RAIL.test(html)) throw new Error('rail block not found in FilesDesktop.dc.html');
html = html.replace(RAIL, '  <!-- rail -->' + rail('chan', 'files'));

html = html.replace(/\.r svg \{ width: 17px; height: 17px; \}/, '.r svg { width: 17px; height: 17px; fill: currentColor; }');
if (!html.includes('.r.on {')) html = html.replace(/(\.r svg\.fl \{[^}]*\})/, '$1\n    .r.on { background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.1); color: #171717; }\n    .r.no { opacity: .32; }');

fs.writeFileSync(file, html);
console.log('FilesDesktop rail:', (html.match(/class="r[ "]/g) || []).length, 'icons');
