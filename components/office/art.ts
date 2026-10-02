/**
 * The pixel office, drawn in code (owner, 2 Oct: "show the AI employees as a
 * pixel office"). Every pixel here is ours: no tilesets, no image files. The
 * room is a 320x200 grid of art pixels on a 16px tile rhythm; the canvas
 * scales it up with nearest-neighbour so it stays crisp.
 *
 * Pure drawing: no React, no DOM beyond the 2D context, so the same code
 * paints the floor, the roster portraits and the standalone preview.
 */

export const ART_W = 320;
export const ART_H = 200;

export type Status = "working" | "waiting" | "idle";
export type LookKey = "research" | "planning" | "script" | "video" | "article" | "legal" | "finance" | "host";

export type Look = {
  key: LookKey;
  skin: [string, string];
  hair: string;
  shirt: string;
};

/* ------------------------------------------------------------- palette */

const C = {
  ink: "#3a2f3d",
  wallCap: "#6f6660",
  wallCapHi: "#857b74",
  wall: "#f4efe7",
  wallShade: "#ece5da",
  wainscot: "#e3d9ca",
  wainLine: "#d4c8b6",
  base: "#bba98f",
  baseDark: "#a3927a",
  floor: "#f0eae0",
  floorGrid: "#e4dccf",
  floorHi: "#f6f2eb",
  floorShadow: "#ddd3c4",
  oak: "#e0c49a",
  oakHi: "#ecd6b2",
  oakFront: "#c49f70",
  oakDark: "#a6825a",
  chair: "#505769",
  chairHi: "#67708a",
  chairDark: "#3e4454",
  mon: "#393d4a",
  monHi: "#4d5263",
  monStand: "#737887",
  screenOff: "#2a2e3a",
  screenOn: "#a9d6ff",
  screenOn2: "#d2ebff",
  screenWait: "#ffd27e",
  key: "#f3f1ec",
  keyDot: "#c9c4ba",
  leaf: "#5aa564",
  leafHi: "#7cc47a",
  leafDark: "#3f7e4a",
  pot: "#d07a52",
  potDark: "#ac5d3c",
  potHi: "#e39a72",
  sky: "#cfe7f7",
  sky2: "#e4f2fb",
  city: "#b8cfe0",
  city2: "#a7c1d6",
  glass: "#f3faff",
  frame: "#ffffff",
  frameShade: "#d9d2c7",
  rug: "#e3eaf1",
  rugEdge: "#c7d3e0",
  rugIn: "#d5dfea",
  table: "#f5f3ef",
  tableEdge: "#ddd8cf",
  tableFront: "#bfb8ab",
  check1: "#f6f3ec",
  check2: "#e8e2d6",
  counter: "#eeeae3",
  counterEdge: "#d8d2c7",
  cabinet: "#86a1b9",
  cabinetDark: "#6f8aa3",
  cabinetHi: "#9fb7cc",
  fridge: "#eaeef2",
  fridgeShade: "#cdd5dd",
  white: "#ffffff",
  paper: "#fbfaf6",
  paperLine: "#c9cdd4",
  gold: "#e8ad2c",
  red: "#d9534a",
  mouth: "#b9584a",
  blush: "#f3a99d",
  shadow: "rgba(70,50,30,0.13)",
};

/* ------------------------------------------------------- pixel buffer */

/** A small sprite drawn pixel by pixel, outlined, then blitted in runs. */
class Px {
  w: number;
  h: number;
  d: (string | null)[];
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.d = new Array(w * h).fill(null);
  }
  set(x: number, y: number, c: string | null) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = c;
  }
  get(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.d[y * this.w + x];
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: string | null) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  /** One outline pixel wherever an empty pixel touches a filled one. */
  outline(c: string) {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push(y * this.w + x);
      }
    for (const i of add) this.d[i] = c;
  }
  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
    for (let y = 0; y < this.h; y++) {
      let x = 0;
      while (x < this.w) {
        const c = this.d[y * this.w + x];
        if (!c) {
          x++;
          continue;
        }
        let e = x + 1;
        while (e < this.w && this.d[y * this.w + e] === c) e++;
        ctx.fillStyle = c;
        ctx.fillRect(ox + x, oy + y, e - x, 1);
        x = e;
      }
    }
  }
}

