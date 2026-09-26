import type { AgentKey } from "@/lib/agents/catalog";

/**
 * The AI employees as little robots, each on its own colour circle and each
 * carrying the tool of its job — the look the owner picked from a Dribbble
 * shot ("bot avatars bit more like this vibe"): bold flat shapes, a black
 * visor, glowing eyes, one big prop, the body cut off by the circle.
 *
 *   研究员  blue    magnifying glass over a chart on its chest
 *   策划    lime    lightbulb antenna, clipboard with ticks
 *   编剧    orange  a typewriter head with the page coming out of it
 *   剪辑师  teal    headphones and a clapperboard
 *   撰稿人  pink    a pen-nib antenna and a newspaper
 *   助理    violet  a round white bot with a headset, smiling
 *
 * Drawn on a 96 box so the shapes stay chunky at 18px, where the circle's
 * colour and the silhouette do the work. Ids are per key, so six different
 * bots can share a page; the same bot twice defines the same clip twice,
 * which draws the same.
 */
export type BotKey = AgentKey | "host";

const K = "#0b0b0b";

const BG: Record<BotKey, string> = {
  research: "#1f6bff",
  planning: "#b4ee12",
  script: "#ff6a1a",
  video: "#11c4a6",
  article: "#ff2e7e",
  host: "#6d5dfc",
};

