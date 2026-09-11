/**
 * Market Research, hand-authored screens with real TradingView
 * Lightweight Charts (v4.2.0, loaded from jsdelivr in componentDidMount;
 * inline <script> tags are stripped by the canvas runtime).
 *
 * §4.3 chart rules honoured: time series as lines/areas, channel
 * comparison as horizontal bars, one accent colour plus neutrals, no chart
 * junk, and every chart states its date range and source.
 *
 * Run:  node research-screens.mjs
 */
import fs from 'fs';
import path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.join(DIR, 'Desktop.dc.html'), 'utf8');
const css = src.slice(src.indexOf('<style>') + 7, src.indexOf('</style>'));

const EXTRA_CSS = `
    .wl { display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 12px; border-bottom: 1px solid #f3f3f3; }
    .wl.on { background: #f5faff; box-shadow: inset 2px 0 0 var(--ac); }
    .wl .rk { width: 16px; font-size: 10.5px; color: #c7c7c7; font-variant-numeric: tabular-nums; flex-shrink: 0; }
    .wl .nm { flex-grow: 1; min-width: 0; font-size: 12.5px; color: #171717; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wl .ht { width: 26px; text-align: right; font-size: 12.5px; font-weight: 500; font-variant-numeric: tabular-nums; flex-shrink: 0; }
    .wl .ch { width: 54px; text-align: right; font-size: 11.5px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
    .up { color: #278f5e; } .dn { color: #e03636; }
    .tf { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3f3f3; }
    .tf div { height: 24px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; font-size: 11.5px; color: #7c7c7c; font-weight: 500; }
    .tf div.on { background: #fff; color: #171717; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
    .rtab { height: 26px; padding: 0 11px; border-radius: 7px; display: flex; align-items: center; font-size: 12px; color: #7c7c7c; }
    .rtab.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500; }
    .cap { font-size: 11px; color: #999999; }
    .lwbox { position: relative; }
    .lwload { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #c7c7c7; }
    .src { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f3f3f3; }
    .src:last-child { border-bottom: none; }
    .src b { font-size: 10.5px; font-weight: 500; color: #999999; width: 52px; flex-shrink: 0; padding-top: 1px; }
    .src span { font-size: 12.5px; line-height: 1.45; color: #383838; }
    .sw { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }`;

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
  `    <div class="r${k === 'res' ? ' on' : ''}${k === 'hr' ? ' no' : ''}"><svg viewBox="0 0 24 24">${icon}</svg></div>\n` +
  (k === 'pub' ? '    <div style="width: 22px; height: 1px; background: #e2e2e2; margin: 6px 0;"></div>\n' : '')).join('');

const SUBS = [['trends', 'Trends dashboard'], ['compare', 'Search & compare'], ['perf', 'Content performance'], ['inbox', 'Comment inbox'], ['backlog', 'Topic backlog']];
const sidebar = cur => `
  <div style="width: 212px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; padding: 10px 8px;">
    <div style="padding: 4px 9px 12px; font-size: 14px; font-weight: 500;">Market Research</div>
    <div class="lbl" style="margin-bottom: 5px;">Screens</div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
${SUBS.map(([k, l]) => `      <div class="n${k === cur ? ' on' : ''}"><span>${l.replace('&', '&amp;')}</span>${k === 'inbox' ? '<i>27</i>' : k === 'backlog' ? '<b>9</b>' : ''}</div>`).join('\n')}
    </div>
    <div class="lbl" style="margin: 18px 0 5px;">Connected sources</div>
    <div style="display: flex; flex-direction: column; gap: 1px;">
      <div class="n"><span>GDELT</span><span style="margin-left: auto; width: 6px; height: 6px; border-radius: 3px; background: #278f5e;"></span></div>
      <div class="n"><span>YouTube mostPopular</span><span style="margin-left: auto; width: 6px; height: 6px; border-radius: 3px; background: #278f5e;"></span></div>
      <div class="n"><span>Google Trends</span><span style="margin-left: auto; width: 6px; height: 6px; border-radius: 3px; background: #278f5e;"></span></div>
      <div class="n" style="color: #999999;"><span>Instagram Graph</span><span style="margin-left: auto; width: 6px; height: 6px; border-radius: 3px; background: #db7706;"></span></div>
    </div>
    <div style="margin-top: auto; padding: 11px 9px 4px; border-top: 1px solid #ededed;">
      <div class="lbl" style="padding: 0; margin-bottom: 5px;">Ranking weights</div>
      <div class="mut" style="line-height: 1.5;">Adopt and reject feed back into ranking. 34 decisions this month.</div>
    </div>
  </div>`;

const topbar = (title, hint) => `
    <div class="bar">
      <span class="h1">${title}</span>
      <span class="mut">${hint}</span>
      <div style="flex-grow: 1;"></div>
      <div style="width: 240px; height: 28px; border: 1px solid #ededed; border-radius: 8px; background: #f8f8f8; display: flex; align-items: center; gap: 7px; padding: 0 9px;">
        <svg viewBox="0 0 24 24" style="width: 13px; height: 13px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round;"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg>
        <span style="font-size: 12px; color: #999999;">Search topics, sources</span>
      </div>
      <div style="position: relative; display: flex;">
        <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; stroke: #525252; fill: none; stroke-width: 1.7; stroke-linecap: round;"><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9z"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/></svg>
        <div style="position: absolute; top: 0; right: 0; width: 5px; height: 5px; border-radius: 3px; background: #e03636;"></div>
      </div>
    </div>`;

const chev = '<svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>';
const spark = (pts, up) => `<svg viewBox="0 0 48 18" style="width: 48px; height: 18px; flex-shrink: 0; fill: none; stroke: ${up ? '{{accent}}' : '#c7c7c7'}; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;"><path d="${pts}"/></svg>`;

