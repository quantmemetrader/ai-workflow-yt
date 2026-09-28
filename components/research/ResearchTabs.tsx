"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The top of every 选题 page: its name, the one question it answers, and
 * three tabs — 推荐 (what to make today), 热点榜 (what is hot on each
 * platform) and 我的储备 (topics kept for later).
 *
 * It replaced the module's own left column (趋势面板 / 搜索与对比 / 评论收件箱
 * / 选题储备 and a sources fold): four screens and a fifth column of chrome
 * for a page whose question is one — "今天拍什么？" (28 Sep, "make it for
 * non-technical people"). The search and the comment inbox still have their
 * pages; they are reached from 推荐 and from 数据, not from a tab.
 */
const TABS = [
  { href: "/research", zh: "推荐", en: "Picks" },
  { href: "/research/hot", zh: "热点榜", en: "Hot now" },
  { href: "/research/backlog", zh: "我的储备", en: "Saved" },
] as const;

export function ResearchTabs({ zh, savedCount }: { zh: boolean; savedCount?: number }) {
  const pathname = usePathname() ?? "/research";
  return (
    <div style={{ flexShrink: 0, background: "rgba(250,250,248,.92)", borderBottom: "1px solid #e7e6e2" }}>
      <style>{TAB_CSS}</style>
      <div style={{ padding: "14px 32px 0", maxWidth: 1440 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#171717" }}>{zh ? "选题" : "Topics"}</h1>
          <span style={{ fontSize: 13, color: "#8a8a8a" }}>{zh ? "今天拍什么？" : "What should we make today?"}</span>
        </div>
        <nav aria-label={zh ? "选题页面" : "Topic pages"} style={{ display: "flex", gap: 2, marginTop: 8 }}>
          {TABS.map((t) => {
            const on = t.href === "/research" ? pathname === "/research" : pathname.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} prefetch={false} className="rt-tab" data-on={on ? "1" : undefined} aria-current={on ? "page" : undefined}>
                {zh ? t.zh : t.en}
                {t.href === "/research/backlog" && savedCount ? <span className="rt-n">{savedCount}</span> : null}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

const TAB_CSS = `
.rt-tab { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 14px; font-size: 14px; color: #6b6b6b; text-decoration: none; border-bottom: 2px solid transparent; white-space: nowrap; transition: color .15s ease, border-color .15s ease; }
.rt-tab:hover { color: #171717; }
.rt-tab[data-on] { color: #171717; font-weight: 600; border-bottom-color: #171717; }
.rt-n { font-size: 11px; font-weight: 600; color: #525252; background: #ececea; border-radius: 99px; padding: 0 7px; line-height: 18px; }
`;
