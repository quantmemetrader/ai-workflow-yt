"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The top of 发布: 发布 (connect the accounts, post, approve) and 账号数据
 * (how the studio's accounts and each post are doing). The numbers come after
 * the posting, so they live under it rather than as a rail entry of their own
 * (the owner, 29 Sep: "the account data page should be under the publish page").
 *
 * Someone without the publish module sees only 账号数据, and keeps it in the
 * rail as 数据 (`lib/nav.ts`).
 */
const TABS = [
  { href: "/publish", zh: "发布", en: "Publish", needs: true },
  { href: "/review", zh: "账号数据", en: "Account data", needs: false },
] as const;

export function PublishTabs({ zh, canPublish }: { zh: boolean; canPublish: boolean }) {
  const pathname = usePathname() ?? "/publish";
  const tabs = TABS.filter((t) => canPublish || !t.needs);
  return (
    <div style={{ flexShrink: 0, background: "rgba(250,250,248,.92)", borderBottom: "1px solid #e7e6e2" }}>
      <style>{TAB_CSS}</style>
      <div style={{ padding: "14px 32px 0", maxWidth: 1440 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#171717" }}>{zh ? "发布" : "Publish"}</h1>
          <span style={{ fontSize: 13, color: "#8a8a8a" }}>{zh ? "发出去，再看数据" : "Post it, then watch the numbers"}</span>
        </div>
        <nav aria-label={zh ? "发布页面" : "Publish pages"} style={{ display: "flex", gap: 2, marginTop: 8 }}>
          {tabs.map((t) => {
            const on = pathname === t.href || pathname.startsWith(`${t.href}/`);
            return (
              <Link key={t.href} href={t.href} prefetch={false} className="pt-tab" data-on={on ? "1" : undefined} aria-current={on ? "page" : undefined}>
                {zh ? t.zh : t.en}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

const TAB_CSS = `
.pt-tab { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 14px; font-size: 14px; color: #6b6b6b; text-decoration: none; border-bottom: 2px solid transparent; white-space: nowrap; transition: color .15s ease, border-color .15s ease; }
.pt-tab:hover { color: #171717; }
.pt-tab[data-on] { color: #171717; font-weight: 600; border-bottom-color: #171717; }
`;
