"use client";

import React from "react";
import { useLocalPreference } from "@/lib/client/preference";
import { PlatformMark } from "@/components/ui/PlatformMark";
import { PLATFORMS, type HotRow, type PlatformKey } from "@/lib/research/platform-catalog";
import { platformHotAction } from "@/app/(app)/research/platform-actions";

/**
 * What is happening right now, above everything else — on whichever platform
 * the studio wants to look at.
 *
 * The dashboard opened on a ranked list of phrases somebody typed weeks ago.
 * That is the studio's own judgement and it belongs here — but it is not
 * *news*, and a research screen whose first line is a stale ranking asks the
 * reader to remember rather than to look.
 *
 * So the first line is what is true this minute: by default the two feeds
 * that cost nothing (Google's daily searches, YouTube's chart), and on a tab
 * each of 抖音, 小红书, 微博, B站 and TikTok — the platform's own hot list,
 * read when somebody picks it and cached for half an hour, because those are
 * metered. WeChat has no public list and the tab says so rather than showing
 * somebody else's. Every phrase is one click from becoming a watched topic,
 * which is the whole point: recognising something beats recalling it.
 *
 * Collapsible, and it remembers — as does the platform picked.
 */
export type LiveSearch = {
  phrase: string;
  traffic: string | null;
  headline: string | null;
  /** Where it is trending, when that is not the region on the strip. */
  region?: string;
};
export type LiveVideo = {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string | null;
  views: number;
};

const KEY = "aura:research:livenow";
const PLATFORM_KEY = "aura:research:platform";

/** The default tab: Google and YouTube side by side, as the strip always was. */
type Tab = "live" | PlatformKey;
const TABS: readonly Tab[] = ["live", ...PLATFORMS.filter((p) => p.key !== "google" && p.key !== "youtube").map((p) => p.key)];

/**
 * Pictures come through this app, not straight from the platform.
 *
 * `i.ytimg.com` is unreachable from mainland China and from a fair number of
 * office networks, which drew a row of empty grey boxes for the people this is
 * built for. The route fetches it server-side and caches it for a day.
 */
export const throughUs = (url: string | null) =>
  url ? `/api/img?u=${encodeURIComponent(url)}` : null;

type Loaded = { rows: HotRow[]; note: string | null };

