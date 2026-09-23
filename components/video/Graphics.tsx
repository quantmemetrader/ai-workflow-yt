"use client";

import { useState } from "react";
import type { GraphicRow } from "@/lib/video/service";
import { CAPTION_PRESETS, GRAPHIC_KINDS } from "@/lib/video/presets";
import { ICON_NAMES, ICONS, PLACEMENTS } from "@/lib/video/icons";
import { Badge, Empty, field, ghost, solid } from "@/components/ui/kit";

/** Plain words for the six places a picture or an icon can sit. */
const PLACEMENT_LABELS: Record<string, [string, string]> = {
  center: ["Middle", "居中"],
  "bottom-center": ["Bottom centre", "底部居中"],
  "top-left": ["Top left", "左上"],
  "top-right": ["Top right", "右上"],
  "bottom-left": ["Bottom left", "左下"],
  "bottom-right": ["Bottom right", "右下"],
  full: ["Fills the frame", "满屏"],
};

/**
 * Titles, lower thirds and end cards — and the one look the whole video wears.
 *
 * Ten kinds, not fifty, and the list lives in `lib/video/presets` so the
 * picker, the validation, the agent and the renderer cannot disagree about
 * what exists. It is short on purpose: a menu of forty effects is how a video
 * ends up wearing six of them.
 *
 * The same goes for the caption presets. They are chosen once for the project
 * rather than per line, because captions that change style between sentences
 * is the exact thing the house rules exist to prevent.
 */
/* Cutaways and punch-ins are placed from the timeline (select a moment, ask,
   or let the director do it); this form has no clip picker or zoom, so it
   does not offer them. */
const KINDS = GRAPHIC_KINDS.filter((k) => k.key !== "broll" && k.key !== "punch");

const ACCENTS = ["#007be0", "#e03636", "#278f5e", "#db7706", "#7c3aed", "#171717"];

