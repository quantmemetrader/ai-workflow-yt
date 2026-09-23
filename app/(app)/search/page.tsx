import Link from "next/link";
import { requireViewer } from "@/lib/auth/dal";
import { searchFiles } from "@/lib/ai/retrieval";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/i18n";
import { SearchBox } from "./search-box";
import { AgentDock } from "@/components/shell/AgentDock";
import { answeringModel } from "@/lib/ai/models";

export const metadata = { title: "搜索 · Search" };

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

  const { hits, withheld } = q.trim()
    ? await searchFiles(viewer, q, 40)
    : { hits: [], withheld: 0 };

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
              ? "搜索文件名和文件内容。结果只包含你有权查看的内容。"
              : "Search file names and their contents. Results are only ever what you may read."}
          </p>
        ) : (
          <>
            <p className="mut" style={{ marginBottom: 12 }}>
              {hits.length} {zh ? "个结果" : hits.length === 1 ? "result" : "results"}
              {withheld > 0 &&
                (zh
                  ? ` · 另有 ${withheld} 个匹配超出你的权限`
                  : ` · ${withheld} more matched outside your access`)}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 820 }}>
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
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{hit.name}</span>
                    <span style={{ fontSize: 11, color: "#999999" }}>
                      {hit.kind} · {formatDate(hit.updatedAt, viewer.locale ?? "zh-CN")}
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
                      {hit.snippet}
                    </p>
                  )}
                </Link>
              ))}

              {hits.length === 0 && (
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
      scope={q.trim() ? `${hits.length} ${zh ? "个结果" : "results"}` : zh ? "全部内容" : "Everything"}
      note={
        zh
          ? "助理和你搜到的是同一批内容：它也只能读你有权查看的文件。"
          : "The agent searches the same set you do: it can only read what you can read."
      }
      placeholder={zh ? "问这些结果…" : "Ask about these results…"}
      corner={withheld > 0 ? (zh ? `${withheld} 项未显示` : `${withheld} withheld`) : undefined}
    />
    </div>
  );
}
