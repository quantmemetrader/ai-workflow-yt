import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { videoExports, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { audit } from "@/lib/audit";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage } from "@/lib/ai/ledger";
import { projectsVisibleTo } from "@/lib/projects/visible";
import { cleanLink, mayPublish, publishPlatformName, readPublication, type Publication, type PublishPlatform, type PublishedPlace } from "@/lib/projects/publication";
import { OWN_ACCOUNTS } from "@/lib/social/own-accounts";
import { PUBLISH_ROWS, captionLimits, type PublishDraft, type PublishRowKey } from "@/lib/projects/publish-rows";

/**
 * The server half of a project's 发布 page (`/projects/[id]/publish`).
 *
 * The owner, 28 Sep: "they will re-modify the videos after AI makes them,
 * then they will use that to post". So the page is: the AI's render to
 * download, the team's own final cut uploaded back (a project file tagged
 * `role:final`, lib/projects/files.ts), and one row per place it goes, each
 * with its own title and caption.
 *
 * What the rows say is a draft kept on the project, at
 * `work_projects.source -> 'publishDraft'` (the same jsonb the 已发布 record
 * rides in), so a caption typed on Monday is still there on Tuesday.
 * Posting to the studio's own 抖音 / 小红书 / 视频号 / B站 is by hand (none
 * has a posting API we can use); pressing 「我已发布」 there adds that
 * platform and its link to the project's 已发布 record — merged, not
 * replaced, so each platform can be marked as it goes up.
 */

export function readPublishDraft(source: unknown): PublishDraft {
  const raw = source && typeof source === "object" ? (source as { publishDraft?: unknown }).publishDraft : null;
  const out: PublishDraft = { fileId: null, rows: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  out.fileId = typeof r.fileId === "string" && r.fileId.length <= 64 ? r.fileId : null;
  const rows = r.rows && typeof r.rows === "object" ? (r.rows as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(rows)) {
    if (!v || typeof v !== "object" || k.length > 64) continue;
    const row = v as Record<string, unknown>;
    out.rows[k] = {
      on: row.on !== false,
      title: typeof row.title === "string" ? row.title.slice(0, 300) : "",
      body: typeof row.body === "string" ? row.body.slice(0, 5000) : "",
    };
  }
  return out;
}

/** A project this person may see, with what the page's writes need. */
async function projectRow(viewer: Viewer, id: string) {
  const [row] = await db
    .select({ id: workProjects.id, title: workProjects.title, brief: workProjects.brief, status: workProjects.status, createdBy: workProjects.createdBy, source: workProjects.source, scriptId: workProjects.scriptId, videoProjectId: workProjects.videoProjectId })
    .from(workProjects)
    .where(and(eq(workProjects.id, String(id ?? "")), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), projectsVisibleTo(viewer)))
    .limit(1);
  return row ?? null;
}

export async function projectForPublish(viewer: Viewer, id: string) {
  return projectRow(viewer, id);
}

/** Keep the rows as typed. Anyone who can see the project (not a guest) may. */
export async function savePublishDraft(viewer: Viewer, projectId: string, draft: PublishDraft): Promise<{ ok: true } | { error: string }> {
  if (viewer.role === "guest") return { error: "Not allowed" };
  const p = await projectRow(viewer, projectId);
  if (!p) return { error: "Not found" };
  const clean = readPublishDraft({ publishDraft: draft });
  await db
    .update(workProjects)
    .set({ source: sql`(case when jsonb_typeof(${workProjects.source}) = 'object' then ${workProjects.source} else '{}'::jsonb end) || jsonb_build_object('publishDraft', ${JSON.stringify(clean)}::jsonb)` })
    .where(eq(workProjects.id, p.id));
  return { ok: true };
}

/**
 * One platform is up: add it (and its link) to the 已发布 record, marking
 * the project done if it was not. A platform already there has its link
 * replaced. `fileId` is the video that went up — the team's final cut, or
 * the render.
 */
