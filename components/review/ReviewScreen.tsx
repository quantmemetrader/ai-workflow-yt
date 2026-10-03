"use client";

import { Ago } from "@/components/ui/Ago";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Card, Empty, GoButton, INK, LINE, MUTED, NextStep, PageBody, bigButton, smallButton } from "@/components/projects/kit";
import { notify } from "@/lib/client/notify";
import { PUBLISH_PLATFORMS, publishPlatformName } from "@/lib/projects/publication";
import {
  addPostLinkAction,
  handReviewAction,
  linkAccountPostAction,
  refreshReviewAction,
  removePostAction,
  saveManualPostAction,
  writeReviewAction,
} from "@/app/(app)/review/actions";
import { STAT_KEYS, STAT_LABEL, fmtNum, type AccountView, type PostView, type ProjectReview, type Stats } from "@/lib/review/types";
import { AccountTiles, NumbersForm, PlatformMark, Sparkline, ago, inputStyle } from "@/components/review/ReviewParts";

const PLATFORM_OF_ACCOUNT: Record<string, string> = { douyin: "douyin", xiaohongshu: "xiaohongshu", wechat_channels: "shipinhao", bilibili: "bilibili" };

/**
 * 5 复盘: how the video did once it was out, how the accounts are doing,
 * and the researcher's read of it, handed back to 选题 so the next topic
 * learns from this one. Ryan: the review belongs after publishing, not
 * inside trend research.
 */
