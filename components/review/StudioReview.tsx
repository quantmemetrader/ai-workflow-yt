"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Card, Empty, INK, LINE, MUTED, PageBody, bigButton, smallButton } from "@/components/projects/kit";
import { notify } from "@/lib/client/notify";
import { publishPlatformName, publishedDay } from "@/lib/projects/publication";
import { refreshReviewAction } from "@/app/(app)/review/actions";
import { STAT_KEYS, STAT_LABEL, fmtNum, type AccountView } from "@/lib/review/types";
import type { PublishedRow } from "@/lib/review/service";
import { AccountTiles, PlatformMark, ago } from "@/components/review/ReviewParts";

export function StudioReview({ zh, accounts, rows, canWork, stale, hasChannels }: { zh: boolean; accounts: AccountView[]; rows: PublishedRow[]; canWork: boolean; stale: boolean; hasChannels: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const auto = React.useRef(false);
  const refresh = React.useCallback(
    async (force: boolean) => {
      setBusy(true);
      const r = await refreshReviewAction(null, force);
      setBusy(false);
      if (r.error) notify(r.error);
      router.refresh();
    },
    [router],
  );
  React.useEffect(() => {
    if (stale && canWork && !auto.current) {
      auto.current = true;
      void refresh(false);
    }
  }, [stale, canWork, refresh]);

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#f6f5f2" }}>
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${LINE}`, background: "rgba(250,250,248,.92)" }}>
        <div style={{ maxWidth: 1180, padding: "14px 32px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: INK }}>{t("作品复盘", "Published work")}</h1>
          <span style={{ fontSize: 12.5, color: MUTED, flexGrow: 1 }}>{t("发布之后看数据：账号涨粉、每条作品的表现。每个项目的「复盘」页可以让研究员写复盘。", "After publishing: account growth and how each post did. Each project's Review tab has the researcher's write-up.")}</span>
          {canWork ? (
            <button type="button" disabled={busy} onClick={() => void refresh(true)} style={bigButton("primary", busy)}>
              <Icon name="undo" size={15} />
              {busy ? t("读取中…", "Reading…") : t("刷新数据", "Refresh numbers")}
            </button>
          ) : null}
        </div>
      </div>
      <PageBody width={1180}>
        <Card icon="eye" title={t("账号概况", "Accounts")} sub={t("工作室的所有账号：抖音、小红书、B站，以及已连接的 YouTube、LinkedIn。", "The studio's accounts on Douyin, Xiaohongshu and Bilibili, updated every 6 hours.")}>
          <AccountTiles accounts={accounts} zh={zh} canWork={canWork} />
        </Card>

        <Card icon="play" title={t("已发布的项目", "Published projects")} sub={t("每个项目在各平台作品的最新数据之和。点开进入它的复盘页。", "Each project's latest numbers, added up across platforms. Open one for its review.")} pad={false}>
          {rows.length ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 820 }}>
                <thead>
                  <tr style={{ color: MUTED, fontSize: 12, textAlign: "right" }}>
                    <th style={{ ...th, textAlign: "left", paddingLeft: 18 }}>{t("项目", "Project")}</th>
                    <th style={{ ...th, textAlign: "left" }}>{t("平台", "Platforms")}</th>
                    {STAT_KEYS.map((k) => (
                      <th key={k} style={th}>{zh ? STAT_LABEL[k].zh : STAT_LABEL[k].en}</th>
                    ))}
                    <th style={{ ...th, paddingRight: 18 }}>{t("复盘", "Review")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ ...td, paddingLeft: 18, maxWidth: 320 }}>
                        <Link href={`/projects/${r.id}/review`} prefetch={false} style={{ color: INK, fontWeight: 600, textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.title}
                        </Link>
                        <div style={{ fontSize: 11.5, color: MUTED }}>
                          {r.publishedAt ? t(`发布于 ${publishedDay(r.publishedAt, true)}`, `Published ${publishedDay(r.publishedAt, false)}`) : t("已完成", "Done")}
                          {r.lastReadAt ? ` · ${t("数据", "numbers")} ${ago(r.lastReadAt, zh)}` : ""}
                        </div>
                      </td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", gap: 4 }}>
                          {r.platforms.length ? r.platforms.map((k) => <span key={k} title={publishPlatformName(k, zh)}><PlatformMark platform={k} size={20} /></span>) : <span style={{ color: MUTED }}>—</span>}
                        </span>
                      </td>
                      {STAT_KEYS.map((k) => (
                        <td key={k} style={num}>{fmtNum(r.totals[k], zh)}</td>
                      ))}
                      <td style={{ ...td, paddingRight: 18, textAlign: "right" }}>
                        <Link href={`/projects/${r.id}/review`} prefetch={false} style={smallButton(false)}>
                          {r.reviewed ? t("看复盘", "Open") : t("去复盘", "Review it")}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: "0 18px 18px" }}>
              <Empty icon="play" text={t("还没有已发布的项目。", "Nothing published yet.")} />
            </div>
          )}
        </Card>

        {hasChannels ? (
          <Card
            icon="link"
            title={t("已连接渠道的数据", "Connected channels")}
            sub={t("通过授权连接的 YouTube、LinkedIn 等渠道：每条内容的观看、互动和评论，可按时间和平台筛选。", "YouTube, LinkedIn and other connected channels: views, engagement and comments per post, by window and platform.")}
            right={
              <Link href="/review/channels" prefetch={false} style={smallButton(false)}>
                {t("打开", "Open")} <Icon name="external" size={12} />
              </Link>
            }
          />
        ) : null}
      </PageBody>
    </div>
  );
}

const th: React.CSSProperties = { fontWeight: 500, padding: "8px 10px", borderBottom: `1px solid ${LINE}`, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "10px 10px", borderBottom: "1px solid #f0efeb", verticalAlign: "middle" };
const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
