"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { DetailLink } from "@/components/home/DetailLink";
import { AGENT_COLORS } from "@/lib/agents/catalog";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";
import type { Idea } from "@/lib/ideas/types";

/**
 * Home's ideas module: researched video ideas, each one a project away.
 *
 * The gap the client named: "without research on title it just goes
 * straight to script generation". So here 研究员 works ideas out of what the
 * studio has already collected (the hot lists, this morning's brief, the
 * channel's own numbers, the backlog; see `lib/ideas/service.ts`), each with
 * the rows it stands on and their numbers, and a person can talk it through
 * with 研究员 before anything is written.
 *
 * Starting one makes the project and starts 编剧 on the draft, and then asks
 * rather than moves: open the project (or the script being written), or stay
 * on Home. Nobody is taken off the page they were working on.
 *
 * The generate call is a route (`/api/ideas`), awaited, 20 to 60 seconds; the
 * panel shows what 研究员 is doing meanwhile rather than a spinner.
 */
export function IdeasPanel({ zh, initial, canStart, canResearch = true }: { zh: boolean; initial: Idea[]; canStart: boolean; canResearch?: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [items, setItems] = React.useState<Idea[]>(initial);
  const [seed, setSeed] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [started, setStarted] = React.useState<Record<string, { projectId: string; scriptId: string | null; writing: boolean; existed: boolean }>>({});
  const [working, setWorking] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [question, setQuestion] = React.useState("");
  /* One thread with 研究员 for the panel, started fresh for each idea asked
     about, so an answer about one idea never sits under another. */
  const agent = useInlineAgent({ module: "research" }, { agent: "research" });

  /* The seconds on the progress line, only while a batch is being written. */
  React.useEffect(() => {
    if (!busy) return;
    const from = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - from) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setElapsed(0);
    setError(null);
    try {
      const r = await fetch("/api/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seed: seed.trim() || null, n: 5 }) });
      const j = (await r.json().catch(() => ({}))) as { items?: Idea[]; error?: string };
      if (!r.ok || !j.items) {
        setError(j.error ?? t("研究员这次没有写出来，再试一次。", "The researcher could not write them this time; try again."));
        return;
      }
      setItems(j.items);
      setStarted({});
    } catch {
      setError(t("连不上服务器，再试一次。", "Could not reach the server; try again."));
    } finally {
      setBusy(false);
    }
  }

  async function mark(idea: Idea, status: "saved" | "dismissed") {
    const before = items;
    setItems((list) => (status === "dismissed" ? list.filter((x) => x.id !== idea.id) : list.map((x) => (x.id === idea.id ? { ...x, status } : x))));
    const r = await fetch(`/api/ideas/${idea.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => null);
    if (!r?.ok) {
      setItems(before);
      notify(t("没存上，再试一次。", "Could not save that; try again."));
      return;
    }
    if (status === "saved") notify(t("已存进选题储备", "Saved to the topic backlog"), "ok");
  }

  function startOne(idea: Idea) {
    if (working) return;
    setWorking(idea.id);
    void (async () => {
      try {
        const res = await startFromTopicAction({ kind: "idea", id: idea.id }, { write: true });
        if ("error" in res && res.error) {
          notify(res.error);
          return;
        }
        if ("projectId" in res && res.projectId) {
          setStarted((m) => ({ ...m, [idea.id]: { projectId: res.projectId, scriptId: res.scriptId ?? null, writing: Boolean(res.writing), existed: Boolean(res.existed) } }));
          setItems((list) => list.map((x) => (x.id === idea.id ? { ...x, status: "started", projectId: res.projectId } : x)));
          if (res.note) notify(res.note, "info");
          /* The sidebar's project list, quietly; the panel keeps its state. */
          router.refresh();
        }
      } finally {
        setWorking(null);
      }
    })();
  }

  function ask(idea: Idea) {
    const q = question.trim();
    if (!q) return;
    const context = [
      `关于首页上研究员给的这个选题《${idea.title}》`,
      idea.angle ? `角度：${idea.angle}` : "",
      idea.why ? `为什么现在：${idea.why}` : "",
      idea.evidence.length ? `证据：${idea.evidence.map((e) => `${e.label}「${e.title}」${e.numbers ? ` ${e.numbers}` : ""}`).join("；")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    void agent.send(`${context}\n\n${q}`);
    setQuestion("");
  }

  const stage = elapsed < 6 ? t("读存下来的热榜和晨报…", "Reading the stored hot lists and the brief…") : elapsed < 14 ? t("对照本频道的数据和选题储备…", "Checking against the channel's numbers and the backlog…") : elapsed < 40 ? t("研究员在想选题…", "The researcher is working out ideas…") : t("核对每个选题的证据…", "Checking each idea's evidence…");
  const visible = items.filter((x) => x.status !== "dismissed");

  return (
    <section style={TINT_PANEL}>
      <div style={TINT_PANEL_HEAD}>
        <AgentIcon agent="research" size={18} radius={5} />
        <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap" }}>{t("选题灵感 · 研究员", "Ideas · the researcher")}</span>
        <span style={{ fontSize: 12, color: "#999999", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("从存下来的热榜、晨报和本频道数据里挑的", "from the stored hot lists, the brief and the channel's own numbers")}</span>
        <span style={{ flexGrow: 1 }} />
        {canResearch ? <DetailLink zh={zh} href="/research/backlog" /> : null}
      </div>

      <div style={TINT_PANEL_BODY}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
          style={{ display: "flex", gap: 8, alignItems: "center" }}
        >
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            disabled={busy}
            maxLength={200}
            placeholder={t("想做什么方向？可不填", "Any direction in mind? Optional")}
            style={{ flexGrow: 1, minWidth: 0, height: 32, border: "1px solid #e2e2e2", borderRadius: 9, padding: "0 11px", fontFamily: "inherit", fontSize: 12.5, outline: "none", background: busy ? "#fafafa" : "#fff" }}
          />
          {/* Black only while it is the panel's one thing to do (no ideas
              yet). With a batch on screen the ideas are the point, and a
              second batch is a white button with the researcher's blue spark. */}
          <button
            type="submit"
            disabled={busy}
            style={{
              ...btn(!visible.length),
              height: 32,
              padding: "0 13px",
              borderRadius: 9,
              fontSize: 12.5,
              flexShrink: 0,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            <Icon name="spark" size={13} color={visible.length ? AGENT_COLORS.research : undefined} /> {busy ? t("生成中…", "Working…") : visible.length ? t("再出一批", "New batch") : t("生成选题", "Generate ideas")}
          </button>
        </form>

        {busy ? (
          <div role="status" style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10, padding: "9px 11px", borderRadius: 10, background: "#f3f8fe", border: "1px solid #d5e7fb" }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: "#0f5bd5", flexShrink: 0, animation: "auraPulse 1.6s ease-in-out infinite" }} />
            <span style={{ fontSize: 12.5, color: "#2b343d", flexGrow: 1 }}>{stage}</span>
            <span style={{ fontSize: 11.5, color: "#7c7c7c", fontVariantNumeric: "tabular-nums" }}>{t(`${elapsed} 秒`, `${elapsed}s`)}</span>
          </div>
        ) : null}
        {error ? <div style={{ marginTop: 10, fontSize: 12.5, color: "#c42b2b", lineHeight: 1.55 }}>{error}</div> : null}

        {!visible.length && !busy ? (
          <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: "#fafbfd", border: "1px dashed #dfe6f1" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#171717" }}>{t("先有研究，再写脚本", "Research first, then the script")}</div>
            <p style={{ fontSize: 12.5, color: "#525252", lineHeight: 1.65, margin: "4px 0 0" }}>
              {t(
                "按「生成选题」，研究员会从已经采集的热榜、今早的晨报、本频道视频的表现和选题储备里，挑出几个值得拍的题。每个都带标题备选、角度、为什么是现在和证据（平台自己的数字）。满意的一键开项目，编剧接着写初稿；也可以先问研究员。",
                "Press Generate and the researcher picks a few topics worth filming from the hot lists already collected, this morning's brief, how the channel's videos did and the backlog. Each comes with title options, an angle, why now and the evidence (the platforms' own numbers). Start one and the writer drafts it; or ask the researcher first.",
              )}
            </p>
          </div>
        ) : null}

        {visible.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
            {visible.map((idea, i) => {
              const done = started[idea.id];
              const projectId = done?.projectId ?? idea.projectId;
              return (
                <div key={idea.id} style={{ borderTop: i ? "1px solid #f0f0f0" : "none", paddingTop: i ? 14 : 0 }}>
                  {/* The title wraps; the strength and the format stay on its
                      first line (a box as tall as that line, centred in it). */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: "#171717", minWidth: 0 }}>{idea.title}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 21, flexShrink: 0 }}>
                      {idea.strength ? <Strength n={idea.strength} title={t("研究员觉得有多强", "How strong the researcher thinks it is")} /> : null}
                      {idea.format ? <span style={{ fontSize: 11, color: "#7c7c7c", background: "#f3f3f1", borderRadius: 999, padding: "0 7px", lineHeight: "18px" }}>{idea.format}</span> : null}
                    </span>
                  </div>
                  {idea.titles.length ? <div style={{ fontSize: 12, color: "#8a8a8a", marginTop: 3, lineHeight: 1.5 }}>{t("也可以叫：", "Or: ")}{idea.titles.join(" / ")}</div> : null}
                  {/* Angle, why now and the opening as three labelled lines in
                      one column, so the eye can run down the labels instead of
                      reading three sentences run together. */}
                  {idea.angle || idea.why || idea.hook ? (
                    <div style={FACTS}>
                      {idea.angle ? (
                        <>
                          <span style={FACT_LABEL}>{t("角度", "Angle")}</span>
                          <span style={{ color: "#2b343d" }}>{idea.angle}</span>
                        </>
                      ) : null}
                      {idea.why ? (
                        <>
                          <span style={FACT_LABEL}>{t("理由", "Why now")}</span>
                          <span style={{ color: "#525252" }}>{idea.why}</span>
                        </>
                      ) : null}
                      {idea.hook ? (
                        <>
                          <span style={FACT_LABEL}>{t("开头", "Opening")}</span>
                          <span style={{ color: "#525252" }}>{t(`「${idea.hook}」`, `“${idea.hook}”`)}</span>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {idea.evidence.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {idea.evidence.map((e, k) =>
                        e.url ? (
                          <a key={k} href={e.url} target="_blank" rel="noopener noreferrer" title={e.title} style={chip}>
                            <Icon name="external" size={10} />
                            <span style={{ color: "#7c7c7c" }}>{e.label}</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{e.title}</span>
                            {e.numbers ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{e.numbers.split(" · ").slice(0, 2).join(" · ")}</span> : null}
                          </a>
                        ) : (
                          <span key={k} title={e.title} style={chip}>
                            <span style={{ color: "#7c7c7c" }}>{e.label}</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{e.title}</span>
                            {e.numbers ? <span>{e.numbers.split(" · ").slice(0, 2).join(" · ")}</span> : null}
                          </span>
                        ),
                      )}
                    </div>
                  ) : null}

                  {done ? (
                    <StartedNotice zh={zh} title={idea.title} projectId={done.projectId} scriptId={done.scriptId} writing={done.writing} existed={done.existed} onStay={() => setStarted((m) => { const next = { ...m }; delete next[idea.id]; return next; })} />
                  ) : (
                    <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                      {/* Started: a link only to a project this person can open.
                          The server answers an idea whose project was deleted
                          as new (so it can be started again), and one whose
                          project is private to others as started with no id:
                          said, not linked, so nothing here leads to a 404. */}
                      {idea.status === "started" && projectId ? (
                        <Link prefetch={false} href={`/projects/${projectId}`} style={{ ...btn(false), textDecoration: "none" }}>
                          <Icon name="check" size={13} /> {t("已开项目 · 打开", "Started · open it")}
                        </Link>
                      ) : idea.status === "started" ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, fontSize: 12, color: "#7c7c7c" }}>
                          <Icon name="check" size={13} /> {t("已有同事开了项目", "A colleague has started a project from it")}
                        </span>
                      ) : canStart ? (
                        /* In 编剧's tint, not black: five ideas used to carry
                           five black buttons, and the eye had nowhere to land. */
                        <button type="button" className="ip-go" disabled={working !== null} onClick={() => startOne(idea)} style={{ ...tintBtn(), opacity: working === idea.id ? 0.6 : 1 }}>
                          <Icon name="pen" size={13} /> {working === idea.id ? t("正在开项目…", "Starting…") : t("开项目并写脚本", "Start it and write the script")}
                        </button>
                      ) : null}
                      {idea.status !== "started" ? (
                        <button type="button" disabled={idea.status === "saved"} onClick={() => void mark(idea, "saved")} style={{ ...btn(false), color: idea.status === "saved" ? "#278f5e" : "#171717", cursor: idea.status === "saved" ? "default" : "pointer" }}>
                          <Icon name={idea.status === "saved" ? "check" : "plus"} size={13} /> {idea.status === "saved" ? t("已存进选题储备", "In the backlog") : t("存进选题储备", "Save to the backlog")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          if (asking !== idea.id && agent.messages.length) agent.reset();
                          setAsking(asking === idea.id ? null : idea.id);
                        }}
                        style={{ ...btn(false), borderColor: asking === idea.id ? "#0f5bd5" : "#e2e2e2" }}
                      >
                        <Icon name="chat" size={13} /> {t("问研究员", "Ask the researcher")}
                      </button>
                      <span style={{ flexGrow: 1 }} />
                      {idea.status !== "started" ? (
                        <button type="button" onClick={() => void mark(idea, "dismissed")} style={{ border: 0, background: "transparent", padding: "0 4px", fontFamily: "inherit", fontSize: 12, color: "#999999", cursor: "pointer" }}>
                          {t("不要", "Not this")}
                        </button>
                      ) : null}
                    </div>
                  )}

                  {asking === idea.id ? (
                    <div style={{ marginTop: 8, border: "1px solid #e4e9f3", borderRadius: 11, background: "#fafbfd", overflow: "hidden" }}>
                      {agent.messages.length ? (
                        <div style={{ maxHeight: 280, display: "flex", flexDirection: "column" }}>
                          <InlineAgentThread messages={agent.messages} notice={agent.notice} conversationId={agent.conversationId} zh={zh} />
                        </div>
                      ) : null}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          ask(idea);
                        }}
                        style={{ display: "flex", gap: 6, padding: 8 }}
                      >
                        <input
                          autoFocus
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                          placeholder={t("比如：这个题对标账号怎么拍的？数据站得住吗？", "e.g. How did rivals film this? Do the numbers hold?")}
                          style={{ flexGrow: 1, minWidth: 0, height: 30, border: "1px solid #e2e2e2", borderRadius: 8, padding: "0 10px", fontFamily: "inherit", fontSize: 12.5, outline: "none", background: "#fff" }}
                        />
                        <button type="submit" disabled={agent.busy || !question.trim()} style={{ ...btn(true), height: 30 }}>
                          {agent.busy ? t("回答中…", "Answering…") : t("问", "Ask")}
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * How strong the researcher thinks a topic is, as five dots in the
 * researcher's own colours: the blue for the strength it has, the light tint
 * (a step darker, `EMPTY_DOT`, so it still shows on white) for the rest. (It was "●●●○○" in orange, which matched nothing else on the
 * page and drew in whatever size the font gave those two characters.)
 */
export function Strength({ n, title }: { n: number; title: string }) {
  const k = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span role="img" aria-label={`${k}/5`} title={title} style={{ display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: 3, background: i < k ? AGENT_COLORS.research : EMPTY_DOT }} />
      ))}
    </span>
  );
}

/**
 * The frame the researcher's two Home panels share (these ideas and today's
 * suggestion): the same radius, header and body padding as a `Fold`, so the
 * wide column reads as one set of panels, with the research-to-planning tint
 * on the edge as the only thing that marks them as the researcher's.
 */
export const TINT_PANEL: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid transparent",
  background: "linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(135deg, #d5e7fb, #dcd6fb 55%, #d5e7fb) border-box",
  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
  minWidth: 0,
};
export const TINT_PANEL_HEAD: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: "1px solid #eef1f6", minWidth: 0 };
export const TINT_PANEL_BODY: React.CSSProperties = { padding: "12px 14px 14px" };

/**
 * The start press on an idea or a suggestion, in 编剧's tint (it starts the
 * writer), darkening on hover. Drawn once by Home, beside `DETAIL_LINK_CSS`.
 */
export const IDEAS_CSS = `
.ip-go { background: #fdefe4; border: 1px solid #f4d5bd; color: #8f3510; transition: background-color .15s ease, border-color .15s ease; }
.ip-go:hover:not(:disabled) { background: #f8dcc6; border-color: #ecbf9c; color: #7a2c0b; }
.ip-go:focus-visible { outline: 2px solid #b3420e; outline-offset: 1px; }
.ip-go:disabled { cursor: default; }
`;

/** 研究员's tint (`AGENT_TINTS.research`), a step darker so an empty dot still shows on white. */
const EMPTY_DOT = "#c4d8f4";

const FACTS: React.CSSProperties = { display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: 10, rowGap: 3, marginTop: 7, fontSize: 12.5, lineHeight: 1.6 };
const FACT_LABEL: React.CSSProperties = { fontSize: 11.5, lineHeight: "20px", color: "#a3a3a3", whiteSpace: "nowrap" };

/**
 * After a start from Home: the project exists and 编剧 may be writing.
 * The person chooses where to be; the page does not move on its own.
 */
export function StartedNotice({ zh, title, projectId, scriptId, writing, existed, onStay }: { zh: boolean; title: string; projectId: string; scriptId: string | null; writing: boolean; existed: boolean; onStay: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  return (
    <div role="status" style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "#f4fbf8", border: "1px solid #c3e6e0", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <AgentIcon agent={writing ? "script" : "research"} size={24} radius={7} />
      <div style={{ flexGrow: 1, minWidth: 180 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#171717" }}>
          {existed ? t(`这个选题已经有项目了：《${title}》`, `This topic already has a project: “${title}”`) : t(`项目已开：《${title}》`, `Project started: “${title}”`)}
        </div>
        <div style={{ fontSize: 12, color: "#525252", marginTop: 2 }}>
          {writing ? t("编剧正在写初稿，写好会出现在脚本里。", "The writer is drafting it; the draft lands in the script.") : t("去项目里接着做，或者留在这里。", "Carry on in the project, or stay here.")}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {writing && scriptId ? (
          <Link prefetch={false} href={`/script/${scriptId}?writing=1`} style={{ ...btn(true), textDecoration: "none" }}>
            <Icon name="pen" size={13} /> {t("去看脚本", "Watch the script")}
          </Link>
        ) : null}
        <Link prefetch={false} href={`/projects/${projectId}`} style={{ ...btn(!(writing && scriptId)), textDecoration: "none" }}>
          {t("打开项目", "Open the project")}
        </Link>
        <button type="button" onClick={onStay} style={btn(false)}>
          {t("留在这里", "Stay here")}
        </button>
      </div>
    </div>
  );
}

const chip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#525252", background: "#f5f7fb", borderRadius: 999, padding: "2px 9px", textDecoration: "none", maxWidth: "100%", minWidth: 0 };

/** `btn` without its colours, which the `ip-go` class supplies (inline colours would beat its hover). */
export function tintBtn(): React.CSSProperties {
  return { ...btn(false), background: undefined, border: undefined, color: undefined };
}

function btn(primary: boolean): React.CSSProperties {
  return {
    height: 30,
    padding: "0 12px",
    borderRadius: 8,
    border: primary ? "1px solid #171717" : "1px solid #e2e2e2",
    background: primary ? "#171717" : "#fff",
    color: primary ? "#fff" : "#171717",
    fontFamily: "inherit",
    fontSize: 12,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
  };
}
