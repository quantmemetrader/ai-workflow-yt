"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { directorStepLabel } from "@/lib/agents/steps";

/**
 * The one line across the top of a project's 剪辑 page that says what to do
 * next, with the press for it.
 *
 *   no clips         upload the host's clips                 [上传素材]
 *   the editor at it 剪辑师 正在…（its step）                   —
 *   rendering        渲染中 45%                                —
 *   clips, no cut    let 剪辑师 cut to the script             [让剪辑师开剪]
 *   a cut, no render watch it, then render                   [渲染成片]
 *   changed since    re-render                                [重新渲染]
 *   a fresh render   download it, fix it up, go to 发布        [下载成片] [去发布 →]
 *
 * One line tall on purpose: the desk under it needs the room ("the video is
 * too small"). The same states and words as `NextStep` in
 * components/projects/kit.tsx, drawn compact.
 */
export type BandFacts = {
  clips: number;
  items: number;
  totalMs: number;
  directing: boolean;
  directorStep: string | null;
  rendering: boolean;
  renderPercent: number | null;
  /** The newest finished render, when there is one. */
  lastRender: { fileId: string; subtitleFileId: string | null; aspect: string; durationMs: number | null } | null;
  /** The cut was changed after that render. */
  stale: boolean;
};

export function EditBand({
  projectId,
  zh,
  facts: f,
  busy,
  onUpload,
  onCut,
  onRender,
  extra,
}: {
  /** Drawn at the right end of the band: the 简单 / 专业剪辑 switch. */
  extra?: React.ReactNode;
  projectId: string;
  zh: boolean;
  facts: BandFacts;
  busy: boolean;
  onUpload: (files: FileList) => void;
  onCut: () => void;
  onRender: () => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const input = React.useRef<HTMLInputElement | null>(null);
  const [over, setOver] = React.useState(false);

  const upload = (primary: boolean, label = t("上传素材", "Upload clips")) => (
    <button type="button" onClick={() => input.current?.click()} style={btn(primary ? "primary" : "secondary")}>
      <Icon name="upload" size={14} />
      {label}
    </button>
  );

  let state: "you" | "running" | "done";
  let text: React.ReactNode;
  let presses: React.ReactNode = null;

  if (f.directing) {
    state = "running";
    text = t(`剪辑师正在${directorStepLabel(f.directorStep, true)}，好了会自动出现在下面的时间线上。`, `The editor is ${directorStepLabel(f.directorStep, false)} — it appears on the timeline below when done.`);
  } else if (f.rendering) {
    state = "running";
    text = f.renderPercent !== null ? t(`正在渲染成片 ${f.renderPercent}%，几分钟就好。`, `Rendering the film, ${f.renderPercent}% — a few minutes.`) : t("渲染已排队，马上开始。", "The render is queued and starts shortly.");
  } else if (f.clips === 0) {
    state = "you";
    text = t("先上传主持人拍好的素材（可多选，也可以直接拖到这里）。", "Upload the host's clips first (several at once, or drop them here).");
    presses = upload(true);
  } else if (f.items === 0) {
    state = "you";
    text = t(`已有 ${f.clips} 段素材。让剪辑师按脚本开剪，或者自己在下面的时间线上剪。`, `${f.clips} clip(s) in. Let the editor cut to the script, or cut it yourself on the timeline below.`);
    presses = (
      <>
        {upload(false, t("再传素材", "Add more"))}
        <button type="button" disabled={busy} onClick={onCut} style={btn("primary", busy)}>
          <Icon name="scissors" size={14} />
          {t("让剪辑师开剪", "Let the editor cut")}
        </button>
      </>
    );
  } else if (!f.lastRender || f.stale) {
    state = "you";
    text = f.lastRender
      ? t("改过之后还没重新渲染：下载的还是上一版。", "Changed since the last render — a download is still the old one.")
      : t(`粗剪好了（${clock(f.totalMs)}）。在下面看一遍、改一改，满意就渲染成片。`, `The cut is ready (${clock(f.totalMs)}). Watch it below, adjust, then render.`);
    presses = (
      <>
        {f.lastRender ? (
          <a href={`/api/files/${f.lastRender.fileId}/download?download=1`} style={btn("secondary")}>
            <Icon name="download" size={14} />
            {t("下载上一版", "Download previous")}
          </a>
        ) : null}
        <button type="button" disabled={busy} onClick={onRender} style={btn("primary", busy)}>
          <Icon name="film" size={14} />
          {f.lastRender ? t("重新渲染", "Render again") : t("渲染成片", "Render the film")}
        </button>
      </>
    );
  } else {
    state = "done";
    text = t(
      `成片已出（${f.lastRender.durationMs ? clock(f.lastRender.durationMs) : ""}${f.lastRender.durationMs ? " · " : ""}${f.lastRender.aspect}）。可以下载下来自己再修，修好后在「发布」上传最终版。`,
      `The film is ready (${f.lastRender.durationMs ? `${clock(f.lastRender.durationMs)} · ` : ""}${f.lastRender.aspect}). Download it to touch up, then upload the final version in Publish.`,
    );
    presses = (
      <>
        <a href={`/api/files/${f.lastRender.fileId}/download?download=1`} style={btn("secondary")}>
          <Icon name="download" size={14} />
          {t("下载成片", "Download")}
        </a>
        <Link prefetch={false} href={`/projects/${projectId}/publish`} style={btn("primary")}>
          {t("去发布", "Go to Publish")}
          <Icon name="arrowRight" size={14} />
        </Link>
      </>
    );
  }

  const tone =
    state === "done"
      ? { bg: "#eef8f2", line: "#cbe9d8", ink: "#1e7a4f", label: t("已完成", "Done") }
      : state === "you"
        ? { bg: "#fff6e5", line: "#f4ddb0", ink: "#95590a", label: t("现在做这一步", "Do this now") }
        : { bg: "#eef4fe", line: "#cfe0fb", ink: "#1f5fbf", label: t("AI 正在做", "AI at work") };

  return (
    <div
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files?.length) return;
        e.preventDefault();
        setOver(false);
        onUpload(e.dataTransfer.files);
      }}
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 12,
        minHeight: 52,
        padding: "8px 16px",
        background: over ? "#eef5fd" : tone.bg,
        borderBottom: `1px solid ${over ? "#9fb8e8" : tone.line}`,
        outline: over ? "1.5px dashed #007be0" : "none",
        outlineOffset: -5,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, background: "#fff", color: tone.ink, fontSize: 12, fontWeight: 600, border: `1px solid ${tone.line}`, flexShrink: 0, whiteSpace: "nowrap" }}>
        {state === "done" ? <Icon name="check" size={12} /> : <span className={state === "running" ? "eb-pulse" : undefined} style={{ width: 7, height: 7, borderRadius: 99, background: tone.ink }} />}
        {tone.label}
      </span>
      <div style={{ flexGrow: 1, minWidth: 0, fontSize: 13.5, color: "#2b2b2b", lineHeight: 1.45 }}>{text}</div>
      {presses ? <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>{presses}</div> : null}
      {extra ? <div style={{ flexShrink: 0, marginLeft: 4 }}>{extra}</div> : null}
      <input
        ref={input}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) onUpload(e.target.files);
          e.target.value = "";
        }}
      />
      <style>{`@keyframes ebPulse{0%,100%{opacity:1}50%{opacity:.35}}.eb-pulse{animation:ebPulse 1.4s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.eb-pulse{animation:none}}`}</style>
    </div>
  );
}

function btn(kind: "primary" | "secondary", disabled = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 36,
    padding: "0 16px",
    borderRadius: 9,
    fontSize: 13.5,
    fontWeight: 600,
    fontFamily: "inherit",
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    background: kind === "primary" ? "#171717" : "#fff",
    color: kind === "primary" ? "#fff" : "#171717",
    border: `1px solid ${kind === "primary" ? "#171717" : "#d6d5d0"}`,
  };
}

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