function r(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

/** Lighter or darker by a factor, for shirt shading. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f)));
  const rr = ch((n >> 16) & 255);
  const gg = ch((n >> 8) & 255);
  const bb = ch(n & 255);
  return `#${((1 << 24) | (rr << 16) | (gg << 8) | bb).toString(16).slice(1)}`;
}

/* --------------------------------------------------------- the people */

export type Pose = {
  blink: boolean;
  /** Where the eyes look: -1 left, 0 ahead, 1 right. */
  look: -1 | 0 | 1;
  /** Head down one pixel (the typing nod). */
  bob: boolean;
  /** Which hand is up while typing. */
  type: 0 | 1 | 2;
  /** A hand up: waiting on the person. */
  raise: boolean;
};

const STILL: Pose = { blink: false, look: 0, bob: false, type: 0, raise: false };

/**
 * One employee, seated, facing the room. 20x30 local grid: head x5..14
 * y4..13, torso y15..23, forearms and hands on the desk y24..27.
 * `bust` drops the desk arms and runs the torso to the bottom, for the
 * roster portraits.
 */
function person(look: Look, pose: Pose, bust: boolean): Px {
  const p = new Px(20, 30);
  const [skin, skinSh] = look.skin;
  const shirt = look.shirt;
  const shirtHi = shade(shirt, 1.18);
  const shirtSh = shade(shirt, 0.78);
  const hair = look.hair;
  const hairHi = shade(hair, 1.35);
  const hy = pose.bob ? 1 : 0;
  const bottom = bust ? 29 : 23;

  /* Long hair falls behind the shoulders, so it goes down first. */
  if (look.key === "article") {
    p.rect(4, 6 + hy, 15, 19 + hy, hair);
    p.rect(5, 19 + hy, 14, 20 + hy, hair);
  }

  /* Torso and arms. */
  if (look.key === "host") {
    p.rect(5, 15, 14, bottom, shirt);
    p.rect(5, 15, 5, bottom, shirtHi);
    p.rect(14, 15, 14, bottom, shirtSh);
    p.rect(7, 17, 12, 21, "#ece9fb");
    p.set(8, 18, "#6ee7c9");
    p.set(9, 18, C.gold);
    p.set(11, 18, C.red);
    p.rect(8, 20, 11, 20, "#b9b2e8");
    p.rect(3, 16, 4, bottom - 1, "#d9dbe2");
    if (!pose.raise) p.rect(15, 16, 16, bottom - 1, "#d9dbe2");
  } else {
    p.rect(6, 15, 13, 15, shirt);
    p.rect(5, 16, 14, bottom, shirt);
    p.rect(4, 17, 15, bottom, shirt);
    p.rect(4, 17, 4, bottom, shirtHi);
    p.rect(15, 17, 15, bottom, shirtSh);
    // sleeves read as a seam, a shade down
    p.rect(3, 17, 3, bottom - 1, shirtSh);
    if (!pose.raise) p.rect(16, 17, 16, bottom - 1, shirtSh);
    collar(p, look, bottom);
  }

  /* Neck. */
  p.set(9, 14, skinSh);
  p.set(10, 14, skinSh);

  /* Arms on the desk (scene) or the raised hand (waiting). */
  if (!bust) {
    const sleeve = look.key === "host" ? "#d9dbe2" : look.key === "finance" ? "#f4f4f2" : shirtSh;
    const lUp = pose.type === 1 ? 1 : 0;
    const rUp = pose.type === 2 ? 1 : 0;
    p.rect(4, 24, 6, 25, sleeve);
    p.rect(6, 26 - lUp, 7, 27 - lUp, skin);
    if (!pose.raise) {
      p.rect(13, 24, 15, 25, sleeve);
      p.rect(12, 26 - rUp, 13, 27 - rUp, skin);
    }
  }
  if (pose.raise) {
    const sleeve = look.key === "host" ? "#d9dbe2" : shirtSh;
    p.rect(16, 9, 17, 22, sleeve);
    p.rect(16, 6, 17, 8, skin);
    p.set(18, 7, skin);
  }

  /* Head. */
  if (look.key === "host") {
    robotHead(p, pose, hy);
  } else {
    p.rect(5, 4 + hy, 14, 13 + hy, skin);
    p.set(5, 4 + hy, null);
    p.set(14, 4 + hy, null);
    p.set(5, 13 + hy, null);
    p.set(14, 13 + hy, null);
    p.rect(14, 6 + hy, 14, 12 + hy, skinSh);
    p.rect(6, 13 + hy, 13, 13 + hy, skinSh);
    // ears
    p.set(4, 8 + hy, skin);
    p.set(4, 9 + hy, skinSh);
    p.set(15, 8 + hy, skin);
    p.set(15, 9 + hy, skinSh);
    // eyes
    const ex = pose.look;
    if (pose.blink) {
      p.set(7 + ex, 9 + hy, C.ink);
      p.set(12 + ex, 9 + hy, C.ink);
    } else {
      p.set(7 + ex, 8 + hy, C.ink);
      p.set(7 + ex, 9 + hy, C.ink);
      p.set(12 + ex, 8 + hy, C.ink);
      p.set(12 + ex, 9 + hy, C.ink);
    }
    // mouth and cheeks
    p.set(9, 11 + hy, C.mouth);
    p.set(10, 11 + hy, C.mouth);
    if (pose.raise) p.set(10, 12 + hy, C.mouth);
    p.set(6, 11 + hy, C.blush);
    p.set(13, 11 + hy, C.blush);
    hairFor(p, look, hy, hair, hairHi, pose);
  }

  p.outline(C.ink);
  return p;
}

function collar(p: Px, look: Look, bottom: number) {
  const k = look.key;
  const shirtSh = shade(look.shirt, 0.72);
  if (k === "research") {
    // white shirt collar under a blue jumper, a pen in the pocket
    p.rect(7, 15, 12, 15, C.white);
    p.set(8, 16, C.white);
    p.set(11, 16, C.white);
    p.rect(9, 16, 10, 16, "#cfe0f7");
    p.rect(12, 19, 13, 19, C.white);
    p.set(12, 18, C.gold);
  } else if (k === "planning") {
    // round neck and a little brooch
    p.rect(8, 15, 11, 15, look.skin[0]);
    p.rect(8, 16, 11, 16, shade(look.shirt, 1.35));
    p.set(12, 18, C.gold);
  } else if (k === "script") {
    // open collar and a scarf knot
    p.rect(8, 15, 11, 16, "#f2e6c9");
    p.rect(9, 17, 10, 18, "#f2e6c9");
    p.set(9, 19, "#e3d2ad");
  } else if (k === "video") {
    // hoodie: hood ring and two strings
    p.rect(5, 15, 14, 16, shade(look.shirt, 0.85));
    p.rect(8, 15, 11, 15, look.skin[1]);
    p.set(8, 17, C.white);
    p.set(8, 18, C.white);
    p.set(11, 17, C.white);
    p.set(11, 18, C.white);
    p.rect(7, Math.min(bottom, 21), 12, Math.min(bottom, 21), shirtSh);
  } else if (k === "article") {
    // square neck, a fine stripe
    p.rect(8, 15, 11, 16, look.skin[0]);
    for (let y = 18; y <= bottom; y += 3) p.rect(5, y, 14, y, shade(look.shirt, 1.25));
  } else if (k === "legal") {
    // suit: white shirt in a V and a dark tie
    p.rect(8, 15, 11, 15, C.white);
    p.rect(8, 16, 11, 17, C.white);
    p.rect(9, 18, 10, 19, C.white);
    p.rect(9, 16, 10, 16, "#2c3142");
    p.rect(9, 17, 10, 20, "#343a4f");
    p.set(7, 17, shirtSh);
    p.set(12, 17, shirtSh);
    p.set(6, 18, shirtSh);
    p.set(13, 18, shirtSh);
  } else if (k === "finance") {
    // white shirt with a green vest
    p.rect(3, 17, 3, bottom - 1, "#f4f4f2");
    p.rect(16, 17, 16, bottom - 1, "#e6e6e2");
    p.rect(8, 15, 11, 16, C.white);
    p.rect(9, 17, 10, 17, C.white);
    p.set(9, 19, C.gold);
    p.set(9, 21, C.gold);
  }
}

function hairFor(p: Px, look: Look, hy: number, h: string, hi: string, pose: Pose) {
  const y = (v: number) => v + hy;
  switch (look.key) {
    case "research": {
      // short and tidy, parted left; round glasses
      p.rect(6, y(2), 13, y(2), h);
      p.rect(5, y(3), 14, y(4), h);
      p.rect(5, y(5), 6, y(6), h);
      p.rect(13, y(5), 14, y(5), h);
      p.rect(9, y(5), 13, y(5), h);
      p.set(7, y(3), hi);
      p.set(8, y(3), hi);
      const g = "#3c4256";
      const lens = "#e3f1ff";
      for (const gx of [6, 11]) {
        p.rect(gx, y(7), gx + 2, y(7), g);
        p.rect(gx, y(8), gx, y(9), g);
        p.rect(gx + 2, y(8), gx + 2, y(9), g);
        p.set(gx + 1, y(8), lens);
        p.set(gx + 1, y(9), pose.blink ? lens : C.ink);
        p.set(gx + 1, y(10), g);
      }
      p.rect(9, y(8), 10, y(8), g);
      break;
    }
    case "planning": {
      // a high bun with a purple band, smooth sides
      p.rect(8, y(0), 11, y(1), h);
      p.set(8, y(0), null);
      p.set(11, y(0), null);
      p.set(9, y(0), hi);
      p.rect(8, y(2), 11, y(2), shade(look.shirt, 1.3));
      p.rect(6, y(3), 13, y(3), h);
      p.rect(5, y(4), 14, y(5), h);
      p.rect(5, y(6), 5, y(10), h);
      p.rect(14, y(6), 14, y(10), h);
      p.set(6, y(6), h);
      p.set(13, y(6), h);
      p.set(7, y(4), hi);
      p.set(8, y(4), hi);
      break;
    }
    case "script": {
      // a wide red beret tipped right, with its stalk; a pencil behind the ear
      const b = "#a8322a";
      const bHi = "#c94a3f";
      p.rect(6, y(5), 13, y(5), h);
      p.rect(5, y(6), 5, y(8), h);
      p.rect(14, y(6), 14, y(7), h);
      p.rect(5, y(2), 15, y(3), b);
      p.rect(4, y(4), 16, y(4), b);
      p.rect(6, y(1), 13, y(1), b);
      p.rect(7, y(2), 10, y(2), bHi);
      p.set(11, y(0), b);
      p.set(15, y(5), shade(b, 0.8));
      // pencil
      p.set(16, y(6), "#f3a7b5");
      p.set(16, y(7), C.gold);
      p.set(16, y(8), C.gold);
      p.set(16, y(9), "#e9c48f");
      break;
    }
    case "video": {
      // messy black hair, a headband with teal cups
      p.rect(6, y(2), 13, y(3), h);
      p.rect(5, y(4), 14, y(5), h);
      p.set(5, y(1), h);
      p.set(8, y(1), h);
      p.set(12, y(1), h);
      p.set(15, y(3), h);
      p.rect(6, y(6), 7, y(6), h);
      p.rect(10, y(6), 12, y(6), h);
      p.set(7, y(3), hi);
      p.set(10, y(2), hi);
      const band = "#2b2f3a";
      const cup = "#0b7a63";
      const cupHi = "#25a587";
      p.rect(4, y(3), 4, y(6), band);
      p.rect(15, y(3), 15, y(6), band);
      p.rect(5, y(2), 14, y(2), band);
      p.rect(3, y(7), 5, y(11), cup);
      p.rect(14, y(7), 16, y(11), cup);
      p.set(4, y(8), cupHi);
      p.set(15, y(8), cupHi);
      break;
    }
    case "article": {
      // long hair with a fringe and a pink bow
      p.rect(6, y(2), 13, y(2), h);
      p.rect(5, y(3), 14, y(5), h);
      p.rect(5, y(6), 5, y(13), h);
      p.rect(14, y(6), 14, y(13), h);
      p.set(6, y(6), h);
      p.set(8, y(6), h);
      p.set(13, y(6), h);
      p.set(7, y(3), hi);
      p.set(8, y(3), hi);
      p.set(6, y(4), hi);
      const bow = "#f17aa7";
      p.rect(12, y(1), 13, y(2), bow);
      p.rect(15, y(1), 16, y(2), bow);
      p.set(14, y(2), shade(bow, 0.8));
      break;
    }
    case "legal": {
      // neat, combed back with a side part
      p.rect(6, y(2), 13, y(2), h);
      p.rect(5, y(3), 14, y(4), h);
      p.rect(5, y(5), 5, y(7), h);
      p.rect(14, y(5), 14, y(6), h);
      p.rect(10, y(5), 13, y(5), h);
      p.set(8, y(3), "#f0e6d8");
      p.set(9, y(3), hi);
      p.set(10, y(3), hi);
      p.set(11, y(4), hi);
      break;
    }
    case "finance": {
      // short curls under a green visor
      p.rect(6, y(2), 13, y(3), h);
      p.rect(5, y(4), 5, y(7), h);
      p.rect(14, y(4), 14, y(7), h);
      p.set(5, y(3), h);
      p.set(14, y(3), h);
      p.set(7, y(2), hi);
      p.set(10, y(2), hi);
      p.set(12, y(3), hi);
      p.rect(5, y(4), 14, y(4), "#2e6b16");
      p.rect(4, y(5), 15, y(5), "#6cc24a");
      p.rect(6, y(6), 13, y(6), "rgba(108,194,74,0.55)");
      break;
    }
    default:
      break;
  }
}

function robotHead(p: Px, pose: Pose, hy: number) {
  const y = (v: number) => v + hy;
  const shell = "#f4f4f7";
  const shellSh = "#d8dae2";
  const screen = "#2a2d3c";
  p.rect(4, y(3), 15, y(13), shell);
  p.set(4, y(3), null);
  p.set(15, y(3), null);
  p.rect(15, y(4), 15, y(13), shellSh);
  p.rect(5, y(13), 14, y(13), shellSh);
  // antenna and bolts
  p.rect(9, y(1), 10, y(2), "#9aa3ad");
  p.rect(9, y(0), 10, y(0), C.gold);
  p.set(3, y(8), C.gold);
  p.set(16, y(8), C.gold);
  // face screen
  p.rect(6, y(5), 13, y(11), screen);
  const ex = pose.look;
  const eye = "#7ff0d0";
  if (pose.blink) {
    p.rect(7 + ex, y(8), 8 + ex, y(8), eye);
    p.rect(11 + ex, y(8), 12 + ex, y(8), eye);
  } else {
    p.rect(7 + ex, y(7), 8 + ex, y(8), eye);
    p.rect(11 + ex, y(7), 12 + ex, y(8), eye);
  }
  p.set(9, y(10), eye);
  p.set(10, y(10), eye);
  p.set(7, y(9), "#f39ab3");
  p.set(12, y(9), "#f39ab3");
}

/* ------------------------------------------------------------- props */

function prop(ctx: CanvasRenderingContext2D, key: LookKey, x: number, y: number, tick: number) {
  switch (key) {
    case "research": {
      // a report with a bar chart, and a mug
      r(ctx, x, y + 1, 8, 7, C.paper);
      r(ctx, x, y + 8, 8, 1, C.paperLine);
      r(ctx, x + 1, y + 5, 1, 2, "#7aa7ec");
      r(ctx, x + 3, y + 4, 1, 3, "#4d86e3");
      r(ctx, x + 5, y + 2, 1, 5, "#0f5bd5");
      mug(ctx, x + 10, y + 3, "#ffffff", tick);
      break;
    }
    case "planning": {
      // clipboard with a checklist
      r(ctx, x, y, 8, 10, "#9b6b3e");
      r(ctx, x + 1, y + 1, 6, 8, C.paper);
      r(ctx, x + 2, y - 1, 4, 2, "#9aa3ad");
      for (let i = 0; i < 3; i++) {
        r(ctx, x + 2, y + 3 + i * 2, 1, 1, "#6a3fc4");
        r(ctx, x + 4, y + 3 + i * 2, 2, 1, C.paperLine);
      }
      r(ctx, x + 10, y + 5, 3, 3, "#f6d365");
      break;
    }
    case "script": {
      // a script page and a stack
      r(ctx, x + 1, y + 2, 9, 7, "#f1ece0");
      r(ctx, x, y + 1, 9, 7, C.paper);
      for (let i = 0; i < 3; i++) r(ctx, x + 2, y + 3 + i * 2, i === 2 ? 3 : 5, 1, C.paperLine);
      r(ctx, x + 11, y + 2, 1, 6, C.gold);
      r(ctx, x + 11, y + 1, 1, 1, "#f3a7b5");
      break;
    }
    case "video": {
      // a clapperboard and a hard drive
      r(ctx, x, y + 3, 9, 6, "#2e3340");
      r(ctx, x, y + 1, 9, 2, C.white);
      for (let i = 0; i < 9; i += 3) r(ctx, x + i, y + 1, 1, 2, "#2e3340");
      r(ctx, x + 2, y + 5, 4, 1, "#7f8899");
      r(ctx, x + 11, y + 4, 3, 5, "#57606f");
      r(ctx, x + 12, y + 5, 1, 1, tick % 4 < 2 ? "#5be3b0" : "#2f8a6a");
      break;
    }
    case "article": {
      // folded newspapers and a pink pen
      r(ctx, x, y + 2, 10, 7, "#efede6");
      r(ctx, x, y + 2, 10, 1, "#9d1d52");
      r(ctx, x + 1, y + 4, 4, 3, "#c9ccd2");
      r(ctx, x + 6, y + 4, 3, 1, C.paperLine);
      r(ctx, x + 6, y + 6, 3, 1, C.paperLine);
      r(ctx, x + 11, y + 3, 1, 6, "#f17aa7");
      break;
    }
    case "legal": {
      // a small brass balance and a folder
      r(ctx, x + 4, y, 1, 8, "#b8902e");
      r(ctx, x + 1, y + 1, 7, 1, "#b8902e");
      r(ctx, x, y + 3, 3, 1, "#d4b25a");
      r(ctx, x + 6, y + 3, 3, 1, "#d4b25a");
      r(ctx, x + 3, y + 8, 3, 1, "#8c6b1d");
      r(ctx, x + 10, y + 3, 5, 6, "#7a5a0c");
      r(ctx, x + 10, y + 3, 5, 1, "#a07a20");
      break;
    }
    case "finance": {
      // calculator and a coin stack
      r(ctx, x, y + 1, 7, 9, "#4b5263");
      r(ctx, x + 1, y + 2, 5, 2, "#cfe8c4");
      for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) r(ctx, x + 1 + j * 2, y + 5 + i * 2, 1, 1, j === 2 && i === 1 ? C.gold : "#c9ced8");
      for (let i = 0; i < 3; i++) r(ctx, x + 9, y + 7 - i * 2, 4, 2, i % 2 ? "#f2c14e" : C.gold);
      break;
    }
    case "host": {
      // a tidy tray and a small plant
      r(ctx, x, y + 3, 8, 5, "#dcd6f7");
      r(ctx, x + 1, y + 4, 6, 1, "#b9b0ec");
      r(ctx, x + 10, y + 5, 4, 4, C.pot);
      r(ctx, x + 10, y + 2, 4, 3, C.leaf);
      r(ctx, x + 11, y + 1, 2, 1, C.leafHi);
      break;
    }
  }
}

