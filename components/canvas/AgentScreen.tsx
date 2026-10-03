"use client";

import { DropVeil, useFileDrop } from "@/components/chat/DropVeil";
import { STEP_LABELS, stepForTool } from "@/lib/agents/steps";
import { ChatLiveWork } from "@/components/chat/ChatLiveWork";
import { ModelChip, useChatModel } from "@/components/chat/ModelChip";
import { AUTO_MODEL } from "@/lib/ai/chat-models";

import Link from "next/link";
import { notify } from "@/lib/client/notify";
import { scriptPreviewAction, type ScriptPreview } from "@/app/(app)/chat/script-preview";
import { saveLinesAction } from "@/app/(app)/projects/[id]/script/actions";
import { teachRuleAction } from "@/app/(app)/train/model-actions";
import { feedbackAction } from "@/app/(app)/train/learn-actions";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AnswerPicker } from "@/components/chat/AnswerPicker";
import { MentionMenu } from "@/components/chat/MentionMenu";
import { useMentions } from "@/components/chat/useMentions";
import { AGENT_COLORS, AGENT_KEYS, AGENT_LABELS, AGENT_TINTS, agentTag, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import { Markdown } from "@/components/ui/Markdown";
import { formatTextarea, type Format } from "./composer-format";
import { FormattedPreview } from "@/components/ui/FormattedPreview";
import { useResizable } from "@/components/ui/Resizer";
import { clock, dayLabel, sameDay } from "@/components/chat/when";
import { ROSTER } from "@/lib/agents/lanes";
import { Icon } from "@/components/ui/Icon";
import { AgentName } from "@/components/ui/Tr";
import { AgentTyping, streamStep } from "@/components/agents/AgentTyping";
import { asksSomething, soft, threadCss, tidyMarkdown } from "@/components/chat/look";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { ProjectBridge } from "@/components/chat/ProjectBridge";
import { ATTACH_ACCEPT, bytes, kindOf, uploadToStudio, type Attaching } from "@/components/chat/upload";
import { VideoCards } from "@/components/chat/VideoCard";
import { RESULT_VIDEOS_MAX, videoRefsOf, type VideoCard } from "@/lib/chat/video-card";
import type { Locale } from "@/lib/i18n";
import { readerLine } from "@/lib/text/reader";
import { ConversationMenu } from "@/components/chat/RowMenu";

/**
 * The agent screen, transcribed from design/canvas/Main.dc.html.
 *
 * Markup, metrics and colours are the artboard's. What is live: the stream,
 * the tool trace, the sources panel on the right (with the relation the reader
 * holds on each file), the model name in the header, and the cost.
 *
 * The three questions the brief says this screen must answer — can I trust it,
 * where did it come from, what did it cost — are answered by the artboard's own
 * elements, not by anything added on top.
 */
export type MadeScript = { scriptId: string; projectId: string | null; title: string };
export type ThreadTool = { id: string; name: string; status: string; summary?: string; durationMs?: number | null };
export type ThreadCitation = {
  fileId: string;
  name: string;
  kind: string;
  folder: string | null;
  relation: string | null;
};

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "failed" | "stopped";
  error?: string | null;
  model?: string | null;
  costMicros?: number;
  withheld?: boolean;
  createdAt?: string;
  citations: ThreadCitation[];
  tools: ThreadTool[];
  /** The script this turn wrote, for the presses under it (open, send for review, change it here). */
  made?: MadeScript | null;
  /** The employee who answered, when an @ handed the turn to one. */
  speaker?: AgentKey | null;
  /** What this turn made or touched (an article, a project), as links under the answer. */
  links?: { kind: string; id: string; title?: string }[];
  /** The renders and video files this turn names — a person's upload, an
   * employee's receipt — as cards this reader may open. */
  videos?: VideoCard[];
  /** The files the person put on this message, by name, for the row drawn
   * before a reload names them from the text. */
  attachments?: { id: string; name: string; size: number; kind: string; read?: boolean }[];
};

/**
 * An employee's page (`/chat?agent=…`, or a thread one of them answered):
 * this person's conversations with that employee, and what the employee
 * said lately in the channels this person can read.
 */
export type AgentHistory = {
  agent: AgentKey;
  /** The thread on screen, when there is one. */
  currentId: string | null;
  conversations: { id: string; title: string; updatedAt: string; last: string }[];
  lines: { id: string; body: string; at: string; where: { kind: "project" | "channel"; name: string; href: string } }[];
};

/**
 * Three things worth asking each employee, for an employee's page with no
 * conversation yet. Pressing one puts it in the box, tagged, to send or to
 * finish ("……" is for the person to fill in).
 */
const SUGGESTIONS: Record<AgentKey, [string, string][]> = {
  research: [
    ["今天有什么值得做的选题？给我三个，说明为什么是现在", "What is worth making today? Three topics, and why now"],
    ["看看我们频道最近哪条视频表现最好，为什么", "Which of our recent videos did best, and why?"],
    ["对标账号这周都在做什么题材？", "What are the channels we watch making this week?"],
  ],
  planning: [
    ["今天的计划是什么？每件事谁负责？", "What is today's plan, and who has each part?"],
    ["现在在做的项目都到哪一步了？", "Where has each project in progress got to?"],
    ["这周先做哪个选题最划算？", "Which topic should we make first this week?"],
  ],
  script: [
    ["帮我写一个 3 分钟的 YouTube 脚本，主题：……", "Write a 3-minute YouTube script about …"],
    ["脚本库里最近写了哪些脚本？", "Which scripts were written lately?"],
    ["把最新的脚本开头改得更抓人", "Make the newest script's opening grab harder"],
  ],
  video: [
    ["现在哪些项目在等素材？", "Which projects are waiting for footage?"],
    ["最新的项目可以出粗剪了吗？缺什么？", "Can the newest project be cut yet? What is missing?"],
    ["用素材库画面给最新的项目拼一版 15 秒的预告", "Put a 15-second teaser together for the newest project from stock footage"],
  ],
  article: [
    ["把最新的脚本改写成一篇 LinkedIn 短文", "Turn the newest script into a short LinkedIn post"],
    ["最近都发布了哪些内容？", "What did we publish lately?"],
    ["给最新的项目写各平台的标题和简介", "Write titles and descriptions per platform for the newest project"],
  ],
  legal: [
    ["用自由职业合同模板给……起草一份合同，费用……，开工日期……", "Draft a freelance agreement for … from the template: fee …, starting …"],
    ["把最新的合同和它的模板逐条比对，哪里不一样？", "Compare the newest contract with its template, clause by clause: what differs?"],
    ["哪些合同还没签、或者快到期了？", "Which contracts are unsigned, or about to expire?"],
  ],
  finance: [
    ["这个月各成本中心的预算花了多少？哪里超了？", "How much of each cost centre's budget is spent this month, and where is it over?"],
    ["现在有哪些用款申请在等审批？", "Which spend requests are waiting for approval?"],
    ["帮我提一个用款申请：……，金额……，用途……", "Raise a spend request for me: …, amount …, for …"],
  ],
};

/**
 * The thread's rules: the shared ones every chat thread uses (`threadCss`),
 * plus this screen's own — the employee cards on the empty screen, the
 * "who answers" chip and the faces beside it in the composer.
 */
const CSS = `
${threadCss("[data-agent-screen]")}
[data-agent-screen] .pick { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #ececec; border-radius: 11px; background: #fff; cursor: pointer; text-align: left; font: inherit; letter-spacing: inherit; min-width: 0; transition: border-color .15s, background .15s; }
[data-agent-screen] .pick:hover { border-color: #d4d4d4; background: #fafafa; }
[data-agent-screen] .pick .nm { font-size: 13px; font-weight: 600; color: #171717; }
[data-agent-screen] .pick .hn { font-size: 11.5px; color: #8a8a8a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
[data-agent-screen] .answer { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 6px 0 4px; border-radius: 8px; font-size: 12px; color: #525252; white-space: nowrap; flex-shrink: 0; }
[data-agent-screen] .answer b { font-weight: 600; color: #171717; }
[data-agent-screen] .answer:hover { filter: brightness(0.97); }
[data-agent-screen] .answer-row:hover { background: #f7f7f5 !important; }
[data-agent-screen] .answer-face:hover { border-color: #e5e5e5 !important; }
[data-agent-screen] .hist { display: block; padding: 8px 10px; border-radius: 9px; color: #171717; text-decoration: none; border: 1px solid transparent; }
[data-agent-screen] .hist:hover { background: #f4f4f5; }
[data-agent-screen] .hist.on { background: #fff; border-color: #e5e5e5; }
[data-agent-screen] .hist .t { font-size: 12.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-agent-screen] .hist .l { font-size: 11.5px; color: #8a8a8a; margin-top: 2px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.45; }
[data-agent-screen] .said { display: flex; gap: 10px; padding: 10px 12px; border: 1px solid #ececec; border-radius: 11px; background: #fff; text-decoration: none; color: #171717; }
[data-agent-screen] .said:hover { border-color: #d4d4d4; }
[data-agent-screen] .ask { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 12px; border: 1px solid #ececec; border-radius: 10px; background: #fff; cursor: pointer; text-align: left; font: inherit; font-size: 13px; color: #262626; letter-spacing: inherit; }
[data-agent-screen] .ask:hover { border-color: #d4d4d4; background: #fafafa; }
[data-agent-screen] .tool { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 10px; border: 1px solid #ececec; border-radius: 8px; background: #fafafa; margin: 2px 6px 8px 0; font-size: 12px; color: #525252; }
`;

const ICON2 = {
  search: (
    <svg viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6.4" />
      <path d="m15.8 15.8 4 4" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24">
      <path d="m15 4 5 5-3.5 1.5-4 4 .5 4.5-1.5 1.5-4-4L4 20l3.5-3.5-4-4L5 11l4.5.5 4-4z" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  ),
};