export async function addPublishedPlace(
  viewer: Viewer,
  projectId: string,
  input: { key: PublishPlatform; url: unknown; fileId: string | null },
  zh: boolean,
): Promise<{ publication: Publication } | { error: string }> {
  const t = (a: string, b: string) => (zh ? a : b);
  const p = await projectRow(viewer, projectId);
  if (!p) return { error: t("没有这个项目", "No such project") };
  if (!mayPublish(viewer, p.createdBy)) return { error: t("只有项目负责人或管理员可以标记发布", "Only the project's owner or an admin can mark it published") };
  if (p.status === "archived") return { error: t("项目已归档，先恢复再标记发布", "The project is archived; restore it first") };
  const url = cleanLink(input.url);
  if (url === undefined) return { error: t(`${publishPlatformName(input.key, true)} 的链接格式不对`, `The ${publishPlatformName(input.key, false)} link is not a web address`) };

  const was = p.status === "done" ? readPublication(p.source) : null;
  let fileId = input.fileId;
  if (!fileId && p.videoProjectId) {
    const [render] = await db
      .select({ fileId: videoExports.fileId })
      .from(videoExports)
      .where(and(eq(videoExports.projectId, p.videoProjectId), eq(videoExports.state, "done"), sql`${videoExports.fileId} is not null`))
      .orderBy(desc(videoExports.createdAt))
      .limit(1);
    fileId = render?.fileId ?? null;
  }
  const platforms: PublishedPlace[] = [...(was?.platforms ?? []).filter((x) => x.key !== input.key), { key: input.key, url }];
  const publication: Publication = {
    at: was?.at ?? new Date().toISOString(),
    by: was?.by || viewer.id,
    byName: was?.byName || viewer.nameLocal || viewer.name,
    platforms,
    note: was?.note ?? null,
    fileId: fileId ?? was?.fileId ?? null,
  };
  await db
    .update(workProjects)
    .set({
      status: "done",
      source: sql`(case when jsonb_typeof(${workProjects.source}) = 'object' then ${workProjects.source} else '{}'::jsonb end) || jsonb_build_object('published', ${JSON.stringify(publication)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(workProjects.id, p.id));
  await audit(viewer, "project.publish.place", { module: "chat", objectType: "project", objectId: p.id, meta: { platform: input.key, link: Boolean(url), fileId: publication.fileId } });
  return { publication };
}

/** Take one platform off the record; the last one off puts the project back in progress. */
export async function removePublishedPlace(viewer: Viewer, projectId: string, key: PublishPlatform, zh: boolean): Promise<{ ok: true } | { error: string }> {
  const t = (a: string, b: string) => (zh ? a : b);
  const p = await projectRow(viewer, projectId);
  if (!p) return { error: t("没有这个项目", "No such project") };
  if (!mayPublish(viewer, p.createdBy)) return { error: t("只有项目负责人或管理员可以撤回", "Only the project's owner or an admin can undo it") };
  const was = p.status === "done" ? readPublication(p.source) : null;
  if (!was) return { error: t("这个项目没有标记为已发布", "This project is not marked published") };
  const platforms = was.platforms.filter((x) => x.key !== key);
  if (!platforms.length) {
    await db
      .update(workProjects)
      .set({ status: "active", source: sql`${workProjects.source} - 'published'`, updatedAt: new Date() })
      .where(and(eq(workProjects.id, p.id), eq(workProjects.status, "done")));
  } else {
    await db
      .update(workProjects)
      .set({ source: sql`${workProjects.source} || jsonb_build_object('published', ${JSON.stringify({ ...was, platforms })}::jsonb)`, updatedAt: new Date() })
      .where(eq(workProjects.id, p.id));
  }
  await audit(viewer, "project.unpublish.place", { module: "chat", objectType: "project", objectId: p.id, meta: { platform: key } });
  return { ok: true };
}

const CAPTION_PROMPT = `你是短视频运营「撰稿人」，为同一条视频给不同平台写发布标题和文案。
要求：
- 每个平台按它的风格和字数上限写；中文平台用简体中文；YouTube / LinkedIn 用中文或中英双语均可，以视频语言为准。
- 标题抓人但不夸大、不标题党，不写绝对化投资建议用语（稳赚、必涨等）。
- 文案 2–5 句，结尾给一个互动问题；可带 2–4 个话题标签（#标签）。
- 不用 emoji。
只输出 JSON：{"rows":{"<平台key>":{"title":"…","body":"…"}}}`;

/**
 * 撰稿人 writes a title and caption for each asked-for row, from the
 * project's title, brief and the script's spoken lines, inside each
 * platform's limits. Returns only what it wrote; the caller merges it into
 * the draft.
 */
export async function writeCaptions(
  viewer: Viewer,
  projectId: string,
  keys: PublishRowKey[],
  script: string,
): Promise<{ rows: Record<string, { title: string; body: string }> } | { error: string }> {
  const p = await projectRow(viewer, projectId);
  if (!p) return { error: "Not found" };
  const wanted = keys.filter((k) => k.length <= 64).slice(0, 12);
  if (!wanted.length) return { rows: {} };
  const spec = wanted
    .map((k) => {
      const lim = captionLimits(k);
      const row = PUBLISH_ROWS.find((r) => r.key === k);
      return `- ${k}（${row?.zh ?? k}）：标题 ≤ ${lim.title} 字，文案 ≤ ${lim.body} 字。${row?.style ?? ""}`;
    })
    .join("\n");
  try {
    const out = await complete({
      model: modelFor.assistant(),
      temperature: 0.6,
      maxTokens: 2400,
      messages: [
        { role: "system", content: CAPTION_PROMPT },
        { role: "user", content: `视频题目：${p.title}\n简介：${(p.brief ?? "").slice(0, 600)}\n\n脚本口播：\n${script.slice(0, 3000) || "（无）"}\n\n要写的平台：\n${spec}` },
      ],
    });
    await recordUsage({ viewer, module: "publish", provider: out.provider ?? "openrouter", model: out.model, promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId });
    const text = out.text.replace(/<\/?think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { rows?: Record<string, { title?: unknown; body?: unknown }> };
    const rows: Record<string, { title: string; body: string }> = {};
    for (const k of wanted) {
      const r = parsed.rows?.[k];
      if (!r) continue;
      const lim = captionLimits(k);
      rows[k] = { title: String(r.title ?? "").trim().slice(0, lim.title), body: String(r.body ?? "").trim().slice(0, lim.body) };
    }
    return { rows };
  } catch {
    return { error: "撰稿人这次没写出来，再试一次" };
  }
}

export { OWN_ACCOUNTS };
