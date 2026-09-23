"use client";

import React from "react";
import { useLocalPreference } from "@/lib/client/preference";
import { PlatformMark } from "@/components/ui/PlatformMark";

/**
 * What is happening right now, above everything else.
 *
 * The dashboard opened on a ranked list of phrases somebody typed weeks ago.
 * That is the studio's own judgement and it belongs here — but it is not
 * *news*, and a research screen whose first line is a stale ranking asks the
 * reader to remember rather than to look.
 *
 * So the first line is now the two things that are true this minute and cost
 * almost nothing to read: what Hong Kong is searching for (Google's own daily
 * feed) and what Hong Kong is watching (YouTube's `mostPopular` chart). Both
 * are one click from becoming a watched topic, which is the whole point —
 * recognising something beats recalling it.
 *
 * Collapsible, and it remembers: somebody working through a backlog does not
 * want the news every time, and somebody looking for an idea wants nothing
 * else.
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

/**
 * Pictures come through this app, not straight from Google.
 *
 * `i.ytimg.com` is unreachable from mainland China and from a fair number of
 * office networks, which drew a row of empty grey boxes for the people this is
 * built for. The route fetches it server-side and caches it for a day.
 */
export const throughUs = (url: string | null) =>
  url ? `/api/img?u=${encodeURIComponent(url)}` : null;

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

  if (searches.length === 0 && videos.length === 0 && !note) return null;

  return (
    <div style={{ flexShrink: 0, borderBottom: "1px solid #ededed", background: "#fcfcfc" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 20px 0" }}>
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
          {t("Right now", "此刻")} · {region}
        </button>
        <span style={{ fontSize: 11, color: "#c7c7c7" }}>
          {t("searched and watched in the last few hours", "过去几小时被搜索和观看的内容")}
        </span>
      </div>

      {!open ? <div style={{ height: 8 }} /> : null}

      {open ? (
        <div style={{ display: "flex", gap: 18, padding: "9px 20px 12px", alignItems: "flex-start" }}>
          {/* --- what people are searching for --- */}
          {searches.length > 0 ? (
            <div style={{ minWidth: 0, flexGrow: 1, flexBasis: 0 }}>
              <div style={{ fontSize: 10.5, color: "#999999", marginBottom: 6 }}>
                {t("Trending searches", "热搜")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {searches.slice(0, 16).map((s) => (
                  <button
                    key={s.phrase}
                    type="button"
                    title={s.headline ?? undefined}
                    onClick={() => onWatch(s.phrase)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      maxWidth: 230,
                      height: 25,
                      padding: "0 9px",
                      borderRadius: 7,
                      border: "1px solid #ededed",
                      background: "#fff",
                      cursor: "pointer",
                      fontSize: 11.5,
                      fontFamily: "inherit",
                      letterSpacing: "inherit",
                      color: "#383838",
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.phrase}
                    </span>
                    {s.traffic ? (
                      <span style={{ fontSize: 10, color: "#999999", flexShrink: 0 }}>{s.traffic}</span>
                    ) : null}
                    {/* Hong Kong's own feed is often five phrases. The rest
                        come from the markets the studio also posts into, and
                        each says so — "arsenal in GB" is a different fact
                        from "arsenal in HK". */}
                    {s.region && s.region !== region ? (
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
                        {s.region}
                      </span>
                    ) : null}
                  </button>
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
                  <a
                    key={v.id}
                    href={`https://www.youtube.com/watch?v=${v.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${v.title} — ${v.channelTitle}`}
                    style={{ width: 132, flexShrink: 0, textDecoration: "none", color: "inherit" }}
                  >
                    <Thumb src={throughUs(v.thumbnail)} title={v.title} />
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
                      {v.title}
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: "#999999",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {compact(v.views)} · {v.channelTitle}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {note ? (
            <div style={{ fontSize: 11, color: "#a35f00", maxWidth: 260, lineHeight: 1.5 }}>{note}</div>
          ) : null}
        </div>
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
        <span
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
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
      style={{
        width: 132,
        height: 74,
        objectFit: "cover",
        borderRadius: 7,
        display: "block",
        background: "#f3f3f3",
      }}
    />
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
