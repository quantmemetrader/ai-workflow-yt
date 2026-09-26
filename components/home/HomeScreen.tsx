"use client";

import { ProjectPicker, type PickerProject } from "@/components/home/ProjectPicker";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MentionMenu, type MentionPerson } from "@/components/chat/MentionMenu";
import { useMentions } from "@/components/chat/useMentions";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_COLORS, AGENT_KEYS, AGENT_TINTS, agentTag, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import type { AgentState, Decision, RoleExtra, Running } from "@/lib/home/service";
import { pressCardAction, sendChannelMessage } from "@/app/(app)/chat/actions";
import { ProjectChats, ProjectProgress } from "@/components/home/ProjectHub";
import { SuggestionCard, type TodaySuggestion } from "@/components/home/Suggestion";
import { IdeasPanel, IDEAS_CSS } from "@/components/home/IdeasPanel";
import { TitleCheckCard, TITLE_CHECK_CSS, type CheckAsk } from "@/components/home/TitleCheckCard";
import { DetailLink, DETAIL_LINK_CSS } from "@/components/home/DetailLink";
import { RoleExtraPanel, RoleTabs, ROLE_TABS_CSS } from "@/components/home/RolePanels";
import type { ProjectDetail } from "@/lib/projects/service";
import type { Idea } from "@/lib/ideas/types";
import type { Module } from "@/lib/db/schema";
import { HOME_LAYOUT, type HomeRole, type PanelKey } from "@/lib/home/roles";
import { startProjectAction } from "@/app/(app)/projects/actions";
import { Fold } from "@/components/ui/Fold";
import { Icon } from "@/components/ui/Icon";
import { AgentName, Tr } from "@/components/ui/Tr";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { AgentTyping } from "@/components/agents/AgentTyping";
import { soft, withoutLeadingPictures } from "@/components/chat/look";
import { SayToAgent } from "@/components/flow/SayToAgent";
import type { ThreadMessage } from "@/components/home/Echo";

/**
 * 首页 — where the day is driven from, not a page that sends you elsewhere.
 *
 * Built back over the earlier Home, with its pieces: the rounded task box,
 * the cards waiting on you, the team with a line to give each work, and the
 * assistant panel on the right (the page passes it in). The employees'
 * faces are drawn once, in the team panel; the job tabs and the task box
 * name them in words. What is new is that the work happens here:
 *
 *   - the conversation in #制作 is on the page, answers and buttons included,
 *     so saying something and hearing back no longer means leaving;
 *   - today's video is drawn as the flow board draws it, two rows, and every
 *     step has a line to talk to whoever owns it;
 *   - the full flow is one big button, not a small link.
 *
 * And it is per job: `role` picks a layout from `HOME_LAYOUT` — which
 * panels, in what order, which employee the task box is addressed to — and
 * the page has already filtered the projects, decisions and running jobs to
 * that job. Every panel has its way out to the page it summarises
 * (`DetailLink`), drawn only when the viewer holds the module behind it.
 */
