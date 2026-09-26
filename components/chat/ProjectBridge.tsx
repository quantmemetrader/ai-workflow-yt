"use client";

import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { suggestTitle, withoutTags } from "@/lib/chat/project-title";

/**
 * The bar at the top of a conversation with an employee: "打开项目《…》" when
 * the conversation already belongs to a project, "建成项目" when it could
 * become one.
 *
 * The owner: "on chat, once I start texting with an agent I should get an
 * option to create / open this on the project page." Everything in the
 * studio lives under a project, and the chat screen was the one place where
 * work could start and stay out of one.
 *
 * Nothing on an empty chat: the bar appears with the person's first real
 * message (a lone "@编剧 " is the box's own pre-fill). What it says comes
 * from one light GET (`/api/chat/project`), made again each time a reply
 * lands, because an employee's reply is what can put the conversation in a
 * project (编剧's script is always written into one). The server decides —
 * the link recorded when it was made into a project, the receipts of the
 * employees' work in it, the project the screen is about — and checks every
 * project against the person, so a private one never shows here.
 *
 * "建成项目" opens a small form: the name (the first ask, cleaned; then the
 * utility model's suggestion, unless the person has started typing), a
 * one-paragraph brief, and who can see it (everyone by default). After it
 * is made the bar asks rather than moves, like Home's ideas: open the
 * project, or stay in the conversation.
 *
 * `compact` is the side panels' version (a 312px column): one line, and the
 * form floats over the page (fixed, in a portal) beside it, because the
 * panel's thread is a small scroll box that would clip it.
 */
export type BridgeMessage = { role: "user" | "assistant"; content: string; status: string };

type BridgeState = {
  project: { id: string; title: string; via: "link" | "work" | "screen" } | null;
  canCreate: boolean;
  title: string;
  looseScript: { id: string; title: string } | null;
};

type Made = { id: string; title: string; existed: boolean };

/* Back-office screens carry the same side panel; a question about an
   invoice is not a video, so the bar stays off there. */
const BACK_OFFICE = /^\/(finance|accounting|hr|legal|admin|settings)(\/|$)/;

