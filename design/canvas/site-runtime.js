/*
 * Live-site runtime for the design canvas screens.
 * Runs each screen's own logic (a DCLogic subclass) exactly as the canvas
 * does: {{ holes }} in text and attributes, <sc-if>, onClick="{{ fn }}",
 * props defaults, setState re-render, componentDidMount.
 * Adds: desktop/phone choice by width, fit-to-window scaling, and app
 * navigation (rail, sidebar, tabs, chips, lists, a few named buttons).
 */
(function () {
  'use strict';
  var PAGE = window.__PAGE, ROUTES = window.__ROUTES, F = window.__F;
  var PHONE_MAX = 760;

  /* ------------------------------ language ------------------------------ */
  /* Traditional Chinese is the default; the login switch changes it and it is remembered. */
  var ZH = window.__ZH || {};
  var LANG = 'zh';
  try { LANG = localStorage.getItem('af-lang') || 'zh'; } catch (e) {}
  function setLang(l) { try { localStorage.setItem('af-lang', l); } catch (e) {} location.reload(); }
  var MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  var WD = { Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六', Sun: '日' };
  function has(k) { return Object.prototype.hasOwnProperty.call(ZH, k); }
  function rule(c) {
    var m;
    if ((m = c.match(/^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun) )?(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)( \d{4})?,?( \d{1,2}:\d{2})?$/)))
      return (m[4] ? m[4].trim() + ' 年 ' : '') + MON[m[3]] + ' 月 ' + m[2] + ' 日' + (m[1] ? '（' + WD[m[1]] + '）' : '') + (m[5] || '');
    if ((m = c.match(/^(\d+) (min|h|d) ago$/))) return m[1] + { min: ' 分鐘前', h: ' 小時前', d: ' 日前' }[m[2]];
    if ((m = c.match(/^(\d+) (min|h|d)$/))) return m[1] + { min: ' 分鐘', h: ' 小時', d: ' 日' }[m[2]];
    if ((m = c.match(/^([\d.,]+) s$/))) return m[1] + ' 秒';
    if ((m = c.match(/^Updated (.+)$/))) return '更新於 ' + (trCore(m[1]) || m[1]);
    if ((m = c.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/))) return MON[m[1]] + ' 月';
    if ((m = c.match(/^In (\d{2})$/))) return '用於 ' + m[1];
    if ((m = c.match(/^(\d+) (files|entries|people|scripts|projects|comments|docs|shots|versions|days|months|channels|videos|topics|beats|posts|drafts|clips|jobs)$/)))
      return m[1] + ' ' + { files: '個檔案', entries: '筆分錄', people: '人', scripts: '份劇本', projects: '個項目', comments: '則留言', docs: '份文件', shots: '個鏡頭', versions: '個版本', days: '日', months: '個月', channels: '個頻道', videos: '條影片', topics: '個題目', beats: '段', posts: '個帖子', drafts: '份草稿', clips: '個片段', jobs: '個工作' }[m[2]];
    if ((m = c.match(/^v(\d+) · (.+)$/))) { var t = trCore(m[2]); if (t) return 'v' + m[1] + ' · ' + t; }
    return null;
  }
  function trCore(c) {
    if (has(c)) return ZH[c];
    var r = rule(c); if (r != null) return r;
    if (c.indexOf(' · ') > 0) {
      var any = false, parts = c.split(' · ').map(function (p) { var t = has(p) ? ZH[p] : rule(p); if (t != null) { any = true; return t; } return p; });
      if (any) return parts.join(' · ');
    }
    return null;
  }
  function trText(s) {
    if (LANG !== 'zh' || !s || !/[A-Za-z]/.test(s)) return s;
    var m = s.match(/^(\s*)([\s\S]*?)(\s*)$/), core = m[2].replace(/\s+/g, ' ');
    var t = trCore(core);
    return t == null ? s : m[1] + t + m[3];
  }
  var TR_ATTRS = ['title', 'placeholder', 'alt', 'aria-label'];
  function trNode(node) {
    if (LANG !== 'zh') return;
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.nodeType === 3) { el.nodeValue = trText(el.nodeValue); continue; }
      if (el.nodeType !== 1 || el.tagName === 'STYLE' || el.tagName === 'SCRIPT') continue;
      for (var j = 0; j < TR_ATTRS.length; j++) if (el.hasAttribute(TR_ATTRS[j])) el.setAttribute(TR_ATTRS[j], trText(el.getAttribute(TR_ATTRS[j])));
      trNode(el.tagName === 'TEMPLATE' ? el.content : el);
    }
  }
  if (LANG === 'zh') document.documentElement.lang = 'zh-HK';


  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (p) {
    var next = typeof p === 'function' ? p(this.state, this.props) : p;
    for (var k in next) this.state[k] = next[k];
    render();
  };
  window.DCLogic = DCLogic;

  var root = document.getElementById('dc-root'), stage = document.getElementById('stage');
  var comp = null, variant = null, tpl = null;

  function lookup(vals, key) {
    key = key.trim();
    if (key === 'true') return true;
    if (key === 'false') return false;
    return key.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, vals);
  }
  /* tr: the value lands in visible text, so text the logic generates is translated too */
  function subst(str, vals, tr) {
    return str.replace(/\{\{([^}]*)\}\}/g, function (m, k) { var v = lookup(vals, k); if (v == null) return ''; v = String(v); return tr ? trText(v) : v; });
  }
  function process(node, vals) {
    var kids = Array.prototype.slice.call(node.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.nodeType === 3) { if (el.nodeValue.indexOf('{{') > -1) el.nodeValue = subst(el.nodeValue, vals, true); continue; }
      if (el.nodeType !== 1) continue;
      if (el.tagName === 'SC-IF') {
        var on = !!lookup(vals, (el.getAttribute('value') || '').replace(/[{}]/g, ''));
        if (!on) { el.parentNode.removeChild(el); continue; }
        process(el, vals);
        var parent = el.parentNode;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        continue;
      }
      /* read every value first: setting the cursor rewrites the style attribute before its holes are filled */
      var attrs = Array.prototype.map.call(el.attributes, function (a) { return [a.name, a.value]; });
      var hot = null;
      for (var j = 0; j < attrs.length; j++) {
        var an = attrs[j][0], av = attrs[j][1];
        if (an === 'hint-placeholder-val') { el.removeAttribute(an); continue; }
        if (av.indexOf('{{') < 0) continue;
        if (an === 'onclick') {
          var fn = lookup(vals, av.replace(/[{}]/g, ''));
          el.removeAttribute('onclick');
          if (typeof fn === 'function') hot = fn;
          continue;
        }
        el.setAttribute(an, subst(av, vals, TR_ATTRS.indexOf(an) > -1));
      }
      if (hot) {
        el.setAttribute('data-hot', '1');
        el.__dcClick = hot;
        (function (f) { el.addEventListener('click', function (e) { e.stopPropagation(); f(e); }); })(hot);
        el.style.cursor = 'pointer';
      }
      process(el, vals);
    }
  }

  function render() {
    var vals = comp.renderVals ? comp.renderVals() : {};
    var frag = tpl.content.cloneNode(true);
    process(frag, vals);
    /* a redraw (agent sheet, dock tap, toggles) keeps where you had scrolled to */
    var kept = Array.prototype.map.call(root.querySelectorAll('[data-scroll],[data-chips]'), function (e) { return [e.scrollTop, e.scrollLeft]; });
    root.innerHTML = '';
    root.appendChild(frag);
    var now = root.querySelectorAll('[data-scroll],[data-chips]');
    for (var s = 0; s < now.length && s < kept.length; s++) { now[s].scrollTop = kept[s][0]; now[s].scrollLeft = kept[s][1]; }
    fit();
    markNav();
    langSwitch();
    phoneNav();
  }

  /* phone dock: an icon shows its name, then opens its module; rows in the More card open theirs */
  var DOCKMOD = { chat: 'chat', files: 'files', res: 'research', script: 'script', video: 'video', pub: 'publish', acc: 'accounting', fin: 'finance', legal: 'legal', hr: 'hr', admin: 'admin' };
  function phoneNav() {
    var els = root.querySelectorAll('[data-mod]');
    for (var i = 0; i < els.length; i++) (function (el) {
      var path = home[DOCKMOD[el.getAttribute('data-mod')]];
      if (!path) return;
      if (el.classList.contains('mdi')) el.addEventListener('click', function () { if (path !== location.pathname) setTimeout(function () { go(path); }, 160); });
      else { el.setAttribute('data-nav', path); el.style.cursor = 'pointer'; }
    })(els[i]);
  }

  /* the login's 繁體中文 / English switch, and the EN pill in chat, change the language */
  function langSwitch() {
    var zh = null, en = null, spans = root.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var t = spans[i].textContent.trim();
      if (t === '繁體中文') zh = spans[i]; else if (t === 'English') en = spans[i];
    }
    if (zh && en && zh.parentNode === en.parentNode) {
      if (LANG !== 'zh') { var onStyle = zh.getAttribute('style'); zh.setAttribute('style', en.getAttribute('style')); en.setAttribute('style', onStyle); }
      [[zh, 'zh'], [en, 'en']].forEach(function (p) {
        if (p[1] === LANG) return;
        p[0].style.cursor = 'pointer'; p[0].setAttribute('data-hot', '1');
        p[0].addEventListener('click', function (e) { e.stopPropagation(); setLang(p[1]); });
      });
    }
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) {
      if (n.nodeValue.trim() !== 'EN' || !n.parentElement) continue;
      var pill = n.parentElement;
      n.nodeValue = LANG === 'zh' ? '中' : 'EN';
      pill.style.cursor = 'pointer'; pill.setAttribute('data-hot', '1'); pill.title = LANG === 'zh' ? 'Switch to English' : '切換至繁體中文';
      pill.addEventListener('click', function (e) { e.stopPropagation(); setLang(LANG === 'zh' ? 'en' : 'zh'); });
    }
  }

  /* phones (760 px and under) get the phone design, everything else the desktop one */
  function pick() { return window.innerWidth <= PHONE_MAX && PAGE.phone ? 'phone' : 'desktop'; }
  /* scale to fit, then stretch the screen to fill the window: no bars, nothing cut */
  function fit() {
    var v = PAGE[variant], w = v.w, h = v.h;
    var z = Math.min(window.innerWidth / w, window.innerHeight / h);
    var W = Math.ceil(window.innerWidth / z), H = Math.ceil(window.innerHeight / z);
    stage.style.width = W + 'px'; stage.style.height = H + 'px';
    stage.style.zoom = z;
    var r = root.firstElementChild;
    if (r) { r.style.width = W + 'px'; r.style.height = H + 'px'; }
  }
  function mount() {
    variant = pick();
    var v = PAGE[variant];
    document.getElementById('css-desktop') && (document.getElementById('css-desktop').media = variant === 'desktop' ? 'all' : 'not all');
    document.getElementById('css-phone') && (document.getElementById('css-phone').media = variant === 'phone' ? 'all' : 'not all');
    tpl = document.createElement('template');
    tpl.innerHTML = v.html;
    trNode(tpl.content);
    var Cls = F[variant]();
    comp = new Cls(v.props);
    if (!comp.state) comp.state = {};
    render(); fit();
    if (typeof comp.componentDidMount === 'function') setTimeout(function () { comp.componentDidMount(); }, 0);
  }
  window.addEventListener('resize', function () { if (pick() !== variant) mount(); else fit(); });

  /* ------------------------------ navigation ------------------------------ */
  var MODS = ['chat', 'files', 'research', 'script', 'video', 'publish', 'accounting', 'finance', 'legal', 'hr', 'admin'];
  var home = {}, byLabel = {}, global = {};
  ROUTES.forEach(function (r) {
    if (!home[r.module]) home[r.module] = r.path;
    /* each label also in Chinese, so clicks still find their page when the screen is translated */
    function both(ls) { return (ls || []).reduce(function (a, l) { a.push(l); var t = trText(l.replace(/&amp;/g, '&')); if (t !== l) a.push(t); return a; }, []); }
    both(r.labels).forEach(function (l) { (byLabel[r.module] = byLabel[r.module] || {})[norm(l)] = r.path; });
    both(r.global).forEach(function (l) { global[norm(l)] = r.path; });
  });
  function norm(t) { return String(t).replace(/\s+/g, ' ').replace(/[•]/g, '').replace(/\s\d+$/, '').trim().toLowerCase(); }
  function go(path) { if (path && path !== location.pathname) location.href = path; }
  function find(label) {
    var n = norm(label);
    return (byLabel[PAGE.module] && byLabel[PAGE.module][n]) || global[n] || null;
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (sheetEl && sheetEl.contains(t)) return;
    var rail = t.closest('.r');
    if (rail && rail.parentNode) {
      var rs = Array.prototype.filter.call(rail.parentNode.children, function (x) { return x.classList && x.classList.contains('r'); });
      var i = rs.indexOf(rail); if (i > -1 && MODS[i]) return go(home[MODS[i]]);
    }
    var ico = t.closest('.ico');
    if (ico && ico.querySelector('path') && /m14\.5 5\.5-7 6\.5 7 6\.5/.test(ico.innerHTML)) {
      return history.length > 1 ? history.back() : go(home[PAGE.module]);
    }
    var nav = t.closest('[data-nav]');
    if (nav) { e.preventDefault(); return go(nav.getAttribute('data-nav')); }
    /* clicked something that does nothing: show what does, like a Figma prototype */
    if (!t.closest('[data-hot]')) flashHints();
  });

  /* phone "More" tab: module sheet */
  var sheetEl = null;
  var MODNAMES = { chat: 'Chat', files: 'Database', research: 'Market Research', script: 'Script', video: 'Video Edit', publish: 'Publish', accounting: 'Accounting', finance: 'Finance', legal: 'Legal', hr: 'Human Resources', admin: 'Admin' };
  function openSheet() {
    if (sheetEl) return closeSheet();
    sheetEl = document.createElement('div');
    sheetEl.style.cssText = 'position:absolute;inset:0;z-index:50;background:rgba(23,23,23,.28);display:flex;align-items:flex-end;';
    var panel = '<div style="width:100%;background:#fff;border-radius:22px 22px 0 0;padding:10px 0 34px;box-shadow:0 -8px 32px rgba(23,23,23,.16);font-family:Inter,system-ui,sans-serif;">' +
      '<div style="display:flex;justify-content:center;padding-bottom:10px;"><div style="width:38px;height:4px;border-radius:2px;background:#e2e2e2;"></div></div>' +
      '<div style="font-size:15px;font-weight:500;padding:4px 20px 10px;">' + trText('All modules') + '</div>' +
      MODS.map(function (m) { return '<div data-go="' + home[m] + '" style="display:flex;align-items:center;height:50px;padding:0 20px;font-size:15.5px;color:' + (m === PAGE.module ? '#007be0' : '#171717') + ';border-top:1px solid #f3f3f3;cursor:pointer;">' + trText(MODNAMES[m]) + '</div>'; }).join('') + '</div>';
    sheetEl.innerHTML = panel;
    sheetEl.addEventListener('click', function (e) { var g = e.target.closest('[data-go]'); if (g) go(g.getAttribute('data-go')); else closeSheet(); });
    stage.appendChild(sheetEl);
  }
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } }

  /* tag everything that navigates, so it gets a pointer and shows in hints */
  /* the whole card or row is the target, not just its title */
  var NAVCLS = ['n', 'tb', 'chip', 'ctab', 'sn', 'ic', 'btn', 'bp', 'bs', 'ibtn', 'fc', 'rtab', 'row', 'mi', 'card', 'tr', 'ptile'];
  function markNav() {
    var els = root.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hasAttribute('data-hot')) continue;
      var t = el.textContent;
      if (!t || t.length > 80) continue;
      var p = find(t);
      /* a link to the page you are already on does nothing, so it is not clickable */
      if (!p || p === location.pathname) continue;
      var target = el;
      for (var up = el, d = 0; up && up !== root && d < 4; up = up.parentElement, d++) {
        if (NAVCLS.some(function (c) { return up.classList.contains(c); })) { target = up; break; }
      }
      if (!target.hasAttribute('data-nav')) { target.setAttribute('data-nav', p); target.style.cursor = 'pointer'; }
    }
    var rt = root.querySelectorAll('.r, .tab');
    for (var j = 0; j < rt.length; j++) rt[j].style.cursor = 'pointer';
  }

  /* dry run a click: if the screen would come out identical (the option already picked), it is not a hint */
  function htmlFor(state) {
    var saved = comp.state; comp.state = state;
    var vals; try { vals = comp.renderVals ? comp.renderVals() : {}; } finally { comp.state = saved; }
    var frag = tpl.content.cloneNode(true); process(frag, vals);
    var d = document.createElement('div'); d.appendChild(frag); return d.innerHTML;
  }
  function wouldDoNothing(f, now) {
    var saved = comp.setState, next = null;
    comp.setState = function (p) { next = Object.assign({}, comp.state, typeof p === 'function' ? p(comp.state, comp.props) : p); };
    try { f({ stopPropagation: function () {}, preventDefault: function () {} }); } catch (e) { next = null; }
    comp.setState = saved;
    if (!next) return false;
    return htmlFor(next) === now;
  }

  var hintLayer = null, hintTimer = null;
  function flashHints() {
    if (hintLayer) hintLayer.remove();
    hintLayer = document.createElement('div');
    hintLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
    var vw = window.innerWidth, vh = window.innerHeight;
    var hs = root.querySelectorAll('[data-nav],[data-hot],.r,.tab');
    var now = null;
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].__dcClick) { if (now === null) now = htmlFor(comp.state); if (wouldDoNothing(hs[i].__dcClick, now)) continue; }
      var b = hs[i].getBoundingClientRect();
      if (!b.width || !b.height || b.bottom < 0 || b.top > vh || b.width * b.height > vw * vh * 0.2) continue;
      var d = document.createElement('div');
      d.style.cssText = 'position:absolute;box-sizing:border-box;border-radius:6px;border:2px solid rgba(0,123,224,.85);background:rgba(0,123,224,.10);' +
        'left:' + (b.left - 2) + 'px;top:' + (b.top - 2) + 'px;width:' + (b.width + 4) + 'px;height:' + (b.height + 4) + 'px;';
      hintLayer.appendChild(d);
    }
    document.body.appendChild(hintLayer);
    if (hintLayer.animate) hintLayer.animate([{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration: 1100, easing: 'ease-out' });
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { if (hintLayer) { hintLayer.remove(); hintLayer = null; } }, 1100);
  }

  document.title = trText(PAGE.title) + ' · Aura Farmers';
  mount();
})();
