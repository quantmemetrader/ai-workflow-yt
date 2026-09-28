"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { PlatformMark } from "@/components/ui/PlatformMark";
import { PageBody, smallButton, INK, MUTED, LINE } from "@/components/projects/kit";
import { BEAT_FEEDS, type HotRow } from "@/lib/research/platform-catalog";
import { acrossPlatforms, tabRows, type BeatRow, type Lists } from "@/lib/research/beat-view";
import { DEFAULT_BEATS, type BeatConfig } from "@/lib/research/beats";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";

/**
 * 选题 · 热点榜 — what is hot on each platform right now, as one plain list.
 *
 * The same stored lists the old trends board read (the platforms searched
 * for the studio's beats every few hours, `/api/research/hot`), drawn with
 * three columns: the post, the platform, how hot. A row of chips picks a
 * platform; twenty rows at a time. Any row is one press from a project.
 * Storage only — nothing here asks a platform, so opening it costs nothing.
 */
const CHIPS = BEAT_FEEDS.filter((f) => f.tab !== "crypto");
type Chip = "all" | (typeof CHIPS)[number]["tab"];

const STEP = 20;

function compact(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1)}万`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}千`;
  return String(n);
}

/** One number that says how hot, in words anybody reads. */
function heatOf(r: HotRow, zh: boolean): string {
  const s = r.stats ?? {};
  if (s.views) return `${zh ? "播放" : "plays"} ${compact(s.views)}`;
  if (s.likes) return `${zh ? "点赞" : "likes"} ${compact(s.likes)}`;
  if (r.heatLabel) return r.heatLabel;
  if (r.heat) return `${zh ? "热度" : "heat"} ${compact(r.heat)}`;
  if (s.comments) return `${zh ? "评论" : "comments"} ${compact(s.comments)}`;
  return "—";
}

/** The platform a row is on: a beat feed's own, or a 抖音 billboard's. */
function platformOf(from: string): { mark: string; zh: string; en: string } {
  const feed = BEAT_FEEDS.find((f) => f.key === from);
  if (feed) return { mark: feed.mark, zh: feed.zh, en: feed.label };
  if (from.startsWith("dy_") || from === "douyin") return { mark: "douyin", zh: "抖音", en: "Douyin" };
  const byHot = BEAT_FEEDS.find((f) => (f.hot as readonly string[]).includes(from));
  return byHot ? { mark: byHot.mark, zh: byHot.zh, en: byHot.label } : { mark: from, zh: from, en: from };
}

