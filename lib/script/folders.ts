import "server-only";
import type { Viewer } from "@/lib/auth/dal";
import { listScripts, type ScriptListItem } from "@/lib/script/service";

/**
 * The script library's folders, one per project.
 *
 * Ryan (29 Sep): "a folder system for both the video page and the script
 * page, folders built based on projects — once a project is built, a
 * corresponding folder is made in each". Derived, never stored: every
 * project this person may see is a folder the moment it exists (its script
 * is made with it), and a project deleted is a folder gone. Scripts no
 * project uses sit in 未归入项目; the studio's own folders stay as they were.
 */
export type ScriptFolderNode = { id: string; title: string; count: number; updatedAt: string };
export type ScriptTree = { projects: ScriptFolderNode[]; unassigned: number; total: number };

export function treeOf(all: ScriptListItem[]): ScriptTree {
  const byProject = new Map<string, ScriptFolderNode>();
  const seen = new Set<string>();
  let unassigned = 0;
  for (const s of all) {
    if (!s.projectId) {
      if (!seen.has(s.id)) unassigned += 1;
      seen.add(s.id);
      continue;
    }
    seen.add(s.id);
    const f = byProject.get(s.projectId) ?? { id: s.projectId, title: s.projectTitle ?? s.title, count: 0, updatedAt: s.updatedAt.toISOString() };
    f.count += 1;
    if (s.updatedAt.toISOString() > f.updatedAt) f.updatedAt = s.updatedAt.toISOString();
    byProject.set(s.projectId, f);
  }
  const projects = [...byProject.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { projects, unassigned, total: seen.size };
}

export async function scriptTree(viewer: Viewer): Promise<ScriptTree> {
  return treeOf(await listScripts(viewer));
}

export type PickerScript = { id: string; title: string; status: ScriptListItem["status"]; version: number; updatedAt: string; href: string };
export type PickerGroup = { projectId: string | null; title: string; updatedAt: string; scripts: PickerScript[] };

/** Every script this person may open, grouped by project folder, newest folder first; 未归入项目 last. */
export async function scriptPickerGroups(viewer: Viewer): Promise<PickerGroup[]> {
  const all = await listScripts(viewer);
  const groups = new Map<string, PickerGroup>();
  const loose: PickerScript[] = [];
  const seen = new Set<string>();
  for (const s of all) {
    const item: PickerScript = {
      id: s.id,
      title: s.title,
      status: s.status,
      version: s.version,
      updatedAt: s.updatedAt.toISOString(),
      href: s.projectId ? `/projects/${s.projectId}/script` : `/script/${s.id}`,
    };
    if (!s.projectId) {
      if (!seen.has(s.id)) loose.push(item);
      seen.add(s.id);
      continue;
    }
    const g = groups.get(s.projectId) ?? { projectId: s.projectId, title: s.projectTitle ?? s.title, updatedAt: item.updatedAt, scripts: [] };
    if (!g.scripts.some((x) => x.id === s.id)) g.scripts.push(item);
    if (item.updatedAt > g.updatedAt) g.updatedAt = item.updatedAt;
    groups.set(s.projectId, g);
  }
  const out = [...groups.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (loose.length) out.push({ projectId: null, title: "", updatedAt: loose[0].updatedAt, scripts: loose });
  return out;
}