export function Graphics({
  graphics,
  pictures = [],
  captionPreset,
  accent,
  totalMs,
  zh,
  busy,
  onAdd,
  onUpdate,
  onRemove,
  onLook,
}: {
  graphics: GraphicRow[];
  captionPreset: string;
  accent: string;
  totalMs: number;
  zh: boolean;
  busy: boolean;
  /** Pictures in the studio's store this person can open, for an image graphic. */
  pictures?: { id: string; name: string }[];
  onAdd: (input: {
    kind: string;
    text: string;
    sub: string | null;
    startMs: number;
    endMs: number;
    fileId?: string | null;
    icon?: string | null;
    placement?: string | null;
    scale?: number | null;
  }) => void;
  onUpdate: (id: string, input: { text?: string; sub?: string | null; startMs?: number; endMs?: number }) => void;
  onRemove: (id: string) => void;
  onLook: (input: { captionPreset?: string; accent?: string }) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [kind, setKind] = useState<string>("lower-third");
  const [text, setText] = useState("");
  const [sub, setSub] = useState("");
  const [start, setStart] = useState("0:00");
  const [seconds, setSeconds] = useState("3");
  /* Only two kinds use these, and they are hidden for the rest rather than
     greyed out: a control that cannot do anything is noise. */
  const [fileId, setFileId] = useState("");
  const [icon, setIcon] = useState<string>(ICON_NAMES[0] ?? "check");
  const [placement, setPlacement] = useState<string>("center");

  const chosen = KINDS.find((k) => k.key === kind) ?? KINDS[0];

  const isPicture = kind === "image";
  const isIcon = kind === "icon";
  // A picture is the graphic; an icon is the graphic. Everything else needs
  // words, and without them there is nothing to put on screen.
  const canSubmit = isPicture ? Boolean(fileId) : isIcon ? true : Boolean(text.trim());

  const submit = () => {
    const startMs = parseClock(start) ?? 0;
    const dur = Math.max(0.5, Number(seconds) || 3) * 1000;
    if (!canSubmit) return;
    onAdd({
      kind,
      text: text.trim(),
      sub: chosen.hasSub && sub.trim() ? sub.trim() : null,
      startMs,
      endMs: startMs + dur,
      fileId: isPicture ? fileId : null,
      icon: isIcon ? icon : null,
      placement: isPicture || isIcon ? placement : null,
      scale: isIcon ? 18 : isPicture ? 40 : null,
    });
    setText("");
    setSub("");
  };

  return (
    <>
      {/* ---------------------------------------------------------- look */}
      <section style={{ marginBottom: 26 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{t("The look", "整体风格")}</span>
          <span style={{ fontSize: 11.5, color: "#999999" }}>
            {t("chosen once, for the whole video", "整支视频只选一次")}
          </span>
        </div>
        <p style={{ fontSize: 11.5, color: "#999999", lineHeight: 1.6, margin: "0 0 12px", maxWidth: 560 }}>
          {t(
            "Captions that change style between sentences are the thing viewers notice without being able to say why. So the preset belongs to the project, not to the line.",
            "字幕风格在句子之间变化，是观众说不出原因但一定会察觉的问题。所以风格属于项目，而不是某一条字幕。",
          )}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))", gap: 9 }}>
          {CAPTION_PRESETS.map((p) => {
            const on = p.key === captionPreset;
            return (
              <button
                key={p.key}
                type="button"
                disabled={busy}
                onClick={() => onLook({ captionPreset: p.key })}
                style={{
                  textAlign: "left",
                  border: `1px solid ${on ? "#171717" : "#ededed"}`,
                  background: on ? "#fafafa" : "#fff",
                  borderRadius: 11,
                  padding: "11px 12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{zh ? p.nameZh : p.name}</span>
                  {on ? <Badge tone="good">{t("in use", "使用中")}</Badge> : null}
                </div>
                {/* What it looks like, rather than what it is called. */}
                <div
                  style={{
                    height: 34,
                    borderRadius: 7,
                    background: "#2a2a2a",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 7,
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      fontSize: Math.max(9, p.style.sizeRatio * 210),
                      fontWeight: p.style.weight,
                      color: p.style.karaoke ? accent : "#fff",
                      background: p.style.treatment === "plate" ? "rgba(0,0,0,0.6)" : "transparent",
                      padding: p.style.treatment === "plate" ? "2px 7px" : 0,
                      borderRadius: 4,
                      textShadow: p.style.treatment === "shadow" ? "0 1px 4px rgba(0,0,0,0.9)" : "none",
                      WebkitTextStroke: p.style.treatment === "outline" ? "0.6px rgba(0,0,0,0.9)" : undefined,
                    }}
                  >
                    {t("The line reads like this", "字幕大概是这样")}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#7c7c7c", lineHeight: 1.5 }}>{zh ? p.noteZh : p.note}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14 }}>
          <span style={{ fontSize: 12, color: "#525252" }}>{t("One loud colour", "唯一的强调色")}</span>
          {ACCENTS.map((hex) => (
            <button
              key={hex}
              type="button"
              disabled={busy}
              aria-label={hex}
              aria-pressed={hex.toLowerCase() === accent.toLowerCase()}
              onClick={() => onLook({ accent: hex })}
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                background: hex,
                border: hex.toLowerCase() === accent.toLowerCase() ? "2px solid #171717" : "1px solid #ededed",
                boxShadow: hex.toLowerCase() === accent.toLowerCase() ? "0 0 0 2px #fff inset" : "none",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
          <span style={{ fontSize: 11, color: "#c7c7c7" }}>
            {t("it lands on the graphics, never on the background", "只出现在图形元素上，绝不铺满背景")}
          </span>
        </div>
      </section>

      {/* ------------------------------------------------------ graphics */}
      <section>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{t("Graphics", "图形")}</span>
          <span style={{ fontSize: 11.5, color: "#999999" }}>
            {t("drawn at render time and laid over the cut", "渲染时绘制，叠加在画面上")}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "flex-start",
            border: "1px solid #ededed",
            borderRadius: 12,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...field, width: 148, height: 32 }}>
            {KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {zh ? k.nameZh : k.name}
              </option>
            ))}
          </select>
          {isPicture ? (
            <select
              value={fileId}
              onChange={(e) => setFileId(e.target.value)}
              aria-label={t("Which picture", "选择图片")}
              style={{ ...field, flexGrow: 1, minWidth: 180, height: 32, cursor: "pointer" }}
            >
              <option value="">
                {pictures.length
                  ? t("Pick a picture…", "选择图片…")
                  : t("No pictures in Files yet", "文件库里还没有图片")}
              </option>
              {pictures.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : null}

          {isIcon ? (
            <select
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              aria-label={t("Which icon", "选择图标")}
              style={{ ...field, width: 150, height: 32, cursor: "pointer" }}
            >
              {ICON_NAMES.map((name) => (
                <option key={name} value={name}>
                  {zh ? ICONS[name].labelZh : ICONS[name].label}
                </option>
              ))}
            </select>
          ) : null}

          {isPicture || isIcon ? (
            <select
              value={placement}
              onChange={(e) => setPlacement(e.target.value)}
              aria-label={t("Where", "位置")}
              style={{ ...field, width: 128, height: 32, cursor: "pointer" }}
            >
              {PLACEMENTS.filter((p) => p !== "full" || isPicture).map((p) => (
                <option key={p} value={p}>
                  {PLACEMENT_LABELS[p][zh ? 1 : 0]}
                </option>
              ))}
            </select>
          ) : null}

          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              isPicture || isIcon ? t("A word under it, optional", "下方文字，可选") : t("The line", "文字")
            }
            style={{ ...field, flexGrow: 1, minWidth: 140, height: 32 }}
          />
          {chosen.hasSub ? (
            <input
              value={sub}
              onChange={(e) => setSub(e.target.value)}
              placeholder={t("Second line, optional", "第二行，可选")}
              style={{ ...field, width: 172, height: 32 }}
            />
          ) : null}
          <input
            value={start}
            onChange={(e) => setStart(e.target.value)}
            aria-label={t("Starts at", "开始于")}
            placeholder="0:00"
            style={{ ...field, width: 74, height: 32, textAlign: "center" }}
          />
          <input
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            aria-label={t("Seconds", "秒数")}
            style={{ ...field, width: 62, height: 32, textAlign: "center" }}
          />
          <button
            type="button"
            disabled={busy || !canSubmit}
            onClick={submit}
            style={{ ...solid, opacity: busy || !canSubmit ? 0.45 : 1 }}
          >
            {t("Add", "添加")}
          </button>
          <div style={{ flexBasis: "100%", fontSize: 11, color: "#999999", lineHeight: 1.5 }}>
            {zh ? chosen.noteZh : chosen.note}
            {totalMs > 0 ? ` · ${t("the cut is", "本片长")} ${clock(totalMs)}` : ""}
          </div>
        </div>

        {graphics.length === 0 ? (
          <Empty
            title={t("No graphics yet", "还没有图形")}
            body={t(
              "A name under the person speaking is usually the first one. Nothing here is required — a video with no graphics at all is a perfectly good video.",
              "通常第一个会是说话人的姓名条。这些都不是必需的：完全没有图形的视频同样成立。",
            )}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {graphics.map((g) => {
              const meta = KINDS.find((k) => k.key === g.kind);
              return (
                <div
                  key={g.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    border: "1px solid #ededed",
                    borderRadius: 10,
                    padding: "9px 11px",
                    flexWrap: "wrap",
                  }}
                >
                  <Badge tone="quiet">{meta ? (zh ? meta.nameZh : meta.name) : g.kind}</Badge>
                  <input
                    defaultValue={g.text}
                    onBlur={(e) => e.target.value !== g.text && onUpdate(g.id, { text: e.target.value })}
                    style={{ ...field, flexGrow: 1, minWidth: 160, height: 28 }}
                  />
                  {meta?.hasSub ? (
                    <input
                      defaultValue={g.sub ?? ""}
                      placeholder={t("Second line", "第二行")}
                      onBlur={(e) => (e.target.value || null) !== g.sub && onUpdate(g.id, { sub: e.target.value })}
                      style={{ ...field, width: 150, height: 28 }}
                    />
                  ) : null}
                  <input
                    defaultValue={clock(g.startMs)}
                    aria-label={t("Starts at", "开始于")}
                    onBlur={(e) => {
                      const ms = parseClock(e.target.value);
                      if (ms !== null && ms !== g.startMs) onUpdate(g.id, { startMs: ms, endMs: ms + (g.endMs - g.startMs) });
                    }}
                    style={{ ...field, width: 70, height: 28, textAlign: "center" }}
                  />
                  <span style={{ fontSize: 11, color: "#999999" }}>
                    {((g.endMs - g.startMs) / 1000).toFixed(1)}s
                  </span>
                  <button type="button" disabled={busy} onClick={() => onRemove(g.id)} style={ghost}>
                    {t("Remove", "删除")}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

/** "1:23" or "83" or "1:23.5" to milliseconds. People type all three; a
 * value that is none of them is null rather than a silent zero. */
function parseClock(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const parts = text.split(":");
  const seconds =
    parts.length === 1
      ? Number(parts[0])
      : Number(parts[0]) * 60 + Number(parts[1]);
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : null;
}

function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
