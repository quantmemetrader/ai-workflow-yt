"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/client/notify";
import { recutFromScriptAction, scriptFromFootageAction } from "@/app/(app)/projects/[id]/script/footage-actions";

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;

/**
 * Above a script that is the host's own words (lib/script/from-footage.ts): says so, says how long the video will
 * be from the script as it stands, and cuts it again from the script in one press.
 */
export function FootageBar({
  projectId,
  zh,
  state,
  keptMs,
  totalMs,
  clips,
  canCut,
}: {
  projectId: string;
  zh: boolean;
  state: "linked" | "pending" | "offer";
  keptMs: number;
  totalMs: number;
  clips: number;
  canCut: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const t = (a: string, b: string) => (zh ? a : b);
  React.useEffect(() => {
    if (state !== "pending") return;
    const id = window.setInterval(() => router.refresh(), 8000);
    return () => window.clearInterval(id);
  }, [state, router]);

  const recut = async () => {
    setBusy(true);
    const r = await recutFromScriptAction(projectId).catch(() => ({ error: t("没能开始，请再试一次", "Could not start; try again") }));
    setBusy(false);
    if ("error" in r) return notify(r.error);
    notify(t("剪辑师开始按脚本剪了，剪好会通知你", "The editor is cutting to the script; you will be told when it is done"), "ok");
    router.push(`/projects/${projectId}/edit`);
  };
  const bring = async () => {
    setBusy(true);
    const r = await scriptFromFootageAction(projectId).catch(() => ({ error: t("没能开始，请再试一次", "Could not start; try again") }));
    setBusy(false);
    if ("error" in r) return notify(r.error);
    notify(r.queued ? t("正在听写视频，写好会自动放进脚本", "Transcribing the footage; it will appear in the script") : r.changed ? t("已把视频里说的话写进脚本", "The footage's words are in the script") : t("脚本里已经是视频里说的话", "The script already holds the footage"), "ok");
    router.refresh();
  };

  return (
    <div className="fb" data-state={state}>
      <style>{CSS}</style>
      <span className="fb-ic" aria-hidden>
        <svg viewBox="0 0 24 24" width="16" height="16"><rect x="3.4" y="5.4" width="12.4" height="13.2" rx="2.1" fill="currentColor" /><path d="m16.6 13 4.6 2.8V8.2L16.6 11z" fill="currentColor" /></svg>
      </span>
      <div className="fb-txt">
        {state === "linked" ? (
          <>
            <b>{t(`这份脚本就是视频里说的话${clips > 1 ? `（${clips} 段视频）` : ""}`, `This script is what is said in the footage${clips > 1 ? ` (${clips} clips)` : ""}`)}</b>
            <span>
              {t("删掉哪句，视频里就剪掉哪句；新打的字视频里没有说过，不会出现。", "Delete a line and it is cut from the video; words typed in were never said and will not appear. ")}
              {t(`按现在的脚本，成片约 ${mmss(keptMs)}（原片 ${mmss(totalMs)}）。`, `As the script stands the video runs about ${mmss(keptMs)} (footage ${mmss(totalMs)}).`)}
            </span>
          </>
        ) : state === "pending" ? (
          <>
            <b>{t("正在听写上传的视频", "Transcribing the uploaded footage")}</b>
            <span>{t("写好后，视频里说的每一句话会自动出现在这里，之前写的稿子会留在「版本记录」里。", "When it is done every line said in the video appears here; the earlier draft stays in Version history.")}</span>
          </>
        ) : (
          <>
            <b>{t("这个项目有上传的视频", "This project has uploaded footage")}</b>
            <span>{t("可以把视频里说的话写成脚本：之后删掉哪句，视频里就剪掉哪句。之前写的稿子会留在「版本记录」里。", "Turn what is said in it into the script: delete a line later and it is cut from the video. The current draft stays in Version history.")}</span>
          </>
        )}
      </div>
      {state === "linked" && canCut ? (
        <button type="button" className="fb-btn" onClick={() => void recut()} disabled={busy}>
          {busy ? t("正在开始…", "Starting…") : t("按脚本重新剪", "Cut to the script")}
        </button>
      ) : state === "offer" && canCut ? (
        <button type="button" className="fb-btn" onClick={() => void bring()} disabled={busy}>
          {busy ? t("正在开始…", "Starting…") : t("把视频里说的话写进脚本", "Write the footage into the script")}
        </button>
      ) : state === "pending" ? (
        <span className="fb-spin" aria-hidden />
      ) : null}
      {state === "linked" ? (
        <Link href={`/projects/${projectId}/edit`} prefetch={false} className="fb-link">
          {t("看剪辑", "Open the edit")}
        </Link>
      ) : null}
    </div>
  );
}

const CSS = `
.fb { display: flex; align-items: center; gap: 12px; margin: 10px 16px 0; padding: 11px 14px; border-radius: 12px; background: #f2f7ff; border: 1px solid #d6e6fb; color: #1f2d3d; }
.fb[data-state="pending"] { background: #fff8eb; border-color: #f3dfb4; }
.fb[data-state="offer"] { background: #f7f7f5; border-color: #e6e5e0; }
.fb-ic { width: 30px; height: 30px; border-radius: 9px; background: #fff; color: #1f5fbf; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 0 0 1px rgba(0,0,0,.04); }
.fb-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fb-txt b { font-size: 13.5px; font-weight: 600; }
.fb-txt span { font-size: 12.5px; color: #4a5563; line-height: 1.55; }
.fb-btn { flex-shrink: 0; height: 34px; padding: 0 14px; border-radius: 10px; border: 0; background: #171717; color: #fff; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.fb-btn:disabled { opacity: .6; cursor: default; }
.fb-link { flex-shrink: 0; font-size: 12.5px; color: #1f5fbf; text-decoration: none; white-space: nowrap; }
.fb-spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #f0c674; border-top-color: #b57a10; animation: fb-r .8s linear infinite; flex-shrink: 0; }
@keyframes fb-r { to { transform: rotate(360deg); } }
@media (max-width: 760px) { .fb { flex-wrap: wrap; margin: 8px 12px 0; } .fb-txt { flex: 1 1 100%; } }
`;
