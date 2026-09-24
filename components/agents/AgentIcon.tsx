import * as React from "react";
import { AGENT_COLORS, type AgentKey } from "@/lib/agents/catalog";

/**
 * One drawn mark per AI employee, in that employee's colour.
 *
 * The five used to share one black cube, so a thread of three of them
 * talking read as one person changing their mind. Each is a glyph for the
 * job — a lens with a rising line, a clipboard, a pen, a clapperboard, a
 * page — on a square of the colour that follows that employee everywhere
 * else (the stage strip, the flow, the pills). No agent given draws the
 * team's own mark.
 */
const GLYPH: Record<AgentKey, React.ReactNode> = {
  research: (
    <>
      <circle cx="10.6" cy="10.6" r="6.2" />
      <path d="m15.3 15.3 4.6 4.6" />
      <path d="m7.6 12.4 2-2.3 1.8 1.5 2.6-3.1" />
    </>
  ),
  planning: (
    <>
      <rect x="5" y="5" width="14" height="15.5" rx="2.4" />
      <path d="M9 5V3.6h6V5" />
      <path d="m8.6 11.6 1.7 1.7 3.1-3.3" />
      <path d="M8.6 16.6h6.8" />
    </>
  ),
  script: (
    <>
      <path d="M14.2 5.6 18.4 9.8 9.2 19H5v-4.2z" />
      <path d="m12 7.8 4.2 4.2" />
      <path d="M13 20h6" />
    </>
  ),
  video: (
    <>
      <rect x="3.8" y="9.2" width="16.4" height="10.6" rx="2" />
      <path d="M3.8 9.2 5.6 4.6h14.6l-1.8 4.6" />
      <path d="m9.4 4.6-1.8 4.6M13.6 4.6l-1.8 4.6M17.8 4.6 16 9.2" />
    </>
  ),
  article: (
    <>
      <rect x="4.6" y="4.4" width="14.8" height="15.2" rx="2.4" />
      <path d="M8.2 9h7.6M8.2 12.6h7.6M8.2 16.2h4.6" />
    </>
  ),
};

const TEAM = (
  <>
    <path d="M12 4.2 19 8v8l-7 3.8L5 16V8z" />
    <path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8" />
  </>
);

export function AgentIcon({
  agent,
  size = 36,
  radius = 10,
  title,
}: {
  agent?: AgentKey | null;
  size?: number;
  radius?: number;
  title?: string;
}) {
  const color = agent ? AGENT_COLORS[agent] : "#171717";
  return (
    <div
      role={title ? "img" : undefined}
      aria-label={title}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        style={{
          width: Math.round(size * 0.58),
          height: Math.round(size * 0.58),
          stroke: "#fff",
          fill: "none",
          strokeWidth: size <= 16 ? 2.1 : 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }}
      >
        {agent ? GLYPH[agent] : TEAM}
      </svg>
    </div>
  );
}
