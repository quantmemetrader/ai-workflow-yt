/**
 * Market Research filters, shared by research-screens.mjs (desktop) and
 * phone-screens-a.mjs (phone): which sites the agent reads (multi-select,
 * e.g. Bloomberg, Reuters) and which tech beats Trends ranks (AI,
 * blockchain, semiconductors...). pickLogic() spreads into renderVals(),
 * the same way dockLogic does in phone-shell.mjs.
 */
export const SOURCES = [
  ['News sites', [['bloomberg', 'Bloomberg', 'bloomberg.com'], ['reuters', 'Reuters', 'reuters.com'], ['ft', 'Financial Times', 'ft.com'], ['wsj', 'The Wall Street Journal', 'wsj.com'], ['scmp', 'SCMP', 'scmp.com'], ['nikkei', 'Nikkei Asia', 'asia.nikkei.com'], ['techcrunch', 'TechCrunch', 'techcrunch.com'], ['verge', 'The Verge', 'theverge.com'], ['coindesk', 'CoinDesk', 'coindesk.com'], ['digitimes', 'DigiTimes', 'digitimes.com']]],
  ['Signals', [['gdelt', 'GDELT', 'news events'], ['gtrends', 'Google Trends', 'search interest'], ['youtube', 'YouTube', 'mostPopular']]],
];
const SRC = SOURCES.flatMap(g => g[1]);
export const SRC_ON = ['bloomberg', 'reuters', 'scmp', 'techcrunch', 'gdelt', 'youtube'];

export const CATS = [
  ['Tech beats', [['ai', 'AI'], ['chain', 'Blockchain & crypto'], ['semi', 'Semiconductors'], ['devices', 'Consumer tech'], ['fintech', 'Fintech'], ['ev', 'EV & mobility'], ['startups', 'Startups & VC']]],
  ['Other', [['culture', 'Culture & lifestyle']]],
];
const CAT = CATS.flatMap(g => g[1]);
export const catName = k => CAT.find(c => c[0] === k)[1];

/* ranked topics: name, heat, 14 d change, rising, sparkline, category, sensitive */
export const TOPICS = [
  ['Sham Shui Po dai pai dong revival', 94, '+38.2%', 1, 'M1 16 7 15l6 1 6-4 6 1 6-6 6 2 6-6 4-2', 'culture'],
  ['HKMA stablecoin licences: first issuers', 91, '+33.5%', 1, 'M1 15 7 14l6 1 6-5 6 2 6-6 6 1 6-5 4-3', 'chain'],
  ['On-device AI in new flagship phones', 89, '+29.1%', 1, 'M1 16 7 14l6 0 6-3 6 1 6-5 6 1 6-6 4-2', 'ai'],
  ['Taipei night-market crossover creators', 88, '+21.4%', 1, 'M1 13 7 14l6-2 6 3 6-5 6 3 6-7 6 3 4-5', 'culture'],
  ['TSMC 2 nm ramp and Asia’s chip supply', 84, '+18.7%', 1, 'M1 14 7 13l6 1 6-3 6 0 6-4 6 1 6-4 4-1', 'semi'],
  ['Harbourfront redevelopment hearing', 81, '+12.9%', 1, 'M1 15 7 13l6 1 6-4 6 2 6-5 6 1 6-4 4 1', 'culture', 1],
  ['Cantonese voice cloning backlash', 76, '+9.8%', 1, 'M1 16 7 16l6-2 6 1 6-3 6 1 6-5 6 1 4-3', 'ai'],
  ['Hong Kong spot bitcoin ETF flows', 73, '+6.2%', 1, 'M1 12 7 13l6-2 6 2 6-3 6 1 6-3 6 1 4-2', 'chain'],
  ['Singapore hawker succession', 71, '+3.1%', 1, 'M1 10 7 11l6 1 6-2 6 3 6-1 6-4 6 2 4-2', 'culture'],
  ['Virtual banks turn a profit', 68, '+2.6%', 1, 'M1 11 7 11l6 1 6-2 6 1 6-1 6-2 6 1 4-1', 'fintech'],
  ['HBM memory shortage', 66, '+2.4%', 1, 'M1 12 7 12l6-1 6 1 6-1 6 0 6-2 6 1 4-1', 'semi'],
  ['Cha chaan teng menu inflation', 64, '−6.7%', 0, 'M1 5 7 7l6-1 6 3 6-2 6 4 6-2 6 3 4 1', 'culture'],
  ['AI video start-ups raise in Asia', 61, '+1.8%', 1, 'M1 12 7 11l6 1 6-1 6 0 6-2 6 1 6-2 4 0', 'startups'],
  ['Foldables cut prices before 11.11', 59, '−1.2%', 0, 'M1 8 7 8l6 1 6-1 6 2 6-1 6 1 6 1 4 0', 'devices'],
  ['EV price war reaches Hong Kong', 57, '−2.2%', 0, 'M1 9 7 8l6 2 6-1 6 2 6-1 6 2 6-1 4 1', 'ev'],
];
const count = k => TOPICS.filter(t => t[5] === k).length;

