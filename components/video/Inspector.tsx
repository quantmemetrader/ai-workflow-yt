"use client";

import type { CaptionRow, ClipRow, GraphicRow, ItemRow } from "@/lib/video/service";
import { ENTRANCES, ENTRANCE_LABELS, GRAPHIC_KINDS, TRANSITIONS, TRANSITION_LABELS, type TransitionKind } from "@/lib/video/presets";
import { PLACEMENTS } from "@/lib/video/icons";
import type { Selection } from "@/components/video/Editor";

/**
 * Everything about whatever is selected, and nothing about anything else.
 *
 * The forms this replaces put every control for every cut on screen at once,
 * so a timeline of twenty cuts was forty timecode boxes and the one you wanted
 * was somewhere in the middle. An inspector is the same controls, shown when
 * they are about something.
 *
 * With nothing selected it is not empty: it is where the first cut is offered,
 * because that is what somebody who has just uploaded footage wants and it is
 * the only thing on this screen that does the whole job at once.
 */
const INK = "#171717";
const LINE = "#ededed";

const box: React.CSSProperties = {
  width: "100%",
  height: 28,
  borderRadius: 6,
  border: `1px solid ${LINE}`,
  background: "#ffffff",
  color: INK,
  padding: "0 8px",
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
};

const button: React.CSSProperties = {
  height: 28,
  padding: "0 10px",
  borderRadius: 6,
  border: `1px solid ${LINE}`,
  background: "transparent",
  color: INK,
  fontSize: 11.5,
  fontFamily: "inherit",
  cursor: "pointer",
};