export function HomeScreen({
  agents,
  decisions,
  running,
  runningNames,
  zh,
  me,
  people,
  thread,
  projects,
  hub,
  suggestions,
  teamChannel,
  role,
  defaultRole,
  canSetDefault,
  modules,
  inHandCount,
  allActiveCount,
  ideas,
  extra,
}: {
  suggestions: TodaySuggestion[];
  /** The projects in hand for this job (the first six), with their steps
   * and latest messages. */
  hub: ProjectDetail[];
  /** Where a task can go: an existing project, or a new one. */
  projects: (PickerProject & { channelSlug: string | null })[];
  /** Which job's Home this is, and which one this person lands on. */
  role: HomeRole;
  defaultRole: HomeRole;
  /** Whether "设为我的默认" can express this view (see the page). */
  canSetDefault: boolean;
  /** The viewer's modules: a detail link is drawn only when its page opens. */
  modules: Module[];
  /** All the projects in hand for this job, of which `hub` is the first six. */
  inHandCount: number;
  /** Every active project in the studio, whatever the job. */
  allActiveCount: number;
  ideas: Idea[];
  extra: RoleExtra | null;
  thread: ThreadMessage[];
  agents: AgentState[];
  decisions: Decision[];
  running: (Running & { label: string; owner?: AgentKey | null })[];
  teamChannel: { id: string; slug: string; name: string } | null;
  runningNames: Record<string, string>;
  zh: boolean;
  me: string;
  people: MentionPerson[];
}) {
  const router = useRouter();
  const layout = HOME_LAYOUT[role];
  const can = (m: Module) => modules.includes(m);
  /* The job's employee is addressed from the start — the editor's task goes
     to 剪辑师 unless they say otherwise — as a token at the front of the box
     ("@剪辑师 ×") rather than as text in it: it goes out in front of what is
     typed, and one press (or Backspace in an empty box) takes it off. The
     page remounts this screen per job (`key`), so switching tabs re-seeds it. */
  const [token, setToken] = React.useState<AgentKey | null>(layout.agent);
  const [pending, start] = React.useTransition();
  const [pressing, setPressing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  /* What the box says, token included: every rule below reads this. */
  const full = token ? `${agentTag(token)} ${draft}` : draft;
  /* The project the box just started: offered, not opened. */
  const [created, setCreated] = React.useState<{ id: string; what: string; tagged: boolean } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const box = React.useRef<HTMLTextAreaElement | null>(null);
  const mentions = useMentions({ people, zh, draft, setDraft, box });
  const [giveTo, setGiveTo] = React.useState<AgentKey | null>(null);
  /* The colleagues given work from the 同事 panel, each with the moment of
     the last thing it had said then (0: nothing yet). Its row types
     (`AgentTyping`) until that moves — its reply landed — or the watch below
     runs out. The mark is the server's own timestamp, not this browser's
     clock: a machine whose clock runs fast or slow neither ends the typing
     before the answer nor keeps it going after. */
  const [asked, setAsked] = React.useState<Partial<Record<AgentKey, number>>>({});
  /* SayToAgent calls `onDone` after a send and also on Escape; only a send
     gives the row something to type about. Set by the key that closed it. */
  const cancelled = React.useRef(false);
  /* Which project the task box sends to: a new one unless one is chosen. */
  const [target, setTarget] = React.useState<string>("new");
  /* The topic 研究员 is checking (or has checked) under the box, if any. */
  const [checkAsk, setCheckAsk] = React.useState<CheckAsk | null>(null);

  /* After something is said, the answer comes from a model call that ends
     after the request returns. Refresh every few seconds for a minute and a
     half, then stop. */
  const [watching, setWatching] = React.useState(false);
  const [sentAt, setSentAt] = React.useState<string | null>(null);
  /* When a colleague last spoke, as the server has it (0: never). */
  const lastSpoke = (key: AgentKey) => {
    const at = agents.find((x) => x.key === key)?.at;
    return at ? new Date(at).getTime() : 0;
  };
  const waitingOn = (key: AgentKey) => {
    const before = asked[key];
    return watching && before !== undefined && lastSpoke(key) <= before;
  };
  /* Settled once somebody answered in the thread and every colleague given
     work from the panel has spoken since. */
  const answered = (sentAt === null || thread.some((m) => m.agent && m.at > sentAt)) && !agents.some((a) => waitingOn(a.key));
  React.useEffect(() => {
    if (!watching || answered) return;
    const until = Date.now() + 120_000;
    const id = setInterval(() => {
      if (Date.now() >= until) {
        clearInterval(id);
        setWatching(false);
        /* A colleague that never answered stops typing for good, rather
           than again at the next press that starts a watch. */
        setAsked({});
        return;
      }
      router.refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [watching, answered, router]);

  const t = (a: string, b: string) => (zh ? a : b);

  function press(channelSlug: string, messageId: string, actionId: string) {
    if (pressing) return;
    setError(null);
    setPressing(messageId + actionId);
    start(async () => {
      const res = await pressCardAction(channelSlug, messageId, actionId);
      setPressing(null);
      if (res?.error) setError(res.error);
      else {
        setSentAt(new Date().toISOString());
        setWatching(true);
        router.refresh();
      }
    });
  }

  /* A box holding nothing but a tag has nothing to start: the seeded tag
     alone must not make a project called "@剪辑师". */
  const said = (text: string) => AGENT_KEYS.reduce((rest, k) => rest.split(agentTag(k)).join(""), text).trim();
  const ready = said(full).length > 0;

  /* Research before the script. A new project whose text does not hand the
     work to a colleague by name (研究员 tagged, or nobody) goes to 研究员
     for a title check first (`TitleCheckCard`); the project is made from
     the card, with the researched title or as typed. Naming 策划, 编剧,
     剪辑师 or 撰稿人 keeps the box's old behaviour: the person asked that
     employee for something, so the work starts at once, and for the writers
     a quiet line under the box offers the check anyway. */
  const writesNow = (text: string) => parseAgentMentions(text).some((k) => k === "planning" || k === "script" || k === "video" || k === "article");
  const researchFirst = target === "new" && !writesNow(full);
  const offerCheck = target === "new" && ready && parseAgentMentions(full).some((k) => k === "script" || k === "article");

  /* Back to how the box started: empty, addressed to the job's employee. */
  function resetBox() {
    setDraft("");
    setToken(layout.agent);
  }

  /* "@ 同事": the same picker typing @ opens. An @ goes in at the caret
     (with a space before it when it would otherwise start mid-word, where
     it would not count as a tag) and the picker lists everybody. */
  function openMentions() {
    const el = box.current;
    const at = el && document.activeElement === el ? (el.selectionStart ?? draft.length) : draft.length;
    const before = draft.slice(0, at);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${pad}@${draft.slice(at)}`;
    const caret = at + pad.length + 1;
    setDraft(next);
    mentions.onValue(next, caret);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function askResearcher(body: string) {
    const text = body.trim();
    if (!said(text)) return;
    setError(null);
    setCreated(null);
    setCheckAsk({ original: text, text: trim(said(text), 200), nonce: Date.now() });
    resetBox();
  }

  /* A new project from the words as typed: the box's own start, and the
     card's "直接开项目". Offered, not opened — "打开项目" or "留在首页" —
     because somebody handing out three tasks in a row wants to stay here. */
  async function startNew(text: string): Promise<boolean> {
    const r = await startProjectAction({ message: text });
    if ("error" in r && r.error) {
      setError(r.error);
      return false;
    }
    if ("id" in r && r.id) setCreated({ id: r.id, what: trim(said(text), 40), tagged: parseAgentMentions(text).length > 0 });
    /* The new project in the lists and the sidebar, without leaving. */
    router.refresh();
    return true;
  }

  /* The task box starts a project (or adds to one); adding to an existing
     one still goes there, where the answer will appear. */
  function startWork(body: string) {
    const text = body.trim();
    if (!said(text)) return;
    if (target === "new" && !writesNow(text)) {
      askResearcher(text);
      return;
    }
    setError(null);
    start(async () => {
      if (target === "new") {
        if (await startNew(text)) resetBox();
        return;
      }
      const p = projects.find((x) => x.id === target);
      if (!p?.channelSlug) return;
      const res = await sendChannelMessage(p.channelSlug, text);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setDraft("");
      router.push(`/projects/${p.id}`);
    });
  }


  const subline =
    decisions.length > 0
      ? t(`有 ${decisions.length} 件事等你决定。`, `${decisions.length} thing${decisions.length > 1 ? "s" : ""} waiting on you.`)
      : running.length > 0
        ? t("没有要你决定的，同事还在做手上的活。", "Nothing waiting on you; the team is still working.")
        : t("今天没有待办。在下面说一句就能开工。", "Nothing on today. Say a word below and the team starts.");

  /* The task box: the text, with the job's employee as a token in front of
     it, and under it one row — "@ 同事" (the picker typing @ opens), where
     it goes (the project picker), and 开工 at the right. It had a row of
     the five employees' faces as chips too; the faces live in the 同事
     panel now, and Home drew them three times. */
  const composer = (
    <div style={{ position: "relative" }}>
      <MentionMenu matches={mentions.matches} active={mentions.active} zh={zh} onPick={mentions.pick} onHover={mentions.setActive} placement="down" />
      <div style={{ border: "1px solid #e2e2e2", borderRadius: 14, background: "#fff", padding: "12px 14px", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          {token ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 2, height: 24, padding: "0 3px 0 8px", borderRadius: 7, background: soft(AGENT_TINTS[token], 0.55), color: AGENT_COLORS[token], fontSize: 12.5, fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>
              @<AgentName agent={token} zh={zh} />
              <button
                type="button"
                onClick={() => {
                  setToken(null);
                  requestAnimationFrame(() => box.current?.focus());
                }}
                aria-label={t("不交给这位同事", "Remove this colleague")}
                title={t("移除", "Remove")}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, marginLeft: 2, border: 0, borderRadius: 5, background: "transparent", color: "inherit", cursor: "pointer", padding: 0, opacity: 0.7 }}
              >
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="M7 7l10 10M17 7 7 17" />
                </svg>
              </button>
            </span>
          ) : null}
          <textarea
            ref={box}
            value={draft}
            rows={2}
            onChange={(e) => {
              setDraft(e.target.value);
              mentions.onValue(e.target.value, e.target.selectionStart ?? e.target.value.length);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(180, e.target.scrollHeight)}px`;
            }}
            onBlur={mentions.close}
            onKeyDown={(e) => {
              if (mentions.onKeyDown(e)) return;
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                startWork(full);
                return;
              }
              /* Backspace at the very start of the box takes the token off,
                 the way a recipient comes off an address line. */
              if (e.key === "Backspace" && token && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
                e.preventDefault();
                setToken(null);
              }
            }}
            placeholder={t("想做什么题？写下来，研究员先查热榜和对标；想直接写就 @编剧", "What topic? The researcher checks the lists and rivals first; tag @writer to go straight to the script")}
            style={{ flexGrow: 1, minWidth: 0, width: "100%", border: 0, outline: "none", resize: "none", fontSize: 14.5, lineHeight: 1.6, fontFamily: "inherit", letterSpacing: "inherit", color: "#171717", background: "transparent", padding: 0 }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            /* The caret stays in the box: a blur would close the picker
               before it opened. */
            onMouseDown={(e) => e.preventDefault()}
            onClick={openMentions}
            className="chip"
            aria-haspopup="listbox"
            aria-expanded={mentions.open}
            title={t("叫一位同事（也可以直接输入 @）", "Tag a colleague (or type @)")}
            style={{ height: 30, fontSize: 12, gap: 5, cursor: "pointer", flexShrink: 0 }}
          >
            <span aria-hidden style={{ fontWeight: 600, fontSize: 13, lineHeight: 1 }}>@</span>
            {zh ? <Tr zh="同事" en="Colleague" /> : "Colleague"}
          </button>
          <ProjectPicker zh={zh} value={target} projects={projects} onChange={setTarget} />
          <span style={{ flexGrow: 1 }} />
          {can("chat") ? <DetailLink zh={zh} href="/projects/new" label="新建项目" labelEn="New project" /> : null}
          <button
            type="button"
            disabled={pending || !ready}
            onClick={() => startWork(full)}
            style={{ height: 34, marginLeft: 6, padding: "0 18px", borderRadius: 10, border: 0, background: ready ? "#171717" : "#ededed", color: ready ? "#fff" : "#999999", fontSize: 13, fontWeight: 500, fontFamily: "inherit", flexShrink: 0, cursor: ready ? "pointer" : "default" }}
          >
            {t("开工", "Start")}
          </button>
        </div>
      </div>
      {/* One quiet line on where 开工 sends a new topic, or, when the text
          names the writer, the offer to have it checked first. */}
      {offerCheck ? (
        <button type="button" className="hc-hint" onClick={() => askResearcher(full)}>
          <AgentIcon agent="research" size={14} radius={4} />
          {t("先让研究员看看标题？", "Have the researcher check the title first?")}
        </button>
      ) : researchFirst && ready ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, padding: "0 2px", fontSize: 12, color: "#8a8a8a" }}>
          <AgentIcon agent="research" size={14} radius={4} />
          {t("开工后研究员先查这个题的热度和对标，再决定写不写脚本", "Start sends it to the researcher first: heat and rivals, then you decide on the script")}
        </div>
      ) : null}
      {error ? <div style={{ fontSize: 12.5, color: "#e03636", marginTop: 6 }}>{error}</div> : null}
      {checkAsk ? <TitleCheckCard key={checkAsk.nonce} zh={zh} ask={checkAsk} canWrite={can("script")} onDirect={startNew} onClose={() => setCheckAsk(null)} /> : null}
      {created ? (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, padding: "9px 12px", border: "1px solid #cbe9d8", borderRadius: 12, background: "#f1faf5", flexWrap: "wrap" }}>
          <Icon name="check" size={15} color="#1e7a4f" strokeWidth={2.2} />
          <span style={{ fontSize: 13, color: "#1f3a2c", minWidth: 0, flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("项目开好了", "Project started")}
            {created.what ? <span style={{ color: "#5b7466" }}>{t(`：「${created.what}」`, `: "${created.what}"`)}</span> : null}
            {/* Only a tagged employee is told (startProjectAction); an
                untagged task waits in the project for whoever opens it. */}
            {created.tagged ? <span style={{ color: "#5b7466" }}>{t("，已经交给同事。", ". Handed to the team.")}</span> : null}
          </span>
          <Link href={`/projects/${created.id}`} prefetch={false} style={{ ...btn(true), height: 28, textDecoration: "none" }}>
            {t("打开项目", "Open the project")}
          </Link>
          <button type="button" onClick={() => setCreated(null)} style={{ ...btn(false), height: 28 }}>
            {t("留在首页", "Stay on Home")}
          </button>
        </div>
      ) : null}
    </div>
  );

  /* The team, with this job's own employee first. */
  const team = layout.agent ? [...agents.filter((a) => a.key === layout.agent), ...agents.filter((a) => a.key !== layout.agent)] : agents;

  /* "工作室全部进行中项目 N →": whatever this Home filters, every project
     stays one press away. */
  const allProjectsLink =
    can("chat") && (role !== "overview" || allActiveCount > hub.length) ? (
      <Link href="/projects" prefetch={false} className="home-all" style={{ display: "flex", alignItems: "center", gap: 4, padding: "9px 14px", fontSize: 12.5, color: "#525252", textDecoration: "none" }}>
        {role === "overview" ? t(`全部进行中项目 ${allActiveCount}`, `All ${allActiveCount} projects in progress`) : t(`工作室全部进行中项目 ${allActiveCount}`, `All ${allActiveCount} of the studio's projects in progress`)}
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />
        </svg>
      </Link>
    ) : null;

  const panels: Record<PanelKey, React.ReactNode> = {
    composer,
    ideas: <IdeasPanel zh={zh} initial={ideas} canStart={can("chat")} canResearch={can("research")} />,
    suggestion: <SuggestionCard items={suggestions} zh={zh} canResearch={can("research")} />,
    extra: extra ? <RoleExtraPanel extra={extra} zh={zh} /> : null,
    projects: (
      <ProjectProgress
        projects={hub}
        zh={zh}
        title={zh ? layout.projectsZh : layout.projectsEn}
        sub={String(inHandCount)}
        empty={zh ? layout.emptyZh : layout.emptyEn}
        right={can("chat") ? <DetailLink zh={zh} href="/projects" /> : null}
        footer={allProjectsLink}
      />
    ),
    decisions:
      decisions.length > 0 ? (
        <Fold
          id="home-decisions"
          title={t("等你决定", "Waiting on you")}
          sub={String(decisions.length)}
          height={decisions.length > 2 ? 360 : undefined}
          right={teamChannel && can("chat") ? <DetailLink zh={zh} href={`/chat/c/${encodeURIComponent(teamChannel.slug)}`} /> : null}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {decisions.map((d) => (
              <article key={d.messageId} style={GRADIENT_CARD}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {d.agent ? <AgentIcon agent={d.agent} size={22} radius={6} /> : <PersonAvatar id={d.authorId} url={d.authorAvatar} name={d.author} size={22} radius={6} />}
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{d.agent ? <AgentName agent={d.agent} zh={zh} /> : d.author}</span>
                  <Link href={`/chat/c/${encodeURIComponent(d.channelSlug)}`} prefetch={false} style={{ fontSize: 11.5, color: "#999999", textDecoration: "none" }}>
                    #{d.channelName}
                  </Link>
                  <span style={{ flexGrow: 1 }} />
                  <span style={{ fontSize: 11.5, color: "#c7c7c7" }}>{ago(d.at, zh)}</span>
                </div>
                <p style={{ margin: "9px 0 0", fontSize: 13, lineHeight: 1.65, color: "#2b343d", whiteSpace: "pre-wrap" }}>{trim(d.body, 320)}</p>
                <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
                  {d.actions.map((a, i) =>
                    a.kind === "open" ? (
                      <Link key={a.id} href={a.href ?? "#"} prefetch={false} style={{ ...btn(false), textDecoration: "none" }}>
                        {zh ? a.label : a.labelEn}
                      </Link>
                    ) : (
                      <button key={a.id} type="button" disabled={pending} onClick={() => press(d.channelSlug, d.messageId, a.id)} style={{ ...btn(i === 0), opacity: pressing === d.messageId + a.id ? 0.55 : 1 }}>
                        {zh ? a.label : a.labelEn}
                      </button>
                    ),
                  )}
                </div>
              </article>
            ))}
          </div>
        </Fold>
      ) : null,
    running: running.length > 0 ? <RunningPanel zh={zh} running={running} names={runningNames} right={can("chat") ? <DetailLink zh={zh} href="/flow" /> : null} /> : null,
    chats: <ProjectChats projects={hub} zh={zh} right={can("chat") ? <DetailLink zh={zh} href="/projects" /> : null} />,
    team: (
      <Fold id="home-team" title={zh ? <Tr zh="同事" en="The team" /> : "The team"} height={300} right={can("chat") ? <DetailLink zh={zh} href="/flow" /> : null}>
        {/* Five rows that fit the panel's 300px without a scrollbar: the
            first and last rows give their outer padding to the panel's own,
            and the last line said is grey under the name, not a second
            line of body text. The one place on Home with the employees'
            faces and status; the tabs and the task box are words. */}
        {team.map((a, idx) => {
          const on = giveTo === a.key;
          const typing = waitingOn(a.key);
          return (
            <div key={a.key} style={{ borderTop: idx ? "1px solid #f3f3f3" : "none", paddingTop: idx ? 8 : 0, paddingBottom: idx === team.length - 1 ? 0 : 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <AgentIcon agent={a.key} size={28} radius={8} />
                <div style={{ minWidth: 0, flexGrow: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      <AgentName agent={a.key} zh={zh} />
                    </span>
                    <Status status={a.status} zh={zh} />
                  </div>
                  {/* Given work from here: typing, in the line's place, until
                      its answer lands. */}
                  {typing ? (
                    <div style={{ marginTop: 2 }}>
                      <AgentTyping agent={a.key} zh={zh} face={false} size="sm" />
                    </div>
                  ) : (
                    <div title={a.line ?? undefined} style={{ fontSize: 12, color: a.line ? "#7c7c7c" : "#c7c7c7", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {/* Without the picture an employee opens with (the
                          plan's clipboard): the product draws no emoji. */}
                      {a.line ? trim(withoutLeadingPictures(a.line), 90) : t("还没说过话", "Has not spoken yet")}
                    </div>
                  )}
                </div>
                {/* 派任务 / Assign. It said 交代, which Chrome's translate
                    reads as "Explanation"; the English beside it is ours. */}
                <button
                  type="button"
                  onClick={() => setGiveTo(on ? null : a.key)}
                  aria-expanded={on}
                  style={{ height: 26, padding: "0 10px", borderRadius: 8, border: `1px solid ${on ? "#171717" : "#e6e6e6"}`, background: on ? "#f5f5f4" : "#fff", color: "#3d3d3d", fontFamily: "inherit", fontSize: 12, cursor: "pointer", flexShrink: 0 }}
                >
                  {on ? (zh ? <Tr zh="收起" en="Close" /> : "Close") : zh ? <Tr zh="派任务" en="Assign" /> : "Assign"}
                </button>
              </div>
              {on ? (
                <div
                  style={{ marginTop: 8 }}
                  /* Which way the box is closing: Escape (nothing sent) or
                     a send, by Enter or by the button. */
                  onKeyDownCapture={(e) => {
                    cancelled.current = e.key === "Escape";
                  }}
                  onPointerDownCapture={() => {
                    cancelled.current = false;
                  }}
                >
                  <SayToAgent
                    agent={a.key}
                    zh={zh}
                    onDone={() => {
                      /* The box closes either way. */
                      setGiveTo(null);
                      if (cancelled.current) {
                        cancelled.current = false;
                        return;
                      }
                      /* Sent: the row types until the answer lands. */
                      setAsked((m) => ({ ...m, [a.key]: lastSpoke(a.key) }));
                      setSentAt(new Date().toISOString());
                      setWatching(true);
                    }}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </Fold>
    ),
  };

  const column = (keys: PanelKey[]) => keys.map((k) => <React.Fragment key={k}>{panels[k]}</React.Fragment>);

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: "auto", ...PAPER }}>
      <style dangerouslySetInnerHTML={{ __html: `${DETAIL_LINK_CSS}${IDEAS_CSS}${TITLE_CHECK_CSS}${ROLE_TABS_CSS} .home-all:hover { color: #171717 !important; }` }} />
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "22px 24px 48px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>{t(`${greeting(zh)}，${me}`, `${greeting(zh)}, ${me}`)}</h1>
          <p style={{ margin: "5px 0 0", fontSize: 13.5, color: "#7c7c7c" }}>{subline}</p>
          <RoleTabs zh={zh} role={role} defaultRole={defaultRole} canSetDefault={canSetDefault} />
        </div>

        {/* ---- the job's panels down the wide column; the project chats and
             the team down the narrow one (drawn second in the DOM order of
             the old screen, so `order: 2` keeps it on the right) ---- */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 8fr) minmax(340px, 5fr)", gap: 14, alignItems: "start" }}>
          <div style={{ minWidth: 0, order: 2, display: "flex", flexDirection: "column", gap: 14 }}>{column(layout.side)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>{column(layout.main)}</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the conversation */


/* ------------------------------------------------------------- running now */

/**
 * What the machines are doing, in the order a person cares about.
 *
 * Running jobs first, each with whose work it is, a bar (a real one when the
 * job reports progress, a moving one when it does not), and how long it has
 * been going. Queued jobs are one line that says how many and what, opened
 * on demand: seven rows of "queued" said nothing a count does not.
 */
function RunningPanel({ zh, running, names, right }: { zh: boolean; running: (Running & { label: string; owner?: AgentKey | null })[]; names: Record<string, string>; right?: React.ReactNode }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [showQueue, setShowQueue] = React.useState(false);
  const now = running.filter((j) => j.status === "running");
  const queued = running.filter((j) => j.status === "queued");
  const name = (j: Running) => names[j.type] ?? j.type;
  const owner = (j: Running & { owner?: AgentKey | null }): AgentKey | null => j.owner ?? null;

  return (
    <Fold
      id="home-running"
      title={t("正在进行", "Running now")}
      sub={t(`${now.length} 个在跑${queued.length ? ` · ${queued.length} 个排队` : ""}`, `${now.length} running${queued.length ? ` · ${queued.length} queued` : ""}`)}
      icon={<span style={{ width: 8, height: 8, borderRadius: 4, background: now.length ? "#278f5e" : "#d9d9d9", boxShadow: now.length ? "0 0 0 3px rgba(39,143,94,0.15)" : "none", animation: now.length ? "auraPulse 1.6s ease-in-out infinite" : "none" }} />}
      resizable={false}
      right={right}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {now.length === 0 ? <div style={{ fontSize: 12.5, color: "#999999" }}>{t("现在没有在跑的，下面的在排队。", "Nothing running; the ones below are waiting their turn.")}</div> : null}
        {now.map((j) => {
          const o = owner(j);
          const pct = j.progress > 0 ? Math.round(j.progress * 100) : null;
          return (
            <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid #eef2ef", borderRadius: 10, background: "#fbfdfc" }}>
              <AgentIcon agent={o} size={28} radius={8} />
              <div style={{ minWidth: 0, flexGrow: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name(j)}</span>
                  <span style={{ fontSize: 11.5, color: "#999999", whiteSpace: "nowrap" }}>
                    {o ? <AgentName agent={o} zh={zh} /> : null}
                    {j.who ? ` · ${t("由", "for ")}${j.who}${t("发起", "")}` : ""} · {ago(j.at, zh)}
                  </span>
                  <span style={{ flexGrow: 1 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#278f5e", fontVariantNumeric: "tabular-nums" }}>{pct !== null ? `${pct}%` : ""}</span>
                </div>
                <div style={{ position: "relative", height: 4, borderRadius: 2, background: "#e6efe9", marginTop: 7, overflow: "hidden" }}>
                  {pct !== null ? (
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: "linear-gradient(90deg, #278f5e, #0f5bd5)", borderRadius: 2, transition: "width .4s ease" }} />
                  ) : (
                    <div style={{ position: "absolute", top: 0, bottom: 0, width: "30%", background: "linear-gradient(90deg, rgba(39,143,94,0), #278f5e, rgba(39,143,94,0))", animation: "homeSlide 1.4s ease-in-out infinite" }} />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {queued.length ? (
          <div style={{ border: "1px dashed #e2e2e2", borderRadius: 10 }}>
            <button
              type="button"
              onClick={() => setShowQueue((v) => !v)}
              aria-expanded={showQueue}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: 0, background: "transparent", cursor: "pointer", font: "inherit", textAlign: "left", color: "#525252" }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "#171717", whiteSpace: "nowrap" }}>{t(`排队中 ${queued.length}`, `${queued.length} queued`)}</span>
              <span style={{ fontSize: 12, color: "#999999", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1 }}>
                {[...new Set(queued.map(name))].join(t("、", ", "))}
              </span>
              <span style={{ fontSize: 11.5, color: "#7c7c7c", whiteSpace: "nowrap" }}>{showQueue ? t("收起", "Hide") : t("展开", "Show")}</span>
            </button>
            {showQueue ? (
              <div style={{ padding: "0 10px 6px" }}>
                {queued.map((j) => (
                  <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #f3f3f3", fontSize: 12 }}>
                    <AgentIcon agent={owner(j)} size={18} radius={5} />
                    <span>{name(j)}</span>
                    {j.who ? <span style={{ color: "#999999" }}>· {j.who}</span> : null}
                    <span style={{ flexGrow: 1 }} />
                    <span style={{ color: "#b3b3b3" }}>{t("排队", "waiting")} {ago(j.at, zh)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <style dangerouslySetInnerHTML={{ __html: `@keyframes homeSlide { 0% { left: -30%; } 100% { left: 100%; } } @media (prefers-reduced-motion: reduce) { [style*="homeSlide"] { animation: none !important; } }` }} />
    </Fold>
  );
}

/* ------------------------------------------------------------- pieces */

function Status({ status, zh }: { status: AgentState["status"]; zh: boolean }) {
  const [label, color, bg] =
    status === "working" ? [zh ? "工作中" : "Working", "#0b7a63", "#e3f4ee"] : status === "waiting" ? [zh ? "等你" : "Waiting", "#a35f00", "#fbf0dc"] : [zh ? "空闲" : "Idle", "#999999", "#f3f3f3"];
  return <span style={{ fontSize: 10.5, fontWeight: 500, color, background: bg, borderRadius: 999, padding: "0 7px", lineHeight: "17px" }}>{label}</span>;
}

const PAPER: React.CSSProperties = {
  backgroundColor: "#f4f3f0",
  backgroundImage: "radial-gradient(#d8d5cf 1px, transparent 1px)",
  backgroundSize: "22px 22px",
};


const GRADIENT_CARD: React.CSSProperties = {
  border: "1px solid transparent",
  borderRadius: 14,
  background: "linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(135deg, #dcdcdc, #cbd6f2 55%, #cfe6dd) border-box",
  padding: "14px 16px",
};

function btn(primary: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    height: 30,
    padding: "0 13px",
    borderRadius: 9,
    border: primary ? "1px solid #171717" : "1px solid #e2e2e2",
    background: primary ? "#171717" : "#fff",
    color: primary ? "#fff" : "#171717",
    fontFamily: "inherit",
    letterSpacing: "inherit",
    fontSize: 12.5,
    fontWeight: primary ? 500 : 400,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function trim(text: string, max: number): string {
  const clean = text.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function greeting(zh: boolean): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", hour12: false }).format(new Date()));
  if (zh) return hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  return hour < 11 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function ago(at: Date, zh: boolean): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  if (mins < 1) return zh ? "刚刚" : "just now";
  if (mins < 60) return zh ? `${mins} 分钟前` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return zh ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return zh ? `${days} 天前` : `${days}d ago`;
}
