"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { PageBody, bigButton, smallButton } from "@/components/projects/kit";
import { addClipAction, exportAction } from "@/app/(app)/video/actions";
import { clipLandedAction, startCutFromPageAction } from "@/app/(app)/projects/actions";
import { sendChannelMessage } from "@/app/(app)/chat/actions";
import { agentTag } from "@/lib/agents/catalog";
import { directorStepLabel } from "@/lib/agents/steps";
import { uploadFiles, type UploadProgress } from "@/lib/client/upload";
import { beginWork } from "@/lib/client/busy";
import { notify } from "@/lib/client/notify";
import { writeRendering } from "@/lib/client/rendering";
import { bumpLive } from "@/lib/client/live";

/**
 * The project's 剪辑 page in simple mode: three steps, one below the other,
 * only the one that matters now open.
 *
 *   ① 上传拍好的视频   drop or choose the host's takes
 *   ② 让 AI 剪         竖屏 or 横屏, an optional wish, one button
 *   ③ 看成片           watch it; 满意 → 发布, or say what to change
 *
 * For the people who are not editors (the owner: "make it for non-technical
 * people … no brainer"). The full desk is one switch away (`ModeSwitch`).
 * While 剪辑师 works the page asks the server for the project's stamp every
 * few seconds and redraws when it moves, like the project overview.
 */
export type SimpleFacts = {
  projectId: string;
  channelSlug: string;
  videoId: string;
  title: string;
  clips: { id: string; fileId: string; label: string; durationMs: number | null }[];
  items: number;
  captions: string[];
  render: {
    fileId: string | null;
    proxyFileId: string | null;
    state: string;
    progress: number;
    aspect: string;
    durationMs: number | null;
    startedAt: string | null;
    error: string | null;
  } | null;
  director: { state: string; step: string | null; startedAt: string | null; error: string | null } | null;
  /** The script, as the approval stands; null when the project has none. */
  script: { approvedVersion: number | null; latestVersion: number } | null;
  defaultAspect: "9:16" | "16:9";
};

type StepState = "done" | "now" | "later";