export function ProjectBridge({
  conversationId,
  messages,
  zh,
  compact = false,
}: {
  conversationId: string | null;
  messages: readonly BridgeMessage[];
  zh: boolean;
  compact?: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const hasAsk = messages.some((m) => m.role === "user" && withoutTags(m.content).length > 0);
  const streaming = messages.some((m) => m.role === "assistant" && m.status === "streaming");
  /* Changes each time a reply settles: the moment to ask again. */
  const settled = messages.filter((m) => m.role === "assistant" && m.status !== "streaming").length;
  const hidden = compact && BACK_OFFICE.test(pathname);
  const live = Boolean(conversationId && hasAsk && !hidden);

  /* Kept with the conversation they belong to, so a panel that starts a
     new thread (or loads an old one) never shows the last one's project. */
  const [loaded, setLoaded] = React.useState<{ for: string; state: BridgeState } | null>(null);
  const [made, setMade] = React.useState<{ for: string; made: Made; stay: boolean } | null>(null);
  const [openFor, setOpenFor] = React.useState<string | null>(null);
  const state = loaded && loaded.for === conversationId ? loaded.state : null;
  const done = made && made.for === conversationId ? made : null;
  const open = openFor !== null && openFor === conversationId;
  /* What the form is placed against. */
  const bar = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!live || !conversationId || streaming) return;
    const ctl = new AbortController();
    const q = new URLSearchParams({ conversationId });
    /* What the screen is about, from its address: a project's page, a
       script's page, the video editor on a project. Hints only; the server
       checks each against the person. Read here, not during render, so the
       server's HTML and the first client render are the same. */
    const path = window.location.pathname;
    const wp = path.match(/^\/projects\/(wp_[0-9a-z]+)/)?.[1];
    const scr = path.match(/^\/script\/(scr_[0-9a-z]+)/)?.[1];
    const prj = new URLSearchParams(window.location.search).get("project");
    if (wp) q.set("projectId", wp);
    if (scr) q.set("scriptId", scr);
    if (prj && /^prj_[0-9a-z]+$/.test(prj)) q.set("videoProjectId", prj);
    fetch(`/api/chat/project?${q.toString()}`, { signal: ctl.signal, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<BridgeState>) : null))
      .then((s) => {
        if (s) setLoaded({ for: conversationId, state: s });
      })
      .catch(() => {
        /* The bar is a convenience; a failed read leaves it as it was. */
      });
    return () => ctl.abort();
  }, [live, conversationId, streaming, settled, pathname]);

  if (!live || !conversationId) return null;

  const project = done ? { id: done.made.id, title: done.made.title, via: "link" as const } : (state?.project ?? null);

  /* ---- just made: stay or open ---- */
  if (done && !done.stay) {
    return (
      <Shell compact={compact} tone="ok">
        <div role="status" style={{ display: "flex", alignItems: compact ? "flex-start" : "center", gap: 10, flexWrap: "wrap", width: "100%", padding: compact ? "8px 10px" : "8px 0" }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: "#dff3ec", color: "#1f7a52", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="check" size={13} strokeWidth={2.2} />
          </span>
          <div style={{ flex: "1 1 180px", minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#171717", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {done.made.existed ? t(`这段对话已经有项目了：《${done.made.title}》`, `This conversation already has a project: “${done.made.title}”`) : t(`项目已建：《${done.made.title}》`, `Project started: “${done.made.title}”`)}
            </div>
            <div style={{ fontSize: 12, color: "#525252", marginTop: 1 }}>{t("编剧、剪辑师在项目里接着做；对话要点已发到项目对话。", "The writer and the editor carry on in the project; the summary is in its chat.")}</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <Link prefetch={false} href={`/projects/${done.made.id}`} style={{ ...button(true), textDecoration: "none" }}>
              {t("打开项目", "Open the project")}
            </Link>
            <button type="button" onClick={() => setMade({ ...done, stay: true })} style={button(false)}>
              {t("留在对话", "Stay here")}
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  /* ---- already in a project ---- */
  if (project) {
    const label =
      project.via === "screen"
        ? t("当前页面的项目", "This screen's project")
        : project.via === "work"
          ? t("这段对话里的工作在项目里", "The work done here is in a project")
          : t("这段对话已建成项目", "This conversation is a project");
    return (
      <Shell compact={compact}>
        {/* In a side panel the link is the whole line; what tied it is its tooltip. */}
        <span title={label} style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0, flex: compact ? "0 0 auto" : "1 1 auto", fontSize: 12, color: "#7c7c7c" }}>
          <ProjectMark compact={compact} />
          {compact ? null : <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>}
        </span>
        <Link
          prefetch={false}
          href={`/projects/${project.id}`}
          title={`${label} · ${t(`打开项目《${project.title}》`, `Open “${project.title}”`)}`}
          style={{ ...button(false, compact), textDecoration: "none", maxWidth: compact ? undefined : 360, flex: compact ? "1 1 auto" : "0 1 auto", justifyContent: compact ? "space-between" : undefined, minWidth: 0 }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(`打开项目《${project.title}》`, `Open “${project.title}”`)}</span>
          <Icon name="external" size={12} />
        </Link>
      </Shell>
    );
  }

  /* ---- first read still on its way: the bar's room, nothing claimed ---- */
  if (!state) return compact ? null : <Shell compact={false}><span style={{ height: 8, width: 180, borderRadius: 4, background: "#efefed" }} aria-hidden /></Shell>;

  /* A guest (or someone without Chat) is not offered a project. */
  if (!state.canCreate) return null;

  const hint = t("把这段对话做成一个项目，编剧/剪辑师在项目里接着做", "Turn this conversation into a project; the writer and the editor carry on there");
  return (
    <Shell compact={compact} boxRef={bar}>
      <span title={hint} style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0, flex: "1 1 auto", fontSize: compact ? 11.5 : 12, color: "#7c7c7c" }}>
        <ProjectMark compact={compact} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{compact ? t("同事在项目里接着做", "Carry on in a project") : hint}</span>
      </span>
      <button
        type="button"
        aria-expanded={open}
        disabled={streaming}
        title={streaming ? t("等这条回答写完", "When this answer is finished") : hint}
        onClick={() => setOpenFor(open ? null : conversationId)}
        style={{ ...button(false, compact), opacity: streaming ? 0.55 : 1, cursor: streaming ? "default" : "pointer", borderColor: open ? "#171717" : "#e2e2e2" }}
      >
        <Icon name="plus" size={12} />
        {t("建成项目", "Make a project")}
      </button>
      {open ? (
        <CreateForm
          key={conversationId}
          zh={zh}
          compact={compact}
          anchor={bar}
          conversationId={conversationId}
          initialTitle={state.title || suggestTitle(messages)}
          looseScript={state.looseScript}
          onClose={() => setOpenFor(null)}
          onMade={(m) => {
            setOpenFor(null);
            setMade({ for: conversationId, made: m, stay: false });
            /* The sidebar's project list, quietly; this screen keeps its state. */
            router.refresh();
          }}
        />
      ) : null}
    </Shell>
  );
}

