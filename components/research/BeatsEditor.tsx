"use client";

import React from "react";
import { BEAT_COLORS, BEAT_LIMITS, DEFAULT_BEATS, beatColor, isDefaultBeat, makeBeatKey, normalizeBeats, type BeatColor, type BeatConfig } from "@/lib/research/beats";

/**
 * 管理赛道: the studio's research beats, edited in a side sheet over the
 * Research page.
 *
 * The owner, on the chips "全部 247 · AI 58 · 加密 32 · 科技 86 · 商业 71":
 * "let me be able to change this list too". Everything a beat is lives here:
 * its name in Chinese and English, its colour (from the page's tint palette,
 * `BEAT_COLORS`), the words each platform is searched with, on or off, and
 * where it sits in the list. A beat the studio added can be deleted; the
 * four defaults can only be switched off, and "恢复默认" puts them back as
 * they were in one press (a beat the studio added stays).
 *
 * The sheet edits a copy and writes the whole list at once on 保存
 * (`PUT /api/research/beats`, checked again there by `normalizeBeats`), so
 * a half-edited beat never reaches the collector. A new beat's key is made
 * from its English name when it is first saved and never changes after:
 * renaming a beat changes its chip, not the key its rows are filed under.
 */

type Draft = BeatConfig & {
  /** Not saved yet: its key is made at save time from the name typed. */
  fresh?: boolean;
  /** A stable handle for React while the key may still change. */
  id: string;
};

let seq = 0;
const handle = () => `d${++seq}`;
const toDraft = (b: BeatConfig): Draft => ({ ...b, keywords_zh: [...b.keywords_zh], keywords_en: [...b.keywords_en], id: handle() });
const strip = (d: Draft): BeatConfig => ({ key: d.key, zh: d.zh, en: d.en, color: d.color, keywords_zh: d.keywords_zh, keywords_en: d.keywords_en, enabled: d.enabled });

