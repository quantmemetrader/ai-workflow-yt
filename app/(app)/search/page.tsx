import Link from "next/link";
import { toSimplified } from "@/lib/text/simplified";

const KIND_ZH: Record<string, string> = { doc: "文档", pdf: "PDF", image: "图片", video: "视频", audio: "音频", folder: "文件夹", sheet: "表格", slides: "演示文稿" };
import { requireViewer } from "@/lib/auth/dal";
import { searchFiles } from "@/lib/ai/retrieval";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/i18n";
import { SearchBox } from "./search-box";
import { AgentDock } from "@/components/shell/AgentDock";
import { answeringModel } from "@/lib/ai/models";
import { and, desc, ilike, isNull, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workProjects } from "@/lib/db/schema";
import { projectsVisibleTo } from "@/lib/projects/visible";
import { listScripts } from "@/lib/script/service";

export const metadata = { title: "搜索" };

/** A project or a script found by its title. */
type TitleHit = { id: string; href: string; title: string; sub: string | null };

/**
 * Search across everything this person can read (spec §4.1, "global search,
 * permission-filtered").
 *
 * It runs the same query the agent's `search_files` tool runs, so what a person
 * can find by hand and what their agent can find are the same set by
 * construction — and the count of withheld matches is shown for the same
 * reason it is shown in chat: the answer may be partial, and that is worth
 * knowing without learning what was hidden.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const viewer = await requireViewer();
  const { q = "" } = await searchParams;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

  /* Projects and scripts by title too (QA, 2 Oct: the page only searched
     files while the ⌘K palette found projects). Projects by the palette's
     rule (/api/palette): the ones this person may open. Scripts are the
     studio's for anyone with the Script module (lib/script/service.ts). */
  const term = q.trim().slice(0, 120);
  const [{ hits, withheld }, projectHits, scriptHits] = term
    ? await Promise.all([
        searchFiles(viewer, term, 40),
        db
          .select({ id: workProjects.id, title: workProjects.title, updatedAt: workProjects.updatedAt })
          .from(workProjects)
          .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), ilike(workProjects.title, `%${term}%`), projectsVisibleTo(viewer)))
          .orderBy(desc(workProjects.updatedAt))
          .limit(8)
          .then((rows): TitleHit[] => rows.map((p) => ({ id: p.id, href: `/projects/${p.id}`, title: p.title, sub: formatDate(p.updatedAt, viewer.locale ?? "zh-CN") })))
          .catch((): TitleHit[] => []),
        viewer.modules.includes("script")
          ? listScripts(viewer, { query: term })
              .then((rows): TitleHit[] => rows.slice(0, 8).map((s) => ({ id: s.id, href: `/script/${s.id}`, title: s.title, sub: s.projectTitle ? (zh ? `项目：${s.projectTitle}` : `Project: ${s.projectTitle}`) : null })))
              .catch((): TitleHit[] => [])
          : Promise.resolve([] as TitleHit[]),
      ])
    : [{ hits: [], withheld: 0 }, [] as TitleHit[], [] as TitleHit[]];
  const total = hits.length + projectHits.length + scriptHits.length;

  if (q.trim()) {
    await audit(viewer, "search", { module: "files", meta: { query: q, hits: hits.length } });
  }

  return (
    /* The agent sits beside the results: a search that found the wrong forty
       things is exactly when somebody wants to ask a question in words. */
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex" }}>
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          height: 56,
          flexShrink: 0,
          borderBottom: "1px solid #ededed",
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "0 22px",
        }}
      >
        <SearchBox initial={q} placeholder={zh ? "搜索你有权查看的内容" : "Search everything you can read"} />
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "18px 22px" }}>
        {!q.trim() ? (
          <p className="mut">
            {zh
              ? "搜索项目、脚本的标题，以及文件名和文件内容。结果只包含你有权查看的内容。"
              : "Search project and script titles, file names and file contents. Results are only ever what you may read."}
          </p>
        ) : (
          <>
            <p className="mut" style={{ marginBottom: 12 }}>
              {total} {zh ? "个结果" : total === 1 ? "result" : "results"}
              {withheld > 0 &&
                (zh
                  ? ` · 另有 ${withheld} 个匹配超出你的权限`
                  : ` · ${withheld} more matched outside your access`)}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 820 }}>
              {(
                [
                  [zh ? "项目" : "Projects", projectHits],
                  [zh ? "脚本" : "Scripts", scriptHits],
                ] as const
              ).map(([label, list]) =>
                list.length ? (
                  <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "#8a8a8a" }}>{label}</div>
                    {list.map((h) => (
                      <Link key={h.id} href={h.href} prefetch={false} style={{ border: "1px solid #ededed", borderRadius: 10, background: "#fff", padding: "10px 13px", color: "#171717", display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{toSimplified(h.title)}</span>
                        {h.sub ? <span style={{ fontSize: 11, color: "#999999", flexShrink: 0 }}>{h.sub}</span> : null}
                      </Link>
                    ))}
                  </div>
                ) : null,
              )}
              {hits.length && (projectHits.length || scriptHits.length) ? <div style={{ fontSize: 11.5, fontWeight: 600, color: "#8a8a8a" }}>{zh ? "文件" : "Files"}</div> : null}
              {hits.map((hit) => (
                <Link
                  key={hit.fileId}
                  href={`/files/${hit.fileId}`}
                  style={{
                    border: "1px solid #ededed",
                    borderRadius: 10,
                    background: "#fff",
                    padding: "11px 13px",
                    color: "#171717",
                    display: "block",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{toSimplified(hit.name)}</span>
                    <span style={{ fontSize: 11, color: "#999999" }}>
                      {(viewer.locale ?? "zh-CN").startsWith("zh") ? (KIND_ZH[hit.kind] ?? hit.kind) : hit.kind} · {formatDate(hit.updatedAt, viewer.locale ?? "zh-CN")}
                    </span>
                  </div>
                  {hit.snippet && (
                    <p
                      style={{
                        fontSize: 12.5,
                        color: "#525252",
                        marginTop: 4,
                        lineHeight: 1.5,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {toSimplified(hit.snippet)}
                    </p>
                  )}
                </Link>
              ))}

              {total === 0 && (
                <p className="mut">
                  {withheld > 0
                    ? zh
                      ? "没有你有权查看的匹配结果。"
                      : "Nothing you can read matched."
                    : zh
                      ? "没有匹配结果。"
                      : "Nothing matched."}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>

    <AgentDock
      context={{ module: "files" }}
      zh={zh}
      model={answeringModel()}
      scope={q.trim() ? `${total} ${zh ? "个结果" : "results"}` : zh ? "全部内容" : "Everything"}
      note={
        zh
          ? "助理和你搜到的是同一批内容：它也只能读你有权查看的文件。"
          : "The agent searches the same set you do: it can only read what you can read."
      }
      placeholder={zh ? "询问这些结果…" : "Ask about these results…"}
      corner={withheld > 0 ? (zh ? `${withheld} 项未显示` : `${withheld} withheld`) : undefined}
    />
    </div>
  );
}
