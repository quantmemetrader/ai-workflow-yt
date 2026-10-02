"use client";

import * as React from "react";

/**
 * Everything on screen stays Simplified (the owner, 2 Oct: 谢总 kept seeing
 * 「峕長」「初藁」「參攷」, then 「導入文檔」「艸藁」「棠訪藁」 on the script page,
 * and "make sure the text is correct for everyone").
 *
 * The page already says translate="no". If anything rewrites our text anyway
 * (a translator that ignores it, a 繁简 extension, a system setting), this
 * puts it back, two ways:
 *
 *   1. From memory. `lib/client/boot.ts` records every text node's words the
 *      moment the browser inserts them, before any extension has run; React's
 *      own updates refresh that record here. When a node later holds text
 *      with Traditional or variant characters, the recorded words come back
 *      exactly: 「棠訪藁」 is 「范例稿」 again, not a guess.
 *   2. By table, for text nobody recorded (converted before the page booted,
 *      or typed): Traditional → Simplified plus the odd variants converters
 *      produce.
 *
 * It never gives up. A converter that fights back is met every time, slower
 * each round for that node (never more than every 4 s), and the person is
 * told, once, which kind of tool is doing it and how to turn it off. Editors
 * (contenteditable), inputs and code are left alone: what a person types is
 * theirs. The conversion table loads only when a converted character is
 * actually seen, so a normal page pays nothing.
 */

/* Odd forms some converters produce that a Traditional→Simplified table does not cover. */
const VARIANTS: Record<string, string> = { 峕: "时", 旹: "时", 藁: "稿", 稾: "稿", 攷: "考", 乹: "干", 仝: "同", 艸: "草", 妳: "你", 衹: "只", 焒: "照", 爲: "为", 裏: "里", 囬: "回", 衆: "众", 淸: "清", 靑: "青", 眞: "真", 敎: "教", 旣: "既", 卽: "即", 㑹: "会", 㸃: "点", 呌: "叫", 呑: "吞", 絶: "绝", 説: "说", 閲: "阅", 鍾: "钟", 産: "产", 戸: "户", 竒: "奇", 冐: "冒", 黄: "黄", 徳: "德", 兎: "兔", 鷄: "鸡", 彔: "录", 讀: "读", 寫: "写", 體: "体", 聼: "听" };
const VARIANT_RE = new RegExp(`[${Object.keys(VARIANTS).join("")}]`, "g");
/* A cheap first look: common characters that only appear once something converted the page. */
const TELLS = /[們這個為會說時對來過與還國後點開關發現寫參資讓審閱檔裡選題視頻編劇頁級從個麼們應該態識號務設計員項腳標記錄還沒導鏈誰擴畫鍾刪絶説閲長風條試驗業產戶際裝備範圍預備歷歸類總結經濟網絡電話間題釋將際見聽講讀書買賣車馬鳥島飛龍歡慶禮議訓練辦險權變於幾動術節權義紀録學習較較語單幾個級隊師獨門驚峕旹藁稾攷乹仝艸妳衹焒爲裏囬衆淸靑眞敎旣卽㑹㸃呌呑産戸竒冐徳兎鷄彔體聼]/;
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE", "NOSCRIPT"]);

type Orig = WeakMap<Node, string>;
declare global {
  interface Window {
    __zhOrig?: Orig;
    __zhOrigStop?: () => void;
  }
}

