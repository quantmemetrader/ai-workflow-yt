"use client";

import { useRef, useState } from "react";
import { type Format } from "@/components/canvas/composer-format";
import { Markdown } from "@/components/ui/Markdown";
import { RichText, formatRich } from "@/components/ui/RichText";
import { NameDialog } from "@/components/ui/NameDialog";

/**
 * Starting a script, as a document rather than a browser box.
 *
 * This was `globalThis.prompt("Script title")`: one line of plain text, and
 * every other field the brief carries (the angle, the channel, the aspect, the
 * duration, the languages, the points the video must make) left null, to be
 * filled in later on a screen that does not exist yet.
 *
 * So it is a page: a title you type into like a heading, a body with the same
 * formatting the composers have, and the rest of the brief underneath. What
 * you write is what the editor and the agent read afterwards, and the
 * formatting shows as you type rather than after you save.
 */
export type BriefDraft = {
  title: string;
  angle: string;
  targetChannel: string;
  aspect: string;
  targetSeconds: string;
  language: string;
  subtitleLanguage: string;
  mandatoryPoints: string;
};

const ASPECTS = ["16:9", "9:16", "1:1"] as const;

export function BriefComposer({
  zh,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  zh: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (draft: BriefDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BriefDraft>({
    title: "",
    angle: "",
    targetChannel: "",
    aspect: "16:9",
    targetSeconds: "",
    language: "",
    subtitleLanguage: "",
    mandatoryPoints: "",
  });
  const [preview, setPreview] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  /** Open while a link's address is being typed. */
  const [linking, setLinking] = useState(false);
  const set = <K extends keyof BriefDraft>(k: K, v: BriefDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const t = (en: string, cn: string) => (zh ? cn : en);

  return (
    <div
      onMouseDown={busy ? undefined : onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 210,
        background: "rgba(23,23,23,0.2)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "6vh 18px 18px",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("New script", "新建剧本")}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.title.trim()) onSubmit(draft);
        }}
        style={{
          width: "min(720px, 100%)",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          borderRadius: 14,
          border: "1px solid #e2e2e2",
          boxShadow: "0 28px 72px rgba(23,23,23,0.24)",
          overflow: "hidden",
          animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both",
        }}
      >
        {/* ---- title bar ---- */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "13px 18px",
            borderBottom: "1px solid #f3f3f3",
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("New script", "新建剧本")}</span>
          <span style={{ fontSize: 11, color: "#c7c7c7" }}>
            {t("the brief the editor and the agent will read", "编辑器和助理都会读这份简报")}
          </span>
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            style={{ ...chip, marginLeft: "auto", background: preview ? "#f3f3f3" : "#fff" }}
          >
            {preview ? t("Write", "编辑") : t("Preview", "预览")}
          </button>
        </div>

        {/* ---- the document ---- */}
        <div style={{ overflowY: "auto", minHeight: 0, padding: "22px 30px 8px" }}>
          <input
            autoFocus
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder={t("Untitled script", "未命名剧本")}
            style={{
              width: "100%",
              border: 0,
              outline: "none",
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              fontFamily: "inherit",
              color: "#171717",
              padding: 0,
            }}
          />

          <div style={{ display: "flex", gap: 2, margin: "16px 0 8px" }}>
            {(
              [
                ["bold", "B", { fontWeight: 700 }],
                ["italic", "I", { fontStyle: "italic" }],
                ["list", "•", {}],
                ["link", "↗", {}],
                ["code", "</>", { fontSize: 10.5 }],
              ] as [Format, string, React.CSSProperties][]
            ).map(([format, label, style]) => (
              <button
                key={format}
                type="button"
                aria-label={format}
                title={format}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (format === "link") {
                    setLinking(true);
                    return;
                  }
                  formatRich(body.current, format, (v) => set("angle", v), () => null);
                }}
                style={{
                  width: 28,
                  height: 26,
                  border: 0,
                  borderRadius: 7,
                  background: "transparent",
                  cursor: "pointer",
                  color: "#525252",
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  ...style,
                }}
              >
                {label}
              </button>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#c7c7c7", alignSelf: "center" }}>
              {t("Bold is bold. Saved as Markdown.", "所见即所得，保存为 Markdown。")}
            </span>
          </div>

          {preview ? (
            <div
              style={{
                minHeight: 200,
                fontSize: 13.5,
                lineHeight: 1.7,
                color: "#383838",
                borderTop: "1px solid #f3f3f3",
                paddingTop: 14,
              }}
            >
              {draft.angle.trim() ? (
                <Markdown text={draft.angle} />
              ) : (
                <p style={{ color: "#c7c7c7", margin: 0 }}>{t("Nothing written yet.", "还没有内容。")}</p>
              )}
            </div>
          ) : (
            <RichText
              editorRef={body}
              value={draft.angle}
              onChange={(v) => set("angle", v)}
              ariaLabel={t("The brief", "创作简报")}
              placeholder={t(
                "What is this video about, and what is the angle? Write it the way you would brief a person.",
                "这支片子讲什么，切入角度是什么？像给同事交待一样写下来。",
              )}
              style={{
                letterSpacing: "inherit",
                color: "#383838",
                borderTop: "1px solid #f3f3f3",
                paddingTop: 14,
              }}
            />
          )}

          {linking ? (
            <NameDialog
              title={t("Link to", "链接到")}
              placeholder="https://"
              confirm={t("Add link", "添加链接")}
              cancel={t("Cancel", "取消")}
              onClose={() => setLinking(false)}
              onSubmit={(url) => {
                setLinking(false);
                if (!/^https?:\/\//i.test(url)) return;
                formatRich(body.current, "link", (v) => set("angle", v), () => url);
              }}
            />
          ) : null}

          <div className="lbl" style={{ padding: 0, margin: "22px 0 8px" }}>
            {t("Points it has to make", "必须讲到的点")}
          </div>
          <textarea
            value={draft.mandatoryPoints}
            onChange={(e) => set("mandatoryPoints", e.target.value)}
            placeholder={t("One per line.", "一行一条。")}
            style={{ ...field, minHeight: 78, resize: "vertical", lineHeight: 1.7, padding: "9px 11px" }}
          />

          <div className="lbl" style={{ padding: 0, margin: "20px 0 8px" }}>
            {t("Where it goes", "投放设置")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 9 }}>
            <Labelled label={t("Channel", "渠道")}>
              <input
                value={draft.targetChannel}
                onChange={(e) => set("targetChannel", e.target.value)}
                placeholder={t("YouTube, LinkedIn…", "YouTube、领英…")}
                style={field}
              />
            </Labelled>
            <Labelled label={t("Length in seconds", "时长（秒）")}>
              <input
                value={draft.targetSeconds}
                onChange={(e) => set("targetSeconds", e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="600"
                style={field}
              />
            </Labelled>
            <Labelled label={t("Spoken language", "口语语言")}>
              <input
                value={draft.language}
                onChange={(e) => set("language", e.target.value)}
                placeholder={t("Cantonese, Mandarin, English…", "粤语、普通话、英语…")}
                style={field}
              />
            </Labelled>
            <Labelled label={t("Subtitles", "字幕")}>
              <input
                value={draft.subtitleLanguage}
                onChange={(e) => set("subtitleLanguage", e.target.value)}
                placeholder={t("繁體中文, English…", "繁體中文、English…")}
                style={field}
              />
            </Labelled>
          </div>

          <div className="lbl" style={{ padding: 0, margin: "18px 0 7px" }}>
            {t("Aspect", "画幅")}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {ASPECTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => set("aspect", a)}
                style={{
                  ...chip,
                  background: draft.aspect === a ? "#171717" : "#fff",
                  color: draft.aspect === a ? "#fff" : "#525252",
                  borderColor: draft.aspect === a ? "#171717" : "#ededed",
                }}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p style={{ fontSize: 12, color: "#e03636", padding: "0 30px", margin: "8px 0 0" }}>{error}</p>
        )}

        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 18px 14px",
            borderTop: "1px solid #f3f3f3",
          }}
        >
          <span style={{ fontSize: 11, color: "#c7c7c7" }}>
            {t("Everything here can be changed afterwards.", "这里的内容之后都可以改。")}
          </span>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...ghost, marginLeft: "auto" }}>
            {t("Cancel", "取消")}
          </button>
          <button
            type="button"
            onClick={() => onSubmit(draft)}
            disabled={busy || !draft.title.trim()}
            style={{ ...solid, opacity: busy || !draft.title.trim() ? 0.45 : 1 }}
          >
            {busy ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <Spinner />
                {t("Creating…", "创建中…")}
              </span>
            ) : (
              t("Create the script", "创建剧本")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10.5, fontWeight: 500, color: "#999999" }}>{label}</span>
      {children}
    </label>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, animation: "auraSpin 1s linear infinite" }}>
      <circle cx="12" cy="12" r="8.6" stroke="rgba(255,255,255,.3)" strokeWidth="3" fill="none" />
      <path d="M12 3.4a8.6 8.6 0 0 1 8.6 8.6" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const field: React.CSSProperties = {
  width: "100%",
  height: 32,
  padding: "0 11px",
  border: "1px solid #e2e2e2",
  borderRadius: 8,
  outline: "none",
  background: "#fff",
  fontSize: 12.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  color: "#171717",
};

const chip: React.CSSProperties = {
  height: 26,
  padding: "0 11px",
  borderRadius: 7,
  border: "1px solid #ededed",
  background: "#fff",
  color: "#525252",
  fontSize: 11.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};

const ghost: React.CSSProperties = {
  height: 32,
  padding: "0 13px",
  borderRadius: 8,
  border: "1px solid #ededed",
  background: "#fff",
  color: "#525252",
  fontSize: 12.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};

const solid: React.CSSProperties = {
  height: 32,
  padding: "0 15px",
  borderRadius: 8,
  border: 0,
  background: "#171717",
  color: "#fff",
  fontSize: 12.5,
  fontWeight: 500,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};
