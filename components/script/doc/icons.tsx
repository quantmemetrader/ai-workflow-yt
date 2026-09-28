import * as React from "react";

/**
 * The Docs-style line icons of the script page, drawn here (the shared
 * `components/ui/Icon.tsx` set has none of these). 24px grid, current colour.
 */
const P: Record<string, React.ReactNode> = {
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5" /></>,
  undo: <path d="M9 7L4 12l5 5M4.5 12H15a5 5 0 0 1 0 10h-2" transform="translate(0 -3)" />,
  redo: <path d="M15 7l5 5-5 5M19.5 12H9a5 5 0 0 0 0 10h2" transform="translate(0 -3)" />,
  print: <><path d="M7 8V3.5h10V8" /><rect x="3.5" y="8" width="17" height="8.5" rx="2" /><path d="M7 14h10v6.5H7z" /></>,
  color: <><path d="M6.5 17L12 4l5.5 13M8.4 12.5h7.2" /></>,
  marker: <><path d="M14.5 4.5l5 5-8.5 8.5H6v-5z" /><path d="M4 20.5h16" /></>,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></>,
  comment: <><path d="M4 5.5h16v11H9l-5 4z" /><path d="M12 8.5v5M9.5 11h5" /></>,
  comments: <><path d="M4 5.5h16v11H9l-5 4z" /><path d="M8 9.5h8M8 12.5h5" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M20.5 16l-5-5-8.5 8.5" /></>,
  alignLeft: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  alignCenter: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  alignRight: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  alignJustify: <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />,
  spacing: <><path d="M10 6h10M10 12h10M10 18h10" /><path d="M5 4.5v15M3 7l2-2.5L7 7M3 17l2 2.5 2-2.5" /></>,
  checklist: <><path d="M4 7l1.8 1.8L9 5.5M4 15l1.8 1.8L9 13.5" /><path d="M12 7.5h8M12 15.5h8" /></>,
  bullets: <><circle cx="5" cy="7" r="1.3" fill="currentColor" stroke="none" /><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="5" cy="17" r="1.3" fill="currentColor" stroke="none" /><path d="M9 7h11M9 12h11M9 17h11" /></>,
  numbers: <><path d="M4 5.5h1.5v4M4 9.5h3M4 14.2c.3-.8 2.8-.9 2.8.6 0 1-2.8 1.8-2.8 3.2h3" /><path d="M10 7h10M10 12h10M10 17h10" /></>,
  outdent: <path d="M4 5h16M11 10h9M11 14h9M4 19h16M8 9.5L5 12l3 2.5" />,
  indent: <path d="M4 5h16M11 10h9M11 14h9M4 19h16M5 9.5L8 12l-3 2.5" />,
  clear: <><path d="M6 5h12M12 5l-3 14M15.5 15.5l4.5 4.5M20 15.5l-4.5 4.5" /></>,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  suggest: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M16.5 17.5h4M18.5 15.5v4" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  chevron: <path d="M7 10l5 5 5-5" />,
  chevronRight: <path d="M10 7l5 5-5 5" />,
  left: <path d="M19 12H5M11 6l-6 6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  sparkle: <path d="M12 3c.6 4.9 3.1 7.4 8 8-4.9.6-7.4 3.1-8 8-.6-4.9-3.1-7.4-8-8 4.9-.6 7.4-3.1 8-8z" />,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5v4h4" /><path d="M12 8v4.5l3 2" /></>,
  cloud: <><path d="M7 18.5h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 11a3.8 3.8 0 0 0 1 7.5z" /><path d="M9.5 14l1.8 1.8 3.5-3.5" /></>,
  upload: <><path d="M12 16V4.5M7 9l5-5 5 5" /><path d="M4.5 16.5v3h15v-3" /></>,
  download: <><path d="M12 4v11.5M7 10.5l5 5 5-5" /><path d="M4.5 16.5v3h15v-3" /></>,
  paperclip: <path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-2.8-2.8l7.5-7.5" />,
  more: <><circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" /></>,
  up: <path d="M7 14l5-5 5 5" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  rule: <path d="M3 15.5L15.5 3l5.5 5.5L8.5 21zM7 11.5l2 2M10 8.5l2 2M13 5.5l2 2" />,
  outline: <path d="M4 6h16M8 11h12M8 16h12M4 11h.01M4 16h.01" />,
  focus: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  hr: <path d="M3 12h18" />,
  film: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M7.5 5v14M16.5 5v14M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4" /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10" /></>,
  count: <path d="M5 6h14M5 10h14M5 14h9M5 18h6" />,
};

export function GI({ name, size = 18, style }: { name: string; size?: number; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block", flexShrink: 0, ...style }}>
      {P[name] ?? null}
    </svg>
  );
}

/** The Docs-blue document glyph at the top left. */
export function DocGlyph({ size = 36 }: { size?: number }) {
  return (
    <svg viewBox="0 0 36 48" width={size * 0.75} height={size} aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <path d="M4 0h19l13 13v31a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill="#4285f4" />
      <path d="M23 0l13 13H27a4 4 0 0 1-4-4z" fill="#a1c2fa" />
      <path d="M9 23h18M9 29h18M9 35h12" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
