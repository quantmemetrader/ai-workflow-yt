"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { Fold } from "@/components/ui/Fold";
import { AGENT_COLORS, AGENT_LABELS, AGENT_TINTS, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import { sendChannelMessage } from "@/app/(app)/chat/actions";
import { notify } from "@/lib/client/notify";
import type { ProjectDetail, ProjectStep } from "@/lib/projects/service";
import { frontierStep } from "@/lib/home/roles";

/**
 * Home, project by project.
 *
 * `ProjectProgress`: every project in progress and where it stands, one
 * row each, the step that needs somebody in black.
 * `ProjectChats`: the last few messages from each of those projects, and
 * the whole conversation with a reply box one press away, so the studio can
 * keep several projects moving without opening any of them.
 *
 * On a job's Home these are the projects in hand for that job, so the
 * title, the count, the empty line and the way out (`right`, `footer`) come
 * from the page's layout rather than being fixed here.
 */
export function ProjectProgress({
  projects,
  zh,
  title,
  sub,
  empty,
  right,
  footer,
}: {
  projects: ProjectDetail[];
  zh: boolean;
  title?: string;
  /** Beside the title; defaults to how many are shown. */
  sub?: string;
  empty?: string;
  right?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  return (
    <Fold id="home-projects" title={title ?? t("进行中的项目", "Projects in progress")} sub={sub ?? String(projects.length)} resizable={false} icon={<Icon name="film" size={15} color="#525252" />} right={right} footer={footer}>
      <style dangerouslySetInnerHTML={{ __html: PROGRESS_CSS }} />
      {projects.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "#999999", padding: "6px 0" }}>{empty ?? t("还没有进行中的项目。在上面交代一件事就会开一个。", "Nothing in progress. Give the team a task above and a project starts.")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {projects.map((p) => {
            /* Where it has actually got to, by the same rule the role Homes
               filter with — not the first open step, which on a cut whose
               script was never locked is the script. */
            const now = frontierStep(p.steps);
            const tone = !now ? TONE.done : now.state === "you" ? TONE.you : now.state === "running" ? TONE.running : TONE.todo;
            const thumb = p.clipList[0]?.fileId ?? null;
            const done = p.steps.filter((s) => s.state === "done" || s.state === "skipped").length;
            const pct = Math.round((done / Math.max(1, p.steps.length)) * 100);
            return (
              <Link key={p.id} href={`/projects/${p.id}`} prefetch={false} className="pp-card" style={{ ["--pp-tone" as string]: tone.line } as React.CSSProperties}>
                <span className="pp-thumb">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${thumb}/thumb`} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Icon name="clapper" size={22} color="#a9b4cf" />
                  )}
                  <span className="pp-pct" aria-hidden>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                </span>
                <span style={{ minWidth: 0, flexGrow: 1, display: "flex", flexDirection: "column", gap: 9 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0, flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", color: tone.ink, background: tone.bg, borderRadius: 999, padding: "2px 9px 2px 7px" }}>
                      <span className={now?.state === "running" ? "pp-live" : undefined} style={{ width: 6, height: 6, borderRadius: 3, background: tone.dot }} />
                      {!now ? t("已完成", "Done") : now.state === "you" ? t("等你", "Needs you") : now.state === "running" ? t("进行中", "Working") : t("下一步", "Next")}
                    </span>
                  </span>
                  <Stepper steps={p.steps} current={now?.key ?? null} />
                  <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "#7c7c7c", minWidth: 0 }}>
                    {now && now.owner !== "you" ? <AgentIcon agent={now.owner} size={16} radius={5} /> : now ? <Icon name="upload" size={13} color="#b07a1f" /> : <Icon name="check" size={13} color="#1e7a4f" />}
                    <span style={{ minWidth: 0, flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{now ? now.line : t("已交付", "Delivered")}</span>
                    <span className="pp-open">
                      {t("打开", "Open")}
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />
                      </svg>
                    </span>
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Fold>
  );
}

const PROGRESS_CSS = `
.pp-card { display: flex; gap: 14px; padding: 12px 14px 12px 12px; border: 1px solid #efefed; border-radius: 14px; background: #fff; text-decoration: none; color: #171717; box-shadow: 0 1px 2px rgba(0,0,0,.025); transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
.pp-card:hover { border-color: var(--pp-tone, #e3e3e0); box-shadow: 0 4px 14px rgba(20,30,60,.06); }
.pp-card:hover .pp-open { color: #171717; }
.pp-thumb { position: relative; width: 78px; height: 78px; border-radius: 11px; flex-shrink: 0; overflow: hidden; background: linear-gradient(135deg, #eef4fd, #f3effc 55%, #edf7f2); display: flex; align-items: center; justify-content: center; }
.pp-pct { position: absolute; left: 6px; right: 6px; bottom: 6px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.75); overflow: hidden; }
.pp-pct > span { display: block; height: 100%; border-radius: 2px; background: #7fb0ea; }
.pp-open { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; color: #a3a3a3; font-weight: 500; transition: color .15s ease; }
.pp-live { animation: pp-pulse 1.4s ease-in-out infinite; }
@keyframes pp-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.pp-step { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.pp-step::before { content: ""; position: absolute; top: 9px; left: calc(-50% + 12px); right: calc(50% + 12px); height: 2px; border-radius: 1px; background: var(--pp-line, #ececea); }
.pp-step:first-child::before { display: none; }
.pp-dot { position: relative; z-index: 1; width: 20px; height: 20px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.pp-lbl { max-width: 100%; font-size: 11px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

/** Soft tints for where a project stands. */
const TONE = {
  you: { bg: "#fff4df", ink: "#95590a", line: "#f4ddb0", dot: "#f0a53a" },
  running: { bg: "#e9f2fe", ink: "#1f5fbf", line: "#cfe0fb", dot: "#4a90e2" },
  todo: { bg: "#f3f3f1", ink: "#5f5f5f", line: "#e6e6e3", dot: "#b8b8b4" },
  done: { bg: "#e7f6ee", ink: "#1e7a4f", line: "#cbe9d8", dot: "#3fb57a" },
};

/** The host's own steps (upload the clips, approve the cut) in a warm light tint. */
const YOU_TINT = "#fcebc9";
const YOU_INK = "#95590a";

/** The five steps as a small stepper: each dot in its employee's light colour. */
function Stepper({ steps, current }: { steps: ProjectStep[]; current: string | null }) {
  return (
    <span style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0,1fr))` }}>
      {steps.map((s, i) => {
        const tint = s.owner === "you" ? YOU_TINT : AGENT_TINTS[s.owner as AgentKey];
        const ink = s.owner === "you" ? YOU_INK : AGENT_COLORS[s.owner as AgentKey];
        const done = s.state === "done";
        const skipped = s.state === "skipped";
        const isNow = current === s.key;
        const prevDone = i > 0 && (steps[i - 1].state === "done" || steps[i - 1].state === "skipped");
        const dot: React.CSSProperties = done
          ? { background: tint, color: ink }
          : skipped
            ? { background: "#fff", border: "1.5px dashed #d6d6d2", color: "#c4c4c0" }
            : isNow
              ? { background: "#fff", border: `2px solid ${ink}`, boxShadow: `0 0 0 3px ${tint}` }
              : { background: "#f4f4f2", border: "1px solid #e6e6e3" };
        return (
          <span key={s.key} className="pp-step" title={`${s.label} · ${s.line}`} style={{ ["--pp-line" as string]: prevDone ? tint : "#ececea" } as React.CSSProperties}>
            <span className="pp-dot" style={dot}>
              {done ? <Icon name="check" size={11} strokeWidth={2.6} /> : isNow ? <span className={s.state === "running" ? "pp-live" : undefined} style={{ width: 7, height: 7, borderRadius: 4, background: ink }} /> : null}
            </span>
            <span className="pp-lbl" style={{ color: isNow ? ink : done ? "#525252" : "#a8a8a4", fontWeight: isNow ? 600 : 500, textDecoration: skipped ? "line-through" : undefined }}>{s.label}</span>
          </span>
        );
      })}
    </span>
  );
}

export function ProjectChats({ projects, zh, right }: { projects: ProjectDetail[]; zh: boolean; right?: React.ReactNode }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <Fold id="home-project-chats" title={t("项目对话", "Project chats")} sub={t("每个项目最近在聊什么", "What each project is talking about")} icon={<Icon name="chat" size={15} color="#525252" />} flush height={460} right={right}>
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
        <Link href={`/projects/${p.id}`} prefetch={false} onClick={(e) => e.stopPropagation()} style={{ fontSize: 11.5, color: "#525252", textDecoration: "none", whiteSpace: "nowrap" }}>
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
