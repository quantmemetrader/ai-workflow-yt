"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentMark } from "@/components/chat/MentionMenu";
import { startProposalAction } from "@/app/(app)/home/actions";
import { notify } from "@/lib/client/notify";

/**
 * 研究员's conclusion, on the page where the topic gets watched.
 *
 * The morning brief lands in #研究日报 and names one thing worth discussing.
 * The Trends page is where that thing would be watched, written and argued
 * about — and it opened on a chart, as if the brief had never been posted.
 * This is the brief's first line, here, with the two presses that follow from
 * it: watch the topic, or hand it to 编剧.
 */
export function ResearcherNote({
  topic,
  why,
  date,
  zh,
  onWatch,
}: {
  topic: string | null;
  why: string | null;
  date: string | null;
  zh: boolean;
  onWatch: (phrase: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [sent, setSent] = React.useState(false);
  if (!topic) return null;

  const t = (a: string, b: string) => (zh ? a : b);
  const phrase = topic.replace(/[？?。！!—–-].*$/, "").slice(0, 40);

  return (
    <div
      style={{
        flexShrink: 0,
        borderBottom: "1px solid #ededed",
        background: "#ffffff",
        padding: "11px 20px 12px",
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
      }}
    >
      <AgentMark size={26} radius={8} />
      <div style={{ minWidth: 0, flexGrow: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("研究员今天建议讨论", "Research agent's pick today")}</span>
          {date ? <span style={{ fontSize: 11, color: "#999999" }}>{date}</span> : null}
          <Link
            href={`/chat/c/${encodeURIComponent("研究日报")}`}
            style={{ fontSize: 11, color: "#999999", textDecoration: "none" }}
          >
            {t("看全文 →", "Read the brief →")}
          </Link>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 3, color: "#171717" }}>{topic}</div>
        {why ? <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 3, color: "#7c7c7c" }}>{why}</div> : null}
      </div>
      <div style={{ display: "flex", gap: 7, flexShrink: 0, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => onWatch(phrase)}
          style={btn(false)}
        >
          {t("加入关注", "Watch it")}
        </button>
        <button
          type="button"
          disabled={pending || sent}
          onClick={() =>
            start(async () => {
              const res = await startProposalAction("script", `按今天晨报的选题写脚本：${topic}`);
              if ("error" in res && res.error) {
                notify(res.error);
                return;
              }
              setSent(true);
              notify(t("已交给编剧，它在 #制作 里回复", "Handed to the script agent; it answers in #制作"), "ok");
              router.refresh();
            })
          }
          style={btn(!sent)}
        >
          {sent ? t("已交给编剧", "Sent") : t("让编剧写脚本", "Ask 编剧 to write it")}
        </button>
      </div>
    </div>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    height: 28,
    padding: "0 12px",
    borderRadius: 8,
    border: `1px solid ${primary ? "#171717" : "#e2e2e2"}`,
    background: primary ? "#171717" : "#ffffff",
    color: primary ? "#ffffff" : "#383838",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "inherit",
    letterSpacing: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