export function AgentScreen({
  conversationId: initialId,
  initialMessages,
  locale,
  me,
  model,
  initialPrompt,
  initialAgent = null,
  now,
  history = null,
  canAttach = true,
  recent = null,
}: {
  /** Your own assistant's page: your recent conversations, for the history panel on the right. */
  recent?: { id: string; title: string; updatedAt: string }[] | null;
  /** False for somebody without the Files module: no paperclip rather than
   *  one the upload route refuses. */
  canAttach?: boolean;
  /** An employee's page: their threads with this person and their recent
   *  channel lines, drawn around the conversation (`/chat?agent=…`). */
  history?: AgentHistory | null;
  conversationId: string | null;
  initialMessages: ThreadMessage[];
  locale: Locale;
  me: { id?: string; name: string; avatarUrl: string | null };
  model: string;
  /** A question handed over from another screen (Files asks here). */
  initialPrompt?: string;
  /** An employee picked in the sidebar (`/chat?agent=…`), or the one who
   *  answered last in a reopened thread: the draft starts tagged to them,
   *  exactly as if "@文案 " had been typed. */
  initialAgent?: AgentKey | null;
  /** The server render's clock, so the day pill hydrates to the same words. */
  now?: string;
}) {
  const zh = locale.startsWith("zh");
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialId);
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  /* Back on a chat whose answer is still being written (the person left
     mid-turn; the server carried on): show what is saved and look again
     every few seconds until it is done. The page's own live stream, when
     there is one, is left alone. */
  const streamingSaved = initialMessages.some((m) => m.role === "assistant" && m.status === "streaming");
  useEffect(() => {
    if (!abort.current) setMessages(initialMessages);
  }, [initialMessages]);
  useEffect(() => {
    if (!streamingSaved) return;
    const t = setInterval(() => {
      if (!abort.current) router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [streamingSaved, router]);
  const [input, setInput] = useState(initialAgent ? `${agentTag(initialAgent)} ` : "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /* A message typed while the assistant is still answering waits here and
     goes the moment the answer ends: Enter mid-answer used to do nothing, and
     in a new chat the draft was lost (QA, 3 Oct). */
  const [queued, setQueued] = useState<string | null>(null);
  const queuedRef = useRef<string | null>(null);
  useEffect(() => {
    if (busy || !queuedRef.current) return;
    const text = queuedRef.current;
    queuedRef.current = null;
    setQueued(null);
    void send(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  /* Which model answers what is sent from this box (「模型」 in the composer):
     this chat's choice, not the studio's. */
  const [pickModel, setPickModel] = useChatModel(initialId ?? "new");
  /** The sources rail lists three; this opens the rest. */
  const [allSources, setAllSources] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  /* 「就在这里改」 under a written script: the next message, to 文案, about that script. */
  useEffect(() => {
    const on = (e: Event) => {
      const title = (e as CustomEvent<string>).detail;
      setInput(`${agentTag("script")} 把《${title}》改一下：`);
      window.setTimeout(() => {
        const el = box.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }, 30);
    };
    window.addEventListener("tg-edit-script", on);
    return () => window.removeEventListener("tg-edit-script", on);
  }, []);
  const format = (f: Format) => formatTextarea(box.current, f, setInput);
  /* @ an employee to hand them this message; otherwise your assistant answers. */
  const mentions = useMentions({ people: undefined, zh, draft: input, setDraft: setInput, box });
  /* Who will answer what is in the box — the same rule the stream route
     applies (the first employee tagged, else the person's own assistant), so
     the label under the box is never a guess. */
  const answering: AgentKey | null = parseAgentMentions(input)[0] ?? null;
  const name = (k: AgentKey) => (zh ? AGENT_LABELS[k].nameLocal : AGENT_LABELS[k].name);
  /* A draft that is only "@文案 " — the tag this screen puts there itself —
     has nothing to send yet. A file on it is something to send. */
  const [attached, setAttached] = useState<Attaching[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const uploading = attached.some((a) => !a.fileId && !a.error);
  const ready = (asksSomething(input) || attached.some((a) => a.fileId)) && !uploading;

  /**
   * Files for the message: to the person's own files (private — it is
   * their upload; the employee reads it with the id the message carries,
   * and the stream route puts a video in the conversation's project too).
   * The same uploader the channel's paperclip uses, multipart past 64 MB.
   */
  function attach(list: FileList | null) {
    const files = Array.from(list ?? []).slice(0, 10 - attached.length);
    if (!files.length) return;
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      /* The × on the chip while the bytes move aborts the request, and the
         uploader abandons its row — not a chip that goes while the file
         quietly finishes into the person's list. */
      const controller = new AbortController();
      setAttached((rest) => [...rest, { key, name: file.name, size: file.size, mime: file.type, progress: 0, cancel: () => controller.abort() }]);
      void uploadToStudio(file, (fraction) => setAttached((rest) => rest.map((a) => (a.key === key ? { ...a, progress: fraction } : a))), controller.signal, { access: { mode: "private" } })
        .then(({ id }) => setAttached((rest) => rest.map((a) => (a.key === key ? { ...a, fileId: id, progress: 1, cancel: undefined } : a))))
        .catch((err: unknown) => setAttached((rest) => rest.map((a) => (a.key === key ? { ...a, error: err instanceof Error ? err.message : zh ? "上传失败" : "Upload failed" } : a))));
    }
  }

  /* Files dragged from the desktop onto anywhere on this screen go on the
     message (`useFileDrop`), with a veil saying so while they are held over. */
  const dragging = useFileDrop(canAttach, (list) => {
    attach(list);
    box.current?.focus();
  });

  /** The cards for a few ids, once the server can name them for this reader. */
  const patchById = useCallback((id: string, fn: (m: ThreadMessage) => ThreadMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, []);
  async function cardsFor(ids: string[]): Promise<VideoCard[]> {
    const wanted = [...new Set(ids)].filter((id) => /^(rnd|fil)_/i.test(id)).slice(0, 20);
    if (!wanted.length) return [];
    try {
      const r = await fetch(`/api/chat/videos?ids=${encodeURIComponent(wanted.join(","))}`, { cache: "no-store" });
      if (!r.ok) return [];
      return ((await r.json()) as { videos: VideoCard[] }).videos ?? [];
    } catch {
      return [];
    }
  }

  /* Put a colleague's tag at the front of the draft, replacing one already
     there, and hand the caret back to the box. */
  function ask(k: AgentKey) {
    setInput((d) => (d.startsWith("@") ? d.replace(/^@\S+\s*/, `${agentTag(k)} `) : `${agentTag(k)} ${d}`));
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  /*
   * The thread follows its last message. It used to scroll only when a
   * message was added, so whatever grew after — the live "剪辑中" row, a
   * video card's poster, an answer's tools — sat below the fold ("scroll to
   * the last message always"). Now any growth keeps the bottom in view,
   * unless the person has scrolled up to read (more than ~160px from the
   * bottom); sending snaps back down.
   */
  const pinned = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const toBottom = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    };
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const mo = new MutationObserver(toBottom);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    /* Posters and pictures change the height when they load, with no DOM change. */
    el.addEventListener("load", toBottom, true);
    toBottom();
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("load", toBottom, true);
      mo.disconnect();
    };
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /* Arriving with an employee picked: the caret goes after their tag, so the
     next thing typed is the question. */
  useEffect(() => {
    if (!initialAgent || initialPrompt) return;
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A question passed in from another module is asked once, on arrival.
  const asked = useRef(false);
  useEffect(() => {
    if (!initialPrompt || asked.current) return;
    asked.current = true;
    void send(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const patchLast = useCallback((fn: (m: ThreadMessage) => ThreadMessage) => {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          next[i] = fn(next[i]);
          break;
        }
      }
      return next;
    });
  }, []);

  async function send(text: string, opts: { retry?: boolean } = {}) {
    /* The files that finished uploading go with the text; one still on its
       way would be a message that arrives without it. */
    const files = opts.retry ? [] : attached.flatMap((a) => (a.fileId ? [{ id: a.fileId, name: a.name, size: a.size, kind: kindOf(a.name, a.mime) }] : []));
    if (busy || (!opts.retry && ((!asksSomething(text) && !files.length) || uploading))) return;
    pinned.current = true;
    setBusy(true);
    setNotice(null);
    /* The next draft starts addressed to whoever this one was: a question to
       文案 is usually followed by another to 文案, the same way an untagged
       reply in a channel goes to the employee who just spoke. It is only a
       tag in the box — visible, and one × away from the assistant. */
    const to = parseAgentMentions(text)[0] ?? null;
    if (!opts.retry) {
      setInput(to ? `${agentTag(to)} ` : "");
      setAttached([]);
    }
    const now = new Date().toISOString();
    const userId = `u-${Date.now()}`;

    /* The answer's row goes up at once, typing, under the face of whoever
       will answer — the first employee tagged, else the assistant: the rule
       the stream route applies, so its `speaker` event only confirms it. */
    setMessages((prev) => {
      const answer: ThreadMessage = { id: `a-${Date.now()}`, role: "assistant", content: "", status: "streaming", createdAt: now, citations: [], tools: [], speaker: to };
      if (opts.retry) {
        /* The question is already there; answers that stopped before a word go. */
        const kept = [...prev];
        while (kept.length && kept[kept.length - 1].role === "assistant" && !kept[kept.length - 1].content.trim()) kept.pop();
        return [...kept, answer];
      }
      return [...prev, { id: userId, role: "user", content: text, status: "complete", createdAt: now, citations: [], tools: [], attachments: files }, answer];
    });
    /* A video the person just attached is drawn as its card as soon as the
       server can name it (its poster may take the worker a moment). */
    const sentVideos = files.filter((f) => f.kind === "video").map((f) => f.id);
    if (sentVideos.length) void cardsFor(sentVideos).then((videos) => videos.length && patchById(userId, (m) => ({ ...m, videos })));
    /* What the answer names — a render or a file in a tool's receipt or
       result — for the card under it once the turn is done. */
    const named = new Set<string>();
    /* The answer's words as they arrive, for the ids it writes itself. */
    let answer = "";

    const controller = new AbortController();
    abort.current = controller;

    try {
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(opts.retry ? { conversationId, retry: true } : { conversationId, content: text, ...(files.length ? { attachments: files.map((f) => f.id) } : {}) }),
          ...(pickModel !== AUTO_MODEL ? { model: pickModel } : {}),
          /* On an employee page, that employee answers unless the message tags someone else (QA round 2). */
          ...((history?.agent ?? initialAgent) ? { agent: history?.agent ?? initialAgent } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let created: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 2);
          if (!frame.startsWith("data:")) continue;
          // The wire shape is the stream route's; `JSON.parse` is untyped and
          // the switch below narrows each event the way it always did.
          let event: ReturnType<typeof JSON.parse>;
          try {
            event = JSON.parse(frame.slice(5).trim());
          } catch {
            // One unreadable frame is not the answer failing; the next one is.
            continue;
          }

          switch (event.type) {
            case "conversation":
              created = event.id;
              setConversationId(event.id);
              /* The model picked in the new chat stays picked when it is reopened. */
              try {
                window.sessionStorage.setItem(`tg-model:${event.id}`, pickModel);
              } catch {
                /* no storage: fine */
              }
              /* The chat exists now: it is "the last chat" even if the person
                 leaves before the answer ends. */
              document.cookie = "tg_chat_new=; path=/; max-age=0; samesite=lax";
              break;
            case "speaker":
              patchLast((m) => ({ ...m, speaker: event.agent ?? null }));
              break;
            case "message":
              patchLast((m) => ({ ...m, id: event.id }));
              break;
            case "delta":
              /* The answer is coming: "正在处理附件…" has done its job. */
              if (!answer) setNotice((n) => (n && isFilesNotice(n) ? null : n));
              answer += event.text;
              patchLast((m) => ({ ...m, content: m.content + event.text }));
              break;
            case "tool":
              patchLast((m) => {
                const tools = [...m.tools];
                const at = tools.findIndex((x) => x.id === event.id);
                const entry = { id: event.id, name: event.name, status: event.status, summary: event.summary };
                if (at >= 0) tools[at] = entry;
                else tools.push(entry);
                return { ...m, tools };
              });
              /* A render or a file the tool made or found, by id: the turn's
                 receipts, and the ids in its result (`resultIds`) when it
                 looked one thing up rather than listed many — the rule a
                 reloaded thread applies too (`resultVideoRefs`). */
              if (event.status === "ok" && event.name === "write_script" && Array.isArray(event.artifacts)) {
                const sc = event.artifacts.find((a: { kind?: string }) => a?.kind === "script");
                const pr = event.artifacts.find((a: { kind?: string }) => a?.kind === "work_project");
                if (sc && typeof sc.id === "string") patchLast((m) => ({ ...m, made: { scriptId: sc.id, projectId: typeof pr?.id === "string" ? pr.id : null, title: String(sc.title ?? "") } }));
              }
              if (event.status === "ok") {
                for (const a of Array.isArray(event.artifacts) ? event.artifacts : []) {
                  if ((a?.kind === "render" || a?.kind === "file") && typeof a.id === "string") named.add(a.id);
                }
                /* The article it wrote, the project it started: a link each (an article from chat used to be named and not linked). */
                const linkable = (Array.isArray(event.artifacts) ? event.artifacts : []).filter((a: { kind?: string; id?: unknown }) => typeof a?.id === "string" && ["article", "script", "work_project", "video_project"].includes(String(a.kind)));
                if (linkable.length) patchLast((m) => ({ ...m, links: [...(m.links ?? []), ...linkable.filter((a: { kind: string; id: string }) => !(m.links ?? []).some((l) => l.kind === a.kind && l.id === a.id)).map((a: { kind: string; id: string; title?: string }) => ({ kind: a.kind, id: a.id, title: a.title }))] }));
                const inResult = (Array.isArray(event.resultIds) ? event.resultIds : []).filter((id: unknown): id is string => typeof id === "string" && /^(rnd|fil)_/i.test(id));
                if (inResult.length <= RESULT_VIDEOS_MAX) for (const id of inResult) named.add(id);
              }
              break;
            case "citations":
              patchLast((m) => ({ ...m, citations: event.files, withheld: event.withheld }));
              break;
            case "notice":
              setNotice(plainNotice(event.text, zh));
              break;
            case "attachments":
              /* The stream route read the files: their chips get a tick. */
              if (Array.isArray(event.read)) {
                const read = new Set((event.read as unknown[]).filter((x): x is string => typeof x === "string"));
                patchById(userId, (m) => ({ ...m, attachments: (m.attachments ?? []).map((f) => (read.has(f.id) ? { ...f, read: true } : f)) }));
              }
              break;
            case "usage":
              patchLast((m) => ({ ...m, costMicros: event.costMicros, model: event.model }));
              break;
            case "done": {
              setNotice((n) => (n && isFilesNotice(n) ? null : n));
              patchLast((m) => ({ ...m, status: "complete" }));
              /* The card under the answer, for what the turn named: what the
                 answer itself wrote, and what its tools made or looked up. */
              const written = videoRefsOf(null, answer);
              for (const id of [...written.exportIds, ...written.fileIds]) named.add(id);
              if (named.size) void cardsFor([...named]).then((videos) => videos.length && patchLast((m) => ({ ...m, videos })));
              /* A new chat shows up in 最近 now, and again once its title is written (QA round 2). */
              if (created) {
                router.refresh();
                window.setTimeout(() => router.refresh(), 6000);
              }
              break;
            }
            case "error":
              setNotice((n) => (n && isFilesNotice(n) ? null : n));
              patchLast((m) => ({ ...m, status: "failed", error: event.message }));
              break;
          }
        }
      }

      /* The new chat has its first message: it is now "the last chat" /chat reopens. */
      if (created) document.cookie = "tg_chat_new=; path=/; max-age=0; samesite=lax";
      /* The new chat gets its own address without leaving the page: a
         navigation here redrew the whole screen (loading, then the page again)
         right as the answer finished — "the whole page reloaded". */
      if (created && !initialId) window.history.replaceState(null, "", `/chat/t/${created}${history ? `?agent=${history.agent}` : ""}`);
      else router.refresh();
    } catch (err) {
      if ((err as Error).name === "AbortError") patchLast((m) => ({ ...m, status: "stopped" }));
      else
        patchLast((m) => ({
          ...m,
          status: "failed",
          error: err instanceof Error ? err.message : "The connection dropped.",
        }));
    } finally {
      setBusy(false);
      abort.current = null;
      setNotice((n) => (n && isFilesNotice(n) ? null : n));
    }
  }

  const last = [...messages].reverse().find((m) => m.role === "assistant" && m.citations.length);
  const sources = last?.citations ?? [];
  /* The Sources column. A citation is a file name and a line of quoted
   * text, and how much of either you want to see is not something the
   * artboard could decide for you. */
  const { width: sourcesWidth, handle: sourcesHandle } = useResizable("agent-sources", {
    min: 220,
    max: 520,
    initial: 300,
    edge: "left",
  });
  const today = now ?? messages[0]?.createdAt ?? "1970-01-01T00:00:00.000Z";
  /* The employee's side rail: their other threads with this person, and —
     beside a conversation — their latest lines in the channels. With no
     conversation yet those lines are the page itself (`AgentEmpty`). */
  /* Your own recent chats are in the list on the left (「最近」), so the
     assistant's page has no second copy on the right; an employee's page
     keeps its rail of that employee's threads. */
  /* The chat on screen is in the rail from its first message: a new chat
     gets its address without a reload, so the server's list did not have it
     yet and the rail said 「和研究员的对话 · 0 / 还没有对话。」 beside it (QA, 2 Oct). */
  const firstAsk = messages.find((m) => m.role === "user")?.content ?? "";
  const listed = history?.conversations.find((c) => c.id === conversationId);
  const storedTitle = listed?.title ?? recent?.find((c) => c.id === conversationId)?.title ?? "";
  const threadTitle = (storedTitle && storedTitle !== "New chat" ? storedTitle : readerLine(firstAsk.replace(/@\S+/g, "").replace(/\[附件\][^\n]*/g, ""), 24)) || (zh ? "新对话" : "New chat");
  const rail: AgentHistory | null = history
    ? conversationId && !listed && messages.length
      ? { ...history, currentId: conversationId, conversations: [{ id: conversationId, title: threadTitle, updatedAt: messages[messages.length - 1]?.createdAt ?? today, last: "" }, ...history.conversations] }
      : { ...history, currentId: conversationId ?? history.currentId }
    : null;
  const showRail = Boolean(rail && (rail.conversations.length > 0 || (messages.length > 0 && rail.lines.length > 0)));

  return (
    <div data-agent-screen="" style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {/* header */}
      <div
        style={{
          height: 58,
          flexShrink: 0,
          borderBottom: "1px solid #ededed",
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "0 18px 0 24px",
        }}
      >
        {/* The host's own assistant is the little pixel robot, next to the
            employees' pixel faces — it used to be a black cube that looked
            like nothing else in the product. */}
        <AgentIcon agent={history?.agent ?? null} size={32} radius={9} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
            {history ? <AgentName agent={history.agent} zh={zh} /> : zh ? "你的助理" : "Your agent"}
            {history ? (
              <span className="role" style={{ background: soft(AGENT_TINTS[history.agent], 0.75), color: AGENT_COLORS[history.agent] }}>
                {zh ? AGENT_LABELS[history.agent].title : AGENT_LABELS[history.agent].titleEn}
              </span>
            ) : null}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#8a8a8a",
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {history
              ? zh
                ? "只有你能看到"
                : "Only you can see this"
              : zh
                ? "只有你能看到 · @ 一位同事，让他来回答"
                : "Only you can see this · @ a teammate to have them answer"}
          </div>
        </div>
        <div style={{ flexGrow: 1 }} />
        {/* Your assistant reopens the last conversation (app/(app)/chat/page.tsx),
            so a new one is asked for here; the cookie keeps it new until its
            first message. An employee's page has its own 新对话 in the history. */}
        {!history && (conversationId || messages.length > 0) ? (
          <button
            type="button"
            className="chip"
            style={{ height: 28, fontSize: 11.5, gap: 5, cursor: "pointer", fontFamily: "inherit" }}
            title={zh ? "开一个新对话" : "Start a new conversation"}
            onClick={() => {
              document.cookie = `tg_chat_new=1; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
              router.push("/chat?fresh=1");
            }}
          >
            <Icon name="plus" size={12} />
            {zh ? "新对话" : "New chat"}
          </button>
        ) : null}
        {/* 重命名 / 删除 for the chat on screen (QA, 2 Oct: there was no way to
            do either). */}
        {conversationId ? <ConversationMenu id={conversationId} title={threadTitle} zh={zh} current size={28} /> : null}
        {/* The model is chosen per message in the composer (「模型」), not
            here for the whole studio (Ryan, 28 Sep). */}
        <button type="button" className="ico2" aria-label={zh ? "搜索" : "Search"} title={zh ? "搜索（⌘K）" : "Search (⌘K)"} onClick={() => window.dispatchEvent(new CustomEvent("aura:jump"))} style={{ border: 0, background: "transparent", cursor: "pointer" }}>
          {ICON2.search}
        </button>
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <ProjectBridge conversationId={conversationId} messages={messages} zh={zh} />
          <div
            ref={scroller}
            style={{
              flexGrow: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              // With a conversation, messages run from the top and the pane
              // scrolls. With none, the opening state sits *just above the
              // composer*: pinned to the top of a tall pane it left a screen
              // of nothing between the greeting and the box you type in —
              // "ui looks bad since its so up from input bar" — which reads as
              // a page that failed to load rather than one waiting for you.
              // Bottom-aligned by a spacer rather than `flex-end`: an
              // employee's page can open taller than the pane, and flex-end
              // pushes the top of an overflowing column out of reach.
              justifyContent: "flex-start",
              paddingBottom: 10,
            }}
          >
            {messages.length === 0 ? <div style={{ flexGrow: 1 }} /> : null}
            {messages.length === 0 ? (
              <div style={{ paddingTop: 22 }}>
                {history ? (
                  <AgentEmpty
                    history={history}
                    zh={zh}
                    locale={locale}
                    today={today}
                    onAsk={(text) => {
                      setInput(`${agentTag(history.agent)} ${text}`);
                      requestAnimationFrame(() => {
                        const el = box.current;
                        if (!el) return;
                        el.focus();
                        el.setSelectionRange(el.value.length, el.value.length);
                      });
                    }}
                  />
                ) : (
                  <Empty zh={zh} picked={answering} onPick={ask} />
                )}
              </div>
            ) : (
              <>
                <div className="day">
                  <span>{dayLabel(messages[0].createdAt, today, locale)}</span>
                </div>
                {messages.map((m) =>
                  m.role === "user" ? (
                    <UserRow key={m.id} message={m} me={me} locale={locale} />
                  ) : (
                    <AgentRow key={m.id} message={m} zh={zh} locale={locale} />
                  ),
                )}
                {/* Pinned to the bottom of the thread, just above the box you
                    type in: the film being made is always in view, however far
                    up you have scrolled, instead of appearing below the fold. */}
                <div style={{ position: "sticky", bottom: 0, zIndex: 2, background: "linear-gradient(to top, #fff 70%, rgba(255,255,255,0))", paddingTop: 6 }}>
                  <ChatLiveWork conversationId={conversationId} settled={messages.filter((x) => x.role === "assistant" && x.status !== "streaming").length} zh={zh} shown={messages.flatMap((x) => (x.videos ?? []).map((v) => v.id))} />
                </div>
                {/* A question left without an answer (the answer stopped before a
                    word, or never came): one press answers it again — the site
                    recovers, the person does not have to type it twice. */}
                {(() => {
                  const last = messages[messages.length - 1];
                  const orphan = !busy && conversationId && last && (last.role === "user" || (last.role === "assistant" && !last.content.trim() && (last.status === "stopped" || last.status === "failed")));
                  if (!orphan) return null;
                  const question = [...messages].reverse().find((m) => m.role === "user");
                  if (!question) return null;
                  return (
                    <div style={{ display: "flex", justifyContent: "flex-start", padding: "4px 0 8px 48px" }}>
                      <button type="button" className="chip" onClick={() => void send(question.content, { retry: true })} style={{ height: 28, fontSize: 12, gap: 6, cursor: "pointer", fontFamily: "inherit" }}>
                        <Icon name="undo" size={12} /> {zh ? "重新回答" : "Answer again"}
                      </button>
                    </div>
                  );
                })()}
              </>
            )}

            {notice && (
              <div style={{ padding: "4px 24px 10px" }}>
                <div
                  style={{
                    border: "1px solid #fbdb73",
                    background: "#fdfaed",
                    borderRadius: 9,
                    padding: "9px 12px",
                    fontSize: 12.5,
                    color: "#b45f06",
                    maxWidth: 640,
                  }}
                >
                  {notice}
                </div>
              </div>
            )}
          </div>

          <DropVeil on={dragging} zh={zh} />

          {/* composer */}
          <div style={{ flexShrink: 0, padding: "6px 24px 18px" }}>
            <div className="composer">
              <MentionMenu matches={mentions.matches} active={mentions.active} zh={zh} onPick={mentions.pick} onHover={mentions.setActive} placement="up" />

              {/* The formatting buttons write Markdown; this is what it will
                  look like once sent. */}
              {queued ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px 0", fontSize: 12.5, color: "#5f6368" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                    {zh ? "助理答完就发：" : "Sends when the answer ends: "}
                    {queued.length > 60 ? `${queued.slice(0, 60)}…` : queued}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      queuedRef.current = null;
                      setQueued(null);
                      setInput(queued);
                    }}
                    style={{ border: 0, background: "transparent", color: "#1a73e8", cursor: "pointer", font: "inherit", padding: 0, flexShrink: 0 }}
                  >
                    {zh ? "改一下" : "Edit"}
                  </button>
                </div>
              ) : null}
              <FormattedPreview text={input} zh={zh} />

              <textarea
                ref={box}
                className="dc-composer"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  mentions.onValue(e.target.value, e.target.selectionStart ?? e.target.value.length);
                }}
                onBlur={mentions.close}
                onKeyDown={(e) => {
                  if (mentions.onKeyDown(e)) return;
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (busy) {
                      if (asksSomething(input)) {
                        queuedRef.current = input;
                        setQueued(input);
                        setInput("");
                      }
                      return;
                    }
                    void send(input);
                  }
                }}
                onPaste={(e) => {
                  if (!canAttach || !e.clipboardData.files.length) return;
                  e.preventDefault();
                  attach(e.clipboardData.files);
                }}
                rows={1}
                aria-label={zh ? "给助理发消息" : "Message your assistant"}
                placeholder={
                  answering
                    ? zh
                      ? `问${name(answering)}…`
                      : `Ask ${name(answering)}…`
                    : zh
                      ? "问点什么，或 @ 一位同事…"
                      : "Ask anything, or @ a teammate…"
                }
                style={{
                  display: "block",
                  width: "100%",
                  border: 0,
                  outline: "none",
                  resize: "none",
                  padding: "12px 14px 6px",
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  fontFamily: "inherit",
                  letterSpacing: "inherit",
                  color: "#171717",
                  maxHeight: 160,
                  background: "transparent",
                }}
              />

              {/* What is going up, and how far it has got. */}
              {attached.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 11px 0" }}>
                  {attached.map((a) => (
                    <span key={a.key} className="chip" style={{ height: 26, fontSize: 11.5, gap: 7, borderColor: a.error ? "#fdc2c2" : "#ededed", background: a.error ? "#fff7f7" : "#fff", color: a.error ? "#b52a2a" : "#4a5763" }}>
                      <Icon name={kindOf(a.name, a.mime) === "image" ? "image" : kindOf(a.name, a.mime) === "video" ? "clapper" : "doc"} size={12} />
                      <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                      <span style={{ color: a.error ? "#b52a2a" : "#999999" }}>{a.error ? a.error : a.fileId ? bytes(a.size) : `${Math.round(a.progress * 100)}%`}</span>
                      {!a.fileId && !a.error ? (
                        <span aria-hidden style={{ width: 44, height: 4, borderRadius: 2, background: "#ececec", overflow: "hidden", display: "inline-block" }}>
                          <b style={{ display: "block", height: "100%", width: `${Math.max(4, Math.round(a.progress * 100))}%`, background: "#171717", transition: "width .3s ease" }} />
                        </span>
                      ) : null}
                      <button type="button" onClick={() => { a.cancel?.(); setAttached((rest) => rest.filter((x) => x.key !== a.key)); }} aria-label={zh ? `移除 ${a.name}` : `Remove ${a.name}`} style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", font: "inherit", color: "inherit", lineHeight: 1 }}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {/* One row: who answers (and one press to ask somebody else),
                  a file, the formatting buttons, send. */}
              <div className="bar">
                {canAttach ? (
                  <>
                    <input
                      ref={picker}
                      type="file"
                      multiple
                      hidden
                      accept={ATTACH_ACCEPT}
                      onChange={(e) => {
                        attach(e.target.files);
                        // So the same file picked twice in a row still fires.
                        e.target.value = "";
                      }}
                    />
                    <button type="button" className="ico2" onClick={() => picker.current?.click()} aria-label={zh ? "添加文件" : "Attach a file"} title={zh ? "添加文件（任何格式，也可以直接拖进来）" : "Attach files (any format, or drag them in)"}>
                      <svg viewBox="0 0 24 24">
                        <path d="M16.5 8.5 10 15a2.5 2.5 0 0 0 3.5 3.5l6.5-6.5a4.5 4.5 0 0 0-6.4-6.4L7 12.2" />
                      </svg>
                    </button>
                  </>
                ) : null}
                <AnswerPicker
                  answering={answering}
                  zh={zh}
                  soft={soft}
                  onPick={(k) => {
                    if (k) ask(k);
                    else {
                      /* Back to the assistant: drop the tag at the front. A tag further into the sentence is the writer's own business. */
                      setInput((d) => d.replace(/^@\S+\s*/, ""));
                      requestAnimationFrame(() => box.current?.focus());
                    }
                  }}
                />
                <span className="sep fmt" aria-hidden />
                <button type="button" className="ico2 fmt" onClick={() => format("bold")} aria-label={zh ? "加粗" : "Bold"} title={zh ? "加粗" : "Bold"}>
                  <svg viewBox="0 0 24 24">
                    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
                  </svg>
                </button>
                <button type="button" className="ico2 fmt" onClick={() => format("italic")} aria-label={zh ? "斜体" : "Italic"} title={zh ? "斜体" : "Italic"}>
                  <svg viewBox="0 0 24 24">
                    <path d="M10 5h8M6 19h8M14.5 5 9.5 19" />
                  </svg>
                </button>
                <button type="button" className="ico2 fmt" onClick={() => format("link")} aria-label={zh ? "链接" : "Link"} title={zh ? "链接" : "Link"}>
                  <svg viewBox="0 0 24 24">
                    <path d="M9.5 14.5 14.5 9.5M8 11l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
                  </svg>
                </button>
                <button type="button" className="ico2 fmt" onClick={() => format("list")} aria-label={zh ? "列表" : "List"} title={zh ? "列表" : "List"}>
                  <svg viewBox="0 0 24 24">
                    <path d="M8 6.5h11M8 12h11M8 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
                  </svg>
                </button>
                <button type="button" className="ico2 fmt" onClick={() => format("code")} aria-label={zh ? "代码" : "Code"} title={zh ? "代码" : "Code"}>
                  <svg viewBox="0 0 24 24">
                    <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
                  </svg>
                </button>
                <div style={{ flexGrow: 1 }} />
                <ModelChip value={pickModel} onChange={setPickModel} zh={zh} placement="up" align="right" />
                <button
                  type="button"
                  onClick={() => {
                    if (!busy) return void send(input);
                    /* The turn runs on the server whatever the page does, so
                       Stop tells it to stop, then drops the stream. */
                    if (conversationId) void fetch("/api/agent/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId }) }).catch(() => {});
                    abort.current?.abort();
                  }}
                  disabled={!busy && !ready}
                  aria-label={busy ? (zh ? "停止" : "Stop") : zh ? "发送" : "Send"}
                  title={busy ? (zh ? "停止" : "Stop") : zh ? "发送" : "Send"}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    border: 0,
                    cursor: !busy && !ready ? "default" : "pointer",
                    background: !busy && !ready ? "#d4d4d4" : "#171717",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "background .15s",
                  }}
                >
                  {busy ? (
                    <span style={{ width: 11, height: 11, borderRadius: 2, background: "#fff" }} />
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      style={{
                        width: 15,
                        height: 15,
                        stroke: "#fff",
                        fill: "none",
                        strokeWidth: 2.2,
                        strokeLinecap: "round",
                        strokeLinejoin: "round",
                      }}
                    >
                      <path d="M12 19V5.5M6 11.5 12 5.5l6 6" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* sources panel */}
        {/*
          The sources rail, and only when there are sources.
          It used to hold 300px of the window open to say "Sources used · 0"
          with a paragraph explaining what would go there one day. A panel
          that is empty on every screen anybody actually looks at is a panel
          that should not be drawn: it appears the moment an answer rests on a
          file, and takes the width back when it does not.
        */}
        {sources.length > 0 || showRail ? (
          <div
            style={{
              width: sourcesWidth,
              flexShrink: 0,
              position: "relative",
              borderLeft: "1px solid #ededed",
              background: "#fcfcfc",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {sourcesHandle}
            {rail && showRail ? <HistoryRail history={rail} zh={zh} locale={locale} today={today} /> : null}
            {sources.length > 0 ? (
            <>
            <div
              style={{
                height: 44,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                padding: "0 16px",
                borderBottom: "1px solid #ededed",
                borderTop: rail && showRail ? "1px solid #ededed" : undefined,
              }}
            >
              <span className="lbl" style={{ padding: 0 }}>
                {zh ? "已使用的来源" : "Sources used"} · {sources.length}
              </span>
            </div>
            <div style={{ padding: 13, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
              {/* Three, then the rest on request: an answer that read forty
                  files should not push its own text off the screen. */}
              {(allSources ? sources : sources.slice(0, 3)).map((s) => (
                <Link
                  key={s.fileId}
                  href={`/files/${s.fileId}`}
                  style={{
                    border: "1px solid #ededed",
                    borderRadius: 9,
                    background: "#fff",
                    padding: "10px 11px",
                    color: "#171717",
                    display: "block",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#999999", marginTop: 2 }}>{s.folder ?? "—"}</div>
                  <span
                    className={`bd ${s.relation === "owner" || s.relation === "editor" ? "blue" : "gray"}`}
                    style={{ marginTop: 8 }}
                  >
                    {relationLabel(s.relation, zh)}
                  </span>
                </Link>
              ))}

              {sources.length > 3 ? (
                <button
                  type="button"
                  onClick={() => setAllSources((v) => !v)}
                  style={{
                    border: 0,
                    background: "transparent",
                    padding: "2px 2px 0",
                    textAlign: "left",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 11.5,
                    color: "#007be0",
                  }}
                >
                  {allSources
                    ? zh
                      ? "收起"
                      : "Show fewer"
                    : zh
                      ? `+ 再看 ${sources.length - 3} 个`
                      : `+ ${sources.length - 3} more`}
                </button>
              ) : null}

              {last?.withheld && (
                <p className="mut" style={{ lineHeight: 1.55, marginTop: 4 }}>
                  {zh
                    ? "已按你的权限过滤。另有文件匹配但未显示。"
                    : "Filtered to what you can read. Further files matched and were withheld."}
                </p>
              )}
            </div>
            </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}


function relationLabel(relation: string | null, zh: boolean): string {
  const map: Record<string, [string, string]> = {
    owner: ["Owner", "所有者"],
    editor: ["Editor", "可编辑"],
    commenter: ["Commenter", "可评论"],
    viewer: ["Viewer", "可查看"],
  };
  const pair = relation ? map[relation] : undefined;
  return pair ? (zh ? pair[1] : pair[0]) : zh ? "可查看" : "Viewer";
}

/** "09:38", in the studio's zone on both sides of hydration. */
function time(iso: string | undefined, locale: Locale): string {
  return clock(iso, locale);
}

function UserRow({
  message,
  me,
  locale,
}: {
  message: ThreadMessage;
  me: { id?: string; name: string; avatarUrl: string | null };
  locale: Locale;
}) {
  const zh = locale.startsWith("zh");
  /* A file drawn as its video card is not also a chip. */
  const drawn = new Set((message.videos ?? []).map((v) => v.fileId));
  const lines = (message.content ?? "").split("\n");
  const pictures = lines.flatMap((l) => {
    const m = /^\[附件\]\s+(.+?)\s+\(image[^)]*\)\s+file id\s+(fil_[0-9a-z]+)/i.exec(l.trim());
    return m ? [{ name: m[1], id: m[2].toLowerCase() }] : [];
  });
  const shown = lines.filter((l) => !l.trim().startsWith("[附件]")).join("\n").trim();
  const pictured = new Set(pictures.map((p) => p.id));
  /* The files named in the stored lines (a reloaded thread has no live
     attachment list): a document is a chip, with a tick once it was read. */
  const named = lines.flatMap((l) => {
    const m = /^\[附件\]\s+(.+?)\s+\(([a-z]+)[^)]*\)\s+file id\s+(fil_[0-9a-z]+)/i.exec(l.trim());
    return m ? [{ id: m[3].toLowerCase(), name: m[1], kind: m[2], size: 0, read: /已读取/.test(l) }] : [];
  });
  const live = message.attachments ?? [];
  const merged = [...live.map((f) => ({ ...f, read: f.read || named.some((n) => n.id === f.id && n.read) })), ...named.filter((n) => !live.some((f) => f.id === n.id))];
  const chips = merged.filter((f) => !drawn.has(f.id) && !pictured.has(f.id) && f.kind !== "video");
  return (
    <div className="msg">
      <PersonAvatar className="mav" id={me.id} url={me.avatarUrl} name={me.name} />
      <div style={{ minWidth: 0, flexGrow: 1 }}>
        <div className="head">
          <span className="who">{me.name}</span>
          <span className="when">{time(message.createdAt, locale)}</span>
        </div>
        {/* The "[附件] … file id …" lines are for the employee reading the
            turn, not for the person: they are drawn as thumbnails instead. */}
        {shown ? <div className="txt plain">{shown}</div> : null}
        {pictures.length ? (
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {pictures.map((f) => (
              <Link key={f.id} href={`/files/${f.id}`} prefetch={false} title={f.name} style={{ display: "block", width: 72, height: 72, borderRadius: 10, overflow: "hidden", border: "1px solid #ececec", background: "#f6f6f5" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${f.id}/download`} alt={f.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              </Link>
            ))}
          </div>
        ) : null}
        {/* The files on it: a video as its card (the poster that plays,
            下载), anything else as a chip to its page. */}
        <VideoCards videos={message.videos} zh={zh} />
        {chips.length ? (
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {chips.map((f) => (
              <Link key={f.id} href={`/files/${f.id}`} prefetch={false} className="chip" style={{ height: 26, fontSize: 11.5, gap: 6, color: "#0f5bd5", borderColor: "#c9ddf7", background: "#f2f8ff" }}>
                <Icon name={f.kind === "image" ? "image" : f.kind === "video" ? "clapper" : "doc"} size={12} />
                <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                {f.size ? <span style={{ color: "#7c9bb4" }}>{bytes(f.size)}</span> : null}
                {f.read ? (
                  <span title={zh ? "AI 已经读过这个文件" : "The AI has read this file"} style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#1e7a4f" }}>
                    <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                    {zh ? "已读取" : "Read"}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One answer. Whoever gave it is drawn as themselves — the employee's pixel
 * face, name and job in their colour, or the host's robot for the person's own
 * assistant — and a reloaded thread says the same, because the speaker is
 * stored with the answer (`agent_messages.speaker`).
 */
function AgentRow({ message, zh, locale }: { message: ThreadMessage; zh: boolean; locale: Locale }) {
  const sp = message.speaker ?? null;
  const typing = message.status === "streaming" && (!message.content || message.tools.some((x) => x.status === "running"));
  return (
    <div className="msg">
      <div className="face">
        <AgentIcon agent={sp} size={36} radius={10} />
      </div>
      <div style={{ minWidth: 0, flexGrow: 1 }}>
        <div className="head">
          <span className="who">{sp ? <AgentName agent={sp} zh={zh} /> : zh ? "你的助理" : "Your agent"}</span>
          {sp ? (
            <span className="role" style={{ background: soft(AGENT_TINTS[sp], 0.75), color: AGENT_COLORS[sp] }}>
              {zh ? AGENT_LABELS[sp].title : AGENT_LABELS[sp].titleEn}
            </span>
          ) : (
            <span className="role" style={{ background: "#f4f4f5", color: "#525252" }}>
              {zh ? "私人助理" : "Assistant"}
            </span>
          )}
          <span className="when">{time(message.createdAt, locale)}</span>
        </div>

        <div className="txt">
          {groupTools(message.tools, zh).map(({ tool, count }) => (
            <div key={tool.id} className="tool">
              {tool.status === "running" ? (
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    border: "2px solid #c7c7c7",
                    borderTopColor: "#525252",
                    animation: "spin .7s linear infinite",
                    display: "inline-block",
                  }}
                />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: 12,
                    height: 12,
                    stroke: tool.status === "error" ? "#e03636" : "#278f5e",
                    fill: "none",
                    strokeWidth: 2.4,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  }}
                >
                  {tool.status === "error" ? <path d="M7 7l10 10M17 7 7 17" /> : <path d="m5 12.5 4.5 4.5L19 7.5" />}
                </svg>
              )}
              {/* What it did, in words — not the tool's raw first line ("Plan for
                  2026-09-27, posted by 策划 … (message msg_…)"), which stays
                  on hover. */}
              <span>
                {toolWords(tool.name, tool.status, zh)}
                {count > 1 ? <span style={{ color: "#a3a3a3" }}>{` ×${count}`}</span> : null}
              </span>
            </div>
          ))}

          {/* While it streams the bubble is not translated: Chrome's translate
              swaps each text node for its own copy, so the words that stream
              in after went into the hidden original and the page froze on the
              first word until a reload. Done, it is drawn again (new key) and
              translated whole. */}
          {message.content ? (
            <div key={message.status === "streaming" ? "live" : "done"} translate={message.status === "streaming" ? "no" : undefined}>
              <Markdown text={tidyMarkdown(message.content)} />
            </div>
          ) : message.status === "stopped" ? (
            /* Cut off before a word was written: say so, not an empty bubble. */
            <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>{zh ? "这次回答中途停了，没有写完。再问一次就好。" : "This answer stopped before it was written. Ask again."}</div>
          ) : null}
          {/* Typing, from the moment it was asked until the first word, and
              again while a tool runs — saying which step the tool is
              (正在查资料, 正在写脚本, 正在剪辑…). The row already draws the
              face, so the pill sits where the words will be. */}
          {typing ? (
            <div style={{ marginTop: message.content ? 6 : 2 }}>
              <AgentTyping agent={sp} zh={zh} step={streamStep(message.tools, sp)} face={false} />
            </div>
          ) : null}

          {/* A render or a video the answer names: the poster that plays,
              下载, 打开项目 — "done" with the film under it. */}
          <VideoCards videos={message.videos} zh={zh} />

          {message.made && message.status !== "streaming" ? <MadeActions made={message.made} zh={zh} /> : null}
          {message.links?.length && message.status !== "streaming" ? <ArtifactLinks links={message.links.filter((l) => !(message.made && (l.kind === "script" || l.kind === "work_project")))} zh={zh} /> : null}
          {message.status === "complete" && message.content ? <TeachLine agent={message.speaker ?? "assistant"} zh={zh} reply={message.content} messageId={message.id} /> : null}

          {message.error && (
            <div
              style={{
                border: "1px solid #fdc2c2",
                background: "#fff7f7",
                borderRadius: 9,
                padding: "9px 12px",
                fontSize: 12.5,
                color: "#b52a2a",
                marginTop: 8,
                maxWidth: 560,
              }}
            >
              {message.error}
            </div>
          )}

          {message.withheld && (
            <p className="mut" style={{ marginTop: 8 }}>
              {zh
                ? "此回答可能不完整：部分匹配内容超出你的权限范围。"
                : "This answer may be partial — some matches are outside your access."}
            </p>
          )}

          {message.citations.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {message.citations.map((c) => (
                <Link
                  key={c.fileId}
                  href={`/files/${c.fileId}`}
                  prefetch={false}
                  className="chip"
                  style={{
                    height: 24,
                    fontSize: 11.5,
                    color: "#0f5bd5",
                    borderColor: "#c9ddf7",
                    background: "#f2f8ff",
                  }}
                >
                  {c.name}
                </Link>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

/** The stream route's "working on your files" line, which goes once the answer starts. */
function isFilesNotice(text: string): boolean {
  return text.startsWith("正在处理附件") || text.startsWith("正在读文件") || text.startsWith("Working on the files") || text.startsWith("Reading the files");
}

/** A notice in plain words: the agent's own are written for an admin. */
function plainNotice(text: string, zh: boolean): string {
  if (/free fallback/i.test(text)) return zh ? "AI 账户余额不足，这次用的是备用模型，回答可能差一些。请管理员充值。" : "The AI account is low, so a backup model answered. Ask an admin to top it up.";
  if (/budget/i.test(text)) return zh ? "这个月的 AI 额度用完了，回答停在了一半。请管理员提高额度。" : "This month's AI allowance is used up, so the answer stopped. Ask an admin to raise it.";
  if (text.startsWith("正在处理附件")) return zh ? "正在读文件…可以先去别的页面，回答会留在这里。" : "Reading the files… you can leave; the answer stays here.";
  return text;
}

/**
 * Before anything has been asked: who you are talking to, and the five
 * colleagues you could ask instead — each with their face and the one line on
 * what to ask them for. Picking one tags them in the box.
 */
function Empty({ zh, picked, onPick }: { zh: boolean; picked: AgentKey | null; onPick: (k: AgentKey) => void }) {
  return (
    <div style={{ padding: "0 24px 18px" }}>
      <AgentIcon agent={picked} size={44} radius={12} />
      <div style={{ fontSize: 17, fontWeight: 600, marginTop: 14 }}>
        {picked ? (zh ? `问${AGENT_LABELS[picked].nameLocal}` : `Ask the ${AGENT_LABELS[picked].name}`) : zh ? "你的助理" : "Your assistant"}
      </div>
      <p className="mut" style={{ marginTop: 4, lineHeight: 1.6, maxWidth: 520 }}>
        {picked
          ? zh
            ? AGENT_LABELS[picked].hint
            : AGENT_LABELS[picked].hintEn
          : zh
            ? "问点什么，文件可以直接拖进来。也可以找一位同事："
            : "Ask anything — drag files straight in. Or ask a teammate:"}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
          gap: 8,
          marginTop: 14,
          maxWidth: 760,
        }}
      >
        {AGENT_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className="pick"
            onClick={() => onPick(k)}
            style={k === picked ? { borderColor: AGENT_TINTS[k], background: soft(AGENT_TINTS[k], 0.35) } : undefined}
          >
            <AgentIcon agent={k} size={32} radius={9} />
            <span style={{ minWidth: 0 }}>
              <span className="nm" style={{ display: "block" }}>
                <AgentName agent={k} zh={zh} />
              </span>
              <span className="hn" style={{ display: "block" }}>
                {zh ? AGENT_LABELS[k].hint : AGENT_LABELS[k].hintEn}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** "09:38" today, "昨天"/"周三"/"9月20日" before, in the studio's zone. */
function whenLabel(iso: string, today: string, locale: Locale): string {
  return sameDay(iso, today) ? clock(iso, locale) : dayLabel(iso, today, locale);
}

/**
 * The side rail of an employee's page: this person's threads with them
 * (the one on screen marked, and a way to start another), then what the
 * employee said lately in the channels, each with where it was said.
 */
function HistoryRail({ history, zh, locale, today }: { history: AgentHistory; zh: boolean; locale: Locale; today: string }) {
  const who = zh ? AGENT_LABELS[history.agent].nameLocal : AGENT_LABELS[history.agent].name;
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
      <div style={{ height: 44, flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "0 12px 0 16px", borderBottom: "1px solid #ededed" }}>
        <span className="lbl" style={{ padding: 0, flexGrow: 1 }}>
          {zh ? `和${who}的对话` : `With the ${who}`} · {history.conversations.length}
        </span>
        <Link
          href={`/chat?agent=${history.agent}&fresh=1`}
          prefetch={false}
          className="chip"
          style={{ height: 26, fontSize: 11.5, gap: 5 }}
          title={zh ? "开一个新对话" : "Start a new conversation"}
        >
          <Icon name="plus" size={12} />
          {zh ? "新对话" : "New"}
        </Link>
      </div>
      <div style={{ padding: "8px 8px 4px", display: "flex", flexDirection: "column", gap: 2 }}>
        {history.conversations.length === 0 ? (
          <p className="mut" style={{ padding: "4px 8px", fontSize: 12 }}>
            {zh ? "还没有对话。" : "No conversations yet."}
          </p>
        ) : (
          history.conversations.map((c) => (
            <Link key={c.id} href={`/chat/t/${c.id}?agent=${history.agent}`} prefetch={false} className={`hist${c.id === history.currentId ? " on" : ""}`}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span className="t" style={{ flexGrow: 1, minWidth: 0 }}>
                  {c.title === "New chat" ? (zh ? "新对话" : "New chat") : c.title}
                </span>
                <span style={{ fontSize: 11, color: "#a3a3a3", flexShrink: 0 }}>{whenLabel(c.updatedAt, today, locale)}</span>
              </div>
              {c.last ? <div className="l">{c.last}</div> : null}
            </Link>
          ))
        )}
      </div>
      {history.lines.length ? (
        <>
          <div style={{ padding: "12px 16px 6px" }}>
            <span className="lbl" style={{ padding: 0 }}>
              {zh ? "最近在频道里" : "Lately in the channels"}
            </span>
          </div>
          <div style={{ padding: "0 8px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
            {history.lines.slice(0, 5).map((l) => (
              <Link key={l.id} href={l.where.href} prefetch={false} className="hist">
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 11.5, color: "#525252", flexGrow: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {l.where.kind === "project" ? (zh ? `项目 · ${roomName(l.where.name)}` : `Project · ${roomName(l.where.name)}`) : `#${roomName(l.where.name)}`}
                  </span>
                  <span style={{ fontSize: 11, color: "#a3a3a3", flexShrink: 0 }}>{whenLabel(l.at, today, locale)}</span>
                </div>
                <div className="l">{plainLine(l.body)}</div>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * An employee's page with no conversation on screen: who they are and what
 * they do, three things to ask, and — so the page is never blank — what
 * they said lately in the channels this person can read, each a link to
 * where it was said.
 */
function AgentEmpty({
  history,
  zh,
  locale,
  today,
  onAsk,
}: {
  history: AgentHistory;
  zh: boolean;
  locale: Locale;
  today: string;
  onAsk: (text: string) => void;
}) {
  const k = history.agent;
  const a = AGENT_LABELS[k];
  const who = zh ? a.nameLocal : a.name;
  return (
    <div style={{ padding: "0 24px 18px", maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AgentIcon agent={k} size={44} radius={12} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{zh ? `问${who}` : `Ask the ${who}`}</div>
          <div className="mut" style={{ marginTop: 3, lineHeight: 1.55 }}>
            {zh ? `${who}负责：${ROSTER[k]}。` : `${a.hintEn}.`}
          </div>
        </div>
      </div>
      <p className="mut" style={{ marginTop: 10, lineHeight: 1.6 }}>
        {history.conversations.length
          ? zh
            ? `这里是一个新对话；你和${who}之前的对话在右边。`
            : `This is a new conversation; your earlier ones with the ${who} are on the right.`
          : zh
            ? `你还没有单独问过${who}。在下面直接写，或者从这几个开始：`
            : `You have not asked the ${who} anything here yet. Write below, or start with one of these:`}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {SUGGESTIONS[k].map(([zhText, enText]) => (
          <button key={zhText} type="button" className="ask" onClick={() => onAsk(zh ? zhText : enText)}>
            <span style={{ color: AGENT_COLORS[k], display: "flex" }}>
              <Icon name="comment" size={14} />
            </span>
            <span style={{ minWidth: 0 }}>{zh ? zhText : enText}</span>
          </button>
        ))}
      </div>
      {history.lines.length ? (
        <div style={{ marginTop: 20 }}>
          <div className="lbl" style={{ padding: 0, marginBottom: 8 }}>
            {zh ? `${who}最近在频道里说的` : `What the ${who} said lately in the channels`}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.lines.slice(0, 4).map((l) => (
              <Link key={l.id} href={l.where.href} prefetch={false} className="said">
                <AgentIcon agent={k} size={26} radius={7} />
                <div style={{ minWidth: 0, flexGrow: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 7, fontSize: 11.5 }}>
                    <span style={{ fontWeight: 600, color: AGENT_COLORS[k] }}>{who}</span>
                    <span style={{ color: "#525252", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                      {l.where.kind === "project" ? (zh ? `在项目《${roomName(l.where.name)}》` : `in the project “${roomName(l.where.name)}”`) : zh ? `在 #${roomName(l.where.name)}` : `in #${roomName(l.where.name)}`}
                    </span>
                    <span style={{ color: "#a3a3a3", marginLeft: "auto", flexShrink: 0 }}>{whenLabel(l.at, today, locale)}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, marginTop: 3, color: "#2b343d", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{plainLine(l.body)}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A channel line as a person reads it in the side panel: markdown links as
 * their words (a link back to a project page dropped), and the internal ids
 * an employee writes for its colleagues (`scr_…`, `wp_…`) taken out — the
 * panel printed "[Open Project](/projects/wp_…)" and "`scr_01m3…`".
 * Then the shared reader rules (`readerLine`): no **, no tool names, and no
 * bare app path left behind once its id is gone (QA, 2 Oct: 「/script/」).
 */
function plainLine(text: string): string {
  return readerLine(
    text
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => (url.startsWith("/projects/") ? "" : label))
      .replace(/[（(]?\s*(?:id[:：]\s*)?`?\b(?:scr|wp|prj|fil|rnd|shot|cnv|msg|am|job|ch|usr|top|idea)_[0-9a-z]{6,}\b`?\s*[)）]?/gi, "")
      .replace(/(?:^|\s|[：:，,（(])\/(?:script|projects|files|chat|video|videos|topics|trends)\/?\S*/g, " "),
    400,
  )
    .replace(/\s*[：:]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A project chat's name without the four-letter tail that keeps its address unique (「… · w2qy」). */
function roomName(name: string): string {
  return name.replace(/\s*·\s*[0-9a-z]{4}$/, "");
}

/** A tool call as a person reads it: "查资料 · 3.8 s", "正在写脚本". */
function toolWords(name: string, status: string, zh: boolean): string {
  const label = STEP_LABELS[stepForTool(name)] ?? STEP_LABELS.working;
  const words = (zh ? label.zh : label.en).replace(/…$/, "");
  if (status === "running") return words;
  return zh ? words.replace(/^正在/, "") : words.replace(/^(\w)/, (c) => c.toUpperCase());
}

/**
 * The steps of an answer as a person reads them: the same finished step
 * once, with how many times (看合同 ×3), in the order first taken; one still
 * running shows on its own.
 */
function groupTools(tools: ThreadTool[], zh: boolean): { tool: ThreadTool; count: number }[] {
  const out: { tool: ThreadTool; count: number; key: string }[] = [];
  for (const t of tools) {
    const key = `${t.status === "running" ? t.id : "done"}:${t.status === "error" ? "x" : ""}${toolWords(t.name, t.status === "running" ? "running" : "ok", zh)}`;
    const same = out.find((o) => o.key === key);
    if (same) same.count += 1;
    else out.push({ tool: t, count: 1, key });
  }
  return out;
}

/**
 * Under a reply that wrote a script: the script itself, open (the owner, 29
 * Sep: "how can someone change the script without seeing it — show the
 * script in the chat, as the default"), then open its project, send it for
 * approval, or keep changing it right here.
 */
function MadeActions({ made, zh }: { made: MadeScript; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [got, setDoc] = useState<ScriptPreview | "gone" | null | undefined>(undefined);
  const doc = got === "gone" ? null : got;
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let off = false;
    scriptPreviewAction(made.scriptId).then((d) => !off && setDoc(d)).catch(() => !off && setDoc(null));
    return () => {
      off = true;
    };
  }, [made.scriptId, rev]);
  /* 直接编辑: type into the script right here; saved into the document (the owner, 29 Sep: "let me type and change the script from chat"). */
  async function saveLines() {
    if (!editing || !made.projectId || saving) return;
    setSaving(true);
    const r = await saveLinesAction(made.projectId, editing).catch(() => ({ error: t("没保存上，再试一次", "Not saved; try again") }));
    setSaving(false);
    if ("error" in r && r.error) return notify(r.error);
    setEditing(null);
    setRev((n) => n + 1);
    notify(t("已保存到脚本", "Saved to the script"), "ok");
  }
  const btn = (primary = false): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 13px", borderRadius: 9, fontSize: 13, fontWeight: 600, textDecoration: "none", cursor: "pointer", fontFamily: "inherit", border: `1px solid ${primary ? "#171717" : "#dcdbd6"}`, background: primary ? "#171717" : "#fff", color: primary ? "#fff" : "#262626", whiteSpace: "nowrap" });
  /* The card's numbers are the script's own (shots, spoken length worked
     out as the editor does, the target), so they match the editor and the
     reply (QA, 2 Oct). */
  const summary = doc
    ? doc.beats
      ? t(`${doc.beats} 个分镜 · 约 ${Math.max(1, doc.seconds)} 秒${doc.targetSeconds ? ` · 目标 ${doc.targetSeconds} 秒` : ""}`, `${doc.beats} shots · about ${Math.max(1, doc.seconds)}s${doc.targetSeconds ? ` · target ${doc.targetSeconds}s` : ""}`)
      : t(`${doc.paragraphs.length} 段`, `${doc.paragraphs.length} parts`)
    : "";
  /* Deleted since: say so, and offer nothing that would lead nowhere. */
  if (got === "gone")
    return (
      <div style={{ marginTop: 10, maxWidth: 720, border: "1px dashed #dcdbd6", borderRadius: 12, padding: "10px 14px", fontSize: 12.5, color: "#8a8a8a" }}>
        {t(`《${made.title || "脚本"}》这份脚本已删除。`, `The script “${made.title || "script"}” has been deleted.`)}
      </div>
    );
  const shown = doc ? (all ? doc.paragraphs : doc.paragraphs.slice(0, 6)) : [];
  return (
    <div style={{ marginTop: 10, maxWidth: 720 }}>
      {doc ? (
        <div style={{ border: "1px solid #e5e4df", borderRadius: 12, background: "#fff", overflow: "hidden" }}>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 14px", border: 0, borderBottom: open ? "1px solid #efeee9" : 0, background: "#fafaf8", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
            <span style={{ fontSize: 13.5, fontWeight: 650, color: "#171717", flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>《{doc.title || made.title}》</span>
            <span style={{ fontSize: 12, color: "#8a8a8a", whiteSpace: "nowrap" }}>{summary}</span>
            <span style={{ fontSize: 12, color: "#525252", whiteSpace: "nowrap" }}>{open ? t("收起", "Hide") : t("展开", "Show")}</span>
          </button>
          {open && editing ? (
            <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              {editing.map((line, i) =>
                doc.lines[i]?.trim() || line.trim() ? (
                  <textarea
                    key={i}
                    value={line}
                    onChange={(e) => setEditing((list) => (list ? list.map((x, j) => (j === i ? e.target.value : x)) : list))}
                    rows={Math.max(2, Math.ceil(line.length / 42))}
                    style={{ width: "100%", boxSizing: "border-box", resize: "vertical", border: "1px solid #dcdbd6", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 14, lineHeight: 1.7, color: "#262626", outline: "none" }}
                  />
                ) : null,
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" disabled={saving} onClick={() => void saveLines()} style={btn(true)}>
                  {saving ? t("保存中…", "Saving…") : t("保存到脚本", "Save to the script")}
                </button>
                <button type="button" disabled={saving} onClick={() => setEditing(null)} style={btn()}>
                  {t("取消", "Cancel")}
                </button>
                <span style={{ fontSize: 12, color: "#8a8a8a" }}>{t("清空一段就是删掉它", "Empty a part to delete it")}</span>
              </div>
            </div>
          ) : open ? (
            <div translate="no" className="notranslate" style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {shown.map((p, i) => (
                <p key={i} style={{ margin: 0, fontSize: 14, lineHeight: 1.75, color: "#262626", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {p}
                </p>
              ))}
              {doc.paragraphs.length > 6 ? (
                <button type="button" onClick={() => setAll((v) => !v)} style={{ alignSelf: "flex-start", border: 0, background: "none", padding: 0, color: "#1f5fbf", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                  {all ? t("收起一些", "Show less") : t(`看全部 ${doc.paragraphs.length} 段`, `Show all ${doc.paragraphs.length}`)}
                </button>
              ) : null}
              {!doc.paragraphs.length ? <p style={{ margin: 0, fontSize: 13, color: "#8a8a8a" }}>{t("脚本还是空的。", "The script is empty.")}</p> : null}
            </div>
          ) : null}
        </div>
      ) : doc === undefined ? (
        <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>{t("正在打开脚本…", "Opening the script…")}</div>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {doc && made.projectId && !editing ? (
          <button type="button" onClick={() => (doc.locked ? notify(t("这份脚本已经批准锁定了：点「打开项目」→「脚本」，在顶部绿色的「已批准」那一栏点「继续编辑」", "It is approved and locked: open the project, go to Script, and press Continue editing in the green Approved bar at the top")) : (setEditing([...doc.lines]), setOpen(true)))} style={btn(true)}>
            {t("直接编辑", "Edit it myself")}
          </button>
        ) : null}
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("tg-edit-script", { detail: made.title }))} style={btn(!made.projectId)}>
          {t("让文案改", "Ask the writer")}
        </button>
        <Link href={made.projectId ? `/projects/${made.projectId}/script?share=review` : `/script/${made.scriptId}?share=review`} prefetch={false} style={btn()}>
          {t("发给同事审阅", "Send for approval")}
        </Link>
        {made.projectId ? (
          <Link href={`/projects/${made.projectId}`} prefetch={false} style={btn()}>
            {t("打开项目", "Open the project")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/* Ratings stored in this browser; a rating anywhere tells every line to look again. */
const ratedSubs = new Set<() => void>();
function subscribeRated(cb: () => void) {
  ratedSubs.add(cb);
  return () => {
    ratedSubs.delete(cb);
  };
}

/**
 * 「教它」: tell the employee something it should always do from now on; the
 * rule goes into its 工作说明 (AI 同事 › 训练).
 */
function TeachLine({ agent, zh, reply, messageId }: { agent: string; zh: boolean; reply: string; messageId: string }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [open, setOpen] = useState(false);
  const [rated, setRated] = useState<"good" | "bad" | null>(null);
  const [why, setWhy] = useState("");
  /* 有用 / 不好 is remembered in this browser per reply (QA, 2 Oct: a reload
     offered both again). Only stored ids count: a live row's id ("a-…") is
     replaced by the server's when the reply is saved. */
  const key = /^(a-|u-)/.test(messageId) ? null : `tg-rated:${messageId}`;
  const stored = useSyncExternalStore(
    subscribeRated,
    () => {
      try {
        const v = key ? window.localStorage.getItem(key) : null;
        return v === "good" || v === "bad" ? v : null;
      } catch {
        return null;
      }
    },
    () => null,
  );
  const shownRating = rated ?? stored;
  const rate = async (kind: "good" | "bad", text = "") => {
    setRated(kind);
    if (key)
      try {
        window.localStorage.setItem(key, kind);
        ratedSubs.forEach((f) => f());
      } catch {
        /* fine */
      }
    const r = await feedbackAction(agent, kind, text, reply.slice(0, 300));
    if (r.error) notify(r.error);
    else notify(kind === "good" ? t("收到，会多这样做", "Thanks — noted") : t("收到，会从这次反馈里改进", "Noted — it will learn from this"), "ok");
  };
  const [rule, setRule] = useState("");
  const [busy, setBusy] = useState(false);
  const name = agent === "assistant" ? t("助理", "the assistant") : zh ? (AGENT_LABELS[agent as AgentKey]?.nameLocal ?? agent) : (AGENT_LABELS[agent as AgentKey]?.name ?? agent);
  const quiet: React.CSSProperties = { border: 0, background: "none", padding: 0, color: "#8a8a8a", fontSize: 12, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 4 };
  const thumb = (down: boolean) => (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={down ? { transform: "scaleY(-1)" } : undefined}>
      <path d="M7 11v9H4v-9h3zM7 11l4-7a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.3 20H7" />
    </svg>
  );
  if (!open)
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
        {rated === "bad" && stored !== "bad" && why !== "\u0000" ? (
          <form onSubmit={(e) => { e.preventDefault(); void rate("bad", why); setWhy("\u0000"); }} style={{ display: "flex", gap: 6 }}>
            <input autoFocus value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t("哪里不好？（可以不写）", "What was off? (optional)")} style={{ width: 260, height: 28, border: "1px solid #dcdbd6", borderRadius: 8, padding: "0 9px", fontFamily: "inherit", fontSize: 12, outline: "none" }} />
            <button type="submit" style={{ height: 28, padding: "0 10px", border: 0, borderRadius: 8, background: "#171717", color: "#fff", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>{t("告诉它", "Send")}</button>
          </form>
        ) : (
          <>
            <button type="button" disabled={shownRating !== null} onClick={() => void rate("good")} style={{ ...quiet, color: shownRating === "good" ? "#1e7a4f" : "#8a8a8a" }} title={t("这次回答有用", "Helpful")}>{thumb(false)}{t("有用", "Helpful")}</button>
            <button type="button" disabled={shownRating !== null} onClick={() => { setRated("bad"); setWhy(""); }} style={{ ...quiet, color: shownRating === "bad" ? "#b4532a" : "#8a8a8a" }} title={t("这次回答不好", "Not good")}>{thumb(true)}{t("不好", "Not good")}</button>
          </>
        )}
        <button type="button" onClick={() => setOpen(true)} style={quiet}>
          {t(`教${name}：以后都这样做…`, `Teach ${name} a rule…`)}
        </button>
      </div>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!rule.trim() || busy) return;
        setBusy(true);
        const res = await teachRuleAction(agent, rule);
        setBusy(false);
        if (res.error) return notify(res.error);
        notify(t(`${name}记住了，以后都会照做（在「AI 同事 → 训练」里可以改）`, `${name} will do this from now on (editable under AI team → Train)`), "ok");
        setRule("");
        setOpen(false);
      }}
      style={{ display: "flex", gap: 6, marginTop: 8, maxWidth: 620 }}
    >
      <input autoFocus value={rule} onChange={(e) => setRule(e.target.value)} placeholder={t("比如：开头先讲结论；不要用“家人们”；每段不超过 3 句", "e.g. lead with the conclusion; keep paragraphs short")} style={{ flexGrow: 1, minWidth: 0, height: 32, border: "1px solid #dcdbd6", borderRadius: 8, padding: "0 10px", fontFamily: "inherit", fontSize: 12.5, outline: "none" }} />
      <button type="submit" disabled={busy || !rule.trim()} style={{ height: 32, padding: "0 12px", border: 0, borderRadius: 8, background: "#171717", color: "#fff", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: busy || !rule.trim() ? 0.5 : 1 }}>
        {busy ? t("记住中…", "Saving…") : t("记住", "Remember")}
      </button>
      <button type="button" onClick={() => setOpen(false)} style={{ height: 32, padding: "0 10px", border: "1px solid #dcdbd6", borderRadius: 8, background: "#fff", fontFamily: "inherit", fontSize: 12.5, cursor: "pointer" }}>
        {t("取消", "Cancel")}
      </button>
    </form>
  );
}


/** Links to what a turn made: the article, the project, the script, the video. */
const LINK_HREF: Record<string, (id: string) => string> = { article: (id) => `/article?id=${id}`, script: (id) => `/script/${id}`, work_project: (id) => `/projects/${id}`, video_project: (id) => `/video?project=${id}` };
const LINK_WORD: Record<string, [string, string]> = { article: ["打开文章", "Open the article"], script: ["打开脚本", "Open the script"], work_project: ["打开项目", "Open the project"], video_project: ["打开视频", "Open the video"] };
function ArtifactLinks({ links, zh }: { links: { kind: string; id: string; title?: string }[]; zh: boolean }) {
  const shown = links.filter((l) => LINK_HREF[l.kind]);
  if (!shown.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {shown.map((l) => (
        <Link key={l.kind + l.id} href={LINK_HREF[l.kind](l.id)} prefetch={false} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: "#171717", background: "#f3f3f1", border: "1px solid #e3e1dc", borderRadius: 999, padding: "4px 11px", textDecoration: "none", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {zh ? LINK_WORD[l.kind][0] : LINK_WORD[l.kind][1]}
          {l.title ? <span style={{ fontWeight: 400, color: "#525252" }}>《{l.title.slice(0, 24)}》</span> : null}
        </Link>
      ))}
    </div>
  );
}
