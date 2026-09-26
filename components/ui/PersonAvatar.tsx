"use client";

import * as React from "react";
import { avatarOf, initialsOf } from "@/lib/avatars/default";

/**
 * A studio member's face: the picture they chose or uploaded, else the default
 * picked from their id (`lib/avatars/default.ts`).
 *
 * One component for every place a colleague is drawn — chat rows, the people
 * list, the members sheet, the top bar, Home — so they cannot drift apart
 * again the way ten hand-rolled grey tiles did. Not for the AI employees (they
 * keep `AgentIcon`'s pixel faces) and not for people outside the studio (an
 * inbox comment's author has no user row to pick a default by).
 *
 * The initials are only what is left when there is no picture at all: no id
 * and no URL, or a URL that failed to load. The name is always the image's
 * alt text, so a screen reader and a broken image both still say who it is.
 *
 * Sizing: pass `size` for an inline square, or leave it out and size it with
 * `className` — the chat thread's `.mav` does, and its "grouped line" rule
 * (`height: 0`) would lose to an inline height.
 */
export function PersonAvatar({
  id,
  url,
  name,
  size,
  radius,
  className,
  title,
  style,
}: {
  /** The person's user id, for their default picture. */
  id?: string | null;
  /** `users.avatar_url`, when they have one. */
  url?: string | null;
  /** Their display name: the alt text, and the initials if all else fails. */
  name: string;
  size?: number;
  /** Corner radius in px; a circle when left out and `size` is given. */
  radius?: number;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}): React.JSX.Element {
  const src = avatarOf(id, url);
  /* The URL that failed, not a flag: a person who changes picture gets a new
     URL and a fresh try, without an effect to reset anything. Starts null on
     the server and in the browser alike, so hydration agrees. */
  const [failed, setFailed] = React.useState<string | null>(null);

  const box: React.CSSProperties = {
    ...(size === undefined ? {} : { width: size, height: size }),
    ...(radius === undefined ? (size === undefined ? {} : { borderRadius: size / 2 }) : { borderRadius: radius }),
    flexShrink: 0,
  };

  if (src && failed !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        title={title}
        className={className}
        draggable={false}
        onError={() => setFailed(src)}
        style={{ objectFit: "cover", display: "block", background: "#f3f3f3", ...box, ...style }}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={name}
      title={title}
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#ececec",
        color: "#525252",
        fontWeight: 600,
        fontSize: size === undefined ? 12 : Math.max(8, Math.round(size * 0.4)),
        letterSpacing: 0,
        overflow: "hidden",
        ...box,
        ...style,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
