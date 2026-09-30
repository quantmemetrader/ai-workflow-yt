import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

const FOLDER = { legal: "法务资料库", finance: "财务资料库" } as const;

/**
 * What is in a module's 资料库, for that module's AI: every file's name, id
 * and first line, so it knows the files exist and reads the right one
 * (Ryan, 30 Sep: "they expect the newly uploaded file to be used and
 * interpreted by AI already"). Searching alone missed them whenever the
 * model's query was worded differently from the file.
 */
export async function libraryDigest(tenantId: string, m: keyof typeof FOLDER): Promise<string> {
  const { rows } = await db
    .execute<{ id: string; name: string; gist: string | null; at: Date }>(sql`
      select f.id, f.name, left(regexp_replace(coalesce(f.text, ''), '\s+', ' ', 'g'), 160) as gist, f.created_at as at
        from files f
        join folders d on d.id = f.folder_id
       where f.tenant_id = ${tenantId} and f.deleted_at is null
         and d.tenant_id = ${tenantId} and d.parent_id is null and d.deleted_at is null and d.name = ${FOLDER[m]}
       order by f.created_at desc
       limit 40
    `)
    .catch(() => ({ rows: [] as { id: string; name: string; gist: string | null; at: Date }[] }));
  if (!rows.length) return "";
  const lines = rows.map((r) => `- ${r.name}（id: ${r.id}）${r.gist?.trim() ? `：${r.gist.trim()}` : "（还没读完）"}`);
  return `\n\n--- ${FOLDER[m]}（同事上传的文件） ---\n问到合同、发票、公司、金额、日期、条款时，先看这里有没有相关文件；有就用 read_file 读全文再回答，并说出依据的是哪个文件。不要说没有资料，除非这里和 search_files 都找不到。\n${lines.join("\n")}`;
}
