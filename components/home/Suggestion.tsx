"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { startProjectAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";

export type TodaySuggestion = { title: string; why: string | null; hook: string | null; strength: number | null; evidence: { label: string; url: string | null; numbers: string }[] };

/**
 * Today's suggested video, from the morning brief: one or two topics with
 * the reason and the evidence, and the presses that turn one into work.
 */
export function SuggestionCard({ items, zh }: { items: TodaySuggestion[]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  if (!items.length) return null;
  const go = (s: TodaySuggestion, withScript: boolean) =>
    start(async () => {
      const r = await startProjectAction({
        title: s.title,
        message: withScript ? `@编剧 按这个选题写脚本初稿《${s.title}》${s.hook ? `，开头第一句：「${s.hook}」` : ""}` : undefined,
        source: { kind: "digest", label: t("今日建议", "Today's suggestion"), url: s.evidence[0]?.url ?? null },
      });
      if ("error" in r && r.error) {
        notify(r.error);
        return;
      }
      if ("id" in r && r.id) router.push(`/projects/${r.id}`); setTimeout(() => router.refresh(), 400);
    });
  return (
    <section style={{ borderRadius: 16, border: "1px solid transparent", background: "linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(135deg, #cfe0fb, #e3dcfb 50%, #cfe9e2) border-box", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <AgentIcon agent="research" size={22} radius={6} />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("今天建议拍", "Suggested for today")}</span>
        <span style={{ fontSize: 12, color: "#999999" }}>{t("来自研究员的晨报", "from the researcher's morning brief")}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((s, i) => (
          <div key={i} style={{ borderTop: i ? "1px solid #f0f0f0" : "none", paddingTop: i ? 10 : 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>{s.title}</span>
              {s.strength ? <span title={t("信号强度", "Signal strength")} style={{ fontSize: 10.5, color: "#c2410c", letterSpacing: 1, flexShrink: 0 }}>{"●".repeat(s.strength)}{"○".repeat(5 - s.strength)}</span> : null}
            </div>
            {s.why ? <div style={{ fontSize: 12.5, color: "#525252", lineHeight: 1.6, marginTop: 4 }}>{s.why}</div> : null}
            {s.evidence.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {s.evidence.slice(0, 3).map((e, k) => (
                  <a key={k} href={e.url ?? "#"} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#525252", background: "#f5f7fb", borderRadius: 999, padding: "2px 9px", textDecoration: "none" }}>
                    <Icon name="external" size={10} />
                    {e.label} {e.numbers}
                  </a>
                ))}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" disabled={pending} onClick={() => go(s, true)} style={{ height: 30, padding: "0 12px", borderRadius: 8, border: 0, background: "#171717", color: "#fff", fontFamily: "inherit", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="plus" size={13} /> {t("做成项目并写脚本", "Make it a project, write the script")}
              </button>
              <button type="button" disabled={pending} onClick={() => go(s, false)} style={{ height: 30, padding: "0 12px", borderRadius: 8, border: "1px solid #e2e2e2", background: "#fff", fontFamily: "inherit", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="upload" size={13} /> {t("做成项目，上传素材", "Make it a project, upload clips")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
