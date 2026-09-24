"use client";

import * as React from "react";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_COLORS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import type { ScriptRun } from "@/lib/script/run";

/**
 * Where this script is in the line of work, beside the words.
 *
 * Six steps, top to bottom, each the employee that does it and what the
 * tables say it did: the topic 研究员 found, the to-do 策划 wrote, every
 * version 编剧 wrote and who wrote it, the approval, the project 剪辑师 is
 * cutting and how far, and what 撰稿人 sent out. Every step opens the thing
 * itself. Nothing here writes.
 */
type State = "done" | "running" | "you" | "todo";

export function RunPanel({ run, zh, onApprove }: { run: ScriptRun; zh: boolean; onApprove?: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const latest = run.versions[run.versions.length - 1] ?? null;
  const recent = run.recent;

  const steps: { owner: AgentKey | "you"; name: string; line: string; state: State; href?: string; sub?: string }[] = [
    {
      owner: "research",
      name: t("选题", "Topic"),
      line: run.topic ? run.topic.name : t("没有绑定选题", "not tied to a topic"),
      state: run.topic ? "done" : "todo",
      href: run.topic?.href,
    },
    {
      owner: "planning",
      name: t("排进计划", "On the plan"),
      line: run.plan ? `${run.plan.date} · ${run.plan.text}` : t("不在今天的计划里", "not on today's plan"),
      state: run.plan ? "done" : "todo",
      href: run.plan?.href,
    },
    {
      owner: "script",
      name: t("文稿", "Script"),
      line:
        run.status === "locked"
          ? `${t("第", "v")}${run.lockedVersion ?? latest?.no ?? ""}${t(" 版已锁", " locked")}`
          : run.status === "awaiting_approval"
            ? `${t("第", "v")}${latest?.no ?? ""}${t(" 版已交审", " sent for approval")}`
            : run.status === "drafting"
              ? recent
                ? t("正在写", "writing now")
                : latest
                  ? `${t("第", "v")}${latest.no}${t(" 版 · 草稿在改", " · draft being edited")}`
                  : t("草稿写着", "drafting")
              : t("有简报，还没写", "brief only, not written"),
      state: run.status === "locked" || run.status === "awaiting_approval" ? "done" : run.status === "drafting" && recent ? "running" : "you",
      sub: latest ? `${latest.by ?? "—"} · ${clock(latest.at)}${latest.model ? ` · ${latest.model.replace(/^[^/]+\//, "")}` : ""}` : undefined,
    },
    {
      owner: "you",
      name: t("批准", "Approve"),
      line:
        run.status === "locked"
          ? `${run.approval?.by ?? t("已批准", "approved")}${run.approval?.at ? ` · ${clock(run.approval.at)}` : ""}`
          : run.status === "awaiting_approval"
            ? t("等你批准", "waiting for you")
            : run.approval?.state === "rejected"
              ? t("上次被退回", "last one sent back")
              : t("写完后", "after the script"),
      state: run.status === "locked" ? "done" : run.status === "awaiting_approval" ? "you" : "todo",
    },
    {
      owner: "video",
      name: t("粗剪", "Rough cut"),
      line: run.project
        ? run.project.job
          ? run.project.job.type === "video.export"
            ? `${t("正在渲染", "rendering")}${run.project.job.progress > 0 ? ` ${Math.round(run.project.job.progress * 100)}%` : ""}`
            : run.project.job.type === "video.transcribe"
              ? t("正在转写素材", "transcribing footage")
              : `${t("正在粗剪", "cutting")}${run.project.job.progress > 0 ? ` ${Math.round(run.project.job.progress * 100)}%` : ""}`
          : run.project.master
            ? t("成片已出", "master ready")
            : run.project.segments > 0
              ? `${run.project.segments} ${t("段", "segments")}`
              : t("项目已建，等素材", "project made, waiting for footage")
        : run.status === "locked"
          ? t("还没交给剪辑师", "not handed over yet")
          : t("批准后自动开始", "starts on approval"),
      state: run.project ? (run.project.job ? "running" : run.project.master || run.project.segments > 0 ? "done" : "todo") : "todo",
      href: run.project?.href,
      sub: run.project?.title,
    },
    {
      owner: "article",
      name: t("发布", "Publish"),
      line: run.post
        ? run.post.state === "published"
          ? t("已发布", "published")
          : run.post.state === "awaiting_approval"
            ? t("文案等你批", "copy waiting for you")
            : t("文案在写", "copy in progress")
        : run.article
          ? `${t("文章", "Article")}：${run.article.title}`
          : t("等成片", "after the cut"),
      state: run.post ? (run.post.state === "published" ? "done" : run.post.state === "awaiting_approval" ? "you" : "running") : run.article ? "done" : "todo",
      href: run.post?.href ?? run.article?.href,
    },
  ];

  return (
    <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "12px 13px 14px" }}>
      {steps.map((s, i) => {
        const color = s.owner === "you" ? "#171717" : AGENT_COLORS[s.owner];
        const dark = s.owner === "you";
        const dim = s.state === "todo";
        const box: React.CSSProperties =
          s.state === "running"
            ? { border: "1px solid transparent", background: "linear-gradient(#fff, #fff) padding-box, linear-gradient(135deg, #278f5e, #0f5bd5) border-box" }
            : dark && s.state !== "todo"
              ? { border: "1px solid #171717", background: "#171717", color: "#fff" }
              : dim
                ? { border: "1px dashed #d9d9d9", background: "transparent" }
                : { border: "1px solid #e2e2e2", background: "#fff" };
        const inner = (
          <div style={{ ...box, borderRadius: 10, padding: "8px 10px", display: "flex", gap: 9, alignItems: "flex-start" }}>
            {s.owner === "you" ? (
              <span style={{ width: 20, height: 20, borderRadius: 6, background: dark && !dim ? "#fff" : "#e2e2e2", color: "#171717", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                {t("你", "U")}
              </span>
            ) : (
              <AgentIcon agent={s.owner} size={20} radius={6} />
            )}
            <div style={{ minWidth: 0, flexGrow: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: dark && !dim ? "#fff" : dim ? "#999999" : "#171717", whiteSpace: "nowrap" }}>
                  {s.owner === "you" ? t("你", "You") : zh ? AGENT_LABELS[s.owner].nameLocal : AGENT_LABELS[s.owner].name}
                  <span style={{ fontWeight: 400, color: dark && !dim ? "#b3b3b3" : "#999999" }}> · {s.name}</span>
                </span>
                <span style={{ flexGrow: 1 }} />
                {s.state === "running" ? <span style={{ width: 6, height: 6, borderRadius: 3, background: color, animation: "auraPulse 1.6s ease-in-out infinite", flexShrink: 0 }} /> : null}
                {s.state === "done" ? <Tick color={dark ? "#8fd3ae" : "#0b7a63"} /> : null}
              </div>
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.5,
                  marginTop: 2,
                  color: s.state === "running" ? color : s.state === "you" ? (dark ? "#fff" : "#171717") : dim ? "#b3b3b3" : dark ? "#d9d9d9" : "#525252",
                  fontWeight: s.state === "running" || s.state === "you" ? 500 : 400,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {s.line}
              </div>
              {s.sub ? <div style={{ fontSize: 10.5, color: dark && !dim ? "#8a8a8a" : "#999999", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.sub}</div> : null}
              {s.owner === "you" && s.state === "you" && onApprove ? (
                <button type="button" onClick={onApprove} style={{ marginTop: 7, height: 26, padding: "0 10px", borderRadius: 7, border: "1px solid #fff", background: "#fff", color: "#171717", fontSize: 11.5, fontWeight: 500, fontFamily: "inherit", cursor: "pointer" }}>
                  {t("去批准", "Go approve")}
                </button>
              ) : null}
            </div>
          </div>
        );
        return (
          <React.Fragment key={s.name}>
            {i > 0 ? <Link_ live={s.state === "running" || s.state === "you"} dashed={s.state === "todo"} /> : null}
            {s.href ? (
              <Link href={s.href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                {inner}
              </Link>
            ) : (
              inner
            )}
          </React.Fragment>
        );
      })}

      {run.versions.length ? (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid #ededed" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{t("它是怎么写的", "How it was written")}</div>
          {run.sources ? <div style={{ fontSize: 11, color: "#999999", marginBottom: 4 }}>{t(`${run.sources} 个来源文件`, `${run.sources} source files`)}</div> : null}
          {run.versions.map((v) => (
            <div key={v.no} style={{ display: "grid", gridTemplateColumns: "40px minmax(0,1fr)", gap: 8, padding: "5px 0", borderTop: "1px solid #f3f3f3", fontSize: 11.5 }}>
              <span style={{ color: "#999999", fontVariantNumeric: "tabular-nums" }}>{clock(v.at)}</span>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 500 }}>{t("第", "v")}{v.no}{t(" 版", "")}</span>
                <span style={{ color: "#7c7c7c" }}> · {v.by ?? "—"}{v.model ? ` · ${v.model.replace(/^[^/]+\//, "")}` : ""}</span>
                {v.note ? <div style={{ color: "#999999", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.note}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Tick({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: color, fill: "none", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round", flexShrink: 0 }} aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function Link_({ live, dashed }: { live: boolean; dashed: boolean }) {
  const id = React.useId().replace(/:/g, "");
  return (
    <svg width="40" height="14" viewBox="0 0 40 14" aria-hidden style={{ display: "block" }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={live ? "#278f5e" : "#cfcbc3"} />
          <stop offset="1" stopColor={live ? "#0f5bd5" : "#a9a6a0"} />
        </linearGradient>
        <marker id={`h${id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 z" fill={live ? "#0f5bd5" : "#a9a6a0"} />
        </marker>
      </defs>
      <path d="M21 0 L21 12" fill="none" stroke={`url(#g${id})`} strokeWidth="1.5" strokeDasharray={dashed ? "3 3" : undefined} markerEnd={`url(#h${id})`} />
    </svg>
  );
}

function clock(iso: string): string {
  const d = new Date(iso);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return today.format(d) === today.format(new Date()) ? time : `${today.format(d).slice(5)} ${time}`;
}
