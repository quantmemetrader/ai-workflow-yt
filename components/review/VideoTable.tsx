"use client";

import * as React from "react";
import Link from "next/link";
import { INK, LINE, MUTED, smallButton } from "@/components/projects/kit";
import { PlatformMark, Sparkline } from "@/components/review/ReviewParts";
import { publishPlatformName } from "@/lib/projects/publication";
import { engagement, fmtNum, type VideoRow } from "@/lib/review/types";

const STEP = 20;
const ORDER = ["douyin", "xiaohongshu", "bilibili", "youtube"];
type Sort = "new" | "plays" | "likes" | "eng";

/**
 * 每条视频: every upload on the studio's accounts, newest first, with its
 * numbers and a small trend. A row opens the video's own page.
 */
export function VideoTable({ videos, zh }: { videos: VideoRow[]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [chip, setChip] = React.useState<string>("all");
  const [sort, setSort] = React.useState<Sort>("new");
  const [shown, setShown] = React.useState(STEP);
  const platforms = React.useMemo(() => {
    const have = new Set(videos.map((v) => v.platform));
    return [...ORDER.filter((p) => have.has(p)), ...[...have].filter((p) => !ORDER.includes(p))];
  }, [videos]);
  const rows = React.useMemo(() => {
    const list = chip === "all" ? [...videos] : videos.filter((v) => v.platform === chip);
    const n = (x: number | null | undefined) => (typeof x === "number" ? x : -1);
    if (sort === "plays") list.sort((a, b) => n(b.stats.plays) - n(a.stats.plays));
    else if (sort === "likes") list.sort((a, b) => n(b.stats.likes) - n(a.stats.likes));
    else if (sort === "eng") list.sort((a, b) => n(engagement(b.stats)) - n(engagement(a.stats)));
    return list;
  }, [videos, chip, sort]);
  React.useEffect(() => setShown(STEP), [chip, sort]);

  if (!videos.length) return <div style={{ padding: 24, color: MUTED, fontSize: 13.5 }}>{t("账号上还没有读到视频。", "No videos read from the accounts yet.")}</div>;

  return (
    <div>
      <style>{CSS}</style>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "0 18px 12px" }}>
        {["all", ...platforms].map((p) => {
          const on = chip === p;
          const count = p === "all" ? videos.length : videos.filter((v) => v.platform === p).length;
          return (
            <button key={p} type="button" onClick={() => setChip(p)} style={{ ...smallButton(on), height: 30, borderRadius: 99, padding: "0 12px", gap: 6 }}>
              {p === "all" ? t("全部", "All") : publishPlatformName(p, zh)}
              <span style={{ opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>{count}</span>
            </button>
          );
        })}
        <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: MUTED }}>
          {t("排序", "Sort")}
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ height: 30, border: `1px solid ${LINE}`, borderRadius: 8, padding: "0 8px", fontFamily: "inherit", fontSize: 13, background: "#fff", color: INK }}>
            <option value="new">{t("最新发布", "Newest")}</option>
            <option value="plays">{t("播放最多", "Most plays")}</option>
            <option value="likes">{t("点赞最多", "Most likes")}</option>
            <option value="eng">{t("互动率最高", "Best engagement")}</option>
          </select>
        </label>
      </div>
      <div className="vt-row vt-head">
        <span />
        <span>{t("视频", "Video")}</span>
        <span className="vt-n">{t("播放", "Plays")}</span>
        <span className="vt-n">{t("点赞", "Likes")}</span>
        <span className="vt-n">{t("评论", "Comments")}</span>
        <span className="vt-n vt-h1">{t("转发", "Shares")}</span>
        <span className="vt-n vt-h1">{t("收藏", "Saves")}</span>
        <span className="vt-n vt-h2">{t("互动率", "Engagement")}</span>
        <span className="vt-n vt-h2">{t("走势", "Trend")}</span>
      </div>
      {rows.slice(0, shown).map((v) => {
        const eng = engagement(v.stats);
        return (
          <Link key={v.key} href={`/review/video/${encodeURIComponent(v.key)}`} prefetch={false} className="vt-row vt-body">
            <span className="vt-cover">
              {v.thumb ? <img src={v.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <PlatformMark platform={v.platform} size={22} />}
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="vt-title">{v.title || t("（无标题）", "(untitled)")}</span>
              <span className="vt-sub">
                <PlatformMark platform={v.platform} size={15} />
                <span>{publishPlatformName(v.platform, zh)}</span>
                {v.at ? <span>· {day(v.at, zh)}</span> : null}
                {v.project ? <span className="vt-proj">· {t("项目", "Project")}《{v.project.title}》</span> : null}
              </span>
            </span>
            <span className="vt-n vt-big" key={`p${v.stats.plays}`}>{v.stats.plays == null ? "" : fmtNum(v.stats.plays, zh)}</span>
            <span className="vt-n" key={`l${v.stats.likes}`}>{v.stats.likes == null ? "" : fmtNum(v.stats.likes, zh)}</span>
            <span className="vt-n" key={`c${v.stats.comments}`}>{v.stats.comments == null ? "" : fmtNum(v.stats.comments, zh)}</span>
            <span className="vt-n vt-h1">{v.stats.shares == null ? "" : fmtNum(v.stats.shares, zh)}</span>
            <span className="vt-n vt-h1">{v.stats.collects == null ? "" : fmtNum(v.stats.collects, zh)}</span>
            <span className="vt-n vt-h2">{eng === null ? "" : `${(eng * 100).toFixed(1)}%`}</span>
            <span className="vt-n vt-h2">{v.series.length > 1 ? <Sparkline points={v.series} width={64} height={24} label={t("走势", "Trend")} /> : null}</span>
          </Link>
        );
      })}
      {rows.length > shown ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "14px 0 16px" }}>
          <button type="button" onClick={() => setShown((n) => n + STEP)} style={{ ...smallButton(), height: 34, padding: "0 18px" }}>
            {t(`再看 ${Math.min(STEP, rows.length - shown)} 条`, `Show ${Math.min(STEP, rows.length - shown)} more`)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function day(iso: string, zh: boolean): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}${zh ? "年" : "-"}` : "";
  return zh ? `${y}${d.getMonth() + 1}月${d.getDate()}日` : `${y}${d.getMonth() + 1}/${d.getDate()}`;
}

const CSS = `
.vt-row { display: grid; grid-template-columns: 64px minmax(0,1fr) 76px 64px 56px 56px 56px 64px 72px; gap: 12px; align-items: center; padding: 10px 18px; }
.vt-head { font-size: 12px; color: ${MUTED}; border-top: 1px solid ${LINE}; border-bottom: 1px solid ${LINE}; background: #fafaf8; padding-top: 8px; padding-bottom: 8px; }
.vt-body { text-decoration: none; color: ${INK}; border-bottom: 1px solid #f0efeb; transition: background .12s ease; }
.vt-body:hover { background: #f7f7f5; }
.vt-n { text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; color: #454545; display: flex; justify-content: flex-end; }
.vt-big { font-weight: 600; color: ${INK}; }
.vt-cover { width: 64px; height: 36px; border-radius: 6px; overflow: hidden; background: #f1f0ec; display: flex; align-items: center; justify-content: center; }
.vt-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.vt-title { display: block; font-size: 13.5px; font-weight: 500; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vt-sub { display: flex; align-items: center; gap: 5px; margin-top: 3px; font-size: 12px; color: ${MUTED}; white-space: nowrap; overflow: hidden; min-width: 0; }
.vt-proj { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
@media (max-width: 1280px) { .vt-row { grid-template-columns: 64px minmax(0,1fr) 76px 64px 56px 64px 72px; } .vt-h1 { display: none; } }
@media (max-width: 1080px) { .vt-row { grid-template-columns: 64px minmax(0,1fr) 72px 60px 52px; } .vt-h2 { display: none; } }
`;