function mug(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, tick: number) {
  r(ctx, x, y, 4, 5, c);
  r(ctx, x, y, 4, 1, "#8a5a33");
  r(ctx, x + 4, y + 1, 1, 2, c);
  r(ctx, x, y + 5, 4, 1, "#d9d4ca");
  const s = tick % 6;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  if (s < 3) {
    ctx.fillRect(x + 1, y - 2 - s, 1, 1);
    ctx.fillRect(x + 2, y - 4 - s, 1, 1);
  }
}

/* -------------------------------------------------------------- seats */

export type Seat = { key: LookKey; cx: number; dy: number; sx: number };

/**
 * The desks as the work flows (owner, 2 Oct: room between the desks and an
 * arrow showing the flow). The top row is the line a video goes down, left
 * to right: research, plan, script, edit, publish copy. The bottom row is
 * whoever is called on when needed: legal, finance and the assistant.
 */
export const FLOW_KEYS: LookKey[] = ["research", "planning", "script", "video", "article"];
export const SUPPORT_KEYS: LookKey[] = ["legal", "finance", "host"];
const ROW1 = 92;
const ROW2 = 164;
const STEP = 62;
const LEFT = 14;

export function seatsFor(keys: LookKey[]): Seat[] {
  const out: Seat[] = [];
  for (const key of keys) {
    const f = FLOW_KEYS.indexOf(key);
    const sp = SUPPORT_KEYS.indexOf(key);
    if (f >= 0) out.push({ key, sx: LEFT + f * STEP, cx: LEFT + f * STEP + 22, dy: ROW1 });
    else if (sp >= 0) out.push({ key, sx: LEFT + (sp + 1) * STEP, cx: LEFT + (sp + 1) * STEP + 22, dy: ROW2 });
  }
  return out;
}

