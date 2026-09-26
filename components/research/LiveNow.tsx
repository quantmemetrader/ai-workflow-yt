"use client";

import { Icon } from "@/components/ui/Icon";
import React from "react";
import { useRouter } from "next/navigation";
import { useLocalPreference } from "@/lib/client/preference";
import { PlatformMark } from "@/components/ui/PlatformMark";
import { BEAT_FEEDS, listName, onFocus, relevanceLabel, beatOf, type Beat, type BeatTab, type Relevance, type RelevanceMap } from "@/lib/research/platform-catalog";
import { DEFAULT_BEATS, beatColor, type BeatConfig } from "@/lib/research/beats";
import { BeatsEditor } from "@/components/research/BeatsEditor";
import { SayToAgent } from "@/components/flow/SayToAgent";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_COLORS } from "@/lib/agents/catalog";
import { PLATFORMS, type HotRow, type PlatformKey } from "@/lib/research/platform-catalog";
import { BEAT_TABS, acrossPlatforms, anyFeed, beatCounts, feedOfTab, tabRows, type BeatRow, type Lists } from "@/lib/research/beat-view";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import type { Judged } from "@/lib/research/judge";
import { notify } from "@/lib/client/notify";

/**
 * What is hot right now on the studio's beats, platform by platform, read
 * by 研究员.
 *
 * The owner, on the tabs reading "抖音财经 3 / 28", "小红书 0 / 20": "keep it
 * related to business and tech & crypto, AI and stuff, and in content don't
 * just have 2-3 stuff — frontend filtered, don't do that." So the tabs are
 * no longer a platform's whole chart with most of it hidden. Each platform
 * tab is that platform's beat feed (`lib/research/beat-feeds.ts`): the
 * platform searched for AI, crypto, tech and business every three hours,
 * the thirty posts that did best recently, each with its own numbers.
 *
 *   1. The switch. First "AI · 加密 · 科技 · 商业 · 全平台": the top of every
 *      platform together, by beat. Then 抖音, 小红书, 微博, B站, YouTube,
 *      TikTok, 新闻 (Google News, Hong Kong and Taiwan) and 加密市场
 *      (CoinGecko), each with its row count.
 *   2. The list. On a platform tab, first the rows of the platform's own
 *      hourly charts that are on a beat, marked 上榜 (the platform itself is
 *      pushing them), then the feed, ranked by the feed's own order. Chips
 *      (全部, then the studio's beats: AI / 加密 / 科技 / 商业 by default)
 *      narrow both. The platform's raw chart is one press away
 *      ("看平台热榜原榜"), unfiltered, for when the chart itself is the
 *      question.
 *   The beats are the studio's own. "管理赛道" beside the chips opens the
 *   editor (`BeatsEditor.tsx`; the owner: "let me be able to change this
 *   list too"). A beat with no rows yet says when it will fill ("下一轮收集后
 *   出现（约 N 分钟）") and offers "现在收集", which collects just that beat
 *   in the background; the chip fills when it lands (the page asks every
 *   twelve seconds while it runs). Rows under a beat switched off or
 *   deleted are hidden.
 *   3. 研究员's line on the list, written when it was collected, and the
 *      morning's picks folded underneath.
 *
 * Every number is the platform's own; every rank is the list's own. A post
 * on both a chart and the feed is shown once, among the 上榜 rows, with
 * both ranks.
 */
export type LiveSearch = { phrase: string; traffic: string | null; headline: string | null; region?: string };
export type LiveVideo = { id: string; title: string; channelTitle: string; thumbnail: string | null; views: number; rel?: Relevance | null };
export type Pick = { by?: string; text: string; why: string | null; source: "digest" | "plan" | "backlog" | "audience" | "mine"; thumbnail?: string | null; url?: string | null; evidence?: string[]; strength?: number; sources?: { label: string; title: string; url: string | null; numbers: string }[] };

const KEY = "aura:research:livenow";
/* A new key again: the tabs are different ones now (one per platform, not
   per chart), and a stored "dy_finance" would otherwise open nothing. */
const PLATFORM_KEY = "aura:research:platform-v3";
const BEAT_KEY = "aura:research:beat";

type Tab = "focus" | BeatTab;
const TABS: readonly Tab[] = ["focus", ...BEAT_TABS];
/** "all" or a beat key from the studio's list. */
type Chip = string;
/** What `/api/research/beats` says besides the list. */
type BeatsInfo = {
  nextRunAt: number | null;
  runs: { beat: string; at: number; running: boolean; rows: number | null; failed: boolean }[];
  canCollect: boolean;
};
/** How long after a run starts its rows are usually stored. */
const RUN_LANDS_MS = 4 * 60_000;
/** "现在收集" may run once per beat per half hour (`NOW_EVERY_MS`). */
const NOW_EVERY_MS = 30 * 60_000;
/** The 上榜 rows shown above a feed before "and N more on the charts": few
 *  enough that the feed itself starts on the first screen. */
const CHART_CAP = 6;

/** A row as the table draws it. */
type ViewRow = BeatRow & { place: number };

/** Pictures come through this app, not straight from the platform: the CDNs
 *  are unreachable from mainland China and a fair number of office networks. */
export const throughUs = (url: string | null) => (url ? `/api/img?u=${encodeURIComponent(url)}` : null);

type Stored = { rows: HotRow[]; note: string | null; summary?: string | null; fetchedAt?: number; judged?: Judged | null; relevance?: RelevanceMap | null };

/** Every stored list and its marks (`/api/research/hot?platform=all`).
 *  `fresh` goes past the browser's minute of cache. */
