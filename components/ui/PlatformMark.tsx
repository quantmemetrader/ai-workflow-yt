"use client";

/**
 * A platform's own mark, in its own colour.
 *
 * The channel board drew two grey letters ("YO", "LI") in a rounded square,
 * which is what a placeholder looks like, not what a channel looks like. A
 * person scanning eight connected accounts reads the logo before they read
 * anything else.
 *
 * Drawn rather than fetched: a logo loaded from a CDN is a third party
 * watching the studio's admin screens, and these are eight shapes.
 *
 * The paths are the platforms' published marks, used to identify the platform
 * a channel is on — nominative use, not endorsement. Each is drawn in the
 * platform's own brand colour, or in `mono` for a row where colour would be
 * noise.
 */

type Props = {
  platform: string;
  size?: number;
  /** Ink instead of brand colour, for dense rows and disabled states. */
  mono?: boolean;
  title?: string;
};

const BRAND: Record<string, string> = {
  youtube: "#ff0000",
  tiktok: "#000000",
  instagram: "#e1306c",
  linkedin: "#0a66c2",
  facebook: "#1877f2",
  x: "#000000",
  twitter: "#000000",
  threads: "#000000",
  pinterest: "#e60023",
  bilibili: "#00a1d6",
  wechat: "#07c160",
  weibo: "#e6162d",
  douyin: "#000000",
  xiaohongshu: "#ff2442",
  reddit: "#ff4500",
};

export function platformColor(platform: string): string {
  return BRAND[platform.trim().toLowerCase()] ?? "#7c7c7c";
}

export function platformLabel(platform: string): string {
  const names: Record<string, string> = {
    youtube: "YouTube",
    tiktok: "TikTok",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    facebook: "Facebook",
    x: "X",
    twitter: "X",
    threads: "Threads",
    pinterest: "Pinterest",
    bilibili: "Bilibili",
    wechat: "WeChat",
    weibo: "Weibo",
    douyin: "Douyin",
    xiaohongshu: "Xiaohongshu",
    reddit: "Reddit",
  };
  /* The 抖音 billboards (dy_finance, dy_breakout, …) are 抖音's own lists. */
  const key = platform.trim().toLowerCase().replace(/^dy_.*/, "douyin");
  return names[key] ?? platform;
}

export function PlatformMark({ platform, size = 14, mono = false, title }: Props) {
  const key = platform.trim().toLowerCase();
  const fill = mono ? "#7c7c7c" : platformColor(key);
  const path = PATHS[key];

  if (!path) {
    // An unknown platform gets its initials rather than a wrong logo.
    return (
      <span
        title={title ?? platformLabel(platform)}
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size / 3.5),
          background: "#f3f3f3",
          color: "#7c7c7c",
          fontSize: Math.max(7, Math.round(size * 0.45)),
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          letterSpacing: 0,
        }}
      >
        {platform.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={platformLabel(platform)}
      style={{ width: size, height: size, flexShrink: 0, display: "block" }}
    >
      <title>{title ?? platformLabel(platform)}</title>
      {path(fill)}
    </svg>
  );
}

