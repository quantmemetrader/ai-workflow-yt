"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { PlatformMark } from "@/components/ui/PlatformMark";
import { Tr } from "@/components/ui/Tr";
import { publishPlatformName, type PublishedPlace } from "@/lib/projects/publication";

/**
 * How 已发布 looks, wherever a project is shown.
 *
 * One green, one check, the platforms' own marks: the project page's header,
 * the projects list, Home's cards, the sidebar and the video library all draw
 * these, so "published" reads the same everywhere. The green is the "done"
 * tint the stepper already uses (`STAGE_TONE.done` in StepTrack.tsx).
 *
 * No state and no clock, so these draw the same on the server and in the
 * browser. Marks are links only where the caller says so (`links`): inside a
 * card that is itself a link, a second <a> would be invalid HTML and a
 * hydration error.
 */
export const PUBLISHED_TONE = { bg: "#e7f6ee", ink: "#1e7a4f", line: "#cbe9d8", dot: "#3fb57a", solid: "#23a15f" } as const;

/** The solid green circle with a white check that leads every 已发布. */
export function PublishedCheck({ size = 14 }: { size?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: size / 2, background: PUBLISHED_TONE.solid, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Icon name="check" size={Math.round(size * 0.72)} color="#fff" strokeWidth={3} />
    </span>
  );
}

/** One platform's mark; "其他" (and anything without a drawn mark) is a link glyph. */
export function PublishedMark({ platform, size = 14, zh }: { platform: string; size?: number; zh: boolean }) {
  if (platform === "other") {
    return (
      <span title={publishPlatformName(platform, zh)} style={{ width: size, height: size, borderRadius: Math.round(size / 3.5), background: "#eef0f3", color: "#5b6472", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon name="link" size={Math.round(size * 0.78)} strokeWidth={2.2} />
      </span>
    );
  }
  return <PlatformMark platform={platform} size={size} title={publishPlatformName(platform, zh)} />;
}

/**
 * The platforms as a row of marks. With `links`, each mark with a link opens
 * the post in a new tab (and does not open the card it sits on).
 */
export function PublishedMarks({ platforms, zh, size = 14, links = false, gap = 4 }: { platforms: readonly PublishedPlace[]; zh: boolean; size?: number; links?: boolean; gap?: number }) {
  if (!platforms.length) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap, flexShrink: 0 }}>
      {platforms.map((p) =>
        links && p.url ? (
          <a
            key={p.key}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            title={zh ? `在${publishPlatformName(p.key, true)}打开` : `Open on ${publishPlatformName(p.key, false)}`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            style={{ display: "inline-flex", borderRadius: 4 }}
          >
            <PublishedMark platform={p.key} size={size} zh={zh} />
          </a>
        ) : (
          <PublishedMark key={p.key} platform={p.key} size={size} zh={zh} />
        ),
      )}
    </span>
  );
}

/**
 * The green 已发布 pill: the check, the word (translate-proof), and — where
 * there is room — the marks of where it went.
 */
export function PublishedPill({ zh, platforms = [], size = "sm", links = false }: { zh: boolean; platforms?: readonly PublishedPlace[]; size?: "sm" | "md"; links?: boolean }) {
  const md = size === "md";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: md ? 6 : 5,
        flexShrink: 0,
        height: md ? 24 : 20,
        padding: md ? "0 9px 0 5px" : "0 8px 0 4px",
        borderRadius: 999,
        background: PUBLISHED_TONE.bg,
        boxShadow: `inset 0 0 0 1px ${PUBLISHED_TONE.line}`,
        color: PUBLISHED_TONE.ink,
        fontSize: md ? 12 : 11.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <PublishedCheck size={md ? 15 : 13} />
      <Tr zh="已发布" en="Published" inZh={zh} />
      {platforms.length ? (
        <>
          <span aria-hidden style={{ width: 1, height: md ? 12 : 10, background: PUBLISHED_TONE.line, margin: "0 1px" }} />
          <PublishedMarks platforms={platforms} zh={zh} size={md ? 13 : 11} links={links} gap={3} />
        </>
      ) : null}
    </span>
  );
}