const WATCH = [
  ['Sham Shui Po dai pai dong revival', 94, '+38.2%', 1, 'M1 16 7 15l6 1 6-4 6 1 6-6 6 2 6-6 4-2'],
  ['Taipei night-market crossover creators', 88, '+21.4%', 1, 'M1 13 7 14l6-2 6 3 6-5 6 3 6-7 6 3 4-5'],
  ['Harbourfront redevelopment hearing', 81, '+12.9%', 1, 'M1 15 7 13l6 1 6-4 6 2 6-5 6 1 6-4 4 1', 'amber'],
  ['Cantonese voice cloning backlash', 76, '+9.8%', 1, 'M1 16 7 16l6-2 6 1 6-3 6 1 6-5 6 1 4-3'],
  ['Singapore hawker succession', 71, '+3.1%', 1, 'M1 10 7 11l6 1 6-2 6 3 6-1 6-4 6 2 4-2'],
  ['Cha chaan teng menu inflation', 64, '−6.7%', 0, 'M1 5 7 7l6-1 6 3 6-2 6 4 6-2 6 3 4 1'],
  ['MTR after-hours maintenance crews', 58, '−2.2%', 0, 'M1 9 7 8l6 2 6-1 6 2 6-1 6 2 6-1 4 1'],
  ['Tai O stilt houses restoration', 52, '+1.4%', 1, 'M1 12 7 12l6-1 6 1 6-1 6 0 6-2 6 1 4-1'],
];

const watchlist = sel => WATCH.map(([nm, ht, ch, up, pts, flag], i) => `
          <div class="wl${i === sel ? ' on' : ''}">
            <span class="rk">${String(i + 1).padStart(2, '0')}</span>
            <span class="nm">${nm}${flag ? ' <span style="display:inline-block;width:6px;height:6px;border-radius:3px;background:#db7706;vertical-align:1px;margin-left:3px"></span>' : ''}</span>
            ${spark(pts, up)}
            <span class="ht">${ht}</span>
            <span class="ch ${up ? 'up' : 'dn'}">${ch}</span>
          </div>`).join('');

const rightPanel = (mode, agentBody) => `
      <div style="width: 312px; flex-shrink: 0; border-left: 1px solid #ededed; background: #fcfcfc; display: flex; flex-direction: column;">
        <div style="height: 42px; flex-shrink: 0; display: flex; align-items: center; gap: 2px; padding: 0 10px; border-bottom: 1px solid #ededed;">
          <div class="rtab${mode === 'watch' ? ' on' : ''}">Watchlist</div>
          <div class="rtab${mode === 'agent' ? ' on' : ''}" style="gap: 6px;"><svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: {{accent}}; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 4.2 19 8v8l-7 3.8L5 16V8z"/><path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8"/></svg>Agent</div>
          <div style="flex-grow: 1;"></div>
          <span class="cap">HK/TW/SG</span>
        </div>
${mode === 'watch' ? `
        <div style="flex-shrink: 0; display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 12px; border-bottom: 1px solid #ededed; background: #f8f8f8;">
          <span class="lbl" style="padding: 0; width: 16px;">#</span><span class="lbl" style="padding: 0; flex-grow: 1;">Topic</span>
          <span class="lbl" style="padding: 0; width: 48px;">14 d</span><span class="lbl" style="padding: 0; width: 26px; text-align: right;">Heat</span><span class="lbl" style="padding: 0; width: 54px; text-align: right;">Change</span>
        </div>
        <div style="flex-grow: 1; min-height: 0; overflow: hidden;">${watchlist(0)}
        </div>
        <div style="flex-shrink: 0; padding: 10px 12px; border-top: 1px solid #ededed; display: flex; align-items: center; gap: 7px;">
          <span style="width: 6px; height: 6px; border-radius: 3px; background: #db7706;"></span>
          <span class="cap">Sensitive: carries a flag and a reason</span>
        </div>` : agentBody}
      </div>`;

const agentBlock = (scope, q, tool, a, act, guard, cost) => `
        <div style="flex-shrink: 0; padding: 11px 13px; border-bottom: 1px solid #f3f3f3;">
          <div style="display: inline-flex; align-items: center; gap: 7px; height: 25px; padding: 0 10px; border-radius: 7px; background: #fff; border: 1px solid #ededed;">
            <span style="width: 6px; height: 6px; border-radius: 3px; background: {{accent}};"></span><span style="font-size: 11.5px; color: #525252;">${scope}</span>
          </div>
        </div>
        <div style="flex-grow: 1; min-height: 0; padding: 14px 13px 0; overflow: hidden;">
          <div style="display: flex; justify-content: flex-end; margin-bottom: 10px;"><div style="max-width: 240px; background: #f3f3f3; border-radius: 10px; padding: 8px 11px; font-size: 12px; line-height: 1.5; color: #383838;">${q}</div></div>
          <div style="display: inline-flex; align-items: center; gap: 7px; height: 23px; padding: 0 9px; border: 1px solid #ededed; border-radius: 7px; background: #fff; margin-bottom: 9px;">
            <svg viewBox="0 0 24 24" style="width: 11px; height: 11px; stroke: #278f5e; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round;"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg><span style="font-size: 11px; color: #525252;">${tool}</span>
          </div>
          <p style="font-size: 12px; line-height: 1.6; color: #383838; text-wrap: pretty;">${a}</p>
          <div style="display: flex; gap: 6px; margin-top: 11px;"><div class="btn p" style="height: 27px; font-size: 12px;">${act}</div><div class="btn s" style="height: 27px; font-size: 12px;">Not now</div></div>
        </div>
        <div style="flex-shrink: 0; padding: 11px 13px 9px;">
          <div style="border: 1px solid #e2e2e2; border-radius: 10px; background: #fff; padding: 9px 10px 7px;">
            <div style="font-size: 12px; color: #999999;">Ask about these trends…</div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 11px;"><span style="font-size: 10.5px; color: #999999;">gemini-2.5-pro</span><div style="width: 25px; height: 25px; border-radius: 7px; background: {{accent}}; display: flex; align-items: center; justify-content: center;"><svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: #fff; fill: none; stroke-width: 2.3; stroke-linecap: round; stroke-linejoin: round;"><path d="M12 19V5.5M6 11.5 12 5.5l6 6"/></svg></div></div>
          </div>
        </div>
        <div style="flex-shrink: 0; border-top: 1px solid #f3f3f3; padding: 9px 13px 11px; display: flex; align-items: center; gap: 7px;">
          <span style="font-size: 10.5px; color: #999999;">${guard}</span><span style="margin-left: auto; font-size: 10.5px; color: #999999;">${cost}</span>
        </div>`;