export function SimpleEdit({ f, zh, modeSwitch }: { f: SimpleFacts; zh: boolean; modeSwitch?: React.ReactNode }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [aspect, setAspect] = React.useState<"9:16" | "16:9">(f.defaultAspect);
  /* 成片多长: 0 follows the script; otherwise the cut is told the length (the owner, 29 Sep: "where do I choose how long I want the video"). */
  const [len, setLen] = React.useState(0);
  const [customMin, setCustomMin] = React.useState("");
  const [wish, setWish] = React.useState("");
  const [uploads, setUploads] = React.useState<UploadProgress[]>([]);
  const [busy, setBusy] = React.useState(false);
  /* Pressed 开始剪 / 要改一下 a moment ago: show the working card until the
     server's rows move (or a couple of minutes pass). Kept as the rows'
     key at the press, so no effect has to clear it. */
  const [waiting, setWaiting] = React.useState<{ key: string; at: number } | null>(null);
  const [reopen, setReopen] = React.useState<{ upload: boolean; cut: boolean }>({ upload: false, cut: false });
  const [changing, setChanging] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [picking, setPicking] = React.useState(false);

  const directing = f.director?.state === "queued" || f.director?.state === "running";
  const rendering = f.render?.state === "queued" || f.render?.state === "rendering";
  const film = f.render?.state === "done" && f.render.fileId ? f.render : null;
  const serverWorking = directing || rendering;
  const rowsKey = `${f.director?.state}|${f.director?.startedAt}|${f.render?.state}|${f.render?.startedAt}|${film?.fileId ?? ""}`;
  React.useEffect(() => {
    if (!waiting) return;
    const id = setTimeout(() => setWaiting(null), Math.max(0, 150_000 - (Date.now() - waiting.at)));
    return () => clearTimeout(id);
  }, [waiting]);
  const waitingSince = waiting && waiting.key === rowsKey ? waiting.at : null;
  const working = serverWorking || waitingSince !== null;
  /* Cut = 剪辑师 finished, or there is a film. Takes lying on the timeline
     (an upload through the full desk puts them there) are not a cut yet. */
  const cutDone = f.director?.state === "done" || Boolean(film);
  const cutFailed = !working && !film && f.director?.state === "failed";
  const renderFailed = !working && f.render?.state === "failed";
  const totalMs = f.clips.reduce((n, c) => n + (c.durationMs ?? 0), 0);

  const step1: StepState = f.clips.length > 0 && !reopen.upload ? "done" : "now";
  const step2: StepState = f.clips.length === 0 && !working ? "later" : working || !cutDone || reopen.cut || cutFailed ? "now" : "done";
  const step3: StepState = working || !cutDone || reopen.cut ? "later" : "now";

  /* Follow the work: the project's stamp every three seconds while 剪辑师
     is at it, and once whenever the tab comes back. */
  React.useEffect(() => {
    let last: string | null = null;
    let stopped = false;
    const pulse = async () => {
      const r = await fetch(`/api/projects/${f.projectId}/pulse`, { cache: "no-store" }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { stamp: string }) : null;
      if (!j || stopped) return;
      if (last !== null && j.stamp !== last) router.refresh();
      last = j.stamp;
    };
    void pulse();
    const onVisible = () => {
      if (document.visibilityState === "visible") void pulse();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = working ? setInterval(() => void pulse(), 3000) : null;
    return () => {
      stopped = true;
      if (id) clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [working, f.projectId, router]);

  async function upload(list: FileList | File[]) {
    const files = Array.from(list).filter((x) => /^(video|audio|image)\//.test(x.type) || /\.(mp4|mov|m4v|mkv|webm|avi|mts|mp3|m4a|wav|aac|jpe?g|png|heic|webp)$/i.test(x.name));
    if (!files.length) {
      notify(t("这里只收视频、音频和图片。", "Only video, audio and pictures go here."));
      return;
    }
    setUploads(files.map((x) => ({ name: x.name, pct: 0 })));
    const done = beginWork(t(`上传 ${files.length} 个文件`, `Uploading ${files.length} file(s)`));
    try {
      const out = await uploadFiles(files, {
        access: { mode: "everyone" },
        onProgress: (u) => setUploads(u),
        onDone: async (fileId) => {
          const r = await addClipAction(f.videoId, fileId);
          if ("error" in r && r.error) notify(r.error);
          await clipLandedAction(f.projectId).catch(() => null);
        },
      });
      if (out.uploaded) {
        notify(t(`已上传 ${out.uploaded} 段`, `Uploaded ${out.uploaded}`), "ok");
        setReopen((r) => ({ ...r, upload: false }));
      }
      setTimeout(bumpLive, 500);
      router.refresh();
    } finally {
      done();
      setUploads([]);
    }
  }

  async function startCut() {
    if (busy) return;
    setBusy(true);
    try {
      const lenLine = len ? (zh ? `成片时长控制在约 ${len < 60 ? `${len} 秒` : `${len / 60} 分钟`}（前后 10% 以内）。` : `Keep the finished video to about ${len} seconds.`) : "";
      const r = await startCutFromPageAction(f.projectId, { prompt: [lenLine, wish.trim()].filter(Boolean).join(" ") || undefined, aspect });
      if ("error" in r && r.error) {
        notify(r.error);
        return;
      }
      writeRendering({ projectId: f.videoId, title: f.title });
      setWaiting({ key: rowsKey, at: Date.now() });
      setReopen({ upload: false, cut: false });
      setTimeout(bumpLive, 1500);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function makeFilm() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await exportAction(f.videoId, { aspect: f.render?.aspect ?? aspect, burnCaptions: f.captions.length > 0, captionLanguage: f.captions[0] ?? "zh-CN" });
      if (r && "error" in r && r.error) {
        notify(r.error);
        return;
      }
      writeRendering({ projectId: f.videoId, title: f.title });
      setWaiting({ key: rowsKey, at: Date.now() });
      setTimeout(bumpLive, 1500);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function askForChanges() {
    const text = note.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const r = await sendChannelMessage(f.channelSlug, `${agentTag("video")} 成片要改一下，按这些意见重新剪一版视频：${text}`);
      if (r && "error" in r && r.error) {
        notify(r.error);
        return;
      }
      notify(t("已告诉剪辑师，改好会出现在这里", "Sent to the editor; the new cut shows up here"), "ok");
      setNote("");
      setChanging(false);
      setWaiting({ key: rowsKey, at: Date.now() });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const since = f.director?.startedAt ?? f.render?.startedAt ?? (waitingSince ? new Date(waitingSince).toISOString() : null);
  const minutes = useMinutes(since, working);
  const pct = f.render?.state === "rendering" ? Math.round(f.render.progress) : null;

  return (
    <PageBody width={960}>
      <style>{SIMPLE_CSS}</style>
      {/* The script this cut follows, and the switch to the full desk. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 32 }}>
        <ScriptLine projectId={f.projectId} script={f.script} zh={zh} />
        <span style={{ flexGrow: 1 }} />
        {modeSwitch}
      </div>

      {/* ① upload */}
      <Step
        n={1}
        state={step1}
        title={t("上传拍好的视频", "Upload what you filmed")}
        summary={
          f.clips.length ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span>{t(`已上传 ${f.clips.length} 段`, `${f.clips.length} uploaded`)}{totalMs ? ` · ${clock(totalMs)}` : ""}</span>
              <Thumbs clips={f.clips.slice(0, 6)} size={30} />
            </span>
          ) : null
        }
        action={
          step1 === "done" ? (
            <button type="button" className="se-link" onClick={() => setReopen((r) => ({ ...r, upload: true }))}>
              {t("再加", "Add more")}
            </button>
          ) : null
        }
      >
        <DropZone zh={zh} onFiles={upload} busy={uploads.length > 0} />
        {uploads.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
            {uploads.map((u, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <span style={{ minWidth: 0, flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                {u.error ? (
                  <span style={{ color: "#c42b2b" }}>{u.error}</span>
                ) : (
                  <span style={{ width: 160, height: 6, borderRadius: 3, background: "#eeede9", overflow: "hidden", flexShrink: 0 }}>
                    <span style={{ display: "block", height: "100%", width: `${u.pct}%`, background: "#171717", transition: "width .3s ease" }} />
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : null}
        {f.clips.length ? (
          <div style={{ marginTop: 14 }}>
            <Thumbs clips={f.clips} size={96} labels />
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setPicking(true)} style={smallButton()}>
            <Icon name="folder" size={13} />
            {t("从文件里选", "Choose from files")}
          </button>
          {step1 === "now" && f.clips.length ? (
            <button type="button" className="se-link" onClick={() => setReopen((r) => ({ ...r, upload: false }))}>
              {t("好了，下一步", "Done, next step")}
            </button>
          ) : null}
        </div>
      </Step>

      {/* ② the AI cut */}
      <Step
        n={2}
        state={step2}
        title={t("让 AI 剪", "Let the AI cut it")}
        summary={step2 === "done" ? t(`已剪好${film ? ` · ${film.aspect === "16:9" ? "横屏" : "竖屏"} ${film.aspect}` : ""}`, `Cut${film ? ` · ${film.aspect}` : ""}`) : step2 === "later" ? t("先上传视频", "Upload first") : null}
        action={
          step2 === "done" ? (
            <button type="button" className="se-link" onClick={() => setReopen((r) => ({ ...r, cut: true }))}>
              {t("重新剪", "Cut again")}
            </button>
          ) : null
        }
      >
        {working ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 12, background: "#f5f9ff", border: "1px solid #d6e4fb" }}>
            <span className="se-spin" aria-hidden />
            <div style={{ minWidth: 0, flexGrow: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#171717" }}>
                {rendering
                  ? pct !== null && pct > 0
                    ? t(`正在生成成片 ${pct}%`, `Making the film · ${pct}%`)
                    : t("正在生成成片", "Making the film")
                  : directing
                    ? t(`剪辑师正在${directorStepLabel(f.director?.step ?? null, true)}`, `The editor is ${directorStepLabel(f.director?.step ?? null, false)}`)
                    : t("剪辑师开始剪了", "The editor is starting")}
                {minutes !== null ? <span style={{ fontWeight: 400, color: "#6b6b6b" }}>{t(` · 已用 ${minutes} 分钟`, ` · ${minutes} min so far`)}</span> : null}
              </div>
              <div style={{ fontSize: 13, color: "#5f5f5f", marginTop: 3 }}>{t("可以先去做别的，好了会出现在这里，也会在项目对话里告诉你。", "You can do something else; it shows up here and in the project chat when done.")}</div>
            </div>
          </div>
        ) : (
          <>
            {cutFailed ? (
              <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "#fdf1f0", border: "1px solid #f3cfcb", fontSize: 13, color: "#8f2a20" }}>
                {t("上一次没剪成。", "The last try didn't finish.")} {f.director?.error ? <span style={{ color: "#a65a52" }}>{shortError(f.director.error)}</span> : null}
              </div>
            ) : null}
            <div style={{ fontSize: 13, color: "#5f5f5f", marginBottom: 10 }}>{t("做成什么样的？", "Which shape?")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 520 }}>
              <ShapeTile on={aspect === "9:16"} onClick={() => setAspect("9:16")} label={t("竖屏", "Vertical")} hint={t("抖音 · 小红书 · 视频号", "Douyin · Xiaohongshu · Channels")} w={18} h={32} />
              <ShapeTile on={aspect === "16:9"} onClick={() => setAspect("16:9")} label={t("横屏", "Horizontal")} hint={t("B站 · YouTube", "Bilibili · YouTube")} w={34} h={20} />
            </div>
            <div style={{ fontSize: 13, color: "#5f5f5f", margin: "18px 0 10px" }}>{t("成片多长？", "How long?")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[0, 30, 60, 180, 300, 600].filter((n) => true).map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={len === n}
                  onClick={() => setLen(n)}
                  style={{ height: 40, padding: "0 16px", borderRadius: 10, border: `1.5px solid ${len === n ? "#171717" : "#dcdbd6"}`, background: len === n ? "#171717" : "#fff", color: len === n ? "#fff" : "#333", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >
                  {n === 0 ? t("按稿子长度", "Follow the script") : n < 60 ? t(`${n} 秒`, `${n}s`) : t(`${n / 60} 分钟`, `${n / 60} min`)}
                </button>
              ))}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 12px", borderRadius: 10, border: `1.5px solid ${len && ![30, 60, 180, 300, 600].includes(len) ? "#171717" : "#dcdbd6"}`, background: "#fff" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#333" }}>{t("自定义", "Custom")}</span>
                <input
                  inputMode="decimal"
                  value={customMin}
                  placeholder={t("如 2.5", "e.g. 2.5")}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.]/g, "").slice(0, 5);
                    setCustomMin(v);
                    const n = Math.round(Number(v) * 60);
                    if (n >= 10 && n <= 3600) setLen(n);
                  }}
                  style={{ width: 56, height: 28, border: "1px solid #dcdbd6", borderRadius: 7, padding: "0 6px", fontFamily: "inherit", fontSize: 14, textAlign: "center" }}
                />
                <span style={{ fontSize: 14, color: "#6b6b6b" }}>{t("分钟", "min")}</span>
              </span>
            </div>
            <input
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              placeholder={t("有什么要求？（可不填）例如：控制在 60 秒，开头要抓人", "Anything specific? (optional) e.g. keep it to 60 seconds")}
              maxLength={400}
              style={{ display: "block", width: "100%", maxWidth: 640, height: 42, marginTop: 16, padding: "0 14px", border: "1px solid #dcdbd6", borderRadius: 10, fontFamily: "inherit", fontSize: 14, boxSizing: "border-box", outline: "none", background: "#fff" }}
            />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
              <button type="button" disabled={busy || f.clips.length === 0} onClick={() => void startCut()} style={{ ...bigButton("primary", busy || f.clips.length === 0), height: 46, padding: "0 26px", fontSize: 15 }}>
                <Icon name="scissors" size={15} />
                {cutFailed ? t("再试一次", "Try again") : t("开始剪", "Start")}
              </button>
              {reopen.cut ? (
                <button type="button" className="se-link" onClick={() => setReopen((r) => ({ ...r, cut: false }))}>
                  {t("取消", "Cancel")}
                </button>
              ) : null}
              <span style={{ fontSize: 12.5, color: "#8a8a8a" }}>{t("一般 5–15 分钟", "Usually 5–15 minutes")}</span>
            </div>
          </>
        )}
      </Step>

      {/* ③ watch */}
      <Step n={3} state={step3} title={t("看成片", "Watch the film")} summary={step3 === "later" ? t("剪好后在这里看", "Shows here once cut") : null}>
        {film ? (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
            <video
              key={film.fileId}
              controls
              playsInline
              preload="metadata"
              poster={`/api/files/${film.fileId}/thumb`}
              src={`/api/files/${film.proxyFileId ?? film.fileId}/download`}
              style={film.aspect === "16:9" ? { width: "100%", maxWidth: 640, aspectRatio: "16 / 9", borderRadius: 12, background: "#000" } : { height: 460, maxWidth: "100%", aspectRatio: "9 / 16", borderRadius: 12, background: "#000" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 220, flexGrow: 1, maxWidth: 360 }}>
              <div style={{ fontSize: 13, color: "#6b6b6b" }}>
                {film.aspect === "16:9" ? t("横屏", "Horizontal") : t("竖屏", "Vertical")} {film.aspect}
                {film.durationMs ? ` · ${clock(film.durationMs)}` : ""}
              </div>
              <Link prefetch={false} href={`/projects/${f.projectId}/publish`} style={{ ...bigButton("primary"), height: 46, fontSize: 15 }}>
                {t("满意，去发布", "Looks good, publish")} <Arrow />
              </Link>
              {changing ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <textarea
                    autoFocus
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("说说要改什么，例如：开头太慢，去掉 0:20 那段停顿", "What should change? e.g. the opening drags")}
                    rows={4}
                    maxLength={1500}
                    style={{ width: "100%", padding: "10px 12px", border: "1px solid #dcdbd6", borderRadius: 10, fontFamily: "inherit", fontSize: 14, lineHeight: 1.5, boxSizing: "border-box", resize: "vertical", outline: "none" }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" disabled={busy || !note.trim()} onClick={() => void askForChanges()} style={bigButton("primary", busy || !note.trim())}>
                      {t("发给剪辑师", "Send to the editor")}
                    </button>
                    <button type="button" onClick={() => setChanging(false)} style={bigButton("secondary")}>
                      {t("取消", "Cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setChanging(true)} style={bigButton("secondary")}>
                  <Icon name="pen" size={14} />
                  {t("要改一下", "Needs changes")}
                </button>
              )}
              <a href={`/api/files/${film.fileId}/download?download=1`} style={{ ...bigButton("secondary"), height: 36, fontSize: 13 }}>
                <Icon name="download" size={14} />
                {t("下载", "Download")}
              </a>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, color: "#2b2b2b" }}>
              {renderFailed ? t("上次生成成片没成功。", "The last attempt to make the film failed.") : t("已经剪好了，还差最后一步：生成成片。", "It's cut — one step left: make the film.")}
            </div>
            <button type="button" disabled={busy} onClick={() => void makeFilm()} style={bigButton("primary", busy)}>
              <Icon name="film" size={14} />
              {renderFailed ? t("再生成一次", "Try again") : t("生成成片", "Make the film")}
            </button>
          </div>
        )}
      </Step>

      {picking ? <FilePicker projectId={f.projectId} videoId={f.videoId} zh={zh} onClose={() => setPicking(false)} onAdded={() => { setPicking(false); setReopen((r) => ({ ...r, upload: false })); router.refresh(); }} /> : null}
    </PageBody>
  );
}

/* ----------------------------------------------------------------- pieces */

function Step({ n, state, title, summary, action, children }: { n: number; state: StepState; title: string; summary?: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode }) {
  const open = state === "now";
  return (
    <section
      style={{
        background: state === "later" ? "#fafaf8" : "#fff",
        border: `1px solid ${open ? "#f0c77e" : "#e7e6e2"}`,
        boxShadow: open ? "0 0 0 3px #fff4df" : "0 1px 2px rgba(0,0,0,.03)",
        borderRadius: 14,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: open ? "18px 20px 14px" : "14px 20px" }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 99,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13.5,
            fontWeight: 700,
            background: state === "done" ? "#22a061" : open ? "#f0a53a" : "#fff",
            color: state === "later" ? "#a3a3a0" : "#fff",
            border: state === "later" ? "1.5px solid #deddd8" : "none",
          }}
        >
          {state === "done" ? <Icon name="check" size={15} /> : n}
        </span>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: state === "later" ? "#9a9a96" : "#171717", flexShrink: 0 }}>{title}</h2>
        {!open && summary ? <span style={{ fontSize: 13, color: "#6b6b6b", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span> : null}
        <span style={{ flexGrow: 1 }} />
        {action}
      </header>
      {open && children ? <div style={{ padding: "0 20px 20px 64px" }}>{children}</div> : null}
    </section>
  );
}

function ScriptLine({ projectId, script, zh }: { projectId: string; script: SimpleFacts["script"]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  if (!script) return <span style={{ fontSize: 13, color: "#6b6b6b" }}>{t("这条没有稿子，AI 会按主持人讲的内容剪。", "No script: the AI cuts from what the host says.")}</span>;
  if (script.approvedVersion) {
    return (
      <Link prefetch={false} href={`/projects/${projectId}/script`} className="se-script" style={{ color: "#1e7a4f" }}>
        <Icon name="check" size={13} />
        {t(`按第 ${script.approvedVersion} 版稿子剪 · 已通过`, `Cutting to script v${script.approvedVersion} · approved`)}
      </Link>
    );
  }
  return (
    <Link prefetch={false} href={`/projects/${projectId}/script`} className="se-script" style={{ color: "#95590a" }}>
      {t("稿子还没通过 · 去看看", "The script isn't approved yet · take a look")} <Arrow />
    </Link>
  );
}

function DropZone({ zh, onFiles, busy }: { zh: boolean; onFiles: (files: FileList) => void; busy: boolean }) {
  const input = React.useRef<HTMLInputElement | null>(null);
  const [over, setOver] = React.useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files?.length) return;
        e.preventDefault();
        setOver(false);
        onFiles(e.dataTransfer.files);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 150,
        padding: 20,
        borderRadius: 14,
        border: `2px dashed ${over ? "#171717" : "#d6d5d0"}`,
        background: over ? "#f3f2ee" : "#fafaf8",
        cursor: busy ? "progress" : "pointer",
        textAlign: "center",
        transition: "background-color .15s ease, border-color .15s ease",
      }}
    >
      <span style={{ width: 44, height: 44, borderRadius: 99, background: "#fff", border: "1px solid #e7e6e2", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#171717" }}>
        <Icon name="upload" size={20} />
      </span>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#171717" }}>{zh ? "把视频拖到这里，或点一下选择" : "Drop the videos here, or click to choose"}</div>
      <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>{zh ? "口播、空镜都可以，一次可以选多段" : "Talking takes and b-roll, several at once"}</div>
      <input
        ref={input}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ShapeTile({ on, onClick, label, hint, w, h }: { on: boolean; onClick: () => void; label: string; hint: string; w: number; h: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderRadius: 12,
        border: `2px solid ${on ? "#171717" : "#e2e1dc"}`,
        background: on ? "#fff" : "#fafaf8",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
      }}
    >
      <span style={{ width: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ width: w, height: h, borderRadius: 4, border: `2px solid ${on ? "#171717" : "#b5b4af"}` }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "#171717" }}>{label}</span>
        <span style={{ display: "block", fontSize: 12, color: "#8a8a8a", marginTop: 2 }}>{hint}</span>
      </span>
    </button>
  );
}

function Thumbs({ clips, size, labels = false }: { clips: SimpleFacts["clips"]; size: number; labels?: boolean }) {
  return (
    <span style={{ display: "flex", gap: labels ? 10 : 4, flexWrap: labels ? "wrap" : "nowrap", flexShrink: 0 }}>
      {clips.map((c) => (
        <span key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4, width: labels ? size * 1.5 : size }}>
          <span style={{ position: "relative", display: "block", width: "100%", height: labels ? size : size * 0.66, borderRadius: labels ? 8 : 4, overflow: "hidden", background: "#1c1c1c" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${c.fileId}/thumb`} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
            {labels && c.durationMs ? (
              <span style={{ position: "absolute", right: 4, bottom: 4, fontSize: 10.5, fontWeight: 600, color: "#fff", background: "rgba(0,0,0,.6)", borderRadius: 4, padding: "0 4px", lineHeight: "16px" }}>{clock(c.durationMs)}</span>
            ) : null}
          </span>
          {labels ? <span style={{ fontSize: 11.5, color: "#5f5f5f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span> : null}
        </span>
      ))}
    </span>
  );
}

type Choice = { id: string; title: string; sub?: string | null; thumb?: string | null };

/** 从文件里选: takes already in the studio's files, several at once, into the bin. */
function FilePicker({ projectId, videoId, zh, onClose, onAdded }: { projectId: string; videoId: string; zh: boolean; onClose: () => void; onAdded: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [items, setItems] = React.useState<Choice[] | null>(null);
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [q, setQ] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    void fetch(`/api/projects/${projectId}/choices?kind=clips`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      /* Preview copies are copies of a take, not takes. */
      .then((j: { items: Choice[] }) => live && setItems((j.items ?? []).filter((i) => !/预览|proxy/i.test(i.title))))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [projectId]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const shown = (items ?? []).filter((i) => !q.trim() || i.title.toLowerCase().includes(q.trim().toLowerCase()));
  async function add() {
    setAdding(true);
    try {
      for (const id of chosen) {
        const r = await addClipAction(videoId, id);
        if ("error" in r && r.error) notify(r.error);
      }
      notify(t(`已加入 ${chosen.length} 段`, `Added ${chosen.length}`), "ok");
      onAdded();
    } finally {
      setAdding(false);
    }
  }
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(20,20,20,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 100%)", maxHeight: "80vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: "1px solid #eeede9" }}>
          <div style={{ fontSize: 16, fontWeight: 600, flexGrow: 1 }}>{t("从文件里选视频", "Choose videos from your files")}</div>
          <button type="button" onClick={onClose} aria-label={t("关闭", "Close")} style={{ border: 0, background: "none", cursor: "pointer", fontSize: 20, color: "#8a8a8a", lineHeight: 1 }}>
            ×
          </button>
        </div>
        <div style={{ padding: "12px 18px 0" }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("搜索文件名…", "Search…")} style={{ width: "100%", height: 38, border: "1px solid #e2e1dc", borderRadius: 10, padding: "0 12px", fontFamily: "inherit", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
        </div>
        <div style={{ padding: 18, overflowY: "auto", flexGrow: 1 }}>
          {items === null ? (
            <div style={{ color: "#8a8a8a", fontSize: 13 }}>{t("读取中…", "Loading…")}</div>
          ) : !shown.length ? (
            <div style={{ color: "#8a8a8a", fontSize: 13 }}>{t("没有可选的视频。", "No videos to choose from.")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
              {shown.map((it) => {
                const on = chosen.includes(it.id);
                return (
                  <button key={it.id} type="button" onClick={() => setChosen((c) => (on ? c.filter((x) => x !== it.id) : [...c, it.id]))} style={{ padding: 0, border: `2px solid ${on ? "#171717" : "#ececea"}`, borderRadius: 10, overflow: "hidden", background: "#fff", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.thumb ?? ""} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover", display: "block", background: "#1c1c1c" }} />
                    <div style={{ padding: "6px 8px" }}>
                      <div style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</div>
                      {it.sub ? <div style={{ fontSize: 11, color: "#9a9a9a" }}>{it.sub}</div> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 18px", borderTop: "1px solid #eeede9" }}>
          <button type="button" onClick={onClose} style={bigButton("secondary")}>
            {t("取消", "Cancel")}
          </button>
          <button type="button" disabled={!chosen.length || adding} onClick={() => void add()} style={bigButton("primary", !chosen.length || adding)}>
            {t(`加入 ${chosen.length} 段`, `Add ${chosen.length}`)}
          </button>
        </div>
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** Whole minutes since `since`, ticking while `on`. Null before hydration, so server and client agree. */
function useMinutes(since: string | null, on: boolean): number | null {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = on ? setInterval(() => setNow(Date.now()), 20_000) : null;
    return () => {
      clearTimeout(first);
      if (id) clearInterval(id);
    };
  }, [on]);
  if (!since || now === null) return null;
  return Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
}

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The first plain sentence of an error, without codes and stack noise. */
function shortError(e: string): string {
  return e.replace(/\s+/g, " ").replace(/^Error:\s*/i, "").slice(0, 120);
}

const SIMPLE_CSS = `
.se-link { border: 0; background: none; padding: 4px 6px; font-family: inherit; font-size: 13px; font-weight: 500; color: #1f5fbf; cursor: pointer; border-radius: 6px; }
.se-link:hover { background: #eef4fe; }
.se-script { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; text-decoration: none; padding: 4px 8px; margin-left: -8px; border-radius: 8px; }
.se-script:hover { background: rgba(0,0,0,.04); }
.se-spin { width: 22px; height: 22px; border-radius: 99px; border: 2.5px solid #cfe0fb; border-top-color: #1f5fbf; flex-shrink: 0; animation: seSpin .9s linear infinite; }
@keyframes seSpin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .se-spin { animation: none; } }
`;
