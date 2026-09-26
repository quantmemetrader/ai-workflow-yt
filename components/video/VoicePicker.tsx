"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";
import type { UiVoice } from "@/lib/video/tts/types";

/**
 * Choosing a narration voice by hearing it.
 *
 * A list of names ("新闻女声", "浑厚男声") is a guess; the voice is the thing
 * being chosen. So every voice the studio owns has a 试听 button that plays the
 * same two sentences in that voice (`/api/tts/sample`, made once on the
 * server and cached), and only one plays at a time. Grouped the way a person
 * asks for one: Mandarin female, Mandarin male, English, then anything from
 * ElevenLabs' library when that is reachable.
 *
 * Used by the editor's audio tab and the project page's AI 配音 option, so
 * both choose from the same list in the same way. No state on first render
 * that the server would not have, so hydration agrees.
 */
export function VoicePicker({
  voices,
  value,
  onChange,
  zh,
  compact = false,
}: {
  voices: UiVoice[];
  value: string;
  onChange: (id: string) => void;
  zh: boolean;
  compact?: boolean;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  function toggle(id: string) {
    if (!audio.current) audio.current = new Audio();
    const a = audio.current;
    if (playing === id || loading === id) {
      a.pause();
      setPlaying(null);
      setLoading(null);
      return;
    }
    a.pause();
    setFailed(null);
    setLoading(id);
    setPlaying(null);
    a.src = `/api/tts/sample?voice=${encodeURIComponent(id)}`;
    a.onplaying = () => {
      setLoading(null);
      setPlaying(id);
    };
    a.onended = () => setPlaying(null);
    a.onerror = () => {
      setLoading(null);
      setPlaying(null);
      setFailed(id);
    };
    void a.play().catch(() => {
      setLoading(null);
      setFailed(id);
    });
  }

  const groups: { key: string; label: string; en: string; rows: UiVoice[] }[] = [
    { key: "zf", label: "中文 · 女声", en: "Mandarin · female", rows: voices.filter((v) => v.lang === "zh" && v.gender === "female") },
    { key: "zm", label: "中文 · 男声", en: "Mandarin · male", rows: voices.filter((v) => v.lang === "zh" && v.gender === "male") },
    { key: "en", label: "英文", en: "English", rows: voices.filter((v) => v.lang === "en") },
    { key: "el", label: "ElevenLabs", en: "ElevenLabs", rows: voices.filter((v) => v.provider === "elevenlabs") },
  ].filter((g) => g.rows.length);

  if (!voices.length) {
    return (
      <p style={{ fontSize: 12, color: "#999999", margin: 0, lineHeight: 1.6 }}>
        {t(
          "No voice is available on this server: the speech engine is not installed here.",
          "本服务器上暂无可用声音：语音引擎尚未安装。",
        )}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 8 : 10 }}>
      {groups.map((g) => (
        <div key={g.key}>
          <div style={{ fontSize: 11, color: "#8a8a8a", marginBottom: 5, letterSpacing: 0.2 }}>
            <Tr zh={g.label} en={g.en} inZh={zh} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 160 : 200}px, 1fr))`, gap: 6 }}>
            {g.rows.map((v) => {
              const on = v.id === value;
              const busy = loading === v.id;
              const live = playing === v.id;
              return (
                <div
                  key={v.id}
                  title={v.blurb ? `${zh ? v.name.zh : v.name.en} · ${zh ? v.blurb.zh : v.blurb.en}` : undefined}
                  role="radio"
                  aria-checked={on}
                  tabIndex={0}
                  onClick={() => onChange(v.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onChange(v.id);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: compact ? "6px 8px" : "8px 10px",
                    borderRadius: 10,
                    cursor: "pointer",
                    border: `1px solid ${on ? "#171717" : "#e6e6e6"}`,
                    background: on ? "#f4f4f4" : "#ffffff",
                    outline: "none",
                    minWidth: 0,
                  }}
                >
                  <span style={{ flexGrow: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: on ? 600 : 500, color: "#171717", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {zh ? v.name.zh : v.name.en}
                    </span>
                    {v.blurb && !compact ? (
                      <span style={{ display: "block", fontSize: 11, color: "#8a8a8a", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {zh ? v.blurb.zh : v.blurb.en}
                      </span>
                    ) : null}
                    {failed === v.id ? (
                      <span style={{ display: "block", fontSize: 11, color: "#c0392b", marginTop: 1 }}>{t("could not play", "无法播放")}</span>
                    ) : null}
                  </span>
                  {v.sample ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(v.id);
                      }}
                      title={t("Listen", "试听")}
                      aria-label={t("Listen", "试听")}
                      style={{
                        flexShrink: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        height: 24,
                        padding: "0 8px",
                        borderRadius: 999,
                        border: "1px solid #e2e2e2",
                        background: live ? "#171717" : "#fafafa",
                        color: live ? "#ffffff" : "#404040",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      <Icon name={live ? "pause" : "play"} size={10} />
                      {busy ? t("…", "…") : t("Listen", "试听")}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 语速: a multiplier on the voice's own pace, carried on the voice id. */
export const PACES = [
  { value: 0.9, zh: "稍慢", en: "Slower" },
  { value: 1, zh: "标准", en: "Normal" },
  { value: 1.1, zh: "稍快", en: "Faster" },
] as const;

export function withPace(voiceId: string, pace: number): string {
  const base = voiceId.replace(/@.*$/, "");
  return pace === 1 ? base : `${base}@${pace}`;
}