/* ---------- chart runtime, emitted into each artboard's logic class ---------- */
const RUNTIME = `
  componentDidMount() {
    var self = this;
    var go = function () { try { self.draw(); } catch (e) { var el = document.querySelector('.lwload'); if (el) el.textContent = 'chart error: ' + e.message; } };
    if (window.LightweightCharts) return go();
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
    s.onload = go;
    s.onerror = function () { var el = document.querySelector('.lwload'); if (el) el.textContent = 'chart library blocked'; };
    document.head.appendChild(s);
  }
  accent() { var raw = this.props.accent || '#007BE0'; return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#007BE0'; }
  base(el, h) {
    return LightweightCharts.createChart(el, {
      width: el.clientWidth, height: h,
      layout: { background: { type: 'solid', color: '#ffffff' }, textColor: '#999999', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
      grid: { vertLines: { color: '#f5f5f5' }, horzLines: { color: '#f3f3f3' } },
      rightPriceScale: { borderColor: '#ededed' },
      timeScale: { borderColor: '#ededed', rightOffset: 2, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 0, vertLine: { color: '#c7c7c7', width: 1, style: 2, labelBackgroundColor: '#171717' }, horzLine: { color: '#c7c7c7', width: 1, style: 2, labelBackgroundColor: '#171717' } },
      handleScroll: false, handleScale: false
    });
  }
  gen(seed, n, base, lift, liftAt, noise) {
    var s = seed, rnd = function () { s = (s * 16807) % 2147483647; return s / 2147483647; };
    var out = [], v = base, t0 = Date.UTC(2026, 5, 12);
    for (var i = 0; i < n; i++) {
      v = Math.max(4, v + (rnd() - 0.48) * noise);
      var bump = i >= liftAt ? lift * (1 - Math.exp(-(i - liftAt) / 5)) : 0;
      var d = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
      out.push({ time: d, value: Math.round(v + bump) });
    }
    return out;
  }
  done(el) { var l = el.parentNode.querySelector('.lwload'); if (l) l.remove(); }
  renderVals() { return { accent: this.accent() }; }`;

