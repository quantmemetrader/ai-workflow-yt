"use client";

import * as React from "react";

/**
 * Everything on screen stays Simplified (the owner, 2 Oct: 谢总 kept seeing
 * 「峕長」「初藁」「參攷」 and "make sure the text is correct for everyone").
 *
 * The page already says translate="no". If anything rewrites our text anyway
 * (a translator that ignores it, a 繁简 extension, a system setting), this
 * puts it back: it watches the page and turns any Traditional or odd variant
 * character back into Simplified. Editors (contenteditable), inputs and code
 * are left alone. The conversion table loads only when a converted character
 * is actually seen, so a normal page pays nothing.
 */

/* Odd forms some converters produce that a Traditional→Simplified table does not cover. */
const VARIANTS: Record<string, string> = { 峕: "时", 旹: "时", 藁: "稿", 稾: "稿", 攷: "考", 乹: "干", 仝: "同", 艸: "草", 妳: "你", 衹: "只", 焒: "照", 爲: "为", 裏: "里", 囬: "回", 衆: "众", 淸: "清", 靑: "青", 眞: "真", 敎: "教", 旣: "既", 卽: "即", 㑹: "会", 㸃: "点", 呌: "叫", 呑: "吞" };
/* A cheap first look: common characters that only appear once something converted the page. */
const TELLS = /[們這個為會說時對來過與還國後點開關發現寫參資讓審閱檔裡選題視頻編劇頁級從個麼們應該態識號務設計員項腳標記錄還沒峕藁稾攷乹仝艸妳衹焒]/;
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE", "NOSCRIPT"]);

export function SimplifiedGuard() {
  React.useEffect(() => {
    let convert: ((s: string) => string) | null = null;
    let loading: Promise<void> | null = null;
    let reported = false;
    const touched = new WeakMap<Node, number>();

    const fixVariants = (s: string) => s.replace(/[峕旹藁稾攷乹仝艸妳衹焒爲裏囬衆淸靑眞敎旣卽㑹㸃呌呑]/g, (c) => VARIANTS[c] ?? c);
    const skip = (el: Element | null): boolean => {
      for (let e = el; e; e = e.parentElement) {
        if (SKIP.has(e.tagName) || (e as HTMLElement).isContentEditable || e.hasAttribute("data-keep-traditional")) return true;
      }
      return false;
    };
    const fixNode = (n: Text) => {
      const v = n.nodeValue;
      if (!v || !TELLS.test(v) || !convert) return;
      if (skip(n.parentElement)) return;
      const count = touched.get(n) ?? 0;
      if (count > 4) return; // something keeps fighting us on this node; leave it
      const next = fixVariants(convert(v));
      if (next !== v) {
        touched.set(n, count + 1);
        n.nodeValue = next;
        if (!reported) {
          reported = true;
          try {
            const b = JSON.stringify({ kind: "zh-fixed", message: `${v.slice(0, 40)} → ${next.slice(0, 40)}`, stack: navigator.userAgent.slice(0, 160), digest: "", url: location.pathname });
            navigator.sendBeacon?.("/api/client-error", new Blob([b], { type: "application/json" }));
          } catch {
            /* reporting is best effort */
          }
        }
      }
    };
    const fixAttrs = (el: Element) => {
      if (!convert) return;
      for (const a of ["placeholder", "title", "aria-label"]) {
        const v = el.getAttribute(a);
        if (v && TELLS.test(v)) {
          const next = fixVariants(convert(v));
          if (next !== v) el.setAttribute(a, next);
        }
      }
    };
    const sweep = (root: Node) => {
      if (!convert) return;
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
    const looksConverted = (root: Node) => TELLS.test((root as HTMLElement).innerText ?? root.textContent ?? "");

    /* First look after the page settles, then whenever the page changes. */
    let pending: Node[] = [];
    let timer: number | null = null;
    const flush = () => {
      timer = null;
      const batch = pending;
      pending = [];
      if (!batch.some(looksConverted)) return;
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
      if (looksConverted(document.body)) void ensure().then(() => sweep(document.body));
      obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    }, 600);
    /* Some converters run late and only once: look again a few times. */
    const again = [2500, 6000, 15000].map((ms) => window.setTimeout(() => (looksConverted(document.body) ? void ensure().then(() => sweep(document.body)) : null), ms));
    return () => {
      window.clearTimeout(start);
      again.forEach((t) => window.clearTimeout(t));
      if (timer) window.clearTimeout(timer);
      obs.disconnect();
    };
  }, []);
  return null;
}
