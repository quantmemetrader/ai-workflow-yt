import type { AgentKey } from "@/lib/agents/catalog";

/**
 * The AI employees as little robots, each on its own colour circle and each
 * carrying the tool of its job — the look the owner picked from a Dribbble
 * shot ("bot avatars bit more like this vibe"): bold flat shapes, a black
 * visor, glowing eyes, one big prop, the body cut off by the circle.
 *
 *   研究员  blue    a magnifying glass with a face, beside a rising chart
 *   策划    lime    a lit lightbulb head over a ticked clipboard
 *   编剧    orange  a typewriter, the page standing out of the roller
 *   剪辑师  teal    a film camera: two reels, one big lens eye, a tripod
 *   撰稿人  pink    a newspaper page with a face, a fountain pen across it
 *   助理    violet  a speech bubble wearing a headset
 *
 * The first version put the same helmet on all six with different props;
 * the owner: "they all look the same — they should look like the task they
 * do". Now the job object is the character, so each has its own silhouette.
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
  /* A magnifying glass that is the face: dark glass with the eyes in it, a
     thick gold rim, the handle down to the right; a rising chart beside it. */
  research: `
    <rect x="12" y="80" width="8" height="22" rx="2" fill="#ffffff"/>
    <rect x="23" y="73" width="8" height="29" rx="2" fill="#ffffff"/>
    <rect x="34" y="78" width="8" height="24" rx="2" fill="#bfe8ff"/>
    <path d="M60 58l20 24" stroke="${K}" stroke-width="12" stroke-linecap="round"/>
    <path d="M58 55l7 8" stroke="#ffd21f" stroke-width="13" stroke-linecap="butt"/>
    <circle cx="42" cy="38" r="25" fill="${K}" stroke="#ffd21f" stroke-width="8"/>
    <rect x="30" y="34" width="9" height="10" rx="4.5" fill="#3dffb4"/>
    <rect x="46" y="34" width="9" height="10" rx="4.5" fill="#3dffb4"/>
    <path d="M26 30a17 17 0 0 1 12-11" fill="none" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round" stroke-opacity=".85"/>`,
  /* A lightbulb head, lit: eyes and a smile on the glass, the screw base as
     its neck, rays around it, a clipboard of ticked-off steps below. */
  planning: `
    <path d="M18 14l-6-5M78 14l6-5M11 34H4M85 34h7M48 4V0" stroke="${K}" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M48 10a24 24 0 0 1 14 43.5V60H34v-6.5A24 24 0 0 1 48 10z" fill="#ffd400"/>
    <path d="M60 14a24 24 0 0 1 2 39.5V60h-6V16z" fill="#f2b300"/>
    <rect x="37" y="30" width="7" height="10" rx="3.5" fill="${K}"/>
    <rect x="52" y="30" width="7" height="10" rx="3.5" fill="${K}"/>
    <circle cx="42" cy="32.5" r="1.6" fill="#ffffff"/>
    <circle cx="57" cy="32.5" r="1.6" fill="#ffffff"/>
    <path d="M42 46q6 5 12 0" fill="none" stroke="${K}" stroke-width="2.8" stroke-linecap="round"/>
    <rect x="34" y="60" width="28" height="5" rx="2" fill="#8e98a8"/>
    <rect x="35" y="65" width="26" height="5" rx="2" fill="#6b7585"/>
    <rect x="37" y="70" width="22" height="5" rx="2" fill="#8e98a8"/>
    <rect x="18" y="78" width="60" height="30" rx="6" fill="#7a3cff"/>
    <rect x="26" y="81" width="44" height="26" rx="3" fill="#ffffff"/>
    <rect x="39" y="77" width="18" height="7" rx="2.5" fill="${K}"/>
    <path d="M31 92l3.5 3.5 6-6" fill="none" stroke="#7a3cff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M45 93h19" stroke="#d4d4d4" stroke-width="3" stroke-linecap="round"/>`,
  /* A typewriter: the page standing tall out of the roller, the face in the
     body's window, two rows of keys. */
  script: `
    <path d="M30 4h36v34H30z" fill="#ffffff"/>
    <path d="M36 12h24M36 19h24M36 26h16" stroke="#9a9a9a" stroke-width="2.6" stroke-linecap="round"/>
    <rect x="14" y="32" width="68" height="11" rx="5.5" fill="${K}"/>
    <circle cx="12" cy="37.5" r="6" fill="#ffd84d"/>
    <circle cx="84" cy="37.5" r="6" fill="#ffd84d"/>
    <path d="M22 43h52l8 50H14z" fill="#243154"/>
    <path d="M62 43h12l8 50H66z" fill="#18213b"/>
    <rect x="27" y="49" width="42" height="13" rx="6.5" fill="${K}"/>
    <rect x="35" y="52" width="8" height="7" rx="3.5" fill="#ffd84d"/>
    <rect x="53" y="52" width="8" height="7" rx="3.5" fill="#ffd84d"/>
    <circle cx="28" cy="72" r="3.4" fill="#fff2c7"/><circle cx="38" cy="72" r="3.4" fill="#fff2c7"/><circle cx="48" cy="72" r="3.4" fill="#fff2c7"/><circle cx="58" cy="72" r="3.4" fill="#fff2c7"/><circle cx="68" cy="72" r="3.4" fill="#fff2c7"/>
    <circle cx="25" cy="82" r="3.4" fill="#fff2c7"/><circle cx="35" cy="82" r="3.4" fill="#fff2c7"/><circle cx="45" cy="82" r="3.4" fill="#fff2c7"/><circle cx="55" cy="82" r="3.4" fill="#fff2c7"/><circle cx="65" cy="82" r="3.4" fill="#fff2c7"/><circle cx="72" cy="82" r="3.4" fill="#fff2c7"/>`,
  /* A film camera: two reels on top, one big lens for an eye, on a tripod. */
  video: `
    <circle cx="33" cy="22" r="13" fill="${K}"/>
    <circle cx="63" cy="20" r="15" fill="${K}"/>
    <circle cx="33" cy="22" r="3" fill="#11c4a6"/><circle cx="33" cy="14" r="2.6" fill="#3a404b"/><circle cx="26" cy="25" r="2.6" fill="#3a404b"/><circle cx="40" cy="25" r="2.6" fill="#3a404b"/>
    <circle cx="63" cy="20" r="3.4" fill="#11c4a6"/><circle cx="63" cy="11" r="3" fill="#3a404b"/><circle cx="55" cy="24" r="3" fill="#3a404b"/><circle cx="71" cy="24" r="3" fill="#3a404b"/>
    <path d="M48 76L30 104M48 76l18 28M48 76v28" stroke="${K}" stroke-width="4.5" stroke-linecap="round"/>
    <rect x="18" y="36" width="60" height="42" rx="9" fill="#ff3d8b"/>
    <path d="M64 36h5a9 9 0 0 1 9 9v24a9 9 0 0 1-9 9h-5z" fill="#e0206f"/>
    <circle cx="70" cy="44" r="3" fill="#fff36b"/>
    <circle cx="46" cy="57" r="16" fill="#2d323b"/>
    <circle cx="46" cy="57" r="11" fill="${K}"/>
    <circle cx="46" cy="57" r="6" fill="#c8ff3d"/>
    <circle cx="43.5" cy="54.5" r="2" fill="#ffffff"/>`,
  /* A newspaper page with a face in the headline story, a fountain pen
     across it. */
  article: `
    <g transform="rotate(-7 48 46)">
      <rect x="22" y="12" width="52" height="66" rx="3" fill="#ffffff"/>
      <path d="M62 12h9a3 3 0 0 1 3 3v60a3 3 0 0 1-3 3h-9z" fill="#e9e9e9"/>
      <rect x="27" y="17" width="42" height="9" rx="1" fill="${K}"/>
      <rect x="34" y="34" width="8" height="11" rx="4" fill="${K}"/>
      <rect x="52" y="34" width="8" height="11" rx="4" fill="${K}"/>
      <circle cx="38.5" cy="37" r="1.6" fill="#ffffff"/>
      <circle cx="56.5" cy="37" r="1.6" fill="#ffffff"/>
      <path d="M42 50q5 4 10 0" fill="none" stroke="${K}" stroke-width="2.6" stroke-linecap="round"/>
      <rect x="27" y="57" width="18" height="15" fill="#29d8ff"/>
      <path d="M50 59h19M50 65h19M50 71h13" stroke="#b8b8b8" stroke-width="2.6" stroke-linecap="round"/>
    </g>
    <path d="M60 102l22-34" stroke="#243154" stroke-width="10" stroke-linecap="round"/>
    <path d="M73 82l6-9" stroke="#ffd21f" stroke-width="10.5"/>
    <path d="M83 58l4 8-8 3z" fill="${K}"/>`,
  /* A speech bubble with a headset: the one you talk to. */
  host: `
    <path d="M28 58l-8 20 24-18z" fill="#ffffff"/>
    <rect x="16" y="18" width="64" height="46" rx="21" fill="#ffffff"/>
    <path d="M60 18a21 21 0 0 1 20 21v4a21 21 0 0 1-20 21z" fill="#dcdcf0"/>
    <rect x="27" y="28" width="42" height="26" rx="13" fill="${K}"/>
    <path d="M35 43q4.5-6 9 0M52 43q4.5-6 9 0" fill="none" stroke="#3de0ff" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M43 48q5 4 10 0" fill="none" stroke="#3de0ff" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M12 40c0-34 72-34 72 0" fill="none" stroke="${K}" stroke-width="4.5" stroke-linecap="round"/>
    <rect x="6" y="33" width="11" height="18" rx="5.5" fill="#ffc21f"/>
    <rect x="79" y="33" width="11" height="18" rx="5.5" fill="#ffc21f"/>
    <path d="M85 51q0 20-22 20" fill="none" stroke="${K}" stroke-width="3.4" stroke-linecap="round"/>
    <circle cx="61" cy="71" r="4" fill="${K}"/>
    <circle cx="40" cy="86" r="4" fill="#ffc21f"/><circle cx="52" cy="86" r="4" fill="#ffffff"/><circle cx="64" cy="86" r="4" fill="#ffc21f"/>`,
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