function page({ file, cur, title, hint, body, rightMode, agent, draw }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<!-- hand-authored: Market Research · ${title}. Rebuild with research-screens.mjs -->
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600&display=swap">
  <style>${css}${EXTRA_CSS}</style>
</helmet>

<div style="--ac: {{accent}}; width: 1440px; height: 900px; display: flex; background: #ffffff; color: #171717; overflow: hidden;">
  <div style="width: 52px; flex-shrink: 0; background: #f8f8f8; border-right: 1px solid #ededed; display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 3px;">
    <div style="width: 28px; height: 28px; border-radius: 8px; background: #171717; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 600; margin-bottom: 10px;">AF</div>
${rail}    <div style="flex-grow: 1;"></div>
    <img class="av" src="pfp-amy.jpg" style="width: 26px; height: 26px; border-radius: 13px;">
  </div>
${sidebar(cur)}
  <div style="flex-grow: 1; display: flex; flex-direction: column; min-width: 0;">${topbar(title, hint)}
    <div style="flex-grow: 1; display: flex; min-height: 0;">
      <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden;">
${body}
      </div>${rightPanel(rightMode, agent)}
    </div>
  </div>
</div>
</x-dc>
<script data-dc-script data-props='{"accent":{"editor":"color","default":"#007BE0","options":["#007BE0","#171717","#278F5E","#6846E3"],"section":"Theme"},"$preview":{"width":1440,"height":900}}'>
class Component extends DCLogic {${RUNTIME}
  draw() {${draw}
  }
}
</${'script'}>
</body>
</html>
`;
}

/* =================================================================== */
/* TRENDS                                                              */
/* =================================================================== */
const trendsBody = `
        <div style="flex-shrink: 0; height: 50px; display: flex; align-items: center; gap: 8px; padding: 0 20px; border-bottom: 1px solid #ededed;">
          <div class="chip">Sources: GDELT, YouTube ${chev}</div>
          <div class="chip">Region: HK / TW / SG ${chev}</div>
          <div style="flex-grow: 1;"></div>
          <span class="cap">Ranked 09:15 HKT · next refresh 13:15</span>
          <div class="tf"><div>1W</div><div>1M</div><div class="on">3M</div></div>
        </div>

        <div style="flex-shrink: 0; padding: 16px 20px 10px; display: flex; align-items: flex-end; gap: 18px;">
          <div style="min-width: 0; flex-grow: 1;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 11px; color: #c7c7c7; font-variant-numeric: tabular-nums;">#01</span>
              <span class="bd grn">Rising</span><span class="bd gray">4 sources</span>
            </div>
            <div style="font-size: 19px; font-weight: 500; letter-spacing: -0.01em; margin-top: 7px;">Sham Shui Po dai pai dong revival</div>
          </div>
          <div style="text-align: right; flex-shrink: 0;">
            <div style="display: flex; align-items: baseline; gap: 10px; justify-content: flex-end;">
              <span style="font-size: 30px; font-weight: 500; letter-spacing: -0.02em; font-variant-numeric: tabular-nums;">94</span>
              <span class="up" style="font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums;">▲ +38.2%</span>
            </div>
            <div class="cap" style="margin-top: 3px;">heat score · 2,104 mentions in 14 days</div>
          </div>
        </div>

        <div style="flex-shrink: 0; padding: 0 20px;">
          <div class="lwbox"><div id="lw-main" style="width: 100%; height: 318px;"></div><div class="lwload">loading chart…</div></div>
          <div style="display: flex; align-items: center; gap: 16px; margin-top: 8px;">
            <span class="cap" style="display: flex; align-items: center; gap: 6px;"><span class="sw" style="background: {{accent}};"></span>Mentions / day</span>
            <span class="cap" style="display: flex; align-items: center; gap: 6px;"><span class="sw" style="background: #e2e2e2;"></span>New sources / day</span>
            <div style="flex-grow: 1;"></div>
            <span class="cap">12 Jun – 9 Sep 2026 · source: GDELT, YouTube mostPopular</span>
          </div>
        </div>

        <div style="flex-grow: 1; min-height: 0; display: grid; grid-template-columns: minmax(0,1.35fr) minmax(0,1fr) 220px; gap: 14px; padding: 16px 20px 18px;">
          <div class="card" style="padding: 13px 15px; overflow: hidden;">
            <div class="lbl" style="padding: 0; margin-bottom: 4px;">Why it’s moving</div>
            <div class="src"><b>27 Aug</b><span>Licence board approves renewals for four stalls after a three-year delay</span></div>
            <div class="src"><b>2 Sep</b><span>HK01 feature on the families who kept the stalls running</span></div>
            <div class="src"><b>5 Sep</b><span>Three food channels post walk-throughs; 1.2M combined views</span></div>
          </div>
          <div class="card" style="padding: 13px 15px;">
            <div class="lbl" style="padding: 0; margin-bottom: 10px;">Suggested angles</div>
            <div style="display: flex; flex-direction: column; gap: 7px;">
              <div style="padding: 8px 10px; border-radius: 8px; background: #f8f8f8; font-size: 12.5px;">Operator interview: Mrs Ho</div>
              <div style="padding: 8px 10px; border-radius: 8px; background: #f8f8f8; font-size: 12.5px;">Before / after, 1998 archive</div>
              <div style="padding: 8px 10px; border-radius: 8px; background: #f8f8f8; font-size: 12.5px;">What a licence actually costs</div>
            </div>
          </div>
          <div class="card" style="padding: 13px 15px; display: flex; flex-direction: column;">
            <div class="lbl" style="padding: 0; margin-bottom: 10px;">Decision</div>
            <div class="btn p" style="justify-content: center; height: 34px;">Adopt → backlog</div>
            <div class="btn s" style="justify-content: center; height: 34px; margin-top: 7px;">Reject</div>
            <div class="btn s" style="justify-content: center; height: 34px; margin-top: 7px;">Save for later</div>
            <div class="cap" style="margin-top: auto; line-height: 1.5;">Your decision re-weights future ranking.</div>
          </div>
        </div>`;

const trendsDraw = `
    var el = document.getElementById('lw-main'); if (!el || el.getAttribute('data-drawn')) return; el.setAttribute('data-drawn', '1');
    var A = this.accent(), c = this.base(el, 318);
    var data = this.gen(7, 90, 48, 118, 74, 11);
    var area = c.addAreaSeries({ lineColor: A, topColor: A + '38', bottomColor: A + '02', lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    area.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.26 } });
    area.setData(data);
    area.setMarkers([
      { time: '2026-08-27', position: 'aboveBar', color: '#171717', shape: 'circle', text: 'Licence decision' },
      { time: '2026-09-02', position: 'aboveBar', color: '#171717', shape: 'circle', text: 'HK01 feature' }
    ]);
    var vol = c.addHistogramSeries({ priceScaleId: 'v', color: '#e6e6e6', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
    var s2 = 3, r2 = function () { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
    vol.setData(data.map(function (p, i) { return { time: p.time, value: Math.round(2 + r2() * 6 + (i > 74 ? (i - 74) * 1.6 : 0)), color: i > 74 ? '#d6d6d6' : '#ececec' }; }));
    c.timeScale().fitContent();
    this.done(el);`;

/* =================================================================== */
/* COMPARE                                                             */
/* =================================================================== */
const SERIES = [
  ['dai pai dong', '{{accent}}', '2,104', '31.4', '+38.2%', '1.00', 'GDELT · YT'],
  ['night market', '#383838', '1,512', '22.8', '+21.4%', '0.71', 'GDELT · YT'],
  ['hawker', '#8d99a6', '884', '13.6', '+3.1%', '0.44', 'GDELT'],
  ['cha chaan teng', '#c7c7c7', '640', '11.9', '−6.7%', '0.18', 'Trends'],
];
const compareBody = `
        <div style="flex-shrink: 0; min-height: 56px; display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-bottom: 1px solid #ededed; flex-wrap: wrap;">
${SERIES.map(([n, col]) => `          <div class="chip" style="background: #fff;"><span class="sw" style="background: ${col};"></span>${n}<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></div>`).join('\n')}
          <div class="chip" style="border-style: dashed; color: #999999;">+ Add series · 4 of 5</div>
          <div style="flex-grow: 1;"></div>
          <div class="tf"><div>1M</div><div class="on">3M</div><div>6M</div></div>
          <div class="btn s">Export as report</div>
        </div>

        <div style="flex-shrink: 0; padding: 16px 20px 0;">
          <div style="display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px;">
            <span style="font-size: 15px; font-weight: 500;">Mention volume, indexed</span>
            <span class="cap">Day 1 = 100 for each series, so shape compares rather than absolute size</span>
          </div>
          <div class="lwbox"><div id="lw-cmp" style="width: 100%; height: 360px;"></div><div class="lwload">loading chart…</div></div>
          <div style="display: flex; justify-content: flex-end; margin-top: 7px;"><span class="cap">12 Jun – 9 Sep 2026 · source: GDELT, Google Trends, YouTube mostPopular</span></div>
        </div>

        <div style="flex-grow: 1; min-height: 0; padding: 14px 20px 18px;">
          <div class="t">
            <div class="hd" style="grid-template-columns: minmax(0,1.5fr) 110px 100px 110px 150px minmax(0,1fr);"><div>Series</div><div class="num">Peak / day</div><div class="num">Avg / day</div><div class="num">14 d change</div><div class="num">Corr. with #1</div><div>Sources</div></div>
${SERIES.map(([n, col, pk, av, ch, co, srcs]) => `            <div class="tr" style="grid-template-columns: minmax(0,1.5fr) 110px 100px 110px 150px minmax(0,1fr); height: 42px;"><div style="gap: 9px;"><span class="sw" style="background: ${col};"></span><span class="el">${n}</span></div><div class="num">${pk}</div><div class="num">${av}</div><div class="num ${ch.startsWith('−') ? 'dn' : 'up'}">${ch}</div><div class="num" style="gap: 8px;"><div style="width: 60px; height: 4px; border-radius: 2px; background: #ededed;"><div style="width: ${Math.round(parseFloat(co) * 100)}%; height: 4px; border-radius: 2px; background: #c7c7c7;"></div></div>${co}</div><div style="color: #7c7c7c;">${srcs}</div></div>`).join('\n')}
          </div>
        </div>`;

const compareDraw = `
    var el = document.getElementById('lw-cmp'); if (!el || el.getAttribute('data-drawn')) return; el.setAttribute('data-drawn', '1');
    var A = this.accent(), c = this.base(el, 360), self = this;
    var idx = function (d) { var b = d[0].value; return d.map(function (p) { return { time: p.time, value: Math.round(p.value / b * 1000) / 10 }; }); };
    var defs = [[7, 48, 118, 74, 11, A, 2.4], [19, 40, 62, 70, 9, '#383838', 1.8], [31, 36, 14, 60, 7, '#8d99a6', 1.6], [43, 42, -12, 40, 7, '#c7c7c7', 1.6]];
    defs.forEach(function (d) {
      var s = c.addLineSeries({ color: d[5], lineWidth: d[6], priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3 });
      s.setData(idx(self.gen(d[0], 90, d[1], d[2], d[3], d[4])));
    });
    c.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.06 } });
    c.timeScale().fitContent();
    this.done(el);`;

/* =================================================================== */
/* PERFORMANCE                                                         */
/* =================================================================== */
const kpi = (label, val, delta, up, pts) => `
            <div class="stat" style="display: flex; flex-direction: column; gap: 6px;">
              <i>${label}</i>
              <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 8px;">
                <b style="margin-top: 0;">${val}</b>
                <svg viewBox="0 0 72 24" style="width: 72px; height: 24px; fill: none; stroke: ${up ? '{{accent}}' : '#c7c7c7'}; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round;"><path d="${pts}"/></svg>
              </div>
              <span class="${up ? 'up' : 'dn'}" style="font-size: 11.5px; font-variant-numeric: tabular-nums;">${up ? '▲' : '▼'} ${delta} <span style="color: #999999;">vs previous 28 d</span></span>
            </div>`;

const CH = [['YouTube', 642100, 100], ['Instagram', 310400, 48], ['LinkedIn', 130200, 20], ['X', 118600, 18], ['WeChat OA', 83000, 13]];
const VIDS = [
  ['cover-history.jpg', 'history-of-greece_ep75', 'YouTube', '642,100', '52.4%', '8.1%', 1],
  ['cover-porsche.jpg', 'porsche-cat_night', 'Instagram', '310,400', '44.1%', '7.2%', 1],
  ['cover-orange.jpg', 'orange_typography_cut', 'YouTube', '201,600', '38.9%', '5.9%', 1],
  ['cover-domore.jpg', 'do-more_brandspot', 'X', '118,600', '33.0%', '4.4%', 0],
  ['cover-goodday.jpg', 'good-day_collage_teaser', 'LinkedIn', '130,200', '28.4%', '3.1%', 0],
];
const perfBody = `
        <div style="flex-shrink: 0; height: 50px; display: flex; align-items: center; gap: 8px; padding: 0 20px; border-bottom: 1px solid #ededed;">
          <div class="chip">Channel: All ${chev}</div><div class="chip">Last 28 days ${chev}</div><div class="chip">Campaign: 2026-Q3 ${chev}</div>
          <div style="flex-grow: 1;"></div><span class="cap">Loads without a chat prompt</span><div class="btn s">Export CSV</div>
        </div>
        <div style="flex-shrink: 0; display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; padding: 14px 20px 0;">${kpi('VIEWS', '1,284,300', '+18.4%', 1, 'M2 20 11 18l9 2 9-6 9 2 9-8 9 3 9-7 4-2')}${kpi('WATCH-THROUGH', '41.2%', '+2.9 pt', 1, 'M2 16 11 15l9 1 9-3 9 1 9-4 9 2 9-5 4-1')}${kpi('ENGAGEMENT', '6.8%', '−0.4 pt', 0, 'M2 8 11 10l9-1 9 3 9-2 9 4 9-1 9 3 4 1')}${kpi('COMMENTS', '3,912', '+26.0%', 1, 'M2 21 11 20l9-3 9 2 9-5 9 1 9-7 9 2 4-5')}
        </div>
        <div style="flex-shrink: 0; padding: 14px 20px 0;">
          <div style="display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px;"><span style="font-size: 14px; font-weight: 500;">Daily views</span><span class="cap">with comment volume beneath</span><div style="flex-grow: 1;"></div><span class="cap">13 Aug – 9 Sep 2026 · source: YouTube Data API, Instagram Graph</span></div>
          <div class="lwbox"><div id="lw-perf" style="width: 100%; height: 214px;"></div><div class="lwload">loading chart…</div></div>
        </div>
        <div style="flex-grow: 1; min-height: 0; display: grid; grid-template-columns: 250px minmax(0,1fr); gap: 16px; padding: 14px 20px 16px;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 11px;"><span class="lbl" style="padding: 0;">By channel</span><span class="cap">views</span></div>
