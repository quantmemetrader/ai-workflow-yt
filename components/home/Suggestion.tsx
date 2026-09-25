"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { StartedNotice } from "@/components/home/IdeasPanel";
import { notify } from "@/lib/client/notify";

export type TodaySuggestion = {
  title: string;
  why: string | null;
  hook: string | null;
  strength: number | null;
  evidence: { label: string; url: string | null; numbers: string }[];
  /** Which brief and which of its signals, so the server reads the right one (an old card must not open today's). */
  signal?: { date: string; index: number } | null;
};

/**
 * Today's suggested video, from the morning brief: one or two topics with
 * the reason and the evidence, and the presses that turn one into work.
 *
 * Both presses go through `startFromTopicAction` with the signal (its
 * brief's date and place, or its title in the latest brief), so the project
 * gets the brief's why, hook, angle and evidence rather than a chat command,
 * and the same signal pressed twice opens the same project. Then the card
 * asks where to go (the script being written, the project) or to stay:
 * Home is where the person was working.
 */
export function SuggestionCard({ items, zh, canResearch = false }: { items: TodaySuggestion[]; zh: boolean; canResearch?: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [started, setStarted] = React.useState<Record<number, { projectId: string; scriptId: string | null; writing: boolean; existed: boolean }>>({});
  if (!items.length) return null;
  const go = (s: TodaySuggestion, i: number, withScript: boolean) => {
    if (busy) return;
    setBusy(`${i}:${withScript ? "w" : "c"}`);
    void (async () => {
      try {
        const r = await startFromTopicAction({ kind: "signal", date: s.signal?.date ?? null, index: s.signal?.index ?? i, title: s.title }, { write: withScript });
        if ("error" in r && r.error) {
          notify(r.error);
          return;
        }
        if ("projectId" in r && r.projectId) {
          setStarted((m) => ({ ...m, [i]: { projectId: r.projectId, scriptId: r.scriptId ?? null, writing: Boolean(r.writing), existed: Boolean(r.existed) } }));
          if (r.note) notify(r.note, "info");
          /* The sidebar's project list, quietly; the card keeps its state. */
          router.refresh();
        }
      } finally {
        setBusy(null);
      }
    })();
  };
  return (
    <section style={{ borderRadius: 16, border: "1px solid transparent", background: "linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(135deg, #cfe0fb, #e3dcfb 50%, #cfe9e2) border-box", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, minWidth: 0 }}>
        <AgentIcon agent="research" size={22} radius={6} />
        <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap" }}>{t("今天建议拍", "Suggested for today")}</span>
        <span style={{ fontSize: 12, color: "#999999", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("来自研究员的晨报", "from the researcher's morning brief")}</span>
        <span style={{ flexGrow: 1 }} />
        {canResearch ? (
          <Link prefetch={false} href="/research" style={{ fontSize: 12, color: "#525252", textDecoration: "none", whiteSpace: "nowrap" }}>
            {t("查看研究 →", "See the research →")}
          </Link>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((s, i) => (
          <div key={i} style={{ borderTop: i ? "1px solid #f0f0f0" : "none", paddingTop: i ? 10 : 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>{s.title}</span>
              {s.strength ? <span title={t("信号强度", "Signal strength")} style={{ fontSize: 10.5, color: "#c2410c", letterSpacing: 1, flexShrink: 0 }}>{"●".repeat(s.strength)}{"○".repeat(Math.max(0, 5 - s.strength))}</span> : null}
            </div>
            {s.why ? <div style={{ fontSize: 12.5, color: "#525252", lineHeight: 1.6, marginTop: 4 }}>{s.why}</div> : null}
            {s.evidence.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {s.evidence.slice(0, 3).map((e, k) =>
                  e.url ? (
                    <a key={k} href={e.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#525252", background: "#f5f7fb", borderRadius: 999, padding: "2px 9px", textDecoration: "none" }}>
                      <Icon name="external" size={10} />
                      {e.label} {e.numbers}
                    </a>
                  ) : (
                    <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#525252", background: "#f5f7fb", borderRadius: 999, padding: "2px 9px" }}>
                      {e.label} {e.numbers}
                    </span>
                  ),
                )}
              </div>
            ) : null}
            {started[i] ? (
              <StartedNotice
                zh={zh}
                title={s.title}
                projectId={started[i].projectId}
                scriptId={started[i].scriptId}
                writing={started[i].writing}
                existed={started[i].existed}
                onStay={() =>
                  setStarted((m) => {
                    const next = { ...m };
                    delete next[i];
                    return next;
                  })
                }
              />
            ) : (
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <button type="button" disabled={busy !== null} onClick={() => go(s, i, true)} style={{ height: 30, padding: "0 12px", borderRadius: 8, border: 0, background: "#171717", color: "#fff", fontFamily: "inherit", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, opacity: busy === `${i}:w` ? 0.6 : 1 }}>
                  <Icon name="pen" size={13} /> {busy === `${i}:w` ? t("正在开项目…", "Starting…") : t("做成项目并写脚本", "Make it a project, write the script")}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => go(s, i, false)} style={{ height: 30, padding: "0 12px", borderRadius: 8, border: "1px solid #e2e2e2", background: "#fff", fontFamily: "inherit", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, opacity: busy === `${i}:c` ? 0.6 : 1 }}>
                  <Icon name="upload" size={13} /> {t("做成项目，上传素材", "Make it a project, upload clips")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
