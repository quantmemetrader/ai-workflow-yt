"use client";

import { Icon } from "@/components/ui/Icon";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { MentionMenu, type MentionPerson } from "@/components/chat/MentionMenu";
import { useMentions } from "@/components/chat/useMentions";
import { AGENT_COLORS, AGENT_LABELS, agentTag, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import { pressCardAction, sendChannelMessage } from "@/app/(app)/chat/actions";
import { renameProjectAction, setProjectStatusAction } from "@/app/(app)/projects/actions";
import { addClipAction, addItemAction, autoEditAction, directAction, exportAction } from "@/app/(app)/video/actions";
import { uploadFiles } from "@/lib/client/upload";
import { beginWork } from "@/lib/client/busy";
import { notify } from "@/lib/client/notify";
import type { ProjectDetail, ProjectStep } from "@/lib/projects/service";

/**
 * One project, and only it.
 *
 * Left: where it stands (five steps), and what it has made so far: the
 * script, the host's clips, the rendered video playing in place. Right: the
 * project's own conversation with the five employees, who work inside this
 * project's script and video when tagged here. Nothing on this page is
 * about any other piece of work.
 */
export function ProjectScreen({ project: p, zh, people }: { project: ProjectDetail; zh: boolean; people: MentionPerson[] }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [draft, setDraft] = React.useState("");
  const [pressing, setPressing] = React.useState<string | null>(null);
  const [sentAt, setSentAt] = React.useState<string | null>(null);
  const [watching, setWatching] = React.useState(false);
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState(p.title);
  const box = React.useRef<HTMLTextAreaElement | null>(null);
  const mentions = useMentions({ people, zh, draft, setDraft, box });

  /* Answers arrive after the request: refresh while one is due. A render in
     progress keeps the page fresh too. */
  const answered = p.messages.some((m) => m.agent && sentAt !== null && m.at > sentAt);
  const waiting = watching && !answered;
  const renderLive = p.render?.state === "queued" || p.render?.state === "rendering";
  React.useEffect(() => {
    if (!(waiting || renderLive)) return;
    const until = Date.now() + 5 * 60_000;
    const id = setInterval(() => {
      if (Date.now() > until) {
        clearInterval(id);
        setWatching(false);
        return;
      }
      router.refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [waiting, renderLive, router]);

  const scroller = React.useRef<HTMLDivElement | null>(null);
  const lastId = p.messages[p.messages.length - 1]?.id;
  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId, waiting]);

  function say(body: string) {
    const text = body.trim();
    if (!text) return;
    start(async () => {
      const res = await sendChannelMessage(p.channel.slug, text);
      if (res?.error) {
        notify(res.error);
        return;
      }
      setDraft("");
      if (parseAgentMentions(text).length || ("answering" in res && res.answering)) {
        setSentAt(new Date().toISOString());
        setWatching(true);
      }
      router.refresh();
    });
  }

  function press(messageId: string, actionId: string) {
    if (pressing) return;
    setPressing(messageId + actionId);
    start(async () => {
      const res = await pressCardAction(p.channel.slug, messageId, actionId);
      setPressing(null);
      if (res?.error) notify(res.error);
      else {
        setSentAt(new Date().toISOString());
        setWatching(true);
        router.refresh();
      }
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
        },
      });
      if (out.uploaded) notify(t(`已上传 ${out.uploaded} 段素材`, `Uploaded ${out.uploaded} clip(s)`), "ok");
      router.refresh();
    } finally {
      done();
    }
  }

  /* A button that runs a tool directly (render, auto cut, the whole video),
     rather than asking in chat. The step above shows it running. */
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  function runTool(key: string, label: string, fn: () => Promise<{ error?: string } | Record<string, never>>) {
    if (busyAction) return;
    setBusyAction(key);
    start(async () => {
      const res = await fn();
      setBusyAction(null);
      if (res && "error" in res && res.error) {
        notify(res.error);
        return;
      }
      notify(t(`已开始：${label}`, `Started: ${label}`), "ok");
      setWatching(true);
      setSentAt(new Date().toISOString());
      router.refresh();
    });
  }

  const lastAgent = [...p.messages].reverse().find((m) => m.agent)?.agent ?? null;
  const lastIsAgent = p.messages[p.messages.length - 1]?.agent ?? null;
  const ask = (key: AgentKey, text: string) => say(`${agentTag(key)} ${text}`);
  const rendered = p.render?.state === "done" && p.render.fileId ? p.render.fileId : null;

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", ...PAPER }}>
      {/* ================= the project ================= */}
      <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "22px 24px 48px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ minWidth: 0, flexGrow: 1 }}>
              <div style={{ fontSize: 11.5, color: "#999999", display: "flex", gap: 6, alignItems: "center" }}>
                <Link href="/projects" style={{ color: "#999999", textDecoration: "none" }}>
                  {t("项目", "Projects")}
                </Link>
                <span>/</span>
                <span>{p.mode.startsWith("direct:") ? t("直接交代", "Straight to an employee") : t("完整流程", "Full line")}</span>
              </div>
              {naming ? (
                <form
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
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setNaming(false)} style={{ fontSize: 22, fontWeight: 600, border: "1px solid #d9d9d9", borderRadius: 8, padding: "2px 8px", width: "100%", fontFamily: "inherit" }} />
                </form>
              ) : (
                <h1 onDoubleClick={() => setNaming(true)} title={t("双击改名", "Double-click to rename")} style={{ fontSize: 22, fontWeight: 600, margin: "4px 0 0", letterSpacing: "-0.01em", cursor: "text" }}>
                  {p.title}
                </h1>
              )}
              {p.brief ? <p style={{ margin: "6px 0 0", fontSize: 13, color: "#7c7c7c", lineHeight: 1.6 }}>{p.brief.replace(/@\S+/g, "").trim().slice(0, 200)}</p> : null}
            </div>
            <StatusPill status={p.status} zh={zh} />
          </div>

          {/* ---- where it stands ---- */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 8 }}>
            {p.steps.map((s, i) => (
              <StepCard key={s.key} step={s} n={i + 1} zh={zh} />
            ))}
          </div>

          {/* ---- the topic ---- */}
          <Card icon={<AgentIcon agent="research" size={26} radius={7} />} title={t("选题", "Topic")} sub={p.source?.label ?? t("你定的题", "Your topic")}>
            <ActionBar>
              <Action icon="spark" label={t("补充证据", "Find evidence")} onClick={() => ask("research", t("为这个项目的选题找 3 条真实数据证据（平台、播放或热度、链接），只用工具查到的数字。", "Find 3 real pieces of evidence for this project's topic (platform, views or heat, link), numbers from tools only."))} disabled={pending} />
              <Action icon="bulb" label={t("给 3 个角度", "3 angles")} onClick={() => ask("research", t("给这个项目 3 个适合本频道的切入角度，每个一句话，说明为什么。", "Give 3 angles for this project that suit our channel, one line each, with why."))} disabled={pending} />
              <Action icon="eye" label={t("看对标怎么做", "How rivals did it")} onClick={() => ask("research", t("找对标账号做过的同题视频，说出播放和他们的开头怎么写。", "Find rival videos on this topic, with their views and how they open."))} disabled={pending} />
            </ActionBar>
          </Card>

          {/* ---- the script ---- */}
          {p.steps.find((s) => s.key === "script")?.state !== "skipped" ? (
            <Card
              icon={<AgentIcon agent="script" size={26} radius={7} />}
              title={t("脚本", "Script")}
              sub={p.script ? (p.script.beats > 0 && p.script.status === "brief" ? t(`草稿 · ${p.script.beats} 个分镜`, `Draft · ${p.script.beats} beats`) : t(`第 ${p.script.version} 版 · ${scriptStatus(p.script.status, zh)}`, `v${p.script.version} · ${scriptStatus(p.script.status, zh)}`)) : "—"}
              right={
                p.script ? (
                  <Link href={`/script/${p.script.id}`} style={{ ...btn(false), textDecoration: "none" }}>
                    {t("打开脚本", "Open the script")} →
                  </Link>
                ) : null
              }
            >
              {p.script?.status === "awaiting_approval" ? (
                <Link href={`/script/${p.script.id}?tab=approval`} style={{ ...btn(true), textDecoration: "none", marginBottom: 8 }}>
                  {t("去批准", "Review and approve")} →
                </Link>
              ) : null}
              <ActionBar>
                <Action primary icon="pen" label={p.script && p.script.beats > 0 ? t("重写一版", "Rewrite") : t("写初稿", "Write the draft")} onClick={() => ask("script", t("写这个项目的脚本初稿，直接写进项目脚本（用 write_script）。", "Write this project's first draft straight into the project's script (write_script)."))} disabled={pending || p.script?.status === "locked"} />
                <Action icon="scissors" label={t("改到 60 秒", "Cut to 60s")} onClick={() => ask("script", t("把项目脚本改到 60 秒以内，保留最有力的三点。", "Cut the project's script to under 60 seconds, keeping the three strongest points."))} disabled={pending || p.script?.status === "locked"} />
                <Action icon="spark" label={t("加强开头", "Stronger hook")} onClick={() => ask("script", t("把项目脚本的开头改得更抓人，前 3 秒给出冲突或数字。", "Make the script's opening grab harder: a conflict or a number in the first 3 seconds."))} disabled={pending || p.script?.status === "locked"} />
                <Action icon="check" label={t("核查事实", "Fact-check")} onClick={() => ask("research", t("核查这个项目脚本里的每个数字和说法，列出需要改的地方和来源。", "Fact-check every number and claim in this project's script; list what to change, with sources."))} disabled={pending} />
              </ActionBar>
            </Card>
          ) : null}

          {/* ---- the host's clips ---- */}
          {p.steps.find((s) => s.key === "clips")?.state !== "skipped" ? (
            <Card
              icon={<span style={{ width: 26, height: 26, borderRadius: 7, background: "#171717", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="clapper" size={15} /></span>}
              title={t("主持人的素材", "The host's clips")}
              sub={p.video ? t(`${p.video.clips} 段素材 · 时间线 ${p.video.items} 段`, `${p.video.clips} clips · ${p.video.items} on the timeline`) : "—"}
              right={
                p.video ? (
                  <Link href={`/video?project=${p.video.id}`} style={{ ...btn(false), textDecoration: "none" }}>
                    {t("打开剪辑台", "Open the editor")} →
                  </Link>
                ) : null
              }
            >
              <label style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", border: "1.5px dashed #9fb8e8", borderRadius: 12, background: "#f5f8fe", cursor: "pointer" }}>
                <span style={{ color: "#0f5bd5", display: "flex" }}><Icon name="upload" size={22} /></span>
                <span style={{ flexGrow: 1 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{t("添加素材", "Add clips")}</span>
                  <span style={{ display: "block", fontSize: 12, color: "#525252", marginTop: 2 }}>{t("上传后自动进时间线并转写，剪辑师接着剪。", "They go onto the timeline and are transcribed; the video agent takes it from there.")}</span>
                </span>
                <span style={btn(true)}>{t("选择文件", "Choose files")}</span>
                <input type="file" multiple accept="video/*,audio/*,image/*" style={{ display: "none" }} onChange={(e) => {
                  if (e.target.files?.length) void upload(e.target.files);
                  e.target.value = "";
                }} />
              </label>
              <div style={{ marginTop: 8 }}>
                <ActionBar>
                  <Action icon="film" label={t("从素材库找画面", "Find stock shots")} onClick={() => ask("video", t("从素材库给这个项目找 3 段合适的画面，放进项目的素材箱。", "Find 3 fitting stock shots for this project and put them in its bin."))} disabled={pending} />
                </ActionBar>
              </div>
            </Card>
          ) : null}

          {/* ---- the video ---- */}
          <Card
            icon={<AgentIcon agent="video" size={26} radius={7} />}
            title={t("成片", "The video")}
            sub={rendered ? t("渲染完成", "Rendered") : renderLive ? t(`渲染中 ${Math.round((p.render?.progress ?? 0) > 1 ? p.render!.progress : (p.render?.progress ?? 0) * 100)}%`, `Rendering ${Math.round((p.render?.progress ?? 0) > 1 ? p.render!.progress : (p.render?.progress ?? 0) * 100)}%`) : t("还没有成片", "Nothing rendered yet")}
            right={
              rendered ? (
                <a href={`/api/files/${rendered}/download`} target="_blank" rel="noreferrer" style={{ ...btn(false), textDecoration: "none" }}>
                  {t("新窗口打开", "Open")} <Icon name="external" size={12} />
                </a>
              ) : null
            }
          >
            {rendered ? (
              <>
                <video controls preload="metadata" src={`/api/files/${rendered}/download`} style={{ width: "100%", maxHeight: 440, borderRadius: 12, background: "#000", display: "block" }} />
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {p.status !== "done" ? (
                    <button type="button" disabled={pending} onClick={() => start(async () => { await setProjectStatusAction(p.id, "done"); router.refresh(); })} style={btn(true)}>
                      <Icon name="check" size={14} strokeWidth={2.2} /> {t("满意，交付", "Approve and deliver")}
                    </button>
                  ) : null}
                  <button type="button" disabled={pending} onClick={() => ask("video", t("再短一点，节奏快一些，重新渲染。", "Make it shorter and tighter, and render again."))} style={btn(false)}>
                    {t("再短一点", "Shorter")}
                  </button>
                  <button type="button" disabled={pending} onClick={() => ask("video", t("换一个更抓人的开头，重新渲染。", "Try a stronger opening, and render again."))} style={btn(false)}>
                    {t("换开头", "New opening")}
                  </button>
                </div>
              </>
            ) : null}
            {p.video ? (
              <div style={{ marginTop: rendered ? 10 : 0 }}>
                <ActionBar>
                  <Action primary icon="spark" label={busyAction === "direct" ? t("开始中…", "Starting…") : t("一键成片", "Make it in one go")} onClick={() => runTool("direct", t("一键成片", "one-go video"), () => directAction(p.video!.id, { brief: (p.brief ?? p.title).replace(/@\S+/g, "").trim() || p.title, aspect: "9:16", render: true }))} disabled={pending || renderLive} />
                  <Action icon="scissors" label={t("自动粗剪", "Auto rough cut")} onClick={() => runTool("autoedit", t("自动粗剪", "auto rough cut"), () => autoEditAction(p.video!.id, zh ? "zh-CN" : "en"))} disabled={pending || !p.video.clips} />
                  <Action icon="play" label={t("渲染 9:16", "Render 9:16")} onClick={() => runTool("r916", t("渲染 9:16", "render 9:16"), () => exportAction(p.video!.id, { aspect: "9:16", burnCaptions: true, captionLanguage: "zh-CN" }))} disabled={pending || renderLive || !p.video.items} />
                  <Action icon="play" label={t("渲染 16:9", "Render 16:9")} onClick={() => runTool("r169", t("渲染 16:9", "render 16:9"), () => exportAction(p.video!.id, { aspect: "16:9", burnCaptions: true, captionLanguage: "zh-CN" }))} disabled={pending || renderLive || !p.video.items} />
                  <Action icon="chat" label={t("交给剪辑师", "Hand to the editor")} onClick={() => ask("video", p.mode === "direct:video" ? t("开始做这个视频，做完渲染出来。", "Make this video and render it.") : t("用这个项目的素材按脚本剪，剪好渲染出来。", "Cut the project's clips to the script and render it."))} disabled={pending} />
                </ActionBar>
              </div>
            ) : null}
          </Card>
          {/* ---- delivery ---- */}
          <Card icon={<AgentIcon agent="article" size={26} radius={7} />} title={t("交付", "Deliver")} sub={p.status === "done" ? t("已交付", "Delivered") : t("成片之后", "After the cut")}>
            <ActionBar>
              <Action icon="pen" label={t("写各平台文案", "Write platform copy")} onClick={() => ask("article", t("为这个项目写 YouTube、小红书、抖音、微博的标题、简介和标签，各一版。", "Write titles, descriptions and tags for YouTube, Rednote, Douyin and Weibo for this project."))} disabled={pending} />
              <Action icon="bulb" label={t("封面标题", "Thumbnail lines")} onClick={() => ask("article", t("给这个项目 5 个封面大字标题，每个不超过 10 个字。", "Give 5 thumbnail headlines for this project, 10 characters or fewer each."))} disabled={pending} />
              <Action primary={Boolean(rendered) && p.status !== "done"} icon="check" label={p.status === "done" ? t("已交付", "Delivered") : t("标记交付", "Mark delivered")} onClick={() => start(async () => { await setProjectStatusAction(p.id, p.status === "done" ? "active" : "done"); router.refresh(); })} disabled={pending} />
            </ActionBar>
          </Card>
        </div>
      </div>

      {/* ================= the project's conversation ================= */}
      <aside style={{ width: 420, flexShrink: 0, borderLeft: "1px solid #ececec", background: "#ffffff", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid #f0f0f0" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("项目对话", "Project chat")}</span>
          <span style={{ fontSize: 11.5, color: "#999999" }}>{t("员工在这里干活，只做这个项目", "The team works here, on this project only")}</span>
        </div>
        <div ref={scroller} style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {p.messages.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "#999999", textAlign: "center", padding: "30px 0" }}>{t("还没有对话。@ 一位同事开始。", "No messages yet. @ a colleague to start.")}</div>
          ) : null}
          {p.messages.map((m) =>
            m.agent ? (
              <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <AgentIcon agent={m.agent} size={26} radius={7} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: AGENT_COLORS[m.agent] }}>{zh ? AGENT_LABELS[m.agent].nameLocal : AGENT_LABELS[m.agent].name}</div>
                  <div style={{ marginTop: 2, background: "#f5f7fb", borderRadius: "4px 12px 12px 12px", padding: "8px 11px", fontSize: 13, lineHeight: 1.6, color: "#2b343d", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {clean(m.body)}
                    {m.actions.length && !m.done ? (
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        {m.actions.map((a, i) =>
                          a.kind === "open" ? (
                            <Link key={a.id} href={a.href ?? "#"} style={{ ...btn(false), height: 26, fontSize: 11.5, textDecoration: "none" }}>
                              {zh ? a.label : a.labelEn}
                            </Link>
                          ) : (
                            <button key={a.id} type="button" disabled={pending} onClick={() => press(m.id, a.id)} style={{ ...btn(i === 0), height: 26, fontSize: 11.5, opacity: pressing === m.id + a.id ? 0.55 : 1 }}>
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
                <div style={{ fontSize: 11, color: "#b3b3b3", textAlign: "right" }}>{m.author}</div>
                <div style={{ marginTop: 2, background: "#171717", color: "#fff", borderRadius: "12px 4px 12px 12px", padding: "8px 11px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{m.body}</div>
              </div>
            ),
          )}
          {waiting ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#525252" }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: "#278f5e", animation: "auraPulse 1.6s ease-in-out infinite" }} />
              {t("同事正在做…", "A colleague is working on it…")}
            </div>
          ) : null}
        </div>

        <div style={{ position: "relative", borderTop: "1px solid #f0f0f0", padding: 10 }}>
          <MentionMenu matches={mentions.matches} active={mentions.active} zh={zh} onPick={mentions.pick} onHover={mentions.setActive} placement="up" />
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 7 }}>
            {(["research", "script", "video", "article"] as AgentKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setDraft((d) => (d.includes(agentTag(k)) ? d : `${agentTag(k)} ${d}`.trim()));
                  requestAnimationFrame(() => box.current?.focus());
                }}
                className="chip"
                style={{ height: 24, fontSize: 11, gap: 5, cursor: "pointer", borderColor: draft.includes(agentTag(k)) ? "#171717" : "#ededed", background: "#fff" }}
              >
                <AgentIcon agent={k} size={13} radius={4} />
                {zh ? AGENT_LABELS[k].nameLocal : AGENT_LABELS[k].name}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              ref={box}
              rows={2}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                mentions.onValue(e.target.value, e.target.selectionStart ?? e.target.value.length);
              }}
              onBlur={mentions.close}
              onKeyDown={(e) => {
                if (mentions.onKeyDown(e)) return;
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  say(draft);
                }
              }}
              placeholder={
                lastIsAgent && lastAgent
                  ? t(`回复${AGENT_LABELS[lastAgent].nameLocal}…（不用 @）`, `Reply to ${AGENT_LABELS[lastAgent].name}… (no tag needed)`)
                  : t("@ 一位同事交代这个项目的事…", "@ a colleague about this project…")
              }
              style={{ flexGrow: 1, minWidth: 0, border: "1px solid #e2e2e2", borderRadius: 12, padding: "8px 11px", outline: "none", resize: "none", fontFamily: "inherit", fontSize: 13, lineHeight: 1.5, letterSpacing: "inherit" }}
            />
            <button type="button" disabled={pending || !draft.trim()} onClick={() => say(draft)} style={{ ...btn(true), height: 38, opacity: draft.trim() ? 1 : 0.45 }}>
              {t("发送", "Send")}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function StepCard({ step: s, n, zh }: { step: ProjectStep; n: number; zh: boolean }) {
  const you = s.owner === "you";
  const color = you ? "#171717" : AGENT_COLORS[s.owner as AgentKey];
  const frame: React.CSSProperties =
    s.state === "you"
      ? { background: "#171717", color: "#fff", border: "1px solid #171717" }
      : s.state === "running"
        ? { border: "1px solid transparent", background: "linear-gradient(#fff,#fff) padding-box, linear-gradient(135deg,#278f5e,#0f5bd5) border-box" }
        : s.state === "skipped"
          ? { border: "1px dashed #e6e6e6", background: "repeating-linear-gradient(135deg,#fafaf9 0 8px,#f3f3f1 8px 16px)", opacity: 0.7 }
          : s.state === "todo"
            ? { border: "1px dashed #d9d9d9", background: "#fbfbfa" }
            : { border: "1px solid #e2e2e2", background: "#fff" };
  const dim = s.state === "todo" || s.state === "skipped";
  return (
    <div style={{ ...frame, borderRadius: 10, padding: "9px 10px", minWidth: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 7, minWidth: 0 }}>
        <span style={{ opacity: dim ? 0.5 : 1, display: "flex" }}>
          <AgentIcon agent={you ? null : (s.owner as AgentKey)} size={22} radius={6} />
        </span>
        <span style={{ fontSize: 11, lineHeight: 1.3, color: s.state === "you" ? "#b3b3b3" : "#999999", minWidth: 0, overflowWrap: "anywhere" }}>
          {n} · {s.label}
        </span>
        {s.state === "done" ? <span style={{ marginLeft: "auto", color: "#278f5e", display: "flex" }}><Icon name="check" size={13} strokeWidth={2.4} /></span> : null}
      </div>
      <div style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.4, color: s.state === "you" ? "#fff" : s.state === "running" ? color : dim ? "#b3b3b3" : "#525252", fontWeight: s.state === "running" || s.state === "you" ? 500 : 400, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
        {s.line}
      </div>
      <span hidden>{zh}</span>
    </div>
  );
}

function Card({ icon, title, sub, right, children }: { icon: React.ReactNode; title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ background: "#fff", border: "1px solid #e2e2e2", borderRadius: 14, padding: "12px 14px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        {icon}
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        {sub ? <span style={{ fontSize: 12, color: "#999999" }}>{sub}</span> : null}
        <span style={{ flexGrow: 1 }} />
        {right}
      </div>
      {children}
    </section>
  );
}

function StatusPill({ status, zh }: { status: string; zh: boolean }) {
  const [label, color, bg] =
    status === "done" ? [zh ? "已交付" : "Delivered", "#0b7a63", "#e3f4ee"] : status === "archived" ? [zh ? "已归档" : "Archived", "#7c7c7c", "#f0f0f0"] : [zh ? "进行中" : "In progress", "#0f5bd5", "#e6effd"];
  return <span style={{ fontSize: 12, fontWeight: 500, color, background: bg, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>{label}</span>;
}

function scriptStatus(s: string, zh: boolean): string {
  const m: Record<string, [string, string]> = { brief: ["还没写", "not written"], drafting: ["草稿", "draft"], awaiting_approval: ["等批准", "awaiting approval"], locked: ["已锁定", "locked"], archived: ["已归档", "archived"] };
  const v = m[s] ?? [s, s];
  return zh ? v[0] : v[1];
}

function clean(body: string): string {
  return body.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").trim();
}

function btn(primary: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 13px", borderRadius: 9, border: primary ? "1px solid #171717" : "1px solid #e2e2e2", background: primary ? "#171717" : "#fff", color: primary ? "#fff" : "#171717", fontFamily: "inherit", fontSize: 12.5, fontWeight: primary ? 500 : 400, cursor: "pointer", whiteSpace: "nowrap" };
}

const PAPER: React.CSSProperties = { backgroundColor: "#f4f3f0", backgroundImage: "radial-gradient(#d8d5cf 1px, transparent 1px)", backgroundSize: "22px 22px" };

/** A row of one-press actions: the AI driven by buttons, not only by chat. */
function ActionBar({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{children}</div>;
}

function Action({ icon, label, onClick, disabled, primary = false }: { icon: import("@/components/ui/Icon").IconName; label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...btn(primary), height: 30, fontSize: 12, borderRadius: 8, opacity: disabled ? 0.45 : 1, cursor: disabled ? "default" : "pointer" }}>
      <Icon name={icon} size={13} />
      {label}
    </button>
  );
}
