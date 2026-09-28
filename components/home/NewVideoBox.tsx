"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { startFromTopicAction, startProjectAction } from "@/app/(app)/projects/actions";
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
    </form>
  );
}