export function HotBoard({ zh, canWrite, initial = null }: { zh: boolean; canWrite: boolean; initial?: Record<string, BeatRow[]> | null }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [lists, setLists] = React.useState<Lists | null>(null);
  const [beats, setBeats] = React.useState<BeatConfig[]>(() => [...DEFAULT_BEATS]);
  const [chip, setChip] = React.useState<Chip>("all");
  const [shown, setShown] = React.useState(STEP);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    /* Built on the server with the page: nothing to fetch. */
    if (initial) return;
    let off = false;
    void fetch("/api/research/hot?platform=all")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((res: { lists?: Record<string, { rows?: HotRow[]; relevance?: unknown; fetchedAt?: number } | undefined> } | null) => {
        if (off) return;
        const out: Lists = {};
        for (const [k, v] of Object.entries(res?.lists ?? {})) if (v) out[k] = { rows: v.rows ?? [], relevance: (v.relevance as never) ?? null, fetchedAt: v.fetchedAt ?? null };
        setLists(out);
      });
    void fetch("/api/research/beats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((res: { beats?: BeatConfig[] } | null) => {
        if (!off && res?.beats?.length) setBeats(res.beats);
      });
    return () => {
      off = true;
    };
  }, []);

  const keys = React.useMemo(() => beats.filter((b) => b.enabled).map((b) => b.key), [beats]);
  const rows: BeatRow[] = React.useMemo(() => {
    if (initial) return initial[chip] ?? [];
    if (!lists) return [];
    if (chip === "all") return acrossPlatforms(lists, { limit: 300, beats: keys });
    const { charted, feed } = tabRows(chip, lists, { beats: keys, chartCap: 50 });
    return [...charted, ...feed];
  }, [lists, chip, keys, initial]);
  React.useEffect(() => setShown(STEP), [chip]);

  async function make(r: BeatRow) {
    const id = `${r.from}:${r.phrase}`;
    if (busy) return;
    setBusy(id);
    try {
      const res = await startFromTopicAction({ kind: "hot", platform: r.from, phrase: r.phrase }, { write: canWrite });
      if ("error" in res && res.error) {
        notify(res.error);
        return;
      }
      if ("projectId" in res && res.projectId) router.push(res.writing ? `/projects/${res.projectId}/script` : `/projects/${res.projectId}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageBody width={1040}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginTop: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 650, color: INK }}>{t("各平台现在最热的", "Hottest on each platform now")}</h2>
        <span style={{ fontSize: 12.5, color: MUTED }}>{t("每几个小时自动更新", "Refreshed every few hours")}</span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["all", ...CHIPS.map((c) => c.tab)] as Chip[]).map((c) => {
          const meta = CHIPS.find((x) => x.tab === c);
          const on = chip === c;
          return (
            <button key={c} type="button" onClick={() => setChip(c)} style={{ ...smallButton(on), height: 32, padding: "0 13px", borderRadius: 99, gap: 6 }}>
              {meta ? <PlatformMark platform={meta.mark} size={13} mono={on} /> : null}
              {c === "all" ? t("全部", "All") : zh ? meta?.zh : meta?.label}
            </button>
          );
        })}
      </div>

      <section style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, overflow: "hidden" }}>
        <div className="hb-row hb-head">
          <span>#</span>
          <span>{t("内容", "Post")}</span>
          <span>{t("平台", "Platform")}</span>
          <span style={{ textAlign: "right" }}>{t("热度", "How hot")}</span>
          <span />
        </div>
        {lists === null ? (
          <div style={{ padding: 28, textAlign: "center", color: MUTED, fontSize: 13.5 }}>{initial ? t("这个平台现在没有 AI、加密、科技、商业的热点", "Nothing on the four beats here right now") : t("正在读取…", "Loading…")}</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 28, textAlign: "center", color: MUTED, fontSize: 13.5 }}>{t("这个平台还没有数据，下一轮更新后会出现。", "Nothing here yet; it fills at the next refresh.")}</div>
        ) : (
          rows.slice(0, shown).map((r, i) => {
            const p = platformOf(r.from);
            const id = `${r.from}:${r.phrase}`;
            return (
              <div key={id + i} className="hb-row">
                <span style={{ color: i < 3 ? INK : MUTED, fontWeight: i < 3 ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                <span style={{ minWidth: 0 }}>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="hb-title">
                      {r.phrase}
                    </a>
                  ) : (
                    <span className="hb-title">{r.phrase}</span>
                  )}
                  {r.extra ? <span style={{ display: "block", fontSize: 12, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.extra}</span> : null}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#454545" }}>
                  <PlatformMark platform={p.mark} size={14} />
                  {zh ? p.zh : p.en}
                </span>
                <span style={{ textAlign: "right", fontSize: 13, color: "#454545", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{heatOf(r, zh)}</span>
                <span style={{ textAlign: "right" }}>
                  <button type="button" className="hb-make" disabled={busy !== null} onClick={() => void make(r)}>
                    <Icon name="film" size={12} /> {busy === id ? t("正在开始…", "Starting…") : t("做成视频", "Make it")}
                  </button>
                </span>
              </div>
            );
          })
        )}
      </section>
      {rows.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + STEP)} style={{ ...smallButton(), alignSelf: "center", height: 36, padding: "0 20px", fontSize: 13.5 }}>
          {t(`再看 ${Math.min(STEP, rows.length - shown)} 条`, `Show ${Math.min(STEP, rows.length - shown)} more`)}
        </button>
      ) : null}
      <style>{HB_CSS}</style>
    </PageBody>
  );
}

const HB_CSS = `
.hb-row { display: grid; grid-template-columns: 36px minmax(0,1fr) 110px 110px 104px; align-items: center; gap: 12px; padding: 11px 18px; border-top: 1px solid #f0efeb; }
.hb-head { border-top: 0; font-size: 12px; color: #8a8a8a; background: #fafaf8; padding-top: 9px; padding-bottom: 9px; }
.hb-title { display: block; font-size: 14px; color: #171717; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
a.hb-title:hover { text-decoration: underline; }
.hb-make { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid #dcdbd6; background: #fff; color: #333; font: inherit; font-size: 12.5px; cursor: pointer; opacity: 0; transition: opacity .15s ease; }
.hb-row:hover .hb-make, .hb-make:focus-visible { opacity: 1; }
.hb-make:disabled { cursor: default; }
@media (hover: none) { .hb-make { opacity: 1; } }
@media (max-width: 760px) { .hb-row { grid-template-columns: 28px minmax(0,1fr) 90px; } .hb-row > :nth-child(3), .hb-row > :nth-child(5) { display: none; } }
`;
