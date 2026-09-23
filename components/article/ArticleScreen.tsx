"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ModuleSidebar, type ScreenItem } from "@/components/shell/ModuleSidebar";
import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Markdown } from "@/components/ui/Markdown";
import { Badge, Empty, Label, Row, chip, clip, field, ghost, solid, useAction } from "@/components/ui/kit";
import { DESTINATIONS, destinationLabel } from "@/lib/article/destinations";
import type { ArticleDetail, ArticleListItem, ArticleStatus, PublicationRow } from "@/lib/article/service";
import {
  createArticleAction,
  cutVersionAction,
  decideApprovalAction,
  deleteArticleAction,
  draftArticleAction,
  publishArticleAction,
  requestApprovalAction,
  restoreVersionAction,
  retractPublicationAction,
  saveArticleAction,
} from "@/app/(app)/article/actions";

/**
 * Article (P3) — the written sibling of Script.
 *
 * One screen with three views, down the same 212px column every other module
 * uses: the library, the editor, and the publishing log. They are three views
 * of the same articles, so they are one route; which view and which article
 * are both in the URL, so any of them is a link somebody can send.
 *
 * The module's promise is the one Script and Publish already make, and it is
 * visible on the editor: **nothing is published without an approval naming a
 * person**, the approver is never the writer, and the approval names the exact
 * words. What this module does *not* do is send: there is no API for a 公众号
 * or the studio's own site, so publishing here is a person recording where a
 * piece went. The record is the point, and a button that pretended to post
 * would be a lie in the log.
 */
type Tab = "library" | "editor" | "log";

/**
 * Publishing is off.
 *
 * There is no API for a 公众号 or the studio's own site, so the only thing
 * this screen could offer was a person typing in where a piece went by hand —
 * a log nobody asked to keep. Hidden until something actually posts. The
 * service, the actions and the table are untouched: flip this to true and the
 * tab and the box come back.
 */
const PUBLISHING_ENABLED = false;

const TABS: Tab[] = ["library", "editor", "log"];

const ACCENT = "#007be0";

const STATUS_TONE: Record<ArticleStatus, "quiet" | "warn" | "good" | "info"> = {
  draft: "quiet",
  in_review: "warn",
  published: "good",
  archived: "info",
};

const statusLabel = (status: ArticleStatus, zh: boolean) =>
  zh
    ? { draft: "草稿", in_review: "审核中", published: "已发布", archived: "已归档" }[status]
    : { draft: "draft", in_review: "in review", published: "published", archived: "archived" }[status];

/** "2026-09-23 14:02" — the same stamp the publish log uses. Written from the
 * ISO string rather than the reader's locale, because a table that renders one
 * way on the server and another in the browser is a hydration error. */
const stamp = (d: Date) => new Date(d).toISOString().slice(0, 16).replace("T", " ");
const day = (d: Date) => new Date(d).toISOString().slice(0, 10);

