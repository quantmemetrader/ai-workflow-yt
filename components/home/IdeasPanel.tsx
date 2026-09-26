"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Fold } from "@/components/ui/Fold";
import { Icon } from "@/components/ui/Icon";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { DetailLink } from "@/components/home/DetailLink";
import { EvidenceChips, Facts, RowTag, StartedNotice, TopicRow, btn, smallBtn, tintBtn } from "@/components/home/TopicRow";
import { AGENT_COLORS } from "@/lib/agents/catalog";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";
import type { Idea } from "@/lib/ideas/types";

export { IDEAS_CSS, Strength } from "@/components/home/TopicRow";

/** Rows shown before "再看 N 个". */
const SHOWN = 3;

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
 * Compact on purpose (the owner: "super filled ... looking super ugly"): a
 * `Fold` like every other panel on Home, three one-line rows (`TopicRow`)
 * and "再看 N 个" for the rest; a row opens in place, one at a time, for the
 * other titles, angle, why, opening, evidence and every press, and the box
 * to ask 研究员 shows only once 问研究员 is pressed. The direction box and
 * the new-batch press sit small in the panel's footer.
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
  const [open, setOpen] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
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
      setOpen(null);
      setAsking(null);
      setShowAll(false);
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

  function toggle(id: string) {
    setOpen((cur) => (cur === id ? null : id));
    /* The ask box belongs to the open idea; another row opening closes it
       (the thread itself is reset only when a different idea is asked). */
    if (asking && asking !== id) setAsking(null);
  }

  const stage = elapsed < 6 ? t("读存下来的热榜和晨报…", "Reading the stored hot lists and the brief…") : elapsed < 14 ? t("对照本频道的数据和选题储备…", "Checking against the channel's numbers and the backlog…") : elapsed < 40 ? t("研究员在想选题…", "The researcher is working out ideas…") : t("核对每个选题的证据…", "Checking each idea's evidence…");
  const visible = items.filter((x) => x.status !== "dismissed");
  const shown = showAll ? visible : visible.slice(0, SHOWN);
  const more = visible.length - SHOWN;

  const status = busy ? (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 11px", borderRadius: 9, background: "#f3f8fe", border: "1px solid #d5e7fb" }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: "#0f5bd5", flexShrink: 0, animation: "auraPulse 1.6s ease-in-out infinite" }} />
      <span style={{ fontSize: 12.5, color: "#2b343d", flexGrow: 1, minWidth: 0 }}>{stage}</span>
      <span style={{ fontSize: 11.5, color: "#7c7c7c", fontVariantNumeric: "tabular-nums" }}>{t(`${elapsed} 秒`, `${elapsed}s`)}</span>
    </div>
  ) : null;
  /* With a batch on screen, the same progress as one line in the footer, in
     place of "再看 N 个": the rows do not move down under the pointer while
     a new batch is being written. */
  const statusInline = busy ? (
    <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 7, flex: "1 1 auto", minWidth: 0, fontSize: 12, color: "#2b343d" }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: "#0f5bd5", flexShrink: 0, animation: "auraPulse 1.6s ease-in-out infinite" }} />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stage}</span>
      <span style={{ fontSize: 11.5, color: "#7c7c7c", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{t(`${elapsed} 秒`, `${elapsed}s`)}</span>
    </span>
  ) : null;
  const errorLine = error ? <div style={{ fontSize: 12.5, color: "#c42b2b", lineHeight: 1.55 }}>{error}</div> : null;

  /* The direction box and the press, on one line: the panel's one black
     press while there is nothing else to do, a white one with the
     researcher's blue spark once there is a batch to look at. */
  const form = (compact: boolean) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void generate();
      }}
      style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0, flex: compact ? "0 1 340px" : "1 1 auto" }}
    >
      <input
        value={seed}
        onChange={(e) => setSeed(e.target.value)}
        disabled={busy}
        maxLength={200}
        aria-label={t("选题方向（可不填）", "Direction (optional)")}
        placeholder={t("想做什么方向？可不填", "Any direction? Optional")}
        style={{ flex: "1 1 auto", minWidth: 0, height: 28, border: "1px solid #e6e6e6", borderRadius: 8, padding: "0 10px", fontFamily: "inherit", fontSize: 12, outline: "none", background: busy ? "#fafafa" : "#fff" }}
      />
      <button
        type="submit"
        disabled={busy}
        className={compact ? "ip-quiet" : undefined}
        style={{ ...(compact ? tintBtn() : btn(true)), height: 28, padding: "0 11px", flexShrink: 0, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
      >
        <Icon name="spark" size={12} color={compact ? AGENT_COLORS.research : undefined} /> {busy ? t("生成中…", "Working…") : compact ? t("再出一批", "New batch") : t("生成选题", "Generate ideas")}
      </button>
    </form>
  );

  return (
    <Fold
      id="home-ideas"
      title={t("选题灵感 · 研究员", "Ideas · the researcher")}
      sub={t("从存下来的热榜、晨报和本频道数据里挑的", "from the stored hot lists, the brief and the channel's own numbers")}
      icon={<AgentIcon agent="research" size={18} radius={5} />}
      resizable={false}
      flush
      right={canResearch ? <DetailLink zh={zh} href="/research/backlog" /> : null}
      footer={
        visible.length ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", minWidth: 0 }}>
            {statusInline ?? (more > 0 ? (
              <button type="button" className="ip-more" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                {showAll ? t("收起", "Show fewer") : t(`再看 ${more} 个`, `${more} more`)}
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: showAll ? "rotate(-90deg)" : "rotate(90deg)", transition: "transform .15s ease" }}>
                  <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />
                </svg>
              </button>
            ) : null)}
            {statusInline ? null : <span style={{ flexGrow: 1 }} />}
            {form(true)}
          </div>
        ) : null
      }
    >
      {!visible.length ? (
        /* Nothing yet: one line on what this is, and the press. */
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {status ?? (
            <div style={{ fontSize: 12.5, color: "#7c7c7c", lineHeight: 1.55 }}>
              <span style={{ color: "#171717", fontWeight: 600 }}>{t("先有研究，再写脚本。", "Research first, then the script.")}</span>
              {t("研究员从热榜、晨报和本频道数据里挑值得拍的题。", " The researcher picks topics from the hot lists, the brief and your numbers.")}
            </div>
          )}
          {errorLine}
          {form(false)}
        </div>
      ) : (
        <>
          {errorLine ? <div style={{ padding: "9px 14px", borderBottom: "1px solid #f0f0f0" }}>{errorLine}</div> : null}
          {shown.map((idea, i) => (
            <IdeaRow
              key={idea.id}
              zh={zh}
              idea={idea}
              first={i === 0}
              open={open === idea.id}
              onToggle={() => toggle(idea.id)}
              canStart={canStart}
              working={working}
              done={started[idea.id]}
              onStart={() => startOne(idea)}
              onMark={(s) => void mark(idea, s)}
              onStay={() =>
                setStarted((m) => {
                  const next = { ...m };
                  delete next[idea.id];
                  return next;
                })
              }
              asking={asking === idea.id}
              onAsk={() => {
                if (asking !== idea.id && agent.messages.length) agent.reset();
                setAsking(asking === idea.id ? null : idea.id);
              }}
              askBox={
                asking === idea.id ? (
                  <div style={{ marginTop: 10, border: "1px solid #e4e9f3", borderRadius: 11, background: "#fff", overflow: "hidden" }}>
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
                ) : null
              }
            />
          ))}
        </>
      )}
    </Fold>
  );
}

