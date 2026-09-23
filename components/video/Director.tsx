"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DirectorState } from "@/lib/video/director";
import { field, ghost, solid } from "@/components/ui/kit";

/**
 * "Make the video."
 *
 * One box above the editor. Somebody drops their clips in, writes what the
 * video should be, and presses the button; the worker transcribes, cuts,
 * designs and renders, and this strip says which of those it is doing. When
 * it is done the strip says what it made and where the file is, and every
 * change it wrote is one ⌘Z away.
 *
 * It is a strip and not a screen because the editor underneath is where the
 * result is judged: the timeline fills in as the director works, and the
 * person can start nudging before the render has finished.
 */
const STEPS: { key: NonNullable<DirectorState["step"]>; en: string; zh: string }[] = [
  { key: "footage", en: "Footage", zh: "素材" },
  { key: "transcribe", en: "Transcribe", zh: "转写" },
  { key: "cut", en: "Cut", zh: "剪辑" },
  { key: "design", en: "Design", zh: "设计" },
  { key: "render", en: "Render", zh: "渲染" },
];

export function Director({
  director,
  clipCount,
  scripts,
  scriptId,
  scriptTitle,
  busy,
  zh,
  onMake,
  onLinkScript,
  onUpload,
}: {
  director: DirectorState;
  clipCount: number;
  scripts: { id: string; title: string; status: string }[];
  scriptId: string | null;
  scriptTitle: string | null;
  busy: boolean;
  zh: boolean;
  onMake: (input: { brief: string; aspect: string; render: boolean; pace: string }) => void;
  onLinkScript: (scriptId: string | null) => void;
  onUpload: (files: FileList) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [brief, setBrief] = useState(director.brief ?? "");
  const [aspect, setAspect] = useState(director.aspect ?? "16:9");
  const [render, setRender] = useState(director.render !== false);
  const [pace, setPace] = useState<string>(director.pace ?? "channel");
  const PACES: { key: string; en: string; zh: string; note: string; noteZh: string }[] = [
    { key: "calm", en: "Calm", zh: "克制", note: "One idea per shot, air between", noteZh: "一镜一意，留白" },
    { key: "channel", en: "Channel", zh: "频道", note: "The channel's own rhythm", noteZh: "频道自己的节奏" },
    { key: "hype", en: "Hype", zh: "炸裂", note: "A full-frame visual for everything said, every 2 to 4 seconds", noteZh: "每提到的东西都满屏上图，每 2 到 4 秒一个" },
  ];
  const [open, setOpen] = useState(true);
  const running = director.state === "queued" || director.state === "running";

  /* The clock on the strip, so five minutes reads as five minutes and not as
     a spinner that might have died. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  /* Finding pictures and writing the rows are the tail of the design step;
     they have no chip of their own, and without this the stepper showed no
     step at all for a minute while they ran. */
  const stepKey = director.step === "pictures" || director.step === "write" ? "design" : director.step;
  const stepIndex = STEPS.findIndex((s) => s.key === stepKey);
  const elapsed = director.startedAt ? Math.max(0, Math.round((now - new Date(director.startedAt).getTime()) / 1000)) : 0;
  const result = director.state === "done" ? director.result : undefined;

  return (
    <div style={{ flexShrink: 0, borderBottom: "1px solid #ededed", background: "#fcfcfc" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", minHeight: 40 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ display: "flex", alignItems: "center", gap: 7, border: 0, background: "transparent", cursor: "pointer", font: "inherit", padding: 0, color: "#171717" }}
        >
          <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, fill: "none", stroke: "#999", strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round", transform: open ? "rotate(90deg)" : "none" }}>
            <path d="m9 5 7 7-7 7" />
          </svg>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("Make the video", "一键成片")}</span>
        </button>

        {running ? (
          <Stepper current={stepIndex} note={director.note} zh={zh} elapsed={elapsed} render={director.render !== false} />
        ) : result ? (
          <span style={{ fontSize: 11.5, color: "#278f5e", display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexGrow: 1 }}>
            <Tick />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t(
                `Done: ${result.cuts} cuts, ${result.graphics} graphics, ${result.punches} punch-ins, ${result.broll} cutaways`,
                `完成：${result.cuts} 个片段、${result.graphics} 个图形、${result.punches} 次推近、${result.broll} 段空镜`,
              )}
              {result.fileId ? (
                <>
                  {" · "}
                  <Link href={`/files/${result.fileId}`} style={{ color: "#007be0" }}>
                    {t("open the file", "打开成片")}
                  </Link>
                </>
              ) : null}
            </span>
          </span>
        ) : director.state === "failed" ? (
          <span style={{ fontSize: 11.5, color: "#e03636", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flexGrow: 1 }} title={director.error}>
            {t("It stopped: ", "中断：")}
            {director.error}
          </span>
        ) : (
          <span style={{ fontSize: 11.5, color: "#999999" }}>
            {t("drop the clips in, say what the video is, press the button", "把素材拖进来，写一句想要什么，按下按钮")}
          </span>
        )}
      </div>

      {open && !running ? (
        <div style={{ padding: "0 16px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {result?.notes ? (
            /* One line, cut with an ellipsis, and "Read more" to open the
               whole note: the director's reasoning is worth reading once,
               not worth a paragraph on the strip every time the project is
               opened. */
            <div style={{ maxWidth: 760, fontSize: 11.5, color: "#525252", lineHeight: 1.55 }}>
              {noteOpen ? (
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{result.notes}</p>
              ) : (
                <p
                  style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}
                  title={result.notes}
                >
                  {result.notes}
                </p>
              )}
              <button
                type="button"
                onClick={() => setNoteOpen((v) => !v)}
                style={{ border: 0, background: "transparent", padding: 0, marginTop: 2, fontSize: 11, color: "#3b82f6", cursor: "pointer", fontFamily: "inherit" }}
              >
                {noteOpen ? t("Less", "收起") : t("Read more", "展开全文")}
              </button>
            </div>
          ) : null}
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && brief.trim() && clipCount > 0 && !busy) {
                e.preventDefault();
                onMake({ brief: brief.trim(), aspect, render, pace });
              }
            }}
            placeholder={t(
              "What should this video be? The subject, the platform, the mood, what to keep and what to lose, whose name goes on. e.g. “A 60-second short for YouTube from the interview: punchy captions, my name at the start, cut to the b-roll when I talk about the factory, end on the price.”",
              "这支视频要做成什么？主题、平台、氛围、要保留和删掉什么、谁的名字上屏。例如：“把访谈剪成 60 秒竖版短片：弹字幕，开头加我的姓名条，讲到工厂时切空镜，结尾停在价格上。”",
            )}
            rows={2}
            style={{ ...field, height: "auto", minHeight: 56, padding: "8px 11px", lineHeight: 1.55, resize: "vertical", maxWidth: 900 }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 3 }}>
              {["16:9", "9:16", "1:1"].map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAspect(a)}
                  style={{
                    ...ghost,
                    height: 28,
                    padding: "0 10px",
                    background: aspect === a ? "#171717" : "#fff",
                    color: aspect === a ? "#fff" : "#525252",
                    borderColor: aspect === a ? "#171717" : "#ededed",
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 3 }} title={t("How much happens on screen", "画面密度")}>
              {PACES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPace(p.key)}
                  title={zh ? p.noteZh : p.note}
                  style={{
                    ...ghost,
                    height: 28,
                    padding: "0 10px",
                    background: pace === p.key ? "#171717" : "#fff",
                    color: pace === p.key ? "#fff" : "#525252",
                    borderColor: pace === p.key ? "#171717" : "#ededed",
                  }}
                >
                  {zh ? p.zh : p.en}
                </button>
              ))}
            </div>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={render} onChange={(e) => setRender(e.target.checked)} />
              {t("render the file when done", "完成后直接渲染成片")}
            </label>
            {scripts.length > 0 ? (
              <select
                value={scriptId ?? ""}
                onChange={(e) => onLinkScript(e.target.value || null)}
                title={t("The script this was shot to, if any", "拍摄所依据的脚本（可选）")}
                style={{ ...field, width: 240, height: 28, fontSize: 12 }}
              >
                <option value="">{t("no script", "不关联脚本")}</option>
                {scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            ) : scriptTitle ? (
              <span style={{ fontSize: 11.5, color: "#999999" }}>{scriptTitle}</span>
            ) : null}
            <div style={{ flexGrow: 1 }} />
            {clipCount === 0 ? (
              <label style={{ ...ghost, height: 30, display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
                {t("Add footage", "添加素材")}
                <input
                  type="file"
                  accept="video/*,audio/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files?.length) onUpload(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            ) : null}
            <button
              type="button"
              disabled={busy || !brief.trim() || clipCount === 0}
              onClick={() => onMake({ brief: brief.trim(), aspect, render, pace })}
              title={clipCount === 0 ? t("Drop some footage on the editor first", "请先放入素材") : t("⌘↵", "⌘↵")}
              style={{ ...solid, height: 30, opacity: busy || !brief.trim() || clipCount === 0 ? 0.45 : 1 }}
            >
              {director.state === "done" || director.state === "failed" ? t("Make it again", "再做一版") : t("Make the video", "开始制作")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stepper({ current, note, zh, elapsed, render }: { current: number; note?: string; zh: boolean; elapsed: number; render: boolean }) {
  const steps = render ? STEPS : STEPS.slice(0, 4);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flexGrow: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "now" : "next";
          return (
            <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  height: 22,
                  padding: "0 8px",
                  borderRadius: 11,
                  fontSize: 11,
                  fontWeight: state === "now" ? 600 : 500,
                  background: state === "now" ? "#171717" : state === "done" ? "#e4faeb" : "#f3f3f3",
                  color: state === "now" ? "#fff" : state === "done" ? "#278f5e" : "#999999",
                }}
              >
                {state === "now" ? <Spin /> : state === "done" ? <Tick small /> : null}
                {zh ? s.zh : s.en}
              </span>
              {i < steps.length - 1 ? <span style={{ width: 8, height: 1, background: "#e2e2e2" }} /> : null}
            </span>
          );
        })}
      </div>
      <span style={{ fontSize: 11.5, color: "#525252", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }} title={note}>
        {note ?? (zh ? "排队中…" : "queued…")}
      </span>
      <span style={{ marginLeft: "auto", fontSize: 11, color: "#999999", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
        {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
      </span>
    </div>
  );
}

function Spin() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, animation: "auraSpin 1s linear infinite" }}>
      <circle cx="12" cy="12" r="8.6" stroke="rgba(255,255,255,.3)" strokeWidth="3" fill="none" />
      <path d="M12 3.4a8.6 8.6 0 0 1 8.6 8.6" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Tick({ small = false }: { small?: boolean }) {
  const s = small ? 10 : 13;
  return (
    <svg viewBox="0 0 24 24" style={{ width: s, height: s, fill: "none", stroke: "currentColor", strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round", flexShrink: 0 }}>
      <path d="m4.5 12.5 5 5L20 7" />
    </svg>
  );
}