export function LiveNow({
  searches,
  videos,
  region,
  zh,
  onWatch,
  note,
}: {
  searches: LiveSearch[];
  videos: LiveVideo[];
  region: string;
  zh: boolean;
  /** Start watching a phrase. Same path as the topic picker. */
  onWatch: (phrase: string) => void;
  /** Why the strip is thin, when it is: a missing key, a spent quota. */
  note?: string | null;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  // Open by default: somebody who has not decided wants to see the news.
  const [state, setState] = useLocalPreference<"open" | "shut">(KEY, ["open", "shut"], "open");
  const open = state === "open";
  const [tab, setTab] = useLocalPreference<Tab>(PLATFORM_KEY, TABS, "live");

  /* One fetch per platform per visit; the server caches for half an hour on
     top, so switching back and forth is free. */
  const [loaded, setLoaded] = React.useState<Partial<Record<PlatformKey, Loaded>>>({});
  const [loading, setLoading] = React.useState<PlatformKey | null>(null);

  React.useEffect(() => {
    if (tab === "live" || loaded[tab] || !open) return;
    let cancelled = false;
    setLoading(tab);
    void platformHotAction(tab).then((res) => {
      if (cancelled) return;
      setLoading(null);
      setLoaded((m) => ({
        ...m,
        [tab]: "error" in res ? { rows: [], note: res.error } : { rows: res.rows, note: res.note },
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [tab, open, loaded]);

  if (searches.length === 0 && videos.length === 0 && !note && tab === "live") return null;

  const meta = tab === "live" ? null : PLATFORMS.find((p) => p.key === tab) ?? null;
  const current = tab === "live" ? null : loaded[tab] ?? null;

  return (
    <div style={{ flexShrink: 0, borderBottom: "1px solid #ededed", background: "#fcfcfc" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 20px 0", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setState(open ? "shut" : "open")}
          aria-expanded={open}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: 0,
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: ".04em",
            textTransform: "uppercase",
            color: "#7c7c7c",
            fontFamily: "inherit",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            style={{
              width: 11,
              height: 11,
              fill: "none",
              stroke: "#7c7c7c",
              strokeWidth: 2.4,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform .12s linear",
            }}
          >
            <path d="m9 5 7 7-7 7" />
          </svg>
          {t("Right now", "此刻")}
        </button>

        {/* The platform tabs. "此刻" is the two free feeds for the region;
            the rest are each platform's own list. */}
        {open ? (
          <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
            {TABS.map((key) => {
              const p = key === "live" ? null : PLATFORMS.find((x) => x.key === key)!;
              const on = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-pressed={on}
                  title={p?.unavailable ? t("No public list", "没有公开热榜") : undefined}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    height: 24,
                    padding: "0 9px",
                    borderRadius: 7,
                    border: `1px solid ${on ? "#171717" : "#ededed"}`,
                    background: on ? "#171717" : "#ffffff",
                    color: on ? "#ffffff" : p?.unavailable ? "#b3b3b3" : "#525252",
                    fontSize: 11.5,
                    fontWeight: on ? 500 : 400,
                    fontFamily: "inherit",
                    letterSpacing: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {p ? <PlatformMark platform={p.key} size={11} /> : null}
                  {key === "live" ? `${region} · Google + YouTube` : zh ? p!.zh : p!.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {!open ? <div style={{ height: 8 }} /> : null}

      {open && tab === "live" ? (
        <div style={{ display: "flex", gap: 18, padding: "9px 20px 12px", alignItems: "flex-start" }}>
          {/* --- what people are searching for --- */}
          {searches.length > 0 ? (
            <div style={{ minWidth: 0, flexGrow: 1, flexBasis: 0 }}>
              <div style={{ fontSize: 10.5, color: "#999999", marginBottom: 6 }}>
                {t("Trending searches", "热搜")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {searches.slice(0, 16).map((s) => (
                  <Chip
                    key={s.phrase}
                    phrase={s.phrase}
                    label={s.traffic}
                    tag={s.region && s.region !== region ? s.region : null}
                    title={s.headline ?? undefined}
                    onClick={() => onWatch(s.phrase)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* --- what people are watching --- */}
          {videos.length > 0 ? (
            <div style={{ minWidth: 0, flexGrow: 1.4, flexBasis: 0 }}>
              <div
                style={{
                  fontSize: 10.5,
                  color: "#999999",
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <PlatformMark platform="youtube" size={12} />
                {t("Most watched", "播放最多")}
              </div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
                {videos.slice(0, 20).map((v) => (
                  <Card
                    key={v.id}
                    href={`https://www.youtube.com/watch?v=${v.id}`}
                    thumbnail={throughUs(v.thumbnail)}
                    title={v.title}
                    sub={`${compact(v.views)} · ${v.channelTitle}`}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {note ? (
            <div style={{ fontSize: 11, color: "#a35f00", maxWidth: 260, lineHeight: 1.5 }}>{note}</div>
          ) : null}
        </div>
      ) : null}

      {open && tab !== "live" && meta ? (
        <div style={{ padding: "9px 20px 12px" }}>
          <div
            style={{
              fontSize: 10.5,
              color: "#999999",
              marginBottom: 6,
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <PlatformMark platform={meta.key} size={12} />
            {zh ? meta.zh : meta.label}
            {" · "}
            {meta.kind === "video"
              ? t("what it is pushing right now", "此刻在推的")
              : meta.kind === "note"
                ? t("what it is telling creators to make", "平台给创作者的热点灵感")
                : t("its own hot search list", "平台自己的热搜榜")}
            {current?.rows.length ? ` · ${current.rows.length}` : ""}
          </div>

          {loading === tab && !current ? (
            <div style={{ fontSize: 11.5, color: "#999999" }}>{t("Reading…", "正在读取…")}</div>
          ) : current?.note && !current.rows.length ? (
            <div style={{ fontSize: 11.5, color: "#a35f00", lineHeight: 1.5 }}>{current.note}</div>
          ) : meta.kind === "search" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {(current?.rows ?? []).slice(0, 40).map((r) => (
                <Chip
                  key={r.phrase}
                  phrase={r.phrase}
                  label={r.heatLabel ?? (r.heat ? compact(r.heat) : null)}
                  tag={null}
                  title={r.extra ?? undefined}
                  onClick={() => onWatch(r.phrase)}
                  href={r.url}
                />
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
              {(current?.rows ?? []).slice(0, 24).map((r, i) => (
                <Card
                  key={`${r.url ?? r.phrase}-${i}`}
                  href={r.url}
                  thumbnail={throughUs(r.thumbnail)}
                  title={r.phrase}
                  sub={[r.heatLabel ?? (r.heat ? compact(r.heat) : null), r.extra].filter(Boolean).join(" · ")}
                  onWatch={() => onWatch(r.phrase.slice(0, 40))}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A phrase you can start watching. The little ↗ opens it on the platform. */
function Chip({
  phrase,
  label,
  tag,
  title,
  onClick,
  href,
}: {
  phrase: string;
  label: string | null;
  tag: string | null;
  title?: string;
  onClick: () => void;
  href?: string | null;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "stretch", maxWidth: 260 }}>
      <button
        type="button"
        title={title}
        onClick={onClick}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          minWidth: 0,
          height: 25,
          padding: "0 9px",
          borderRadius: href ? "7px 0 0 7px" : 7,
          border: "1px solid #ededed",
          background: "#fff",
          cursor: "pointer",
          fontSize: 11.5,
          fontFamily: "inherit",
          letterSpacing: "inherit",
          color: "#383838",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{phrase}</span>
        {label ? <span style={{ fontSize: 10, color: "#999999", flexShrink: 0 }}>{label}</span> : null}
        {tag ? (
          <span
            style={{
              fontSize: 9.5,
              color: "#999999",
              background: "#f3f3f3",
              borderRadius: 4,
              padding: "1px 4px",
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        ) : null}
      </button>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title="打开"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "0 6px",
            border: "1px solid #ededed",
            borderLeft: 0,
            borderRadius: "0 7px 7px 0",
            background: "#fff",
            color: "#999999",
            fontSize: 10,
            textDecoration: "none",
          }}
        >
          ↗
        </a>
      ) : null}
    </span>
  );
}

/** A video or a note, with its picture. */
function Card({
  href,
  thumbnail,
  title,
  sub,
  onWatch,
}: {
  href: string | null;
  thumbnail: string | null;
  title: string;
  sub: string;
  onWatch?: () => void;
}) {
  const body = (
    <>
      <Thumb src={thumbnail} title={title} />
      <div
        style={{
          fontSize: 11,
          lineHeight: 1.35,
          marginTop: 4,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 10.5, color: "#999999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {sub}
      </div>
    </>
  );
  return (
    <div style={{ width: 132, flexShrink: 0 }}>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title={title} style={{ textDecoration: "none", color: "inherit" }}>
          {body}
        </a>
      ) : (
        body
      )}
      {onWatch ? (
        <button
          type="button"
          onClick={onWatch}
          style={{
            marginTop: 4,
            height: 20,
            padding: "0 7px",
            borderRadius: 6,
            border: "1px solid #ededed",
            background: "#fff",
            fontSize: 10.5,
            color: "#525252",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          关注
        </button>
      ) : null}
    </div>
  );
}

/**
 * The picture, or the title in its place.
 *
 * A thumbnail that cannot be fetched used to leave an empty grey rectangle —
 * the same picture as "there is nothing here", which is why a blocked CDN
 * looked like a broken feature. When the image fails, the card carries the
 * video's own title instead, so the row still says something.
 */
function Thumb({ src, title }: { src: string | null; title: string }) {
  const [broken, setBroken] = React.useState(false);

  if (!src || broken) {
    return (
      <div
        style={{
          width: 132,
          height: 74,
          borderRadius: 7,
          background: "#f3f3f3",
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          fontSize: 10.5,
          lineHeight: 1.3,
          color: "#7c7c7c",
          overflow: "hidden",
        }}
      >
        <span style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {title}
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      style={{ width: 132, height: 74, objectFit: "cover", borderRadius: 7, display: "block", background: "#f3f3f3" }}
    />
  );
}

function compact(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}万`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