export function SimplifiedGuard() {
  React.useEffect(() => {
    let convert: ((s: string) => string) | null = null;
    let loading: Promise<void> | null = null;
    let reported = false;
    let warned = false;
    const fights = new WeakMap<Node, number>();
    const nextAt = new WeakMap<Node, number>();
    const queued = new WeakSet<Node>();
    /* The words each text node was given by React (or by the server), kept
       from the moment it appeared. The boot script started this record. */
    const orig: Orig = window.__zhOrig ?? new WeakMap<Node, string>();
    window.__zhOrig = orig;

    const fixVariants = (s: string) => s.replace(VARIANT_RE, (c) => VARIANTS[c] ?? c);
    const looksOff = (s: string) => TELLS.test(s) || VARIANT_RE.test(s);
    const skip = (el: Element | null): boolean => {
      for (let e = el; e; e = e.parentElement) {
        if (SKIP.has(e.tagName) || (e as HTMLElement).isContentEditable || e.hasAttribute("data-keep-traditional")) return true;
      }
      return false;
    };

    const warn = (how: string) => {
      if (warned) return;
      warned = true;
      try {
        if (sessionStorage.getItem("tg:zh-warned")) return;
        sessionStorage.setItem("tg:zh-warned", "1");
      } catch {
        /* a private window: warn anyway */
      }
      const d = document.createElement("div");
      d.setAttribute("translate", "no");
      d.className = "notranslate";
      d.setAttribute("role", "status");
      d.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;max-width:min(560px,calc(100vw - 24px));display:flex;gap:12px;align-items:flex-start;background:#fff7e6;border:1px solid #f0c36d;color:#6b4a07;border-radius:12px;padding:12px 14px;font:13px/1.6 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.12)";
      const s = document.createElement("span");
      s.style.flexGrow = "1";
      s.textContent = `你的浏览器里有工具在把页面改成繁体或异体字（${how}），网站已经自动改回简体。要彻底解决：点地址栏右边的拼图图标 › 管理扩展程序，关掉繁简转换类插件，或把 tengya.media 设为不转换。`;
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "知道了";
      x.style.cssText = "flex:0 0 auto;border:1px solid #d9b25c;background:#fff;color:#6b4a07;border-radius:8px;padding:4px 10px;font:inherit;cursor:pointer";
      x.onclick = () => d.remove();
      d.appendChild(s);
      d.appendChild(x);
      (document.body || document.documentElement).appendChild(d);
    };

    const report = (from: string, to: string) => {
      if (reported) return;
      reported = true;
      try {
        const b = JSON.stringify({ kind: "zh-fixed", message: `${from.slice(0, 40)} → ${to.slice(0, 40)}`, stack: navigator.userAgent.slice(0, 160), digest: "", url: location.pathname });
        navigator.sendBeacon?.("/api/client-error", new Blob([b], { type: "application/json" }));
      } catch {
        /* reporting is best effort */
      }
    };

    /** The clean words for a node: what it was given, else the table's best. */
    const cleanFor = (n: Text, v: string): string => {
      const kept = orig.get(n);
      if (kept && !looksOff(kept)) return kept;
      return convert ? fixVariants(convert(v)) : fixVariants(v);
    };

    const fixNode = (n: Text) => {
      const v = n.nodeValue;
      if (!v || !looksOff(v)) {
        /* Clean text is the record for next time: React's own updates land here too. */
        if (v && !skip(n.parentElement)) orig.set(n, v);
        return;
      }
      if (skip(n.parentElement)) return;
      const now = Date.now();
      const due = nextAt.get(n) ?? 0;
      if (due > now) {
        /* Backing off: the fix is still coming, when the wait is over. */
        if (!queued.has(n)) {
          queued.add(n);
          window.setTimeout(() => {
            queued.delete(n);
            if (n.isConnected) fixNode(n);
          }, due - now + 20);
        }
        return;
      }
      const next = cleanFor(n, v);
      if (next === v) return;
      const round = (fights.get(n) ?? 0) + 1;
      fights.set(n, round);
      /* Something keeps rewriting this node: still put it back, just not more
         than every few seconds, and say so once. */
      if (round > 3) {
        nextAt.set(n, now + Math.min(4000, 500 * 2 ** (round - 3)));
        warn("每次改回去，它又改回来");
      }
      n.nodeValue = next;
      report(v, next);
    };
    const fixAttrs = (el: Element) => {
      for (const a of ["placeholder", "title", "aria-label"]) {
        const v = el.getAttribute(a);
        if (v && looksOff(v)) {
          const next = convert ? fixVariants(convert(v)) : fixVariants(v);
          if (next !== v) el.setAttribute(a, next);
        }
      }
    };
    const sweep = (root: Node) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let n: Node | null = w.currentNode;
      let k = 0;
      while (n && k < 20000) {
        k++;
        if (n.nodeType === 3) fixNode(n as Text);
        else if (n.nodeType === 1) fixAttrs(n as Element);
        n = w.nextNode();
      }
    };
    const ensure = () => {
      if (convert) return Promise.resolve();
      if (!loading)
        loading = import("@/lib/text/simplified").then((m) => {
          convert = m.toSimplified;
        });
      return loading;
    };
    const looksConverted = (root: Node) => looksOff((root as HTMLElement).innerText ?? root.textContent ?? "");

    /* First look after the page settles, then whenever the page changes. */
    let pending: Node[] = [];
    let timer: number | null = null;
    const flush = () => {
      timer = null;
      const batch = pending;
      pending = [];
      const off = batch.some((n) => (n.nodeType === 3 ? looksOff(n.nodeValue ?? "") : looksConverted(n)));
      if (!off) {
        /* Fresh clean text from React: remember it. */
        batch.forEach((n) => (n.isConnected ? (n.nodeType === 3 ? fixNode(n as Text) : sweep(n)) : null));
        return;
      }
      void ensure().then(() => batch.forEach((n) => (n.isConnected ? (n.nodeType === 3 ? fixNode(n as Text) : sweep(n)) : null)));
    };
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData") pending.push(r.target);
        else r.addedNodes.forEach((n) => pending.push(n));
      }
      if (pending.length && timer === null) timer = window.setTimeout(flush, 120);
    });
    const start = window.setTimeout(() => {
      /* The boot script's early watch ends here; this one takes over. */
      window.__zhOrigStop?.();
      if (looksConverted(document.body)) void ensure().then(() => sweep(document.body));
      else sweep(document.body);
      obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    }, 600);
    /* Some converters run late and only once: look again a few times. */
    const again = [2500, 6000, 15000, 40000].map((ms) => window.setTimeout(() => (looksConverted(document.body) ? void ensure().then(() => sweep(document.body)) : null), ms));
    return () => {
      window.clearTimeout(start);
      again.forEach((t) => window.clearTimeout(t));
      if (timer) window.clearTimeout(timer);
      obs.disconnect();
    };
  }, []);
  return null;
}