/** The support corner, in art pixels: the HTML label sits on its top edge. */
export const SUPPORT_ZONE = { x: LEFT + STEP - 8, y: ROW2 - 36, w: STEP * 3 - 18 + 16, h: 64 };

/**
 * The arrows between the desks on the top row. Each runs from one desk to
 * the next along the floor; while the desk it leaves is at work a sheet of
 * paper travels down it, so the hand-on is something you can see.
 */
export function drawFlow(ctx: CanvasRenderingContext2D, seats: Seat[], statusOf: (k: LookKey) => Status, tick: number, motion: boolean) {
  const at = new Map(seats.map((s) => [s.key, s]));
  for (let i = 0; i < FLOW_KEYS.length - 1; i++) {
    const a = at.get(FLOW_KEYS[i]);
    const b = at.get(FLOW_KEYS[i + 1]);
    if (!a || !b) continue;
    const x0 = a.sx + 43;
    const x1 = b.sx + 1;
    const y = a.dy + 11;
    const live = statusOf(a.key) === "working";
    const ink = live ? "#1f8f6f" : "#b9ad99";
    const dim = live ? "#8fd0bb" : "#d8cfbf";
    // a dotted run, then the head
    for (let x = x0 + 1; x < x1 - 4; x += 3) r(ctx, x, y, 2, 2, (x - x0) % 6 < 3 ? ink : dim);
    r(ctx, x1 - 5, y - 2, 1, 6, ink);
    r(ctx, x1 - 4, y - 1, 1, 4, ink);
    r(ctx, x1 - 3, y, 1, 2, ink);
    if (live && motion) {
      const span = x1 - x0 - 9;
      const px = x0 + 1 + (tick % span);
      r(ctx, px, y - 3, 4, 5, C.paper);
      r(ctx, px, y - 3, 4, 1, "#ffffff");
      r(ctx, px + 1, y - 1, 2, 1, C.paperLine);
      r(ctx, px, y + 2, 4, 1, C.shadow);
    }
  }
}

