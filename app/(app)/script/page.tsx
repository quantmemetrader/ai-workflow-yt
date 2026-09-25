import { requireModule } from "@/lib/auth/dal";
import { proposalsFor } from "@/lib/agents/proposals";
import { answeringModel } from "@/lib/ai/models";
import { LibraryView } from "@/components/script/LibraryView";
import { libraryCounts, listFolders, listScripts, pendingApprovals, sharedScriptIds, type ScriptListItem } from "@/lib/script/service";
import { scriptTopicQueue } from "@/lib/script/topics";

export const metadata = { title: "脚本 · Script" };

/**
 * Script library (spec §4.4).
 *
 * Every script the studio is writing, with the stage each one has reached.
 * The counts above the list are a real group-by, not the artboard's numbers.
 */
const STATUSES = ["brief", "drafting", "awaiting_approval", "locked", "archived"] as const;

function isStatus(v: unknown): v is ScriptListItem["status"] {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

type Scope = "all" | "mine" | "awaiting" | "shared" | "topics";
const isScope = (v: unknown): v is Scope => v === "all" || v === "mine" || v === "awaiting" || v === "shared" || v === "topics";

export default async function ScriptLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireModule("script");
  const params = await searchParams;

  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" && v ? v : undefined;
  };

  const folderId = one("folder") ?? null;
  const rawStatus = one("status");
  const status = isStatus(rawStatus) ? rawStatus : null;
  const scope: Scope = isScope(one("scope")) ? (one("scope") as Scope) : "all";
  const query = one("q") ?? "";

  const [all, folders, counts, waiting] = await Promise.all([
    listScripts(viewer, {
      folderId: folderId ?? undefined,
      status: status ?? undefined,
      query,
    }),
    listFolders(viewer),
    libraryCounts(viewer, folderId ?? undefined),
    pendingApprovals(viewer),
  ]);

  /**
   * The sidebar's scopes, applied here rather than in SQL.
   *
   * "Assigned to me" and "Waiting on approval" are both small sets over rows
   * the query already returned, and pushing them into the query would mean
   * four near-identical statements for what is one filter over one list.
   * "Shared with me" reads the same `relation_tuples` the Files module uses —
   * scripts now carry an owner tuple on creation, so a script shared with a
   * person or their team appears here and one they wrote themselves does not.
   */
  const waitingIds = new Set(waiting.map((w) => w.objectId));
  const sharedIds = scope === "shared" ? new Set(await sharedScriptIds(viewer)) : new Set<string>();
  const scripts =
    scope === "mine"
      ? all.filter((s) => s.ownerId === viewer.id)
      : scope === "awaiting"
        ? all.filter((s) => waitingIds.has(s.id))
        : scope === "shared"
          ? all.filter((s) => sharedIds.has(s.id) && s.ownerId !== viewer.id)
          : all;

  /* What the page's own employee thinks should be made next, read from
     what already exists — this morning's plan, the backlog, the audience —
     and the 选题 queue: topics chosen elsewhere that are waiting for a
     script. Both are reads of what exists; nothing is generated here. */
  const proposals = await proposalsFor(viewer, "script");
  const queue = await scriptTopicQueue(viewer, { proposals }).catch((err) => {
    console.error("[script] the topics queue could not be read", err);
    return [];
  });

  return (
    <LibraryView
      proposals={proposals}
      locale={viewer.locale ?? "zh-CN"}
      scripts={scripts}
      folders={folders}
      counts={counts}
      folderId={folderId}
      status={status}
      scope={scope}
      query={query}
      model={answeringModel()}
      queue={queue}
      canStart={viewer.modules.includes("chat")}
    />
  );
}
