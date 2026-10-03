"use client";

import * as React from "react";

/**
 * The wheel scrolls the page wherever the pointer is.
 *
 * A 选题 page is a column that scrolls by itself (`PageBody`) beside the
 * 研究员 panel and under the tab bar; the document does not scroll. A wheel
 * over the panel or the tabs therefore moved nothing (QA, 3 Oct — likely the
 * client's "cannot scroll"). Here a wheel that nothing under the pointer can
 * take is handed to the page's own scroller. Anything that can scroll itself
 * (the panel's thread, a list) keeps its wheel, and a modal keeps its own.
 */
export function WheelToPage({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.deltaY === 0) return;
    const root = e.currentTarget;
    const page = root.querySelector<HTMLElement>("[data-page-scroll]");
    if (!page) return;
    for (let el = e.target as HTMLElement | null; el && el !== root; el = el.parentElement) {
      if (el === page || el.getAttribute("aria-modal") === "true") return;
      const oy = window.getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) {
        const down = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
        const up = el.scrollTop > 0;
        if ((e.deltaY > 0 && down) || (e.deltaY < 0 && up)) return;
      }
    }
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page.clientHeight : 1;
    page.scrollBy({ top: e.deltaY * unit });
  };
  return (
    <div onWheel={onWheel} style={style}>
      {children}
    </div>
  );
}