/** The area a seat covers, in art pixels: for hit areas and the bubble. */
export function seatBox(s: Seat) {
  return { x: s.sx, y: s.dy - 28, w: 44, h: 48, headX: s.cx, headY: s.dy - 25 };
}

/* --------------------------------------------------------------- room */

/** Everything that never moves: walls, windows, floor, furniture. */
export function drawRoom(ctx: CanvasRenderingContext2D) {
  // floor tiles
  r(ctx, 0, 0, ART_W, ART_H, C.floor);
  for (let y = 44; y < ART_H; y += 16) {
    r(ctx, 0, y, ART_W, 1, C.floorGrid);
    r(ctx, 0, y + 1, ART_W, 1, C.floorHi);
  }
  for (let x = 0; x < ART_W; x += 16) {
    r(ctx, x, 44, 1, ART_H - 44, C.floorGrid);
    r(ctx, x + 1, 44, 1, ART_H - 44, C.floorHi);
  }

  // a runner under the line of desks: the way the work goes
  r(ctx, 8, 100, ART_W - 16, 1, C.rugEdge);
  r(ctx, 8, 101, ART_W - 16, 6, C.rug);
  r(ctx, 8, 107, ART_W - 16, 1, C.rugEdge);

  // the support corner on its own rug
  const z = SUPPORT_ZONE;
  r(ctx, z.x, z.y, z.w, z.h, C.rugEdge);
  r(ctx, z.x + 1, z.y + 1, z.w - 2, z.h - 2, C.rug);
  r(ctx, z.x + 4, z.y + 4, z.w - 8, z.h - 8, C.rugIn);
  r(ctx, z.x + 5, z.y + 5, z.w - 10, z.h - 10, C.rug);

  // back wall
  r(ctx, 0, 0, ART_W, 4, C.wallCap);
  r(ctx, 0, 3, ART_W, 1, C.wallCapHi);
  r(ctx, 0, 4, ART_W, 28, C.wall);
  r(ctx, 0, 4, ART_W, 1, C.wallShade);
  r(ctx, 0, 32, ART_W, 8, C.wainscot);
  r(ctx, 0, 32, ART_W, 1, C.wainLine);
  for (let x = 6; x < ART_W; x += 20) r(ctx, x, 34, 1, 5, C.wainLine);
  r(ctx, 0, 40, ART_W, 4, C.base);
  r(ctx, 0, 43, ART_W, 1, C.baseDark);
  r(ctx, 0, 44, ART_W, 2, C.floorShadow);

  // windows along the wall
  for (const wx of [14, 66, 118]) windowAt(ctx, wx, 7, 42, 24);

  // a framed print and the door
  r(ctx, 172, 12, 14, 12, C.frameShade);
  r(ctx, 173, 13, 12, 10, "#fdf6e9");
  r(ctx, 175, 17, 4, 4, "#f0b35b");
  r(ctx, 178, 15, 5, 6, "#7cb6a8");
  doorAt(ctx, 290, 10);

  // the whiteboard: today's plan
  r(ctx, 206, 8, 66, 24, "#b9bec7");
  r(ctx, 207, 9, 64, 21, "#fbfcfd");
  r(ctx, 206, 31, 66, 2, "#a5abb5");
  r(ctx, 212, 13, 18, 1, "#0f5bd5");
  r(ctx, 212, 16, 12, 1, "#7aa7ec");
  r(ctx, 212, 19, 15, 1, "#7aa7ec");
  r(ctx, 234, 24, 1, 3, "#0b7a63");
  r(ctx, 237, 21, 1, 6, "#0b7a63");
  r(ctx, 240, 18, 1, 9, "#0b7a63");
  r(ctx, 233, 27, 10, 1, "#9aa3ad");
  const notes = ["#d5e7fb", "#dcd6fb", "#f8dcc6", "#c3e6e0", "#f5d4e6", "#f1e5c0"];
  notes.forEach((n, i) => r(ctx, 248 + (i % 3) * 7, 12 + Math.floor(i / 3) * 8, 6, 6, n));
  r(ctx, 228, 32, 6, 1, C.red);
  r(ctx, 236, 32, 6, 1, "#0f5bd5");

  // bookshelf by the door
  shelfAt(ctx, 276, 14);

  // plants in the corners
  plantAt(ctx, 2, 48, false);
  plantAt(ctx, 304, 48, false);
  plantAt(ctx, 4, 166, true);
  plantAt(ctx, 300, 166, true);

  // printer on a cabinet, bottom left
  r(ctx, 24, 182, 30, 12, "#c9c3b8");
  r(ctx, 24, 180, 30, 2, "#ddd8ce");
  r(ctx, 25, 184, 13, 1, "#b2ab9e");
  r(ctx, 40, 184, 13, 1, "#b2ab9e");
  r(ctx, 24, 194, 30, 2, C.shadow);
  r(ctx, 28, 172, 22, 8, "#eceef1");
  r(ctx, 28, 172, 22, 2, "#f7f8fa");
  r(ctx, 31, 170, 16, 2, C.paper);
  r(ctx, 44, 175, 3, 1, "#5be3b0");

  // water cooler, bottom right
  r(ctx, 274, 160, 10, 9, "#a9d6f5");
  r(ctx, 275, 161, 3, 6, "#cdeafb");
  r(ctx, 273, 169, 12, 25, "#eef0f3");
  r(ctx, 283, 169, 2, 25, "#d3d8de");
  r(ctx, 276, 176, 2, 2, "#5aa0e6");
  r(ctx, 280, 176, 2, 2, C.red);
  r(ctx, 273, 194, 12, 2, C.shadow);
}

