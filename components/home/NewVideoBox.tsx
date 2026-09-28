"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { setScriptLengthAction, startFromTopicAction, startProjectAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";
import { bigButton } from "@/components/projects/kit";

/**
 * 「做一条新视频」: one sentence, one press. The project starts, 编剧 starts
 * the first draft, and you land on the video's page to watch it happen.
 */
export function NewVideoBox({ zh }: { zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [pending, start] = React.useTransition();
  /* How long the video should be; the first draft is written to it. */
  const [secs, setSecs] = React.useState(180);
  const go = () => {
    const said = text.trim();
    if (!said || pending) return;
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
      <button type="submit" disabled={!text.trim() || pending} style={{ ...bigButton("primary", !text.trim() || pending), height: 48, padding: "0 26px", fontSize: 15 }}>
        {pending ? t("正在开始…", "Starting…") : t("开始", "Start")}
      </button>
      <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "#6b6b6b" }}>{t("视频多长：", "Length:")}</span>
        {[60, 180, 300, 480].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setSecs(n)}
            aria-pressed={secs === n}
            style={{ height: 32, padding: "0 14px", borderRadius: 999, border: `1px solid ${secs === n ? "#171717" : "#d6d5d0"}`, background: secs === n ? "#171717" : "#fff", color: secs === n ? "#fff" : "#333", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            {t(`${n / 60} 分钟${n === 180 ? "（推荐）" : ""}`, `${n / 60} min`)}
          </button>
        ))}
      </div>
    </form>
  );
}
