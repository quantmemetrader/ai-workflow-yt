"use client";

import type * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Card, INK, LINE, MUTED, PageBody, smallButton } from "@/components/projects/kit";
import { PlatformMark } from "@/components/review/ReviewParts";
import { day } from "@/components/review/VideoTable";
import { publishPlatformName } from "@/lib/projects/publication";
import { STAT_KEYS, STAT_LABEL, engagement, fmtNum, type Stats, type VideoRow } from "@/lib/review/types";

/**
 * One video's numbers (账号数据 › 视频): what it got, against the account's
 * usual post on that platform, how it grew, and the same video on the other
 * platforms.
 */
export function VideoDetail({ zh, video, siblings, typical }: { zh: boolean; video: VideoRow; siblings: VideoRow[]; typical: Stats | null }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const eng = engagement(video.stats);
  const everywhere = [video, ...siblings];
  const total = (k: (typeof STAT_KEYS)[number]) => {
    const xs = everywhere.map((v) => v.stats[k]).filter((n): n is number => typeof n === "number");
    return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
  };

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#f6f5f2", overflowY: "auto" }}>
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${LINE}`, background: "rgba(250,250,248,.92)" }}>
        <div style={{ maxWidth: 1180, padding: "14px 32px 16px", display: "flex", gap: 18, alignItems: "center", minWidth: 0 }}>
          <div style={{ width: 176, height: 99, borderRadius: 10, overflow: "hidden", background: "#eceae5", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {video.thumb ? <img src={video.thumb} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <PlatformMark platform={video.platform} size={40} />}
          </div>
          <div style={{ minWidth: 0, flexGrow: 1 }}>
            <Link href="/review" prefetch={false} style={{ fontSize: 12.5, color: MUTED, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
              ‹ {t("账号数据", "Account data")}
            </Link>
            <h1 style={{ margin: "4px 0 0", fontSize: 19, fontWeight: 650, color: INK, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{video.title || t("（无标题）", "(untitled)")}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: "#555", flexWrap: "wrap" }}>
              <PlatformMark platform={video.platform} size={20} />
              <span>{publishPlatformName(video.platform, zh)}</span>
              {video.at ? <span style={{ color: MUTED }}>· {t("发布于", "Posted")} {day(video.at, zh)}</span> : null}
              {video.project ? (
                <Link href={`/projects/${video.project.id}/review`} prefetch={false} style={{ color: "#1f6feb", textDecoration: "none", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>
                  · {t("项目", "Project")}《{video.project.title}》
                </Link>
              ) : null}
              {video.url ? (
                <a href={video.url} target="_blank" rel="noopener noreferrer" style={{ ...smallButton(), height: 28, marginLeft: 4, textDecoration: "none", gap: 5 }}>
                  {t("打开原视频", "Open on platform")} <Icon name="external" size={12} />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <PageBody width={1180}>
        <Card icon="eye" title={t("数据", "Numbers")} sub={typical ? t(`和这个账号在${publishPlatformName(video.platform, zh)}的平常一条视频比`, `Against this account's usual post here`) : undefined}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {STAT_KEYS.map((k) => (
              <Tile key={k} label={zh ? STAT_LABEL[k].zh : STAT_LABEL[k].en} value={video.stats[k]} usual={typical?.[k] ?? null} zh={zh} />
            ))}
            <div style={tile}>
              <div style={{ fontSize: 12, color: MUTED }}>{t("互动率", "Engagement")}</div>
              <div style={{ fontSize: 22, fontWeight: 650, color: INK, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{eng === null ? "—" : `${(eng * 100).toFixed(1)}%`}</div>
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{t("点赞、评论、转发、收藏 ÷ 播放", "Likes, comments, shares, saves ÷ plays")}</div>
            </div>
          </div>
        </Card>

        <Card icon="spark" title={t("走势", "Over time")} sub={video.seriesOf === "plays" ? t("累计播放", "Total plays") : t("累计点赞", "Total likes")}>
          {video.series.length > 1 ? <Chart points={video.series} zh={zh} /> : <div style={{ fontSize: 13.5, color: MUTED, padding: "8px 0" }}>{t("每 6 小时读一次数据，读到第二次就能看到走势。", "Read every 6 hours; the trend shows from the second reading.")}</div>}
        </Card>

        {siblings.length ? (
          <Card icon="film" title={t("同一条视频在其他平台", "The same video elsewhere")} sub={t(`全平台合计：播放 ${fmtNum(total("plays"), zh)} · 点赞 ${fmtNum(total("likes"), zh)} · 评论 ${fmtNum(total("comments"), zh)}`, `All platforms: ${fmtNum(total("plays"), zh)} plays · ${fmtNum(total("likes"), zh)} likes`)} pad={false}>
            {siblings.map((s) => (
              <Link key={s.key} href={`/review/video/${encodeURIComponent(s.key)}`} prefetch={false} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 80px 70px 60px", gap: 12, alignItems: "center", padding: "11px 18px", borderTop: `1px solid ${LINE}`, textDecoration: "none", color: INK }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <PlatformMark platform={s.platform} size={22} />
                  <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap" }}>{publishPlatformName(s.platform, zh)}</span>
                  <span style={{ fontSize: 12.5, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{s.at ? day(s.at, zh) : ""}</span>
                </span>
                <span style={num}>{t("播放", "Plays")} {fmtNum(s.stats.plays, zh)}</span>
                <span style={num}>{t("点赞", "Likes")} {fmtNum(s.stats.likes, zh)}</span>
                <span style={num}>{t("评论", "Cmts")} {fmtNum(s.stats.comments, zh)}</span>
              </Link>
            ))}
          </Card>
        ) : null}
      </PageBody>
    </div>
  );
}

const tile: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px", background: "#fff", minWidth: 0 };
const num: React.CSSProperties = { textAlign: "right", fontSize: 13, color: "#454545", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

function Tile({ label, value, usual, zh }: { label: string; value: number | null; usual: number | null; zh: boolean }) {
  const ratio = typeof value === "number" && usual ? value / usual : null;
  const up = ratio !== null && ratio >= 1.15;
  const down = ratio !== null && ratio <= 0.85;
  return (
    <div style={tile}>
      <div style={{ fontSize: 12, color: MUTED }}>{label}</div>
      <div key={String(value)} style={{ fontSize: 22, fontWeight: 650, color: INK, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{fmtNum(value, zh)}</div>
      <div style={{ fontSize: 11.5, marginTop: 2, color: up ? "#0b7a63" : down ? "#b4532a" : MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {usual === null || value === null ? (zh ? "—" : "—") : `${zh ? "平时" : "usual"} ${fmtNum(usual, zh)}${ratio !== null && (up || down) ? ` · ${ratio >= 1 ? `${ratio.toFixed(1)}${zh ? " 倍" : "×"}` : `${Math.round(ratio * 100)}%`}` : ""}`}
      </div>
    </div>
  );
}

/** Total plays (or likes) at each reading: a line with its first and last day and the top value. */
function Chart({ points, zh }: { points: { at: string; v: number }[]; zh: boolean }) {
  const W = 1000;
  const H = 200;
  const max = Math.max(...points.map((p) => p.v));
  const min = Math.min(...points.map((p) => p.v));
  const span = max - min || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * W, H - 12 - ((p.v - min) / span) * (H - 28)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: MUTED, marginBottom: 4 }}>
        <span>{fmtNum(max, zh)}</span>
        <span>{zh ? `${points.length} 次读取` : `${points.length} readings`}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 200, display: "block" }} role="img" aria-label={zh ? "走势" : "Trend"}>
        <polygon points={`0,${H} ${line} ${W},${H}`} fill="rgba(31,111,235,.08)" />
        <polyline points={line} fill="none" stroke="#1f6feb" strokeWidth={2.2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: MUTED, marginTop: 4 }}>
        <span>{day(points[0].at, zh)}</span>
        <span>{fmtNum(min, zh)} → {fmtNum(points[points.length - 1].v, zh)}</span>
        <span>{day(points[points.length - 1].at, zh)}</span>
      </div>
    </div>
  );
}
