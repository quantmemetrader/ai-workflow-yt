/**
 * Pixel faces for the AI employees (and the host's own assistant).
 *
 * The studio asked for "pixel style pfp for the agents in chat", then for
 * faces that can be told apart at a glance. Each face is a 16x16 sprite
 * written out as a grid of colour letters, drawn as inline SVG with crisp
 * edges: no image files, no emoji, nothing fetched. Every employee keeps the
 * colour it has everywhere else (its tint behind, its colour on the shirt or
 * the prop) and is drawn with a big job prop and its own outline, so it
 * reads by shape at 18-24px:
 *   research  - glasses, lab coat and blue tie, holding up a tall report with a
 *               folded corner and three blue bars rising (the chart doc);
 *   planning  - round top bun, a brown clipboard on the left with a grey clip
 *               and a checklist of purple boxes;
 *   script    - wide tilted beret, a big pencil (eraser, metal band, yellow
 *               body, wood tip) writing on a script page at the bottom right;
 *   video     - an open striped clapperboard raised on the left, black hair
 *               and a teal headphone band and ear cup;
 *   article   - long hair with a bow, an open newspaper held across the whole
 *               width: headline bars, centre fold, text lines, a photo block.
 * The host's assistant is a small white TV-box robot with a gold antenna, gold
 * ear bolts and a dark screen showing two eyes, blush and a smile.
 *
 * Pure data and string building, so it runs on the server and in the browser.
 */
import { AGENT_COLORS, AGENT_TINTS, type AgentKey } from "@/lib/agents/catalog";

export type SpriteKey = AgentKey | "host";

/**
 * Colour letters shared by every sprite; "." is transparent. "d" is the slate
 * of the clapperboard and the robot's neck.
 */
const SHARED: Record<string, string> = {"k": "#1f1f24", "s": "#f6cfae", "S": "#e2a882", "w": "#ffffff", "m": "#c2573f", "l": "#e3f1ff", "y": "#e8ad2c", "b": "#8a5a33", "p": "#fbfaf5", "g": "#9aa3ad", "d": "#474d57"};

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
    "..kkkkkk........",
    ".khhhhhhk.......",
    "khhhhhhhhkkkkk..",
    "khhhhhssskpppgk.",
    "khssssssskpppggk",
    "kkkkskkkskppppck",
    "kwlkkwlkskppppck",
    "kkkkskkkskppcpck",
    "ksssmmssskppcpck",
    ".ksssssskkcpcpck",
    "kwwkSSkwwscpcpck",
    "kwwwccwwwscpcpck",
    "kwwwccwwwkkkkkkk",
    "kwwwwcwwwwwk....",
    "kwwwwcwwwwwwk...",
  ],
  planning: [
    ".........kkkk...",
    "........khhhhk..",
    "..kkkk..khhhhk..",
    "kkggggkkkkhhkkk.",
    "kbpggpbkhhhhhhhk",
    "kbppppbkhssssshk",
    "kbcpggbksksskshk",
    "kbppppbksssssshk",
    "kbcpggbksmmssshk",
    "kbppppbkkssssskk",
    "kbcpggsskkkSSkk.",
    "kbppppsskccycck.",
    "kbbbbbbkcccyccck",
    "kkkkkkkkcccyccck",
    "kccccccccccyyccc",
    "kccccccccccyyccc",
  ],
  script: [
    "................",
    "...kkkk......kk.",
    "..kccccck...kmmk",
    ".kcccccccck.kggk",
    "kcccccccccckyyk.",
    ".kkkkkkkkkkkyyk.",
    "..khsssssskyyk..",
    "..ksssssskkyyk..",
    "..kskssksskyk...",
    "..kssssssksSk...",
    "..kssmmsskSSk...",
    "...ksssskkkkkkk.",
    "....kSSkkpppppk.",
    "..kkcwwcckpgggk.",
    ".kcccwwcckpppppk",
    ".kcccwwcckpgggpk",
  ],
  video: [
    "................",
    ".....kk..kkkk...",
    "...kkwk.kcccck..",
    ".kkwwkkkhhhhkck.",
    "kwwkk.khhhhhkcck",
    "kkkkkkkhhhhhkcck",
    "kwwkkwkssssskcck",
    "kkkkkkksksskkcck",
    "kdddddksssssskk.",
    "kdwwwdksmmssk...",
    "kdddddkkssssk...",
    ".kkkkkk.kSSk....",
    "..kssk.kcwwck...",
    "..kkkkkccwwcck..",
    ".kcccccccwwccck.",
    ".kcccccccwwcccck",
  ],
  article: [
    "....kkkkkkk.kk..",
    "...khhhhhhhkcck.",
    "..khhhhhhhhhkck.",
    "..khhhssshhhhk..",
    ".khhssssssshhk..",
    ".khhskssskshhk..",
    ".khhsssssssshhk.",
    ".khhssssmsshhhk.",
    "khhhhssssshhhhk.",
    "kkkkkkkkkkkkkkkk",
    "sppppppgppppppps",
    "spkkkkpgpkkkkkps",
    "kppppppgpppppppk",
    "kpggggpgpcccpggk",
    "kppppppgpcccpppk",
    "kpggggpgpcccpggk",
  ],
  host: [
    ".......kk.......",
    "......kyyk......",
    ".......kk.......",
    "...kkkkkkkkkk...",
    "..kwwwwwwwwwwk..",
    ".kkwkkkkkkkkwkk.",
    "kykwkllkkllkwkyk",
    "kykwkllkkllkwkyk",
    ".kkwmkkkkkkmwkk.",
    "..kwklkkkklkwk..",
    "..kgkkllllkkgk..",
    "...kkkkkkkkkk...",
    "......kddk......",
    "...kkkkkkkkkk...",
    "..kwwwwyywwwwk..",
    "..kgwwwyywwwgk..",
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
