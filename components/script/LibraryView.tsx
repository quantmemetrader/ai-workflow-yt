"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ScriptLibraryScreen } from "@/components/canvas/ScriptLibraryScreen";
import type { ScriptListItem } from "@/lib/script/service";
import { createFolderAction, createScriptAction, deleteScriptAction } from "@/app/(app)/script/actions";

/**
 * Live wiring for the Script library.
 *
 * Filters live in the URL so a filtered library is a link one person can send
 * to another: "everything waiting on you in 2026-Q3-campaign" is a useful
 * thing to be able to paste into chat.
 */
type Status = ScriptListItem["status"];
type Scope = "all" | "mine" | "awaiting" | "shared";
type Sort = "updated" | "title" | "status";
type View = "list" | "grid";

export function LibraryView({
  scripts,
  folders,
  counts,
  folderId,
  status,
  scope,
  query,
  locale,
  model,
}: {
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
  const params = useSearchParams();
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
    <ScriptLibraryScreen
      locale={locale}
      scripts={scripts}
      folders={folders}
      counts={counts}
      folderId={folderId}
      status={status}
      scope={scope}
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
      onNewScript={() => {
        const title = globalThis.prompt(zh ? "剧本标题" : "Script title");
        if (!title?.trim()) return;
        const form = new FormData();
        form.set("title", title.trim());
        if (folderId) form.set("folderId", folderId);
        run(() => createScriptAction(form), (id) => router.push(`/script/${id}`));
      }}
      onNewFolder={() => {
        const name = globalThis.prompt(zh ? "文件夹名称" : "Folder name");
        if (!name?.trim()) return;
        run(() => createFolderAction(name.trim()));
      }}
      model={model}
      onAsk={(prompt) => router.push(`/chat?q=${encodeURIComponent(prompt)}`)}
      onDelete={(id) => {
        const item = scripts.find((s) => s.id === id);
        const ok = globalThis.confirm(
          zh
            ? `删除“${item?.title ?? "这个剧本"}”？可以在 30 天内恢复。`
            : `Delete “${item?.title ?? "this script"}”? It can be restored for 30 days.`,
        );
        if (ok) run(() => deleteScriptAction(id));
      }}
    />
  );
}
