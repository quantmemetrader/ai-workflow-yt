"use client";

import { useEffect } from "react";

/**
 * What a person sees when a page throws.
 *
 * Without this they get Next's own error page: a bare "Application error" with
 * no way back and nothing that tells them whether it was their fault. The
 * common cause here is a lost connection to a database on the other side of
 * the world, which is nobody's fault and usually gone by the next attempt — so
 * the honest thing to offer is "try again", not an apology that implies data
 * was lost.
 *
 * The digest is shown because it is the one string that ties what they saw to
 * a line in `pm2 logs aura`.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] render failed", error);
  }, [error]);

  return (
    <div
      style={{
        flexGrow: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#171717" }}>这一页没能加载</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#171717", marginTop: 2 }}>
          This page didn’t load
        </div>

        <p style={{ fontSize: 13, lineHeight: 1.6, color: "#525252", marginTop: 10 }}>
          通常是与数据库的连接暂时中断，重试一次一般就好。你的数据没有丢失。
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "#7c7c7c", marginTop: 6 }}>
          Usually a dropped connection to the database, and usually gone on a second attempt.
          Nothing was lost.
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={reset}
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 8,
              border: 0,
              background: "#171717",
              color: "#fff",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            重试 · Try again
          </button>
          <a
            href="/chat"
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 8,
              border: "1px solid #ededed",
              color: "#525252",
              fontSize: 13,
              lineHeight: "32px",
              textDecoration: "none",
            }}
          >
            返回 · Back to chat
          </a>
        </div>

        {error.digest && (
          <p style={{ fontSize: 11, color: "#c7c7c7", marginTop: 14, fontFamily: "ui-monospace, monospace" }}>
            {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
