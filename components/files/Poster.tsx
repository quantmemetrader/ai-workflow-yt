"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

/*
 * A poster that waits for itself — and looks like it is waiting.
 *
 * `/api/files/<id>/thumb` answers 404 until the poster exists — a few seconds
 * after an upload, longer when the worker has a render in hand — and a bare
 * <img> shows that as a broken-image icon until the page is reloaded. This
 * one asks again, quickly at first and then every ten seconds for about five
 * minutes (a big upload's poster can wait behind other work), and only then
 * settles on the fallback. The retry query string is what defeats the
 * browser's memory of the 404.
 *
 * Until the picture arrives nothing broken is shown: a quiet grey box with a
 * spinner and, if the caller says so, a word about why ("uploading",
 * "processing"). The studio saw the broken icon on a 590 MB upload and read
 * it as a file that had failed.
 */
const WAITS = [2000, 3000, 5000, 8000, ...Array(28).fill(10_000)];

export function Poster({
  src,
  style,
  className,
  fallback,
  pending,
}: {
  src: string;
  style?: CSSProperties;
  className?: string;
  fallback?: ReactNode;
  /** Shown under the spinner while the picture is not there yet. */
  pending?: ReactNode;
}) {
  // The attempt count belongs to one source: a new `src` starts over.
  const [state, setState] = useState({ src, attempt: 0, gaveUp: false, loaded: false });
  const { attempt, gaveUp, loaded } = state.src === src ? state : { attempt: 0, gaveUp: false, loaded: false };
  const setAttempt = (next: number) => setState({ src, attempt: next, gaveUp: false, loaded: false });
  const setGaveUp = () => setState({ src, attempt, gaveUp: true, loaded: false });
  const setLoaded = () => setState({ src, attempt, gaveUp: false, loaded: true });

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
    /* The box carries the caller's size; the picture fills it once it has
       loaded and is invisible before that, so a 404 in flight never draws
       the browser's broken-image glyph. */
    <div
      className={className}
      style={{ position: "relative", overflow: "hidden", background: "#f3f3f3", ...style }}
    >
      {/* Signed R2 URLs expire, so next/image's optimiser cannot cache them
          and would only add a round trip. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        onLoad={setLoaded}
        onError={() => {
          const wait = WAITS[attempt];
          if (wait === undefined) setGaveUp();
          else setTimeout(() => setAttempt(attempt + 1), wait);
        }}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: style?.objectFit ?? "cover",
          display: "block",
          opacity: loaded ? 1 : 0,
          transition: "opacity .2s ease",
        }}
      />
      {loaded ? null : <Waiting label={pending} />}
    </div>
  );
}

/** The spinner and its word, for a poster box or an upload in progress. */
export function Waiting({ label, progress }: { label?: ReactNode; progress?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        color: "#8a8a8a",
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: "0.02em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {progress == null ? (
        <svg viewBox="0 0 24 24" style={{ width: 16, height: 16 }} aria-hidden>
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="#dcdcdc" strokeWidth="2.4" />
          <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" fill="none" stroke="#7a7a7a" strokeWidth="2.4" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
          </path>
        </svg>
      ) : (
        /* A ring that fills: the byte count is in the tray, the shape of it
           belongs on the card. */
        <svg viewBox="0 0 24 24" style={{ width: 22, height: 22 }} aria-hidden>
          <circle cx="12" cy="12" r="9" fill="none" stroke="#dcdcdc" strokeWidth="2.6" />
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="#171717"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 9}`}
            strokeDashoffset={`${2 * Math.PI * 9 * (1 - Math.max(0, Math.min(1, progress)))}`}
            transform="rotate(-90 12 12)"
            style={{ transition: "stroke-dashoffset .25s linear" }}
          />
        </svg>
      )}
      {label ? <span>{label}</span> : null}
    </div>
  );
}