const PATHS: Record<string, (fill: string) => React.JSX.Element> = {
  youtube: (f) => (
    <>
      <path
        fill={f}
        d="M23.5 6.9a3 3 0 0 0-2.1-2.1C19.5 4.3 12 4.3 12 4.3s-7.5 0-9.4.5A3 3 0 0 0 .5 6.9C0 8.8 0 12 0 12s0 3.2.5 5.1a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.1.5-5.1s0-3.2-.5-5.1z"
      />
      <path fill="#fff" d="M9.6 15.6 15.8 12 9.6 8.4z" />
    </>
  ),
  tiktok: (f) => (
    <path
      fill={f}
      d="M16.6 2h-3.1v13.2a2.6 2.6 0 1 1-2-2.5V9.5a5.8 5.8 0 1 0 5.1 5.7V8.9a6.8 6.8 0 0 0 4 1.3V7.1a3.9 3.9 0 0 1-4-4.1z"
    />
  ),
  instagram: (f) => (
    <>
      <rect x="2.2" y="2.2" width="19.6" height="19.6" rx="5.6" fill="none" stroke={f} strokeWidth="2" />
      <circle cx="12" cy="12" r="4.3" fill="none" stroke={f} strokeWidth="2" />
      <circle cx="17.4" cy="6.6" r="1.3" fill={f} />
    </>
  ),
  linkedin: (f) => (
    <>
      <rect x="2" y="2" width="20" height="20" rx="3.2" fill={f} />
      <path
        fill="#fff"
        d="M7.6 9.6H5.1V19h2.5zM6.3 5.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM19 13.4c0-2.6-1.4-3.9-3.3-3.9-1.5 0-2.2.8-2.6 1.4V9.6H10.6V19h2.5v-5.2c0-1.1.7-1.7 1.6-1.7s1.5.6 1.5 1.7V19H19z"
      />
    </>
  ),
  facebook: (f) => (
    <>
      <circle cx="12" cy="12" r="10" fill={f} />
      <path
        fill="#fff"
        d="M13.4 22v-7.6h2.5l.4-2.9h-2.9v-1.9c0-.8.3-1.4 1.5-1.4h1.5V5.6a19 19 0 0 0-2.2-.1c-2.2 0-3.7 1.3-3.7 3.8v2.2H7.9v2.9h2.6V22z"
      />
    </>
  ),
  x: (f) => (
    <path
      fill={f}
      d="M17.9 3h3.3l-7.2 8.3L22.5 21h-6.6l-5.2-6.4L4.8 21H1.5l7.7-8.8L1.8 3h6.8l4.7 5.9zm-1.2 16.1h1.8L7.4 4.8H5.4z"
    />
  ),
  threads: (f) => (
    <path
      fill={f}
      d="M16.5 11.4c-.1 0-.2-.1-.3-.1-.2-3.2-1.9-5-4.8-5-1.7 0-3.2.8-4 2.2l1.6 1.1c.6-1 1.5-1.2 2.4-1.2 1 0 1.8.3 2.3.9.3.4.6 1 .7 1.7a12 12 0 0 0-2.7-.1c-2.7.1-4.5 1.7-4.4 3.9 0 1.1.6 2.1 1.6 2.7.8.5 1.9.8 3 .7 1.5-.1 2.6-.6 3.4-1.7.6-.8.9-1.8 1.1-3.1.8.5 1.4 1.1 1.7 1.9.5 1.3.6 3.4-1.1 5.1-1.5 1.5-3.3 2.1-6.1 2.2-3.1 0-5.4-1-6.9-2.9C2.6 18 2 15.6 2 12s.6-6 1.9-7.7C5.4 2.4 7.7 1.4 10.8 1.4c3.2 0 5.5 1 7 3 .7 1 1.3 2.2 1.6 3.6l1.9-.5c-.4-1.8-1.1-3.3-2-4.5C17.4 .6 14.5-.6 10.8-.6h-.1C7-.6 4 .6 2.2 3 .5 5.2-.3 8.2-.4 12v.1c0 3.8.8 6.8 2.6 9 1.8 2.3 4.8 3.5 8.5 3.5h.1c3.3 0 5.6-.9 7.5-2.8 2.5-2.5 2.4-5.6 1.6-7.5-.6-1.4-1.7-2.5-3.4-3.3zm-4.6 5c-1.2.1-2.5-.5-2.6-1.7-.1-.9.6-1.9 2.7-2h.7c.7 0 1.4.1 2 .2-.2 2.8-1.5 3.4-2.8 3.5z"
    />
  ),
  pinterest: (f) => (
    <path
      fill={f}
      d="M12 2a10 10 0 0 0-3.6 19.3c-.1-.8-.2-2 0-2.9l1.2-5.1s-.3-.6-.3-1.5c0-1.4.8-2.5 1.9-2.5.9 0 1.3.7 1.3 1.5l-.9 3.5c-.2.7.4 1.3 1.1 1.3 1.3 0 2.3-1.4 2.3-3.4 0-1.8-1.3-3-3.1-3-2.1 0-3.3 1.6-3.3 3.2 0 .6.2 1.3.5 1.7l.1.3-.2.8c0 .2-.2.2-.4.1-1-.5-1.7-2-1.7-3.2 0-2.6 1.9-5 5.5-5 2.9 0 5.1 2 5.1 4.8 0 2.9-1.8 5.2-4.3 5.2-.8 0-1.6-.4-1.9-1l-.5 2c-.2.7-.7 1.6-1 2.2A10 10 0 1 0 12 2z"
    />
  ),
  bilibili: (f) => (
    <>
      <rect x="2" y="6" width="20" height="14" rx="4" fill={f} />
      <path stroke={f} strokeWidth="2" strokeLinecap="round" d="m7.5 3 2.6 2.6M16.5 3l-2.6 2.6" />
      <path fill="#fff" d="M8 11h1.6v3.5H8zm6.4 0H16v3.5h-1.6z" />
    </>
  ),
  wechat: (f) => (
    <>
      <path
        fill={f}
        d="M9 3.6C4.9 3.6 1.6 6.4 1.6 9.8c0 1.9 1.1 3.6 2.8 4.8l-.7 2.1 2.4-1.2c.9.2 1.8.4 2.8.4h.6a5.4 5.4 0 0 1-.2-1.5c0-3.2 3.1-5.8 6.9-5.8h.6C16.3 5.7 13 3.6 9 3.6zM6.5 8.3a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm5 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"
      />
      <path
        fill={f}
        d="M22.4 14.4c0-2.8-2.8-5-6.2-5s-6.2 2.2-6.2 5 2.8 5 6.2 5c.8 0 1.5-.1 2.2-.3l2 1-.6-1.7c1.6-.9 2.6-2.4 2.6-4zm-8.2-.9a.85.85 0 1 1 0-1.7.85.85 0 0 1 0 1.7zm4 0a.85.85 0 1 1 0-1.7.85.85 0 0 1 0 1.7z"
      />
    </>
  ),
  weibo: (f) => (
    <>
      <ellipse cx="10.5" cy="15" rx="7.5" ry="5.4" fill={f} />
      <ellipse cx="10.5" cy="15" rx="3.2" ry="2.3" fill="#fff" />
      <path
        fill={f}
        d="M17.6 4.2a5.6 5.6 0 0 1 5 6.1 1 1 0 1 1-2-.2 3.6 3.6 0 0 0-3.2-3.9 1 1 0 0 1 .2-2zm-.4 3.1a2.7 2.7 0 0 1 2.4 3 1 1 0 0 1-2-.2.7.7 0 0 0-.6-.8 1 1 0 1 1 .2-2z"
      />
    </>
  ),
  douyin: (f) => (
    <path
      fill={f}
      d="M16.6 2h-3.1v13.2a2.6 2.6 0 1 1-2-2.5V9.5a5.8 5.8 0 1 0 5.1 5.7V8.9a6.8 6.8 0 0 0 4 1.3V7.1a3.9 3.9 0 0 1-4-4.1z"
    />
  ),
  xiaohongshu: (f) => (
    <>
      <rect x="2" y="4" width="20" height="16" rx="4" fill={f} />
      <path
        fill="#fff"
        d="M6.4 9h1.4v6H6.4zm2.6 0h1.4l1.4 3.2V9h1.3v6h-1.3L10.4 12v3H9zm6.1 0h3.4v1.3h-2.1v1.1h1.9v1.3h-1.9v1h2.2V15h-3.5z"
      />
    </>
  ),
  reddit: (f) => (
    <>
      <circle cx="12" cy="12" r="10" fill={f} />
      <ellipse cx="12" cy="13.6" rx="6.4" ry="4.4" fill="#fff" />
      <circle cx="9.6" cy="13.2" r="1.1" fill={f} />
      <circle cx="14.4" cy="13.2" r="1.1" fill={f} />
      <path
        stroke={f}
        strokeWidth="1.1"
        strokeLinecap="round"
        fill="none"
        d="M9.8 16.2c1.3.9 3.1.9 4.4 0"
      />
    </>
  ),
};

PATHS.twitter = PATHS.x;