/**
 * One idea: shut, a row with its strength, title, one grey line of why, the
 * format and the one start press; open, the other titles, angle, why and
 * opening as labelled lines, up to three pieces of evidence, and every press.
 */
function IdeaRow({
  zh,
  idea,
  first,
  open,
  onToggle,
  canStart,
  working,
  done,
  onStart,
  onMark,
  onStay,
  asking,
  onAsk,
  askBox,
}: {
  zh: boolean;
  idea: Idea;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  canStart: boolean;
  working: string | null;
  done: { projectId: string; scriptId: string | null; writing: boolean; existed: boolean } | undefined;
  onStart: () => void;
  onMark: (status: "saved" | "dismissed") => void;
  onStay: () => void;
  asking: boolean;
  onAsk: () => void;
  askBox: React.ReactNode;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const projectId = done?.projectId ?? idea.projectId;
  const isStarted = idea.status === "started";
  const startingThis = working === idea.id;

  /* Started: a link only to a project this person can open. The server
     answers an idea whose project was deleted as new (so it can be started
     again), and one whose project is private to others as started with no
     id: said, not linked, so nothing here leads to a 404. */
  const startedMark =
    isStarted && projectId ? (
      <Link prefetch={false} href={`/projects/${projectId}`} className="ip-quiet" style={{ ...smallBtn(), textDecoration: "none" }}>
        <Icon name="check" size={12} color="#278f5e" /> {t("已开项目 · 打开", "Started · open")}
      </Link>
    ) : isStarted ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 26, fontSize: 12, color: "#7c7c7c", whiteSpace: "nowrap" }}>
        <Icon name="check" size={12} /> {t("同事已开项目", "A colleague started it")}
      </span>
    ) : null;

  /* The row's one press, while shut; open, the full row of presses below
     carries it. In 编剧's tint, not black: a list of ideas used to carry a
     black button each, and the eye had nowhere to land. */
  const rowAction = open || done ? null : startedMark ?? (canStart ? (
    <button type="button" className="ip-go" disabled={working !== null} onClick={onStart} title={t("开项目，编剧接着写初稿", "Start a project; the writer drafts it")} style={{ ...smallBtn(), opacity: startingThis ? 0.6 : 1 }}>
      <Icon name="pen" size={12} /> {startingThis ? t("开项目…", "Starting…") : t("开项目", "Start")}
    </button>
  ) : null);

  return (
    <TopicRow
      first={first}
      open={open}
      onToggle={onToggle}
      strength={idea.strength}
      strengthTitle={t("研究员觉得有多强", "How strong the researcher thinks it is")}
      title={idea.title}
      line={idea.why ?? idea.angle}
      meta={
        <>
          {idea.status === "saved" ? (
            <RowTag tone="ok" title={t("已存进选题储备", "In the backlog")}>
              <Icon name="check" size={10} /> {t("已存", "Saved")}
            </RowTag>
          ) : null}
          {idea.format ? <RowTag>{idea.format}</RowTag> : null}
        </>
      }
      action={rowAction}
      notice={done ? <StartedNotice zh={zh} title={idea.title} projectId={done.projectId} scriptId={done.scriptId} writing={done.writing} existed={done.existed} onStay={onStay} /> : null}
    >
      <Facts
        rows={[
          [t("备选", "Or"), idea.titles.length ? <span style={{ color: "#525252" }}>{idea.titles.join(" / ")}</span> : null],
          [t("角度", "Angle"), idea.angle],
          [t("理由", "Why now"), idea.why ? <span style={{ color: "#525252" }}>{idea.why}</span> : null],
          [t("开头", "Opening"), idea.hook ? <span style={{ color: "#525252" }}>{t(`「${idea.hook}」`, `“${idea.hook}”`)}</span> : null],
          [t("证据", "Evidence"), idea.evidence.length ? <EvidenceChips items={idea.evidence} /> : null],
        ]}
      />
      {done ? null : (
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          {startedMark ??
            (canStart ? (
              <button type="button" className="ip-go" disabled={working !== null} onClick={onStart} style={{ ...tintBtn(), opacity: startingThis ? 0.6 : 1 }}>
                <Icon name="pen" size={13} /> {startingThis ? t("正在开项目…", "Starting…") : t("开项目并写脚本", "Start it and write the script")}
              </button>
            ) : null)}
          {!isStarted ? (
            <button type="button" disabled={idea.status === "saved"} onClick={() => onMark("saved")} style={{ ...btn(false), color: idea.status === "saved" ? "#278f5e" : "#171717", cursor: idea.status === "saved" ? "default" : "pointer" }}>
              <Icon name={idea.status === "saved" ? "check" : "plus"} size={13} /> {idea.status === "saved" ? t("已存进选题储备", "In the backlog") : t("存进选题储备", "Save to the backlog")}
            </button>
          ) : null}
          <button type="button" onClick={onAsk} aria-expanded={asking} style={{ ...btn(false), borderColor: asking ? "#0f5bd5" : "#e2e2e2" }}>
            <Icon name="chat" size={13} /> {t("问研究员", "Ask the researcher")}
          </button>
          <span style={{ flexGrow: 1 }} />
          {!isStarted ? (
            <button type="button" onClick={() => onMark("dismissed")} style={{ border: 0, background: "transparent", padding: "0 4px", fontFamily: "inherit", fontSize: 12, color: "#999999", cursor: "pointer" }}>
              {t("不要", "Not this")}
            </button>
          ) : null}
        </div>
      )}
      {askBox}
    </TopicRow>
  );
}
