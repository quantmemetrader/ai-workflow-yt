"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { setScriptLengthAction, startFromTopicAction, startProjectAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";
import { bigButton } from "@/components/projects/kit";
import { AttachButton, AttachChips, useAttachments } from "@/components/chat/Attach";
import { addReferenceAction } from "@/app/(app)/projects/[id]/script/actions";

/**
 * 「做一条新视频」: one sentence, one press. The project starts, 文案 starts
 * the first draft, and you land on the video's page to watch it happen.
 */
export function NewVideoBox({ zh }: { zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [pending, start] = React.useTransition();
  /* How long the video should be; the first draft is written to it. */
  const [secs, setSecs] = React.useState(180);
  const [customMin, setCustomMin] = React.useState("");
  /* A custom length outside 15 秒 to 30 分钟 was ignored without a word (QA, 2 Oct). */
  const customN = customMin ? Number(customMin) * 60 : null;
  const customBad = customN !== null && (!Number.isFinite(customN) || customN < 15 || customN > 1800);
  const att = useAttachments(zh, 5);
  /* While the box holds a bad number no preset reads as chosen, and the
     press waits: 0, 100 or -3 were kept, or quietly became 3 (QA round 2). */
  const customOn = customMin !== "" && !customBad;
  const go = () => {
    const said = text.trim();
    if (!said || pending || att.uploading) return;
    if (customBad) {
      notify(t("时长要在 15 秒到 30 分钟之间", "Pick a length between 15 s and 30 min"));
      return;
    }
    start(async () => {
      const r = await startProjectAction({ message: said });
      if ("error" in r && r.error) {
        notify(r.error);
        return;
      }
      if (!("id" in r) || !r.id) return;
      /* The first draft, in the background; a studio without the Script
         module still gets its project. */
      await setScriptLengthAction(r.id, secs).catch(() => null);
      /* A sample or notes attached here become the script's 参考资料: the first draft follows them. */
      for (const fileId of att.ids) await addReferenceAction(r.id, fileId).catch(() => null);
      att.clear();
      await startFromTopicAction({ kind: "project", id: r.id }, { write: true }).catch(() => null);
      router.push(`/projects/${r.id}`);
    });
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("想做什么主题？一句话就行", "What is it about? One sentence is enough")}
        aria-label={t("新视频的主题", "The new video's topic")}
        disabled={pending}
        style={{ flex: "1 1 280px", minWidth: 0, height: 48, padding: "0 16px", fontSize: 15, fontFamily: "inherit", border: "1px solid #d6d5d0", borderRadius: 12, outline: "none", background: "#fff" }}
      />
      <span style={{ display: "inline-flex", alignItems: "center", height: 48 }}>
        <AttachButton zh={zh} onFiles={att.add} size={40} title={t("附范例或资料：文案会学范例的风格来写初稿", "Attach a sample or notes for the first draft")} />
      </span>
      <button type="submit" disabled={!text.trim() || pending || att.uploading} style={{ ...bigButton("primary", !text.trim() || pending), height: 48, padding: "0 26px", fontSize: 15 }}>
        {pending ? t("正在开始…", "Starting…") : t("开始", "Start")}
      </button>
      {att.attached.length ? (
        <div style={{ flexBasis: "100%" }}>
          <AttachChips zh={zh} attached={att.attached} onRemove={att.remove} />
          <div style={{ fontSize: 12, color: "#7a7a76" }}>{t("文案写初稿时会照这些范例的结构和语气来写，资料里的事实也会用上。", "The first draft follows these samples and uses their facts.")}</div>
        </div>
      ) : null}
      <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "#6b6b6b" }}>{t("视频多长：", "Length:")}</span>
        {[60, 180, 300, 480].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              setSecs(n);
              /* The preset wins: a 2.5 left in the box read as still chosen. */
              setCustomMin("");
            }}
            aria-pressed={secs === n && customMin === ""}
            style={{ height: 32, padding: "0 14px", borderRadius: 999, border: `1px solid ${secs === n && customMin === "" ? "#171717" : "#d6d5d0"}`, background: secs === n && customMin === "" ? "#171717" : "#fff", color: secs === n && customMin === "" ? "#fff" : "#333", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            {t(`${n / 60} 分钟${n === 180 ? "（推荐）" : ""}`, `${n / 60} min`)}
          </button>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 10px", borderRadius: 999, border: `1px solid ${customBad ? "#d9534f" : customOn ? "#171717" : "#d6d5d0"}`, background: "#fff", fontSize: 13 }}>
          {t("自定义", "Custom")}
          <input
            inputMode="decimal"
            value={customMin}
            placeholder={t("如 2.5", "e.g. 2.5")}
            onChange={(e) => {
              /* The minus stays visible so -3 is flagged, not read as 3. */
              const v = e.target.value.replace(/[^\d.-]/g, "").slice(0, 5);
              setCustomMin(v);
              const n = Math.round(Number(v) * 60);
              if (n >= 15 && n <= 1800) setSecs(n);
            }}
            onBlur={() => {
              /* A bad number is not kept: the box clears and the length
                 goes back to the preset it was on. */
              if (!customBad) return;
              const back = [60, 180, 300, 480].includes(secs) ? secs : 180;
              setCustomMin("");
              setSecs(back);
              notify(t(`时长要在 15 秒到 30 分钟之间，已改回 ${back / 60} 分钟`, `Pick 15 s to 30 min; back to ${back / 60} min`));
            }}
            aria-label={t("自定义时长（分钟）", "Custom length in minutes")}
            aria-invalid={customBad || undefined}
            style={{ width: 50, height: 24, border: "1px solid #dcdbd6", borderRadius: 6, padding: "0 4px", fontFamily: "inherit", fontSize: 13, textAlign: "center" }}
          />
          {t("分钟", "min")}
        </span>
        {customBad ? (
          <span role="status" style={{ fontSize: 12.5, color: "#b42318" }}>
            {t("时长要在 0.25 到 30 分钟之间", "Pick 0.25 to 30 min")}
          </span>
        ) : null}
      </div>
    </form>
  );
}
