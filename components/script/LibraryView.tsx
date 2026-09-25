"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ScriptLibraryScreen } from "@/components/canvas/ScriptLibraryScreen";
import type { Proposals } from "@/lib/agents/proposals";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { AgentHistory } from "@/components/shell/AgentHistory";
import type { ScriptListItem } from "@/lib/script/service";
import { createFolderAction, createScriptAction, deleteScriptAction } from "@/app/(app)/script/actions";
import { BriefComposer, type BriefDraft } from "@/components/script/BriefComposer";
import { NameDialog } from "@/components/ui/NameDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TopicQueue } from "@/components/script/TopicQueue";
import type { TopicQueueItem } from "@/lib/script/topics";

/**
 * Live wiring for the Script library.
 *
 * Filters live in the URL so a filtered library is a link one person can send
 * to another: "everything waiting on you in 2026-Q3-campaign" is a useful
 * thing to be able to paste into chat.
 */
type Status = ScriptListItem["status"];
type Scope = "all" | "mine" | "awaiting" | "shared" | "topics";
type Sort = "updated" | "title" | "status";
type View = "list" | "grid";

export function LibraryView({
  proposals,
  scripts,
  folders,
  counts,
  folderId,
  status,
  scope,
  query,
  locale,
  model,
  queue = [],
  canStart = false,
}: {
  /** What 编剧 suggests writing next, drawn above the library. */
  proposals: Proposals;
  /** Topics waiting for a script, for the 选题 scope. */
  queue?: TopicQueueItem[];
  /** Holds Chat, so a topic can become a project from here. */
  canStart?: boolean;
  scripts: ScriptListItem[];
  folders: { id: string; name: string; count: number }[];
  counts: { all: number; brief: number; drafting: number; awaiting: number; locked: number };
  folderId: string | null;
  status: Status | null;
  scope: Scope;
  query: string;
  locale: string;
  /** The model the right-hand panel names under its composer. */
  model: string;
}) {
  const router = useRouter();
  /* The agent answers here. Asking used to push to /chat, which took the
   * screen you were asking about off the screen. */
  const agent = useInlineAgent({ module: "script" }, { key: "script" });
  const params = useSearchParams();
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Three dialogs, none of them the browser's. A brief is a document, a folder
  // needs one word, and a deletion has to say what it will delete.
  const [briefing, setBriefing] = useState(false);
  const [namingFolder, setNamingFolder] = useState(false);
  const [deleting, setDeleting] = useState<ScriptListItem | null>(null);

  // Sort and view are ways of looking rather than things to share, so they
  // stay local. Everything that changes *which* scripts you see is in the URL.
  const [sort, setSort] = useState<Sort>("updated");
  const [view, setView] = useState<View>("list");

  const zh = locale.startsWith("zh");

  const push = useCallback(
    (patch: Record<string, string | null>) => {
      const q = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") q.delete(k);
        else q.set(k, v);
      }
      const s = q.toString();
      router.push(s ? `/script?${s}` : "/script");
    },
    [params, router],
  );

  const run = useCallback(
    (work: () => Promise<{ error?: string } | { ok: boolean; id?: string }>, then?: (id: string) => void) => {
      setError(null);
      start(async () => {
        const res = await work();
        if ("error" in res && res.error) {
          setError(res.error);
          return;
        }
        const id = "id" in res ? res.id : undefined;
        if (id && then) then(id);
        else router.refresh();
      });
    },
    [router],
  );

  return (
    <>
      <ScriptLibraryScreen
        proposals={proposals}
      locale={locale}
      scripts={scripts}
      folders={folders}
      counts={counts}
      folderId={folderId}
      status={status}
      scope={scope}
      topicsView={<TopicQueue items={queue} zh={zh} canStart={canStart} />}
      topicCount={queue.length}
      sort={sort}
      view={view}
      query={query}
      pending={isPending}
      error={error}
      onOpen={(id) => router.push(`/script/${id}`)}
      onFolder={(id) => push({ folder: id })}
      onStatus={(s) => push({ status: s })}
      onScope={(s) => push({ scope: s === "all" ? null : s })}
      onSort={setSort}
      onView={setView}
      onQuery={(q) => push({ q })}
      onNewScript={() => setBriefing(true)}
      onNewFolder={() => setNamingFolder(true)}
      model={model}
      onAsk={(prompt) => void agent.send(prompt)}
      tools={<AgentHistory zh={locale.startsWith("zh")} current={agent.conversationId} onPick={(id) => void agent.load(id)} onNew={agent.reset} />}
      thread={
        <InlineAgentThread
          messages={agent.messages}
          notice={agent.notice}
          conversationId={agent.conversationId}
          zh={locale.startsWith("zh")}
        />
      }
      onDelete={(id) => setDeleting(scripts.find((s) => s.id === id) ?? null)}
      />

      {briefing && (
        <BriefComposer
          zh={zh}
          busy={isPending}
          error={error}
          onClose={() => {
            setBriefing(false);
            setError(null);
          }}
          onSubmit={(draft: BriefDraft) => {
            const form = new FormData();
            form.set("title", draft.title.trim());
            if (folderId) form.set("folderId", folderId);
            if (draft.angle.trim()) form.set("angle", draft.angle.trim());
            if (draft.targetChannel.trim()) form.set("targetChannel", draft.targetChannel.trim());
            if (draft.aspect) form.set("aspect", draft.aspect);
            if (draft.targetSeconds) form.set("targetSeconds", draft.targetSeconds);
            if (draft.language.trim()) form.set("language", draft.language.trim());
            if (draft.subtitleLanguage.trim()) form.set("subtitleLanguage", draft.subtitleLanguage.trim());
            if (draft.mandatoryPoints.trim()) form.set("mandatoryPoints", draft.mandatoryPoints);
            run(
              () => createScriptAction(form),
              (id) => {
                setBriefing(false);
                router.push(`/script/${id}`);
              },
            );
          }}
        />
      )}

      {namingFolder && (
        <NameDialog
          title={zh ? "新建文件夹" : "New folder"}
          placeholder={zh ? "文件夹名称" : "Name it"}
          confirm={zh ? "创建" : "Create"}
          cancel={zh ? "取消" : "Cancel"}
          onClose={() => setNamingFolder(false)}
          onSubmit={(name) => run(() => createFolderAction(name))}
        />
      )}

      {deleting && (
        <ConfirmDialog
          danger
          title={
            zh ? `删除“${deleting.title}”？` : `Delete \u201c${deleting.title}\u201d?`
          }
          body={
            zh
              ? "可以在 30 天内恢复。"
              : "It can be restored for 30 days."
          }
          confirm={zh ? "删除" : "Delete"}
          cancel={zh ? "取消" : "Cancel"}
          onClose={() => setDeleting(null)}
          onConfirm={() => run(() => deleteScriptAction(deleting.id))}
        />
      )}
    </>
  );
}
