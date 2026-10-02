"use client";

import { AttachButton, AttachChips, useAttachments } from "@/components/chat/Attach";
import { ModelChip, getPanelModel, usePanelModel } from "@/components/chat/ModelChip";
import { DropVeil, useFileDrop } from "@/components/chat/DropVeil";
import { uploadToStudio } from "@/components/chat/upload";
import { unlockAction } from "@/app/(app)/script/actions";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon, type IconName } from "@/components/ui/Icon";
import { MentionMenu, type MentionPerson } from "@/components/chat/MentionMenu";
import { useMentions } from "@/components/chat/useMentions";
import { AGENT_COLORS, AGENT_TINTS, agentTag, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import { pressCardAction, sendChannelMessage } from "@/app/(app)/chat/actions";
import { applySendBackAction, settleSendBackAction, chooseScriptAction, chooseTopicAction } from "@/app/(app)/projects/actions";
import { addClipAction, addItemAction } from "@/app/(app)/video/actions";
import { notify } from "@/lib/client/notify";
import { useLiveProject } from "@/lib/client/live";
import { isRunning } from "@/lib/projects/live-types";
import { StepCards } from "@/components/projects/StepCards";
import { FlowMoves } from "@/components/projects/FlowMoves";
import { Card, GoButton, NextStep, smallButton } from "@/components/projects/kit";
import { tabHref } from "@/lib/projects/tabs";
import { LivePill, useLiveRow } from "@/components/chat/LivePill";
import type { ProjectDetail, ProjectStep } from "@/lib/projects/service";
import type { SentBack } from "@/lib/projects/sendback";
import { frontierStep } from "@/lib/home/roles";
import { cleanCodes, type ProjectSource } from "@/lib/projects/topic";
import { JobChip } from "@/components/chat/Working";
import type { StepKey } from "@/lib/agents/steps";
import { AgentTyping } from "@/components/agents/AgentTyping";
import { AgentName, Tr } from "@/components/ui/Tr";
import { artifactHref } from "@/lib/chat/handoff";
import { LinkedText } from "@/components/chat/LinkedText";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { VideoCards } from "@/components/chat/VideoCard";

/**
 * A project's overview and its topic page.
 *
 * The overview is the five steps as blocks of one size (`StepCards`), each
 * opening its own page, and the project's conversation; the topic page is
 * 研究员's findings with the asks. The script, edit, publish, review and
 * files pages are their own routes under `/projects/[id]/…` (28 Sep: the one
 * long page with every card on it was "a bit messy").
 *
 * The page keeps asking the server for the project's stamp while anybody is
 * at work on it (`/api/projects/[id]/pulse`) and refreshes when it moves.
 */
type Msg = ProjectDetail["messages"][number];

export function ProjectScreen({
  project: p,
  zh,
  people,
  writing,
  canApprove = false,
  privateChats = [],
  me = null,
  view = "overview",
}: {
  /** Which project page this is: the overview (the steps as blocks, the chat) or the topic page. */
  view?: "overview" | "topic";
  /** The person, for the steps that are theirs (their picture and name, not the assistant's robot). */
  me?: { id: string; name: string; avatarUrl: string | null } | null;
  /** Your private chats that worked on this project, linked under the activity line. */
  privateChats?: { id: string; title: string }[];
  /** An owner or admin: may OK the script in one press (脚本可以了). */
  canApprove?: boolean;
  project: ProjectDetail;
  zh: boolean;
  people: MentionPerson[];
  writing: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [chatOpen, setChatOpen] = React.useState(false);
  const [popup, setPopup] = React.useState<{ title: string; body: React.ReactNode } | null>(null);
  const [picking, setPicking] = React.useState<null | "clips" | "scripts" | "topics">(null);
  /* When each employee was last asked from a card, so its card can show it working. */
  const [asked, setAsked] = React.useState<Partial<Record<AgentKey, string>>>({});

  const latest = (a: AgentKey): Msg | null => [...p.messages].reverse().find((m) => m.agent === a) ?? null;
  /* An employee at work in this project's chat, as the server knows it (its
     working row, `lib/chat/pending.ts`): what the card says it is doing. */
  const busyRow = (a: AgentKey) => p.pending.find((r) => r.agent === a) ?? null;
  const working = (a: AgentKey) => {
    if (busyRow(a)) return true;
    const since = asked[a];
    return Boolean(since && !p.messages.some((m) => m.agent === a && m.at > since));
  };
  /* What a card says while its employee works: the real step when there is
     one (its working row), else the card's own words — as the props of the
     shared typing pill (`AgentTyping`). */
  const doing = (a: AgentKey, fallbackZh: string, fallbackEn: string): Typing => {
    const row = busyRow(a);
    return row ? { step: row.step } : { label: { zh: fallbackZh, en: fallbackEn } };
  };
  const anyWorking = (Object.keys(asked) as AgentKey[]).some(working) || p.pending.length > 0;
  const directing = p.director?.state === "queued" || p.director?.state === "running";
  /* The topic this project was started from, as the server resolved it
     (why now, the hook, the evidence with its numbers). */
  const src = (p.source as ProjectSource | null) ?? null;

  /*
   * 编剧 writing the draft that was started with the project (from Home,
   * Research, the backlog or the Script queue), or from the button below.
   * The mark lives on the project, so arriving from anywhere shows it; the
   * script's pulse says when it is done, and the page refreshes once instead
   * of showing "no beats yet" until somebody reloads it.
   *
   * It starts from `writing`, the server's reading of the mark with its
   * ten-minute limit applied (`scriptWriting`), not from the raw mark: a
   * mark a restart left behind used to show "编剧正在写初稿…" and a full
   * page refresh three seconds later on every visit. Worked out on the
   * server, so the first render and hydration agree.
   */
  const [draftWriting, setDraftWriting] = React.useState(writing);
  const scriptIdForPulse = p.script?.id ?? null;
  React.useEffect(() => {
    if (!draftWriting || !scriptIdForPulse) return;
    const until = Date.now() + 10 * 60_000;
    let stopped = false;
    const id = setInterval(async () => {
      if (stopped) return;
      if (Date.now() > until) {
        clearInterval(id);
        setDraftWriting(false);
        return;
      }
      const r = await fetch(`/api/script/${scriptIdForPulse}/pulse`, { cache: "no-store" }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { writing: boolean }) : null;
      if (!j || stopped || j.writing) return;
      stopped = true;
      clearInterval(id);
      setDraftWriting(false);
      router.refresh();
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [draftWriting, scriptIdForPulse, router]);

  /*
   * Where the film stands, from the project's rows (`workProjectDetail`):
   *
   *   directing   — the director is at it (queued or running);
   *   renderLive  — a render is queued or encoding;
   *   busyLive    — either: the page polls, the buttons wait;
   *   rendered    — the latest render finished with a file: the player;
   *   renderFailed — it did not, and nobody is retrying yet;
   *   cutReady    — a cut is on the timeline, nobody is on it, nothing
   *                 rendered: the one press that is missing is 渲染.
   */
  const renderLive = p.render?.state === "queued" || p.render?.state === "rendering";
  const busyLive = renderLive || directing;
  /* The row says "failed" while the worker still holds a job to try again
     (the queue's backoff between attempts): the studio-wide store knows
     (`LiveProject.retrying`). The page keeps asking meanwhile, and does not
     offer 重试 over a retry that is already coming. */
  const liveNow = useLiveProject(p.id);
  const retrying = liveNow?.retrying === true && isRunning(liveNow);

  /*
   * Ask for the project's state in one short string and refresh only when
   * it changes: re-rendering on a timer read as the page reloading itself.
   *
   * Every three seconds while something is being worked on. The clock on
   * that restarts each time the stamp moves (a render's percent is in it),
   * so a film that takes longer than the deadline keeps its bar going and
   * still turns the card over when it lands; only a job that has said
   * nothing new for eight minutes stops being asked about. And once when
   * the tab comes back into view, whatever the state: a render started in
   * the editor tab, or by 剪辑师 from the chat, shows the moment the owner
   * looks here again rather than after a reload.
   */
  /* An armed "传完自动开始剪" counts down on the server: the page keeps
     asking so the count, its cancel, and the moment it starts all show. */
  const armed = p.autoCut.dueAt !== null;
  React.useEffect(() => {
    const live = anyWorking || busyLive || armed || retrying;
    let until = Date.now() + 8 * 60_000;
    let last: string | null = null;
    let stopped = false;
    const pulse = async () => {
      const r = await fetch(`/api/projects/${p.id}/pulse`, { cache: "no-store" }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { stamp: string }) : null;
      if (!j || stopped) return;
      if (last !== null && j.stamp !== last) {
        until = Date.now() + 8 * 60_000;
        router.refresh();
      }
      last = j.stamp;
    };
    /* The stamp this page was drawn from, so the first change is seen. */
    void pulse();
    const onVisible = () => {
      if (document.visibilityState === "visible") void pulse();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const id = live
      ? setInterval(() => {
          if (Date.now() > until) return;
          void pulse();
        }, 3000)
      : null;
    return () => {
      stopped = true;
      if (id) clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [anyWorking, busyLive, armed, retrying, router, p.id]);

  /** Ask one employee something from its card; the answer comes back there. */
  function ask(agent: AgentKey, text: string, files: string[] = []) {
    const body = `${agentTag(agent)} ${text.trim() || (files.length ? "请看附件" : "")}`;
    start(async () => {
      const res = await sendChannelMessage(p.channel.slug, body, files, getPanelModel());
      if (res?.error) {
        notify(res.error);
        return;
      }
      setAsked((m) => ({ ...m, [agent]: new Date().toISOString() }));
      router.refresh();
    });
  }



  /* The topic card shows a chosen topic: its asks fold behind one quiet link. */
  const topicChosen = Boolean(src?.why || src?.hook || src?.evidence?.length || p.brief);
  const stepDone = (k: ProjectStep["key"]) => p.steps.find((s) => s.key === k)?.state === "done";
  const frontier = p.status === "active" ? frontierStep(p.steps) : null;
  const stepNow = (k: ProjectStep["key"]) => (frontier?.key === k ? frontier.state : null);
  /* A note sent back to this step, in front of whoever holds it. */
  const noticeFor = (k: ProjectStep["key"]) => {
    const back = p.sentBack[k];
    if (!back || back.state === "done") return null;
    return (
      <SentBackPanel
        back={back}
        zh={zh}
        pending={pending}
        onApply={
          k === "script" && back.state === "open"
            ? () =>
                start(async () => {
                  if (p.script?.status === "locked" && canApprove) await unlockAction(p.script.id);
                  const r = await applySendBackAction(p.id);
                  if (r && "error" in r && r.error) notify(r.error);
                  else notify(t("已交给编剧按建议改写", "Handed to the writer to make the edits"), "ok");
                  router.refresh();
                })
            : undefined
        }
        onDone={() =>
          start(async () => {
            await settleSendBackAction(p.id, k);
            router.refresh();
          })
        }
      />
    );
  };


  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", position: "relative", ...PAPER }}>
      <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto" }}>
        <div style={{ maxWidth: 1440, padding: "20px 32px 60px", display: "flex", flexDirection: "column", gap: 14 }}>
          <style dangerouslySetInnerHTML={{ __html: PROJECT_CSS }} />
          {view === "overview" ? <StepCards p={p} zh={zh} me={me} /> : null}
          {view === "overview" ? <FlowMoves p={p} zh={zh} canApprove={canApprove} /> : null}

          {view === "overview" ? (
            <>
          {/* ---- one line of activity; the whole conversation on demand ---- */}
          {/* Opened by its link, not as a member: the chat is the members'
              and none of it is read for this person, so the card says so
              rather than 「0 · 还没有对话」 over a chat that has messages
              (QA, 2 Oct). */}
          {p.linkOnly ? (
            <Card icon="chat" title={t("项目对话", "Project chat")} sub={t("只有项目成员能看和发言", "Only the project's members can read and post")}>
              <div style={{ fontSize: 13, color: "#8a8a8a" }}>{t("你是通过分享链接打开的，看不到这个项目的对话。要参与，请项目负责人把你加进来。", "You opened this from a shared link, so the project's chat is hidden. Ask its owner to add you.")}</div>
            </Card>
          ) : (
          <Card
            icon="chat"
            title={t("项目对话", "Project chat")}
            sub={t("在这里 @ 任何 AI 员工或同事，所有人都看得到", "@ any AI employee or colleague here; everyone on the project sees it")}
            right={
              <button type="button" onClick={() => setChatOpen(true)} style={smallButton()}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: anyWorking ? "#278f5e" : "#d0d0cc", animation: anyWorking ? "auraPulse 1.6s ease-in-out infinite" : "none" }} />
                {t(`打开对话 · ${p.messages.length}`, `Open chat · ${p.messages.length}`)}
              </button>
            }
          >
            {p.messages.length ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {p.messages.slice(-3).map((m, i) => (
                  <button key={i} type="button" onClick={() => setChatOpen(true)} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "7px 0", border: 0, borderTop: i ? "1px solid #f0efeb" : 0, background: "none", font: "inherit", textAlign: "left", cursor: "pointer", minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "#171717", flexShrink: 0 }}>{m.agent ? <AgentName agent={m.agent} zh={zh} /> : m.author}</span>
                    <span style={{ fontSize: 12.5, color: "#5f5f5f", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1 }}>{oneLine(m.body).replace(/\s*(?:在脚本页看、改：)?\/(?:script|video|projects|chat)\/\S+/g, "")}</span>
                    <span style={{ fontSize: 11.5, color: "#a3a3a3", flexShrink: 0 }}>{ago(m.at, zh)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#8a8a8a" }}>{t("还没有对话。", "No messages yet.")}</div>
            )}
          </Card>
          )}

          {privateChats.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "-4px 2px 0", fontSize: 12, color: "#7c7c7c" }}>
              <Icon name="chat" size={12} />
              {t("在你的私聊里做过：", "Worked on in your private chats:")}
              {privateChats.map((c) => (
                <Link key={c.id} href={`/chat/t/${c.id}`} prefetch={false} style={{ color: "#171717", textDecoration: "none", borderBottom: "1px solid #dcdcda" }}>
                  {c.title === "New chat" ? t("对话", "Chat") : c.title}
                </Link>
              ))}
            </div>
          ) : null}

            </>
          ) : null}

          {/* The cards one below the other, in the flow's order: topic,
              script, clips, the film, captions and delivery. */}
          {view === "topic" ? (
            <>
              {stepDone("topic") ? (
                <NextStep state="done" zh={zh} text={t("选题定了。下一步：让编剧写脚本。", "The topic is set. Next: the script.")}>
                  <GoButton href={tabHref(p.id, "script")}>{t("去写脚本 →", "Go to the script →")}</GoButton>
                </NextStep>
              ) : null}
              <Board>
            {/* ---- topic ---- */}
            {/* Swapping the topic (and, on the script card, using another
                script) is not the employee's work on it, so it is a quiet
                press in the card's header rather than one more framed
                button in the row (where it wrapped onto a line of its own). */}
            <Workbench
              anchor={STEP_ANCHOR.topic}
              done={stepDone("topic")} now={stepNow("topic")} notice={noticeFor("topic")}
              zh={zh}
              icon={<AgentIcon agent="research" size={26} radius={7} />}
              title={t("选题", "Topic")}
              sub={src?.label ?? t("你定的题", "Your topic")}
              right={topicChosen ? undefined : <Action quiet icon="bulb" label={t("换成已有选题", "Use an existing topic")} onClick={() => setPicking("topics")} disabled={pending} />}
            >
              {src?.why || src?.hook || src?.evidence?.length ? (
                <TopicFacts src={src} zh={zh} />
              ) : p.brief ? (
                <p style={{ margin: "0 0 10px", fontSize: 13, color: "#525252", lineHeight: 1.6 }}>{cleanCodes(p.brief).slice(0, 300)}</p>
              ) : null}
              <AgentOutput agent="research" msg={latest("research")} working={working("research")} typing={doing("research", "正在查资料", "Looking things up")} zh={zh} onOpen={(m) => setPopup({ title: t("研究员的结果", "The researcher's findings"), body: <Body text={m.body} /> })} />
              <Disclose zh={zh} on={topicChosen} label={<Tr zh="问研究员 · 更多" en="Ask the researcher · more" inZh={zh} />}>
              <Actions>
                <Action icon="spark" label={t("补充证据", "Find evidence")} onClick={() => ask("research", t("为这个项目的选题找 3 条真实数据证据（平台、播放或热度、链接），只用工具查到的数字。", "Find 3 real pieces of evidence for this project's topic (platform, views or heat, link), numbers from tools only."))} disabled={pending} />
                <Action icon="bulb" label={t("3 个角度", "3 angles")} onClick={() => ask("research", t("给这个项目 3 个适合本频道的切入角度，每个一句话，说明为什么。", "Give 3 angles for this project that suit our channel, one line each, with why."))} disabled={pending} />
                <Action icon="eye" label={t("对标怎么做", "How rivals did it")} onClick={() => ask("research", t("找对标账号做过的同题视频，说出播放和他们的开头怎么写。", "Find rival videos on this topic, with their views and how they open."))} disabled={pending} />
                {topicChosen ? <Action icon="bulb" label={t("换成已有选题", "Use an existing topic")} onClick={() => setPicking("topics")} disabled={pending} /> : null}
              </Actions>
              <AskBox people={people} zh={zh} placeholder={t("问研究员这个选题…", "Ask the researcher about this topic…")} onSend={(v, files) => ask("research", v, files)} disabled={pending} />
              </Disclose>
            </Workbench>
              </Board>
            </>
          ) : null}
        </div>
      </div>

      {chatOpen ? <ChatDrawer project={p} zh={zh} people={people} onClose={() => setChatOpen(false)} /> : null}
      {popup ? <Popup title={popup.title} onClose={() => setPopup(null)}>{popup.body}</Popup> : null}
      {picking ? (
        <Picker
          projectId={p.id}
          kind={picking}
          zh={zh}
          onClose={() => setPicking(null)}
          onPick={async (items) => {
            setPicking(null);
            if (picking === "clips" && p.video) {
              for (const it of items) {
                const res = await addClipAction(p.video.id, it.id);
                if ("id" in res && res.id) await addItemAction(p.video.id, "clip", res.id, "");
              }
              notify(t(`已加入 ${items.length} 段素材`, `Added ${items.length} clip(s)`), "ok");
            } else if (picking === "scripts" && items[0]) {
              const r = await chooseScriptAction(p.id, items[0].id);
              if (r?.error) notify(r.error);
            } else if (picking === "topics" && items[0]) {
              /* By the choice's id; the server reads the topic itself. */
              const r = await chooseTopicAction(p.id, { id: items[0].id, title: items[0].title, brief: items[0].brief ?? "", label: items[0].sub ?? undefined });
              if (r && "error" in r && r.error) notify(r.error);
              else if (r && "hasBeats" in r && r.hasBeats) notify(t("选题换好了。脚本已经有分镜，没有动；要按新选题重写，按脚本卡上的「按选题重写」。", "Topic changed. The script already has beats and was left alone; press “Rewrite from the topic” on the script card to rewrite it."), "info");
              else notify(t("选题换好了，脚本的标题和角度也跟着改了。", "Topic changed; the script's title and angle followed."), "ok");
            }
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- the pieces */

/** The topic card's facts, from the project's snapshot: why now, the hook, the angle, the evidence rows. */
function TopicFacts({ src, zh }: { src: ProjectSource; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  return (
    /* The why as the lead paragraph, then the rest as labelled lines in one
       column (开头, 角度, 信号强度, 证据), as Home's ideas draw them: it was
       four lines of differently sized greys and a caps caption, which read
       as one grey block. */
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
      {src.why ? <p style={{ margin: 0, fontSize: 13, color: "#383838", lineHeight: 1.65 }}>{cleanCodes(src.why).slice(0, 300)}</p> : null}
      {src.hook || src.angle || src.strength || src.evidence?.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: 12, rowGap: 5, fontSize: 12.5, lineHeight: 1.6, padding: "10px 12px", borderRadius: 12, background: "#fafaf9", border: "1px solid #f0efec" }}>
          {src.hook ? (
            <>
              <span style={FACT_LABEL}>{t("开头", "Opening")}</span>
              <span style={{ color: "#383838" }}>{t(`「${cleanCodes(src.hook)}」`, `“${cleanCodes(src.hook)}”`)}</span>
            </>
          ) : null}
          {src.angle ? (
            <>
              <span style={FACT_LABEL}>{t("角度", "Angle")}</span>
              <span style={{ color: "#383838" }}>{cleanCodes(src.angle)}</span>
            </>
          ) : null}
          {src.strength ? (
            <>
              <span style={FACT_LABEL}>{t("信号强度", "Strength")}</span>
              <span style={{ display: "flex", alignItems: "center", height: 20 }}>
                <Strength n={src.strength} title={t("信号强度", "Signal strength")} />
              </span>
            </>
          ) : null}
          {src.evidence?.length ? (
            <>
              <span style={FACT_LABEL}>{t("证据", "Evidence")}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                {src.evidence.slice(0, 5).map((e, i) =>
                  e.url ? (
                    <a key={i} href={e.url} target="_blank" rel="noopener noreferrer" title={e.title} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 12, color: "#171717", textDecoration: "none", minWidth: 0 }}>
                      <span style={{ color: "#0f5bd5", flexShrink: 0 }}>
                        <Icon name="external" size={11} />
                      </span>
                      <span style={{ color: "#999999", flexShrink: 0 }}>{e.label}</span>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</span>
                      {e.numbers ? <span style={{ color: "#7c7c7c", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{e.numbers.split(" · ").slice(0, 2).join(" · ")}</span> : null}
                    </a>
                  ) : (
                    <span key={i} title={e.title} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 12, color: "#171717", minWidth: 0 }}>
                      <span style={{ color: "#999999", flexShrink: 0 }}>{e.label}</span>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</span>
                      {e.numbers ? <span style={{ color: "#7c7c7c", flexShrink: 0 }}>{e.numbers.split(" · ").slice(0, 2).join(" · ")}</span> : null}
                    </span>
                  ),
                )}
                {src.evidence.length > 5 ? <span style={{ fontSize: 11.5, color: "#a3a3a3" }}>{t(`还有 ${src.evidence.length - 5} 条`, `${src.evidence.length - 5} more`)}</span> : null}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const FACT_LABEL: React.CSSProperties = { fontSize: 11.5, lineHeight: "20px", color: "#a3a3a3", whiteSpace: "nowrap" };

/** 研究员's tint (`AGENT_TINTS.research`), a step darker so an empty dot still shows on white. */
const EMPTY_DOT = "#c4d8f4";

/**
 * A topic's strength as five dots in 研究员's colours, the same as on Home's
 * ideas and suggestion (`Strength` in components/home/IdeasPanel), drawn here
 * rather than imported so a project page does not load Home's ideas panel.
 */
function Strength({ n, title }: { n: number; title: string }) {
  const k = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span role="img" aria-label={`${k}/5`} title={title} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: 3, background: i < k ? AGENT_COLORS.research : EMPTY_DOT }} />
      ))}
    </span>
  );
}

type Choice = { id: string; title: string; sub?: string | null; thumb?: string | null; brief?: string };

/** "Choose existing": clips already uploaded, scripts already written, topics already picked. */
function Picker({ projectId, kind, zh, onClose, onPick }: { projectId: string; kind: "clips" | "scripts" | "topics"; zh: boolean; onClose: () => void; onPick: (items: Choice[]) => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [items, setItems] = React.useState<Choice[] | null>(null);
  const [q, setQ] = React.useState("");
  const [chosen, setChosen] = React.useState<string[]>([]);
  const many = kind === "clips";
  React.useEffect(() => {
    let live = true;
    void fetch(`/api/projects/${projectId}/choices?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j: { items: Choice[] }) => live && setItems(j.items ?? []))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [projectId, kind]);
  const shown = (items ?? []).filter((i) => !q.trim() || i.title.toLowerCase().includes(q.trim().toLowerCase()));
  const title = kind === "clips" ? t("从已上传的素材里选", "Choose from uploaded clips") : kind === "scripts" ? t("用已有脚本", "Use an existing script") : t("换成已有选题", "Use an existing topic");
  return (
    <Popup title={title} onClose={onClose}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("搜索…", "Search…")} style={{ width: "100%", height: 34, border: "1px solid #e2e2e2", borderRadius: 10, padding: "0 11px", fontFamily: "inherit", fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 10 }} />
      {items === null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 44 }} />)}</div>
      ) : !shown.length ? (
        <Empty text={t("没有可选的。", "Nothing to choose from.")} />
      ) : (
        <div style={kind === "clips" ? { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 } : { display: "flex", flexDirection: "column", gap: 2 }}>
          {shown.map((it) => {
            const on = chosen.includes(it.id);
            const toggle = () => (many ? setChosen((c) => (on ? c.filter((x) => x !== it.id) : [...c, it.id])) : onPick([it]));
            return kind === "clips" ? (
              <button key={it.id} type="button" onClick={toggle} style={{ padding: 0, border: `2px solid ${on ? "#0f5bd5" : "#ececec"}`, borderRadius: 10, overflow: "hidden", background: "#fff", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.thumb ?? ""} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover", display: "block", background: "#111" }} />
                <div style={{ padding: "6px 8px" }}>
                  <div style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</div>
                  <div style={{ fontSize: 11, color: "#999999" }}>{it.sub}</div>
                </div>
              </button>
            ) : (
              <button key={it.id} type="button" onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", border: 0, borderRadius: 10, background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                <Icon name={kind === "scripts" ? "pen" : "bulb"} size={15} color="#7c7c7c" />
                <span style={{ minWidth: 0, flexGrow: 1 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 500, color: "#171717" }}>{it.title}</span>
                  {it.sub ? <span style={{ display: "block", fontSize: 11.5, color: "#999999", marginTop: 2 }}>{it.sub}</span> : null}
                </span>
                <Icon name="external" size={12} color="#b3b3b3" />
              </button>
            );
          })}
        </div>
      )}
      {many ? (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onClose} style={{ ...btn(false) }}>{t("取消", "Cancel")}</button>
          <button type="button" disabled={!chosen.length} onClick={() => onPick((items ?? []).filter((i) => chosen.includes(i.id)))} style={{ ...btn(true), opacity: chosen.length ? 1 : 0.45 }}>
            {t(`加入 ${chosen.length} 段`, `Add ${chosen.length}`)}
          </button>
        </div>
      ) : null}
    </Popup>
  );
}

/**
 * The cards one below the other, in the order they are written — the same
 * order as the steps above them. Two columns dealt left, right, left read
 * 选题, 素材, 文案与交付 down one side and 脚本, 成片 down the other, and
 * nobody could follow the work through them ("this too, one below other").
 */
function Board({ children }: { children: React.ReactNode }) {
  const cards = React.Children.toArray(children).filter(Boolean);
  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{cards}</div>;
}

/**
 * One card. `anchor` makes it a place a link can open at — 剪辑师's "上传素材"
 * goes to `/projects/<id>#clips` — and the card is outlined for a moment when
 * it is the one opened (`:target` in `PROJECT_CSS`).
 */
function Workbench({ icon, title, sub, right, children, anchor, done = false, now = null, zh = true, notice = null }: { icon: React.ReactNode; title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; anchor?: string; done?: boolean; now?: ProjectStep["state"] | null; zh?: boolean; notice?: React.ReactNode }) {
  /* The card whose step it is now says so, as a done one says 已完成: "do this now". */
  const nowTone = now === "you" ? { bg: "#fff4df", ink: "#95590a", line: "#f0c987", zh: "现在做这一步", en: "Do this now" } : now === "running" ? { bg: "#e9f2fe", ink: "#1f5fbf", line: "#b9d2f6", zh: "进行中", en: "In progress" } : now ? { bg: "#f3f3f1", ink: "#5f5f5f", line: "#dcdcd8", zh: "下一步", en: "Next" } : null;
  return (
    <section id={anchor} className={anchor ? "pj-card" : undefined} style={{ background: "#fff", border: `1px solid ${nowTone && now === "you" ? nowTone.line : "#e2e2e2"}`, borderRadius: 14, padding: "14px 16px 16px", minWidth: 0, boxShadow: "0 1px 2px rgba(0,0,0,0.03)", scrollMarginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, minWidth: 0 }}>
        {icon}
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</span>
        {/* The step this card is for is done: the same green tick as the flow above. */}
        {done ? (
          <span title={zh ? "这一步已完成" : "This step is done"} style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: "#1e7a4f" }}>
            <span style={{ width: 18, height: 18, borderRadius: 9, background: "#278f5e", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="check" size={11} strokeWidth={2.8} />
            </span>
            {zh ? "已完成" : "Done"}
          </span>
        ) : nowTone ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, fontSize: 11.5, fontWeight: 600, lineHeight: "20px", padding: "0 9px 0 7px", borderRadius: 999, color: nowTone.ink, background: nowTone.bg }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: nowTone.ink, animation: now === "running" ? "auraPulse 1.4s ease-in-out infinite" : undefined }} />
            {zh ? nowTone.zh : nowTone.en}
          </span>
        ) : null}
        {sub ? <span style={{ fontSize: 12, color: "#999999", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span> : null}
        <span style={{ flexGrow: 1 }} />
        {right}
      </div>
      {notice}
      {children}
    </section>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>{children}</div>;
}

/**
 * One press on a card. `quiet` is for the press that is not the card's
 * employee's work (swap the topic, use another script): grey text with no
 * frame, sized for the card's header.
 */
function Action({ icon, label, onClick, disabled, primary = false, quiet: isQuiet = false }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; primary?: boolean; quiet?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={isQuiet ? "pj-quiet" : undefined}
      style={isQuiet ? { ...quiet("#525252"), height: 28, padding: "0 8px", opacity: disabled ? 0.45 : 1, cursor: disabled ? "default" : "pointer" } : { ...btn(primary), height: 30, fontSize: 12, borderRadius: 8, opacity: disabled ? 0.45 : 1, cursor: disabled ? "default" : "pointer" }}
    >
      <Icon name={icon} size={13} />
      {label}
    </button>
  );
}

/**
 * The fold for a done step's buttons: while `on`, its children hide behind
 * one quiet grey text link (no frame) that opens them; while not, they show
 * as they always did. Closed on the first render, so the server and the
 * browser agree.
 */
function Disclose({ zh, on, label, children }: { zh: boolean; on: boolean; label: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  if (!on) return <>{children}</>;
  return (
    <>
      <div style={{ display: "flex", marginTop: 8 }}>
        {/* A button, not a grey caption: 「改脚本」 is how a done step is redone,
            and as an 11px link with a caret nobody saw it. */}
        <button type="button" className="pj-disclose" data-disclose="" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={open ? (zh ? "收起" : "Collapse") : undefined}>
          {label}
          <span aria-hidden style={{ fontSize: 11, lineHeight: 1, color: "#8a8a8a" }}>{open ? "\u25B4" : "\u25BE"}</span>
        </button>
      </div>
      {open ? children : null}
    </>
  );
}

/** A box to say something to the card's employee, with the @ picker. */
function AskBox({ people, zh, placeholder, onSend, disabled }: { people: MentionPerson[]; zh: boolean; placeholder: string; onSend: (text: string, files: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = React.useState("");
  const box = React.useRef<HTMLTextAreaElement | null>(null);
  const mentions = useMentions({ people, zh, draft, setDraft, box });
  const [askModel, setAskModel] = usePanelModel();
  const att = useAttachments(zh);
  const can = (draft.trim() || att.ids.length > 0) && !att.uploading;
  const send = () => {
    const v = draft.trim();
    if (!can || disabled) return;
    onSend(v, att.ids);
    setDraft("");
    att.clear();
  };
  return (
    <div style={{ marginTop: 10 }}>
    <AttachChips zh={zh} attached={att.attached} onRemove={att.remove} />
    <div style={{ position: "relative", display: "flex", gap: 6, alignItems: "flex-end" }}>
      <MentionMenu matches={mentions.matches} active={mentions.active} zh={zh} onPick={mentions.pick} onHover={mentions.setActive} placement="up" />
      <textarea
        ref={box}
        rows={1}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          mentions.onValue(e.target.value, e.target.selectionStart ?? e.target.value.length);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`;
        }}
        onBlur={mentions.close}
        onKeyDown={(e) => {
          if (mentions.onKeyDown(e)) return;
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={placeholder}
        onPaste={att.onPaste}
        style={{ flexGrow: 1, minWidth: 0, minHeight: 34, border: "1px solid #e2e2e2", borderRadius: 10, padding: "8px 11px", outline: "none", resize: "none", fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.45, background: "#fcfcfc", boxSizing: "border-box" }}
      />
      <span style={{ display: "inline-flex", alignItems: "center", height: 34 }}>
        <AttachButton zh={zh} onFiles={att.add} size={30} />
      </span>
      <ModelChip value={askModel} onChange={setAskModel} zh={zh} placement="up" align="right" />
      {/* Light grey until there is something to send, as Home's 开工 is;
          a 40% black block beside every empty box read as a grey slab. */}
      <button
        type="button"
        onClick={send}
        disabled={disabled || !can}
        aria-label={zh ? "发送" : "Send"}
        title={zh ? "发送（Enter）" : "Send (Enter)"}
        style={can ? { ...btn(true), height: 34, borderRadius: 10, opacity: disabled ? 0.5 : 1 } : { ...btn(false), height: 34, borderRadius: 10, background: "#f0f0ee", borderColor: "#f0f0ee", color: "#a3a3a3", cursor: "default" }}
      >
        <Icon name="upload" size={13} style={{ transform: "rotate(90deg)" }} />
      </button>
    </div>
    </div>
  );
}

/** What an employee last said about this card's work, on the card — or,
 *  while it is at it, the employee typing. */
function AgentOutput({ agent, msg, working, zh, onOpen, copyable = false, compact = false, typing }: { agent: AgentKey; msg: Msg | null; working: boolean; zh: boolean; onOpen: (m: Msg) => void; copyable?: boolean; compact?: boolean; typing: Typing }) {
  const t = (a: string, b: string) => (zh ? a : b);
  if (working) return <Working agent={agent} zh={zh} typing={typing} />;
  if (!msg) return null;
  const text = clean(msg.body);
  return (
    <div style={{ marginTop: 2, padding: "10px 12px", borderRadius: 12, background: "#f7f8fb", border: "1px solid #eef0f5" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: msg.agent ? AGENT_COLORS[msg.agent] : "#525252", fontWeight: 600 }}>
        {msg.agent ? <AgentIcon agent={msg.agent} size={16} radius={4} /> : <PersonAvatar id={msg.authorId} url={msg.authorAvatar} name={msg.author} size={16} radius={4} />}
        {msg.agent ? <AgentName agent={msg.agent} zh={zh} /> : msg.author}
        <span style={{ fontWeight: 400, color: "#b3b3b3" }}>{ago(msg.at, zh)}</span>
        <span style={{ flexGrow: 1 }} />
        {copyable ? (
          <button type="button" onClick={() => { void navigator.clipboard.writeText(text); notify(t("已复制", "Copied"), "ok"); }} style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 11.5, color: "#525252", fontFamily: "inherit" }}>
            {t("复制", "Copy")}
          </button>
        ) : null}
        <button type="button" onClick={() => onOpen(msg)} style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 11.5, color: "#525252", fontFamily: "inherit" }}>
          {t("展开", "Expand")}
        </button>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: "#2b343d", marginTop: 5, whiteSpace: "pre-wrap", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: compact ? 3 : 6, WebkitBoxOrient: "vertical" }}>{text}</div>
    </div>
  );
}

/** What the typing pill says on a card: a step from the shared table, or
 *  the card's own words. */
type Typing = { step?: StepKey; label?: { zh: string; en: string } };

/**
 * An employee at work on a card: its face, name and step, typing — the
 * same `AgentTyping` the chat, the assistant screens and Home draw. It was
 * a green box with a pulsing dot that looked like nothing else.
 */
function Working({ agent, zh, typing }: { agent: AgentKey; zh: boolean; typing: Typing }) {
  return (
    <div style={{ padding: "2px 0", marginBottom: 8 }}>
      <AgentTyping agent={agent} zh={zh} name step={typing.step} label={typing.label} />
    </div>
  );
}


function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12.5, color: "#999999", padding: "14px 12px", border: "1px dashed #e2e2e2", borderRadius: 10, textAlign: "center" }}>{text}</div>;
}


function Body({ text, copy = false }: { text: string; copy?: boolean }) {
  const c = clean(text);
  return (
    <div>
      {copy ? (
        <button type="button" onClick={() => { void navigator.clipboard.writeText(c); notify("已复制 · Copied", "ok"); }} style={{ ...btn(false), height: 28, fontSize: 12, marginBottom: 10 }}>
          <Icon name="share" size={12} /> Copy
        </button>
      ) : null}
      <div style={{ fontSize: 13.5, lineHeight: 1.75, whiteSpace: "pre-wrap", color: "#2b343d" }}>{c}</div>
    </div>
  );
}

function Popup({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(20,20,20,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 760, maxWidth: "100%", maxHeight: "85vh", background: "#fff", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #f0f0f0" }}>
          <span style={{ fontSize: 15, fontWeight: 600, flexGrow: 1 }}>{title}</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 18, color: "#999999" }}>
            ×
          </button>
        </div>
        <div style={{ padding: "14px 18px 18px", overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/** A message's files in the drawer, as the channel draws them: a picture as its thumbnail, anything else as a chip. */
function DrawerFiles({ files }: { files: Msg["attachments"] }) {
  if (!files.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
      {files.map((f) =>
        f.kind === "image" ? (
          <Link key={f.id} prefetch={false} href={`/files/${f.id}`} title={f.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${f.id}/thumb`} alt={f.name} loading="lazy" style={{ maxWidth: 180, maxHeight: 130, borderRadius: 10, border: "1px solid #ededed", display: "block", objectFit: "cover" }} />
          </Link>
        ) : (
          <Link key={f.id} prefetch={false} href={`/files/${f.id}`} title={f.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: 260, height: 26, padding: "0 9px", borderRadius: 8, border: "1px solid #dfe3ea", background: "#f7f9fc", color: "#2b343d", fontSize: 11.5, textDecoration: "none" }}>
            <Icon name={f.kind === "video" ? "clapper" : f.kind === "audio" ? "play" : "doc"} size={12} />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
            {f.sizeBytes ? <span style={{ color: "#8a94a3", flexShrink: 0 }}>{fileSize(f.sizeBytes)}</span> : null}
          </Link>
        ),
      )}
    </div>
  );
}

function fileSize(n: number): string {
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
}

/** The whole conversation, only when somebody opens it. */
function ChatDrawer({ project: p, zh, people, onClose }: { project: ProjectDetail; zh: boolean; people: MentionPerson[]; onClose: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [pressing, setPressing] = React.useState<string | null>(null);
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const lastId = p.messages[p.messages.length - 1]?.id;
  const working = p.pending.map((r) => `${r.id}:${r.step}`).join(",");
  const liveRow = useLiveRow(p.id, (exportId) => p.messages.some((m) => m.videos.some((v) => v.kind === "render" && v.id === exportId)));
  /* Esc closes it, as every other panel here does (QA, 2 Oct). Not while
     the @ menu is open in the box: that Esc is the menu's. */
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId, working]);
  /* Files dropped anywhere while the drawer is open go up and into the
     project's chat as one message; the employees read them from there. */
  const [sending, setSending] = React.useState<string | null>(null);
  const dragging = useFileDrop(true, (list) => {
    const files = Array.from(list).slice(0, 10);
    if (!files.length) return;
    setSending(t(`正在上传 ${files.length} 个文件…`, `Uploading ${files.length} file(s)…`));
    void Promise.allSettled(files.map((f) => uploadToStudio(f, () => {}))).then(async (out) => {
      const ids = out.flatMap((r) => (r.status === "fulfilled" ? [r.value.id] : []));
      setSending(null);
      if (!ids.length) return notify(t("上传没成功，再试一次", "The upload failed; try again"));
      const res = await sendChannelMessage(p.channel.slug, "", ids);
      if (res?.error) notify(res.error);
      router.refresh();
    });
  });
  const say = (text: string, files: string[] = []) =>
    start(async () => {
      const res = await sendChannelMessage(p.channel.slug, text, files, getPanelModel());
      if (res?.error) notify(res.error);
      if (parseAgentMentions(text).length || ("answering" in (res ?? {}) && (res as { answering?: string }).answering)) {
        const until = Date.now() + 120_000;
        const id = setInterval(() => (Date.now() > until ? clearInterval(id) : router.refresh()), 4000);
      }
      router.refresh();
    });
  return (
    <aside style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 420, background: "#fff", borderLeft: "1px solid #e6e6e6", boxShadow: "-12px 0 40px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", zIndex: 20 }}>
      <DropVeil on={dragging} zh={zh} />
      {sending ? <div style={{ padding: "6px 16px", fontSize: 12, color: "#6b6b6b", background: "#f7f7f5", borderBottom: "1px solid #f0f0f0" }}>{sending}</div> : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 12px 16px", borderBottom: "1px solid #f0f0f0" }}>
        <Icon name="chat" size={15} />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("项目对话", "Project chat")}</span>
        <span style={{ fontSize: 12, color: "#a3a3a3", flexGrow: 1 }}>{p.messages.length}</span>
        <button type="button" onClick={onClose} aria-label={t("关闭对话", "Close the chat")} title={t("关闭（Esc）", "Close (Esc)")} style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 18, color: "#999999" }}>
          ×
        </button>
      </div>
      {/* Room between messages (14, was 10), the time beside each name, and
          the employee's bubble edged in its own tint, so a long answer reads
          as one message rather than running into the next. The drawer only
          renders after a press, so `ago` here never meets the server's HTML. */}
      <div ref={scroller} style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        {p.messages.map((m) =>
          m.agent ? (
            <div key={m.id} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <AgentIcon agent={m.agent} size={26} radius={7} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 11.5, fontWeight: 600, color: AGENT_COLORS[m.agent] }}>
                  <AgentName agent={m.agent} zh={zh} />
                  <span style={{ fontWeight: 400, color: "#b3b3b3" }}>{ago(m.at, zh)}</span>
                </div>
                <div style={{ marginTop: 3, background: "#f7f8fb", border: `1px solid ${AGENT_TINTS[m.agent]}`, borderRadius: "4px 12px 12px 12px", padding: "9px 12px", fontSize: 12.5, lineHeight: 1.65, color: "#2b343d", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {/* Bare app paths (「在脚本页看、改：/script/scr_…」) as short
                      links, not a raw address that breaks across lines
                      (QA, 2 Oct). */}
                  <LinkedText text={linkPaths(m.body, p.id, zh)} />
                  {/* What it handed over, as links (this project itself is
                      already on screen), another project it names, and the
                      live chip of an edit it started. */}
                  {(m.handoff?.artifacts.filter((a) => !(a.kind === "work_project" && a.id === p.id)).length || m.otherProject) ? (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      {m.otherProject ? (
                        <Link prefetch={false} href={`/projects/${m.otherProject.id}`} style={{ ...btn(true), height: 24, fontSize: 11.5, textDecoration: "none", maxWidth: 260 }}>
                          <Icon name="spark" size={11} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t(`打开项目《${m.otherProject.title}》`, `Open “${m.otherProject.title}”`)}</span>
                        </Link>
                      ) : null}
                      {m.handoff?.artifacts
                        .filter((a) => !(a.kind === "work_project" && a.id === p.id))
                        .map((a) => {
                          const href = a.href ?? artifactHref(a.kind, a.id);
                          const label = a.kind === "script" ? t("打开脚本", "Open the script") : a.kind === "video_project" || a.kind === "video" ? t("打开剪辑台", "Open the editor") : a.title ?? a.kind;
                          return href ? (
                            <Link key={`${a.kind}-${a.id}`} prefetch={false} href={href} style={{ ...btn(false), height: 24, fontSize: 11.5, textDecoration: "none" }}>
                              <Icon name={a.kind === "script" ? "pen" : "clapper"} size={11} />
                              {label}
                            </Link>
                          ) : null;
                        })}
                    </div>
                  ) : null}
                  {/* "渲染好了" with the film under it: the poster that
                      plays, 下载, 在剪辑台打开 — right here in the drawer. */}
                  <VideoCards videos={m.videos} zh={zh} here={{ projectId: p.id }} />
                  <DrawerFiles files={m.attachments} />
                  {/* The live row at the foot follows this film while it
                      is made; the message's own chip stands down meanwhile. */}
                  {m.job && !(liveRow && p.video?.id === m.job.videoProjectId) ? (
                    <div>
                      <JobChip job={m.job} zh={zh} project={{ id: p.id }} />
                    </div>
                  ) : null}
                  {m.actions.length && !m.done ? (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      {m.actions.map((a, i) =>
                        a.kind === "open" ? (
                          <Link key={a.id} href={a.href ?? "#"} style={{ ...btn(false), height: 26, fontSize: 11.5, textDecoration: "none" }}>
                            {zh ? a.label : a.labelEn}
                          </Link>
                        ) : a.kind === "run" && a.op === "stock-cut" ? (
                          /* On its own project's page the stock one-go is the
                             video card's own button; the press here is the
                             same thing, through the chat so it is recorded. */
                          <button key={a.id} type="button" disabled={pending} onClick={() => { setPressing(m.id + a.id); start(async () => { const r = await pressCardAction(p.channel.slug, m.id, a.id); if (r?.error) notify(r.error); setPressing(null); router.refresh(); }); }} style={{ ...btn(false), height: 26, fontSize: 11.5, opacity: pressing === m.id + a.id ? 0.55 : 1 }}>
                            {zh ? a.label : a.labelEn}
                          </button>
                        ) : (
                          <button key={a.id} type="button" disabled={pending} onClick={() => { setPressing(m.id + a.id); start(async () => { await pressCardAction(p.channel.slug, m.id, a.id); setPressing(null); router.refresh(); }); }} style={{ ...btn(i === 0), height: 26, fontSize: 11.5, opacity: pressing === m.id + a.id ? 0.55 : 1 }}>
                            {zh ? a.label : a.labelEn}
                          </button>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div key={m.id} style={{ alignSelf: "flex-end", maxWidth: "86%" }}>
              {/* A colleague's line: their face beside their name, as the chat
                  draws it — it was a name alone, so people read as "not the
                  employees" rather than as themselves. */}
              <div style={{ fontSize: 11, color: "#b3b3b3", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
                <span>
                  {m.author} · {ago(m.at, zh)}
                </span>
                <PersonAvatar id={m.authorId} url={m.authorAvatar} name={m.author} size={18} radius={5} />
              </div>
              {m.body.trim() ? <div style={{ marginTop: 3, background: "#171717", color: "#fff", borderRadius: "12px 4px 12px 12px", padding: "9px 12px", fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}><LinkedText text={m.body} /></div> : null}
              {/* A take a colleague dropped into this chat: its card, under
                  their line, the way the channel draws it. */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <VideoCards videos={m.videos} zh={zh} here={{ projectId: p.id }} />
              </div>
              {/* The files on it: they were posted, but the drawer drew
                  nothing, so a file sent from here looked dropped (QA, 2 Oct). */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <DrawerFiles files={m.attachments} />
              </div>
            </div>
          ),
        )}
        {/* The film, live: 剪辑师's row that follows the worker (转写 →
            剪辑 → 设计图形 → 渲染 42% → 成片已出), from the studio-wide
            store, patched in place; gone once the worker's own 渲染好了
            line with the card is here. */}
        {liveRow ? (
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }} aria-live="polite">
            <AgentIcon agent="video" size={26} radius={7} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: AGENT_COLORS.video }}>
                <AgentName agent="video" zh={zh} />
              </div>
              <div style={{ marginTop: 4 }}>
                <LivePill p={liveRow} zh={zh} size="sm" />
              </div>
            </div>
          </div>
        ) : null}
        {/* The employees at work here right now, on the step each is on.
            Gone as soon as its reply lands. */}
        {p.pending.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 9, alignItems: "flex-start" }} aria-live="polite">
            <AgentIcon agent={r.agent} size={26} radius={7} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: AGENT_COLORS[r.agent] }}>
                <AgentName agent={r.agent} zh={zh} />
              </div>
              <div style={{ marginTop: 4 }}>
                <AgentTyping agent={r.agent} zh={zh} step={r.step} face={false} size="sm" />
              </div>
              {r.job ? <div><JobChip job={r.job} zh={zh} project={{ id: p.id }} /></div> : null}
            </div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid #f0f0f0", padding: "0 12px 12px" }}>
        <AskBox people={people} zh={zh} placeholder={t("@ 一位同事…", "@ a colleague…")} onSend={say} disabled={pending} />
      </div>
    </aside>
  );
}

/** Each step's card below the flow. 素材 keeps "clips": links elsewhere go to `/projects/<id>#clips`. */
const STEP_ANCHOR: Record<ProjectStep["key"], string> = { topic: "step-topic", script: "step-script", clips: "clips", edit: "step-edit", deliver: "step-deliver" };




/**
 * A note a step was sent back with, on that step's card: who sent it and
 * what they said, and for a script 编剧's edits beat by beat — the old line
 * struck through, the new one under it — with the press that has them made.
 * "Make the revise suggestions better highlighted to the person in charge."
 */
function SentBackPanel({ back, zh, pending, onApply, onDone }: { back: SentBack; zh: boolean; pending: boolean; onApply?: () => void; onDone: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const applied = back.state === "applied";
  return (
    <div style={{ marginBottom: 14, borderRadius: 11, border: "1px solid #f4c7a8", borderLeft: "4px solid #e8590c", background: "#fff6ef", padding: "11px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "#c2410c" }}>
          <Icon name="undo" size={12} />
          {applied ? t("已按退回意见交给编剧修改", "Handed back for the edits") : t("退回修改", "Sent back")}
        </span>
        <span style={{ fontSize: 11.5, color: "#9a6b4f" }}>
          {back.byName} · {new Date(back.at).toLocaleString(zh ? "zh-CN" : "en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#171717", lineHeight: 1.55 }}>「{back.note}」</div>
      {back.suggestions?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "#9a6b4f" }}>{t("编剧的具体改法", "The writer's edits")}</span>
          {back.suggestions.map((x, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "52px minmax(0,1fr)", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#fff", border: "1px solid #f6dcc8" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#c2410c", whiteSpace: "nowrap" }}>{t(`第 ${x.ord} 镜`, `Beat ${x.ord}`)}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, fontSize: 12.5, lineHeight: 1.55 }}>
                <span style={{ color: "#9a9a9a", textDecoration: "line-through" }}>{x.before}</span>
                <span style={{ color: "#171717", fontWeight: 600 }}>{x.after}</span>
                {x.why ? <span style={{ fontSize: 11, color: "#9a6b4f" }}>{x.why}</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {onApply ? (
          <button type="button" className="pj-flow-next" disabled={pending} onClick={onApply} style={{ background: "#c2410c" }}>
            <Icon name="pen" size={13} />
            {back.suggestions?.length ? t("按建议改写", "Make these edits") : t("让编剧按意见改", "Have the writer revise")}
          </button>
        ) : null}
        <button type="button" className="pj-flow-back" disabled={pending} onClick={onDone}>
          <Icon name="check" size={12} strokeWidth={2.4} />
          {t("标记已处理", "Mark as dealt with")}
        </button>
      </div>
    </div>
  );
}















function clean(body: string): string {
  /* Markdown links read as their words; a link back to a project page (you
     are on it) is dropped — messages used to end in a raw
     "[打开项目](/projects/wp_…)" wherever the page quoted them. */
  return body
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => (url.startsWith("/projects/") ? "" : label))
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/@\S+\s?/g, "")
    .trim();
}

/* The drawer's version of `clean`: in-app links stay links (LinkedText
   draws them) and a bare path an employee wrote becomes one with words; a
   link to this very project is dropped, you are on it (QA, 2 Oct). */
const BARE_PATH = /(^|[\s：:（，,、])(\/(?:script|projects|files|chat|video|videos|topics|trends|publish|research|article)\/[A-Za-z0-9_\-/?=&#%]+)/g;
function linkPaths(body: string, projectId: string, zh: boolean): string {
  const here = (url: string) => url === `/projects/${projectId}` || url.startsWith(`/projects/${projectId}?`);
  const label = (url: string) =>
    url.startsWith("/script/") ? (zh ? "打开脚本" : "Open the script")
    : url.startsWith("/projects/") ? (zh ? "打开项目" : "Open the project")
    : url.startsWith("/files/") ? (zh ? "打开文件" : "Open the file")
    : url.startsWith("/chat/") ? (zh ? "打开对话" : "Open the chat")
    : url.startsWith("/video") ? (zh ? "打开剪辑台" : "Open the editor")
    : url.startsWith("/publish") ? (zh ? "打开发布" : "Open Publish")
    : zh ? "打开" : "Open";
  return body
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, text: string, url: string) => (here(url) ? "" : url.startsWith("/") ? all : text))
    .replace(BARE_PATH, (_m, lead: string, url: string) => (here(url) ? lead.trim() : `${lead}[${label(url)}](${url})`))
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/@\S+\s?/g, "")
    .trim();
}

function oneLine(body: string): string {
  /* Markdown links read as their words in a one-line summary; a link back to
     a project page (you are on it) is dropped — the line used to end in a raw
     "[打开项目](/projects/wp_…)". */
  return clean(body)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => (url.startsWith("/projects/") ? "" : label))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}


function ago(iso: string, zh: boolean): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return zh ? "刚刚" : "now";
  if (mins < 60) return zh ? `${mins} 分钟前` : `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? (zh ? `${h} 小时前` : `${h}h ago`) : zh ? `${Math.round(h / 24)} 天前` : `${Math.round(h / 24)}d ago`;
}

function btn(primary: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 13px", borderRadius: 9, border: primary ? "1px solid #171717" : "1px solid #e2e2e2", background: primary ? "#171717" : "#fff", color: primary ? "#fff" : "#171717", fontFamily: "inherit", fontSize: 12.5, fontWeight: primary ? 500 : 400, cursor: "pointer", whiteSpace: "nowrap" };
}

/** A frameless text press (归档, 删除, 换成已有选题, 用已有脚本); its hover is `PROJECT_CSS`. */
function quiet(color: string): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color, fontFamily: "inherit", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" };
}

const PROJECT_CSS = `
.pj-card:target, .pj-card.pj-flash { animation: pjTarget 2.4s ease-out 1; }
.pj-flow-hint { align-self: flex-start; border: 0; padding: 0; background: none; font-family: inherit; font-size: 11.5px; color: #1f5fbf; cursor: pointer; text-align: left; }
.pj-flow-hint:hover { text-decoration: underline; }
.pj-flow-head { cursor: pointer; margin: -4px -8px; padding: 4px 8px; border-radius: 8px; transition: background-color .15s ease; }
.pj-flow-head:hover { background: #f7f7f5; }
.pj-flow-head:focus-visible { outline: 2px solid #9fb8e8; outline-offset: 0; }
@keyframes pjTarget { 0%, 40% { box-shadow: 0 0 0 3px rgba(15,91,213,.28); border-color: #9fb8e8; } 100% { box-shadow: 0 1px 2px rgba(0,0,0,0.03); } }
@media (prefers-reduced-motion: reduce) { .pj-card:target, .pj-card.pj-flash { animation: none; border-color: #9fb8e8; } }
.pj-quiet { transition: background-color .15s ease, color .15s ease; }
.pj-quiet:hover:not(:disabled) { background: rgba(0,0,0,0.045) !important; color: #171717 !important; }
.pj-danger:hover:not(:disabled) { background: #fdecea !important; color: #b42318 !important; }
.pj-quiet:focus-visible { outline: 2px solid #171717; outline-offset: 1px; }
.pj-publish { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 28px; border: 0; border-radius: 8px; background: #fff; color: #171717; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background-color .15s ease; }
.pj-publish:hover { background: #eef8f2; }
.pj-flow-next { display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 16px; border: 0; border-radius: 9px; background: #171717; color: #fff; font-family: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background-color .15s ease; }
.pj-flow-next:hover:not(:disabled) { background: #333; }
.pj-flow-next:disabled { background: #f0f0ee; color: #9a9a9a; cursor: default; }
.pj-flow-back { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 15px; border: 1px solid #d4d4d4; border-radius: 9px; background: #fff; color: #262626; font-family: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background-color .15s ease; }
.pj-disclose { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; border: 1px solid #d4d4d4; border-radius: 9px; background: #fff; color: #262626; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background-color .15s ease; }
.pj-disclose:hover { background: #f7f7f5; }
.pj-disclose[aria-expanded="true"] { background: #f3f3f1; }
.pj-flow-back:hover:not(:disabled) { background: #f7f7f5; }
.pj-flow-back:disabled { opacity: .5; cursor: default; }
.pj-publish:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.pj-pub-link { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px 0 8px; border-radius: 9px; background: #fff; border: 1px solid #d9eee2; font-size: 12px; text-decoration: none; color: #171717; min-width: 0; transition: border-color .15s ease, box-shadow .15s ease; }
a.pj-pub-link:hover { border-color: #9fd6b6; box-shadow: 0 2px 8px rgba(30,122,79,.08); color: #171717; }
`;

const PAPER: React.CSSProperties = { backgroundColor: "#f4f3f0", backgroundImage: "radial-gradient(#d8d5cf 1px, transparent 1px)", backgroundSize: "22px 22px" };