${CH.map(([n, v, w], i) => `            <div style="margin-bottom: 11px;"><div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px;"><span>${n}</span><span style="font-variant-numeric: tabular-nums; color: #525252;">${v.toLocaleString('en-US')}</span></div><div style="height: 7px; border-radius: 4px; background: #f3f3f3;"><div style="width: ${w}%; height: 7px; border-radius: 4px; background: ${i === 0 ? '{{accent}}' : '#c7c7c7'};"></div></div></div>`).join('\n')}
          </div>
          <div class="t">
            <div class="hd" style="grid-template-columns: minmax(0,2fr) 96px 92px 96px 88px;"><div>Top and bottom for the period</div><div>Channel</div><div class="num">Views</div><div class="num">Watch-thru</div><div class="num">Engage</div></div>
${VIDS.map(([img, n, ch, v, wt, en, top], i) => `            <div class="tr" style="grid-template-columns: minmax(0,2fr) 96px 92px 96px 88px; height: 42px;"><div style="gap: 10px;"><img src="${img}" style="width: 46px; height: 26px; border-radius: 4px; object-fit: cover; flex-shrink: 0;"><span class="el">${n}</span>${i === 0 ? '<span class="bd grn" style="margin-left: 6px;">Top</span>' : i === VIDS.length - 1 ? '<span class="bd red" style="margin-left: 6px;">Bottom</span>' : ''}</div><div><span class="bd gray">${ch}</span></div><div class="num">${v}</div><div class="num">${wt}</div><div class="num">${en}</div></div>`).join('\n')}
          </div>
        </div>`;

const perfDraw = `
    var el = document.getElementById('lw-perf'); if (!el || el.getAttribute('data-drawn')) return; el.setAttribute('data-drawn', '1');
    var A = this.accent(), c = this.base(el, 214);
    var raw = this.gen(11, 28, 30000, 22000, 16, 3400);
    var t0 = Date.UTC(2026, 7, 13);
    var views = raw.map(function (p, i) { return { time: new Date(t0 + i * 86400000).toISOString().slice(0, 10), value: p.value + (i % 7 === 5 ? 9000 : 0) }; });
    var area = c.addAreaSeries({ lineColor: A, topColor: A + '30', bottomColor: A + '02', lineWidth: 2, priceLineVisible: false });
    area.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.3 } });
    area.setData(views);
    area.setMarkers([{ time: views[15].time, position: 'aboveBar', color: '#171717', shape: 'circle', text: 'ep75 published' }]);
    var cm = c.addHistogramSeries({ priceScaleId: 'c', color: '#e6e6e6', lastValueVisible: false, priceLineVisible: false });
    cm.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 }, visible: false });
    cm.setData(views.map(function (p, i) { return { time: p.time, value: Math.round(p.value / 180 + (i === 15 ? 260 : 0)), color: i === 15 ? '#bdbdbd' : '#e8e8e8' }; }));
    c.timeScale().fitContent();
    this.done(el);`;

/* ---------- write ---------- */
const out = [
  { file: 'Res-Trends.dc.html', cur: 'trends', title: 'Trends dashboard', hint: 'ranked topics · adopt feeds ranking weights', body: trendsBody, rightMode: 'watch', agent: '', draw: trendsDraw },
  { file: 'Res-Compare.dc.html', cur: 'compare', title: 'Search &amp; compare', hint: 'up to five series on one time axis', body: compareBody, rightMode: 'agent',
    agent: agentBlock('4 series · 3 months', 'Which of these is actually new?', 'Correlated 4 series · 0.8 s',
      'Only “dai pai dong” broke from its baseline, it tracks the 27 Aug licence decision. “Night market” rose with it (r = 0.71) but was already climbing. “Cha chaan teng” is fading.', 'Brief on dai pai dong', 'Scoped to your entitled sources', 'HK$0.14'),
    draw: compareDraw },
  { file: 'Res-Perf.dc.html', cur: 'perf', title: 'Content performance', hint: 'loads without a chat prompt · last 28 days', body: perfBody, rightMode: 'agent',
    agent: agentBlock('Last 28 days · all channels', 'Why did views jump mid-period?', 'Read 5 videos · 0.7 s',
      'history-of-greece_ep75 went live on 28 Aug and carried 50% of the period’s views on its own. Strip it out and the other four are flat against the previous 28 days.', 'Compare ep74', 'Your own published videos only', 'HK$0.10'),
    draw: perfDraw },
];
/* =================================================================== */
/* COMMENT INBOX                                                       */
/* =================================================================== */
const HIST = [['Very negative', 2, '#e03636'], ['Negative', 4, '#f79596'], ['Neutral', 7, '#c7c7c7'], ['Positive', 10, '#86e0a8'], ['Very positive', 4, '#278f5e']];
const CMTS = [
  ['cover-history.jpg', 'history-of-greece_ep75', [
    ['pfp-amy.jpg', '@kk_wong', '呢集真係好正,幾時出下一集?', 'grn', 'Positive', 1, '2 h'],
    ['pfp-leung.jpg', '@brandpartner_hk', 'Do you take sponsorship enquiries for the night-market series?', 'blue', 'Lead', 0, '3 h'],
    ['pfp-michelle.jpg', '@anon_4471', 'Contains a flagged keyword', 'amb', 'Flagged', 0, '4 h']]],
  ['cover-porsche.jpg', 'porsche-cat_night', [
    ['pfp-chan.jpg', '@lensbyleo', 'Colour grade on this is unreal. What LUT?', 'grn', 'Positive', 0, '5 h'],
    ['pfp-amy.jpg', '@mei_eats', '好想知間舖喺邊', 'gray', 'Neutral', 0, '6 h']]],
];
const inboxBody = `
        <div style="flex-shrink: 0; height: 50px; display: flex; align-items: center; gap: 8px; padding: 0 20px; border-bottom: 1px solid #ededed;">
          <div class="chip">Sentiment: All ${chev}</div><div class="chip">Language: All ${chev}</div><div class="chip">Flagged</div><div class="chip">Business leads</div>
          <div style="flex-grow: 1;"></div>
          <span class="cap">Bulk:</span><div class="btn s">Hide</div><div class="btn s">Mark as spam</div>
        </div>
        <div style="flex-shrink: 0; display: grid; grid-template-columns: minmax(0,1fr) 250px; gap: 18px; padding: 14px 20px; border-bottom: 1px solid #ededed;">
          <div>
            <div style="display: flex; align-items: baseline; gap: 9px; margin-bottom: 10px;"><span style="font-size: 13.5px; font-weight: 500;">Sentiment distribution</span><span class="cap">27 new comments · 3 channels</span></div>
            <div style="display: flex; align-items: flex-end; gap: 8px; height: 64px;">
