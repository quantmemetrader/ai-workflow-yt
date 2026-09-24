"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentMark } from "@/components/chat/MentionMenu";
import { AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import type { Proposal } from "@/lib/agents/proposals";
import { startProposalAction } from "@/app/(app)/home/actions";
import { notify } from "@/lib/client/notify";

/**
 * "Here is what to make next" — at the top of every maker's page.
 *
 * The Script, Articles and Video pages opened on a library and a New button,
 * which asks the person to already have the idea. The client's words: *"When
 * I enter article page I can already see ideas proposed. Same for script."*
 *
 * So each opens on this: the employee for the page, and three or four things
 * it thinks the studio should make, with where the idea came from and one
 * button. The button does what typing `@编剧 …` in #制作 does, and goes
 * through the same server action, so a page can start work but cannot do
 * anything a person could not do by typing.
 */
export function ProposalsStrip({
  owner,
  items,
  planDate,
  zh,
}: {
  owner: AgentKey;
  items: Proposal[];
  planDate: string | null;
  zh: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [busy, setBusy] = React.useState<number | null>(null);
  const [sent, setSent] = React.useState<Set<number>>(new Set());

  if (!items.length) return null;

  const who = zh ? AGENT_LABELS[owner].nameLocal : AGENT_LABELS[owner].name;
  const t = (a: string, b: string) => (zh ? a : b);

  const sourceLabel = (s: Proposal["source"]) =>
    s === "plan"
      ? t(planDate ? "今早的计划" : "计划", planDate ? "This morning's plan" : "The plan")
      : s === "backlog"
        ? t("选题储备", "Topic backlog")
        : t("观众提问", "A viewer asked");

  function go(index: number, text: string) {
    if (busy !== null) return;
    setBusy(index);
    start(async () => {
      const res = await startProposalAction(owner, text);
      setBusy(null);
      if ("error" in res && res.error) {
        notify(res.error);
        return;
      }
      setSent((s) => new Set(s).add(index));
      notify(t(`已交给${who}，在 #制作 里回复`, `Handed to ${who}; it answers in #制作`), "ok");
      router.refresh();
    });
  }

  return (
    <div
      style={{
        flexShrink: 0,
        borderBottom: "1px solid #ededed",
        background: "#fcfcfc",
        padding: "10px 22px 11px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, minWidth: 0 }}>
        <AgentMark agent={owner} size={20} radius={6} />
        <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>
          {t(`${who}建议做这些`, `${who} suggests`)}
        </span>
        <span
          style={{
            fontSize: 11.5,
            color: "#999999",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {t("按一下就开工，它会在 #制作 里回复", "One press starts it; it answers in #制作")}
        </span>
        <span style={{ flexGrow: 1 }} />
        <Link
          href={`/chat/c/${encodeURIComponent("制作")}`}
          style={{ fontSize: 11.5, color: "#999999", textDecoration: "none" }}
        >
          #制作 →
        </Link>
      </div>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
        {items.map((p, i) => {
          const done = sent.has(i);
          return (
            <div
              key={`${p.source}-${i}`}
              style={{
                width: 300,
                flexShrink: 0,
                border: "1px solid #ededed",
                borderRadius: 11,
                background: "#ffffff",
                padding: "9px 12px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 5,
                opacity: done ? 0.6 : 1,
              }}
            >
              <div
                title={p.text}
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: "#171717",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {p.text}
              </div>
              {p.why ? (
                <div
                  title={p.why}
                  style={{
                    fontSize: 11,
                    lineHeight: 1.45,
                    color: "#7c7c7c",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {p.why}
                </div>
              ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                <span
                  style={{
                    fontSize: 10.5,
                    color: "#999999",
                    background: "#f3f3f3",
                    borderRadius: 5,
                    padding: "2px 6px",
                  }}
                >
                  {sourceLabel(p.source)}
                </span>
                <span style={{ flexGrow: 1 }} />
                <button
                  type="button"
                  disabled={pending || done}
                  onClick={() => go(i, p.text)}
                  style={{
                    height: 26,
                    padding: "0 11px",
                    borderRadius: 8,
                    border: `1px solid ${done ? "#e2e2e2" : "#171717"}`,
                    background: done ? "#ffffff" : "#171717",
                    color: done ? "#999999" : "#ffffff",
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "inherit",
                    letterSpacing: "inherit",
                    cursor: done ? "default" : "pointer",
                    opacity: busy === i ? 0.55 : 1,
                  }}
                >
                  {done ? t("已交给它", "Sent") : t(`让${who}做`, `Ask ${who}`)}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