/**
 * The bar itself: a slim row across the top of the thread, or, in a side
 * panel, a one-line card that stays at the top of the panel's scroll (about
 * 30px: those panels leave the thread little room as it is).
 */
function Shell({ compact, tone, boxRef, children }: { compact: boolean; tone?: "ok"; boxRef?: React.Ref<HTMLDivElement>; children: React.ReactNode }) {
  if (compact) {
    return (
      <div
        ref={boxRef}
        data-project-bridge=""
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          padding: tone ? 0 : "3px 3px 3px 7px",
          borderRadius: 9,
          border: `1px solid ${tone ? "#c3e6e0" : "#ecebe7"}`,
          background: tone ? "#f4fbf8" : "#fafaf9",
          /* Covers the panel's top padding while the thread scrolls under it. */
          boxShadow: "0 -14px 0 #fff",
        }}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      ref={boxRef}
      data-project-bridge=""
      style={{
        position: "relative",
        zIndex: 6,
        flexShrink: 0,
        minHeight: 40,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 24px",
        borderBottom: `1px solid ${tone ? "#d6eee7" : "#f0efec"}`,
        background: tone ? "#f4fbf8" : "#fafaf9",
      }}
    >
      {children}
    </div>
  );
}

/** The project's mark: a clapper in a soft tile, as the projects list draws one. */
function ProjectMark({ compact = false }: { compact?: boolean }) {
  return (
    <span style={{ width: compact ? 18 : 20, height: compact ? 18 : 20, borderRadius: compact ? 5 : 6, background: "#f0efec", color: "#525252", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Icon name="clapper" size={12} />
    </span>
  );
}

/**
 * The confirm form: name, brief, who can see it. The name starts as the
 * cleaned first ask and the brief as nothing; the suggestion route fills
 * both in a few seconds, except what the person has already typed in.
 */
function CreateForm({
  zh,
  compact,
  anchor,
  conversationId,
  initialTitle,
  looseScript,
  onClose,
  onMade,
}: {
  zh: boolean;
  compact: boolean;
  /** The bar: the full form hangs under it; the side panel's is placed against it. */
  anchor: React.RefObject<HTMLDivElement | null>;
  conversationId: string;
  initialTitle: string;
  looseScript: { id: string; title: string } | null;
  onClose: () => void;
  onMade: (m: Made) => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [title, setTitle] = React.useState(initialTitle);
  const [brief, setBrief] = React.useState("");
  const [access, setAccess] = React.useState<"everyone" | "private">("everyone");
  const [suggesting, setSuggesting] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const touched = React.useRef({ title: false, brief: false });
  const box = React.useRef<HTMLDivElement | null>(null);
  /* Where the side panel's form floats: under the bar when there is room,
     otherwise above it (those panels sit low on the screen), right edges
     together. Worked out after mount and on resize; hidden until then. */
  const [place, setPlace] = React.useState<React.CSSProperties | null>(null);
  React.useEffect(() => {
    if (!compact) return;
    const measure = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 14;
      setPlace(below >= 420 || below >= r.top ? { top: r.bottom + 6, left, width, maxHeight: below } : { bottom: window.innerHeight - r.top + 6, left, width, maxHeight: r.top - 14 });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [compact, anchor]);

  /* The model's title and brief, once, when the form opens. */
  React.useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/chat/project/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId }), signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ title?: string; brief?: string }>) : null))
      .then((s) => {
        if (!s) return;
        if (s.title && !touched.current.title) setTitle(s.title);
        if (s.brief && !touched.current.brief) setBrief(s.brief);
      })
      .catch(() => {
        /* The first ask stays as the name, and the brief is the person's to write. */
      })
      .finally(() => {
        if (!ctl.signal.aborted) setSuggesting(false);
      });
    return () => ctl.abort();
  }, [conversationId]);

  /* Esc, or a press anywhere but the form and its bar, closes it. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (busy || box.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [busy, onClose, anchor]);

  async function submit() {
    if (busy || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/chat/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, title: title.trim(), brief: brief.trim(), access }),
      });
      const j = (await r.json().catch(() => ({}))) as { id?: string; title?: string; existed?: boolean; error?: string };
      if (!r.ok || !j.id) {
        setError(j.error ?? t("没能建成项目，再试一次。", "Could not start the project; try again."));
        return;
      }
      onMade({ id: j.id, title: j.title ?? title.trim(), existed: Boolean(j.existed) });
    } catch {
      setError(t("连不上服务器，再试一次。", "Could not reach the server; try again."));
    } finally {
      setBusy(false);
    }
  }

  const field: React.CSSProperties = { width: "100%", border: "1px solid #e2e2e2", borderRadius: 8, padding: "7px 10px", fontFamily: "inherit", fontSize: 12.5, color: "#171717", outline: "none", background: "#fff", letterSpacing: "inherit" };
  const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "#525252", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 };

  const card: React.CSSProperties = { background: "#fff", border: "1px solid #e6e6e6", borderRadius: 12, boxShadow: "0 16px 40px rgba(0,0,0,0.12)", padding: 14, display: "flex", flexDirection: "column", gap: 12, textAlign: "left" };
  const form = (
    <div
      ref={box}
      role="dialog"
      aria-label={t("建成项目", "Make a project")}
      style={
        compact
          ? { ...card, position: "fixed", zIndex: 1000, overflowY: "auto", ...(place ?? { top: 0, left: 0, width: 340 }), visibility: place ? "visible" : "hidden" }
          : { ...card, position: "absolute", top: "calc(100% + 6px)", right: 16, width: 400, maxWidth: "calc(100% - 32px)" }
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ display: "flex", flexDirection: "column", gap: compact ? 10 : 12 }}
      >
        <div>
          <div style={label}>{t("项目名", "Name")}</div>
          <input
            autoFocus
            value={title}
            maxLength={80}
            onChange={(e) => {
              touched.current.title = true;
              setTitle(e.target.value);
            }}
            placeholder={t("这个视频叫什么", "What is this video called")}
            style={{ ...field, height: 32 }}
          />
        </div>
        <div>
          <div style={label}>
            {t("简介", "Brief")}
            {suggesting ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 400, color: "#8a8a8a" }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: "#0f5bd5", animation: "auraPulse 1.6s ease-in-out infinite" }} />
                {t("正在根据对话整理…", "Summing up the conversation…")}
              </span>
            ) : null}
          </div>
          <textarea
            value={brief}
            maxLength={1000}
            rows={4}
            onChange={(e) => {
              touched.current.brief = true;
              setBrief(e.target.value);
            }}
            placeholder={t("这个视频做什么、为什么值得做（会写进项目，也发到项目对话）", "What the video is and why (goes into the project and its chat)")}
            style={{ ...field, resize: "vertical", lineHeight: 1.55, minHeight: 72 }}
          />
        </div>
        <div>
          <div style={label}>{t("谁能看到", "Who can see it")}</div>
          <div role="radiogroup" style={{ display: "inline-flex", border: "1px solid #e2e2e2", borderRadius: 8, padding: 2, gap: 2, background: "#fafaf9" }}>
            {(
              [
                ["everyone", t("全工作室", "Everyone"), "eye"],
                ["private", t("仅自己", "Only me"), "lock"],
              ] as const
            ).map(([k, name, icon]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={access === k}
                onClick={() => setAccess(k)}
                style={{ height: 26, padding: "0 10px", borderRadius: 6, border: 0, background: access === k ? "#fff" : "transparent", boxShadow: access === k ? "0 0 0 1px #e2e2e2" : "none", color: access === k ? "#171717" : "#7c7c7c", fontFamily: "inherit", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <Icon name={icon} size={12} />
                {name}
              </button>
            ))}
          </div>
        </div>
        {looseScript ? (
          <div style={{ fontSize: 12, color: "#525252", display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="pen" size={12} />
            {t(`编剧在对话里写的脚本《${looseScript.title}》会放进这个项目`, `The script written here, “${looseScript.title}”, goes into the project`)}
          </div>
        ) : null}
        {error ? <div style={{ fontSize: 12, color: "#c42b2b", lineHeight: 1.5 }}>{error}</div> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
          <button type="button" onClick={onClose} disabled={busy} style={button(false)}>
            {t("取消", "Cancel")}
          </button>
          <button type="submit" disabled={busy || !title.trim()} style={{ ...button(true), opacity: busy || !title.trim() ? 0.6 : 1 }}>
            {busy ? t("正在建…", "Starting…") : t("建成项目", "Make the project")}
          </button>
        </div>
      </form>
    </div>
  );
  /* The side panel's form goes to the body, out of the panel's clipping
     scroll box; it only ever renders after a press, never on the server. */
  return compact ? createPortal(form, document.body) : form;
}

function button(primary: boolean, compact = false): React.CSSProperties {
  return {
    height: compact ? 24 : 28,
    padding: compact ? "0 8px" : "0 11px",
    borderRadius: 8,
    border: primary ? "1px solid #171717" : "1px solid #e2e2e2",
    background: primary ? "#171717" : "#fff",
    color: primary ? "#fff" : "#171717",
    fontFamily: "inherit",
    fontSize: compact ? 11.5 : 12,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: compact ? 4 : 6,
    whiteSpace: "nowrap",
    flexShrink: 0,
  };
}
