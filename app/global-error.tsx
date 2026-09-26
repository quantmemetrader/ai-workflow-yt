"use client";

import { useEffect } from "react";

/**
 * The last line of defence, when even the app's own shell failed.
 *
 * Without this file Next shows its bare "This page couldn't load · Reload to
 * try again, or go back", which is what the studio kept seeing. The usual
 * cause is a tab from before a deploy, which one reload fixes, so this
 * reloads once by itself (the boot script in app/layout.tsx keeps it to once
 * per 30 s) and otherwise says plainly what to do, in both languages.
 */
declare global {
  interface Window {
    __aura?: { report: (kind: string, msg: string, stack?: string, digest?: string) => void; stale: (m: string) => boolean; reloadOnce: () => boolean };
  }
}

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    window.__aura?.report("global", error?.message ?? "", error?.stack, error?.digest);
    window.__aura?.reloadOnce();
  }, [error]);

  return (
    <html lang="zh-Hans-CN">
      <body style={{ margin: 0, fontFamily: "Inter, 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif", background: "#fafaf9", color: "#171717" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 420, background: "#fff", border: "1px solid #ececec", borderRadius: 14, padding: "22px 24px" }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>页面需要重新加载</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "#525252", marginTop: 2 }}>This page needs a reload</div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "#525252", margin: "10px 0 0" }}>
              多半是网站刚更新过，这个标签页还停在旧版本。重新加载一次就好，你的内容都在。
            </p>
            <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "#7c7c7c", margin: "6px 0 0" }}>
              Usually the site was just updated while this tab was open. One reload fixes it; nothing was lost.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => location.reload()}
                style={{ height: 32, padding: "0 14px", borderRadius: 8, border: 0, background: "#171717", color: "#fff", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer" }}
              >
                重新加载 · Reload
              </button>
              <a href="/home" style={{ height: 32, padding: "0 14px", borderRadius: 8, border: "1px solid #e2e2e2", color: "#525252", fontSize: 13, lineHeight: "32px", textDecoration: "none" }}>
                回首页 · Home
              </a>
            </div>
            {error?.digest ? <p style={{ fontSize: 11, color: "#c7c7c7", marginTop: 14, fontFamily: "ui-monospace, monospace" }}>{error.digest}</p> : null}
          </div>
        </div>
      </body>
    </html>
  );
}
