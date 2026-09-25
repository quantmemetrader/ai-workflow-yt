"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";
import type { TopicQueueItem } from "@/lib/script/topics";

/**
 * The Script module's 选题 page: topics chosen elsewhere that are waiting
 * for a script (`lib/script/topics.ts`).
 *
 * One press per row. A project already waiting gets its draft written; a
 * signal, an own pick, a saved idea, a backlog topic or a plan to-do becomes
 * a project and its draft is started. Either way the person lands on the
 * script with the writing state showing, inside the project's bar.
 */
export function TopicQueue({ items, zh, canStart }: { items: TopicQueueItem[]; zh: boolean; canStart: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [, start] = React.useTransition();

  function write(item: TopicQueueItem) {
    if (busy) return;
    setBusy(item.key);
    start(async () => {
      try {
        const res = await startFromTopicAction(item.ref, { write: true });
        if ("error" in res && res.error) {
          notify(res.error);
          return;
        }
        if ("scriptId" in res && res.scriptId) {
          router.push(`/script/${res.scriptId}${res.writing ? "?writing=1" : ""}`);
          return;
        }
        if ("projectId" in res && res.projectId) router.push(`/projects/${res.projectId}`);
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 24, flexShrink: 0, maxWidth: 860 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <AgentIcon agent="script" size={26} radius={7} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t("等着写的选题", "Topics waiting for a script")}</div>
          <div style={{ fontSize: 12, color: "#999999", marginTop: 1 }}>
            {t("从首页、研究页、选题储备和今天的计划来的。按一下，编剧就开始写，写好出现在脚本里。", "From Home, Research, the backlog and today's plan. One press and the writer starts; the draft lands in the script.")}
          </div>
        </div>
      </div>

      {!items.length ? (
        <div style={{ border: "1px dashed #e2e2e2", borderRadius: 12, padding: "18px 16px", background: "#fcfcfc" }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{t("现在没有等着写的选题", "Nothing is waiting for a script")}</div>
          <p style={{ fontSize: 12.5, color: "#7c7c7c", lineHeight: 1.6, margin: "6px 0 0" }}>
            {t("在首页让研究员出几个选题，或者在研究页挑一个，都会出现在这里。", "Ask the researcher for ideas on Home, or pick one in Research; they show up here.")}
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 12.5 }}>
            <Link prefetch={false} href="/home" style={{ color: "#0f5bd5", textDecoration: "none" }}>
              {t("去首页 →", "Home →")}
            </Link>
            <Link prefetch={false} href="/research" style={{ color: "#0f5bd5", textDecoration: "none" }}>
              {t("去研究页 →", "Research →")}
            </Link>
          </div>
        </div>
      ) : (
        items.map((it) => (
          <div key={it.key} style={{ border: "1px solid #ededed", borderRadius: 12, background: "#fff", padding: "11px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: "#525252", background: it.kind === "project" ? "#f8dcc6" : "#d5e7fb", borderRadius: 999, padding: "1px 8px", flexShrink: 0, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.kind === "project" ? t("项目 · 等初稿", "Project · needs a draft") : it.label}
              </span>
              {it.strength ? (
                <span title={t("信号强度", "Signal strength")} style={{ fontSize: 10.5, color: "#c2410c", letterSpacing: 1, flexShrink: 0 }}>
                  {"●".repeat(it.strength)}
                  {"○".repeat(Math.max(0, 5 - it.strength))}
                </span>
              ) : null}
              <span style={{ flexGrow: 1 }} />
              {it.writing ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#b3420e", flexShrink: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: "#b3420e", animation: "auraPulse 1.6s ease-in-out infinite" }} />
                  {t("编剧正在写", "The writer is writing")}
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45, color: "#171717" }}>{it.title}</div>
            {it.why ? <div style={{ fontSize: 12.5, color: "#525252", lineHeight: 1.6 }}>{it.why}</div> : null}
            {it.hook ? <div style={{ fontSize: 12, color: "#7c7c7c", lineHeight: 1.55 }}>{t(`开头：「${it.hook}」`, `Opening: “${it.hook}”`)}</div> : null}
            {it.evidence.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {it.evidence.map((e, k) =>
                  e.url ? (
                    <a key={k} href={e.url} target="_blank" rel="noopener noreferrer" title={e.title} style={chip}>
                      <Icon name="external" size={10} />
                      {e.label} {e.numbers}
                    </a>
                  ) : (
                    <span key={k} title={e.title} style={chip}>
                      {e.label} {e.numbers}
                    </span>
                  ),
                )}
              </div>
            ) : null}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              {it.writing && it.scriptId ? (
                <Link prefetch={false} href={`/script/${it.scriptId}?writing=1`} style={{ ...btn(true), textDecoration: "none" }}>
                  <Icon name="pen" size={13} /> {t("看编剧写", "Watch it being written")}
                </Link>
              ) : canStart ? (
                <button type="button" disabled={busy !== null} onClick={() => write(it)} style={{ ...btn(true), opacity: busy === it.key ? 0.6 : 1 }}>
                  <Icon name="pen" size={13} /> {it.kind === "project" ? t("让编剧写初稿", "Have the writer draft it") : t("开项目并写脚本", "Start it and write the script")}
                </button>
              ) : null}
              {it.scriptId && !it.writing ? (
                <Link prefetch={false} href={`/script/${it.scriptId}`} style={{ ...btn(false), textDecoration: "none" }}>
                  {t("打开脚本", "Open the script")}
                </Link>
              ) : null}
              {it.projectId ? (
                <Link prefetch={false} href={`/projects/${it.projectId}`} style={{ fontSize: 12, color: "#525252", textDecoration: "none" }}>
                  {t("打开项目 →", "Open the project →")}
                </Link>
              ) : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

const chip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#525252", background: "#f5f7fb", borderRadius: 999, padding: "2px 9px", textDecoration: "none", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function btn(primary: boolean): React.CSSProperties {
  return {
    height: 30,
    padding: "0 12px",
    borderRadius: 8,
    border: primary ? 0 : "1px solid #e2e2e2",
    background: primary ? "#171717" : "#fff",
    color: primary ? "#fff" : "#171717",
    fontFamily: "inherit",
    fontSize: 12,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
}
