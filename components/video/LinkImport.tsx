"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/client/notify";
import { linkStatesAction, queueLinksAction } from "@/app/(app)/video/link-actions";

type Row = { jobId: string; url: string; label: string; state: "queued" | "running" | "done" | "failed"; progress: number; error: string | null; title?: string };

/**
 * 从链接导入视频 (7 Oct: "skills and connectors to get the video source online,
 * so editing is more automated"). Paste one link or several: each is fetched
 * on the worker as the original file, into this project's 素材 and, where
 * there is a cut, its bin. The rows say where each one stands.
 */
export function LinkImport({ projectId, zh, compact = false }: { projectId: string; zh: boolean; compact?: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>([]);
  const live = rows.some((r) => r.state === "queued" || r.state === "running");

  React.useEffect(() => {
    if (!live) return;
    const tick = window.setInterval(async () => {
      const r = (await linkStatesAction(rows.map((x) => x.jobId)).catch(() => null)) as { states?: { jobId: string; state: Row["state"]; progress: number; error: string | null; result: { title?: string } | null }[] } | null;
      if (!r?.states) return;
      let landed = false;
      setRows((cur) =>
        cur.map((x) => {
          const s = r.states!.find((y) => y.jobId === x.jobId);
          if (!s) return x;
          if (s.state === "done" && x.state !== "done") landed = true;
          return { ...x, state: s.state, progress: s.progress, error: s.error, title: s.result?.title ?? x.title };
        }),
      );
      if (landed) router.refresh();
    }, 2500);
    return () => window.clearInterval(tick);
  }, [live, rows, router]);

  const go = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = (await queueLinksAction(projectId, text)) as { error?: string; queued?: { jobId: string; url: string; label: string }[] };
      if (r.error) return notify(r.error);
      setRows((cur) => [...(r.queued ?? []).map((q) => ({ ...q, state: "queued" as const, progress: 0, error: null })), ...cur.filter((x) => !(r.queued ?? []).some((q) => q.jobId === x.jobId))].slice(0, 12));
      setText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="li">
      <style>{CSS}</style>
      {!compact ? <div className="li-title">{t("从链接导入视频", "Import a video from a link")}</div> : null}
      <div className="li-row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void go()}
          placeholder={t("粘贴 Instagram、抖音、小红书、TikTok、YouTube、微博、视频号 或 B站 的视频链接，可以一次贴多个", "Paste Instagram, Douyin, Xiaohongshu, TikTok, YouTube, Weibo, WeChat Channels or Bilibili links; several at once is fine")}
          aria-label={t("视频链接", "Video links")}
        />
        <button type="button" disabled={busy || !text.trim()} onClick={() => void go()}>
          {busy ? t("加入中…", "Adding…") : t("导入", "Import")}
        </button>
      </div>
      {rows.length ? (
        <div className="li-list">
          {rows.map((r) => (
            <div key={r.jobId} className="li-item">
              <span className="li-plat">{r.label}</span>
              <span className="li-name" title={r.url}>{r.title || r.url}</span>
              {r.state === "failed" ? (
                <span className="li-err">{r.error ?? t("没导进来", "Not imported")}</span>
              ) : r.state === "done" ? (
                <span className="li-ok">{t("已导入", "Imported")}</span>
              ) : (
                <span className="li-bar"><span style={{ width: `${Math.max(4, Math.round(r.progress * 100))}%` }} /></span>
              )}
            </div>
          ))}
        </div>
      ) : null}
      <div className="li-note">{t("只导入工作室有权使用的视频。下载在后台进行，通常一分钟内完成，可以先去做别的。", "Only videos the studio may use. Downloads run in the background, usually within a minute.")}</div>
    </div>
  );
}

const CSS = `
.li { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid #ebeae6; border-radius: 12px; background: #fff; }
.li-title { font-size: 13.5px; font-weight: 600; color: #171717; }
.li-row { display: flex; gap: 8px; }
.li-row input { flex: 1; min-width: 0; height: 36px; border: 1px solid #dcdbd6; border-radius: 9px; padding: 0 11px; font: inherit; font-size: 13px; outline: none; }
.li-row input:focus { border-color: #171717; }
.li-row button { height: 36px; padding: 0 16px; border: 0; border-radius: 9px; background: #171717; color: #fff; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.li-row button:disabled { opacity: .45; cursor: default; }
.li-list { display: flex; flex-direction: column; gap: 6px; }
.li-item { display: flex; align-items: center; gap: 8px; font-size: 12.5px; min-width: 0; }
.li-plat { flex-shrink: 0; padding: 1px 7px; border-radius: 999px; background: #f2f1ee; color: #525252; font-size: 11px; }
.li-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #2b2b2b; }
.li-bar { width: 140px; height: 6px; border-radius: 3px; background: #eeede9; overflow: hidden; flex-shrink: 0; }
.li-bar span { display: block; height: 100%; background: #171717; transition: width .4s ease; }
.li-ok { color: #1e7a4f; flex-shrink: 0; }
.li-err { color: #c42b2b; flex-shrink: 1; min-width: 0; max-width: 60%; }
.li-note { font-size: 11.5px; color: #8a8a8a; line-height: 1.5; }
`;
