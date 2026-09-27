"use client";

import { approveNowAction } from "@/app/(app)/script/actions";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon, type IconName } from "@/components/ui/Icon";
import { MentionMenu, type MentionPerson } from "@/components/chat/MentionMenu";
import { useMentions } from "@/components/chat/useMentions";
import { AccessPicker } from "@/components/files/AccessPicker";
import { AGENT_COLORS, AGENT_TINTS, agentTag, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import { pressCardAction, sendChannelMessage } from "@/app/(app)/chat/actions";
import { cancelAutoCutAction, clipLandedAction, deleteProjectAction, renameProjectAction, setAutoCutAction, setProjectAccessAction, setProjectStatusAction, chooseScriptAction, chooseTopicAction, startCutFromPageAction, startFromTopicAction, unpublishAction } from "@/app/(app)/projects/actions";
import { addClipAction, addItemAction, autoEditAction, exportAction } from "@/app/(app)/video/actions";
import { uploadFiles } from "@/lib/client/upload";
import { beginWork } from "@/lib/client/busy";
import { notify } from "@/lib/client/notify";
import { writeRendering } from "@/lib/client/rendering";
import { bumpLive, useLiveProject } from "@/lib/client/live";
import { isRunning } from "@/lib/projects/live-types";
import { ClipsNextStep } from "@/components/projects/ClipsNextStep";
import { LivePill, useLiveRow } from "@/components/chat/LivePill";
import type { ProjectDetail, ProjectStep } from "@/lib/projects/service";
import { cleanCodes, type ProjectSource } from "@/lib/projects/topic";
import { JobChip } from "@/components/chat/Working";
import type { StepKey } from "@/lib/agents/steps";
import { AgentTyping } from "@/components/agents/AgentTyping";
import { AgentName, Tr } from "@/components/ui/Tr";
import { PublishPopover } from "@/components/projects/PublishPopover";
import { PUBLISHED_TONE, PublishedCheck, PublishedMark, PublishedMarks, PublishedPill } from "@/components/projects/Published";
import { publishPlatformName, publishedDay, type Publication } from "@/lib/projects/publication";
import { artifactHref } from "@/lib/chat/handoff";
import { LinkedText } from "@/components/chat/LinkedText";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { VoicePicker } from "@/components/video/VoicePicker";
import type { UiVoice } from "@/lib/video/tts/types";
import { DEFAULT_VOICE_ZH, voiceLabel } from "@/lib/video/tts/voices";
import { VideoCards } from "@/components/chat/VideoCard";
import { videoBytes, videoClock } from "@/lib/chat/video-card";
import { directorStepLabel } from "@/lib/agents/steps";

/**
 * One project, worked on in place.
 *
 * Each stage is a card with its own box to type into, its own buttons, and
 * its own results: 研究员's findings on the topic card, the script's beats on
 * the script card, the clips as thumbnails, the video with a prompt and a
 * player, the captions ready to copy. Asking an employee from a card shows
 * the answer on that card. The conversation itself is one line of activity
 * that opens into a panel only when somebody wants to talk directly.
 */
type Msg = ProjectDetail["messages"][number];

export function ProjectScreen({
  project: p,
  zh,
  people,
  writing,
  voices = [],
  canApprove = false,
  privateChats = [],
}: {
  /** Your private chats that worked on this project, linked under the activity line. */
  privateChats?: { id: string; title: string }[];
  /** An owner or admin: may OK the script in one press (脚本可以了). */
  canApprove?: boolean;
  project: ProjectDetail;
  zh: boolean;
  people: MentionPerson[];
  writing: boolean;
  /** The narration voices (`lib/video/tts`), for the video card's AI 配音. */
  voices?: UiVoice[];
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState(p.title);
  const [sharing, setSharing] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [popup, setPopup] = React.useState<{ title: string; body: React.ReactNode } | null>(null);
  const [videoPrompt, setVideoPrompt] = React.useState((p.brief ?? p.title).replace(/@\S+/g, "").trim());
  /* AI 配音: on means the script's 旁白 is voiced and the video cut to it even
     when the clips have sound; off (the default) still voices it when the
     clips turn out to be silent. The voice starts as the one used last. */
  const [aiVoice, setAiVoice] = React.useState(false);
  const [voiceId, setVoiceId] = React.useState(p.narration?.voiceId?.replace(/@.*$/, "") || voices.find((v) => v.lang === "zh")?.id || DEFAULT_VOICE_ZH);
  const hasNarration = p.beats.some((b) => b.voiceover.trim().length > 0);
  /* The AI 配音 box is for footage nobody speaks in (stock shots, a script-only
     project) — the owner: "show it only on the ones that actually don't have
     spoken audio". Speech found by transcription (caption lines exist for the
     clips) hides it; a narration already made keeps it, so it can be changed. */
  const footageSpeaks = (p.video?.clips ?? 0) > 0 && (p.video?.captions?.length ?? 0) > 0;
  const showVoiceBox = Boolean(p.narration) || !footageSpeaks;
  const oneGoBody = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ prompt: videoPrompt, narrate: aiVoice ? "on" : "auto", voiceId, ...extra });
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [approveError, setApproveError] = React.useState<string | null>(null);
  const [picking, setPicking] = React.useState<null | "clips" | "scripts" | "topics">(null);
  /* An upload from this page just landed: the clips card leads with the
     next press, loud, until the film starts. */
  const [justLanded, setJustLanded] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  /* The 已发布 popover, and which button opened it: the delivery step's in
     the row of steps, the delivery card's, or the one under the finished
     film on the 成片 card. */
  const [publishing, setPublishing] = React.useState<null | "step" | "card" | "video">(null);
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

  /** Write (or rewrite) the project's draft from its topic, after the response. */
  function writeDraft() {
    start(async () => {
      const res = await startFromTopicAction({ kind: "project", id: p.id }, { write: true, rewrite: p.beats.length > 0 });
      if ("error" in res && res.error) {
        notify(res.error);
        return;
      }
      if ("writing" in res && res.writing) setDraftWriting(true);
      else if ("note" in res && res.note) notify(res.note);
    });
  }
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
  const renderFailed = !directing && p.render?.state === "failed";
  const cutReady = !busyLive && !(p.render?.state === "done" && p.render.fileId) && (p.video?.items ?? 0) > 0;
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
  function ask(agent: AgentKey, text: string) {
    const body = `${agentTag(agent)} ${text.trim()}`;
    start(async () => {
      const res = await sendChannelMessage(p.channel.slug, body);
      if (res?.error) {
        notify(res.error);
        return;
      }
      setAsked((m) => ({ ...m, [agent]: new Date().toISOString() }));
      router.refresh();
    });
  }

  /* A video job, started from a card. Not inside a page-wide transition
     (that dimmed every button and read as the page glitching), and followed
     by the corner chip on every page until it lands. */
  async function runTool(key: string, label: string, fn: () => Promise<{ error?: string } | Record<string, never>>) {
    if (busyAction) return;
    setBusyAction(key);
    const res = await fn().catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
    setBusyAction(null);
    if (res && "error" in res && res.error) {
      notify(res.error);
      return;
    }
    if (p.video) writeRendering({ projectId: p.video.id, title: p.title });
    notify(t(`已开始：${label}`, `Started: ${label}`), "ok");
    setAsked((m) => ({ ...m, video: new Date().toISOString() }));
    setJustLanded(false);
    /* Home's card, the sidebar and the corner chip follow at once. */
    setTimeout(bumpLive, 1500);
    router.refresh();
  }

  /**
   * "素材传好了 · 开始剪" on the clips card: the one-go through the shared
   * starter (`startCutFromPageAction`), so 剪辑师 says in the project's
   * chat what it is doing and the chat's chip follows it. Same prompt and
   * voice choices as the video card's button.
   */
  const startCut = () =>
    runTool("cut", t("剪辑", "the cut"), async () => {
      const r = await startCutFromPageAction(p.id, { prompt: videoPrompt, narrate: aiVoice ? "on" : "auto", voiceId });
      return "error" in r && r.error ? { error: r.error } : {};
    });

  /** "传完自动开始剪", kept on the project; the page refreshes to its state. */
  function toggleAutoCut(on: boolean) {
    start(async () => {
      const r = await setAutoCutAction(p.id, on);
      if (r?.error) notify(r.error);
      else notify(on ? t("好，最后一段传完 60 秒后会自动开始剪。", "On: the cut starts a minute after the last upload lands.") : t("已关闭自动开始。", "Auto-start is off."), "ok");
      router.refresh();
    });
  }

  function cancelAutoCut() {
    start(async () => {
      const r = await cancelAutoCutAction(p.id);
      if (r?.error) notify(r.error);
      else notify(t("已取消这次自动开始；设置还在。", "Cancelled this time; the setting stays."), "info");
      setTimeout(bumpLive, 500);
      router.refresh();
    });
  }

  async function upload(list: FileList) {
    if (!p.video) return;
    const videoId = p.video.id;
    const done = beginWork(t(`上传 ${list.length} 个文件`, `Uploading ${list.length} file(s)`));
    try {
      const out = await uploadFiles(list, {
        access: { mode: "everyone" },
        onDone: async (fileId) => {
          const res = await addClipAction(videoId, fileId);
          if ("id" in res && res.id) await addItemAction(videoId, "clip", res.id, "");
          /* "传完自动开始剪": every landing moves the minute; the last one
             is the one that counts (`clipLandedAction`). */
          await clipLandedAction(p.id).catch(() => null);
        },
      });
      if (out.uploaded) {
        notify(t(`已上传 ${out.uploaded} 段素材`, `Uploaded ${out.uploaded} clip(s)`), "ok");
        setJustLanded(true);
      }
      setTimeout(bumpLive, 500);
      router.refresh();
    } finally {
      done();
    }
  }

  const rendered = p.render?.state === "done" && p.render.fileId ? p.render.fileId : null;
  /*
   * A calm page once work is done (the owner: "all stuff which are done,
   * don't have those as CTA, only maybe retry ones are fine"). A step that
   * is done shows its result; its buttons fold behind one quiet grey link
   * (`Disclose`), and only the next step's press stays loud.
   *
   *   topicChosen — the topic card shows a chosen topic: its asks fold;
   *   hasCut      — a cut is on the timeline: adding clips folds;
   *   videoMade   — rendered, or a cut exists: the script step is behind us;
   *   scriptDone  — beats, and approved/locked or the film already made.
   */
  const topicChosen = Boolean(src?.why || src?.hook || src?.evidence?.length || p.brief);
  const hasCut = (p.video?.items ?? 0) > 0;
  const videoMade = Boolean(rendered) || hasCut;
  const scriptDone = p.beats.length > 0 && (p.script?.status === "locked" || p.steps.find((s) => s.key === "script")?.state === "done" || videoMade);
  const copyDone = p.status === "done" || Boolean(latest("article"));
  const lastMsg = p.messages[p.messages.length - 1] ?? null;

  /** 「撤回，改回进行中」: back in progress, the platforms and links cleared. */
  function undoPublish() {
    if (!window.confirm(t("撤回「已发布」？项目回到进行中，记下的平台和链接会清掉。", "Undo “published”? The project goes back to in progress, and the platforms and links noted are cleared."))) return;
    start(async () => {
      const r = await unpublishAction(p.id);
      if (r?.error) notify(r.error);
      else notify(t("已改回进行中", "Back in progress"), "ok");
      router.refresh();
    });
  }
  const publishPopover = (align: "left" | "right") => (
    <PublishPopover
      projectId={p.id}
      zh={zh}
      rendered={Boolean(rendered)}
      align={align}
      onClose={() => setPublishing(null)}
      onDone={() => {
        setPublishing(null);
        router.refresh();
      }}
    />
  );
  const skipped = (k: ProjectStep["key"]) => p.steps.find((s) => s.key === k)?.state === "skipped";
  /* Already 0–100 (`workProjectDetail`). */
  const pct = p.render?.progress ?? 0;
  /* What a held button says while a render runs: queued, or how far. */
  const renderingLabel = p.render?.state === "queued" ? t("排队渲染…", "Queued to render…") : t(`渲染中 ${pct}%…`, `Rendering ${pct}%…`);
  /* What the 剪辑 step and the 成片 card say while the film is being made:
     the director's step, or the render with its percent. */
  const liveWork: LiveWork | null = directing
    ? { agent: "video", label: { zh: `正在${directorStepLabel(p.director?.step ?? null, true)}`, en: capital(directorStepLabel(p.director?.step ?? null, false)) }, percent: p.director?.step === "render" && pct > 0 ? pct : null, since: p.director?.startedAt ?? null }
    : renderLive
      ? { agent: "video", step: p.render?.state === "queued" ? "working" : "rendering", label: p.render?.state === "queued" ? { zh: "排队渲染", en: "Queued to render" } : undefined, percent: p.render?.state === "queued" ? null : pct, since: p.render?.startedAt ?? null }
      : null;
  /* The render buttons burn the cut's own caption track, when it has one. */
  const captionLanguage = p.video?.captions[0] ?? (zh ? "zh-CN" : "en");
  const burnCaptions = (p.video?.captions.length ?? 0) > 0;
  const render = (aspect: "9:16" | "16:9") => p.video && runTool(aspect === "9:16" ? "r916" : "r169", t(`渲染 ${aspect}`, `render ${aspect}`), () => exportAction(p.video!.id, { aspect, burnCaptions, captionLanguage }));

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", position: "relative", ...PAPER }}>
      <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "20px 24px 60px", display: "flex", flexDirection: "column", gap: 14 }}>
          <style dangerouslySetInnerHTML={{ __html: PROJECT_CSS }} />
          {/* ---- header ----
              Who can see it and the full flow as the two real buttons; the
              state (进行中) moved beside the title, where it describes the
              project instead of looking like a fourth button; and 归档 and
              删除 behind a hairline as quiet text, 删除 in red, so the one
              press that cannot be undone no longer has a frame as heavy as
              the ones that can. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11.5, color: "#999999", display: "flex", gap: 6, alignItems: "center", flexGrow: 1 }}>
              <Link prefetch={false} href="/projects" style={{ color: "#999999", textDecoration: "none" }}>
                {t("项目", "Projects")}
              </Link>
              <span>/</span>
              <span>{p.mode.startsWith("direct:") ? t("直接交代", "Straight to an employee") : t("完整流程", "Full line")}</span>
            </div>
            {/* Who can see it and the full flow: quiet, low-contrast text,
                not framed chips (the owner: "全部流程 is too visible"). */}
            <button type="button" className="pj-quiet" onClick={() => p.canManage && setSharing(true)} disabled={!p.canManage} style={{ ...quiet("#9a9a9a"), height: 26, padding: "0 6px", cursor: p.canManage ? "pointer" : "default" }}>
              <Icon name={p.access.mode === "everyone" ? "eye" : "lock"} size={12} />
              {p.access.mode === "everyone" ? t("全工作室", "Everyone") : p.access.mode === "private" ? t("仅自己", "Private") : p.access.mode === "groups" ? t("部分分组", "Groups") : t(`${p.access.userIds?.length ?? 0} 人`, `${p.access.userIds?.length ?? 0} people`)}
            </button>
            <Link prefetch={false} href={`/flow?project=${p.id}`} className="pj-quiet" style={{ ...quiet("#9a9a9a"), height: 26, padding: "0 6px", textDecoration: "none" }}>
              <Icon name="share" size={12} />
              <Tr zh="全部流程" en="Full flow" inZh={zh} />
            </Link>
            {p.canManage ? (
              <>
                <span aria-hidden style={{ width: 1, height: 16, background: "#dedcd6", margin: "0 2px" }} />
                <button type="button" className="pj-quiet" disabled={pending} onClick={() => start(async () => { await setProjectStatusAction(p.id, p.status === "archived" ? "active" : "archived"); router.refresh(); })} style={quiet("#525252")}>
                  {p.status === "archived" ? t("取消归档", "Unarchive") : t("归档", "Archive")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(t("删除这个项目？对话、脚本和视频会从列表里消失。", "Delete this project? Its chat, script and video leave every list."))) return;
                    start(async () => {
                      const r = await deleteProjectAction(p.id);
                      if (r?.error) notify(r.error);
                      else router.push("/projects");
                    });
                  }}
                  className="pj-quiet pj-danger"
                  style={quiet("#c42b2b")}
                >
                  {t("删除", "Delete")}
                </button>
              </>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            {naming ? (
              <form
                style={{ flexGrow: 1, minWidth: 0 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  start(async () => {
                    const r = await renameProjectAction(p.id, name);
                    if (r?.error) notify(r.error);
                    setNaming(false);
                    router.refresh();
                  });
                }}
              >
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setNaming(false)} style={{ fontSize: 24, fontWeight: 600, border: "1px solid #d9d9d9", borderRadius: 8, padding: "2px 8px", width: "100%", fontFamily: "inherit" }} />
              </form>
            ) : (
              <h1 onDoubleClick={() => setNaming(true)} title={t("双击改名", "Double-click to rename")} style={{ fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: "-0.01em", cursor: "text", minWidth: 0 }}>
                {p.title}
              </h1>
            )}
            {/* Published: the green pill with where it went, each mark a link to the post. */}
            {p.status === "done" ? <PublishedPill zh={zh} platforms={p.published?.platforms ?? []} size="md" links /> : <StatusPill status={p.status} zh={zh} />}
          </div>

          {sharing ? (
            <AccessPicker
              title={t("谁可以看到并参与这个项目？", "Who can see and work on this project?")}
              zh={zh}
              initial={p.access.mode === "groups" ? { mode: "groups", groups: p.access.groups ?? [] } : p.access.mode === "people" ? { mode: "people", userIds: p.access.userIds ?? [] } : { mode: p.access.mode }}
              confirm={t("保存", "Save")}
              note={t("对话、脚本和视频都跟着这个设置。五位 AI 员工始终可以参与。", "The chat, script and video follow this. The five AI employees can always take part.")}
              onClose={() => setSharing(false)}
              onConfirm={(choice) =>
                start(async () => {
                  const r = await setProjectAccessAction(p.id, choice as Parameters<typeof setProjectAccessAction>[1]);
                  if (r?.error) notify(r.error);
                  setSharing(false);
                  router.refresh();
                })
              }
            />
          ) : null}

          {/* ---- where it stands ---- */}
          {/* The line, left to right, with the way it goes drawn between steps. */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 22px minmax(0,1fr) 22px minmax(0,1fr) 22px minmax(0,1fr) 22px minmax(0,1fr)", alignItems: "stretch" }}>
            {p.steps.flatMap((s, i) => [
              ...(i ? [<StepArrow key={`a${i}`} live={s.state === "running" || s.state === "you"} done={p.steps[i - 1].state === "done" || p.steps[i - 1].state === "skipped"} />] : []),
              s.key === "deliver" ? (
                /* The last step carries the one press that finishes the
                   project once the cut is out (「已发布 · 标记完成」), and
                   afterwards where it went; its popover opens under it. */
                <div key={s.key} style={{ position: "relative", minWidth: 0, display: "flex" }}>
                  <StepCard
                    step={s}
                    n={i + 1}
                    zh={zh}
                    published={p.status === "done" ? p.published : null}
                    onPublish={p.canPublish && p.status === "active" && s.state === "you" ? () => setPublishing((v) => (v === "step" ? null : "step")) : undefined}
                  />
                  {publishing === "step" ? publishPopover("right") : null}
                </div>
              ) : (
                /* The 剪辑 step types while the film is being made: the
                   director's step or the render's percent, and how long
                   it has been at it. */
                <StepCard key={s.key} step={s} n={i + 1} zh={zh} live={s.key === "edit" ? liveWork : null} />
              ),
            ])}
          </div>

          {/* ---- one line of activity; the whole conversation on demand ---- */}
          <button type="button" onClick={() => setChatOpen(true)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 14px", border: "1px solid #e6e6e6", borderRadius: 12, background: "#fff", cursor: "pointer", font: "inherit", textAlign: "left", minWidth: 0, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, flexShrink: 0, background: anyWorking ? "#278f5e" : "#d9d9d9", animation: anyWorking ? "auraPulse 1.6s ease-in-out infinite" : "none" }} />
            <span style={{ fontSize: 11.5, color: "#999999", flexShrink: 0 }}>{t("动态", "Activity")}</span>
            <span style={{ fontSize: 12.5, color: "#525252", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1 }}>
              {/* The author as a name, translate-proof (`AgentName`): read
                  through Chrome's translate, 撰稿人 is "Writer", not
                  "Contributor". */}
              {lastMsg ? (
                <>
                  {lastMsg.agent ? <AgentName agent={lastMsg.agent} zh={zh} /> : lastMsg.author}
                  {`：${oneLine(lastMsg.body)}`}
                </>
              ) : (
                t("还没有动静", "Nothing yet")
              )}
            </span>
            <span style={{ fontSize: 11.5, color: "#7c7c7c", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="chat" size={12} /> {t(`对话 ${p.messages.length}`, `Chat ${p.messages.length}`)}
            </span>
          </button>

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

          {/* A board of two columns that pack like a puzzle: each card starts
              where the one above it ends, whatever their heights. */}
          <Board>
            {/* ---- topic ---- */}
            {/* Swapping the topic (and, on the script card, using another
                script) is not the employee's work on it, so it is a quiet
                press in the card's header rather than one more framed
                button in the row (where it wrapped onto a line of its own). */}
            <Workbench
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
              <AskBox people={people} zh={zh} placeholder={t("问研究员这个选题…", "Ask the researcher about this topic…")} onSend={(v) => ask("research", v)} disabled={pending} />
              </Disclose>
            </Workbench>

            {/* ---- script ---- */}
            {!skipped("script") ? (
              <Workbench
                icon={<AgentIcon agent="script" size={26} radius={7} />}
                title={t("脚本", "Script")}
                sub={p.beats.length ? t(`${p.beats.length} 个分镜 · ${scriptStatus(p.script?.status ?? "", zh)}`, `${p.beats.length} beats · ${scriptStatus(p.script?.status ?? "", zh)}`) : t("还没写", "Not written yet")}
                right={
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Action quiet icon="pen" label={t("用已有脚本", "Use an existing script")} onClick={() => setPicking("scripts")} disabled={pending} />
                    {p.script ? <Link prefetch={false} href={`/script/${p.script.id}`} style={{ ...btn(false), height: 28, fontSize: 12, textDecoration: "none" }}>{t("编辑器", "Editor")} <Icon name="external" size={11} /></Link> : null}
                  </span>
                }
              >
                {working("script") || draftWriting ? (
                  <Working
                    agent="script"
                    zh={zh}
                    typing={draftWriting ? { label: p.beats.length ? { zh: "正在按选题重写", en: "Rewriting from the topic" } : { zh: "正在写初稿，写好会自动出现在这里", en: "Drafting; it appears here when done" } } : doing("script", "正在写脚本", "Writing the script")}
                  />
                ) : null}
                {p.beats.length ? (
                  <div style={{ border: "1px solid #efefef", borderRadius: 10, overflow: "hidden" }}>
                    {p.beats.slice(0, 5).map((b) => (
                      <div key={b.ord} style={{ display: "grid", gridTemplateColumns: "26px minmax(0,1fr) minmax(0,1.3fr)", gap: 10, padding: "7px 10px", borderTop: b.ord === p.beats[0].ord ? "none" : "1px solid #f3f3f3", fontSize: 12.5, lineHeight: 1.5 }}>
                        <span style={{ color: "#b3b3b3", fontVariantNumeric: "tabular-nums" }}>{b.ord}</span>
                        <span style={{ color: "#7c7c7c", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{b.visual || "—"}</span>
                        <span style={{ color: "#171717", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{b.voiceover || "—"}</span>
                      </div>
                    ))}
                    <button type="button" onClick={() => setPopup({ title: t("脚本全文", "The whole script"), body: <BeatsTable beats={p.beats} zh={zh} /> })} style={{ width: "100%", border: 0, borderTop: "1px solid #f3f3f3", background: "#fafafa", padding: "7px", fontFamily: "inherit", fontSize: 12, color: "#525252", cursor: "pointer" }}>
                      {t(`查看全部 ${p.beats.length} 个分镜`, `See all ${p.beats.length} beats`)}
                    </button>
                  </div>
                ) : !working("script") && !draftWriting ? (
                  videoMade ? (
                    /* Cut straight from the host's talk: nothing is missing. */
                    <p style={{ margin: 0, fontSize: 12.5, color: "#7c7c7c", lineHeight: 1.6 }}>{t("这条是按口播直接剪的，没有分镜脚本。", "This one was cut straight from the host's talk; there is no beat script.")}</p>
                  ) : (
                    <Empty text={t("还没有分镜。让编剧写初稿，或在下面说要什么。", "No beats yet. Ask the writer for a draft, or say what you want below.")} />
                  )
                ) : null}
                {/* An owner or admin OKs the script here in one small press — the
                    long way (ask someone, a checklist, "not your own version")
                    was more than "yes, it works" needed. Others still go to the
                    script's approval tab. */}
                {canApprove && p.script && p.beats.length > 0 && p.script.status !== "locked" && !draftWriting ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await approveNowAction(p.script!.id);
                        setApproveError(r && "error" in r && r.error ? r.error : null);
                        router.refresh();
                      })
                    }
                    title={t("批准并锁定这一版，交给剪辑师", "Approve and lock this version; it goes to the editor")}
                    style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 10px", borderRadius: 8, border: "1px solid #cbe9d8", background: "#f2faf6", color: "#1e7a4f", fontFamily: "inherit", fontSize: 12, fontWeight: 500, cursor: "pointer" }}
                  >
                    <Icon name="check" size={12} /> {t("脚本可以了", "Script looks good")}
                  </button>
                ) : null}
                {approveError ? <div style={{ marginTop: 6, fontSize: 11.5, color: "#c0392b" }}>{approveError}</div> : null}
                {!canApprove && p.script?.status === "awaiting_approval" ? (
                  <Link prefetch={false} href={`/script/${p.script.id}?tab=approval`} style={{ ...btn(true), textDecoration: "none", marginTop: 10 }}>
                    {t("去批准", "Review and approve")} <Icon name="external" size={11} />
                  </Link>
                ) : null}
                <Disclose zh={zh} on={(videoMade && !p.beats.length) || scriptDone} label={p.beats.length ? <Tr zh="改脚本" en="Revise the script" inZh={zh} /> : <Tr zh="写一版脚本" en="Write a script" inZh={zh} />}>
                <Actions>
                  {/* Straight to the writer with the topic's facts (not a chat
                      message it has to interpret): the draft is written after
                      the response and lands on this card. */}
                  <Action primary={!p.beats.length} icon="pen" label={p.beats.length ? t("按选题重写", "Rewrite from the topic") : t("写初稿", "Write the draft")} onClick={writeDraft} disabled={pending || draftWriting || p.script?.status === "locked" || !p.script} />
                  <Action icon="scissors" label={t("改到 60 秒", "Cut to 60s")} onClick={() => ask("script", t("把项目脚本改到 60 秒以内，保留最有力的三点，写回项目脚本。", "Cut the project's script to under 60 seconds, keeping the three strongest points; write it back."))} disabled={pending || !p.beats.length || p.script?.status === "locked"} />
                  <Action icon="spark" label={t("加强开头", "Stronger hook")} onClick={() => ask("script", t("把项目脚本的开头改得更抓人，前 3 秒给出冲突或数字，写回项目脚本。", "Make the opening grab harder: a conflict or a number in the first 3 seconds; write it back."))} disabled={pending || !p.beats.length || p.script?.status === "locked"} />
                  <Action icon="check" label={t("核查事实", "Fact-check")} onClick={() => ask("research", t("核查这个项目脚本里的每个数字和说法，列出需要改的地方和来源。", "Fact-check every number and claim in this project's script; list what to change, with sources."))} disabled={pending || !p.beats.length} />
                </Actions>
                <AskBox people={people} zh={zh} placeholder={t("告诉编剧怎么写或怎么改…", "Tell the writer what to write or change…")} onSend={(v) => ask("script", `${v}（写进项目脚本）`)} disabled={pending || p.script?.status === "locked"} />
                </Disclose>
              </Workbench>
            ) : null}

            {/* ---- clips ---- */}
            {!skipped("clips") ? (
              <Workbench
                anchor="clips"
                icon={<span style={{ width: 26, height: 26, borderRadius: 7, background: "#171717", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="clapper" size={15} /></span>}
                title={t("素材", "Clips")}
                sub={p.video ? t(`${p.video.clips} 段 · 时间线 ${p.video.items} 段`, `${p.video.clips} clips · ${p.video.items} on the timeline`) : "—"}
                right={p.video ? <Link prefetch={false} href={`/video?project=${p.video.id}`} style={{ ...btn(false), height: 28, fontSize: 12, textDecoration: "none" }}>{t("剪辑台", "Editor")} <Icon name="external" size={11} /></Link> : null}
              >
                {p.clipList.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, marginBottom: 10 }}>
                    {p.clipList.map((c) => (
                      <div key={c.id} title={c.label} style={{ borderRadius: 9, overflow: "hidden", border: "1px solid #ececec", background: "#111", position: "relative" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/files/${c.fileId}/thumb`} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover", display: "block" }} />
                        {c.durationMs ? <span style={{ position: "absolute", right: 5, bottom: 5, fontSize: 10.5, color: "#fff", background: "rgba(0,0,0,.6)", borderRadius: 4, padding: "0 5px", fontVariantNumeric: "tabular-nums" }}>{clock(c.durationMs)}</span> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {/* Outside the fold: 「再传」 on the next-step box clicks it. */}
                <input ref={fileInput} id={`pj-upload-${p.id}`} type="file" multiple accept="video/*,audio/*,image/*" style={{ display: "none" }} onChange={(e) => {
                  if (e.target.files?.length) void upload(e.target.files);
                  e.target.value = "";
                }} />
                <Disclose zh={zh} on={hasCut} label={<Tr zh="添加素材" en="Add clips" inZh={zh} />}>
                <label htmlFor={`pj-upload-${p.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", border: "1.5px dashed #9fb8e8", borderRadius: 12, background: "#f5f8fe", cursor: "pointer" }}>
                  <span style={{ color: "#0f5bd5", display: "flex" }}><Icon name="upload" size={20} /></span>
                  <span style={{ flexGrow: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{t("添加主持人的素材", "Add the host's clips")}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "#525252", marginTop: 2 }}>{t("上传后自动进时间线并转写。", "They go onto the timeline and are transcribed.")}</span>
                  </span>
                  {/* White: the whole dashed box is the press, and a black
                      block in it made the card's loudest thing a label. */}
                  <span style={{ ...btn(false), height: 30, fontSize: 12, borderColor: "#c9d8f3", color: "#0f5bd5" }}>{t("选择文件", "Choose files")}</span>
                </label>
                <Actions>
                  <Action icon="film" label={t("从已上传的素材里选", "Choose from uploaded clips")} onClick={() => setPicking("clips")} disabled={pending} />
                </Actions>
                {hasCut ? <AskBox people={people} zh={zh} placeholder={t("描述想从素材库找的画面，例如：交易屏幕、香港夜景…", "Describe stock shots to find, e.g. trading screens, Hong Kong at night…")} onSend={(v) => ask("video", `从素材库找这类画面放进项目素材箱：${v}`)} disabled={pending} /> : null}
                </Disclose>
                {/* Clips in, and no film being made or out of them yet: the
                    next press is here, on the card the clips landed on —
                    loud right after an upload — with 传完自动开始剪 beside
                    it (`ClipsNextStep`). Once the director has cut, the
                    video card's render button is the next press instead —
                    unless more clips landed with 传完自动开始剪 on and its
                    minute is counting: the countdown and its 取消 stay here. */}
                {p.video && p.video.clips > 0 && !busyLive && !retrying && ((!rendered && p.director?.state !== "done") || armed) ? (
                  <ClipsNextStep
                    zh={zh}
                    clips={p.video.clips}
                    hasBeats={p.beats.length > 0}
                    justLanded={justLanded}
                    retry={p.director?.state === "failed" || p.render?.state === "failed"}
                    autoCut={p.autoCut}
                    starting={busyAction === "cut"}
                    disabled={pending || busyAction !== null}
                    onStart={startCut}
                    onMore={() => fileInput.current?.click()}
                    onToggleAuto={toggleAutoCut}
                    onStartNow={startCut}
                    onCancelAuto={cancelAutoCut}
                  />
                ) : null}
                {p.video && p.video.clips === 0 && p.beats.length > 0 ? (
                  <p style={{ margin: "10px 0 0", fontSize: 12, color: "#7c6a3a", lineHeight: 1.55 }}>
                    {t("剪辑师在等主持人的素材：传上来会自动转写，然后按脚本分段粗剪。", "The editor is waiting for the host's clips: they are transcribed as they land, then cut by the script's sections.")}
                  </p>
                ) : null}
                {working("video") && !renderLive ? <Working agent="video" zh={zh} typing={doing("video", "正在找画面", "Finding footage")} /> : null}
                {hasCut ? null : <AskBox people={people} zh={zh} placeholder={t("描述想从素材库找的画面，例如：交易屏幕、香港夜景…", "Describe stock shots to find, e.g. trading screens, Hong Kong at night…")} onSend={(v) => ask("video", `从素材库找这类画面放进项目素材箱：${v}`)} disabled={pending} />}
              </Workbench>
            ) : null}

            {/* ---- the video ----
                The card says where the film is at every moment, and offers
                the one press that moves it on: the director typing its step
                while it cuts; "剪辑完成，还没渲染" with 渲染 in black once it
                has (this used to read "还没有成片" for ever); a progress bar
                with the minutes left while it renders; the player, 下载 and
                分享 once it is out (making it again folds into a quiet 重做;
                「已发布 · 标记完成」 is the step-5 card's); what went wrong,
                and 重试 in black, when it did not. */}
            <Workbench
              icon={<AgentIcon agent="video" size={26} radius={7} />}
              title={t("成片", "The video")}
              sub={
                rendered
                  ? t(`已渲染 · ${[p.render?.aspect, p.render?.durationMs ? videoClock(p.render.durationMs) : null].filter(Boolean).join(" · ")}`, `Rendered · ${[p.render?.aspect, p.render?.durationMs ? videoClock(p.render.durationMs) : null].filter(Boolean).join(" · ")}`)
                  : directing
                    ? t(`剪辑师正在${directorStepLabel(p.director?.step ?? null, true)}`, `The editor is ${directorStepLabel(p.director?.step ?? null, false)}`)
                    : renderLive
                      ? p.render?.state === "queued"
                        ? t("排队渲染", "Queued to render")
                        : t(`渲染中 ${pct}%`, `Rendering ${pct}%`)
                      : cutReady
                        ? t(`剪辑完成 · ${p.video?.items ?? 0} 段${p.video?.graphics ? ` · ${p.video.graphics} 个图形` : ""} · 待渲染`, `Cut done · ${p.video?.items ?? 0} pieces${p.video?.graphics ? ` · ${p.video.graphics} graphics` : ""} · not rendered yet`)
                        : t("还没有成片", "Nothing rendered yet")
              }
              right={
                <span style={{ display: "flex", gap: 6 }}>
                  {p.video ? <Link prefetch={false} href={`/video?project=${p.video.id}`} style={{ ...btn(false), height: 28, fontSize: 12, textDecoration: "none" }}>{t("在剪辑台打开", "Open in the editor")} <Icon name="external" size={11} /></Link> : null}
                </span>
              }
            >
              {directing ? (
                /* The director at work, typing like every other employee:
                   its step, the render's percent once it is rendering, how
                   long it has been at it, and its last word. */
                <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 12, background: "#f7f8fb", border: "1px solid #eef0f5" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <AgentTyping agent="video" zh={zh} name label={liveWork?.label} percent={liveWork?.percent ?? null} />
                    <Elapsed since={p.director?.startedAt ?? null} zh={zh} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#7c7c7c", lineHeight: 1.5 }}>
                    <span style={{ minWidth: 0 }}>{p.director?.note ?? p.director?.lastLog ?? t("转写、粗剪、配图形，最后渲染。做完会直接出现在这里。", "Transcribe, cut, design, then render. It lands right here when done.")}</span>
                  </div>
                </div>
              ) : p.director?.state === "failed" && p.director.error && !rendered && !cutReady ? (
                <div style={{ padding: "10px 12px", borderRadius: 12, background: "#fdf3f2", border: "1px solid #f6d5d1", marginBottom: 10 }}>
                  <div style={{ fontSize: 12.5, color: "#a3281c", lineHeight: 1.55 }}>
                    {/no words|no sound|transcribe|转写|声音/i.test(p.director.error)
                      ? hasNarration
                        ? t("素材里没有人说话。可以用脚本的旁白做 AI 配音，按配音剪成片。", "There is no speech in the footage. The script's narration can be voiced and the video cut to it.")
                        : t("素材里没有人说话，导演没法按口播剪。可以直接用这些画面拼成片。", "There is no speech in the footage, so the director cannot cut on it. The shots can be put together directly instead.")
                      : `${t("上次没做成：", "Last try stopped: ")}${p.director.error}`}
                  </div>
                  <button type="button" disabled={busyAction !== null} onClick={() => runTool("assemble", t("用画面拼成片", "build from the shots"), async () => { const r = await fetch(`/api/projects/${p.id}/one-go`, { method: "POST", headers: { "content-type": "application/json" }, body: oneGoBody({ way: "assemble" }) }); const j = (await r.json().catch(() => ({}))) as { error?: string }; return r.ok ? {} : { error: j.error ?? t("没能开始", "Could not start") }; })} style={{ ...btn(true), height: 30, fontSize: 12, marginTop: 8 }}>
                    <Icon name="film" size={13} /> {hasNarration ? t("用旁白配音，按配音剪成片", "Voice the narration and cut to it") : t("用这些画面直接拼成片", "Build it from the shots instead")}
                  </button>
                </div>
              ) : null}

              {renderLive && !directing ? (
                /* Encoding: the bar, the percent, and about how long is
                   left, worked out from how fast it has gone so far. */
                <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 12, background: "#f7f8fb", border: "1px solid #eef0f5" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <AgentTyping agent="video" zh={zh} name step={liveWork?.step} label={liveWork?.label} percent={liveWork?.percent ?? null} />
                    <Elapsed since={p.render?.startedAt ?? null} zh={zh} />
                  </div>
                  <div aria-hidden style={{ height: 6, borderRadius: 3, background: "#e3e6ee", overflow: "hidden", marginTop: 10 }}>
                    <div style={{ height: "100%", width: `${Math.max(2, pct)}%`, borderRadius: 3, background: "linear-gradient(90deg,#278f5e,#0f5bd5)", transition: "width .6s ease" }} />
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 7, fontSize: 12, color: "#7c7c7c", flexWrap: "wrap" }}>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{p.render?.aspect} · {pct}%</span>
                    <RenderEta render={p.render} zh={zh} />
                    <span style={{ marginLeft: "auto" }}>{t("完成后会直接在这里播放", "It plays right here when done")}</span>
                  </div>
                </div>
              ) : null}

              {rendered && p.render ? (
                /* The film, in place: the 480p copy plays (the master when
                   there is none, or it will not), the master downloads. */
                <div style={{ marginBottom: 12 }}>
                  <RenderPlayer render={p.render} zh={zh} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#7c7c7c", flexWrap: "wrap" }}>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {[p.render.aspect, p.render.durationMs ? videoClock(p.render.durationMs) : null, p.render.sizeBytes ? videoBytes(p.render.sizeBytes) : null].filter(Boolean).join(" · ")}
                      {p.render.proxyFileId ? ` · ${t("预览画质，下载的是原片", "preview quality; the download is the full file")}` : ""}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", position: "relative" }}>
                    <a href={`/api/files/${rendered}/download?download=1`} style={{ ...btn(true), height: 32, textDecoration: "none" }}>
                      <Icon name="download" size={13} />
                      {t("下载", "Download")}
                    </a>
                    {p.video ? (
                      <Link prefetch={false} href={`/video?project=${p.video.id}`} style={{ ...btn(false), height: 32, textDecoration: "none" }}>
                        <Icon name="scissors" size={13} />
                        {t("在剪辑台打开", "Open in the editor")}
                      </Link>
                    ) : null}
                    {/* The file's own page holds its sharing sheet (who may
                        open it), which is what a link to send around means
                        here: every open is checked and audited there. */}
                    <Link prefetch={false} href={`/files/${rendered}`} style={{ ...btn(false), height: 32, textDecoration: "none" }}>
                      <Icon name="share" size={13} />
                      {t("分享链接", "Share")}
                    </Link>
                    {p.render.subtitleFileId ? (
                      <a href={`/api/files/${p.render.subtitleFileId}/download?download=1`} style={{ ...btn(false), height: 32, textDecoration: "none" }}>
                        SRT
                      </a>
                    ) : null}
                    {/* 「已发布 · 标记完成」 lives on the step-5 card only. */}
                  </div>
                </div>
              ) : null}

              {renderFailed && p.render ? (
                /* What went wrong, in the studio's words, and the same
                   render again. */
                <div style={{ padding: "10px 12px", borderRadius: 12, background: "#fdf3f2", border: "1px solid #f6d5d1", marginBottom: 12 }}>
                  <div style={{ fontSize: 12.5, color: "#a3281c", lineHeight: 1.55, overflowWrap: "anywhere" }}>
                    {t("渲染没成功", "The render failed")}
                    {p.render.error ? `：${p.render.error.slice(0, 240)}` : "。"}
                  </div>
                  <button type="button" disabled={busyAction !== null || !p.video?.items} onClick={() => render(p.render?.aspect === "16:9" ? "16:9" : "9:16")} style={{ ...btn(true), height: 30, fontSize: 12, marginTop: 8 }}>
                    <Icon name="undo" size={13} /> {t(`重试 · 渲染 ${p.render.aspect}`, `Try again · render ${p.render.aspect}`)}
                  </button>
                </div>
              ) : null}

              {cutReady && !renderFailed ? (
                /* The cut is there and nothing has been rendered from it:
                   the one press that is missing, in black. */
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: "#fafaf9", border: "1px solid #ececea", marginBottom: 12, flexWrap: "wrap" }}>
                  <span style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                      {p.director?.state === "done" ? t("剪辑完成，还没渲染成片", "The cut is done; nothing rendered yet") : t("时间线上有剪辑，还没渲染成片", "There is a cut on the timeline; nothing rendered yet")}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: "#7c7c7c", marginTop: 2, lineHeight: 1.5 }}>
                      {t(`${p.video?.items ?? 0} 段${p.video?.graphics ? `、${p.video.graphics} 个图形` : ""}${burnCaptions ? "、字幕压进画面" : ""}。按渲染出成片，几分钟；好了会在这里播放。`, `${p.video?.items ?? 0} pieces${p.video?.graphics ? `, ${p.video.graphics} graphics` : ""}${burnCaptions ? ", captions burnt in" : ""}. Press render for the film; it takes minutes and plays here when done.`)}
                    </span>
                    {/* The director stopped part-way through this cut (the
                        step says "看成片卡"): what stopped it, here, so the
                        owner can decide whether to render what is there or
                        ask 剪辑师 again. */}
                    {p.director?.state === "failed" && p.director.error ? (
                      <span style={{ display: "block", fontSize: 11.5, color: "#a3281c", marginTop: 6, lineHeight: 1.5, overflowWrap: "anywhere" }}>
                        {t("剪辑师上次没做完：", "The editor stopped last time: ")}
                        {p.director.error.slice(0, 240)}
                      </span>
                    ) : null}
                  </span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => render("9:16")} disabled={busyAction !== null || pending} style={{ ...btn(true), height: 34, opacity: busyAction ? 0.6 : 1 }}>
                      <Icon name="play" size={13} />
                      {busyAction === "r916" ? t("开始中…", "Starting…") : t("渲染 9:16", "Render 9:16")}
                    </button>
                    <button type="button" onClick={() => render("16:9")} disabled={busyAction !== null || pending} style={{ ...btn(false), height: 34, opacity: busyAction ? 0.6 : 1 }}>
                      {busyAction === "r169" ? t("开始中…", "Starting…") : t("渲染 16:9", "Render 16:9")}
                    </button>
                    {p.video ? (
                      <Link prefetch={false} href={`/video?project=${p.video.id}`} className="pj-quiet" style={{ ...quiet("#525252"), height: 34, textDecoration: "none" }}>
                        {t("在剪辑台打开", "Open in the editor")}
                      </Link>
                    ) : null}
                  </span>
                </div>
              ) : null}

              {/* The narration the director (or the editor) made: listen to it here. */}
              {p.narration && !directing ? (
                p.narration.state === "ready" && p.narration.fileId ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: "#f6f7fb", border: "1px solid #e7e9f2", marginBottom: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "#404040", fontWeight: 500 }}>
                      {t("AI 配音", "AI voice-over")} · {voiceLabel(p.narration.voiceId, zh, voices.map((v) => ({ id: v.id, name: zh ? v.name.zh : v.name.en })))}
                      {p.narration.durationMs ? ` · ${clock(p.narration.durationMs)}` : ""}
                    </span>
                    <audio controls preload="none" src={`/api/files/${p.narration.fileId}/download`} style={{ height: 30, flexGrow: 1, minWidth: 200 }} />
                  </div>
                ) : p.narration.state === "pending" || p.narration.state === "speaking" ? (
                  <div style={{ marginBottom: 10 }}>
                    <AgentTyping agent="video" zh={zh} name label={{ zh: "正在配音", en: "Voicing the narration" }} />
                  </div>
                ) : null
              ) : null}
              <Disclose zh={zh} on={Boolean(rendered)} label={<Tr zh="重做" en="Redo" inZh={zh} />}>
              {showVoiceBox ? (<>
              {/* AI 配音: the script's 旁白 read by one of the studio's voices, the cut timed to it. */}
              <div style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #ececec", background: aiVoice ? "#fafafa" : "#ffffff", marginBottom: 10 }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: hasNarration ? "pointer" : "default" }}>
                  <input type="checkbox" checked={aiVoice} disabled={!hasNarration || voices.length === 0} onChange={(e) => setAiVoice(e.target.checked)} style={{ marginTop: 3, accentColor: "#171717" }} />
                  <span style={{ flexGrow: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#171717" }}>{t("AI 配音", "AI voice-over")}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "#7c7c7c", marginTop: 2, lineHeight: 1.55 }}>
                      {!hasNarration
                        ? t("脚本还没有旁白。写好旁白后，可以用它生成配音。", "The script has no narration yet. Once it does, it can be voiced.")
                        : voices.length === 0
                          ? t("本服务器上暂无可用的语音引擎。", "No speech engine is available on this server.")
                          : aiVoice
                            ? t("用脚本旁白生成配音，按配音的节奏剪辑，字幕跟着配音走。", "The script's narration is voiced, the cut follows its rhythm, and the captions follow the voice.")
                            : t("不勾选时：素材里没有人声（比如素材库画面）会自动用旁白配音。", "Unticked: footage with no speech (stock shots, say) is voiced from the narration automatically.")}
                    </span>
                  </span>
                </label>
                {aiVoice || (!p.video?.clips && hasNarration) ? (
                  <div style={{ marginTop: 10 }}>
                    <VoicePicker voices={voices} value={voiceId} onChange={setVoiceId} zh={zh} compact />
                  </div>
                ) : null}
              </div>
              </>) : null}
              <textarea value={videoPrompt} onChange={(e) => setVideoPrompt(e.target.value)} rows={3} placeholder={t("描述你要的成片：长度、节奏、画面、字幕…", "Describe the video: length, pace, shots, captions…")} style={{ width: "100%", border: "1px solid #e2e2e2", borderRadius: 10, padding: "9px 11px", fontFamily: "inherit", fontSize: 13, lineHeight: 1.55, resize: "vertical", outline: "none", boxSizing: "border-box" }} />
              {/* Held while the director or a render runs, each saying what
                  is running, so nobody starts a second film over the first. */}
              <Actions>
                {/* Black only while it is the next press: with clips in, the
                    clips card's 「开始剪」 is; with a cut, 渲染; with a film, nothing. */}
                <Action primary={!rendered && !cutReady && !p.video?.clips} icon="spark" label={busyAction === "direct" ? t("开始中…", "Starting…") : directing ? t("剪辑师正在剪…", "The editor is cutting…") : renderLive ? renderingLabel : t("按描述一键成片", "Make it from this")} onClick={() => runTool("direct", t("一键成片", "one-go video"), async () => { const r = await fetch(`/api/projects/${p.id}/one-go`, { method: "POST", headers: { "content-type": "application/json" }, body: oneGoBody() }); const j = (await r.json().catch(() => ({}))) as { error?: string }; return r.ok ? {} : { error: j.error ?? t("没能开始", "Could not start") }; })} disabled={pending || busyLive || !videoPrompt.trim()} />
                <Action icon="scissors" label={directing ? t("剪辑中…", "Cutting…") : t("自动粗剪", "Auto rough cut")} onClick={() => p.video && runTool("autoedit", t("自动粗剪", "auto rough cut"), () => autoEditAction(p.video!.id, zh ? "zh-CN" : "en"))} disabled={pending || busyLive || !p.video?.clips} />
                {/* Rendered already: the same cut again, or the other shape.
                    Not rendered: the render buttons are the panel above. */}
                {rendered ? (
                  <>
                    <Action icon="play" label={t("再渲染 9:16", "Render 9:16 again")} onClick={() => render("9:16")} disabled={pending || busyLive || !p.video?.items} />
                    <Action icon="play" label={t("再渲染 16:9", "Render 16:9 again")} onClick={() => render("16:9")} disabled={pending || busyLive || !p.video?.items} />
                  </>
                ) : busyLive ? (
                  <Action icon="play" label={directing ? t("渲染 · 等剪辑完", "Render · after the cut") : renderingLabel} onClick={() => undefined} disabled />
                ) : null}
              </Actions>
              {rendered ? (
                <Actions>
                  <Action icon="scissors" label={t("再短一点", "Shorter")} onClick={() => ask("video", t("再短一点，节奏快一些，重新渲染。", "Make it shorter and tighter, and render again."))} disabled={pending} />
                  <Action icon="spark" label={t("换开头", "New opening")} onClick={() => ask("video", t("换一个更抓人的开头，重新渲染。", "Try a stronger opening, and render again."))} disabled={pending} />
                </Actions>
              ) : null}
              </Disclose>
              <AgentOutput agent="video" msg={latest("video")} working={working("video") && !busyLive} typing={doing("video", "正在剪辑", "Editing")} zh={zh} compact onOpen={(m) => setPopup({ title: t("剪辑师说", "The video agent says"), body: <Body text={m.body} /> })} />
            </Workbench>

            {/* ---- captions & delivery ---- */}
            <Workbench icon={<AgentIcon agent="article" size={26} radius={7} />} title={t("文案与交付", "Captions & delivery")} sub={p.status === "done" ? t("已发布", "Published") : t("标题、简介、标签", "Titles, descriptions, tags")}>
              <Delivery
                project={p}
                zh={zh}
                rendered={Boolean(rendered)}
                open={publishing === "card"}
                onToggle={() => setPublishing((v) => (v === "card" ? null : "card"))}
                popover={publishPopover}
                onUndo={undoPublish}
                disabled={pending}
              />
              <AgentOutput agent="article" msg={latest("article")} working={working("article")} typing={doing("article", "正在写稿", "Writing")} zh={zh} copyable onOpen={(m) => setPopup({ title: t("文案", "Copy"), body: <Body text={m.body} copy /> })} />
              <Disclose zh={zh} on={copyDone} label={<Tr zh="再写文案" en="More copy" inZh={zh} />}>
              <Actions>
                {/* Framed, not black: the one loud press at this point is the
                    step-5 card's 「已发布 · 标记完成」. */}
                <Action icon="pen" label={t("写各平台文案", "Platform copy")} onClick={() => ask("article", t("为这个项目写 YouTube、小红书、抖音、微博的标题、简介和标签，各一版。", "Write titles, descriptions and tags for YouTube, Rednote, Douyin and Weibo for this project."))} disabled={pending} />
                <Action icon="bulb" label={t("封面标题", "Thumbnail lines")} onClick={() => ask("article", t("给这个项目 5 个封面大字标题，每个不超过 10 个字。", "Give 5 thumbnail headlines for this project, 10 characters or fewer each."))} disabled={pending} />
                <Action icon="comment" label={t("置顶评论", "Pinned comment")} onClick={() => ask("article", t("写一条引导讨论的置顶评论。", "Write a pinned comment that starts a discussion."))} disabled={pending} />
                {/* 「标记交付」 was a bare status toggle here; marking it done
                    is now 「已发布 · 标记完成」 above, which also keeps where
                    it went. */}
              </Actions>
              <AskBox people={people} zh={zh} placeholder={t("文案要求，例如：更口语、加 3 个话题标签…", "What the copy should be, e.g. more casual, add 3 hashtags…")} onSend={(v) => ask("article", v)} disabled={pending} />
              </Disclose>
            </Workbench>
          </Board>
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
 * Cards in two columns, dealt alternately (left, right, left…), each column
 * stacking its cards with no gaps; one column on a narrow screen.
 */
function Board({ children }: { children: React.ReactNode }) {
  const cards = React.Children.toArray(children).filter(Boolean);
  const left = cards.filter((_, i) => i % 2 === 0);
  const right = cards.filter((_, i) => i % 2 === 1);
  return (
    <div className="pboard" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>{left}</div>
      <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>{right}</div>
      <style dangerouslySetInnerHTML={{ __html: `@media (max-width: 980px) { .pboard { flex-direction: column; } .pboard > div { width: 100%; } }` }} />
    </div>
  );
}

/**
 * One card. `anchor` makes it a place a link can open at — 剪辑师's "上传素材"
 * goes to `/projects/<id>#clips` — and the card is outlined for a moment when
 * it is the one opened (`:target` in `PROJECT_CSS`).
 */
function Workbench({ icon, title, sub, right, children, anchor }: { icon: React.ReactNode; title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; anchor?: string }) {
  return (
    <section id={anchor} className={anchor ? "pj-card" : undefined} style={{ background: "#fff", border: "1px solid #e2e2e2", borderRadius: 14, padding: "14px 16px 16px", minWidth: 0, boxShadow: "0 1px 2px rgba(0,0,0,0.03)", scrollMarginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, minWidth: 0 }}>
        {icon}
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</span>
        {sub ? <span style={{ fontSize: 12, color: "#999999", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span> : null}
        <span style={{ flexGrow: 1 }} />
        {right}
      </div>
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
        <button type="button" className="pj-quiet" data-disclose="" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={open ? (zh ? "收起" : "Collapse") : undefined} style={{ ...quiet("#8a8a8a"), height: 26, padding: "0 8px", marginLeft: -8, gap: 4 }}>
          {label}
          <span aria-hidden style={{ fontSize: 10, lineHeight: 1 }}>{open ? "\u25B4" : "\u25BE"}</span>
        </button>
      </div>
      {open ? children : null}
    </>
  );
}

/** A box to say something to the card's employee, with the @ picker. */
function AskBox({ people, zh, placeholder, onSend, disabled }: { people: MentionPerson[]; zh: boolean; placeholder: string; onSend: (text: string) => void; disabled?: boolean }) {
  const [draft, setDraft] = React.useState("");
  const box = React.useRef<HTMLTextAreaElement | null>(null);
  const mentions = useMentions({ people, zh, draft, setDraft, box });
  const send = () => {
    const v = draft.trim();
    if (!v || disabled) return;
    onSend(v);
    setDraft("");
  };
  return (
    <div style={{ position: "relative", display: "flex", gap: 6, marginTop: 10, alignItems: "flex-end" }}>
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
        style={{ flexGrow: 1, minWidth: 0, minHeight: 34, border: "1px solid #e2e2e2", borderRadius: 10, padding: "8px 11px", outline: "none", resize: "none", fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.45, background: "#fcfcfc", boxSizing: "border-box" }}
      />
      {/* Light grey until there is something to send, as Home's 开工 is;
          a 40% black block beside every empty box read as a grey slab. */}
      <button
        type="button"
        onClick={send}
        disabled={disabled || !draft.trim()}
        style={draft.trim() ? { ...btn(true), height: 34, borderRadius: 10, opacity: disabled ? 0.5 : 1 } : { ...btn(false), height: 34, borderRadius: 10, background: "#f0f0ee", borderColor: "#f0f0ee", color: "#a3a3a3", cursor: "default" }}
      >
        <Icon name="upload" size={13} style={{ transform: "rotate(90deg)" }} />
      </button>
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

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12.5, color: "#999999", padding: "14px 12px", border: "1px dashed #e2e2e2", borderRadius: 10, textAlign: "center" }}>{text}</div>;
}

function BeatsTable({ beats, zh }: { beats: ProjectDetail["beats"]; zh: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 1.4fr", gap: 12, padding: "6px 0", fontSize: 11.5, color: "#999999", borderBottom: "1px solid #eee" }}>
        <span>#</span>
        <span>{zh ? "画面" : "On screen"}</span>
        <span>{zh ? "口播" : "Said"}</span>
      </div>
      {beats.map((b) => (
        <div key={b.ord} style={{ display: "grid", gridTemplateColumns: "30px 1fr 1.4fr", gap: 12, padding: "9px 0", borderBottom: "1px solid #f3f3f3", fontSize: 13, lineHeight: 1.6 }}>
          <span style={{ color: "#b3b3b3" }}>{b.ord}</span>
          <span style={{ color: "#525252" }}>{b.visual}</span>
          <span>{b.voiceover}</span>
        </div>
      ))}
    </div>
  );
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
  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId, working]);
  const say = (text: string) =>
    start(async () => {
      const res = await sendChannelMessage(p.channel.slug, text);
      if (res?.error) notify(res.error);
      if (parseAgentMentions(text).length || ("answering" in (res ?? {}) && (res as { answering?: string }).answering)) {
        const until = Date.now() + 120_000;
        const id = setInterval(() => (Date.now() > until ? clearInterval(id) : router.refresh()), 4000);
      }
      router.refresh();
    });
  return (
    <aside style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 420, background: "#fff", borderLeft: "1px solid #e6e6e6", boxShadow: "-12px 0 40px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", zIndex: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 12px 16px", borderBottom: "1px solid #f0f0f0" }}>
        <Icon name="chat" size={15} />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("项目对话", "Project chat")}</span>
        <span style={{ fontSize: 12, color: "#a3a3a3", flexGrow: 1 }}>{p.messages.length}</span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 18, color: "#999999" }}>
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
                  {clean(m.body)}
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

function StepArrow({ live, done }: { live: boolean; done: boolean }) {
  const color = live ? "#0f5bd5" : done ? "#278f5e" : "#c9c6c0";
  return (
    <div aria-hidden style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg viewBox="0 0 22 12" style={{ width: 20, height: 12 }}>
        <path d="M1 6h17" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeDasharray={live || done ? undefined : "3 3"} />
        <path d="M14 2l5 4-5 4" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/**
 * One step in the row. The delivery step also takes `onPublish` (the white
 * 「已发布 · 标记完成」 press inside its black "your turn" card) and
 * `published` (once marked: a green card, the date, and the platforms' marks,
 * each a link to the post).
 */
function StepCard({ step: s, n, zh, published = null, onPublish, live = null }: { step: ProjectStep; n: number; zh: boolean; published?: Publication | null; onPublish?: () => void; live?: LiveWork | null }) {
  const you = s.owner === "you";
  const color = you ? "#171717" : AGENT_COLORS[s.owner as AgentKey];
  const isPublished = s.key === "deliver" && s.state === "done";
  const frame: React.CSSProperties = isPublished
    ? { border: `1px solid ${PUBLISHED_TONE.line}`, background: "#f3fbf6" }
    : s.state === "you"
      ? { background: "#171717", color: "#fff", border: "1px solid #171717" }
      : s.state === "running"
        ? { border: "1px solid transparent", background: "linear-gradient(#fff,#fff) padding-box, linear-gradient(135deg,#278f5e,#0f5bd5) border-box" }
        : s.state === "skipped"
          ? { border: "1px dashed #e6e6e6", background: "repeating-linear-gradient(135deg,#fafaf9 0 8px,#f3f3f1 8px 16px)", opacity: 0.7 }
          : s.state === "todo"
            ? { border: "1px dashed #d9d9d9", background: "#fbfbfa" }
            : { border: "1px solid #e2e2e2", background: "#fff" };
  const dim = s.state === "todo" || s.state === "skipped";
  /* The step's name is the card's title now (12.5, dark), its number a quiet
     prefix; it was all one 11px grey caption, the same weight as the line
     under it, so five cards read as five grey smudges. */
  return (
    <div style={{ ...frame, borderRadius: 12, padding: "10px 12px", minWidth: 0, flexGrow: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ opacity: dim ? 0.5 : 1, display: "flex", flexShrink: 0 }}>
          <AgentIcon agent={you ? null : (s.owner as AgentKey)} size={22} radius={6} />
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3, color: s.state === "you" ? "#fff" : dim ? "#a3a3a3" : "#171717", minWidth: 0, overflowWrap: "anywhere" }}>
          <span style={{ fontWeight: 500, color: s.state === "you" ? "#8a8a8a" : "#b3b3b3", marginRight: 5, fontVariantNumeric: "tabular-nums" }}>{n}</span>
          {s.label}
        </span>
        {isPublished ? (
          <span style={{ marginLeft: "auto", display: "flex", flexShrink: 0 }}>
            <PublishedCheck size={15} />
          </span>
        ) : s.state === "done" ? (
          <span style={{ marginLeft: "auto", color: "#278f5e", display: "flex", flexShrink: 0 }}>
            <Icon name="check" size={13} strokeWidth={2.4} />
          </span>
        ) : null}
      </div>
      {isPublished ? (
        <>
          <div style={{ fontSize: 11.5, marginTop: 7, lineHeight: 1.4, color: PUBLISHED_TONE.ink, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <Tr zh="已发布" en="Published" inZh={zh} />
            {published ? <span style={{ fontWeight: 400, color: "#5f7f6d" }}>{` · ${publishedDay(published.at, zh)}`}</span> : null}
          </div>
          {published?.platforms.length ? (
            <div style={{ marginTop: 7 }}>
              <PublishedMarks platforms={published.platforms} zh={zh} size={16} links gap={5} />
            </div>
          ) : null}
        </>
      ) : live && s.state === "running" ? (
        /* At work: the employee typing its step — the same pill as the
           chat — and how long it has been at it, instead of a line that
           never changed. */
        <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          {/* The percent goes on the line below, not in the pill: a card
              this narrow squeezed "正在渲染" to "正…" beside the bar. */}
          <AgentTyping agent={live.agent} zh={zh} step={live.step} label={live.label} face={false} size="sm" />
          <span style={{ display: "flex", gap: 6, fontSize: 11, color: "#7c7c7c", fontVariantNumeric: "tabular-nums", minWidth: 0 }}>
            {live.percent !== null && live.percent !== undefined ? <span style={{ fontWeight: 600, color }}>{live.percent}%</span> : null}
            <Elapsed since={live.since} zh={zh} style={{ fontSize: 11, color: "#7c7c7c" }} />
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 11.5, marginTop: 7, lineHeight: 1.4, color: s.state === "you" ? "#fff" : s.state === "running" ? color : dim ? "#b3b3b3" : "#525252", fontWeight: s.state === "running" || s.state === "you" ? 500 : 400, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {s.line}
        </div>
      )}
      {onPublish ? (
        /* White on the black "your turn" card, the green check on it: the
           one thing left to do, and what it will say when done. */
        <div style={{ marginTop: "auto", paddingTop: 9 }}>
          <button type="button" onClick={onPublish} className="pj-publish" data-pub-opener="">
            <PublishedCheck size={14} />
            <Tr zh="已发布 · 标记完成" en="Mark as published" inZh={zh} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The delivery card's head: before, the press that marks it published (or,
 * with no cut yet, a quiet "mark it done anyway"); after, where it went —
 * each platform with its link, who marked it and when, the note — and a
 * quiet way back to in progress.
 */
function Delivery({
  project: p,
  zh,
  rendered,
  open,
  onToggle,
  popover,
  onUndo,
  disabled,
}: {
  project: ProjectDetail;
  zh: boolean;
  rendered: boolean;
  open: boolean;
  onToggle: () => void;
  popover: (align: "left" | "right") => React.ReactNode;
  onUndo: () => void;
  disabled: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  if (p.status === "done") {
    const pub = p.published;
    return (
      <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 12, background: "#f3fbf6", border: `1px solid ${PUBLISHED_TONE.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <PublishedCheck size={18} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: PUBLISHED_TONE.ink }}>
            <Tr zh="已发布" en="Published" inZh={zh} />
          </span>
          {pub ? (
            <span style={{ fontSize: 12, color: "#5f7f6d" }}>
              {publishedDay(pub.at, zh)}
              {pub.byName ? ` · ${pub.byName}` : ""}
            </span>
          ) : null}
          <span style={{ flexGrow: 1 }} />
          {p.canPublish ? (
            <button type="button" className="pj-quiet" onClick={onUndo} disabled={disabled} style={{ ...quiet("#5f6f66"), height: 26, padding: "0 8px" }}>
              <Icon name="undo" size={12} />
              <Tr zh="撤回，改回进行中" en="Undo, back to in progress" inZh={zh} />
            </button>
          ) : null}
        </div>
        {pub?.platforms.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {pub.platforms.map((pl) =>
              pl.url ? (
                <a key={pl.key} href={pl.url} target="_blank" rel="noopener noreferrer" className="pj-pub-link" title={pl.url}>
                  <PublishedMark platform={pl.key} size={15} zh={zh} />
                  <span style={{ fontWeight: 500, color: "#171717" }}>{publishPlatformName(pl.key, zh)}</span>
                  <span style={{ color: "#7c8a82", minWidth: 0, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortUrl(pl.url)}</span>
                  <Icon name="external" size={11} color="#7c8a82" />
                </a>
              ) : (
                <span key={pl.key} className="pj-pub-link" data-nolink="">
                  <PublishedMark platform={pl.key} size={15} zh={zh} />
                  <span style={{ fontWeight: 500, color: "#171717" }}>{publishPlatformName(pl.key, zh)}</span>
                  <span style={{ color: "#a3a3a3" }}>{t("没有链接", "no link")}</span>
                </span>
              ),
            )}
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 12, color: "#6f8a7b" }}>{t("标记完成时没有记下平台。", "No platform was noted when it was marked.")}</div>
        )}
        {pub?.note ? <p style={{ margin: "9px 0 0", fontSize: 12.5, color: "#3f5247", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{pub.note}</p> : null}
      </div>
    );
  }
  /* Offered to the project's managers only (`canPublish`), and only while it
     is active: an archived one is read-only (the server refuses it too). */
  if (!p.canPublish || p.status !== "active") return null;
  return rendered ? (
    <div style={{ position: "relative", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, padding: "11px 12px 11px 14px", borderRadius: 12, background: "#fafaf9", border: "1px solid #ececea", flexWrap: "wrap" }}>
      <span style={{ flex: "1 1 200px", minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{t("成片好了", "The cut is ready")}</span>
        <span style={{ display: "block", fontSize: 11.5, color: "#7c7c7c", marginTop: 2, lineHeight: 1.5 }}>
          {t("发出去后，在第 5 步标记完成。", "Posted it? Mark it done on step 5.")}
        </span>
      </span>
      {/* The loud one is on the step-5 card; this is the same press, quiet. */}
      <button type="button" className="pj-quiet" onClick={onToggle} disabled={disabled} aria-expanded={open} data-pub-opener="" style={{ ...quiet("#8a8a8a"), height: 28, padding: "0 8px" }}>
        <Icon name="check" size={12} />
        <Tr zh="已发布 · 标记完成" en="Mark as published" inZh={zh} />
      </button>
      {open ? popover("right") : null}
    </div>
  ) : (
    <div style={{ position: "relative", marginBottom: 10, display: "flex" }}>
      <button type="button" className="pj-quiet" onClick={onToggle} disabled={disabled} aria-expanded={open} data-pub-opener="" style={{ ...quiet("#7c7c7c"), height: 26, padding: "0 8px", marginLeft: -8 }}>
        <Icon name="check" size={12} />
        <Tr zh="没有成片也标记完成" en="Mark done without a cut" inZh={zh} />
      </button>
      {open ? popover("left") : null}
    </div>
  );
}

/** "youtu.be/abc123" — a link without its scheme and "www.", for a chip. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

function StatusPill({ status, zh }: { status: string; zh: boolean }) {
  const [label, color, bg] =
    status === "done" ? [zh ? "已发布" : "Published", "#0b7a63", "#e3f4ee"] : status === "archived" ? [zh ? "已归档" : "Archived", "#7c7c7c", "#f0f0f0"] : [zh ? "进行中" : "In progress", "#0f5bd5", "#e6effd"];
  return <span style={{ fontSize: 11.5, fontWeight: 500, color, background: bg, borderRadius: 999, padding: "0 9px", lineHeight: "22px", whiteSpace: "nowrap", flexShrink: 0 }}>{label}</span>;
}

function scriptStatus(s: string, zh: boolean): string {
  const m: Record<string, [string, string]> = { brief: ["草稿", "draft"], drafting: ["草稿", "draft"], awaiting_approval: ["等批准", "awaiting approval"], locked: ["已锁定", "locked"], archived: ["已归档", "archived"] };
  const v = m[s] ?? [s, s];
  return zh ? v[0] : v[1];
}

/**
 * The film being made, as the 剪辑 step and the 成片 card type it: who, on
 * what (a step from the shared table, or the director's own words), how far
 * (the render's percent), and since when.
 */
type LiveWork = { agent: AgentKey; step?: StepKey; label?: { zh: string; en: string }; percent?: number | null; since: string | null };

/**
 * The browser's clock, ticking every `ms`, as an external store: null on
 * the server and on the first client render (`getServerSnapshot`), so the
 * markup hydrates without a mismatch, then the time. The snapshot is the
 * clock rounded to the tick, so two reads within one tick agree — which is
 * what `useSyncExternalStore` needs from a snapshot.
 */
function useNow(ms: number, on: boolean): number | null {
  return React.useSyncExternalStore(
    (onChange) => {
      if (!on) return () => undefined;
      const id = setInterval(onChange, ms);
      return () => clearInterval(id);
    },
    () => (on ? Math.floor(Date.now() / ms) * ms : null),
    () => null,
  );
}

/**
 * "已用 3 分 12 秒" — how long a job has been at it, ticking.
 *
 * Nothing on the server: the clock starts in the browser after hydration
 * (`useNow`), so the server's markup and the first client render agree (a
 * time worked out on both sides would differ by the request's flight).
 */
function Elapsed({ since, zh, style }: { since: string | null; zh: boolean; style?: React.CSSProperties }) {
  const now = useNow(1000, Boolean(since));
  if (!since || now === null) return null;
  const secs = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  if (!Number.isFinite(secs)) return null;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const text = zh ? (m ? `已用 ${m} 分 ${s} 秒` : `已用 ${s} 秒`) : m ? `${m}m ${s}s so far` : `${s}s so far`;
  return (
    <span style={{ fontSize: 12, color: "#7c7c7c", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", ...style }} aria-live="off">
      {text}
    </span>
  );
}

/**
 * "预计还要约 2 分钟" — from how far the render has got in how long: the
 * remaining share at the pace so far. Said only once a tenth is done and a
 * minute has been measured, because the first percent are the setup and
 * would promise an hour. Browser-side, for the same reason as `Elapsed`.
 */
function RenderEta({ render, zh }: { render: ProjectDetail["render"]; zh: boolean }) {
  const startedAt = render?.startedAt ?? null;
  const now = useNow(5000, Boolean(startedAt));
  if (!render || render.state !== "rendering" || !startedAt || now === null) return null;
  const pct = render.progress;
  const elapsed = now - new Date(startedAt).getTime();
  if (pct < 10 || elapsed < 20_000) return <span>{zh ? "正在估算剩余时间…" : "Working out the time left…"}</span>;
  const left = (elapsed * (100 - pct)) / pct;
  const mins = Math.ceil(left / 60_000);
  return <span>{mins <= 1 ? (zh ? "预计不到一分钟" : "Under a minute left") : zh ? `预计还要约 ${mins} 分钟` : `About ${mins} min left`}</span>;
}

/**
 * The finished film, on the card: the 480p copy plays (a twentieth of the
 * master's bytes; the studio's link to the bucket is the slow part) and
 * drops to the master when that copy will not play — deleted, or not this
 * reader's to open. The poster is the render's own still.
 */
function RenderPlayer({ render, zh }: { render: NonNullable<ProjectDetail["render"]>; zh: boolean }) {
  const [proxyFailed, setProxyFailed] = React.useState(false);
  const fileId = render.fileId!;
  const playing = proxyFailed ? fileId : (render.proxyFileId ?? fileId);
  const shape = render.aspect === "9:16" ? TALL_SHAPE : WIDE_SHAPE;
  return (
    <video
      key={playing}
      controls
      preload="metadata"
      playsInline
      poster={`/api/files/${fileId}/thumb`}
      src={`/api/files/${playing}/download`}
      onError={() => {
        if (!proxyFailed && render.proxyFileId) setProxyFailed(true);
      }}
      aria-label={zh ? "成片" : "The video"}
      style={{ display: "block", aspectRatio: render.aspect.replace(":", " / "), objectFit: "contain", borderRadius: 12, background: "#000", ...shape }}
    />
  );
}

/** A vertical film is a phone screen: 480 tall and as wide as that makes
 * it, centred — not the whole column's width of black with a thin picture
 * in the middle. A wide one takes the column. */
const TALL_SHAPE: React.CSSProperties = { height: 480, width: "auto", maxWidth: "100%", margin: "0 auto" };
const WIDE_SHAPE: React.CSSProperties = { width: "100%", maxHeight: 420 };

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

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
.pj-card:target { animation: pjTarget 2.4s ease-out 1; }
@keyframes pjTarget { 0%, 40% { box-shadow: 0 0 0 3px rgba(15,91,213,.28); border-color: #9fb8e8; } 100% { box-shadow: 0 1px 2px rgba(0,0,0,0.03); } }
@media (prefers-reduced-motion: reduce) { .pj-card:target { animation: none; border-color: #9fb8e8; } }
.pj-quiet { transition: background-color .15s ease, color .15s ease; }
.pj-quiet:hover:not(:disabled) { background: rgba(0,0,0,0.045) !important; color: #171717 !important; }
.pj-danger:hover:not(:disabled) { background: #fdecea !important; color: #b42318 !important; }
.pj-quiet:focus-visible { outline: 2px solid #171717; outline-offset: 1px; }
.pj-publish { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 28px; border: 0; border-radius: 8px; background: #fff; color: #171717; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background-color .15s ease; }
.pj-publish:hover { background: #eef8f2; }
.pj-publish:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.pj-pub-link { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px 0 8px; border-radius: 9px; background: #fff; border: 1px solid #d9eee2; font-size: 12px; text-decoration: none; color: #171717; min-width: 0; transition: border-color .15s ease, box-shadow .15s ease; }
a.pj-pub-link:hover { border-color: #9fd6b6; box-shadow: 0 2px 8px rgba(30,122,79,.08); color: #171717; }
`;

const PAPER: React.CSSProperties = { backgroundColor: "#f4f3f0", backgroundImage: "radial-gradient(#d8d5cf 1px, transparent 1px)", backgroundSize: "22px 22px" };
