"use client";

import { useState } from "react";
import type { CompetitorRow } from "@/lib/social/service";
import {
  addCompetitorAction,
  removeCompetitorAction,
  syncCompetitorsAction,
} from "@/app/(app)/research/competitor-actions";
import { Badge, Empty, Row, clip, field, ghost, solid, useAction } from "@/components/ui/kit";

/**
 * How the studio compares with the channels it watches.
 *
 * This is what the TikHub key was bought for, and until now nothing used it:
 * Zernio can only ever see the accounts the studio owns, so "how are we doing
 * against them" had no source at all and the Trends dashboard had no
 * competitor rows.
 *
 * Median rather than mean, on both sides. One video that went far describes
 * that video, not a channel, and a mean lets it describe the channel.
 *
 * Public figures only. TikHub reads what the platform publishes to anybody
 * with a browser; nothing here is scraped, which Schedule A3(1) forbids.
 */
export function CompetitorPanel({
  competitors,
  ourMedian,
  configured,
  zh,
}: {
  competitors: CompetitorRow[];
  ourMedian: number | null;
  configured: boolean;
  zh: boolean;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const { busy, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ platform: "youtube", externalId: "", displayName: "", note: "" });

  const best = Math.max(ourMedian ?? 0, ...competitors.map((c) => c.medianViews ?? 0), 1);

  return (
    <section style={{ padding: "18px 20px 6px", borderTop: "1px solid #ededed" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{t("Channels we watch", "关注的频道")}</span>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {t("read from the outside, public figures only", "从外部读取，仅公开数据")}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
          {competitors.length > 0 && (
            <button type="button" disabled={busy} onClick={() => run(() => syncCompetitorsAction())} style={ghost}>
              {t("Check now", "立即检查")}
            </button>
          )}
          <button type="button" onClick={() => setAdding((a) => !a)} style={ghost}>
            {adding ? t("Close", "收起") : t("Watch a channel", "关注频道")}
          </button>
        </span>
      </div>

      {!configured && (
        <p style={{ fontSize: 11.5, color: "#a35f00", margin: "6px 0 0", lineHeight: 1.6 }}>
          {t(
            "No outside-world key is configured on this deployment, so nobody else's channel can be read.",
            "本部署尚未配置外部数据密钥，无法读取其他频道。",
          )}
        </p>
      )}

      {adding && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0 4px" }}>
          <select
            value={form.platform}
            onChange={(e) => setForm({ ...form, platform: e.target.value })}
            style={{ ...field, width: 140, height: 32 }}
          >
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="xiaohongshu">小红书</option>
            <option value="wechat">{t("WeChat Channels", "视频号")}</option>
          </select>
          <input
            value={form.externalId}
            onChange={(e) => setForm({ ...form, externalId: e.target.value })}
            placeholder={t("Channel id, for example UCxxxxxxxx", "频道 ID，例如 UCxxxxxxxx")}
            style={{ ...field, width: 280, height: 32 }}
          />
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder={t("What to call them", "显示名称")}
            style={{ ...field, width: 200, height: 32 }}
          />
          <button
            type="button"
            disabled={busy || !form.externalId.trim() || !configured}
            onClick={() =>
              run(
                () => addCompetitorAction({ ...form, handle: form.displayName }),
                () => setForm({ platform: "youtube", externalId: "", displayName: "", note: "" }),
              )
            }
            style={{ ...solid, opacity: busy || !form.externalId.trim() ? 0.45 : 1 }}
          >
            {t("Watch", "关注")}
          </button>
          <span style={{ fontSize: 11, color: "#c7c7c7" }}>
            {t(
              "Only YouTube is read today; the others are stored and will be read when a reader is written.",
              "目前仅读取 YouTube，其他平台会先保存，待读取器完成后再同步。",
            )}
          </span>
        </div>
      )}

      {competitors.length === 0 ? (
        <Empty
          title={t("No channels watched yet", "还没有关注任何频道")}
          body={t(
            "Add one and its recent videos and view counts appear beside the studio's own, so a number has something to be compared with.",
            "添加后，它最近的视频与播放量会与工作室自己的数据并排显示，数字才有参照。",
          )}
        />
      ) : (
        <div style={{ marginTop: 10 }}>
          <Row head>
            <span style={{ flexGrow: 1 }}>{t("Channel", "频道")}</span>
            <span style={{ width: 90 }}>{t("Posts", "视频数")}</span>
            <span style={{ width: 200 }}>{t("Median views", "播放量中位数")}</span>
            <span style={{ width: 220 }}>{t("Their best recent", "近期最佳")}</span>
            <span style={{ width: 60 }} />
          </Row>

          {/* Us, in the same table. A competitor table with no "us" row is a
              table of other people's numbers. */}
          <Row style={{ alignItems: "center", background: "#fafafa" }}>
            <span style={{ flexGrow: 1, fontWeight: 500 }}>{t("The studio", "本工作室")}</span>
            <span style={{ width: 90, color: "#c7c7c7" }}>—</span>
            <span style={{ width: 200 }}>
              <Bar value={ourMedian} best={best} tone="#171717" zh={zh} />
            </span>
            <span style={{ width: 220 }} />
            <span style={{ width: 60 }} />
          </Row>

          {competitors.map((c) => (
            <Row key={c.id} style={{ alignItems: "center" }}>
              <span style={{ flexGrow: 1, ...clip }} title={c.displayName ?? ""}>
                {c.displayName ?? c.handle ?? c.id}
                <span style={{ marginLeft: 7 }}>
                  <Badge tone="quiet">{c.platform}</Badge>
                </span>
                {c.lastError && (
                  <span style={{ marginLeft: 7 }}>
                    <Badge tone="bad">{t("could not read", "读取失败")}</Badge>
                  </span>
                )}
              </span>
              <span style={{ width: 90, color: "#7c7c7c", fontVariantNumeric: "tabular-nums" }}>{c.postCount}</span>
              <span style={{ width: 200 }}>
                <Bar value={c.medianViews} best={best} tone="#8fc2ef" zh={zh} />
              </span>
              <span style={{ width: 220, ...clip }} title={c.topPost?.title ?? ""}>
                {c.topPost?.permalink ? (
                  <a href={c.topPost.permalink} target="_blank" rel="noreferrer" style={{ color: "#007be0", fontSize: 11.5 }}>
                    {c.topPost.title ?? t("(untitled)", "（无标题）")}
                  </a>
                ) : (
                  <span style={{ color: "#c7c7c7", fontSize: 11.5 }}>—</span>
                )}
              </span>
              <span style={{ width: 60, textAlign: "right" }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => removeCompetitorAction(c.id))}
                  style={{ ...ghost, height: 22, fontSize: 10.5 }}
                >
                  {t("stop", "移除")}
                </button>
              </span>
            </Row>
          ))}

          <p style={{ fontSize: 11, color: "#c7c7c7", margin: "10px 0 0", lineHeight: 1.55 }}>
            {t(
              "Median, not mean: one video that went far describes that video, not a channel. Their figures are whatever the platform shows publicly, as read at the last check.",
              "使用中位数而非平均值：一条爆款只能代表这条视频，不能代表整个频道。对方数据为平台公开显示的数值，取自上次检查时。",
            )}
          </p>
        </div>
      )}
    </section>
  );
}

function Bar({ value, best, tone, zh }: { value: number | null; best: number; tone: string; zh: boolean }) {
  if (value === null) {
    return <span style={{ fontSize: 11.5, color: "#c7c7c7" }}>{zh ? "暂无数据" : "not reported"}</span>;
  }
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ flexGrow: 1, height: 5, background: "#f3f3f3", borderRadius: 3, minWidth: 40 }}>
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${Math.max(2, Math.round((value / best) * 100))}%`,
            background: tone,
            borderRadius: 3,
          }}
        />
      </span>
      <span style={{ fontSize: 11.5, color: "#525252", fontVariantNumeric: "tabular-nums", width: 62, textAlign: "right" }}>
        {compact(value)}
      </span>
    </span>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