/* state: src (picked sites), cat (picked beats, empty = all), pop ('src' | 'cat' | '') */
export const pickLogic = (rows = []) => `...(function (c) {
      var st = c.state || {}, src = st.src || ${JSON.stringify(SRC_ON)}, cat = st.cat || [], pop = st.pop || '', o = {};
      var ALL = ${JSON.stringify(SRC.map(s => s[0]))}, NM = ${JSON.stringify(Object.fromEntries(SRC.map(s => [s[0], s[1]])))}, R = ${JSON.stringify(rows)};
      var set = function (p) { c.setState(p); }, drop = function (a, k) { return a.filter(function (x) { return x !== k; }); };
      o.popSrc = pop === 'src'; o.popCat = pop === 'cat';
      o.togSrc = function () { set({ pop: pop === 'src' ? '' : 'src' }); };
      o.togCat = function () { set({ pop: pop === 'cat' ? '' : 'cat' }); };
      o.closePop = function () { set({ pop: '' }); };
      ALL.forEach(function (k) { var on = src.indexOf(k) > -1; o['s_' + k] = on ? ' on' : ''; o['ts_' + k] = function () { set({ src: on ? drop(src, k) : src.concat([k]) }); }; });
      ${JSON.stringify(CAT.map(x => x[0]))}.forEach(function (k) { var on = cat.indexOf(k) > -1; o['c_' + k] = on ? ' on' : ''; o['tc_' + k] = function () { set({ cat: on ? drop(cat, k) : cat.concat([k]) }); }; });
      o.srcAll = function () { set({ src: ALL.slice() }); };
      o.srcNone = function () { set({ src: [] }); };
      o.catNone = function () { set({ cat: [] }); };
      var picked = ALL.filter(function (k) { return src.indexOf(k) > -1; });
      o.srcN = String(picked.length); o.srcZero = !picked.length;
      o.srcNames = picked.slice(0, 2).map(function (k) { return NM[k]; }).join(', ') + (picked.length > 2 ? ' +' + (picked.length - 2) : '');
      o.catAll = !cat.length; o.catSome = cat.length > 0; o.catN = String(cat.length); o.catOn = cat.length ? ' pkon' : '';
      var shown = 0; R.forEach(function (k, i) { var v = !cat.length || cat.indexOf(k) > -1; o['w_' + i] = v; if (v) shown++; });
      o.wNone = R.length > 0 && !shown;
      return o;
    })(this),`;

const CHK = '<svg viewBox="0 0 16 16"><path d="M3.6 8.3 6.5 11.2 12.4 5.1"/></svg>';
const SEARCH = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/></svg>';
const opt = (cls, t, k, name, note) => `<div class="${cls}{{${t}_${k}}}" onClick="{{ t${t}_${k} }}"><span class="cb">${CHK}</span><span class="n">${name}</span>${note ? `<span class="d">${note}</span>` : ''}</div>`;
const srcList = cls => SOURCES.map(([g, list]) => `<div class="pkg">${g}</div>` + list.map(([k, n, d]) => opt(cls, 's', k, n, d)).join('')).join('');
const catList = cls => CATS.map(([g, list]) => `<div class="pkg">${g}</div>` + list.map(([k, n]) => opt(cls, 'c', k, n, `${count(k)} topics`)).join('')).join('');