${HIST.map(([l, n, c]) => `              <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px;"><span style="font-size: 11px; font-variant-numeric: tabular-nums; color: #525252;">${n}</span><div style="width: 100%; height: ${Math.round(n / 10 * 44)}px; background: ${c}; border-radius: 4px 4px 1px 1px;"></div></div>`).join('\n')}
            </div>
            <div style="display: flex; gap: 8px; margin-top: 5px;">${HIST.map(([l]) => `<span style="flex: 1; text-align: center; font-size: 10.5px; color: #999999;">${l}</span>`).join('')}</div>
          </div>
          <div style="border-left: 1px solid #ededed; padding-left: 18px;">
            <div class="lbl" style="padding: 0; margin-bottom: 10px;">Language</div>
            <div class="kv" style="padding: 5px 0;"><span>粵語 Cantonese</span><span>18</span></div>
            <div class="kv" style="padding: 5px 0;"><span>English</span><span>7</span></div>
            <div class="kv" style="padding: 5px 0; border: none;"><span>普通話 Mandarin</span><span>2</span></div>
            <div class="cap" style="margin-top: 6px;">TikTok has no comment interface</div>
          </div>
        </div>
        <div style="flex-grow: 1; min-height: 0; display: flex;">
          <div style="width: 330px; flex-shrink: 0; border-right: 1px solid #ededed; overflow: hidden; padding: 6px 0;">