function windowAt(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  r(ctx, x - 1, y - 1, w + 2, h + 3, C.frameShade);
  r(ctx, x, y, w, h, C.frame);
  const ix = x + 2;
  const iy = y + 2;
  const iw = w - 4;
  const ih = h - 4;
  r(ctx, ix, iy, iw, ih, C.sky);
  r(ctx, ix, iy + Math.floor(ih / 2), iw, Math.ceil(ih / 2), C.sky2);
  // a far skyline
  const heights = [6, 10, 7, 12, 8, 5, 11, 7, 9, 6];
  let cx = ix;
  let i = (x / 4) | 0;
  while (cx < ix + iw) {
    const bw = 3 + ((i * 7) % 4);
    const bh = heights[i % heights.length];
    r(ctx, cx, iy + ih - bh, Math.min(bw, ix + iw - cx), bh, i % 2 ? C.city : C.city2);
    cx += bw + 1;
    i++;
  }
  // a cloud
  r(ctx, ix + 5 + (x % 9), iy + 3, 8, 2, C.white);
  r(ctx, ix + 7 + (x % 9), iy + 2, 4, 1, C.white);
  // glare
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  for (let k = 0; k < 6; k++) ctx.fillRect(ix + iw - 12 + k, iy + 1 + k * 2, 1, 2);
  // mullions and the sill
  r(ctx, x + Math.floor(w / 2) - 1, y, 2, h, C.frame);
  r(ctx, x - 2, y + h, w + 4, 2, C.white);
  r(ctx, x - 2, y + h + 2, w + 4, 1, C.frameShade);
}