export function ReviewScreen({
  projectId,
  zh,
  published,
  posts,
  accounts,
  review,
  canWork,
  stale,
}: {
  projectId: string;
  zh: boolean;
  published: boolean;
  posts: PostView[];
  accounts: AccountView[];
  review: ProjectReview | null;
  canWork: boolean;
  /** Some reading is older than its limit: read again once, quietly, on open. */
  stale: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [, start] = React.useTransition();
  const [busy, setBusy] = React.useState<null | "refresh" | "review" | "hand">(null);
  const auto = React.useRef(false);

  React.useEffect(() => {
    if (!stale || !canWork || auto.current) return;
    auto.current = true;
    setBusy("refresh");
    refreshReviewAction(projectId, false)
      .then(() => router.refresh())
      .finally(() => setBusy(null));
  }, [stale, canWork, projectId, router]);

  const run = (which: "refresh" | "review" | "hand", fn: () => Promise<{ error?: string }>, ok?: string) => {
    setBusy(which);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (r.error) notify(r.error);
      else if (ok) notify(ok, "ok");
      router.refresh();
    });
  };

  const hasNumbers = posts.some((p) => p.stats);
  /* Only what some platform gives (the owner, 29 Sep: "for stuff we can't get just remove those"). */
  const cols = STAT_KEYS.filter((k) => posts.some((p) => typeof p.stats?.[k] === "number"));
  const showCompletion = posts.some((p) => typeof p.stats?.completion === "number");
  const showTrend = posts.some((p) => p.series.length > 1);
  const reviewDone = Boolean(review?.handedAt);
  const totals: Stats = { plays: null, likes: null, comments: null, shares: null, collects: null };
  for (const p of posts) for (const k of STAT_KEYS) if (typeof p.stats?.[k] === "number") totals[k] = (totals[k] ?? 0) + (p.stats![k] as number);

  const refreshButton = (
    <button type="button" disabled={busy !== null || !canWork} onClick={() => run("refresh", () => refreshReviewAction(projectId, true), t("数据已更新", "Numbers updated"))} style={bigButton("primary", busy !== null || !canWork)}>
      <Icon name="undo" size={15} />
      {busy === "refresh" ? t("读取中…", "Reading…") : t("刷新数据", "Refresh numbers")}
    </button>
  );

  return (
    <PageBody>
      {!published ? (
        <NextStep state="waiting" zh={zh} text={t("发布后这里会显示这条视频在各平台的数据。先去发布，或者在下面直接贴上已发布作品的链接。", "Once it's out, its numbers on each platform show here. Publish it first, or paste the link of a post below.")}>
          <GoButton href={`/projects/${projectId}/publish`}>{t("去发布 →", "Go to Publish →")}</GoButton>
        </NextStep>
      ) : (
        <NextStep
          state={reviewDone ? "done" : "you"}
          zh={zh}
          text={
            reviewDone
              ? t("复盘做完了，建议已交给选题。数据还会每小时更新，有新数据时可以再复盘。", "The review is done and its ideas are with Topic. Numbers keep updating hourly.")
              : review
                ? t("最后一步：看完研究员的复盘，点下面的「完成复盘」，建议会交给选题。", "Last step: read the review, then press Finish below; its ideas go to Topic.")
                : t("先刷新数据，再让研究员写复盘。", "Refresh the numbers, then ask the researcher for the review.")
          }
        >
          {refreshButton}
        </NextStep>
      )}

      {/* ---- this video's numbers ---- */}
      <Card
        icon="play"
        title={t("本片数据", "This video")}
        sub={t("各平台的最新数据。读不到的数字可以手动填。", "Each platform's latest numbers. Type in what can't be read.")}
        right={posts.length ? <span style={{ fontSize: 12, color: MUTED }}>{t("更新于 ", "Updated ")}<Ago iso={posts.map((p) => p.at).filter((x): x is string => Boolean(x)).sort().pop() ?? null} zh={zh} /></span> : null}
        pad={false}
      >
        {posts.length ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
              <thead>
                <tr style={{ color: MUTED, fontSize: 12, textAlign: "right" }}>
                  <th style={{ ...th, textAlign: "left", paddingLeft: 18 }}>{t("平台", "Platform")}</th>
                  {cols.map((k) => (
                    <th key={k} style={th}>{zh ? STAT_LABEL[k].zh : STAT_LABEL[k].en}</th>
                  ))}
                  {showCompletion ? <th style={th}>{t("完播率", "Completion")}</th> : null}
                  {showTrend ? <th style={th}>{t("走势", "Trend")}</th> : null}
                  <th style={{ ...th, paddingRight: 18 }} />
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <PostRow key={`${p.platform}|${p.url}`} p={p} zh={zh} projectId={projectId} canWork={canWork} cols={cols} showCompletion={showCompletion} showTrend={showTrend} />
                ))}
                {posts.length > 1 && hasNumbers ? (
                  <tr style={{ borderTop: `1px solid ${LINE}`, fontWeight: 600 }}>
                    <td style={{ ...td, paddingLeft: 18 }}>{t("合计", "Total")}</td>
                    {cols.map((k) => (
                      <td key={k} style={num}>{fmtNum(totals[k], zh)}</td>
                    ))}
                    {showCompletion ? <td style={num} /> : null}
                    {showTrend ? <td style={num} /> : null}
                    <td style={{ ...td, paddingRight: 18 }} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: "0 18px 4px" }}>
            <Empty icon="link" text={t("还没有作品链接。发布时贴上链接，或者在下面添加。", "No post links yet. Add them when publishing, or below.")} />
          </div>
        )}
        {canWork ? <AddPost projectId={projectId} zh={zh} accounts={accounts} /> : null}
      </Card>

      {/* ---- the researcher's review ---- */}
      <Card
        icon="spark"
        tone="accent"
        title={t("AI 复盘", "AI review")}
        sub={review ? t(`研究员 · ${ago(review.at, zh)}（${review.byName} 请求）`, `The researcher · ${ago(review.at, zh)} (asked by ${review.byName})`) : t("研究员根据本片数据和账号近期作品，写出做得好的、可以改进的，和下一步的选题建议。", "The researcher reads the numbers against the account's recent posts: what worked, what to change, and what to make next.")}
        footer={
          canWork ? (
            <>
              <button type="button" disabled={busy !== null} onClick={() => run("review", () => writeReviewAction(projectId), t("复盘写好了", "Review written"))} style={bigButton(review ? "secondary" : "primary", busy !== null)}>
                <Icon name="spark" size={15} />
                {busy === "review" ? t("研究员正在写…", "Writing…") : review ? t("重新复盘", "Write it again") : t("让研究员写复盘", "Ask the researcher")}
              </button>
              {review ? (
                review.handedAt ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#1e7a4f" }}>
                    <Icon name="check" size={14} />
                    {t(`复盘已完成 · 建议已交给选题 · ${ago(review.handedAt, zh)}`, `Review done · ideas with Topic · ${ago(review.handedAt, zh)}`)}
                  </span>
                ) : (
                  <button type="button" disabled={busy !== null} onClick={() => run("hand", () => handReviewAction(projectId), t("复盘完成，建议已交给选题", "Review done; ideas are with Topic"))} style={bigButton("primary", busy !== null)}>
                    <Icon name="check" size={15} />
                    {busy === "hand" ? t("正在完成…", "Finishing…") : review.ideas.length ? t("完成复盘，把建议交给选题", "Finish and hand the ideas to Topic") : t("完成复盘", "Finish the review")}
                  </button>
                )
              ) : null}
              {!hasNumbers && !review ? <span style={{ fontSize: 12, color: MUTED }}>{t("还没有数据时，复盘只能参考账号近期作品。", "Without numbers yet, the review can only go on the account's recent posts.")}</span> : null}
            </>
          ) : null
        }
      >
        {review ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: INK }}>{review.verdict}</p>
            <div className="rv-two" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <style>{`@media (max-width: 760px){.rv-two{grid-template-columns:1fr !important}}`}</style>
              <Points title={t("做得好的", "What worked")} items={review.good} color="#1e7a4f" />
              <Points title={t("可以改进的", "What to change")} items={review.improve} color="#b45309" />
            </div>
            {review.ideas.length ? (
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: INK, marginBottom: 8 }}>{t("下一步选题建议", "Next topic ideas")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {review.ideas.map((i, n) => (
                    <div key={n} style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 10, background: "#fff", border: "1px solid #d6e4fb" }}>
                      <span style={{ width: 22, height: 22, borderRadius: 99, background: "#e3edfd", color: "#1f5fbf", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{i.title}</div>
                        {i.why ? <div style={{ fontSize: 12.5, color: "#555", marginTop: 2, lineHeight: 1.55 }}>{i.why}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <Empty icon="spark" text={t("还没有复盘。", "No review yet.")} />
        )}
      </Card>

      {/* ---- the accounts ---- */}
      <Card
        icon="eye"
        title={t("账号概况", "Accounts")}
        sub={t("工作室的所有账号：粉丝、获赞和最近作品（抖音、小红书、B站，以及已连接的 YouTube、LinkedIn）。", "The studio's accounts on Douyin, Xiaohongshu and Bilibili: followers, likes and latest posts. Updated every 6 hours.")}
        right={
          <Link href="/review" prefetch={false} style={smallButton(false)}>
            {t("账号数据", "Account data")}
          </Link>
        }
      >
        <AccountTiles accounts={accounts} zh={zh} canWork={canWork} />
      </Card>
    </PageBody>
  );
}

const th: React.CSSProperties = { fontWeight: 500, padding: "8px 10px", borderBottom: `1px solid ${LINE}`, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "10px 10px", borderBottom: "1px solid #f0efeb", verticalAlign: "middle" };
const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

function Points({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, background: "#fff", border: "1px solid #e7ecf5" }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color, marginBottom: 6 }}>{title}</div>
      {items.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: 13, lineHeight: 1.6, color: "#333" }}>
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 12.5, color: MUTED }}>—</div>
      )}
    </div>
  );
}

