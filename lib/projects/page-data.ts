import { cache } from "react";
import { redirect } from "next/navigation";
import type { Viewer } from "@/lib/auth/dal";
import { workProjectDetail } from "@/lib/projects/service";

/**
 * The project for its pages, read once per request: the layout (header and
 * tabs) and the page under it both call this, and React's `cache` hands the
 * second caller the first one's result.
 */
export const projectForPage = cache((viewer: Viewer, id: string, zh: boolean) => workProjectDetail(viewer, id, zh));

/**
 * A project opened by its shared link, by someone who is not a member, shows
 * the page it was shared from (the script) and no other: a private project's
 * edit desk, files and numbers are not what the link was sent for (QA, 2 Oct:
 * a link viewer could open every tab).
 */
export function onlyTheSharedPage(p: { id: string; linkOnly: "view" | "edit" | null }): void {
  if (p.linkOnly) redirect(`/projects/${p.id}/script`);
}