function doorAt(ctx: CanvasRenderingContext2D, x: number, y: number) {
  r(ctx, x - 2, y - 2, 22, 34, "#8d6a48");
  r(ctx, x, y, 18, 32, "#c99a6b");
  r(ctx, x + 2, y + 3, 14, 11, "#b98b5d");
  r(ctx, x + 2, y + 17, 14, 12, "#b98b5d");
  r(ctx, x + 3, y + 4, 12, 9, "#d4a77a");
  r(ctx, x + 3, y + 18, 12, 10, "#d4a77a");
  r(ctx, x + 14, y + 16, 2, 2, C.gold);
  // the mat in front of it
  r(ctx, x - 1, 45, 20, 6, "#a3ad93");
  r(ctx, x, 46, 18, 4, "#b6bfa6");
}

function shelfAt(ctx: CanvasRenderingContext2D, x: number, y: number) {
  r(ctx, x - 2, y - 2, 12, 30, "#9b7653");
  r(ctx, x - 1, y - 1, 10, 28, "#b48d68");
  const books = ["#0f5bd5", "#b3420e", "#0b7a63", "#9d1d52", "#e8ad2c", "#6a3fc4", "#3b7a16", "#7a5a0c"];
  for (let s = 0; s < 3; s++) {
    const sy = y + s * 9;
    r(ctx, x - 1, sy + 7, 10, 1, "#8a6544");
    for (let b = 0; b < 4; b++) r(ctx, x + b * 2, sy + 1 + ((b + s) % 2), 2, 6 - ((b + s) % 2), books[(b + s * 3) % books.length]);
  }
}

function plantAt(ctx: CanvasRenderingContext2D, x: number, y: number, tall: boolean) {
  const h = tall ? 16 : 11;
  r(ctx, x + 1, y + h + 9, 12, 2, C.shadow);
  // leaves
  const leaves: [number, number, number, number, string][] = tall
    ? [
        [4, 0, 4, 6, C.leafDark],
        [1, 3, 5, 5, C.leaf],
        [8, 2, 5, 6, C.leaf],
        [3, 7, 8, 6, C.leaf],
        [0, 9, 4, 4, C.leafDark],
        [10, 8, 4, 4, C.leafDark],
        [5, 1, 2, 3, C.leafHi],
        [2, 4, 2, 2, C.leafHi],
        [9, 3, 2, 2, C.leafHi],
        [5, 8, 3, 2, C.leafHi],
      ]
    : [
        [3, 0, 6, 4, C.leaf],
        [0, 3, 5, 5, C.leafDark],
        [8, 3, 5, 5, C.leafDark],
        [3, 3, 7, 6, C.leaf],
        [5, 1, 2, 2, C.leafHi],
        [2, 4, 2, 2, C.leafHi],
        [9, 4, 2, 2, C.leafHi],
      ];
  for (const [lx, ly, lw, lh, c] of leaves) r(ctx, x + lx, y + ly, lw, lh, c);
  // pot
  r(ctx, x + 2, y + h - 1, 10, 2, C.potHi);
  r(ctx, x + 2, y + h + 1, 10, 7, C.pot);
  r(ctx, x + 3, y + h + 8, 8, 1, C.potDark);
  r(ctx, x + 10, y + h + 1, 2, 7, C.potDark);
}

function chairBack(ctx: CanvasRenderingContext2D, x: number, y: number) {
  r(ctx, x, y, 14, 12, C.chairDark);
  r(ctx, x + 1, y, 12, 11, C.chair);
  r(ctx, x + 2, y + 1, 10, 2, C.chairHi);
}

function chairFromBehind(ctx: CanvasRenderingContext2D, x: number, y: number) {
  r(ctx, x + 1, y, 12, 10, C.chair);
  r(ctx, x, y + 1, 14, 8, C.chair);
  r(ctx, x + 2, y + 1, 10, 1, C.chairHi);
  r(ctx, x + 13, y + 1, 1, 8, C.chairDark);
  r(ctx, x + 1, y + 9, 12, 1, C.chairDark);
  r(ctx, x + 6, y + 10, 2, 3, "#6b7080");
  r(ctx, x + 2, y + 13, 10, 1, "#555a68");
  r(ctx, x + 1, y + 14, 12, 1, C.shadow);
}

/* ------------------------------------------------------------ stations */

export type Frame = { tick: number; seed: number };

/** Who blinks, who looks round, who types, from the clock and a seed. */
export function poseFor(status: Status, f: Frame, motion: boolean): Pose {
  if (!motion) return { ...STILL, raise: status === "waiting" };
  const t = f.tick + f.seed * 11;
  const blink = t % 41 === 0 || t % 41 === 1;
  if (status === "working") {
    const k = t % 4;
    return { blink, look: 0, bob: k === 1 || k === 2, type: k === 0 ? 1 : k === 2 ? 2 : 0, raise: false };
  }
  if (status === "waiting") return { blink, look: Math.floor(t / 10) % 2 ? 1 : 0, bob: false, type: 0, raise: Math.floor(t / 12) % 5 !== 4 };
  const look = ([0, 0, -1, 0, 0, 1, 0] as const)[Math.floor(t / 14) % 7];
  return { blink, look, bob: false, type: 0, raise: false };
}