${CMTS.map(([img, vid, list]) => `            <div style="display: flex; align-items: center; gap: 9px; padding: 9px 14px 6px;"><img src="${img}" style="width: 34px; height: 19px; border-radius: 3px; object-fit: cover;"><span style="font-size: 11.5px; font-weight: 500; color: #525252;">${vid}</span><span class="cap" style="margin-left: auto;">${list.length}</span></div>
${list.map(([av, h, t, c, lab, sel, ago]) => `            <div style="display: flex; gap: 10px; padding: 9px 14px; ${sel ? 'background: #f5faff; box-shadow: inset 2px 0 0 {{accent}};' : ''}"><img src="${av}" style="width: 26px; height: 26px; border-radius: 13px; object-fit: cover; flex-shrink: 0;"><div style="min-width: 0; flex-grow: 1;"><div style="display: flex; align-items: center; gap: 6px;"><span style="font-size: 12.5px; font-weight: ${sel ? 600 : 500};">${h}</span><span class="cap">${ago}</span><span class="bd ${c}" style="margin-left: auto;">${lab}</span></div><div style="font-size: 12.5px; color: #525252; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t}</div></div></div>`).join('\n')}`).join('\n')}
          </div>
          <div style="flex-grow: 1; min-width: 0; padding: 16px 20px; overflow: hidden;">
            <div style="display: flex; align-items: center; gap: 10px;"><img src="pfp-amy.jpg" style="width: 36px; height: 36px; border-radius: 18px; object-fit: cover;"><div><div style="font-size: 13.5px; font-weight: 600;">@kk_wong</div><div class="cap">YouTube · on history-of-greece_ep75 · 2 h ago · 14 prior comments</div></div><span class="bd grn" style="margin-left: auto;">Positive</span></div>
            <div style="margin-top: 14px; padding: 14px 16px; border-radius: 12px; background: #f8f8f8; font-size: 15px; line-height: 1.6;">呢集真係好正,幾時出下一集?</div>
            <div class="cap" style="margin-top: 7px;">“This episode is great, when’s the next one?” · machine translation</div>
            <div style="display: flex; align-items: center; gap: 8px; margin: 20px 0 8px;"><span class="lbl" style="padding: 0;">AI-suggested reply</span><span class="bd amb">Draft</span></div>
            <div style="border: 1px solid #d9d9d9; border-radius: 12px; padding: 13px 15px; font-size: 14px; line-height: 1.6; color: #2b343d; box-shadow: 0 0 0 3px #EFF6FF;">多謝支持!下一集會喺下星期三上載,記得開通知 🔔</div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 12px;">
              <div class="btn p" style="height: 32px;">Approve &amp; send</div><div class="btn s" style="height: 32px;">Edit</div><div class="btn s" style="height: 32px;">Regenerate</div>
              <div style="flex-grow: 1;"></div><span class="cap">Nothing sends without approval</span>
            </div>
          </div>
        </div>`;

/* =================================================================== */
/* TOPIC BACKLOG, board                                               */
/* =================================================================== */
const card = (heat, title, img, owner, ch, due, state) => `
              <div style="border: 1px solid #ededed; border-radius: 11px; background: #fff; padding: 12px; box-shadow: 0 1px 1px rgba(5,5,6,.04);">
                <div style="display: flex; align-items: center; gap: 7px;"><span style="font-size: 11px; font-weight: 600; color: {{accent}}; font-variant-numeric: tabular-nums;">${heat}</span><span class="bd gray">${ch}</span>${state || ''}</div>
                <div style="font-size: 13px; font-weight: 500; line-height: 1.4; margin-top: 8px; text-wrap: pretty;">${title}</div>
                <div style="display: flex; align-items: center; gap: 7px; margin-top: 11px;"><img src="${img}" style="width: 20px; height: 20px; border-radius: 10px; object-fit: cover; flex-shrink: 0;"><span style="font-size: 11.5px; color: #525252; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${owner}</span><span class="cap" style="margin-left: auto; flex-shrink: 0; white-space: nowrap;">${due}</span></div>
              </div>`;
const col = (name, n, cards, note) => `
            <div style="display: flex; flex-direction: column; min-width: 0; background: #f8f8f8; border-radius: 12px; padding: 10px;">
              <div style="display: flex; align-items: center; gap: 7px; padding: 2px 4px 10px;"><span style="font-size: 12.5px; font-weight: 600;">${name}</span><span class="cap">${n}</span>${note ? `<span class="cap" style="margin-left: auto;">${note}</span>` : ''}</div>
              <div style="display: flex; flex-direction: column; gap: 8px;">${cards}</div>
            </div>`;
const backlogBody = `
        <div style="flex-shrink: 0; height: 50px; display: flex; align-items: center; gap: 8px; padding: 0 20px; border-bottom: 1px solid #ededed;">
          <div class="chip">Owner: Everyone ${chev}</div><div class="chip">Channel: All ${chev}</div>
          <div style="flex-grow: 1;"></div><span class="cap">9 adopted topics · 2 due this week</span><div class="btn p">Send selected to Script</div>
        </div>
        <div style="flex-grow: 1; min-height: 0; display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; padding: 16px 20px; overflow: hidden;">
${col('Adopted', 3,
  card(94, 'Sham Shui Po dai pai dong revival', 'pfp-amy.jpg', 'Amy Wong', 'YouTube', '12 Sep', '<span class="bd red" style="margin-left: auto;">Due in 2 d</span>') +
  card(76, 'Cantonese voice cloning backlash', 'pfp-leung.jpg', 'Leung Chi-hang', 'YouTube', '26 Sep') +
  card(71, 'Singapore hawker succession', 'pfp-michelle.jpg', 'Michelle Yip', 'LinkedIn', '3 Oct'))}
${col('Briefing', 2,
  card(88, 'Taipei night-market crossover creators', 'pfp-chan.jpg', 'Chan Ka-ming', 'Instagram', '19 Sep') +
  card(52, 'Tai O stilt houses restoration', 'pfp-amy.jpg', 'Amy Wong', 'YouTube', '10 Oct'))}
${col('Scripting', 2,
  card(81, 'Harbourfront redevelopment hearing', 'pfp-michelle.jpg', 'Michelle Yip', 'YouTube', '22 Sep', '<span class="bd amb" style="margin-left: auto;">Sensitive</span>') +
  card(64, 'Cha chaan teng menu inflation', 'pfp-leung.jpg', 'Leung Chi-hang', 'X', '30 Sep'), 'in Script')}
${col('Handed to Video', 2,
  card(90, 'MTR after-hours maintenance crews', 'pfp-chan.jpg', 'Chan Ka-ming', 'YouTube', 'Locked v4', '<span class="bd grn" style="margin-left: auto;">Locked</span>') +
  card(58, 'Temple St fortune tellers', 'pfp-amy.jpg', 'Amy Wong', 'Instagram', 'Locked v2', '<span class="bd grn" style="margin-left: auto;">Locked</span>'), 'read-only')}
        </div>`;

out.push(
  { file: 'Res-Inbox.dc.html', cur: 'inbox', title: 'Comment inbox', hint: 'replies require human approval', body: inboxBody, rightMode: 'agent',
    agent: agentBlock('27 comments · 3 channels', 'Any business leads today?', 'Read 27 comments · 0.6 s',
      'One: @brandpartner_hk asked about sponsorship on ep75. Their account links to a Causeway Bay F&amp;B group. I’ve drafted a reply that routes them to your sales inbox, it still needs your approval.', 'Open the lead', 'Comment data is personal data, HK PDPO applies', 'HK$0.06'),
    draw: '' },
  { file: 'Res-Backlog.dc.html', cur: 'backlog', title: 'Topic backlog', hint: 'hands off directly to Script', body: backlogBody, rightMode: 'agent',
    agent: agentBlock('9 topics · 4 stages', 'What’s at risk of slipping?', 'Read 9 topics + calendar · 0.5 s',
      'Dai pai dong is due in 2 days and is still at Adopted, no brief yet. At the usual 3 days from brief to lock, it will miss 12 Sep unless the brief starts today.', 'Start the brief', 'Scoped to your entitled sources', 'HK$0.05'),
    draw: '' },
);

/* Output fixes, applied to generated HTML:
 *   - skip loading the chart library on screens with no chart
 *   - lighter, smaller event markers
 *   - wider name column in the performance table */
const FIX = [
  ['  componentDidMount() {\n    var self = this;', "  componentDidMount() {\n    if (!document.querySelector('[id^=\"lw-\"]')) return;\n    var self = this;"],
  ["color: '#171717', shape: 'circle', text: 'Licence decision' }", "color: '#525252', shape: 'circle', size: 0.7, text: 'Licence decision' }"],
  ["color: '#171717', shape: 'circle', text: 'HK01 feature' }", "color: '#525252', shape: 'circle', size: 0.7, text: 'HK01 feature' }"],
  ["color: '#171717', shape: 'circle', text: 'ep75 published' }", "color: '#525252', shape: 'circle', size: 0.6, text: 'ep75 published' }"],
  ['grid-template-columns: 250px minmax(0,1fr); gap: 16px;', 'grid-template-columns: 210px minmax(0,1fr); gap: 16px;'],
  ['minmax(0,2fr) 96px 92px 96px 88px', 'minmax(0,1fr) 86px 78px 76px 64px'],
];
const fix = html => FIX.reduce((h, [a, b]) => h.split(a).join(b), html);

for (const o of out) fs.writeFileSync(path.join(DIR, o.file), fix(page(o)));
console.log('wrote', out.map(o => o.file).join(', '));
