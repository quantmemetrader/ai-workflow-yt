"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { Fold } from "@/components/ui/Fold";
import { AGENT_COLORS, AGENT_LABELS, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import { sendChannelMessage } from "@/app/(app)/chat/actions";
import { notify } from "@/lib/client/notify";
import type { ProjectDetail, ProjectStep } from "@/lib/projects/service";

/**
 * Home, project by project.
 *
 * `ProjectProgress`: every project in progress and where it stands, one
 * row each, the step that needs somebody in black.
 * `ProjectChats`: the last few messages from each of those projects, and
 * the whole conversation with a reply box one press away, so the studio can
 * keep several projects moving without opening any of them.
 */
export function ProjectProgress({ projects, zh }: { projects: ProjectDetail[]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  return (
    <Fold id="home-projects" title={t("进行中的项目", "Projects in progress")} sub={String(projects.length)} resizable={false} icon={<Icon name="film" size={15} color="#525252" />}>
      {projects.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "#999999", padding: "6px 0" }}>{t("还没有进行中的项目。在上面交代一件事就会开一个。", "Nothing in progress. Give the team a task above and a project starts.")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {projects.map((p) => {
            const now = p.steps.find((s) => s.state === "you") ?? p.steps.find((s) => s.state === "running") ?? p.steps.find((s) => s.state === "todo") ?? null;
            return (
              <Link key={p.id} href={`/projects/${p.id}`} style={{ display: "block", padding: "10px 12px", border: "1px solid #ececec", borderRadius: 12, background: "#fff", textDecoration: "none", color: "#171717" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0, flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
                  {now ? (
                    <span style={{ fontSize: 11.5, whiteSpace: "nowrap", color: now.state === "you" ? "#fff" : now.state === "running" ? "#0f5bd5" : "#7c7c7c", background: now.state === "you" ? "#171717" : now.state === "running" ? "#e6effd" : "#f3f3f1", borderRadius: 999, padding: "2px 9px" }}>
                      {now.state === "you" ? t("等你：", "Needs you: ") : ""}
                      {now.label}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11.5, color: "#0b7a63" }}>{t("完成", "Done")}</span>
                  )}
                  <Icon name="external" size={12} color="#b3b3b3" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${p.steps.length}, minmax(0,1fr))`, gap: 4, marginTop: 9 }}>
                  {p.steps.map((s) => (
                    <StepBar key={s.key} step={s} />
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: "#7c7c7c", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{now ? now.line : t("已交付", "Delivered")}</div>
              </Link>
            );
          })}
        </div>
      )}
    </Fold>
  );
}

function StepBar({ step: s }: { step: ProjectStep }) {
  const color = s.owner === "you" ? "#171717" : AGENT_COLORS[s.owner as AgentKey];
  const bg =
    s.state === "done"
      ? color
      : s.state === "running"
        ? `linear-gradient(90deg, ${color} 50%, #e8e8e6 50%)`
        : s.state === "you"
          ? "#171717"
          : s.state === "skipped"
            ? "repeating-linear-gradient(135deg,#ededeb 0 4px,#f7f7f5 4px 8px)"
            : "#e8e8e6";
  return <span title={`${s.label} · ${s.line}`} style={{ height: 5, borderRadius: 3, background: bg, opacity: s.state === "done" ? 0.85 : 1 }} />;
}

export function ProjectChats({ projects, zh }: { projects: ProjectDetail[]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <Fold id="home-project-chats" title={t("项目对话", "Project chats")} sub={t("每个项目最近在聊什么", "What each project is talking about")} icon={<Icon name="chat" size={15} color="#525252" />} flush height={460}>
      {projects.length === 0 ? <div style={{ fontSize: 12.5, color: "#999999", padding: 14 }}>{t("还没有项目对话。", "No project chats yet.")}</div> : null}
      {projects.map((p, i) => (
        <ProjectChat key={p.id} project={p} zh={zh} first={i === 0} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />
      ))}
    </Fold>
  );
}

function ProjectChat({ project: p, zh, first, open, onToggle }: { project: ProjectDetail; zh: boolean; first: boolean; open: boolean; onToggle: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [pending, start] = React.useTransition();
  const [waitingSince, setWaitingSince] = React.useState<string | null>(null);
  const shown = open ? p.messages.slice(-10) : p.messages.slice(-3);
  const last = p.messages[p.messages.length - 1];
  const lastAgent = last?.agent ?? null;
  const answered = waitingSince !== null && p.messages.some((m) => m.agent && m.at > waitingSince);

  React.useEffect(() => {
    if (!waitingSince || answered) return;
    const until = Date.now() + 120_000;
    const id = setInterval(() => (Date.now() > until ? clearInterval(id) : router.refresh()), 4000);
    return () => clearInterval(id);
  }, [waitingSince, answered, router]);

  function send() {
    const v = text.trim();
    if (!v) return;
    start(async () => {
      const res = await sendChannelMessage(p.channel.slug, v);
      if (res?.error) {
        notify(res.error);
        return;
      }
      setText("");
      if (parseAgentMentions(v).length || ("answering" in res && res.answering)) setWaitingSince(new Date().toISOString());
      router.refresh();
    });
  }

  return (
    <div style={{ borderTop: first ? "none" : "1px solid #f0f0f0" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px 6px", border: 0, background: "transparent", cursor: "pointer", font: "inherit", textAlign: "left" }}>
        <svg viewBox="0 0 24 24" aria-hidden style={{ width: 12, height: 12, flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease", stroke: "#999999", fill: "none", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }}>
          <path d="M9.5 6.5 15 12l-5.5 5.5" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#171717", minWidth: 0, flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
        {last ? <span style={{ fontSize: 11, color: "#b3b3b3", whiteSpace: "nowrap" }}>{ago(last.at, zh)}</span> : null}
        <Link href={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: 11.5, color: "#525252", textDecoration: "none", whiteSpace: "nowrap" }}>
          {t("打开", "Open")}
        </Link>
      </button>
      <div style={{ padding: "0 14px 10px 34px", display: "flex", flexDirection: "column", gap: 6 }}>
        {shown.length === 0 ? <div style={{ fontSize: 12, color: "#b3b3b3" }}>{t("还没有消息", "No messages yet")}</div> : null}
        {shown.map((m) => (
          <div key={m.id} style={{ display: "flex", gap: 7, alignItems: "flex-start", minWidth: 0 }}>
            {m.agent ? (
              <AgentIcon agent={m.agent} size={18} radius={5} />
            ) : (
              <span style={{ width: 18, height: 18, borderRadius: 5, background: "#e8e8e6", fontSize: 9.5, fontWeight: 600, color: "#525252", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{m.author.slice(0, 1).toUpperCase()}</span>
            )}
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "#2b343d", minWidth: 0, ...(open ? { whiteSpace: "pre-wrap" } : { overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }) }}>
              <b style={{ fontWeight: 600, color: m.agent ? AGENT_COLORS[m.agent] : "#171717" }}>{m.agent ? (zh ? AGENT_LABELS[m.agent].nameLocal : AGENT_LABELS[m.agent].name) : m.author}</b> {m.body.replace(/\*\*/g, "").slice(0, open ? 1200 : 200)}
            </div>
          </div>
        ))}
        {waitingSince && !answered ? (
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#525252" }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: "#278f5e", animation: "auraPulse 1.6s ease-in-out infinite" }} />
            {t("同事正在回复…", "A colleague is answering…")}
          </div>
        ) : null}
        {open ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            style={{ display: "flex", gap: 6, marginTop: 4 }}
          >
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={lastAgent ? t(`回复${AGENT_LABELS[lastAgent].nameLocal}…（不用 @）`, `Reply to ${AGENT_LABELS[lastAgent].name}… (no tag needed)`) : t("在这个项目里说…（@ 同事）", "Say something in this project… (@ a colleague)")}
              style={{ flexGrow: 1, minWidth: 0, height: 32, padding: "0 10px", border: "1px solid #e2e2e2", borderRadius: 9, outline: "none", fontFamily: "inherit", fontSize: 12.5 }}
            />
            <button type="submit" disabled={pending || !text.trim()} style={{ height: 32, padding: "0 12px", borderRadius: 9, border: 0, background: text.trim() ? "#171717" : "#ededed", color: text.trim() ? "#fff" : "#999999", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>
              {t("发送", "Send")}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function ago(iso: string, zh: boolean): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return zh ? "刚刚" : "now";
  if (mins < 60) return zh ? `${mins} 分钟前` : `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return zh ? `${h} 小时前` : `${h}h`;
  return zh ? `${Math.round(h / 24)} 天前` : `${Math.round(h / 24)}d`;
}
