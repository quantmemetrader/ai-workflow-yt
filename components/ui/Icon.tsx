import * as React from "react";

/**
 * The line icons used across the app, in one place.
 *
 * Drawn on a 24px grid with a 1.8 stroke in the current colour, so they sit
 * with the rail's icons and take whatever colour the text around them has.
 * Used instead of emoji, which render differently on every machine and read
 * as a toy in a studio tool.
 */
export type IconName =
  | "chat"
  | "pen"
  | "film"
  | "upload"
  | "check"
  | "spark"
  | "bulb"
  | "play"
  | "plus"
  | "external"
  | "heart"
  | "comment"
  | "share"
  | "clapper"
  | "eye"
  | "pause"
  | "scissors"
  | "lock"
  | "folder"
  | "folderOpen";

const PATHS: Record<IconName, React.ReactNode> = {
  chat: <path d="M20.5 11.6a7.9 7.9 0 0 1-8.5 7.8 8.9 8.9 0 0 1-2.6-.4L4.5 20.4l1.3-3.8a7.7 7.7 0 0 1-1.8-5A7.9 7.9 0 0 1 12 3.8a7.9 7.9 0 0 1 8.5 7.8z" />,
  pen: (
    <>
      <path d="M14.2 5.6 18.4 9.8 9.2 19H5v-4.2z" />
      <path d="m12 7.8 4.2 4.2" />
    </>
  ),
  film: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
      <path d="M7.5 5v14M16.5 5v14M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9" />
      <path d="M4.5 15v3.2a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8V15" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  spark: <path d="M12 3.5 13.9 10l6.6 2-6.6 2L12 20.5 10.1 14l-6.6-2 6.6-2z" />,
  bulb: (
    <>
      <path d="M9 17.5h6M10 20.5h4" />
      <path d="M12 3.5a5.8 5.8 0 0 0-3.6 10.3c.6.5 1 1.2 1 2V17h5.2v-1.2c0-.8.4-1.5 1-2A5.8 5.8 0 0 0 12 3.5z" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  external: (
    <>
      <path d="M14 4.5h5.5V10M19.5 4.5 11 13" />
      <path d="M17 13.5v4.2a1.8 1.8 0 0 1-1.8 1.8H6.3a1.8 1.8 0 0 1-1.8-1.8V8.8A1.8 1.8 0 0 1 6.3 7h4.2" />
    </>
  ),
  heart: <path d="M12 19.5s-7.5-4.4-7.5-9.6a4.1 4.1 0 0 1 7.5-2.3 4.1 4.1 0 0 1 7.5 2.3c0 5.2-7.5 9.6-7.5 9.6z" />,
  comment: <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" />,
  share: (
    <>
      <path d="M8.6 13.4 15.4 17M15.4 7 8.6 10.6" />
      <circle cx="6.5" cy="12" r="2.3" />
      <circle cx="17.5" cy="6" r="2.3" />
      <circle cx="17.5" cy="18" r="2.3" />
    </>
  ),
  clapper: (
    <>
      <rect x="3.8" y="9.2" width="16.4" height="10.6" rx="2" />
      <path d="M3.8 9.2 5.6 4.6h14.6l-1.8 4.6M9.4 4.6l-1.8 4.6M13.6 4.6l-1.8 4.6M17.8 4.6 16 9.2" />
    </>
  ),
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  scissors: (
    <>
      <circle cx="6.5" cy="7" r="2.5" />
      <circle cx="6.5" cy="17" r="2.5" />
      <path d="M8.6 8.4 19.5 17M8.6 15.6 19.5 7" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  /* A project in the rail. Closed for the ones you are not in; open for
     the one you are. Same outline, so switching reads as the folder opening
     rather than as a different thing. */
  folder: <path d="M3.5 7.2a2 2 0 0 1 2-2h3.4a2 2 0 0 1 1.52.7l1.18 1.4h6.9a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  folderOpen: (
    <>
      <path d="M4.6 18.8a1.6 1.6 0 0 1-1.1-1.5V7.2a2 2 0 0 1 2-2h3.4a2 2 0 0 1 1.52.7l1.18 1.4h5.4a2 2 0 0 1 2 2v1.1" />
      <path d="M4.6 18.8h12.1a2 2 0 0 0 1.86-1.28l2.07-5.35a1 1 0 0 0-.93-1.37H8.5a2 2 0 0 0-1.86 1.28z" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
};

export function Icon({ name, size = 14, color, strokeWidth = 1.8, fill = false, style }: { name: IconName; size?: number; color?: string; strokeWidth?: number; fill?: boolean; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      style={{ width: size, height: size, flexShrink: 0, display: "inline-block", verticalAlign: "-0.15em", stroke: color ?? "currentColor", fill: fill ? (color ?? "currentColor") : "none", strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}