function PostRow({ p, zh, projectId, canWork, cols, showCompletion, showTrend }: { p: PostView; zh: boolean; projectId: string; canWork: boolean; cols: readonly (typeof STAT_KEYS)[number][]; showCompletion: boolean; showTrend: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [typing, setTyping] = React.useState(false);
  const [pending, start] = React.useTransition();
  const lead = typeof p.stats?.plays === "number" ? "plays" : "likes";
  const vsMedian = p.stats && p.median && typeof p.stats[lead] === "number" && typeof p.median[lead] === "number" && p.median[lead]! > 0 ? (p.stats[lead] as number) / (p.median[lead] as number) : null;
  return (
    <>
      <tr>
        <td style={{ ...td, paddingLeft: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <PlatformMark platform={p.platform} size={22} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: INK }}>
                {publishPlatformName(p.platform, zh)}
                {vsMedian !== null ? (
                  <span title={t("和账号近期作品的中位数相比", "Against the account's typical recent post")} style={{ fontSize: 11, fontWeight: 600, color: vsMedian >= 1 ? "#1e7a4f" : "#8a8a8a", background: vsMedian >= 1 ? "#eef8f2" : "#f3f3f1", borderRadius: 99, padding: "0 7px", lineHeight: "18px" }}>
                    {vsMedian >= 1 ? t(`高于平时 ${vsMedian.toFixed(1)}×`, `${vsMedian.toFixed(1)}× usual`) : t(`平时的 ${Math.round(vsMedian * 100)}%`, `${Math.round(vsMedian * 100)}% of usual`)}
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: 11.5, color: MUTED, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.error ? <span style={{ color: "#b45309" }}>{p.error}</span> : p.title ?? (p.url ? p.url : t("没有链接", "No link"))}
                {p.at ? <>{` · ${p.source === "manual" ? t("手动 ", "typed ") : ""}`}<Ago iso={p.at} zh={zh} /></> : ""}
              </div>
            </div>
          </div>
        </td>
        {cols.map((k) => (
          <td key={k} style={num}>{typeof p.stats?.[k] === "number" ? fmtNum(p.stats[k] as number, zh) : ""}</td>
        ))}
        {showCompletion ? <td style={num}>{typeof p.stats?.completion === "number" ? `${Math.round(p.stats.completion * 100)}%` : ""}</td> : null}
        {showTrend ? (
          <td style={{ ...td, textAlign: "right" }}>
            <span style={{ display: "inline-block" }}>{p.series.length > 1 ? <Sparkline points={p.series} width={72} height={24} label={t("走势", "Trend")} /> : null}</span>
          </td>
        ) : null}
        <td style={{ ...td, paddingRight: 18, textAlign: "right", whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-flex", gap: 6 }}>
            {p.url ? (
              <a href={p.url} target="_blank" rel="noreferrer" style={smallButton(false)} title={t("打开作品", "Open the post")}>
                <Icon name="external" size={12} />
              </a>
            ) : null}
            {canWork ? (
              <button type="button" onClick={() => setTyping((v) => !v)} style={smallButton(false)}>
                {t("手动填", "Type in")}
              </button>
            ) : null}
            {canWork && p.source !== null ? (
              <button
                type="button"
                disabled={pending}
                title={t("不再跟踪这条（已发布记录里的链接不受影响）", "Stop tracking (the published record keeps its link)")}
                onClick={() => {
                  if (!window.confirm(t("不再跟踪这条作品的数据？", "Stop tracking this post?"))) return;
                  start(async () => {
                    await removePostAction(projectId, p.platform, p.url);
                    router.refresh();
                  });
                }}
                style={{ ...smallButton(false), color: "#8a8a8a" }}
              >
                {t("移除", "Remove")}
              </button>
            ) : null}
          </span>
        </td>
      </tr>
      {typing ? (
        <tr>
          <td colSpan={9} style={{ ...td, paddingLeft: 18, paddingRight: 18 }}>
            <NumbersForm
              zh={zh}
              fields={[...STAT_KEYS.map((k) => ({ key: k, label: zh ? STAT_LABEL[k].zh : STAT_LABEL[k].en })), { key: "completion", label: t("完播率 %", "Completion %") }]}
              onCancel={() => setTyping(false)}
              onSave={async (v) => {
                const r = await saveManualPostAction(projectId, p.platform, p.url, v);
                if (r.error) {
                  notify(r.error);
                  return false;
                }
                router.refresh();
                return true;
              }}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Add a post: paste its link, or pick it from the account's latest posts (already read, so free). */
function AddPost({ projectId, zh, accounts }: { projectId: string; zh: boolean; accounts: AccountView[] }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [url, setUrl] = React.useState("");
  const [platform, setPlatform] = React.useState("");
  const [picking, setPicking] = React.useState(false);
  const [pending, start] = React.useTransition();
  const withPosts = accounts.filter((a) => a.posts.length > 0);
  return (
    <div style={{ padding: "12px 18px 16px", borderTop: `1px solid ${LINE}`, display: "flex", flexDirection: "column", gap: 10 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim()) return;
          start(async () => {
            const r = await addPostLinkAction(projectId, url, platform || undefined);
            if (r.error) notify(r.error);
            else {
              setUrl("");
              setPlatform("");
              notify(t("已添加，正在读取数据", "Added; reading its numbers"), "ok");
            }
            router.refresh();
          });
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>{t("添加作品", "Add a post")}</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("粘贴作品链接或分享文字（抖音 / 小红书 / B站）", "Paste the post's link or share text")} style={{ ...inputStyle, flexGrow: 1, minWidth: 240 }} />
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ ...inputStyle, width: 120 }} aria-label={t("平台", "Platform")}>
          <option value="">{t("自动识别", "Detect")}</option>
          {PUBLISH_PLATFORMS.filter((p) => p.key !== "other").map((p) => (
            <option key={p.key} value={p.key}>
              {zh ? p.zh : p.en}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending || !url.trim()} style={smallButton(true)}>
          {pending ? t("添加中…", "Adding…") : t("添加", "Add")}
        </button>
        {withPosts.length ? (
          <button type="button" onClick={() => setPicking((v) => !v)} style={smallButton(picking)}>
            {t("从账号最近作品里选", "Pick from latest posts")}
          </button>
        ) : null}
      </form>
      {picking ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {withPosts.map((a) => (
            <div key={a.platform} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
                <PlatformMark platform={a.platform} size={18} />
                {zh ? a.zh : a.en}
              </div>
              {a.posts.slice(0, 6).map((post) => (
                <button
                  key={post.id}
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await linkAccountPostAction(projectId, PLATFORM_OF_ACCOUNT[a.platform] ?? a.platform, post);
                      if (r.error) notify(r.error);
                      else {
                        notify(t("已关联到这个项目", "Linked to this project"), "ok");
                        setPicking(false);
                      }
                      router.refresh();
                    })
                  }
                  style={{ display: "flex", gap: 8, alignItems: "center", textAlign: "left", border: 0, background: "#fafaf8", borderRadius: 8, padding: "6px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: "#333" }}
                >
                  <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.title}</span>
                  <span style={{ color: MUTED, flexShrink: 0 }}>{post.at ? post.at.slice(5, 10) : ""}</span>
                  <Icon name="plus" size={12} />
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ fontSize: 11.5, color: MUTED }}>{/* No vendor names in user text (QA, 2 Oct). */}
        {t("说明：数据按次计费读取，所以每条作品最多每小时读一次；「刷新数据」会立即重读。", "Numbers are billed per read, so each post is read at most hourly; Refresh reads now.")}</div>
    </div>
  );
}

