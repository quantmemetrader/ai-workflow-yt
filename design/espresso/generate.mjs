import fs from 'fs';
const d = JSON.parse(fs.readFileSync('package/tailwind/colors.json','utf8'));
const res = r => { const [m,c,s] = r.split('/'); return m==='neutral' ? d.neutral[c] : d[m][c][s]; };
const cats = ['surface','outline','ink'];

const vars = mode => cats.flatMap(cat => {
  const o = d.themedVariables[mode][cat];
  return Object.keys(o).map(k => `  --${cat}-${k}: ${res(o[k])};`);
}).join('\n');

const inline = cats.flatMap(cat => {
  const o = d.themedVariables.light[cat];
  return Object.keys(o).map(k => `  --color-${cat}-${k}: var(--${cat}-${k});`);
}).join('\n');

const ramp = [
  ['2xs','11px','1.15','0.01em','420'], ['xs','12px','1.15','0.02em','420'],
  ['sm','13px','1.15','0.02em','420'],  ['base','14px','1.15','0.02em','420'],
  ['lg','16px','1.15','0.02em','400'],  ['xl','18px','1.15','0.01em','400'],
  ['2xl','20px','1.15','0.01em','400'], ['3xl','24px','1.15','0.005em','400'],
];
const para = [
  ['2xs','11px','1.6','0.01em','420'], ['xs','12px','1.6','0.02em','420'],
  ['sm','13px','1.5','0.02em','420'],  ['base','14px','1.5','0.02em','420'],
  ['lg','16px','1.5','0.02em','400'],  ['xl','18px','1.42','0.01em','400'],
  ['2xl','20px','1.38','0.01em','400'],['3xl','24px','1.2','0.005em','400'],
];
const emit = (pfx, rows) => rows.map(([n,sz,lh,ls,fw]) =>
`  --text-${pfx}${n}: ${sz};\n  --text-${pfx}${n}--line-height: ${lh};\n  --text-${pfx}${n}--letter-spacing: ${ls};\n  --text-${pfx}${n}--font-weight: ${fw};`).join('\n');

fs.writeFileSync('espresso.css', `/* Espresso design tokens — Frappe UI.
 *
 * GENERATED from frappe-ui@${JSON.parse(fs.readFileSync('package/package.json','utf8')).version}
 * (tailwind/colors.json + tailwind/plugin.js). Do not hand-edit: regenerate
 * with design/espresso/generate.mjs when bumping the source version.
 *
 * Frappe UI itself is Vue 3 and cannot be imported here — this project is
 * React. These are the design language's tokens, reimplemented for Tailwind v4.
 *
 * Semantic model: three categories, used strictly.
 *   surface-*  backgrounds and fills
 *   outline-*  borders, dividers, rings
 *   ink-*      text and icons
 */

:root {
${vars('light')}
}

[data-theme="dark"] {
${vars('dark')}
}

@theme inline {
${inline}

  /* Type — tight ramp, for UI labels and controls */
${emit('', ramp)}

  /* Type — paragraph ramp, for prose. Use as text-p-sm, text-p-base, … */
${emit('p-', para)}

  /* Radius */
  --radius-sm: 0.25rem;
  --radius-DEFAULT: 0.5rem;
  --radius-md: 0.625rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-2xl: 1.25rem;

  /* Elevation — every step opens with a hairline, then a soft drop */
  --shadow-sm: 0px 1px 2px rgba(0, 0, 0, 0.1);
  --shadow-DEFAULT: 0px 0px 1px rgba(0, 0, 0, 0.45), 0px 1px 2px rgba(0, 0, 0, 0.1);
  --shadow-md: 0px 0px 1px rgba(0, 0, 0, 0.12), 0px 0.5px 2px rgba(0, 0, 0, 0.15), 0px 2px 3px rgba(0, 0, 0, 0.16);
  --shadow-lg: 0px 0px 1px rgba(0, 0, 0, 0.35), 0px 6px 8px -4px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0px 0px 1px rgba(0, 0, 0, 0.19), 0px 1px 2px rgba(0, 0, 0, 0.07), 0px 6px 15px -5px rgba(0, 0, 0, 0.11);
  --shadow-2xl: 0px 0px 1px rgba(0, 0, 0, 0.2), 0px 1px 3px rgba(0, 0, 0, 0.05), 0px 10px 24px -3px rgba(0, 0, 0, 0.1);
}
`);
console.log('espresso.css written —', fs.readFileSync('espresso.css','utf8').split('\n').length, 'lines');
