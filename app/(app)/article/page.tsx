import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { possibleApprovers } from "@/lib/script/service";
import {
  articleDetail,
  libraryCounts,
  listArticles,
  publicationsFor,
  scriptsToDrawOn,
  type ArticleStatus,
} from "@/lib/article/service";
import { ArticleScreen } from "@/components/article/ArticleScreen";

export const metadata = { title: "文章 · Articles" };

/**
 * Article — the written sibling of Script.
 *
 * One route with three screens rather than three routes, for the reason
 * Publish is one route with four: the library, the editor and the publishing
 * log are three views of the same articles, and three routes would mean three
 * copies of the same column. Which article is open, and which screen, are both
 * in the URL, so a link to "the piece waiting on you" is a link somebody can
 * send.
 */
const STATUSES = ["draft", "in_review", "published", "archived"] as const;
const isStatus = (v: unknown): v is ArticleStatus =>
  typeof v === "string" && (STATUSES as readonly string[]).includes(v);

export default async function ArticlePage({
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

  const openId = one("id") ?? null;
  const rawStatus = one("status");
  const status = isStatus(rawStatus) ? rawStatus : null;
  const query = one("q") ?? "";

  const [items, counts, log, approvers, scripts, detail] = await Promise.all([
    listArticles(viewer, { status: status ?? undefined, query }),
    libraryCounts(viewer),
    publicationsFor(viewer),
    possibleApprovers(viewer),
    scriptsToDrawOn(viewer),
    openId ? articleDetail(viewer, openId) : Promise.resolve(null),
  ]);

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

  return (
    <ArticleScreen
      locale={viewer.locale ?? "zh-CN"}
      viewerId={viewer.id}
      articles={items}
      counts={counts}
      log={log}
      /* An article that was deleted, or belongs to another studio, simply is
         not open — the library is a better answer than a 404 on a screen that
         is mostly a list. */
      detail={detail}
      status={status}
      query={query}
      approvers={approvers.map((a) => ({ id: a.id, name: (zh && a.nameLocal) || a.name }))}
      scripts={scripts.map((s) => ({ id: s.id, title: s.title, status: s.status }))}
      model={answeringModel()}
    />
  );
}