const BODY: Record<BotKey, string> = {
  research: `
    <rect x="21" y="72" width="54" height="40" rx="12" fill="#eef1f5"/>
    <path d="M60 72h3a12 12 0 0 1 12 12v28H60z" fill="#cfd6e0"/>
    <rect x="41" y="61" width="14" height="13" fill="#8e98a8"/>
    <rect x="26" y="25" width="44" height="39" rx="13" fill="#eef1f5"/>
    <path d="M58 25a13 13 0 0 1 12 13v13a13 13 0 0 1-12 13z" fill="#cfd6e0"/>
    <rect x="19" y="37" width="8" height="16" rx="4" fill="#ffae1f"/>
    <rect x="69" y="37" width="8" height="16" rx="4" fill="#ffae1f"/>
    <rect x="31" y="35" width="34" height="20" rx="9" fill="${K}"/>
    <rect x="37" y="41" width="8" height="7" rx="3.5" fill="#3dffb4"/>
    <rect x="51" y="41" width="8" height="7" rx="3.5" fill="#3dffb4"/>
    <rect x="30" y="80" width="26" height="17" rx="4" fill="${K}"/>
    <path d="M34 93l6-6 5 3 7-7" fill="none" stroke="#3dffb4" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M73 76l12 12" stroke="${K}" stroke-width="8" stroke-linecap="round"/>
    <circle cx="64" cy="67" r="13" fill="#bfe8ff" fill-opacity=".55" stroke="#ffd21f" stroke-width="5.5"/>
    <path d="M57 62a8 8 0 0 1 7-4" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>`,
  planning: `
    <rect x="21" y="72" width="54" height="40" rx="12" fill="#7a3cff"/>
    <path d="M60 72h3a12 12 0 0 1 12 12v28H60z" fill="#5b25db"/>
    <rect x="41" y="61" width="14" height="13" fill="#3b1a91"/>
    <path d="M48 17v14" stroke="${K}" stroke-width="3.5"/>
    <rect x="43" y="17" width="10" height="6" rx="2" fill="#9aa3b2"/>
    <circle cx="48" cy="11" r="8.5" fill="#ffd400"/>
    <path d="M45 8.5a4 4 0 0 1 3-2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
    <path d="M36 6l-4-3M60 6l4-3M35 13h-5M61 13h5" stroke="${K}" stroke-width="2.6" stroke-linecap="round"/>
    <rect x="25" y="29" width="46" height="35" rx="15" fill="#7a3cff"/>
    <path d="M58 29a15 15 0 0 1 13 15v5a15 15 0 0 1-13 15z" fill="#5b25db"/>
    <rect x="31" y="37" width="34" height="19" rx="9" fill="${K}"/>
    <rect x="37" y="42" width="8" height="8" rx="4" fill="#ffe14d"/>
    <rect x="51" y="42" width="8" height="8" rx="4" fill="#ffe14d"/>
    <rect x="29" y="73" width="38" height="34" rx="4" fill="#ffffff"/>
    <rect x="39" y="69" width="18" height="8" rx="2.5" fill="${K}"/>
    <path d="M35 84l3.5 3.5 6-6M35 96l3.5 3.5 6-6" fill="none" stroke="#7a3cff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M49 85h12M49 97h9" stroke="#d4d4d4" stroke-width="3" stroke-linecap="round"/>`,
  script: `
    <rect x="21" y="72" width="54" height="40" rx="12" fill="#ffc21f"/>
    <path d="M60 72h3a12 12 0 0 1 12 12v28H60z" fill="#e89a00"/>
    <rect x="41" y="61" width="14" height="13" fill="#b86f00"/>
    <path d="M33 8h30v28H33z" fill="#ffffff"/>
    <path d="M63 8c3 0 5 2 5 5h-5z" fill="#d9d9d9"/>
    <path d="M38 15h18M38 21h20M38 27h13" stroke="#9a9a9a" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="23" y="30" width="50" height="33" rx="9" fill="#ffc21f"/>
    <path d="M60 30h4a9 9 0 0 1 9 9v15a9 9 0 0 1-9 9h-4z" fill="#e89a00"/>
    <rect x="23" y="30" width="50" height="7" rx="3.5" fill="#e89a00"/>
    <circle cx="19" cy="47" r="6.5" fill="#5b2a17"/>
    <circle cx="77" cy="47" r="6.5" fill="#5b2a17"/>
    <circle cx="78" cy="47" r="3" fill="#ffd84d"/>
    <rect x="31" y="40" width="34" height="14" rx="6" fill="${K}"/>
    <rect x="37" y="44" width="8" height="6" rx="3" fill="#3dffb4"/>
    <rect x="51" y="44" width="8" height="6" rx="3" fill="#3dffb4"/>
    <rect x="40" y="57" width="16" height="3" rx="1.5" fill="${K}"/>
    <rect x="28" y="80" width="40" height="16" rx="4" fill="${K}"/>
    <path d="M33 85h3M40 85h3M47 85h3M54 85h3M61 85h2M35 91h26" stroke="#3dffb4" stroke-width="2.4" stroke-linecap="round"/>`,
  video: `
    <rect x="21" y="72" width="54" height="40" rx="12" fill="#2d323b"/>
    <path d="M60 72h3a12 12 0 0 1 12 12v28H60z" fill="#1d2127"/>
    <rect x="41" y="61" width="14" height="13" fill="#15181d"/>
    <rect x="27" y="27" width="42" height="37" rx="13" fill="#2d323b"/>
    <rect x="32" y="35" width="32" height="21" rx="8" fill="${K}"/>
    <rect x="37" y="41" width="8" height="8" rx="4" fill="#c8ff3d"/>
    <rect x="51" y="41" width="8" height="8" rx="4" fill="#c8ff3d"/>
    <path d="M24 46c0-30 48-30 48 0" fill="none" stroke="#ff3d8b" stroke-width="6.5" stroke-linecap="round"/>
    <rect x="16" y="37" width="13" height="20" rx="6" fill="#ff3d8b"/>
    <rect x="67" y="37" width="13" height="20" rx="6" fill="#ff3d8b"/>
    <rect x="19" y="41" width="4" height="12" rx="2" fill="#ffffff" fill-opacity=".55"/>
    <rect x="42" y="80" width="38" height="24" rx="3" fill="${K}"/>
    <g transform="rotate(-12 42 80)">
      <rect x="42" y="71" width="38" height="8" rx="1.5" fill="#ffffff"/>
      <path d="M48 71l-5 8M57 71l-5 8M66 71l-5 8M75 71l-5 8" stroke="${K}" stroke-width="4"/>
    </g>
    <path d="M48 89h26M48 96h16" stroke="#ffffff" stroke-opacity=".35" stroke-width="2.4" stroke-linecap="round"/>`,
  article: `
    <rect x="21" y="72" width="54" height="40" rx="12" fill="#fff4e3"/>
    <path d="M60 72h3a12 12 0 0 1 12 12v28H60z" fill="#efd7b4"/>
    <rect x="41" y="61" width="14" height="13" fill="#caa678"/>
    <path d="M48 30V19" stroke="${K}" stroke-width="3.5"/>
    <path d="M48 3l7 10-7 9-7-9z" fill="${K}"/>
    <path d="M48 12v7" stroke="#ff2e7e" stroke-width="2"/>
    <circle cx="48" cy="11" r="1.8" fill="#ff2e7e"/>
    <rect x="25" y="29" width="46" height="35" rx="14" fill="#fff4e3"/>
    <path d="M58 29a14 14 0 0 1 13 14v7a14 14 0 0 1-13 14z" fill="#efd7b4"/>
    <rect x="31" y="37" width="34" height="19" rx="9" fill="${K}"/>
    <rect x="37" y="42" width="8" height="8" rx="4" fill="#29d8ff"/>
    <rect x="51" y="42" width="8" height="8" rx="4" fill="#29d8ff"/>
    <g transform="rotate(-6 48 90)">
      <rect x="25" y="73" width="46" height="34" rx="2" fill="#ffffff"/>
      <rect x="29" y="77" width="38" height="6" fill="${K}"/>
      <rect x="29" y="87" width="15" height="12" fill="#29d8ff"/>
      <path d="M48 88h19M48 93h19M48 98h13" stroke="#b8b8b8" stroke-width="2.4" stroke-linecap="round"/>
    </g>`,
  host: `
    <rect x="21" y="72" width="54" height="40" rx="16" fill="#ffffff"/>
    <path d="M60 72h-1a16 16 0 0 1 16 16v24H60z" fill="#d9dce8"/>
    <rect x="41" y="61" width="14" height="13" fill="#b9bdcc"/>
    <circle cx="40" cy="86" r="2.6" fill="${K}"/>
    <circle cx="48" cy="86" r="2.6" fill="#3de0ff"/>
    <circle cx="56" cy="86" r="2.6" fill="${K}"/>
    <rect x="24" y="26" width="48" height="38" rx="19" fill="#ffffff"/>
    <path d="M56 26a19 19 0 0 1 16 19v0a19 19 0 0 1-16 19z" fill="#d9dce8"/>
    <rect x="30" y="34" width="36" height="22" rx="11" fill="${K}"/>
    <path d="M37 47q4.5-6 9 0M50 47q4.5-6 9 0" fill="none" stroke="#3de0ff" stroke-width="3" stroke-linecap="round"/>
    <path d="M44 51q4 3.5 8 0" fill="none" stroke="#3de0ff" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M22 44c0-27 52-27 52 0" fill="none" stroke="${K}" stroke-width="4" stroke-linecap="round"/>
    <rect x="16" y="38" width="10" height="16" rx="5" fill="#ffc21f"/>
    <rect x="70" y="38" width="10" height="16" rx="5" fill="#ffc21f"/>
    <path d="M75 53q0 11-14 11" fill="none" stroke="${K}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="59" cy="64" r="3.4" fill="${K}"/>`,
};

export const BOT_BG = BG;

/** The inner drawing (circle, clip and bot) for a 96 box. */
export function botMarkup(key: BotKey): string {
  const id = `tgbot-${key}`;
  return `<defs><clipPath id="${id}"><circle cx="48" cy="48" r="48"/></clipPath></defs><g clip-path="url(#${id})"><rect width="96" height="96" fill="${BG[key]}"/>${BODY[key]}</g>`;
}

/** A whole SVG file, for the avatar route and anywhere an <img> is needed. */
export function botSvg(key: BotKey): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">${botMarkup(key)}</svg>`;
}