async function fetchLists(fresh: boolean): Promise<{ lists: Lists; marks: Record<string, Judged> } | null> {
  const res = (await fetch(`/api/research/hot?platform=all${fresh ? `&at=${Date.now()}` : ""}`, fresh ? { cache: "no-store" } : undefined)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as { lists: Record<string, Stored | undefined> } | null;
  if (!res) return null;
  const lists: Lists = {};
  const marks: Record<string, Judged> = {};
  for (const [k, v] of Object.entries(res.lists ?? {})) {
    if (!v) continue;
    lists[k] = { rows: v.rows ?? [], note: v.note ?? null, summary: v.summary ?? null, fetchedAt: v.fetchedAt ?? null, relevance: v.relevance ?? null };
    if (v.judged) marks[k] = v.judged;
  }
  return { lists, marks };
}

type BeatsAnswer = { beats: BeatConfig[] } & BeatsInfo;
/** The studio's beats and what goes with them (`/api/research/beats`). */
async function fetchBeats(): Promise<BeatsAnswer | null> {
  return (await fetch("/api/research/beats", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as BeatsAnswer | null;
}

/** Whether a beat has any row on any platform yet. */
function beatHasRows(lists: Lists, keys: string[], key: string): boolean {
  return acrossPlatforms(lists, { beat: key, limit: 1, beats: keys }).length > 0;
}

export function LiveNow({
  searches,
  videos,
  region,
  zh,
  onWatch,
  note,
  picks,
  canWriteScripts,
}: {
  searches: LiveSearch[];
  videos: LiveVideo[];
  region: string;
  zh: boolean;
  onWatch: (phrase: string) => void;
  note?: string | null;
  /** What 研究员 and 策划 already proposed, from the brief and the plan. */
  picks: Pick[];
  canWriteScripts: boolean;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const [, start] = React.useTransition();
  const [state, setState] = useLocalPreference<"open" | "shut">(KEY, ["open", "shut"], "open");
  const open = state === "open";
  /* The studio's beats. The defaults until `/api/research/beats` answers,
     which is also what the server renders, so nothing differs on hydration;
     the chips wait for the answer, so the defaults never flash. */
  const [beats, setBeats] = React.useState<BeatConfig[]>(() => [...DEFAULT_BEATS]);
  const [beatsInfo, setBeatsInfo] = React.useState<BeatsInfo | null>(null);
  const [beatsDone, setBeatsDone] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [collecting, setCollecting] = React.useState<string | null>(null);
  const active = React.useMemo(() => beats.filter((b) => b.enabled), [beats]);
  const activeKeys = React.useMemo(() => active.map((b) => b.key), [active]);
  const chips = React.useMemo<Chip[]>(() => ["all", ...activeKeys], [activeKeys]);
  /* The coin market tab is the 加密 beat's own list: with 加密 switched off
     the collector stops reading it (`beat-feeds.ts`), so the tab goes too
     rather than sitting empty or stale. The server renders the defaults, so
     the tabs match on hydration. */
  const tabs = React.useMemo<readonly Tab[]>(() => (activeKeys.includes("crypto") ? TABS : TABS.filter((k) => k !== "crypto")), [activeKeys]);
  const [tab, setTab] = useLocalPreference<Tab>(PLATFORM_KEY, tabs, "focus");
  /* Which beat, remembered in this browser and kept across tabs: someone
     reading crypto today reads it on every platform. */
  const [chip, setChip] = useLocalPreference<Chip>(BEAT_KEY, chips, "all");
  const beat: Beat | null = chip === "all" ? null : chip;
  const metaOf = (k: string) => beats.find((b) => b.key === k) ?? null;
  const beatName = (k: string) => {
    const m = metaOf(k);
    return m ? (zh ? m.zh : m.en) : k;
  };
  /* A beat's wash and ink from its colour; 全部 and anything unknown in the
     page's neutral grey. */
  const colorOf = (k: string | null | undefined) => beatColor(k ? metaOf(k)?.color : null);
  /* The beats' names in a line ("AI · 加密 · 科技 · 商业"), cut short past
     five so a tab label stays a label. */
  const beatLine = active.length > 5 ? `${active.slice(0, 4).map((b) => beatName(b.key)).join(" · ")} …` : active.map((b) => beatName(b.key)).join(" · ");
  /* The platform's own chart, unfiltered, instead of the tab's beat rows. */
  const [rawOn, setRawOn] = React.useState(false);
  const [rawPick, setRawPick] = React.useState<PlatformKey | null>(null);
  /* "Picked for today" sits under the list and starts folded. */
  const [picksFold, setPicksFold] = useLocalPreference<"open" | "shut">("aura:fold:research-picks-v2", ["open", "shut"], "shut");
  const picksOpen = picksFold === "open";
  const [openPick, setOpenPick] = React.useState<number | null>(null);

  const [lists, setLists] = React.useState<Lists>({});
  /* The one request for every list has come back (or failed). */
  const [allDone, setAllDone] = React.useState(false);
  const [judged, setJudged] = React.useState<Record<string, Judged>>({});
  const [selected, setSelected] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState<string | null>(null);

  /* Every list — the platforms' charts, the beat feeds, the cross-platform
     top — and 研究员's stored marks, in one request when the panel opens, so
     switching tabs never waits. Storage only; nothing here reads a platform.
     Asked again (past the browser's minute of cache) when a beat collection
     has just landed. */
  const applyLists = React.useCallback((got: { lists: Lists; marks: Record<string, Judged> } | null) => {
    if (!got) return;
    setLists(got.lists);
    setJudged(got.marks);
  }, []);
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchLists(false)
      .then((got) => {
        if (!cancelled) applyLists(got);
      })
      .finally(() => {
        if (!cancelled) setAllDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, applyLists]);

  /* The studio's beats, when the next collection is, and any "现在收集"
     under way. `clock` is when that was read (and, while a beat waits, the
     minute since), for "约 N 分钟" without reading the time during render. */
  const [clock, setClock] = React.useState<number | null>(null);
  const applyBeats = React.useCallback((res: BeatsAnswer | null) => {
    if (!res?.beats?.length) return;
    setBeats(res.beats);
    setBeatsInfo({ nextRunAt: res.nextRunAt ?? null, runs: res.runs ?? [], canCollect: !!res.canCollect });
    setClock(Date.now());
  }, []);
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchBeats()
      .then((res) => {
        if (!cancelled) applyBeats(res);
      })
      .finally(() => {
        if (!cancelled) setBeatsDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, applyBeats]);

  /* While a "现在收集" runs, ask how it is going every twelve seconds; when
     it is over, read the lists again so its chip fills. Light: one small
     request, only while something is running, for a few minutes at most. */
  const runningKey = (beatsInfo?.runs ?? [])
    .filter((r) => r.running)
    .map((r) => r.beat)
    .join(",");
  React.useEffect(() => {
    if (!open || !runningKey) return;
    let stopped = false;
    const id = window.setInterval(() => {
      void fetchBeats().then(async (res) => {
        if (stopped) return;
        applyBeats(res);
        if (res && !(res.runs ?? []).some((r) => r.running)) applyLists(await fetchLists(true));
      });
    }, 12_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [open, runningKey, applyBeats, applyLists]);

  /* A beat waiting for the next collection: the minutes move on, and once
     the collection should have landed the lists are read again (then every
     five minutes for a while, in case the run was late). */
  const waitingKey = allDone && beatsDone ? activeKeys.filter((k) => !beatHasRows(lists, activeKeys, k)).join(",") : "";
  const nextRunAt = beatsInfo?.nextRunAt ?? null;
  React.useEffect(() => {
    if (!open || !waitingKey) return;
    let stopped = false;
    const id = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      const landed = nextRunAt !== null && now > nextRunAt + RUN_LANDS_MS;
      const minute = Math.floor(now / 60_000);
      if (landed && minute % 5 === 0 && now < (nextRunAt ?? 0) + 60 * 60_000) {
        void fetchLists(true).then((got) => {
          if (!stopped) applyLists(got);
        });
        void fetchBeats().then((res) => {
          if (!stopped) applyBeats(res);
        });
      }
    }, 60_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [open, waitingKey, nextRunAt, applyBeats, applyLists]);

  /* 管理赛道 edits the list the page read from the server. If that read
     failed, the page is showing the defaults, and saving an edit of them
     would drop the studio's own beats — so the list is read again first,
     and the editor opens only on the studio's real list. */
  async function openEditor() {
    if (beatsInfo) {
      setEditing(true);
      return;
    }
    const res = await fetchBeats();
    if (!res?.beats?.length) {
      notify(t("Could not read the beats. Try again in a moment.", "赛道列表没读到，稍后再试。"));
      return;
    }
    applyBeats(res);
    setEditing(true);
  }

  async function collectNow(key: string) {
    if (collecting) return;
    setCollecting(key);
    const res = await fetch("/api/research/beats/collect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { error?: string; errorEn?: string } | null;
    setCollecting(null);
    if (!res?.ok) notify((zh ? body?.error : body?.errorEn) ?? t("Could not start the collection.", "没能开始收集。"));
    else notify(t(`Collecting ${beatName(key)} now; it fills in a minute or two.`, `正在收集「${beatName(key)}」，一两分钟后出现。`), "info");
    applyBeats(await fetchBeats());
  }

  /* The tab's feed and charts. */
  const feedMeta = tab === "focus" ? null : feedOfTab(tab);
  const charts: PlatformKey[] = feedMeta ? [...(feedMeta.hot as readonly PlatformKey[])] : [];
  const rawList: PlatformKey | null = rawOn && charts.length ? (rawPick && charts.includes(rawPick) ? rawPick : charts[0]) : null;
  const feedsStored = anyFeed(lists);

  /* 研究员's marks for the raw chart, when the stored copy has none (a
     studio other than the collector's, `/api/research/hot`). The beat tabs
     read the marks stored with each list and never ask a model here. */
  const judging: PlatformKey | null = open && allDone && rawList && lists[rawList]?.rows.length && !judged[rawList] ? rawList : null;
  React.useEffect(() => {
    if (!judging) return;
    let cancelled = false;
    const key = judging;
    void fetch(`/api/research/hot?platform=${key}&judge=1`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { judged: Judged }) : { judged: {} as Judged }))
      .catch(() => ({ judged: {} as Judged }))
      .then((res) => {
        if (cancelled) return;
        setJudged((m) => ({ ...m, [key]: res.judged }));
      });
    return () => {
      cancelled = true;
    };
  }, [judging]);

  /* ---- the rows ---------------------------------------------------- */

  /* A raw chart: every row as the platform ranked it, its beat mark if any. */
  const rawRows = (key: PlatformKey): BeatRow[] => {
    const l = lists[key];
    if (l?.rows.length) {
      return l.rows.map((r, i) => {
        const mark = l.relevance?.[r.phrase] ?? null;
        return { ...r, from: key, rank: i + 1, mark, beat: beatOf(mark), chart: { list: key, rank: i + 1 }, feedRank: null };
      });
    }
    /* Nothing stored for the chart yet: the page's own reads, if any. */
    if (key === "youtube")
      return videos.map((v, i) => ({ phrase: v.title, heat: v.views, heatLabel: null, url: `https://www.youtube.com/watch?v=${v.id}`, thumbnail: v.thumbnail, extra: v.channelTitle, from: "youtube" as const, rank: i + 1, mark: v.rel ?? null, beat: beatOf(v.rel), chart: { list: "youtube" as const, rank: i + 1 }, feedRank: null }));
    if (key === "google")
      return searches.map((s, i) => ({ phrase: s.phrase, heat: null, heatLabel: s.traffic, url: null, thumbnail: null, extra: s.headline, from: "google" as const, rank: i + 1, mark: null, beat: null, chart: { list: "google" as const, rank: i + 1 }, feedRank: null }));
    return [];
  };

  /* What the table shows, in sections (the first tab groups by beat under 全部). */
  type Section = { beat: Beat | null; rows: ViewRow[] };
  let sections: Section[] = [];
  let chartedHidden = 0;
  let counts: Record<Beat | "all", number> = beatCounts([], activeKeys);
  /* Every platform together, per beat: whether a beat has any rows yet. */
  const everywhere = beatCounts(acrossPlatforms(lists, { limit: 999, beats: activeKeys }), activeKeys);
  if (tab === "focus") {
    counts = everywhere;
    sections = beat
      ? [{ beat, rows: acrossPlatforms(lists, { beat, limit: 40, beats: activeKeys }).map((r, i) => ({ ...r, place: i + 1 })) }]
      : active.map((b) => ({ beat: b.key, rows: acrossPlatforms(lists, { beat: b.key, limit: 8, beats: activeKeys }).map((r, i) => ({ ...r, place: i + 1 })) })).filter((s) => s.rows.length);
  } else if (rawList) {
    const rows = rawRows(rawList);
    counts = beatCounts(rows.filter((r) => onFocus(r.mark) && !!r.beat && activeKeys.includes(r.beat)), activeKeys);
    counts.all = rows.length;
    sections = [{ beat: null, rows: rows.map((r) => ({ ...r, place: r.rank })) }];
  } else {
    const whole = tabRows(tab, lists, { chartCap: 200, beats: activeKeys });
    counts = beatCounts([...whole.charted, ...whole.feed], activeKeys);
    const part = tabRows(tab, lists, { beat, chartCap: CHART_CAP, beats: activeKeys });
    chartedHidden = part.chartedHidden;
    sections = [{ beat: null, rows: [...part.charted, ...part.feed].map((r) => ({ ...r, place: r.feedRank ?? r.rank })) }];
  }
  const shown: ViewRow[] = sections.flatMap((s) => s.rows);
  /* Rows on any of the studio's beats (the raw chart's header line). */
  const onBeats = activeKeys.reduce((n, k) => n + (counts[k] ?? 0), 0);
  const rowId = (r: BeatRow) => `${r.from}|${r.phrase}`;
  const picked = selected ? (shown.find((r) => rowId(r) === selected) ?? null) : null;
  /* The list the picked row is on: what starting work from it resolves on
     the server (a beat feed's row by its feed, a chart's by its chart). */
  const listKey = picked?.from ?? feedMeta?.key ?? "beat_douyin";
  const marksFor = (r: BeatRow) => judged[r.from]?.[r.phrase] ?? null;
  const marked = shown.filter((r) => marksFor(r)).length;

  /* The count on each tab: how many rows it has on the beats. */
  const tabCount = (key: Tab): number | null => {
    if (!allDone) return null;
    if (key === "focus") return feedsStored || Object.keys(lists).length ? acrossPlatforms(lists, { limit: 999, beats: activeKeys }).length : null;
    const r = tabRows(key, lists, { chartCap: 999, beats: activeKeys });
    return r.charted.length + r.feed.length;
  };
  const tabLabel = (key: Tab) => {
    if (key === "focus") return `${beatLine} · ${t("all", "全平台")}`;
    const f = feedOfTab(key);
    return zh ? f.zh : f.label;
  };
  const tabName = tab === "focus" ? t("Every platform", "全平台") : tabLabel(tab);
  const summaryKey = tab === "focus" ? "beat_all" : rawList ?? feedMeta!.key;
  /* Before the first beat run a platform tab has only its charts; their
     line stands in. */
  const summaryList = lists[summaryKey]?.rows.length ? lists[summaryKey] : feedMeta && !rawList ? lists[charts[0] ?? ""] : undefined;
  const summary = summaryList?.summary ?? null;
  const summaryAt = summaryList?.fetchedAt ?? null;
  const feedAt = feedMeta ? (lists[feedMeta.key]?.fetchedAt ?? null) : (lists.beat_all?.fetchedAt ?? null);
  const feedNote = feedMeta && !rawList ? (lists[feedMeta.key]?.note ?? null) : null;
  const narrow = picked !== null;
  const cols = narrow ? COLS_COMPACT : COLS;
  const maxHeat = rawList ? shown.reduce((m, r) => Math.max(m, r.heat ?? 0), 0) : 0;

  /* A row becomes a project, its script is started from the row (resolved
     on the server from the stored list: the phrase, the numbers, 研究员's
     mark) and the person lands on the script while 编剧 writes. */
  function writeScript(phrase: string, id: string) {
    if (sending) return;
    setSending(id);
    start(async () => {
      const res = await startFromTopicAction({ kind: "hot", platform: listKey, phrase }, { write: true });
      setSending(null);
      if ("error" in res && res.error) {
        notify(res.error);
        return;
      }
      if ("scriptId" in res && res.scriptId) router.push(`/script/${res.scriptId}${res.writing ? "?writing=1" : ""}`);
      else if ("projectId" in res && res.projectId) router.push(`/projects/${res.projectId}`);
    });
  }

  const chartName = (key: PlatformKey) => {
    const p = PLATFORMS.find((x) => x.key === key)!;
    return zh ? p.zh : p.label;
  };
  const feedName = (key: string) => {
    const f = BEAT_FEEDS.find((x) => x.key === key);
    return f ? (zh ? f.zh : f.label) : listName(key, zh);
  };
  /* Where a row stands, in words: "抖音财经 第 3 名 · 上榜", "小红书 第 12 名". */
  const whereLine = (r: BeatRow) =>
    r.chart
      ? `${chartName(r.chart.list)} ${t(`#${r.chart.rank}`, `第 ${r.chart.rank} 名`)}${r.feedRank ? ` · ${t(`beats #${r.feedRank}`, `赛道第 ${r.feedRank}`)}` : ""}`
      : `${feedName(r.from)} ${t(`#${r.rank}`, `第 ${r.rank} 名`)}`;

  const empty = !shown.length;

  return (
    <div style={{ flexShrink: 0, minHeight: "calc(100vh - 150px)", borderBottom: "1px solid #ededed", background: "#fcfcfc" }}>
      {/* ---- the switch ------------------------------------------------ */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 20px 0", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setState(open ? "shut" : "open")}
          aria-expanded={open}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, border: 0, background: "transparent", padding: 0, cursor: "pointer", fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "#7c7c7c", fontFamily: "inherit" }}
        >
          <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, fill: "none", stroke: "#7c7c7c", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s linear" }}>
            <path d="m9 5 7 7-7 7" />
          </svg>
          {t("Right now", "此刻")}
        </button>

        {open ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            {tabs.map((key) => {
              const on = tab === key;
              const n = tabCount(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setTab(key);
                    setSelected(null);
                    setRawOn(false);
                    setRawPick(null);
                  }}
                  aria-pressed={on}
                  title={
                    key === "news"
                      ? t(`Google News, ${region} and Taiwan editions`, `Google 新闻 · ${region} 与台湾版`)
                      : n !== null
                        ? t(`${n} on the beats`, `${n} 条赛道内容`)
                        : undefined
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    height: 26,
                    padding: "0 10px",
                    borderRadius: 999,
                    border: `1px solid ${on ? "#171717" : "#dddddd"}`,
                    background: on ? "#171717" : "#ffffff",
                    color: on ? "#ffffff" : "#525252",
                    fontSize: 11.5,
                    fontWeight: on ? 500 : 400,
                    fontFamily: "inherit",
                    letterSpacing: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <TabMark tab={key} on={on} />
                  {tabLabel(key)}
                  {n !== null ? (
                    <span style={{ minWidth: 16, height: 16, padding: "0 5px", borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontVariantNumeric: "tabular-nums", background: on ? "rgba(255,255,255,.18)" : n ? "#fbeee0" : "#f3f3f1", color: on ? "#ffffff" : n ? "#9a5b13" : "#b3b3b3" }}>
                      {n}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        <span style={{ flexGrow: 1 }} />
        {open && allDone ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#7c7c7c" }}>
            <AgentIcon agent="research" size={14} radius={4} />
            {judging
              ? t("Researcher is reading this list…", "研究员正在读这份榜…")
              : marked
                ? t(`Researcher marked ${marked} for this channel`, `研究员标了 ${marked} 条跟频道有关的`)
                : shown.length
                  ? t("Researcher found nothing tied to the channel here", "研究员没看到跟频道直接有关的")
                  : ""}
          </span>
        ) : null}
      </div>

      {!open ? <div style={{ height: 8 }} /> : null}

      {open ? (
        <div style={{ padding: "10px 20px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* ---- the list, and the reading of it ------------------------ */}
          <div style={{ display: "flex", gap: 12, alignItems: "stretch", minWidth: 0 }}>
            <div style={{ flexGrow: 1, minWidth: 0, border: "1px solid #ededed", borderRadius: 12, background: "#fff", padding: "10px 14px 8px", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, minWidth: 0, flexWrap: "wrap" }}>
                <TabMark tab={tab} on={false} size={12} />
                <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {tab === "focus"
                    ? t(`The beats, every platform: ${beatLine}`, `各平台的 ${beatLine}`)
                    : rawList
                      ? `${chartName(rawList)} · ${t("the platform's own chart", "平台热榜原榜")}`
                      : tab === "crypto"
                        ? t("Crypto market · CoinGecko trending and movers", "加密市场 · CoinGecko 热搜与涨跌")
                        : `${tabName} · ${beatLine}`}
                </span>
                <span style={{ fontSize: 11.5, color: "#999999", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: "1 1 120px" }}>
                  {!allDone
                    ? ""
                    : rawList
                      ? t(`${counts.all} items · ${onBeats} on the beats`, `${counts.all} 条 · 其中赛道相关 ${onBeats} 条`)
                      : `${t(`${counts.all} items`, `${counts.all} 条`)}${feedAt ? ` · ${clockHK(feedAt)} ${t("collected", "收集")}` : ""}${feedNote ? ` · ${feedNote}` : ""}`}
                </span>
                {/* The chart itself, unfiltered, one press away; and back. */}
                {charts.length ? (
                  <button
                    type="button"
                    aria-pressed={rawOn}
                    onClick={() => {
                      setRawOn(!rawOn);
                      setSelected(null);
                    }}
                    style={{ ...smallBtn(false), height: 22, fontSize: 11, flexShrink: 0, background: rawOn ? "#f3f3f1" : "#ffffff" }}
                  >
                    {rawOn ? t("Back to the beats", "回到赛道内容") : t("Platform's own chart", "看平台热榜原榜")}
                  </button>
                ) : null}
              </div>

              {/* Chips: which beat (the tab's rows), or which chart (raw). The
                  coin market is one beat by definition and has none. The
                  beats are the studio's; 管理赛道 at the end edits them. */}
              {allDone && beatsDone && !rawList && tab !== "crypto" ? (
                <div role="group" aria-label={t("Which beat", "哪个赛道")} style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", paddingBottom: 6 }}>
                  {chips.map((c) => {
                    const on = chip === c;
                    const n = counts[c] ?? 0;
                    const col = colorOf(c === "all" ? null : c);
                    const waiting = c !== "all" && !everywhere[c];
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={on}
                        title={waiting ? t("Nothing collected for this beat yet", "这个赛道还没收集到内容") : undefined}
                        onClick={() => {
                          setChip(c);
                          setSelected(null);
                        }}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 22, padding: "0 9px", borderRadius: 999, border: `1px ${waiting && !on ? "dashed" : "solid"} ${on ? col.ink : "#e6e6e6"}`, background: on ? col.tint : "#ffffff", color: on ? col.ink : "#525252", fontSize: 11, fontFamily: "inherit", letterSpacing: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        {c !== "all" ? <span style={{ width: 6, height: 6, borderRadius: 3, background: col.ink }} /> : null}
                        {c === "all" ? t("All", "全部") : beatName(c)}
                        <span style={{ color: on ? col.ink : "#a3a3a3", fontVariantNumeric: "tabular-nums" }}>{n}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => void openEditor()}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 6px", marginLeft: 2, border: 0, background: "transparent", color: "#8a8a8a", fontSize: 11, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden style={{ width: 12, height: 12, fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}>
                      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
                      <circle cx="15" cy="7" r="2" />
                      <circle cx="9" cy="17" r="2" />
                    </svg>
                    {t("Manage beats", "管理赛道")}
                  </button>
                </div>
              ) : null}
              {/* A beat with nothing collected yet (just added, or its words
                  found nothing): when it will fill, and "现在收集". */}
              {allDone && beatsDone && !rawList && tab !== "crypto" && beatsInfo
                ? active
                    .filter((b) => !everywhere[b.key])
                    .map((b) => {
                      const run = beatsInfo.runs.find((r) => r.beat === b.key) ?? null;
                      const col = colorOf(b.key);
                      const now = clock ?? 0;
                      const retryAt = run ? run.at + NOW_EVERY_MS : 0;
                      const mins = beatsInfo.nextRunAt ? Math.max(1, Math.round((beatsInfo.nextRunAt + RUN_LANDS_MS - now) / 60_000)) : null;
                      const when = mins === null ? "" : mins >= 90 ? t(`about ${Math.round(mins / 60)} h`, `约 ${Math.round(mins / 60)} 小时`) : t(`about ${mins} min`, `约 ${mins} 分钟`);
                      return (
                        <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11.5, color: "#7c7c7c", padding: "0 0 6px" }}>
                          <span style={{ width: 6, height: 6, borderRadius: 3, background: col.ink }} />
                          <span style={{ color: col.ink, fontWeight: 500 }}>{beatName(b.key)}</span>
                          <span>
                            {run?.running || collecting === b.key
                              ? t("Collecting now; it fills in a minute or two…", "正在收集，一两分钟后出现…")
                              : run && !run.failed && run.rows === 0 && now < retryAt
                                ? t(`Just collected: nothing on this beat this time. It is searched again at the next collection${when ? ` (${when})` : ""}.`, `刚才收集没找到这个赛道的内容，下一轮收集会再搜${when ? `（${when}）` : ""}。`)
                                : t(`Appears after the next collection${when ? ` (${when})` : ""}.`, `下一轮收集后出现${when ? `（${when}）` : ""}。`)}
                          </span>
                          {beatsInfo.canCollect && !run?.running ? (
                            <button
                              type="button"
                              disabled={collecting !== null || now < retryAt}
                              title={now < retryAt ? t(`Once per half hour per beat; again after ${clockHK(retryAt)}`, `每个赛道半小时收集一次，${clockHK(retryAt)} 以后可以再收集`) : t("Search every platform for this beat now (a few paid requests)", "现在就按这个赛道搜一遍各平台（会用到少量付费请求）")}
                              onClick={() => void collectNow(b.key)}
                              style={{ ...smallBtn(false), height: 22, fontSize: 11, opacity: collecting !== null || now < retryAt ? 0.5 : 1, cursor: collecting !== null || now < retryAt ? "default" : "pointer" }}
                            >
                              {t("Collect now", "现在收集")}
                            </button>
                          ) : null}
                        </div>
                      );
                    })
                : null}
              {rawList && charts.length > 1 ? (
                <div role="group" aria-label={t("Which chart", "哪份榜")} style={{ display: "flex", gap: 4, flexWrap: "wrap", paddingBottom: 6 }}>
                  {charts.map((c) => (
                    <button key={c} type="button" aria-pressed={rawList === c} onClick={() => { setRawPick(c); setSelected(null); }} style={{ ...smallBtn(false), height: 22, fontSize: 11, background: rawList === c ? "#171717" : "#ffffff", color: rawList === c ? "#ffffff" : "#383838", borderColor: rawList === c ? "#171717" : "#e2e2e2" }}>
                      {chartName(c)} <span style={{ opacity: 0.6 }}>{lists[c]?.rows.length ?? 0}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {!allDone ? (
                <div style={{ fontSize: 11.5, color: "#999999", padding: "8px 0" }}>{t("Reading…", "正在读取…")}</div>
              ) : empty ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, color: "#7c7c7c", lineHeight: 1.6, padding: "10px 0" }}>
                  {rawList
                    ? ((lists[rawList]?.note ?? note) || t("This chart has not been collected yet.", "这份榜还没收集到。"))
                    : beat
                      ? everywhere[beat]
                        ? t("Nothing on this beat here right now.", "这里此刻没有这个赛道的内容。")
                        : t("Nothing collected for this beat yet.", "这个赛道还没收集到内容。")
                      : feedsStored
                        ? t("Nothing collected for this platform's beats yet.", "这个平台的赛道内容还没收集到。")
                        : t("The beat feeds are collected every three hours; the first collection has not run yet.", "赛道内容每三小时收集一次，第一次收集还没跑。")}
                  {beat ? (
                    <button type="button" onClick={() => setChip("all")} style={{ ...smallBtn(false), height: 24 }}>
                      {t("Show every beat", "看全部赛道")}
                    </button>
                  ) : charts.length && !rawOn ? (
                    <button type="button" onClick={() => setRawOn(true)} style={{ ...smallBtn(false), height: 24 }}>
                      {t("Platform's own chart", "看平台热榜原榜")}
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "4px 0 3px", fontSize: 10.5, color: "#999999", letterSpacing: ".03em" }}>
                    <span>#</span>
                    <span />
                    <span>{t("Title", "标题")}</span>
                    <span style={{ textAlign: "right" }}>{tab === "crypto" ? t("24h", "24 小时") : t("Heat", "热度")}</span>
                    {narrow ? null : <span>{t("Researcher", "研究员判断")}</span>}
                    {narrow ? null : <span />}
                    <span />
                  </div>
                  <div style={{ maxHeight: "56vh", overflowY: "auto", margin: "0 -8px", padding: "0 8px" }}>
                    {sections.map((sec) => (
                      <React.Fragment key={sec.beat ?? "rows"}>
                        {tab === "focus" && !beat && sec.beat ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0 4px", fontSize: 11, fontWeight: 600, color: colorOf(sec.beat).ink, borderTop: "1px solid #f3f3f3" }}>
                            <span style={{ width: 6, height: 6, borderRadius: 3, background: colorOf(sec.beat).ink }} />
                            {beatName(sec.beat)}
                            <button type="button" onClick={() => setChip(sec.beat!)} style={{ border: 0, background: "transparent", padding: 0, fontSize: 11, color: "#999999", cursor: "pointer", fontFamily: "inherit", fontWeight: 400 }}>
                              {t(`all ${counts[sec.beat]} ›`, `全部 ${counts[sec.beat]} 条 ›`)}
                            </button>
                          </div>
                        ) : null}
                        {sec.rows.map((r, i) => {
                          const mark = marksFor(r);
                          const id = rowId(r);
                          const on = selected === id;
                          const pct = rawList && r.heat && maxHeat ? Math.max(6, Math.round((100 * r.heat) / maxHeat)) : null;
                          const top = r.place <= 3;
                          const beatOn = !!r.beat && onFocus(r.mark ?? { t: r.beat, s: 2 });
                          const dim = !!rawList && !beatOn;
                          const change = r.stats?.change24h;
                          return (
                            <div
                              key={`${id}-${i}`}
                              onClick={() => setSelected(on ? null : id)}
                              style={{
                                display: "grid",
                                gridTemplateColumns: cols,
                                gap: 10,
                                alignItems: "center",
                                padding: "5px 8px",
                                margin: "0 -8px",
                                borderTop: "1px solid #f3f3f3",
                                background: on ? "#f7f7f5" : mark ? "#fbfcff" : "transparent",
                                boxShadow: on ? "inset 2px 0 0 #0f5bd5" : undefined,
                                cursor: "pointer",
                              }}
                            >
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: top ? "#171717" : "#999999", fontWeight: top ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>
                                {r.chart && !rawList && tab !== "focus" ? <span title={whereLine(r)} style={chartBadge}>{t("Chart", "上榜")}</span> : r.place}
                                {narrow && mark ? <span title={mark.fit} style={{ width: 5, height: 5, borderRadius: 3, background: "#0b7a63" }} /> : null}
                              </span>
                              <Cover src={throughUs(r.thumbnail)} placeholder={<Placeholder from={r.from} />} />
                              <div style={{ minWidth: 0 }}>
                                <a
                                  href={r.url ?? "#"}
                                  target={r.url ? "_blank" : undefined}
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ fontSize: 12.5, color: dim ? "#8a8a8a" : "#171717", textDecoration: "none", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                                >
                                  {r.phrase}
                                </a>
                                <div style={{ fontSize: 10.5, color: "#999999", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", gap: 8, alignItems: "center" }}>
                                  {tab === "focus" || (r.chart && !rawList) ? (
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, color: r.chart ? "#b23b3b" : "#7c7c7c" }}>
                                      {tab === "focus" ? <PlatformMark platform={markOf(r.from)} size={10} /> : null}
                                      {whereLine(r)}
                                      {tab === "focus" && r.chart ? <span style={chartBadge}>{t("Chart", "上榜")}</span> : null}
                                    </span>
                                  ) : null}
                                  {beatOn && r.beat && tab !== "crypto" ? <span style={relTag(colorOf(r.beat))}>{r.mark ? relevanceLabel(r.mark, zh, beats) : beatName(r.beat)}</span> : null}
                                  {r.extra ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>{r.extra}</span> : null}
                                  <StatLine stats={r.stats} zh={zh} />
                                </div>
                              </div>
                              <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, fontSize: 11.5, color: change != null ? (change >= 0 ? "#0b7a63" : "#c0392b") : "#525252", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                                {pct !== null && !narrow ? (
                                  <span style={{ width: 54, height: 4, background: "#ededed", borderRadius: 2, position: "relative", flexShrink: 0 }}>
                                    <span style={{ position: "absolute", left: 0, top: 0, height: 4, width: `${pct}%`, background: top ? "#171717" : "#a9a6a0", borderRadius: 2 }} />
                                  </span>
                                ) : null}
                                <span style={{ minWidth: 48, textAlign: "right" }}>{headline(r)}</span>
                              </span>
                              {narrow ? null : (
                                <span style={{ minWidth: 0 }}>
                                  {mark ? (
                                    <span style={pill}>{mark.fit}</span>
                                  ) : judging === r.from ? (
                                    <span style={{ fontSize: 10.5, color: "#c7c7c7" }}>…</span>
                                  ) : (
                                    <span style={{ fontSize: 11, color: "#c7c7c7" }}>—</span>
                                  )}
                                </span>
                              )}
                              {narrow ? null : (
                                <button type="button" onClick={(e) => { e.stopPropagation(); onWatch(r.phrase.slice(0, 40)); }} style={{ ...smallBtn(false), height: 22, padding: "0 8px", fontSize: 11 }}>
                                  {t("Watch", "关注")}
                                </button>
                              )}
                              <span style={{ color: "#c7c7c7", fontSize: 12 }}>›</span>
                            </div>
                          );
                        })}
                      </React.Fragment>
                    ))}
                    {chartedHidden ? (
                      <button type="button" onClick={() => setRawOn(true)} style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderTop: "1px solid #f3f3f3", background: "transparent", padding: "6px 0", fontSize: 11, color: "#999999", cursor: "pointer", fontFamily: "inherit" }}>
                        {t(`${chartedHidden} more on the platform's charts ›`, `平台热榜上还有 ${chartedHidden} 条赛道相关的 ›`)}
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>

            {/* ---- the row somebody picked -------------------------------- */}
            {picked ? (
              <aside style={{ width: 250, flexShrink: 0, border: "1px solid #ededed", borderRadius: 12, background: "#fff", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 10.5, color: "#999999", letterSpacing: ".04em", textTransform: "uppercase" }}>{t("Selected", "选中的内容")}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.45 }}>{picked.phrase}</div>
                {marksFor(picked) ? <span style={{ ...pill, alignSelf: "flex-start" }}>{marksFor(picked)!.fit}</span> : null}
                <div style={{ fontSize: 12 }}>
                  <Kv k={t("Where", "位置")} v={whereLine(picked)} />
                  {picked.beat ? <Kv k={t("Beat", "赛道")} v={picked.mark ? relevanceLabel(picked.mark, zh, beats) : beatName(picked.beat)} /> : picked.mark ? <Kv k={t("Beat", "赛道")} v={t("None of the studio's beats", "不在频道的赛道里")} /> : null}
                  {picked.stats?.price != null ? <Kv k={t("Price", "价格")} v={usd(picked.stats.price)} strong /> : <Kv k={t("Heat", "热度")} v={headline(picked)} strong />}
                  {picked.stats?.change24h != null ? <Kv k={t("24h", "24 小时")} v={`${picked.stats.change24h >= 0 ? "+" : ""}${picked.stats.change24h.toFixed(1)}%`} /> : null}
                  {picked.stats?.marketCap != null ? <Kv k={t("Market cap", "市值")} v={`${usd(picked.stats.marketCap)}${picked.stats.capRank ? ` · ${t(`#${picked.stats.capRank}`, `第 ${picked.stats.capRank}`)}` : ""}`} /> : null}
                  {picked.stats?.volume != null ? <Kv k={t("24h volume", "24 小时成交")} v={usd(picked.stats.volume)} /> : null}
                  {picked.stats?.views != null ? <Kv k={t("Views", "播放")} v={compact(picked.stats.views)} /> : null}
                  {picked.stats?.likes != null ? <Kv k={t("Likes", "点赞")} v={`${compact(picked.stats.likes)}${picked.stats.likeRate != null ? ` · ${(picked.stats.likeRate * 100).toFixed(1)}%` : ""}`} /> : null}
                  {picked.stats?.comments != null ? <Kv k={t("Comments", "评论")} v={compact(picked.stats.comments)} /> : null}
                  {picked.stats?.shares != null ? <Kv k={t("Shares", "分享")} v={compact(picked.stats.shares)} /> : null}
                  {picked.stats?.saves != null ? <Kv k={t("Saves", "收藏")} v={compact(picked.stats.saves)} /> : null}
                  {picked.stats?.fans != null ? <Kv k={t("Followers", "账号粉丝")} v={compact(picked.stats.fans)} /> : null}
                  {/* Only when it travelled past its own audience: a big account's
                      video at a fifth of its followers is not "×0". */}
                  {picked.stats?.fans && picked.stats?.views && picked.stats.views >= picked.stats.fans ? <Kv k={t("Past its audience", "粉丝倍数")} v={`×${compact(Math.round(picked.stats.views / picked.stats.fans))}`} strong /> : null}
                  {picked.stats?.videos != null ? <Kv k={t("Videos on it", "相关视频")} v={compact(picked.stats.videos)} /> : null}
                  {picked.stats?.rankUp ? <Kv k={t("Climbed", "排名上升")} v={`↑${picked.stats.rankUp}`} /> : null}
                  {picked.stats?.publishedAt ? <Kv k={t("Posted", "发布")} v={since(picked.stats.publishedAt, zh)} /> : null}
                  {picked.query ? <Kv k={t("Found by", "搜索词")} v={picked.query.replace(/ when:\d+d$/, "")} /> : null}
                  {picked.seenAt ? <Kv k={t("Numbers as of", "数据时间")} v={since(picked.seenAt, zh)} /> : null}
                  {picked.extra ? <Kv k={t("Account", "账号 / 来源")} v={picked.extra} /> : null}
                </div>
                <div style={{ padding: "8px 10px", borderLeft: `2px solid ${AGENT_COLORS.research}`, background: "#fafafa", fontSize: 12, lineHeight: 1.55 }}>
                  <span style={{ fontWeight: 600, color: AGENT_COLORS.research }}>{t("Researcher", "研究员")}</span>{" "}
                  {marksFor(picked)?.why ?? (judging === picked.from ? t("is reading this list…", "正在读这份榜…") : t("could not tie this to the channel's own data.", "在频道数据里没找到跟它相关的依据。"))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "auto" }}>
                  {canWriteScripts && tab !== "crypto" ? (
                    <button type="button" disabled={sending !== null} onClick={() => writeScript(picked.phrase, "picked")} style={{ ...smallBtn(true), height: 30, justifyContent: "center" }}>
                      {t("Have the Writer script it", "让编剧写脚本")}
                    </button>
                  ) : null}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => onWatch(picked.phrase.slice(0, 40))} style={{ ...smallBtn(false), flexGrow: 1, justifyContent: "center" }}>
                      {t("Watch", "加入关注")}
                    </button>
                    {picked.url ? (
                      <a href={picked.url} target="_blank" rel="noopener noreferrer" style={{ ...smallBtn(false), flexGrow: 1, justifyContent: "center", textDecoration: "none" }}>
                        {t("Open", "打开原帖")}
                      </a>
                    ) : null}
                  </div>
                </div>
              </aside>
            ) : null}
          </div>

          {/* ---- 研究员's line on what is going viral here --------------- */}
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 14px", borderRadius: 12, border: "1px solid transparent", background: "linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(135deg, #cfe0fb, #e3dcfb 50%, #cfe9e2) border-box" }}>
            <AgentIcon agent="research" size={30} radius={9} />
            <div style={{ minWidth: 0, flexGrow: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#0f5bd5" }}>{t("Researcher · what is doing well", "研究员 · 这里什么在火")}</span>
                <span style={{ fontSize: 11, color: "#b3b3b3" }}>{rawList ? chartName(rawList) : tabName}{summaryAt ? ` · ${clockHK(summaryAt)} ${t("updated", "更新")}` : ""}</span>
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: summary ? "#171717" : "#999999", marginTop: 3 }}>
                {summary ?? (allDone ? t("The researcher writes a line here at the next collection.", "研究员会在下一次收集时在这里写一句总结。") : t("Reading the lists…", "正在读各平台的榜单…"))}
              </div>
              <div style={{ marginTop: 8 }}>
                <SayToAgent agent="research" about={`${rawList ? chartName(rawList) : tabName} ${t("list", "榜单")}`} zh={zh} autoFocus={false} compact />
              </div>
            </div>
          </div>

          {/* ---- what was picked this morning, folded under the list ----- */}
          <PicksList
            zh={zh}
            picks={picks}
            open={picksOpen}
            onToggle={() => setPicksFold(picksOpen ? "shut" : "open")}
            openPick={openPick}
            setOpenPick={setOpenPick}
            canWriteScripts={canWriteScripts}
            sending={sending}
            onWrite={writeScript}
            onWatch={onWatch}
            onClips={(title, withScript) =>
              start(async () => {
                /* The pick by what it is (a morning signal, somebody's own
                   topic, a plan to-do), resolved on the server with its why
                   and sources; "write" lands on the script being written. */
                const pick = picks.find((x) => x.text === title);
                const ref =
                  pick?.source === "digest"
                    ? ({ kind: "signal", title } as const)
                    : pick?.source === "plan" || pick?.source === "backlog" || pick?.source === "audience"
                      ? ({ kind: "proposal", text: title, source: pick.source } as const)
                      : ({ kind: "own", text: title } as const);
                const res = await startFromTopicAction(ref, { write: Boolean(withScript) });
                if ("error" in res && res.error) {
                  notify(res.error);
                  return;
                }
                if (withScript && "scriptId" in res && res.scriptId) router.push(`/script/${res.scriptId}${res.writing ? "?writing=1" : ""}`);
                else if ("projectId" in res && res.projectId) router.push(`/projects/${res.projectId}`);
                setTimeout(() => router.refresh(), 400);
              })
            }
          />
        </div>
      ) : null}

      {/* ---- 管理赛道: the studio's beats, in a side sheet ------------- */}
      {editing ? (
        <BeatsEditor
          zh={zh}
          beats={beats}
          counts={beatCounts(
            acrossPlatforms(lists, { limit: 999, beats: beats.map((b) => b.key) }),
            beats.map((b) => b.key),
          )}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            /* The chips follow at once; a beat just added shows "下一轮收集后
               出现" until its rows land. */
            setBeats(saved);
            setEditing(false);
            if (chip !== "all" && !saved.some((b) => b.key === chip && b.enabled)) setChip("all");
            notify(t("Beats saved. New words are searched from the next collection.", "赛道已保存，新的关键词从下一轮收集开始搜。"), "ok");
            void fetchBeats().then(applyBeats);
          }}
        />
      ) : null}
    </div>
  );
}

/** The platform mark a list draws with: a beat feed draws its platform's. */
function markOf(from: string): string {
  const f = BEAT_FEEDS.find((x) => x.key === from);
  return f ? f.mark : from;
}

/** A row's picture slot when it has no picture: the news glyph for a news
 *  story, the platform's mark otherwise. */
function Placeholder({ from }: { from: string }) {
  const tab = BEAT_FEEDS.find((x) => x.key === from)?.tab ?? (from === "google" ? "news" : null);
  return tab === "news" || tab === "crypto" ? <TabMark tab={tab} on={false} size={13} /> : <PlatformMark platform={markOf(from)} size={13} />;
}

/** A tab's mark: the platform's logo, a line icon for news and the coin market. */
function TabMark({ tab, on, size = 11 }: { tab: Tab; on: boolean; size?: number }) {
  const ink = on ? "#ffffff" : "#7c7c7c";
  if (tab === "focus") return <Icon name="spark" size={size} color={on ? "#ffffff" : "#c2410c"} />;
  if (tab === "news")
    return (
      <svg viewBox="0 0 24 24" aria-hidden style={{ width: size, height: size, flexShrink: 0, fill: "none", stroke: ink, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
        <path d="M5 5h11v14H6a1 1 0 0 1-1-1z" />
        <path d="M16 9h3v8.5a1.5 1.5 0 0 1-3 0" />
        <path d="M8 9h5M8 12.5h5M8 16h3" />
      </svg>
    );
  if (tab === "crypto")
    return (
      <svg viewBox="0 0 24 24" aria-hidden style={{ width: size, height: size, flexShrink: 0, fill: "none", stroke: on ? "#ffffff" : "#b7791f", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
        <circle cx="12" cy="12" r="8" />
        <path d="M10 8.5h3a1.75 1.75 0 0 1 0 3.5h-3zM10 12h3.5a1.75 1.75 0 0 1 0 3.5H10zM10 7v10M12 7v1.5M12 15.5V17" />
      </svg>
    );
  return <PlatformMark platform={feedOfTab(tab).mark} size={size} mono={on} />;
}

/** The number in the heat column: a coin's 24-hour move, a story's outlets,
 *  a post's plays or likes, a chart's own heat. */
function headline(r: HotRow): string {
  const s = r.stats ?? {};
  if (s.change24h != null) return `${s.change24h >= 0 ? "+" : ""}${s.change24h.toFixed(1)}%`;
  if (r.heatLabel) return r.heatLabel;
  if (s.views != null) return compact(s.views);
  if (s.likes != null) return compact(s.likes);
  return r.heat ? compact(r.heat) : "—";
}

/** US dollars, short: $83,894 · $0.079 · $1.7T. */
function usd(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;
  return `$${n.toPrecision(3)}`;
}


/** The 上榜 badge: on the platform's own chart right now. */
const chartBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0 4px",
  borderRadius: 4,
  lineHeight: "15px",
  fontSize: 10,
  fontWeight: 500,
  background: "#fdecec",
  color: "#b23b3b",
  whiteSpace: "nowrap",
};

/* The first column is wide enough for the 上榜 badge. */
const COLS = "30px 48px minmax(0, 1fr) 118px 112px 46px 10px";
/* With the side panel open the table is half as wide: the bar, the mark
   pill and the watch button move into the panel, the number stays. */
const COLS_COMPACT = "30px 48px minmax(0, 1fr) 76px 10px";

/** The small beat label on a row's second line, in the beat's own colour
 *  (its tint behind, its ink for the words; `beatColor`). */
function relTag(col: { tint: string; ink: string }): React.CSSProperties {
  return {
    flexShrink: 0,
    padding: "0 5px",
    borderRadius: 4,
    lineHeight: "15px",
    fontSize: 10,
    background: col.tint,
    color: col.ink,
  };
}

const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 20,
  padding: "0 8px",
  borderRadius: 999,
  background: "#e6f4ec",
  color: "#0b7a63",
  fontSize: 11,
  fontWeight: 500,
  whiteSpace: "nowrap",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
};


function smallBtn(primary: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 26,
    padding: "0 10px",
    borderRadius: 8,
    border: `1px solid ${primary ? "#171717" : "#e2e2e2"}`,
    background: primary ? "#171717" : "#ffffff",
    color: primary ? "#ffffff" : "#383838",
    fontSize: 11.5,
    fontWeight: 500,
    fontFamily: "inherit",
    letterSpacing: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function Kv({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", borderTop: "1px solid #f3f3f3" }}>
      <span style={{ color: "#7c7c7c", flexShrink: 0 }}>{k}</span>
      <span style={{ fontWeight: strong ? 600 : 400, textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{v}</span>
    </div>
  );
}

/** The cover, or a quiet grey square when the platform gave none. */
function Cover({ src, placeholder }: { src: string | null; placeholder?: React.ReactNode }) {
  const [broken, setBroken] = React.useState(false);
  /* A list of phrases has no pictures; its row shows the platform's own
     mark in the same slot, so every list reads the same way. A cover that
     fails to load (a signed link that expired, a CDN that refused) falls
     back to the same mark rather than an empty box. */
  if (!src || broken)
    return (
      <span style={{ width: 48, height: 30, borderRadius: 4, background: "#f5f5f3", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {placeholder ?? null}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} style={{ width: 48, height: 30, objectFit: "cover", borderRadius: 4, display: "block", background: "#f0f0f0" }} />
  );
}

function compact(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}万`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}


/**
 * A row's own numbers, in one quiet line: plays, likes and like rate,
 * comments, how far past its account's audience it went, and when it went
 * up. Only what the platform gave; a missing number is left out, not zero.
 */
function StatLine({ stats, zh }: { stats?: HotRow["stats"]; zh: boolean }) {
  if (!stats) return null;
  const bits: React.ReactNode[] = [];
  const ratio = stats.fans && stats.views ? Math.round(stats.views / stats.fans) : null;
  if (stats.views != null) bits.push(<span key="v"><Icon name="play" size={10} fill /> {compact(stats.views)}</span>);
  if (stats.likes != null) bits.push(<span key="l"><Icon name="heart" size={10} /> {compact(stats.likes)}{stats.likeRate != null ? <span style={{ color: stats.likeRate >= 0.05 ? "#0b7a63" : "#999999" }}> {(stats.likeRate * 100).toFixed(1)}%</span> : null}</span>);
  if (stats.comments != null) bits.push(<span key="c"><Icon name="comment" size={10} /> {compact(stats.comments)}</span>);
  if (stats.shares != null) bits.push(<span key="s"><Icon name="share" size={10} /> {compact(stats.shares)}</span>);
  if (stats.saves != null) bits.push(<span key="f">{zh ? "收藏" : "saves"} {compact(stats.saves)}</span>);
  if (stats.price != null) bits.push(<span key="$">{usd(stats.price)}</span>);
  if (stats.marketCap != null) bits.push(<span key="m">{zh ? "市值" : "cap"} {usd(stats.marketCap)}{stats.capRank ? ` · #${stats.capRank}` : ""}</span>);
  if (ratio !== null && ratio >= 10) bits.push(<span key="r" title={zh ? "播放 ÷ 账号粉丝" : "views ÷ followers"} style={{ color: "#fff", background: ratio >= 100 ? "#c2410c" : "#a35f00", borderRadius: 3, padding: "0 4px", fontWeight: 600 }}>×{compact(ratio)}{zh ? " 粉丝量" : " fans"}</span>);
  if (stats.videos != null) bits.push(<span key="n">{compact(stats.videos)} {zh ? "条视频" : "videos"}</span>);
  if (stats.rankUp) bits.push(<span key="u" style={{ color: "#0b7a63" }}>↑{stats.rankUp}</span>);
  if (stats.publishedAt) bits.push(<span key="p">{since(stats.publishedAt, zh)}</span>);
  if (!bits.length) return null;
  return <span style={{ display: "inline-flex", gap: 8, flexShrink: 0, color: "#7c7c7c", fontVariantNumeric: "tabular-nums" }}>{bits}</span>;
}

function since(iso: string, zh: boolean): string {
  const h = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return zh ? "刚刚" : "just now";
  if (h < 24) return zh ? `${Math.round(h)} 小时前` : `${Math.round(h)}h ago`;
  return zh ? `${Math.round(h / 24)} 天前` : `${Math.round(h / 24)}d ago`;
}

function clockHK(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

/**
 * Today's one or two topics, as a small list that opens row by row.
 *
 * Folded by default under the list and the researcher's line. A row is a
 * little picture, the topic and its strength; opened, it says why, lists
 * the sources with their links and numbers, and offers the two things to
 * do next: have the script written, or add the host's clips for it.
 */
function PicksList({
  zh,
  picks,
  open,
  onToggle,
  openPick,
  setOpenPick,
  canWriteScripts,
  sending,
  onWrite,
  onWatch,
  onClips,
}: {
  zh: boolean;
  picks: Pick[];
  open: boolean;
  onToggle: () => void;
  openPick: number | null;
  setOpenPick: (i: number | null) => void;
  canWriteScripts: boolean;
  sending: string | null;
  onWrite: (text: string, id: string) => void;
  onWatch: (phrase: string) => void;
  onClips: (title: string, withScript?: boolean) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const chevron = (on: boolean, size = 13) => (
    <svg viewBox="0 0 24 24" aria-hidden style={{ width: size, height: size, flexShrink: 0, transform: on ? "rotate(90deg)" : "none", transition: "transform .15s ease", stroke: "#7c7c7c", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
      <path d="M9.5 6.5 15 12l-5.5 5.5" />
    </svg>
  );
  return (
    <div style={{ border: "1px solid #ededed", borderRadius: 12, background: "#fff", overflow: "hidden" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", border: 0, background: "transparent", cursor: "pointer", font: "inherit", textAlign: "left" }}>
        {chevron(open, 14)}
        <Icon name="spark" size={14} color="#c2410c" />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#171717", whiteSpace: "nowrap", flexShrink: 0 }}>{t("Picked for today", "今天挑出来的选题")}</span>
        <span style={{ fontSize: 11, color: "#fff", background: "#171717", borderRadius: 999, padding: "0 7px", lineHeight: "17px", flexShrink: 0 }}>{picks.length}</span>
        <span style={{ fontSize: 11.5, color: "#999999", minWidth: 0, flex: "1 1 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{open ? "" : picks.map((p) => p.text).join(" · ")}</span>
      </button>
      {open ? (
        <div style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
          <OwnTopic zh={zh} />
          {picks.map((p, i) => {
            const on = openPick === i;
            return (
              <div key={i} style={{ borderRadius: 10, background: on ? "#f7f8fb" : "transparent", border: `1px solid ${on ? "#e4e9f3" : "transparent"}`, transition: "background .15s ease" }}>
                <button type="button" onClick={() => setOpenPick(on ? null : i)} aria-expanded={on} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", border: 0, background: "transparent", cursor: "pointer", font: "inherit", textAlign: "left" }}>
                  {p.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={throughUs(p.thumbnail) ?? undefined} alt="" loading="lazy" style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: "#f0f0f0" }} />
                  ) : (
                    <span style={{ width: 34, height: 34, borderRadius: 8, background: "linear-gradient(135deg, #d5e7fb, #dcd6fb)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#0f5bd5" }}><Icon name="bulb" size={16} /></span>
                  )}
                  <span style={{ minWidth: 0, flexGrow: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#171717", whiteSpace: on ? "normal" : "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.text}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 10.5, color: "#7c7c7c", background: "#f3f3f1", borderRadius: 999, padding: "0 7px", lineHeight: "16px" }}>
                        {p.source === "mine" ? t(`added by ${p.by ?? "you"}`, `${p.by ?? "你"}加的`) : p.source === "digest" ? t("morning brief", "今早晨报") : p.source === "plan" ? t("today's plan", "今日计划") : p.source === "backlog" ? t("backlog", "选题储备") : t("viewer question", "观众提问")}
                      </span>
                      {p.strength ? <span title={t("Signal strength", "信号强度")} style={{ fontSize: 10, color: "#c2410c", letterSpacing: 1 }}>{"●".repeat(p.strength)}{"○".repeat(5 - p.strength)}</span> : null}
                    </span>
                  </span>
                  {chevron(on)}
                </button>
                {on ? (
                  <div style={{ padding: "2px 10px 10px 52px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {p.why ? <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "#2b343d" }}>{p.why}</div> : null}
                    {p.sources?.length ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontSize: 10.5, color: "#999999", letterSpacing: ".04em" }}>{t("SOURCES", "来源")}</span>
                        {p.sources.map((src, k) => (
                          <a key={k} href={src.url ?? "#"} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 11.5, color: "#171717", textDecoration: "none", minWidth: 0 }}>
                            <span style={{ color: "#0f5bd5", flexShrink: 0 }}><Icon name="external" size={11} /></span>
                            <span style={{ color: "#999999", flexShrink: 0 }}>{src.label}</span>
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{src.title}</span>
                            <span style={{ color: "#7c7c7c", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{src.numbers}</span>
                          </a>
                        ))}
                      </div>
                    ) : p.evidence?.length ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {p.evidence.map((e, k) => (
                          <span key={k} style={{ fontSize: 11.5, color: "#525252" }}>{e}</span>
                        ))}
                      </div>
                    ) : null}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" onClick={() => onClips(p.text)} style={{ ...smallBtn(true), height: 28, borderRadius: 8 }}>
                        <Icon name="plus" size={13} /> {t("Start project", "开始项目")}
                      </button>
                      {canWriteScripts ? (
                        <button type="button" onClick={() => onClips(p.text, true)} style={{ ...smallBtn(false), height: 28, borderRadius: 8 }}>
                          <Icon name="pen" size={13} /> {t("Start and write the script", "开项目并写脚本")}
                        </button>
                      ) : null}
                      <span style={{ flexGrow: 1 }} />
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: "#525252", textDecoration: "none" }}>
                          <Icon name="play" size={11} fill /> {t("Watch the source", "看原视频")}
                        </a>
                      ) : null}
                      <button type="button" onClick={() => onWatch(p.text.replace(/^写《|》.*$/g, "").replace(/[？?。！!—–-].*$/, "").slice(0, 40))} style={{ border: 0, background: "transparent", padding: 0, fontSize: 11.5, color: "#525252", cursor: "pointer", font: "inherit" }}>
                        <Icon name="eye" size={12} /> {t("Watch the topic", "加入关注")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Your own topic, next to the researcher's. Stored for today
 * (`/api/research/picks`), so it stays on the list for everybody and gets
 * the same Write script and Add clips buttons.
 */
function OwnTopic({ zh }: { zh: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function add() {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    const r = await fetch("/api/research/picks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: v }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      notify(t("Could not add that topic.", "没加上这个选题。"));
      return;
    }
    setText("");
    router.refresh();
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
      style={{ display: "flex", gap: 6, padding: "2px 6px 6px" }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("＋ Add your own topic for today…", "＋ 加一个自己的选题…")}
        style={{ flexGrow: 1, minWidth: 0, height: 30, padding: "0 10px", border: "1px dashed #d9d9d9", borderRadius: 8, outline: "none", fontFamily: "inherit", fontSize: 12.5, background: "#fcfcfc" }}
      />
      <button type="submit" disabled={!text.trim() || busy} style={{ ...smallBtn(true), height: 30, borderRadius: 8, opacity: text.trim() ? 1 : 0.45 }}>
        {t("Add", "添加")}
      </button>
    </form>
  );
}
