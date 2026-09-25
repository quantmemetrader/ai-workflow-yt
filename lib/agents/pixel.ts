/**
 * Pixel faces for the AI employees (and the host's own assistant).
 *
 * The studio asked for "pixel style pfp for the agents in chat". Each face is a
 * 16x16 sprite written out as a grid of colour letters, drawn as inline SVG with
 * crisp edges: no image files, no emoji, nothing fetched. Every employee keeps
 * the colour it has everywhere else (its tint behind, its colour on the shirt)
 * and carries one thing that says the job: the researcher's glasses and lens,
 * the planner's clipboard, the writer's beret and pen, the editor's headphones,
 * the article writer's quill. The host's assistant is a small robot.
 *
 * Pure data and string building, so it runs on the server and in the browser.
 */
import { AGENT_COLORS, AGENT_TINTS, type AgentKey } from "@/lib/agents/catalog";

export type SpriteKey = AgentKey | "host";

/** Colour letters shared by every sprite; "." is transparent. */
const SHARED: Record<string, string> = {"k": "#1f1f24", "s": "#f6cfae", "S": "#e2a882", "w": "#ffffff", "m": "#c2573f", "l": "#e3f1ff", "y": "#e8ad2c", "b": "#8a5a33", "p": "#fbfaf5", "g": "#9aa3ad"};

/** Hair colour per face. */
const HAIR: Record<SpriteKey, string> = {
  research: "#3a2a22",
  planning: "#2a2340",
  script: "#5a2c14",
  video: "#1b1b1b",
  article: "#4a2433",
  host: "#171717",
};

const GRIDS: Record<SpriteKey, string[]> = {
  research: [
    "................",
    "....kkkkkkkk....",
    "...khhhhhhhhk...",
    "..khhhhhhhhhhk..",
    "..khhhhhhhhhhk..",
    "..khsssssssshk..",
    "..kskkksskkksk..",
    "..kskwkkkkwksk..",
    "..kskkksskkksk..",
    "..kssssmmssssk..",
    "...kssssssssk...",
    "....kkkSSkkkkk..",
    "..kkcccwwcckllk.",
    ".kcccccwwcckllk.",
    ".kcccccwwccckkkb",
    ".kcccccwwccccckb",
  ],
  planning: [
    "......kkkk......",
    "....kkhhhhkk....",
    "...khhhhhhhhk...",
    "..khhhhhhhhhhk..",
    "..khhhhhhhhhhk..",
    "..khhsssssshhk..",
    "..kssssssssssk..",
    "..kssksssskssk..",
    "..kssssssssssk..",
    "..kssssmmssssk..",
    "kyykssssssssk...",
    "kpppkkkSSkkk....",
    "kpcpkccwwccckk..",
    "kpppkccwwccccck.",
    "kpcpkccwwccccck.",
    "kkkkkccwwccccck.",
  ],
  script: [
    "........k.......",
    "....kkkkkkkkk...",
    "...kcccccccccck.",
    "..kcccccccccccck",
    "..kkkkkkkkkkkkk.",
    "..khsssssssshk..",
    "..kssssssssssk..",
    "..kssksssskssk..",
    "..kssssssssssk.k",
    "..kssssmmssssky.",
    "...ksssssssskyk.",
    "....kkkSSkkkyk..",
    "..kkcccwwcckyk..",
    ".kcccccwwcckcck.",
    ".kcccccwwccccck.",
    ".kcccccwwccccck.",
  ],
  video: [
    "...kkkkkkkkkk...",
    "..kggggggggggk..",
    ".kgkkkkkkkkkkgk.",
    ".kgkhhhhhhhhkgk.",
    ".kgkhhhhhhhhkgk.",
    "kcckhsssssshkcck",
    "kccksssssssskcck",
    "kccksskssksskcck",
    "kccksssssssskcck",
    "kkkksssmmssskkkk",
    "...kssssssssk...",
    "....kkkSSkkk....",
    "..kkcccwwccckk..",
    ".kcccccwwccccck.",
    ".kcccccwwccccck.",
    ".kcccccwwccccck.",
  ],
  article: [
    "...............k",
    "....kkkkkkkk..kw",
    "...khhhhhhhhkkwk",
    "..khhhhhhhhhhkwk",
    "..khhhhhhhhhhkwk",
    "..khhsssssshhkk.",
    "..khsssssssshk..",
    "..khskssssksshk.",
    "..khsssssssshk..",
    "..khsssmmssshk..",
    "..khksssssskhk..",
    "..khhkkSSkkhhk..",
    "..khkccwwcckhk..",
    ".khhcccwwccchhk.",
    ".kcccccwwccccck.",
    ".kcccccwwccccck.",
  ],
  host: [
    ".......kk.......",
    ".......kk.......",
    "...kkkkkkkkkk...",
    "..kggggggggggk..",
    "..kgkkkkkkkkgk..",
    "..kgkwwkkwwkgk..",
    "..kgkwwkkwwkgk..",
    "..kgkkkkkkkkgk..",
    "..kggggggggggk..",
    "..kggggkkggggk..",
    "...kkkkkkkkkk...",
    ".....kkggkk.....",
    "..kkkkkkkkkkkk..",
    "..kggggyyggggk..",
    ".kgggggyygggggk.",
    ".kggggggggggggk.",
  ],
};

/** The tile colour behind a face. */
export function spriteTint(key: SpriteKey): string {
  return key === "host" ? "#ededed" : AGENT_TINTS[key];
}

function colourOf(key: SpriteKey, ch: string): string | null {
  if (ch === ".") return null;
  if (ch === "c") return key === "host" ? "#171717" : AGENT_COLORS[key];
  if (ch === "t") return spriteTint(key);
  if (ch === "h") return HAIR[key];
  return SHARED[ch] ?? null;
}

const cache = new Map<SpriteKey, { fill: string; d: string }[]>();

/**
 * One <path> per colour, each row's runs merged into rectangles, so a face is
 * a handful of paths rather than a couple of hundred rects. Cached per face.
 */
export function spritePaths(key: SpriteKey): { fill: string; d: string }[] {
  const hit = cache.get(key);
  if (hit) return hit;
  const byColour = new Map<string, string[]>();
  GRIDS[key].forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      const fill = colourOf(key, ch);
      if (fill) {
        const list = byColour.get(fill) ?? [];
        list.push(`M${x} ${y}h${w}v1h-${w}z`);
        byColour.set(fill, list);
      }
      x += w;
    }
  });
  const out = [...byColour.entries()].map(([fill, parts]) => ({ fill, d: parts.join("") }));
  cache.set(key, out);
  return out;
}

/** The face as a standalone SVG document, for an <img> or a file route. */
export function spriteSvg(key: SpriteKey, withTile = true): string {
  const tile = withTile ? `<rect width="16" height="16" fill="${spriteTint(key)}"/>` : "";
  const paths = spritePaths(key).map((p) => `<path fill="${p.fill}" d="${p.d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${tile}${paths}</svg>`;
}

/**
 * How big to draw a 16px face inside a tile of `size` px: whole or half steps
 * only, so pixels stay square (crisp on 2x screens at the half steps).
 */
export function spriteScale(size: number): number {
  return Math.max(1, Math.floor((size / 16) * 2) / 2);
}
