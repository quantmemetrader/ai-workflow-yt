import * as React from "react";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { Icon } from "@/components/ui/Icon";
import { AGENT_LABELS, AGENT_TINTS, AGENT_COLORS, type AgentKey } from "@/lib/agents/catalog";
import { publishPlatformName } from "@/lib/projects/publication";
import { PROJECT_TABS, nowTab, tabHref, tabStates, type ProjectTab } from "@/lib/projects/tabs";
import type { ProjectDetail, StepPerson } from "@/lib/projects/service";
import { NextStep, bigButton } from "@/components/projects/kit";

/**
 * The project's overview: the five steps as five blocks of one size, one
 * per row, each saying where it stands in one line and opening its page.
 * The client (28 Sep): "one block each row", "each component similar size",
 * and people kept asking how to get to the next step — so the block that
 * is up now says so and carries the page's one black button.
 */
export function StepCards({ p, zh, me }: { p: ProjectDetail; zh: boolean; me: StepPerson | null }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const states = tabStates(p);
  const now = nowTab(p);
  const step = (k: string) => p.steps.find((s) => s.key === k) ?? null;
  const agentName = (a: AgentKey) => (zh ? AGENT_LABELS[a].nameLocal : AGENT_LABELS[a].nameEn);

  const scriptLine = (() => {
    if (!p.script) return step("script")?.line ?? t("还没有脚本", "No script yet");
    if (step("script")?.state === "skipped") return step("script")!.line;
    const s = p.script.status;
    const v = p.script.version ? t(`第 ${p.script.version} 版`, `v${p.script.version}`) : "";
    const n = p.script.beats ? t(`${p.script.beats} 段`, `${p.script.beats} paragraphs`) : "";
    const st = s === "locked" ? t("已批准", "Approved") : s === "awaiting_approval" ? t("等审阅", "Awaiting review") : p.script.beats > 0 ? t("已写好 · 还没审批", "Written · not approved yet") : s === "drafting" ? t("撰写中", "Drafting") : t("待写", "To write");
    return [st, v, n].filter(Boolean).join(" · ");
  })();
  const editLine = (() => {
    const bits: string[] = [];
    bits.push(t(`素材 ${p.video?.clips ?? 0} 段`, `${p.video?.clips ?? 0} clips`));
    if ((p.video?.items ?? 0) > 0) bits.push(t("已有剪辑", "Cut on the timeline"));
    const r = p.render;
    if (r?.state === "done" && r.fileId) bits.push(t("成片已出", "Film rendered"));
    else if (r?.state === "rendering" || r?.state === "queued") bits.push(t(`渲染中 ${r.progress}%`, `Rendering ${r.progress}%`));
    else if (p.director?.state === "running" || p.director?.state === "queued") bits.push(t("剪辑师正在剪", "The editor is cutting"));
    return bits.join(" · ");
  })();
  const publishLine =
    p.published && p.published.platforms.length
      ? t("已发布到 ", "Published on ") + p.published.platforms.map((x) => publishPlatformName(x.key, zh)).join("、")
      : p.render?.state === "done"
        ? t("成片已出，下载改好后上传最终版再发", "Film ready: download, polish, upload the final and post")
        : t("等成片", "Waiting for the film");
  const reviewLine = p.published ? t("看各平台数据，写复盘，把经验交回选题", "See the numbers, write the review, feed it back to topics") : t("发布后这里看数据", "Numbers show here once it is out");

  const rows: { tab: ProjectTab; who: React.ReactNode; line: string; press: string }[] = [
    { tab: "topic", who: <Ai agent="research" name={agentName("research")} />, line: step("topic")?.line ?? "", press: t("查看选题", "Open topic") },
    { tab: "script", who: <Ai agent="script" name={agentName("script")} />, line: scriptLine, press: t("打开脚本", "Open script") },
    {
      tab: "edit",
      who: (
        <>
          <Person person={p.people.clips ?? me} zh={zh} role={t("拍摄上传", "films & uploads")} />
          <Ai agent="video" name={agentName("video")} />
        </>
      ),
      line: editLine,
      press: t("打开剪辑", "Open edit"),
    },
    { tab: "publish", who: <Person person={p.people.deliver ?? me} zh={zh} role={t("发布", "posts")} />, line: publishLine, press: t("打开发布", "Open publish") },
    { tab: "review", who: <Ai agent="research" name={agentName("research")} />, line: reviewLine, press: t("打开复盘", "Open review") },
  ];

  const nowRow = now ? rows.find((r) => r.tab === now) : null;
  /* What to do on the step that is up, in one plain sentence. */
  const todo: Record<ProjectTab, string> = {
    overview: "",
    files: "",
    topic: t("和研究员定下选题", "settle the topic with the researcher"),
    script:
      p.script && p.script.beats > 0
        ? t("看一遍脚本，改好后点「分享」请同事审阅批准", "read the script, edit it, then press Share to get it approved")
        : t("让编剧写初稿，或者自己写", "have the writer draft it, or write it yourself"),
    edit:
      (p.video?.clips ?? 0) === 0
        ? t("主持人拍好口播后上传素材，剪辑师会按脚本粗剪", "upload the host's footage; the editor cuts it to the script")
        : p.render?.state === "done"
          ? t("看成片，没问题就去发布", "watch the film, then go publish")
          : t("素材到了，让剪辑师开剪或自己剪，然后渲染成片", "footage is in: have the editor cut it (or cut it yourself), then render"),
    publish: t("下载 AI 成片，改好后上传最终版，发到各平台", "download the AI film, polish it, upload the final and post it"),
    review: t("看各平台数据，写复盘", "see the numbers and write the review"),
  };
  const tabLabel = (k: ProjectTab) => {
    const x = PROJECT_TABS.find((y) => y.key === k)!;
    return zh ? x.zh : x.en;
  };

  return (
    <>
      {p.status === "active" && nowRow ? (
        <NextStep state="you" zh={zh} text={<><b>{t(`第 ${PROJECT_TABS.find((x) => x.key === now)!.n} 步「${tabLabel(now!)}」`, `Step ${PROJECT_TABS.find((x) => x.key === now)!.n}, ${tabLabel(now!)}`)}</b>{t("：", ": ")}{todo[now!]}</>}>
          <Link prefetch={false} href={tabHref(p.id, now!)} style={bigButton("primary")}>
            {t(`去${tabLabel(now!)}`, `Go to ${tabLabel(now!)}`)} <Arrow />
          </Link>
        </NextStep>
      ) : p.status === "done" ? (
        <NextStep state="done" zh={zh} text={t("这条已经发布了。去「复盘」看数据。", "This one is out. See the numbers under Review.")}>
          <Link prefetch={false} href={tabHref(p.id, "review")} style={bigButton("primary")}>
            {t("去复盘", "Go to review")} <Arrow />
          </Link>
        </NextStep>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r) => {
          const tab = PROJECT_TABS.find((x) => x.key === r.tab)!;
          const state = states[r.tab] ?? "todo";
          const isNow = r.tab === now;
          const back = r.tab === "script" ? p.sentBack.script : r.tab === "edit" ? (p.sentBack.edit ?? p.sentBack.clips) : r.tab === "topic" ? p.sentBack.topic : r.tab === "publish" ? p.sentBack.deliver : undefined;
          const openBack = back && back.state !== "done" ? back : null;
          return (
            <Link
              key={r.tab}
              prefetch={false}
              href={tabHref(p.id, r.tab)}
              className="sc-row"
              data-now={isNow ? "1" : undefined}
              style={{ display: "grid", gridTemplateColumns: "40px minmax(0,1fr) auto", alignItems: "center", gap: 14, minHeight: 92, padding: "14px 18px", borderRadius: 14, textDecoration: "none", color: "inherit", background: "#fff", border: `1px solid ${isNow ? "#f0c77e" : "#e7e6e2"}`, boxShadow: isNow ? "0 0 0 3px #fff4df" : "0 1px 2px rgba(0,0,0,.03)" }}
            >
              <span style={{ width: 34, height: 34, borderRadius: 99, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, background: state === "done" ? "#22a061" : isNow ? "#f0a53a" : "#fff", color: state === "done" || isNow ? "#fff" : "#8a8a8a", border: state === "done" || isNow ? "none" : "1.5px solid #d4d4d0" }}>
                {state === "done" ? <Icon name="check" size={16} /> : tab.n}
              </span>
              <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 16, fontWeight: 600, color: "#171717" }}>{zh ? tab.zh : tab.en}</span>
                  {isNow ? <span style={{ fontSize: 11.5, fontWeight: 600, color: "#95590a", background: "#fff4df", border: "1px solid #f4ddb0", borderRadius: 99, padding: "0 8px", lineHeight: "20px" }}>{t("现在做这一步", "Do this now")}</span> : state === "done" ? <span style={{ fontSize: 11.5, fontWeight: 600, color: "#1e7a4f" }}>{t("已完成", "Done")}</span> : null}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{r.who}</span>
                </span>
                <span style={{ fontSize: 13, color: "#5f5f5f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.line}</span>
                {openBack ? (
                  <span style={{ fontSize: 12.5, color: "#95590a", background: "#fff6e5", border: "1px solid #f4ddb0", borderRadius: 8, padding: "3px 8px", alignSelf: "flex-start", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t("退回意见：", "Sent back: ")}
                    {openBack.note}
                  </span>
                ) : null}
              </span>
              <span style={isNow ? bigButton("primary") : { ...bigButton("secondary"), height: 36, fontSize: 13 }}>
                {r.press} <Arrow />
              </span>
            </Link>
          );
        })}
      </div>
      <style>{`.sc-row{transition:border-color .15s ease, box-shadow .15s ease}.sc-row:hover{border-color:#c9c8c2 !important}.sc-row[data-now]:hover{border-color:#e8b45a !important}`}</style>
    </>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Ai({ agent, name }: { agent: AgentKey; name: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 22, padding: "0 8px 0 3px", borderRadius: 99, background: AGENT_TINTS[agent], color: AGENT_COLORS[agent], fontSize: 12, fontWeight: 600 }}>
      <AgentIcon agent={agent} size={17} radius={5} />
      {name}
      <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden>
        <path d="M10 2.5c.5 4.6 2.9 7 7.5 7.5-4.6.5-7 2.9-7.5 7.5-.5-4.6-2.9-7-7.5-7.5 4.6-.5 7-2.9 7.5-7.5z" fill="currentColor" />
      </svg>
      <span style={{ fontSize: 10.5, letterSpacing: ".04em" }}>AI</span>
    </span>
  );
}

function Person({ person, zh, role }: { person: StepPerson | null; zh: boolean; role: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#404040" }}>
      <PersonAvatar id={person?.id ?? "host"} url={person?.avatarUrl ?? null} name={person?.name ?? (zh ? "主持人" : "Host")} size={20} />
      {person?.name ?? (zh ? "主持人" : "Host")}
      <span style={{ color: "#9a9a9a" }}>· {role}</span>
    </span>
  );
}