/** One desk with its person, chair, monitor and things on it. */
export function drawStation(ctx: CanvasRenderingContext2D, s: Seat, look: Look, status: Status, f: Frame, motion: boolean, hover: boolean) {
  const { cx, dy, sx } = s;
  const ox = cx - 10;
  const oy = dy - 24;
  const pose = poseFor(status, f, motion);

  // picked or pointed at: a warm patch of floor under the whole desk
  if (hover) {
    ctx.fillStyle = "rgba(255,206,110,0.22)";
    ctx.fillRect(sx + 1, dy - 27, 42, 48);
    ctx.fillStyle = "rgba(214,150,40,0.55)";
    ctx.fillRect(sx + 1, dy - 27, 42, 1);
    ctx.fillRect(sx + 1, dy + 20, 42, 1);
    ctx.fillRect(sx + 1, dy - 26, 1, 46);
    ctx.fillRect(sx + 42, dy - 26, 1, 46);
  }
  // floor shadow under the desk and chair
  r(ctx, sx + 4, dy + 18, 36, 2, C.shadow);
  // chair back peeking round the shoulders
  r(ctx, cx - 9, oy + 10, 18, 14, C.chairDark);
  r(ctx, cx - 8, oy + 9, 16, 14, C.chair);
  r(ctx, cx - 7, oy + 10, 14, 2, C.chairHi);

  // the desk
  r(ctx, sx + 3, dy - 1, 38, 1, C.oakHi);
  r(ctx, sx + 3, dy, 38, 12, C.oak);
  r(ctx, sx + 3, dy, 38, 1, C.oakHi);
  r(ctx, sx + 3, dy + 12, 38, 6, C.oakFront);
  r(ctx, sx + 3, dy + 17, 38, 1, C.oakDark);
  r(ctx, sx + 40, dy, 1, 18, C.oakDark);
  // name strip in the employee's own colour
  r(ctx, sx + 18, dy + 14, 8, 2, look.shirt);

  // keyboard
  r(ctx, cx - 6, dy + 3, 12, 4, C.key);
  r(ctx, cx - 6, dy + 7, 12, 1, C.keyDot);
  for (let i = 0; i < 5; i++) r(ctx, cx - 5 + i * 2, dy + 4, 1, 1, C.keyDot);
  for (let i = 0; i < 4; i++) r(ctx, cx - 4 + i * 2, dy + 5, 1, 1, C.keyDot);
  // mouse
  r(ctx, cx + 8, dy + 5, 2, 3, C.key);

  // monitor, turned toward its owner; the screen edge shows its state
  const mx = sx + 4;
  const my = dy - 12;
  const glow = status === "working";
  const flick = motion && glow ? f.tick % 7 === 3 : false;
  const screen = glow ? (flick ? C.screenOn2 : C.screenOn) : status === "waiting" ? C.screenWait : C.screenOff;
  if (glow || status === "waiting") {
    // light falling on the desk from the screen
    ctx.fillStyle = glow ? (flick ? "rgba(185,222,255,0.42)" : "rgba(170,214,255,0.34)") : "rgba(255,214,130,0.3)";
    for (let i = 0; i < 8; i++) ctx.fillRect(mx + 11, dy + 1 + i, 4 + i, 1);
  }
  r(ctx, mx + 4, dy + 1, 3, 3, C.monStand);
  r(ctx, mx + 2, dy + 4, 7, 2, C.monStand);
  r(ctx, mx, my, 10, 14, C.mon);
  r(ctx, mx, my, 10, 1, C.monHi);
  r(ctx, mx, my, 1, 14, C.monHi);
  r(ctx, mx + 10, my + 1, 2, 12, screen);
  r(ctx, mx + 12, my + 2, 1, 10, glow ? "rgba(169,214,255,0.55)" : status === "waiting" ? "rgba(255,210,126,0.5)" : "rgba(0,0,0,0)");
  // the power light on the back
  r(ctx, mx + 2, my + 11, 1, 1, glow ? "#5be3b0" : status === "waiting" ? (motion && f.tick % 4 < 2 ? C.gold : "#a9761b") : "#6b7080");

  // the employee's own things on the right of the desk
  prop(ctx, look.key, sx + 26, dy + 1, motion ? f.tick : 0);

  // the person
  person(look, pose, false).draw(ctx, ox, oy);

  // the screen's light on the face while it works
  if (glow) {
    ctx.fillStyle = flick ? "rgba(185,222,255,0.26)" : "rgba(170,214,255,0.18)";
    ctx.fillRect(ox + 4, oy + 4 + (pose.bob ? 1 : 0), 4, 10);
  }
}

/** The wall clock, at the real time. */
export function drawClock(ctx: CanvasRenderingContext2D, now: Date) {
  const x = 194;
  const y = 12;
  r(ctx, x + 1, y, 6, 8, "#4b4f5c");
  r(ctx, x, y + 1, 8, 6, "#4b4f5c");
  r(ctx, x + 1, y + 1, 6, 6, C.white);
  r(ctx, x + 2, y + 1, 4, 6, C.white);
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  // hour hand: one of eight directions
  const dirs: [number, number][] = [
    [0, -2],
    [1, -2],
    [2, 0],
    [1, 2],
    [0, 2],
    [-1, 2],
    [-2, 0],
    [-1, -2],
  ];
  const hd = dirs[Math.round((h / 12) * 8) % 8];
  const md = dirs[Math.round((m / 60) * 8) % 8];
  r(ctx, x + 3 + Math.sign(md[0]), y + 3 + Math.sign(md[1]), 1, 1, "#9aa3ad");
  r(ctx, x + 3 + md[0], y + 3 + md[1], 1, 1, "#9aa3ad");
  r(ctx, x + 3 + Math.sign(hd[0]), y + 3 + Math.sign(hd[1]), 1, 1, C.ink);
  r(ctx, x + 3, y + 3, 2, 2, C.ink);
}

/** Kept for the floor's frame loop; the room has nothing that steams now. */
export function drawAmbient(_ctx: CanvasRenderingContext2D, _tick: number, _motion: boolean) {}

/* ----------------------------------------------------------- portraits */

export const PORTRAIT_W = 20;
export const PORTRAIT_H = 24;

/** A bust for the roster cards: the same person, from the chest up. */
export function drawPortrait(ctx: CanvasRenderingContext2D, look: Look, pose: Partial<Pose> = {}) {
  ctx.clearRect(0, 0, PORTRAIT_W, PORTRAIT_H);
  const p = person(look, { ...STILL, ...pose, raise: false, bob: false }, true);
  p.draw(ctx, 0, 1);
}