/* ---------- desktop: a chip that opens a checklist popover ---------- */
export const PICK_CSS = `
    .pkw { position: relative; }
    .pkv { color: #171717; font-weight: 500; margin-left: 5px; }
    .pkb { margin-left: 6px; min-width: 17px; height: 17px; padding: 0 5px; box-sizing: border-box; border-radius: 9px; background: var(--ac); color: #fff; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }
    .chip.pkon { border-color: var(--ac); }
    .pkbg { position: fixed; inset: 0; z-index: 40; }
    .pkp { position: absolute; top: calc(100% + 6px); left: 0; z-index: 41; background: #fff; border: 1px solid #e2e2e2; border-radius: 12px; box-shadow: 0 12px 32px rgba(23,23,23,.14), 0 2px 6px rgba(23,23,23,.06); padding: 6px; }
    .pkh { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 8px 8px 6px; }
    .pkh b { font-size: 13px; font-weight: 500; } .pkh span { font-size: 11.5px; color: #999999; font-variant-numeric: tabular-nums; }
    .pkq { display: flex; align-items: center; gap: 7px; height: 30px; margin: 2px 4px 4px; padding: 0 9px; border: 1px solid #ededed; border-radius: 8px; background: #f8f8f8; font-size: 12px; color: #999999; }
    .pkq svg { width: 13px; height: 13px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round; flex-shrink: 0; }
    .pkg { padding: 9px 8px 4px; font-size: 10.5px; font-weight: 500; color: #999999; letter-spacing: .04em; text-transform: uppercase; }
    .pk { display: flex; align-items: center; gap: 9px; height: 31px; padding: 0 8px; border-radius: 7px; font-size: 12.5px; color: #383838; }
    .pk:hover { background: #f5f5f5; }
    .pk .cb, .ppk .cb { border: 1.5px solid #c7c7c7; box-sizing: border-box; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .pk .cb { width: 15px; height: 15px; border-radius: 4px; }
    .pk .cb svg, .ppk .cb svg { stroke: #fff; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; opacity: 0; }
    .pk .cb svg { width: 11px; height: 11px; }
    .pk.on .cb, .ppk.on .cb { background: var(--ac); border-color: var(--ac); } .pk.on .cb svg, .ppk.on .cb svg { opacity: 1; }
    .pk .n { flex-grow: 1; } .pk .d { font-size: 11px; color: #a3a3a3; }
    .pkf { display: flex; align-items: center; gap: 14px; margin-top: 6px; padding: 9px 8px 5px; border-top: 1px solid #f0f0f0; font-size: 12px; color: #7c7c7c; }
    .pkf .pka { color: var(--ac); margin-left: auto; }`;

export const srcChip = chev => `<div class="pkw">
            <div class="chip" onClick="{{ togSrc }}">Sources<span class="pkv">{{srcNames}}</span><sc-if value="{{srcZero}}" hint-placeholder-val="{{ false }}"><span class="pkv">None</span></sc-if>${chev}</div>
            <sc-if value="{{popSrc}}" hint-placeholder-val="{{ false }}">
            <div class="pkbg" onClick="{{ closePop }}"></div>
            <div class="pkp" style="width: 312px;">
              <div class="pkh"><b>Sources the agent reads</b><span>{{srcN}} / ${SRC.length}</span></div>
              <div class="pkq">${SEARCH}<span>Search or paste a site, e.g. nikkei.com</span></div>
              ${srcList('pk')}
              <div class="pkf"><span onClick="{{ srcAll }}">Select all</span><span onClick="{{ srcNone }}">Clear</span><span class="pka">+ Add a site</span></div>
            </div>
            </sc-if>
          </div>`;

export const catChip = chev => `<div class="pkw">
            <div class="chip{{catOn}}" onClick="{{ togCat }}">Category<sc-if value="{{catAll}}" hint-placeholder-val="{{ true }}"><span class="pkv">All</span></sc-if><sc-if value="{{catSome}}" hint-placeholder-val="{{ false }}"><span class="pkb">{{catN}}</span></sc-if>${chev}</div>
            <sc-if value="{{popCat}}" hint-placeholder-val="{{ false }}">
            <div class="pkbg" onClick="{{ closePop }}"></div>
            <div class="pkp" style="width: 270px;">
              <div class="pkh"><b>Rank only these beats</b></div>
              ${catList('pk')}
              <div class="pkf"><span onClick="{{ catNone }}">Clear</span><span class="pka" onClick="{{ closePop }}">Done</span></div>
            </div>
            </sc-if>
          </div>`;