export function ArticleScreen({
  articles,
  counts,
  log,
  detail,
  status,
  query,
  approvers,
  scripts,
  viewerId,
  locale,
  model,
}: {
  articles: ArticleListItem[];
  counts: { all: number; draft: number; in_review: number; published: number; archived: number };
  log: PublicationRow[];
  detail: ArticleDetail | null;
  status: ArticleStatus | null;
  query: string;
  approvers: { id: string; name: string }[];
  scripts: { id: string; title: string; status: string }[];
  viewerId: string;
  locale: string;
  model: string;
}) {
  const zh = locale.startsWith("zh");
  const t = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const params = useSearchParams();
  const { busy, run } = useAction();
  const agent = useInlineAgent({ module: "script" }, { key: "article" });

  const [composing, setComposing] = useState(false);
  const [deleting, setDeleting] = useState<ArticleListItem | null>(null);

  const raw = params.get("tab");
  let tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : detail ? "editor" : "library";
  if (tab === "log" && !PUBLISHING_ENABLED) tab = detail ? "editor" : "library";

  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    router.push(s ? `/article?${s}` : "/article");
  };

  const open = (id: string) => go({ id, tab: "editor" });

  const SCREENS: ScreenItem<Tab>[] = [
    { key: "library", label: "Articles", labelZh: "文章", badge: counts.all },
    { key: "editor", label: "Editor", labelZh: "编辑" },
    ...(PUBLISHING_ENABLED
      ? [{ key: "log" as const, label: "Publishing log", labelZh: "发布日志", badge: log.filter((p) => !p.retractedAt).length }]
      : []),
  ];

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", minHeight: 0 }}>
      <ModuleSidebar
        title="Articles"
        titleZh="文章"
        screens={SCREENS}
        active={tab}
        onChange={(next) => go({ tab: next })}
        zh={zh}
        storageKey="article-sidebar"
      />

      <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <header
          style={{
            height: 56,
            flexShrink: 0,
            borderBottom: "1px solid #ededed",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 22px",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t("Articles", "文章")}</span>
          <span style={{ fontSize: 11.5, color: "#999999" }}>
            {t(
              "written pieces, approved the way a script is, with a record of where each one went",
              "与脚本同样的审批流程，并记录每篇文章发往何处",
            )}
          </span>
          <button type="button" onClick={() => setComposing(true)} style={{ ...solid, marginLeft: "auto" }}>
            {t("New article", "新建文章")}
          </button>
        </header>

        <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
          <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", padding: "18px 22px 30px" }}>
            {tab === "library" && (
              <Library
                articles={articles}
                counts={counts}
                status={status}
                query={query}
                zh={zh}
                onStatus={(s) => go({ status: s })}
                onQuery={(q) => go({ q })}
                onOpen={open}
                onDelete={(a) => setDeleting(a)}
                onNew={() => setComposing(true)}
              />
            )}

            {tab === "editor" &&
              (detail ? (
                <Editor
                  key={detail.article.id}
                  detail={detail}
                  approvers={approvers}
                  viewerId={viewerId}
                  zh={zh}
                  busy={busy}
                  run={run}
                />
              ) : (
                <Empty
                  title={t("No article is open", "没有打开的文章")}
                  body={t(
                    "Pick one from Articles, or start a new one. The assistant can write the first draft from a headline and an angle.",
                    "从“文章”里选一篇，或新建一篇。助理可以根据标题和角度写出初稿。",
                  )}
                />
              ))}

            {tab === "log" && PUBLISHING_ENABLED && <LogTable log={log} zh={zh} busy={busy} run={run} onOpen={open} />}
          </div>

          <ResearchAgentPanel
            accent={ACCENT}
            zh={zh}
            scope={t("Articles", "文章")}
            note={agentNote(articles, log, detail, zh)}
            placeholder={t("Ask for an article, or about one…", "让助理写一篇，或询问某篇文章…")}
            model={model}
            onAsk={(prompt) => void agent.send(prompt)}
            thread={
              <InlineAgentThread
                messages={agent.messages}
                notice={agent.notice}
                conversationId={agent.conversationId}
                zh={zh}
              />
            }
          />
        </div>
      </div>

      {composing && (
        <NewArticleDialog
          zh={zh}
          busy={busy}
          scripts={scripts}
          onClose={() => setComposing(false)}
          onCreate={(input) =>
            run(async () => {
              const res = await createArticleAction(input);
              if ("id" in res && res.id) {
                setComposing(false);
                open(res.id);
              }
              return res;
            }, undefined, zh ? "正在新建文章" : "Creating the article")
          }
        />
      )}

      {deleting && (
        <ConfirmDialog
          danger
          title={zh ? `删除“${deleting.title}”？` : `Delete “${deleting.title}”?`}
          body={zh ? "发布记录会保留。" : "Its publishing record is kept."}
          confirm={zh ? "删除" : "Delete"}
          cancel={zh ? "取消" : "Cancel"}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            run(() => deleteArticleAction(id));
          }}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- library */

function Library({
  articles,
  counts,
  status,
  query,
  zh,
  onStatus,
  onQuery,
  onOpen,
  onDelete,
  onNew,
}: {
  articles: ArticleListItem[];
  counts: { all: number; draft: number; in_review: number; published: number; archived: number };
  status: ArticleStatus | null;
  query: string;
  zh: boolean;
  onStatus: (s: string | null) => void;
  onQuery: (q: string) => void;
  onOpen: (id: string) => void;
  onDelete: (a: ArticleListItem) => void;
  onNew: () => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);

  const filters: { key: ArticleStatus | null; label: string; n: number }[] = [
    { key: null, label: t("All", "全部"), n: counts.all },
    { key: "draft", label: t("Draft", "草稿"), n: counts.draft },
    { key: "in_review", label: t("In review", "审核中"), n: counts.in_review },
    { key: "published", label: t("Published", "已发布"), n: counts.published },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
        {filters.map((f) => {
          const on = (f.key ?? null) === status;
          return (
            <button
              key={f.key ?? "all"}
              type="button"
              onClick={() => onStatus(f.key)}
              style={{
                ...chip,
                background: on ? "#171717" : "#fff",
                color: on ? "#fff" : "#525252",
                borderColor: on ? "#171717" : "#ededed",
              }}
            >
              {f.label}
              <span style={{ marginLeft: 6, opacity: 0.65 }}>{f.n}</span>
            </button>
          );
        })}
        <input
          defaultValue={query}
          placeholder={t("Search headlines…", "搜索标题…")}
          onKeyDown={(e) => {
            if (e.key === "Enter") onQuery((e.target as HTMLInputElement).value);
          }}
          style={{ ...field, width: 220, height: 28, marginLeft: "auto" }}
        />
      </div>

      {!articles.length ? (
        <>
          <Empty
            title={query || status ? t("Nothing matches", "没有匹配的文章") : t("No articles yet", "还没有文章")}
            body={t(
              "An article is written here the way a script is: a headline and an angle, a draft the assistant can write, a version somebody approves by name, and then a record of where it went.",
              "文章的写法与脚本相同：先有标题和角度，助理可以写出初稿，由他人具名审批某一版本，最后记录它发往了哪里。",
            )}
          />
          <button type="button" onClick={onNew} style={solid}>
            {t("Start one", "新建一篇")}
          </button>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Row head>
            <span style={{ flexGrow: 1 }}>{t("Headline", "标题")}</span>
            <span style={{ width: 96 }}>{t("State", "状态")}</span>
            <span style={{ width: 88 }}>{t("Length", "字数")}</span>
            <span style={{ width: 120 }}>{t("Owner", "负责人")}</span>
            <span style={{ width: 110 }}>{t("Changed", "更新")}</span>
            <span style={{ width: 54 }} />
          </Row>
          {articles.map((a) => (
            <Row key={a.id} style={{ alignItems: "center" }}>
              <button
                type="button"
                onClick={() => onOpen(a.id)}
                style={{
                  ...clip,
                  flexGrow: 1,
                  textAlign: "left",
                  border: 0,
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: 12.5,
                  color: "#171717",
                }}
                title={a.summary ?? a.title}
              >
                {a.title}
                {a.summary ? (
                  <span style={{ color: "#999999", fontSize: 11.5, marginLeft: 8 }}>{a.summary.slice(0, 70)}</span>
                ) : null}
              </button>
              <span style={{ width: 96 }}>
                <Badge tone={STATUS_TONE[a.status]}>
                  {statusLabel(a.status, zh)}
                  {a.publications > 1 ? ` ·${a.publications}` : ""}
                </Badge>
              </span>
              <span style={{ width: 88, fontSize: 11.5, color: "#7c7c7c" }}>
                {a.wordCount ? (zh ? `${a.wordCount} 字` : `${a.wordCount} words`) : "—"}
              </span>
              <span style={{ width: 120, ...clip, fontSize: 11.5, color: "#7c7c7c" }}>{a.ownerName ?? "—"}</span>
              <span style={{ width: 110, fontSize: 11.5, color: "#7c7c7c" }}>{day(a.updatedAt)}</span>
              <span style={{ width: 54, display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => onDelete(a)}
                  style={{ ...ghost, height: 24, fontSize: 11, padding: "0 8px" }}
                >
                  {t("delete", "删除")}
                </button>
              </span>
            </Row>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- editor */

type Run = ReturnType<typeof useAction>["run"];

function Editor({
  detail,
  approvers,
  viewerId,
  zh,
  busy,
  run,
}: {
  detail: ArticleDetail;
  approvers: { id: string; name: string }[];
  viewerId: string;
  zh: boolean;
  busy: boolean;
  run: Run;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const { article, versions, approvals, publications, liveChecksum, locked } = detail;

  const [title, setTitle] = useState(article.title);
  const [summary, setSummary] = useState(article.summary ?? "");
  const [body, setBody] = useState(article.body);
  const [preview, setPreview] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [approverId, setApproverId] = useState(approvers[0]?.id ?? "");

  /*
   * The server is the source of truth for the words.
   *
   * A refresh after the assistant rewrites the piece, or after a version is
   * restored, has to land in the boxes — but a refresh that changed nothing
   * must not take somebody's half-written paragraph away. The checksum is
   * exactly that distinction, so it is what the boxes follow: when the
   * server's copy is a different document, the editor takes it; while it is
   * the same one, the typing wins.
   *
   * Adjusted during render rather than in an effect (React's own advice for
   * state that follows a prop): an effect would render the stale words once
   * first, and the linter is right to refuse it.
   */
  const [serverChecksum, setServerChecksum] = useState(liveChecksum);
  if (serverChecksum !== liveChecksum) {
    setServerChecksum(liveChecksum);
    setTitle(article.title);
    setSummary(article.summary ?? "");
    setBody(article.body);
  }

  const dirty = title !== article.title || summary !== (article.summary ?? "") || body !== article.body;

  /** The approval that covers *these* words, if there is one. An edit since
   * the approval leaves it behind, which is the whole point of the checksum. */
  const approvedNow = approvals.find((a) => a.state === "approved" && a.checksum === liveChecksum) ?? null;
  const waiting = approvals.find((a) => a.state === "requested") ?? null;
  const iAmAsked = waiting !== null && waiting.approverId === viewerId && waiting.requestedBy !== viewerId;

  const save = (after?: () => void) =>
    run(() => saveArticleAction(article.id, { title, summary, body }), after, zh ? "正在保存" : "Saving");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 860 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <Badge tone={STATUS_TONE[article.status]}>{statusLabel(article.status, zh)}</Badge>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {zh ? `${article.wordCount} 字` : `${article.wordCount} words`}
          {article.version ? ` · v${article.version}` : ""}
          {dirty ? t(" · unsaved", " · 未保存") : ""}
        </span>
        {locked ? (
          <span style={{ fontSize: 11.5, color: "#a35f00" }}>
            {t(
              "Published, so the words are frozen. Retract it in the log to edit.",
              "已发布，内容已锁定。如需修改，请在发布日志中撤回。",
            )}
          </span>
        ) : null}
        <span style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
          <button type="button" onClick={() => setPreview((v) => !v)} style={ghost}>
            {preview ? t("Edit", "编辑") : t("Preview", "预览")}
          </button>
          <button type="button" disabled={busy || locked || !dirty} onClick={() => save()} style={solid}>
            {t("Save", "保存")}
          </button>
        </span>
      </div>

      <input
        value={title}
        disabled={locked}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("Headline", "标题")}
        style={{ ...field, height: 42, fontSize: 17, fontWeight: 600, marginTop: 12 }}
      />
      <textarea
        value={summary}
        disabled={locked}
        onChange={(e) => setSummary(e.target.value)}
        placeholder={t("Standfirst — what it argues, and why now", "导语：文章的论点，以及为什么是现在")}
        rows={2}
        style={{ ...field, height: "auto", padding: "9px 11px", marginTop: 8, lineHeight: 1.6, resize: "vertical" }}
      />

      {preview ? (
        <div
          style={{
            marginTop: 10,
            padding: "14px 16px",
            border: "1px solid #ededed",
            borderRadius: 11,
            background: "#fff",
            minHeight: 260,
          }}
        >
          {body.trim() ? <Markdown text={body} /> : <span style={{ fontSize: 12, color: "#999999" }}>{t("Nothing written yet.", "还没有内容。")}</span>}
        </div>
      ) : (
        <textarea
          value={body}
          disabled={locked}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("The article, in Markdown.", "正文，支持 Markdown。")}
          rows={22}
          style={{
            ...field,
            height: "auto",
            marginTop: 10,
            padding: "12px 14px",
            lineHeight: 1.75,
            fontSize: 13,
            resize: "vertical",
          }}
        />
      )}

      {/* ---- the assistant ---- */}
      <Label>{t("Write it with the assistant", "让助理来写")}</Label>
      <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={instruction}
          disabled={locked}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={t(
            "Anything this pass should do differently. Optional.",
            "这一版需要有什么不同？可留空。",
          )}
          style={{ ...field, flexGrow: 1, minWidth: 240 }}
        />
        <button
          type="button"
          disabled={busy || locked}
          onClick={() =>
            /* Whatever is in the boxes is saved first: the assistant rewrites
               what the article *says*, and it cannot see an edit that never
               left the browser. The action snapshots a version before it
               writes, so this is not how an afternoon gets lost. */
            save(() => run(() => draftArticleAction(article.id, instruction), undefined, zh ? "助理正在写" : "The assistant is writing"))
          }
          style={solid}
        >
          {article.body.trim() ? t("Rewrite it", "重写") : t("Write the draft", "写初稿")}
        </button>
      </div>
      <p style={{ fontSize: 11, color: "#999999", margin: "7px 0 0", lineHeight: 1.6 }}>
        {t(
          "It uses the studio's house style, the channel's own voice, and the script this came from when there is one. It never invents a figure or a quote.",
          "助理会参考工作室的文风、频道自身的语气，以及这篇文章所依据的脚本（如果有）。它不会编造数字或引语。",
        )}
      </p>

      {/* ---- approval ---- */}
      <Label>{t("Approval", "审批")}</Label>
      {iAmAsked && waiting ? (
        <div style={{ border: "1px solid #ededed", borderRadius: 11, padding: 14, background: "#fff" }}>
          <div style={{ fontSize: 12.5, marginBottom: 4 }}>
            {t("You were asked to approve v", "有人请你审批 v")}
            {waiting.versionNo} · {stamp(waiting.requestedAt)}
          </div>
          {waiting.note ? (
            <p style={{ fontSize: 11.5, color: "#7c7c7c", margin: "0 0 10px", lineHeight: 1.6 }}>{waiting.note}</p>
          ) : null}
          <div style={{ display: "flex", gap: 7 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => decideApprovalAction(waiting.id, "approved"))}
              style={solid}
            >
              {t("Approve", "批准")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => decideApprovalAction(waiting.id, "rejected"))}
              style={ghost}
            >
              {t("Send back", "退回")}
            </button>
          </div>
        </div>
      ) : waiting ? (
        <p style={{ fontSize: 12, color: "#7c7c7c", margin: 0, lineHeight: 1.6 }}>
          {t("Waiting on ", "正在等待 ")}
          {waiting.approverName ?? t("an approver", "审批人")}
          {t(" since ", " · 自 ")}
          {stamp(waiting.requestedAt)}
          {t(" — v", " · v")}
          {waiting.versionNo}
        </p>
      ) : approvedNow ? (
        <p style={{ fontSize: 12, color: "#278f5e", margin: 0, lineHeight: 1.6 }}>
          {t("These words are approved. They can be published.", "当前内容已获批准，可以发布。")}
        </p>
      ) : (
        <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={approverId}
            onChange={(e) => setApproverId(e.target.value)}
            style={{ ...field, width: 200 }}
            disabled={locked || !approvers.length}
          >
            {approvers.length ? null : <option value="">{t("Nobody else in the studio", "工作室里没有其他人")}</option>}
            {approvers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || locked || !approverId || !body.trim()}
            onClick={() => save(() => run(() => requestApprovalAction(article.id, approverId)))}
            style={solid}
          >
            {t("Send for approval", "送审")}
          </button>
          <span style={{ fontSize: 11, color: "#999999" }}>
            {t(
              "Saves a version and asks them to approve those exact words.",
              "会先保存一个版本，并请对方批准这一版的确切内容。",
            )}
          </span>
        </div>
      )}
      {approvals.some((a) => a.state === "approved" && a.checksum !== liveChecksum) && !approvedNow ? (
        <p style={{ fontSize: 11, color: "#a35f00", margin: "7px 0 0", lineHeight: 1.6 }}>
          {t(
            "An earlier version was approved, but the words have changed since. It has to be approved again.",
            "此前有版本获得批准，但内容已有改动，需要重新审批。",
          )}
        </p>
      ) : null}

      {/* ---- publishing (off: nothing posts anywhere yet) ---- */}
      {PUBLISHING_ENABLED && <>
      <Label>{t("Publish", "发布")}</Label>
      <PublishBox
        zh={zh}
        busy={busy}
        articleId={article.id}
        approved={approvedNow !== null}
        run={run}
      />
      {publications.length ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column" }}>
          {publications.map((p) => (
            <Row key={p.id} style={{ alignItems: "center" }}>
              <span style={{ width: 110, fontSize: 11.5, color: "#7c7c7c" }}>{day(p.publishedAt)}</span>
              <span style={{ flexGrow: 1, ...clip, fontSize: 12 }}>
                {p.destination}
                <span style={{ color: "#999999", fontSize: 11 }}> · {destinationLabel(p.kind, zh)}</span>
                {p.versionNo ? <span style={{ color: "#999999", fontSize: 11 }}> · v{p.versionNo}</span> : null}
              </span>
              <span style={{ width: 120, ...clip, fontSize: 11.5, color: "#7c7c7c" }}>{p.publishedBy ?? "—"}</span>
              <span style={{ width: 90 }}>
                {p.retractedAt ? (
                  <Badge tone="bad">{t("taken down", "已撤回")}</Badge>
                ) : (
                  <Badge tone="good">{t("live", "在线")}</Badge>
                )}
              </span>
            </Row>
          ))}
        </div>
      ) : null}
      </>}

      {/* ---- versions ---- */}
      <Label>{t("Versions", "版本")}</Label>
      {!versions.length ? (
        <p style={{ fontSize: 11.5, color: "#999999", margin: 0 }}>
          {t("No version has been kept yet.", "还没有保存过版本。")}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {versions.slice(0, 12).map((v) => (
            <Row key={v.id} style={{ alignItems: "center" }}>
              <span style={{ width: 44, fontSize: 12, fontWeight: 500 }}>v{v.versionNo}</span>
              <span style={{ width: 120, fontSize: 11.5, color: "#7c7c7c" }}>{stamp(v.createdAt)}</span>
              <span style={{ flexGrow: 1, ...clip, fontSize: 11.5, color: "#7c7c7c" }}>
                {v.note ?? (v.model ? t("written by the assistant", "由助理撰写") : "—")}
                {v.model ? <span style={{ color: "#c7c7c7" }}> · {v.model}</span> : null}
              </span>
              <span style={{ width: 80, fontSize: 11.5, color: "#7c7c7c" }}>
                {zh ? `${v.wordCount} 字` : `${v.wordCount} w`}
              </span>
              <span style={{ width: 80, display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  disabled={busy || locked}
                  onClick={() => run(() => restoreVersionAction(article.id, v.versionNo))}
                  style={{ ...ghost, height: 24, fontSize: 11, padding: "0 8px" }}
                >
                  {t("restore", "恢复")}
                </button>
              </span>
            </Row>
          ))}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          disabled={busy || locked || !body.trim()}
          onClick={() => save(() => run(() => cutVersionAction(article.id)))}
          style={ghost}
        >
          {t("Keep this as a version", "保存为版本")}
        </button>
      </div>
    </div>
  );
}

/** Recording that an article went out. Deliberately a form and not a button:
 * the product cannot post to a 公众号, and the useful thing is the record. */
function PublishBox({
  zh,
  busy,
  articleId,
  approved,
  run,
}: {
  zh: boolean;
  busy: boolean;
  articleId: string;
  approved: boolean;
  run: Run;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [kind, setKind] = useState(DESTINATIONS[0].kind);
  const [destination, setDestination] = useState("");
  const [url, setUrl] = useState("");

  if (!approved) {
    return (
      <p style={{ fontSize: 11.5, color: "#999999", margin: 0, lineHeight: 1.6 }}>
        {t(
          "Nothing is published without an approval naming a person. Approve these exact words first, and the form appears here.",
          "没有具名批准，任何内容都不会发布。先让他人批准当前这一版内容，表单就会出现在这里。",
        )}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
      <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...field, width: 150 }}>
        {DESTINATIONS.map((d) => (
          <option key={d.kind} value={d.kind}>
            {zh ? d.labelZh : d.label}
          </option>
        ))}
      </select>
      <input
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
        placeholder={t("What it is called there", "该处的名称")}
        style={{ ...field, width: 200 }}
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t("Link, if there is one", "链接（如有）")}
        style={{ ...field, flexGrow: 1, minWidth: 200 }}
      />
      <button
        type="button"
        disabled={busy || !destination.trim()}
        onClick={() =>
          run(
            () => publishArticleAction(articleId, { kind, destination, url }),
            () => {
              setDestination("");
              setUrl("");
            },
            zh ? "正在记录发布" : "Recording the publication",
          )
        }
        style={solid}
      >
        {t("Record it as published", "记录已发布")}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------- log */

function LogTable({
  log,
  zh,
  busy,
  run,
  onOpen,
}: {
  log: PublicationRow[];
  zh: boolean;
  busy: boolean;
  run: Run;
  onOpen: (id: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [retracting, setRetracting] = useState<PublicationRow | null>(null);

  if (!log.length) {
    return (
      <>
        <Empty
          title={t("Nothing has been published yet", "还没有发布记录")}
          body={t(
            "Every article that goes out lands here — where it went, when, and who sent it — with the version it was at the time.",
            "每一篇发出的文章都会记录在这里：发往何处、何时发出、由谁发出，以及当时的版本。",
          )}
        />
        <p style={{ fontSize: 11.5, color: "#999999", lineHeight: 1.6, maxWidth: 520, margin: 0 }}>
          {t(
            "This product cannot post to a 公众号 or the studio's own site, so a publication is something a person records. That record is what makes the log worth having: it answers what went out and when, months later.",
            "本产品无法直接向公众号或工作室官网投稿，因此发布是由人来记录的。正是这条记录让日志有价值：几个月后仍能回答“发了什么、什么时候发的”。",
          )}
        </p>
      </>
    );
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Row head>
          <span style={{ width: 120 }}>{t("When", "时间")}</span>
          <span style={{ flexGrow: 1 }}>{t("Article", "文章")}</span>
          <span style={{ width: 180 }}>{t("Where", "发往")}</span>
          <span style={{ width: 120 }}>{t("By", "发布人")}</span>
          <span style={{ width: 92 }}>{t("State", "状态")}</span>
          <span style={{ width: 62 }} />
        </Row>
        {log.map((p) => (
          <Row key={p.id} style={{ alignItems: "center" }}>
            <span style={{ width: 120, fontSize: 11.5, color: "#7c7c7c" }}>{stamp(p.publishedAt)}</span>
            <span style={{ flexGrow: 1, minWidth: 0 }}>
              <button
                type="button"
                onClick={() => onOpen(p.articleId)}
                style={{
                  ...clip,
                  display: "block",
                  maxWidth: "100%",
                  textAlign: "left",
                  border: 0,
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: 12.5,
                  color: "#171717",
                }}
                title={p.articleTitle}
              >
                {p.articleTitle}
                {p.versionNo ? <span style={{ color: "#999999", fontSize: 11 }}> · v{p.versionNo}</span> : null}
              </button>
              {p.retractedReason ? (
                <span style={{ fontSize: 11, color: "#a35f00", display: "block", marginTop: 3 }}>
                  {p.retractedReason}
                </span>
              ) : null}
            </span>
            <span style={{ width: 180, ...clip, fontSize: 11.5, color: "#7c7c7c" }}>
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer" style={{ color: ACCENT }}>
                  {p.destination}
                </a>
              ) : (
                p.destination
              )}
              <span style={{ color: "#c7c7c7" }}> · {destinationLabel(p.kind, zh)}</span>
            </span>
            <span style={{ width: 120, ...clip, fontSize: 11.5, color: "#7c7c7c" }}>{p.publishedBy ?? "—"}</span>
            <span style={{ width: 92 }}>
              {p.retractedAt ? (
                <Badge tone="bad">{t("taken down", "已撤回")}</Badge>
              ) : (
                <Badge tone="good">{t("published", "已发布")}</Badge>
              )}
            </span>
            <span style={{ width: 62, display: "flex", justifyContent: "flex-end" }}>
              {p.retractedAt ? null : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRetracting(p)}
                  style={{ ...ghost, height: 24, fontSize: 11, padding: "0 8px" }}
                >
                  {t("retract", "撤回")}
                </button>
              )}
            </span>
          </Row>
        ))}
      </div>

      {retracting && (
        <ConfirmDialog
          danger
          title={zh ? `标记“${retracting.destination}”已撤回？` : `Mark “${retracting.destination}” as taken down?`}
          body={t(
            "The row stays in the log. If this was the last place it was live, the article unlocks and goes back to review.",
            "记录会保留。如果这是它最后一个在线的位置，文章将解锁并回到审核状态。",
          )}
          confirm={t("Mark it taken down", "标记为已撤回")}
          cancel={t("Cancel", "取消")}
          onClose={() => setRetracting(null)}
          onConfirm={() => {
            const id = retracting.id;
            setRetracting(null);
            run(() => retractPublicationAction(id));
          }}
        />
      )}
    </>
  );
}

/* --------------------------------------------------------------- new one */

function NewArticleDialog({
  zh,
  busy,
  scripts,
  onClose,
  onCreate,
}: {
  zh: boolean;
  busy: boolean;
  scripts: { id: string; title: string; status: string }[];
  onClose: () => void;
  onCreate: (input: { title?: string; angle?: string; language?: string; scriptId?: string }) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [title, setTitle] = useState("");
  const [angle, setAngle] = useState("");
  const [scriptId, setScriptId] = useState("");

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(23,23,23,.28)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "100%",
          background: "#fff",
          borderRadius: 14,
          padding: 20,
          boxShadow: "0 10px 40px rgba(0,0,0,.18)",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{t("New article", "新建文章")}</div>
        <p style={{ fontSize: 11.5, color: "#999999", margin: "0 0 14px", lineHeight: 1.6 }}>
          {t(
            "A headline and an angle are enough — the assistant writes the draft from them.",
            "只要有标题和角度就够了，助理会据此写出初稿。",
          )}
        </p>

        <Label style={{ margin: "0 0 6px" }}>{t("Headline", "标题")}</Label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("What it is about", "文章主题")}
          style={field}
        />

        <Label style={{ margin: "14px 0 6px" }}>{t("Angle", "角度")}</Label>
        <input
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          placeholder={t("The argument it makes. Optional.", "文章的论点。可留空。")}
          style={field}
        />

        {scripts.length ? (
          <>
            <Label style={{ margin: "14px 0 6px" }}>{t("Or start from a script", "或从脚本开始")}</Label>
            <select value={scriptId} onChange={(e) => setScriptId(e.target.value)} style={field}>
              <option value="">{t("Start from nothing", "从空白开始")}</option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {s.status === "locked" ? (zh ? "（已批准）" : " (approved)") : ""}
                </option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: "#999999", margin: "7px 0 0", lineHeight: 1.6 }}>
              {t(
                "The script's voice-over becomes the first draft, and the article remembers which script it came from.",
                "脚本的口播内容会成为初稿，文章也会记住它来自哪个脚本。",
              )}
            </p>
          </>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button type="button" onClick={onClose} style={ghost}>
            {t("Cancel", "取消")}
          </button>
          <button
            type="button"
            disabled={busy || (!title.trim() && !scriptId)}
            onClick={() => onCreate(scriptId ? { scriptId } : { title, angle })}
            style={solid}
          >
            {t("Create", "创建")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- the note */

/** One line of plain fact for the agent panel, from what is on screen and
 * nothing it cannot see. */
function agentNote(
  articles: ArticleListItem[],
  log: PublicationRow[],
  detail: ArticleDetail | null,
  zh: boolean,
): string {
  const t = (en: string, cn: string) => (zh ? cn : en);
  if (detail) {
    const a = detail.article;
    return t(
      `"${a.title}" — ${a.wordCount} words, ${a.status.replace("_", " ")}, ${detail.versions.length} version(s) kept.`,
      `《${a.title}》—— ${a.wordCount} 字，${statusLabel(a.status, true)}，已保存 ${detail.versions.length} 个版本。`,
    );
  }
  const live = log.filter((p) => !p.retractedAt).length;
  return t(
    `${articles.length} article(s); ${live} publication(s) on the record.`,
    `共 ${articles.length} 篇文章，发布记录 ${live} 条。`,
  );
}
