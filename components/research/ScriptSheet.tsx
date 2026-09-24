"use client";

import { useState } from "react";
import { chip, field, ghost, solid } from "@/components/ui/kit";

/**
 * From a topic to a written script in three chips.
 *
 * The hand-off used to make an empty brief and leave; the person then opened
 * it, filled it in and pressed Generate. This asks the three things a draft
 * genuinely depends on — the angle, where it goes, how long — and writes it.
 * Everything else is already on the topic, and everything can be changed in
 * the editor afterwards.
 */
const CHANNELS = [
  { key: "YouTube", aspect: "16:9", en: "YouTube", zh: "YouTube" },
  { key: "Shorts", aspect: "9:16", en: "Shorts / Reels", zh: "短视频（竖版）" },
  { key: "LinkedIn", aspect: "1:1", en: "LinkedIn", zh: "领英" },
  { key: "Bilibili", aspect: "16:9", en: "Bilibili", zh: "B站" },
];

const LENGTHS = [
  { seconds: 60, en: "1 min", zh: "1 分钟" },
  { seconds: 180, en: "3 min", zh: "3 分钟" },
  { seconds: 480, en: "8 min", zh: "8 分钟" },
  { seconds: 900, en: "15 min", zh: "15 分钟" },
];

const LANGUAGES = [
  { key: "Cantonese", en: "Cantonese", zh: "粤语" },
  { key: "Mandarin", en: "Mandarin", zh: "普通话" },
  { key: "English", en: "English", zh: "英语" },
];

export function ScriptSheet({
  topic,
  angles,
  busy,
  error,
  zh,
  onWrite,
  onSuggestAngles,
  onClose,
}: {
  topic: { id: string; name: string };
  angles: string[];
  busy: boolean;
  error: string | null;
  zh: boolean;
  onWrite: (input: { angle: string | null; channel: string; aspect: string; seconds: number; language: string; subtitleLanguage: string }) => void;
  onSuggestAngles?: () => void;
  onClose: () => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [angle, setAngle] = useState<string>(angles[0] ?? "");
  const [own, setOwn] = useState("");
  const [channel, setChannel] = useState(CHANNELS[0]);
  const [seconds, setSeconds] = useState(180);
  const [language, setLanguage] = useState(LANGUAGES[0].key);

  // Angles asked for from inside the sheet arrive after it opened: until one
  // is chosen, the first is the one, as it would have been from the start.
  const picked = angle || angles[0] || "";
  const chosenAngle = own.trim() || picked || null;
  const on = (yes: boolean): React.CSSProperties =>
    yes ? { ...chip, background: "#171717", color: "#fff", borderColor: "#171717" } : chip;

  return (
    <div
      onMouseDown={busy ? undefined : onClose}
      style={{ position: "fixed", inset: 0, zIndex: 210, background: "rgba(23,23,23,0.2)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "10vh 18px 18px" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Write the script", "写脚本")}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
        }}
        style={{ width: "min(640px, 100%)", background: "#fff", borderRadius: 14, border: "1px solid #e2e2e2", boxShadow: "0 28px 72px rgba(23,23,23,0.24)", overflow: "hidden", animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both" }}
      >
        <div style={{ padding: "14px 18px 6px" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Write the script", "写脚本")}</div>
          <div style={{ fontSize: 12, color: "#999999", marginTop: 3 }}>
            {topic.name} · {t("the headlines collected for it are the facts it may use", "已收集的报道就是它可以引用的事实依据")}
          </div>
        </div>

        <div style={{ padding: "8px 18px 4px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="lbl" style={{ padding: 0, marginBottom: 7, fontSize: 10.5, fontWeight: 500, color: "#999999" }}>{t("Angle", "切入角度")}</div>
            {angles.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#999999" }}>{t("No angles yet.", "还没有角度。")}</span>
                {onSuggestAngles ? (
                  <button type="button" onClick={onSuggestAngles} disabled={busy} style={{ ...ghost, height: 26, fontSize: 11.5 }}>
                    {t("Suggest some", "让助理推荐几个")}
                  </button>
                ) : null}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 8 }}>
                {angles.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => {
                      setAngle(a);
                      setOwn("");
                    }}
                    style={{
                      textAlign: "left",
                      padding: "7px 10px",
                      borderRadius: 8,
                      border: `1px solid ${picked === a && !own.trim() ? "#171717" : "#ededed"}`,
                      background: picked === a && !own.trim() ? "#f8f8f8" : "#fff",
                      fontSize: 12.5,
                      font: "inherit",
                      cursor: "pointer",
                      color: "#171717",
                      lineHeight: 1.45,
                    }}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
            <input
              value={own}
              onChange={(e) => setOwn(e.target.value)}
              placeholder={t("Or write your own angle", "或者自己写一个角度")}
              style={{ ...field, height: 32 }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 500, color: "#999999", marginBottom: 7 }}>{t("Where it goes", "投放渠道")}</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {CHANNELS.map((c) => (
                  <button key={c.key} type="button" onClick={() => setChannel(c)} style={on(channel.key === c.key)}>
                    {zh ? c.zh : c.en}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 500, color: "#999999", marginBottom: 7 }}>{t("How long", "过渡时长")}</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {LENGTHS.map((l) => (
                  <button key={l.seconds} type="button" onClick={() => setSeconds(l.seconds)} style={on(seconds === l.seconds)}>
                    {zh ? l.zh : l.en}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10.5, fontWeight: 500, color: "#999999", marginBottom: 7 }}>{t("Spoken in", "口播语言")}</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {LANGUAGES.map((l) => (
                <button key={l.key} type="button" onClick={() => setLanguage(l.key)} style={on(language === l.key)}>
                  {zh ? l.zh : l.en}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error ? <p style={{ fontSize: 12, color: "#e03636", padding: "0 18px", margin: "8px 0 0" }}>{error}</p> : null}

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px 14px", borderTop: "1px solid #f3f3f3", marginTop: 10 }}>
          <span style={{ fontSize: 11, color: "#c7c7c7" }}>
            {t("About half a minute. It lands in the Script library, ready to edit.", "大约半分钟，会出现在脚本库里，可直接编辑。")}
          </span>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...ghost, marginLeft: "auto" }}>
            {t("Cancel", "取消")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onWrite({
                angle: chosenAngle,
                channel: channel.key,
                aspect: channel.aspect,
                seconds,
                language,
                subtitleLanguage: language === "English" ? "简体中文" : "English",
              })
            }
            style={{ ...solid, opacity: busy ? 0.55 : 1 }}
          >
            {busy ? t("Writing…", "撰写中…") : t("Write it", "开始写")}
          </button>
        </div>
      </div>
    </div>
  );
}