/* ---------- phone: two filter buttons that open bottom sheets ---------- */
export const PHONE_PICK_CSS = `
    .pfb { display: flex; align-items: center; gap: 7px; height: 38px; padding: 0 13px; border: 1px solid #e2e2e2; border-radius: 19px; font-size: 14px; color: #383838; background: #fff; flex-shrink: 0; }
    .pfb svg { width: 15px; height: 15px; stroke: #525252; fill: none; stroke-width: 1.8; stroke-linecap: round; }
    .pfb b { min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; border-radius: 10px; background: #171717; color: #fff; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
    .pfb i { font-style: normal; color: #999999; }
    .pfb.pkon { border-color: var(--ac); } .pfb.pkon b { background: var(--ac); }
    .psh { position: absolute; left: 0; right: 0; bottom: 0; z-index: 7; background: #fff; border-radius: 22px 22px 0 0; box-shadow: 0 -8px 32px rgba(23,23,23,.16); padding-bottom: 30px; display: flex; flex-direction: column; max-height: 94%; }
    .psh .hd { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 12px 20px 6px; }
    .psh .hd b { display: block; font-size: 19px; font-weight: 500; } .psh .hd span { display: block; font-size: 13px; color: #999999; margin-top: 3px; }
    .psh .hd i { font-style: normal; font-size: 13px; color: #999999; font-variant-numeric: tabular-nums; }
    .psh .ls { overflow-y: auto; padding: 0 12px; }
    .psh .pkg { padding: 12px 8px 4px; font-size: 12px; font-weight: 500; color: #999999; }
    .ppk { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 8px; border-radius: 10px; font-size: 15px; color: #171717; }
    .ppk .cb { width: 22px; height: 22px; border-radius: 6px; border: 1.5px solid #c7c7c7; box-sizing: border-box; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .ppk .cb svg { width: 14px; height: 14px; stroke: #fff; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; opacity: 0; }
    .ppk.on .cb { background: var(--ac); border-color: var(--ac); } .ppk.on .cb svg { opacity: 1; }
    .ppk .n { flex-grow: 1; } .ppk .d { font-size: 12.5px; color: #a3a3a3; }
    .psh .ft { display: flex; gap: 10px; padding: 12px 16px 0; border-top: 1px solid #f0f0f0; margin-top: 8px; }`;

const FILTER = '<svg viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4"/></svg>';
export const phoneFilters = `
      <div style="display: flex; gap: 8px; padding: 14px 16px 0;">
        <div class="pfb" onClick="{{ togSrc }}">${FILTER}<span>Sources</span><b>{{srcN}}</b></div>
        <div class="pfb{{catOn}}" onClick="{{ togCat }}"><span>Category</span><sc-if value="{{catAll}}" hint-placeholder-val="{{ true }}"><i>All</i></sc-if><sc-if value="{{catSome}}" hint-placeholder-val="{{ false }}"><b>{{catN}}</b></sc-if></div>
      </div>`;
const grab = '<div style="flex-shrink: 0; padding: 8px 0 0; display: flex; justify-content: center;"><div style="width: 38px; height: 4px; border-radius: 2px; background: #e2e2e2;"></div></div>';
const psheet = (key, head, list, foot) => `
  <sc-if value="{{${key}}}" hint-placeholder-val="{{ false }}">
  <div style="position: absolute; inset: 0; z-index: 6; background: rgba(23,23,23,0.32);" onClick="{{ closePop }}"></div>
  <div class="psh">${grab}
    <div class="hd">${head}</div>
    <div class="ls">${list}</div>
    <div class="ft">${foot}</div>
  </div>
  </sc-if>`;
export const phoneSheets = psheet('popSrc', `<div><b>Sources</b><span>Pick the sites the agent reads</span></div><i>{{srcN}} / ${SRC.length}</i>`, srcList('ppk'), '<div class="bs" onClick="{{ srcNone }}">Clear</div><div class="bp" onClick="{{ closePop }}">Done</div>')
  + psheet('popCat', '<div><b>Category</b><span>Rank only these beats</span></div>', catList('ppk'), '<div class="bs" onClick="{{ catNone }}">Clear</div><div class="bp" onClick="{{ closePop }}">Done</div>');
