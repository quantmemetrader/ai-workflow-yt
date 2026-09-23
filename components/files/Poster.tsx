"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

/*
 * A poster that waits for itself.
 *
 * `/api/files/<id>/thumb` answers 404 until the poster exists — a few seconds
 * after an upload, longer when the worker has a render in hand — and a bare
 * <img> shows that as a broken-image icon, or as nothing, until the page is
 * reloaded. This one asks again, quickly at first and then every ten seconds
 * for about five minutes (a big upload's poster can wait behind other work),
 * and only then settles on the fallback. The retry query string is what defeats the
 * browser's memory of the 404.
 */
const WAITS = [2000, 3000, 5000, 8000, ...Array(28).fill(10_000)];

export function Poster({
  src,
  style,
  className,
  fallback,
}: {
  src: string;
  style?: CSSProperties;
  className?: string;
  fallback?: ReactNode;
}) {
  // The attempt count belongs to one source: a new `src` starts over.
  const [state, setState] = useState({ src, attempt: 0, gaveUp: false });
  const { attempt, gaveUp } = state.src === src ? state : { attempt: 0, gaveUp: false };
  const setAttempt = (next: number) => setState({ src, attempt: next, gaveUp: false });
  const setGaveUp = () => setState({ src, attempt, gaveUp: true });

  if (gaveUp) {
    return (
      <div
        className={className}
        style={{ background: "#f3f3f3", display: "flex", alignItems: "center", justifyContent: "center", ...style }}
      >
        {fallback}
      </div>
    );
  }

  const url = attempt === 0 ? src : `${src}${src.includes("?") ? "&" : "?"}r=${attempt}`;
  return (
    // Signed R2 URLs expire, so next/image's optimiser cannot cache them and
    // would only add a round trip.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className={className}
      style={style}
      onError={() => {
        const wait = WAITS[attempt];
        if (wait === undefined) setGaveUp();
        else setTimeout(() => setAttempt(attempt + 1), wait);
      }}
    />
  );
}