export function BeatsEditor({
  zh,
  beats,
  counts,
  onClose,
  onSaved,
}: {
  zh: boolean;
  /** The list as saved. */
  beats: BeatConfig[];
  /** Rows per beat across the platforms, to show beside each beat. */
  counts: Record<string, number>;
  onClose: () => void;
  onSaved: (beats: BeatConfig[]) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [draft, setDraft] = React.useState<Draft[]>(() => beats.map(toDraft));
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const sheetRef = React.useRef<HTMLDivElement>(null);

  const dirty = JSON.stringify(draft.map(strip)) !== JSON.stringify(beats);
  const discard = t("Discard the changes you have not saved?", "有改动还没保存，放弃这些改动？");
  const close = React.useCallback(() => {
    if (dirty && !window.confirm(discard)) return;
    onClose();
  }, [dirty, discard, onClose]);

  /* Escape closes, as any sheet does; the sheet takes focus when it opens so
     the keyboard is inside it. */
  React.useEffect(() => {
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const update = (id: string, patch: Partial<Draft>) => {
    setDraft((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    setError(null);
  };
  const move = (id: string, by: -1 | 1) =>
    setDraft((list) => {
      const i = list.findIndex((d) => d.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (id: string) => {
    setDraft((list) => list.filter((d) => d.id !== id));
    setError(null);
  };
  const add = () => {
    if (draft.length >= BEAT_LIMITS.beats) return;
    /* The first colour no beat has yet, so a new chip stands apart. */
    const used = new Set(draft.map((d) => d.color));
    const color = (BEAT_COLORS.find((c) => !used.has(c.key)) ?? BEAT_COLORS[draft.length % BEAT_COLORS.length]).key;
    const d: Draft = { key: "", zh: "", en: "", color, keywords_zh: [], keywords_en: [], enabled: true, fresh: true, id: handle() };
    setDraft((list) => [...list, d]);
    setOpenId(d.id);
    setError(null);
  };
  /* The four defaults back as they were, first, switched on; beats the
     studio added keep their place after them. */
  const resetDefaults = () => {
    setDraft((list) => [...DEFAULT_BEATS.map(toDraft), ...list.filter((d) => !isDefaultBeat(d.key))]);
    setConfirmReset(false);
    setOpenId(null);
    setError(null);
  };

  async function save() {
    if (saving) return;
    /* Keys for new beats, from their names, now that the names are typed. */
    const taken: string[] = draft.filter((d) => !d.fresh).map((d) => d.key);
    const list: BeatConfig[] = draft.map((d) => {
      if (!d.fresh) return strip(d);
      const key = makeBeatKey(d.en || d.zh, taken);
      taken.push(key);
      return { ...strip(d), key };
    });
    const checked = normalizeBeats(list);
    if (!("beats" in checked)) {
      setError(zh ? checked.error : checked.errorEn);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/research/beats", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ beats: checked.beats }) }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string; errorEn?: string } | null;
      setError((zh ? body?.error : body?.errorEn) ?? t("Could not save the beats. Try again.", "赛道没保存上，再试一次。"));
      return;
    }
    const saved = ((await res.json()) as { beats: BeatConfig[] }).beats;
    onSaved(saved);
  }

  const on = draft.filter((d) => d.enabled).length;

  return (
    <div role="presentation" onClick={close} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(23,23,23,.18)", display: "flex", justifyContent: "flex-end" }}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("Manage beats", "管理赛道")}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 460, maxWidth: "100vw", height: "100%", background: "#ffffff", borderLeft: "1px solid #ededed", boxShadow: "-12px 0 32px rgba(0,0,0,.06)", display: "flex", flexDirection: "column", outline: "none" }}
      >
        {/* ---- head --------------------------------------------------- */}
        <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ minWidth: 0, flexGrow: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: "#171717" }}>{t("Manage beats", "管理赛道")}</div>
            <div style={{ fontSize: 12, color: "#7c7c7c", lineHeight: 1.6, marginTop: 3 }}>
              {t(
                "The researcher searches every platform for these beats and sorts what it finds into them, every three hours. Chinese words search 抖音, 小红书, B站, 微博 and Hong Kong/Taiwan news; English words search TikTok and YouTube.",
                "研究员每三小时按这些赛道搜各平台，并把搜到的内容分进赛道。中文关键词搜抖音、小红书、B站、微博和港台新闻；英文关键词搜 TikTok 和 YouTube。",
              )}
            </div>
          </div>
          <button type="button" onClick={close} aria-label={t("Close", "关闭")} style={iconBtn}>
            <Glyph d="M6 6l12 12M18 6 6 18" />
          </button>
        </div>

        {/* ---- the list ----------------------------------------------- */}
        <div style={{ flexGrow: 1, overflowY: "auto", padding: "10px 12px" }}>
          {draft.map((d, i) => {
            const open = openId === d.id;
            const c = beatColor(d.color);
            const words = d.keywords_zh.length + d.keywords_en.length;
            const n = d.fresh ? null : (counts[d.key] ?? 0);
            return (
              <div key={d.id} style={{ border: `1px solid ${open ? "#e2e2e2" : "#efefef"}`, borderRadius: 10, marginBottom: 8, background: open ? "#fcfcfc" : "#ffffff", opacity: d.enabled ? 1 : 0.62 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 8px 8px 12px" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 5, background: c.ink, flexShrink: 0 }} />
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : d.id)}
                    aria-expanded={open}
                    style={{ minWidth: 0, flexGrow: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, border: 0, background: "transparent", padding: 0, cursor: "pointer", font: "inherit", textAlign: "left" }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#171717", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                      {d.zh || t("New beat", "新赛道")}
                      {d.en && d.en !== d.zh ? <span style={{ fontWeight: 400, color: "#7c7c7c" }}> · {d.en}</span> : null}
                    </span>
                    <span style={{ fontSize: 11, color: "#999999", display: "flex", gap: 6, alignItems: "center" }}>
                      {t(`${words} keywords`, `${words} 个关键词`)}
                      {n !== null ? <span>· {t(`${n} rows now`, `现有 ${n} 条`)}</span> : <span style={{ color: c.ink }}>· {t("not saved yet", "还没保存")}</span>}
                      {isDefaultBeat(d.key) ? <span style={badge}>{t("default", "默认")}</span> : null}
                    </span>
                  </button>
                  <Switch on={d.enabled} label={d.enabled ? t("On: searched and shown", "开着：会搜索、会显示") : t("Off: not searched, not shown", "关着：不搜索、不显示")} onChange={(v) => update(d.id, { enabled: v })} />
                  <button type="button" onClick={() => move(d.id, -1)} disabled={i === 0} aria-label={t("Move up", "上移")} style={{ ...iconBtn, opacity: i === 0 ? 0.3 : 1 }}>
                    <Glyph d="m6 14 6-6 6 6" />
                  </button>
                  <button type="button" onClick={() => move(d.id, 1)} disabled={i === draft.length - 1} aria-label={t("Move down", "下移")} style={{ ...iconBtn, opacity: i === draft.length - 1 ? 0.3 : 1 }}>
                    <Glyph d="m6 10 6 6 6-6" />
                  </button>
                </div>

                {open ? (
                  <div style={{ padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Field label={t("Chinese name", "中文名")}>
                        <input aria-label={t("Chinese name", "中文名")} value={d.zh} maxLength={BEAT_LIMITS.zhName} onChange={(e) => update(d.id, { zh: e.target.value })} placeholder={t("e.g. 港股", "如：港股")} style={input} autoFocus={d.fresh} />
                      </Field>
                      <Field label={t("English name", "英文名")}>
                        <input aria-label={t("English name", "英文名")} value={d.en} maxLength={BEAT_LIMITS.enName} onChange={(e) => update(d.id, { en: e.target.value })} placeholder={t("e.g. HK stocks", "如：HK stocks")} style={input} />
                      </Field>
                    </div>
                    <Field label={t("Colour", "颜色")}>
                      <div role="radiogroup" aria-label={t("Colour", "颜色")} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {BEAT_COLORS.map((col) => {
                          const picked = d.color === col.key;
                          return (
                            <button
                              key={col.key}
                              type="button"
                              role="radio"
                              aria-checked={picked}
                              aria-label={zh ? col.zh : col.en}
                              title={zh ? col.zh : col.en}
                              onClick={() => update(d.id, { color: col.key as BeatColor })}
                              style={{ width: 26, height: 22, borderRadius: 6, border: `1.5px solid ${picked ? col.ink : "transparent"}`, background: col.tint, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
                            >
                              <span style={{ width: 8, height: 8, borderRadius: 4, background: col.ink }} />
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                    <Field label={t("Chinese keywords", "中文关键词")} hint={t("抖音 · 小红书 · B站 · 微博 · news", "抖音 · 小红书 · B站 · 微博 · 港台新闻")}>
                      <Keywords zh={zh} label={t("Chinese keywords", "中文关键词")} values={d.keywords_zh} onChange={(v) => update(d.id, { keywords_zh: v })} placeholder={t("Type a word, press Enter (e.g. 恒指)", "输入后按回车，如：恒指")} ink={c.ink} tint={c.tint} />
                    </Field>
                    <Field label={t("English keywords", "英文关键词")} hint="TikTok · YouTube">
                      <Keywords zh={zh} label={t("English keywords", "英文关键词")} values={d.keywords_en} onChange={(v) => update(d.id, { keywords_en: v })} placeholder={t("Type a word, press Enter (e.g. Hang Seng)", "输入后按回车，如：Hang Seng")} ink={c.ink} tint={c.tint} />
                    </Field>
                    <div style={{ fontSize: 11, color: "#999999", lineHeight: 1.6 }}>
                      {t(
                        `${BEAT_LIMITS.keywordsMin} to ${BEAT_LIMITS.keywordsMax} words; precise ones work best ("恒指" finds market posts, "股票" finds everything). Each collection takes the next word in turn.`,
                        `至少 ${BEAT_LIMITS.keywordsMin} 个、每种语言最多 ${BEAT_LIMITS.keywordsMax} 个；越具体越好（「恒指」搜到的是行情，「股票」什么都搜得到）。每次收集轮到下一个词。`,
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {isDefaultBeat(d.key) ? (
                        <span style={{ fontSize: 11, color: "#999999" }}>{t("A default beat can be switched off, not deleted.", "默认赛道可以关掉，不能删除。")}</span>
                      ) : (
                        <button type="button" onClick={() => remove(d.id)} style={{ ...textBtn, color: "#b42318" }}>
                          <Glyph d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V5h6v2" size={13} />
                          {t("Delete this beat", "删除这个赛道")}
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

          <button
            type="button"
            onClick={add}
            disabled={draft.length >= BEAT_LIMITS.beats}
            style={{ width: "100%", height: 34, borderRadius: 10, border: "1px dashed #d9d9d9", background: "#fcfcfc", color: draft.length >= BEAT_LIMITS.beats ? "#b3b3b3" : "#383838", fontSize: 12.5, fontFamily: "inherit", cursor: draft.length >= BEAT_LIMITS.beats ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Glyph d="M12 5v14M5 12h14" size={13} />
            {draft.length >= BEAT_LIMITS.beats ? t(`At most ${BEAT_LIMITS.beats} beats`, `最多 ${BEAT_LIMITS.beats} 个赛道`) : t("Add a beat", "添加赛道")}
          </button>

          <div style={{ fontSize: 11, color: "#999999", lineHeight: 1.6, padding: "10px 4px 0" }}>
            {t(
              "More beats do not cost more: each collection makes the same number of searches and shares them among the beats that are on. A new beat shows up after the next collection, or press 'Collect now' under its chip.",
              "赛道多了不会多花钱：每次收集的搜索次数不变，由开着的赛道轮流用。新赛道在下一轮收集后出现，也可以在它的标签下按「现在收集」。",
            )}
          </div>
        </div>

        {/* ---- foot --------------------------------------------------- */}
        <div style={{ borderTop: "1px solid #f0f0f0", padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {error ? (
            <div role="alert" style={{ fontSize: 12, color: "#b42318", background: "#fef3f2", borderRadius: 8, padding: "6px 10px", lineHeight: 1.5 }}>
              {error}
            </div>
          ) : null}
          {confirmReset ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#525252", background: "#f7f7f5", borderRadius: 8, padding: "6px 10px", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 200px" }}>{t("Put AI, crypto, tech and business back as they were (names, words, switched on)? Beats you added stay.", "把 AI、加密、科技、商业恢复成原来的名字和关键词并打开？自己加的赛道保留。")}</span>
              <button type="button" onClick={resetDefaults} style={{ ...btn(true), height: 26 }}>
                {t("Restore", "恢复")}
              </button>
              <button type="button" onClick={() => setConfirmReset(false)} style={{ ...btn(false), height: 26 }}>
                {t("Keep", "不用了")}
              </button>
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={() => setConfirmReset(true)} style={textBtn}>
              <Glyph d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" size={13} />
              {t("Restore defaults", "恢复默认")}
            </button>
            <span style={{ flexGrow: 1, fontSize: 11, color: "#a3a3a3", textAlign: "right" }}>{t(`${on} on`, `开着 ${on} 个`)}</span>
            <button type="button" onClick={close} style={btn(false)}>
              {t("Cancel", "取消")}
            </button>
            <button type="button" onClick={() => void save()} disabled={saving || !dirty} style={{ ...btn(true), opacity: saving || !dirty ? 0.45 : 1, cursor: saving || !dirty ? "default" : "pointer" }}>
              {saving ? t("Saving…", "保存中…") : t("Save", "保存")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Words as chips, with a box to type the next one. Enter, a comma (，、,) or
 * leaving the box adds what is typed; a pasted list is split on the same
 * marks; Backspace in an empty box takes the last chip back.
 */
function Keywords({ zh, label, values, onChange, placeholder, ink, tint }: { zh: boolean; label: string; values: string[]; onChange: (v: string[]) => void; placeholder: string; ink: string; tint: string }) {
  const [text, setText] = React.useState("");
  const full = values.length >= BEAT_LIMITS.keywordsMax;
  const commit = (raw: string) => {
    const parts = raw
      .split(/[,，、;；\n]+/)
      .map((w) => w.replace(/\s+/g, " ").trim().slice(0, BEAT_LIMITS.keywordLen))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) if (next.length < BEAT_LIMITS.keywordsMax && !next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setText("");
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", minHeight: 32, padding: "4px 6px", border: "1px solid #e2e2e2", borderRadius: 8, background: "#ffffff" }}>
      {values.map((w) => (
        <span key={w} style={{ display: "inline-flex", alignItems: "center", gap: 3, height: 22, padding: "0 4px 0 8px", borderRadius: 999, background: tint, color: ink, fontSize: 11.5 }}>
          {w}
          <button type="button" onClick={() => onChange(values.filter((v) => v !== w))} aria-label={zh ? `删除 ${w}` : `Remove ${w}`} style={{ width: 16, height: 16, border: 0, background: "transparent", padding: 0, cursor: "pointer", color: ink, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <Glyph d="M7 7l10 10M17 7 7 17" size={10} />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={text}
        disabled={full}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,，、;；\n]/.test(v)) commit(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(text);
          } else if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={() => commit(text)}
        onPaste={(e) => {
          const v = e.clipboardData.getData("text");
          if (/[,，、;；\n]/.test(v)) {
            e.preventDefault();
            commit(text + v);
          }
        }}
        placeholder={full ? (zh ? `最多 ${BEAT_LIMITS.keywordsMax} 个` : `At most ${BEAT_LIMITS.keywordsMax}`) : values.length ? "" : placeholder}
        style={{ flex: "1 1 90px", minWidth: 90, height: 22, border: 0, outline: "none", fontSize: 12, fontFamily: "inherit", background: "transparent" }}
      />
      <span style={{ fontSize: 10.5, color: "#b3b3b3", fontVariantNumeric: "tabular-nums", paddingRight: 2 }}>
        {values.length}/{BEAT_LIMITS.keywordsMax}
      </span>
    </div>
  );
}

/* A div, not a <label>: a label passes a click on its text to the first
   button inside it, which here would be a colour swatch or a chip's remove
   button. The inputs carry their own aria-label. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 0", minWidth: 0 }}>
      <span style={{ fontSize: 11, color: "#7c7c7c", display: "flex", gap: 6 }}>
        {label}
        {hint ? <span style={{ color: "#b3b3b3" }}>{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

/** On or off, as a small switch. */
function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} onClick={() => onChange(!on)} style={{ width: 30, height: 18, borderRadius: 999, border: 0, padding: 2, background: on ? "#171717" : "#d9d9d9", cursor: "pointer", flexShrink: 0, display: "inline-flex", justifyContent: on ? "flex-end" : "flex-start", transition: "background .12s linear" }}>
      <span style={{ width: 14, height: 14, borderRadius: 7, background: "#ffffff", boxShadow: "0 1px 2px rgba(0,0,0,.15)" }} />
    </button>
  );
}

/** A line icon on the 24px grid, in the text's colour. */
function Glyph({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden style={{ width: size, height: size, flexShrink: 0, fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}>
      <path d={d} />
    </svg>
  );
}

const iconBtn: React.CSSProperties = { width: 26, height: 26, borderRadius: 7, border: 0, background: "transparent", color: "#7c7c7c", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0 };
const textBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, border: 0, background: "transparent", padding: 0, fontSize: 12, color: "#525252", cursor: "pointer", fontFamily: "inherit" };
const badge: React.CSSProperties = { fontSize: 10, color: "#7c7c7c", background: "#f3f3f1", borderRadius: 4, padding: "0 5px", lineHeight: "15px" };
const input: React.CSSProperties = { height: 30, padding: "0 10px", border: "1px solid #e2e2e2", borderRadius: 8, outline: "none", fontFamily: "inherit", fontSize: 12.5, background: "#ffffff", minWidth: 0, width: "100%" };
function btn(primary: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 30,
    padding: "0 14px",
    borderRadius: 8,
    border: `1px solid ${primary ? "#171717" : "#e2e2e2"}`,
    background: primary ? "#171717" : "#ffffff",
    color: primary ? "#ffffff" : "#383838",
    fontSize: 12.5,
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
