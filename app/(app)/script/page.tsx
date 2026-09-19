import { requireModule } from "@/lib/auth/dal";
import { modelFor } from "@/lib/ai/models";
import { LibraryView } from "@/components/script/LibraryView";
import { libraryCounts, listFolders, listScripts, pendingApprovals, type ScriptListItem } from "@/lib/script/service";

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

type Scope = "all" | "mine" | "awaiting" | "shared";
const isScope = (v: unknown): v is Scope => v === "all" || v === "mine" || v === "awaiting" || v === "shared";

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
   * "Shared with me" has nothing behind it yet: per-script sharing goes
   * through the same ReBAC tuples the Files module uses, and that is not
   * wired for scripts, so it shows nothing rather than quietly showing
   * everything.
   */
  const waitingIds = new Set(waiting.map((w) => w.objectId));
  const scripts =
    scope === "mine"
      ? all.filter((s) => s.ownerId === viewer.id)
      : scope === "awaiting"
        ? all.filter((s) => waitingIds.has(s.id))
        : scope === "shared"
          ? []
          : all;

  return (
    <LibraryView
      locale={viewer.locale ?? "zh-CN"}
      scripts={scripts}
      folders={folders}
      counts={counts}
      folderId={folderId}
      status={status}
      scope={scope}
      query={query}
      model={modelFor.assistant()}
    />
  );
}