export function Inspector({
  selected,
  items,
  clips,
  captions,
  graphics,
  zh,
  busy,
  hasCaptions,
  onTrim,
  onTransition,
  onAsk,
  onMove,
  onRemove,
  onCaption,
  onRemoveCaption,
  onGraphic,
  onRemoveGraphic,
}: {
  selected: Selection;
  items: ItemRow[];
  clips: ClipRow[];
  captions: CaptionRow[];
  graphics: GraphicRow[];
  zh: boolean;
  busy: boolean;
  /** Without a transcript there is nothing for the assistant to work from. */
  hasCaptions: boolean;
  onTrim: (itemId: string, input: { inMs: number; outMs: number }) => void;
  /** How this cut arrives from the one before it. */
  onTransition: (itemId: string, input: { transition: TransitionKind; transitionMs?: number }) => void;
  /** Hands a prompt to the assistant beside this panel. The examples used to
   * be dead text that looked exactly like buttons. */
  onAsk?: (prompt: string) => void;
  onMove: (itemId: string, direction: "up" | "down") => void;
  onRemove: (itemId: string) => void;
  onCaption: (id: string, input: { text?: string; startMs?: number; endMs?: number }) => void;
  onRemoveCaption: (id: string) => void;
  onGraphic: (
    id: string,
    input: { text?: string; sub?: string | null; startMs?: number; endMs?: number; enter?: string; placement?: string; scale?: number; zoom?: number; sourceInMs?: number },
  ) => void;
  onRemoveGraphic: (id: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);

  /* ---------------------------------------------------- nothing selected */
  if (selected === null) {
    /*
     * Not a form, and not a button.
     *
     * This used to be a "Cut this for me" card that did one pass and then had
     * nothing more to offer — every change after it meant finding a control.
     * The assistant below does that pass *and* everything after it, so this is
     * a short note about how to ask rather than a second way to do one thing.
     */
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <p style={{ fontSize: 11.5, color: "#525252", lineHeight: 1.65, margin: 0 }}>
          {hasCaptions
            ? t(
                "Ask for the change below and it makes it. Or select a clip, caption or graphic on the timeline to nudge it by hand.",
                "在下方直接说要改什么，它就会改。也可以在时间线上选中片段、字幕或图形手动微调。",
              )
            : t(
                "Transcribe this in the Audio tab first — cutting, captions and chapter marks are all built on what was actually said.",
                "请先在“音频”标签页转写：剪辑、字幕与章节都建立在实际说出的内容之上。",
              )}
        </p>

        {hasCaptions ? (
          /* Chips, and they work: each one is the prompt it shows, sent
             straight to the assistant. Laid out as a wrapping row rather than
             a stack of full-width bars, which took a third of the panel to
             say four things. */
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {[
              t("Make a first cut", "生成初剪"),
              t("Take out the pauses", "去掉停顿"),
              t("Put my name on for the first five seconds", "开头五秒加上我的姓名条"),
              t("Cut the bit where I stumble", "剪掉我口误的那段"),
            ].map((example) => (
              <button
                key={example}
                type="button"
                disabled={busy || !onAsk}
                onClick={() => onAsk?.(example)}
                title={onAsk ? t("Ask this", "直接问这个") : undefined}
                style={{
                  fontSize: 10,
                  color: "#525252",
                  background: "#f6f6f6",
                  border: "1px solid #ededed",
                  borderRadius: 999,
                  padding: "2px 8px",
                  lineHeight: 1.3,
                  textAlign: "left",
                  cursor: onAsk && !busy ? "pointer" : "default",
                  font: "inherit",
                  fontFamily: "inherit",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}

        <p style={{ fontSize: 10.5, color: "#999999", lineHeight: 1.6, margin: 0 }}>
          {t("Space plays · arrows step · S splits at the playhead", "空格播放 · 方向键微调 · S 在播放头处切开")}
        </p>
      </div>
    );
  }

  /* -------------------------------------------------------------- a cut */
  if (selected.kind === "item") {
    const item = items.find((i) => i.id === selected.id);
    if (!item) return <Gone zh={zh} />;
    const clip = item.clipId ? clips.find((c) => c.id === item.clipId) : undefined;
    const n = items.findIndex((i) => i.id === item.id);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label={t("Source", "来源")}>
          <div style={{ fontSize: 12, color: "#383838", overflow: "hidden", textOverflow: "ellipsis" }}>
            {item.kind === "title" ? t("Title card", "标题卡") : (item.clipLabel ?? "—")}
          </div>
        </Field>

        {item.kind !== "title" ? (
          <>
            <Field label={t("In", "入点")}>
              <input
                key={`${item.id}-in`}
                defaultValue={stamp(item.inMs)}
                onBlur={(e) => {
                  const ms = parse(e.target.value);
                  if (ms !== null && ms !== item.inMs) {
                    onTrim(item.id, { inMs: ms, outMs: item.outMs ?? ms + item.lengthMs });
                  }
                }}
                style={box}
              />
            </Field>
            <Field label={t("Out", "出点")}>
              <input
                key={`${item.id}-out`}
                defaultValue={stamp(item.outMs ?? item.inMs + item.lengthMs)}
                onBlur={(e) => {
                  const ms = parse(e.target.value);
                  if (ms !== null && ms !== item.outMs) onTrim(item.id, { inMs: item.inMs, outMs: ms });
                }}
                style={box}
              />
            </Field>
            <div style={{ fontSize: 11, color: "#999999" }}>
              {t("Length", "时长")} {(item.lengthMs / 1000).toFixed(1)}s
              {clip?.durationMs ? ` ${t("of", "／")} ${(clip.durationMs / 1000).toFixed(1)}s` : ""}
            </div>
          </>
        ) : null}

        {/* How it arrives. Only on a cut that has something to arrive from:
            the first item on the timeline has nothing before it, and offering
            a fade there would promise a fade-up from black that the renderer
            does not do. */}
        {n > 0 ? (
          <>
            <Field label={t("Arrives", "转场")}>
              <select
                value={item.transition}
                disabled={busy}
                onChange={(e) => onTransition(item.id, { transition: e.target.value as TransitionKind })}
                style={{ ...box, cursor: "pointer" }}
              >
                {TRANSITIONS.map((key) => (
                  <option key={key} value={key}>
                    {zh ? TRANSITION_LABELS[key].zh : TRANSITION_LABELS[key].en}
                  </option>
                ))}
              </select>
            </Field>
            {item.transition !== "cut" ? (
              <Field label={t("Over", "时长")}>
                <input
                  key={`${item.id}-tms`}
                  defaultValue={(item.transitionMs / 1000).toFixed(2)}
                  onBlur={(e) => {
                    const seconds = Number(e.target.value);
                    if (Number.isFinite(seconds) && Math.round(seconds * 1000) !== item.transitionMs) {
                      onTransition(item.id, {
                        transition: item.transition,
                        transitionMs: Math.round(seconds * 1000),
                      });
                    }
                  }}
                  style={box}
                />
              </Field>
            ) : null}
            <p style={{ fontSize: 10.5, color: "#999999", lineHeight: 1.6, margin: 0 }}>
              {zh ? TRANSITION_LABELS[item.transition].noteZh : TRANSITION_LABELS[item.transition].note}
            </p>
          </>
        ) : null}

        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button type="button" disabled={busy || n <= 0} onClick={() => onMove(item.id, "up")} style={button}>
            ← {t("Earlier", "前移")}
          </button>
          <button
            type="button"
            disabled={busy || n === items.length - 1}
            onClick={() => onMove(item.id, "down")}
            style={button}
          >
            {t("Later", "后移")} →
          </button>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRemove(item.id)}
          style={{ ...button, color: "#e03636", borderColor: "#f3d6d6" }}
        >
          {t("Remove this cut", "删除这个片段")}
        </button>
      </div>
    );
  }

  /* ---------------------------------------------------------- a caption */
  if (selected.kind === "caption") {
    const cue = captions.find((c) => c.id === selected.id);
    if (!cue) return <Gone zh={zh} />;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label={t("Words", "文字")}>
          <textarea
            key={`${cue.id}-text`}
            defaultValue={cue.text}
            onBlur={(e) => e.target.value !== cue.text && onCaption(cue.id, { text: e.target.value })}
            rows={3}
            style={{ ...box, height: "auto", padding: 8, lineHeight: 1.45, resize: "vertical" }}
          />
        </Field>
        <div style={{ display: "flex", gap: 8 }}>
          <Field label={t("From", "起")}>
            <input
              key={`${cue.id}-from`}
              defaultValue={stamp(cue.startMs)}
              onBlur={(e) => {
                const ms = parse(e.target.value);
                if (ms !== null && ms !== cue.startMs) onCaption(cue.id, { startMs: ms });
              }}
              style={box}
            />
          </Field>
          <Field label={t("To", "止")}>
            <input
              key={`${cue.id}-to`}
              defaultValue={stamp(cue.endMs)}
              onBlur={(e) => {
                const ms = parse(e.target.value);
                if (ms !== null && ms !== cue.endMs) onCaption(cue.id, { endMs: ms });
              }}
              style={box}
            />
          </Field>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRemoveCaption(cue.id)}
          style={{ ...button, color: "#e03636", borderColor: "#f3d6d6" }}
        >
          {t("Remove", "删除")}
        </button>
      </div>
    );
  }

  /* ---------------------------------------------------------- a graphic */
  const g = graphics.find((x) => x.id === selected.id);
  if (!g) return <Gone zh={zh} />;
  const meta = GRAPHIC_KINDS.find((k) => k.key === g.kind);
  const opts = (g.options ?? {}) as Record<string, unknown>;
  const isPunch = g.kind === "punch";
  const isBroll = g.kind === "broll";
  const isPicture = g.kind === "image" || g.kind === "icon";
  const placements = isBroll ? ["pip", "full", "top-right", "bottom-right"] : g.kind === "icon" ? PLACEMENTS.filter((p) => p !== "full") : [...PLACEMENTS];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Field label={t("Kind", "类型")}>
        <div style={{ fontSize: 12, color: "#383838" }}>{meta ? (zh ? meta.nameZh : meta.name) : g.kind}</div>
        {meta ? <div style={{ fontSize: 10.5, color: "#999999", lineHeight: 1.5, marginTop: 2 }}>{zh ? meta.noteZh : meta.note}</div> : null}
      </Field>

      {isPunch ? (
        <Field label={t("Zoom", "推近倍数")}>
          <input
            key={`${g.id}-zoom`}
            defaultValue={(Number(opts.zoom ?? 1.15) || 1.15).toFixed(2)}
            onBlur={(e) => {
              const z = Number(e.target.value);
              if (Number.isFinite(z) && z > 1) onGraphic(g.id, { zoom: z });
            }}
            style={box}
          />
        </Field>
      ) : null}

      {isBroll ? (
        <Field label={t("Start in the clip", "素材起点")}>
          <input
            key={`${g.id}-src`}
            defaultValue={stamp(Number(opts.sourceInMs ?? 0) || 0)}
            onBlur={(e) => {
              const ms = parse(e.target.value);
              if (ms !== null) onGraphic(g.id, { sourceInMs: ms });
            }}
            style={box}
          />
        </Field>
      ) : null}

      {!isPunch && !isBroll ? (
        <>
          <Field label={isPicture ? t("Caption", "说明") : t("The line", "文字")}>
            <input
              key={`${g.id}-text`}
              defaultValue={g.text}
              onBlur={(e) => e.target.value !== g.text && onGraphic(g.id, { text: e.target.value })}
              style={box}
            />
          </Field>
          {meta?.hasSub ? (
            <Field label={t("Second line", "第二行")}>
              <input
                key={`${g.id}-sub`}
                defaultValue={g.sub ?? ""}
                onBlur={(e) => (e.target.value || null) !== g.sub && onGraphic(g.id, { sub: e.target.value })}
                style={box}
              />
            </Field>
          ) : null}
          <Field label={t("Arrives", "入场")}>
            <select
              value={typeof opts.enter === "string" && (ENTRANCES as readonly string[]).includes(opts.enter) ? opts.enter : "fade"}
              disabled={busy}
              onChange={(e) => onGraphic(g.id, { enter: e.target.value })}
              style={{ ...box, cursor: "pointer" }}
            >
              {ENTRANCES.map((key) => (
                <option key={key} value={key}>
                  {zh ? ENTRANCE_LABELS[key].zh : ENTRANCE_LABELS[key].en}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}

      {isPicture || isBroll ? (
        <Field label={t("Where", "位置")}>
          <select value={g.placement} disabled={busy} onChange={(e) => onGraphic(g.id, { placement: e.target.value })} style={{ ...box, cursor: "pointer" }}>
            {placements.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <div style={{ display: "flex", gap: 8 }}>
        <Field label={t("From", "起")}>
          <input
            key={`${g.id}-from`}
            defaultValue={stamp(g.startMs)}
            onBlur={(e) => {
              const ms = parse(e.target.value);
              if (ms !== null && ms !== g.startMs) {
                onGraphic(g.id, { startMs: ms, endMs: ms + (g.endMs - g.startMs) });
              }
            }}
            style={box}
          />
        </Field>
        <Field label={t("Seconds", "秒数")}>
          <input
            key={`${g.id}-len`}
            defaultValue={((g.endMs - g.startMs) / 1000).toFixed(1)}
            onBlur={(e) => {
              const secs = Number(e.target.value);
              if (Number.isFinite(secs) && secs > 0) onGraphic(g.id, { endMs: g.startMs + secs * 1000 });
            }}
            style={box}
          />
        </Field>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => onRemoveGraphic(g.id)}
        style={{ ...button, color: "#e03636", borderColor: "#f3d6d6" }}
      >
        {t("Remove", "删除")}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", flexGrow: 1, minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 10, color: "#999999", marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

/** Selected, then deleted by somebody else. Says so rather than showing an
 * empty form that saves nowhere. */
function Gone({ zh }: { zh: boolean }) {
  return (
    <p style={{ fontSize: 11.5, color: "#999999", margin: 0 }}>
      {zh ? "这个元素已经不在了。" : "That is no longer on the timeline."}
    </p>
  );
}

/** "1:04.2" or "64.2" or "64" — people type all three. */
function parse(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const parts = text.split(":");
  const secs = parts.length === 1 ? Number(parts[0]) : Number(parts[0]) * 60 + Number(parts[1]);
  return Number.isFinite(secs) ? Math.max(0, Math.round(secs * 1000)) : null;
}

function stamp(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  return `${m}:${(total - m * 60).toFixed(1).padStart(4, "0")}`;
}
