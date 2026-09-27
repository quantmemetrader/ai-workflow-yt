import "server-only";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { CARD_PAD, CARD_RADIUS, CORNER_MAX_W, HEADER_BAND, cardBehindPicture, inCorner } from "@/lib/video/presets";
import { EYE_MAX, EYE_TARGET, minFramingZoom } from "@/lib/video/face";
import type { Layout, MotionClip, RenderPlan } from "@/lib/video/v2/types";

/**
 * Titles, lower thirds and end cards, drawn by Remotion as stills.
 *
 * Why stills rather than clips:
 *
 * The first version rendered the whole timeline as a transparent video and
 * composited it. The picture was right and the cost was **thirteen seconds a
 * frame** on this box — six hours for a one-minute video — because the machine
 * shares its 32 cores with a ClickHouse server and a BSC node. A graphic is
 * one piece of layout that sits still for two seconds; paying Chrome sixty
 * times to redraw it is paying for nothing.
 *
 * So each graphic is rendered once, as a PNG with transparency, and FFmpeg
 * does the appearing and the leaving: a fade and a short slide, on the same
 * curve for every graphic, which is what the house rules ask for anyway —
 * *nothing moves after it arrives*. One Chrome render per graphic, six per
 * video instead of nine thousand.
 *
 * Captions are not here at all. They are an ASS subtitle file (`ass.ts`) drawn
 * by libass during the encode that was happening regardless, which is both
 * free and frame-accurate.
 */
const PROJECT = path.join(process.cwd(), "remotion");

export type GraphicKind =
  | "title"
  | "lower-third"
  | "statement"
  | "chapter"
  | "end-card"
  | "stat"
  | "quote"
  | "bracket"
  | "ticker"
  | "badge"
  | "image"
  | "icon";

export type GraphicSpec = {
  kind: GraphicKind;
  text: string;
  sub?: string | null;
  startMs: number;
  endMs: number;
  /** For `image`: a local path to the picture, already pulled from storage. */
  imagePath?: string | null;
  /** For `image`: the file's type, which decides the white card. */
  imageMime?: string | null;
  /** For `icon`: which one. */
  icon?: string | null;
  /** Where it sits: a corner, the middle, or the whole frame. */
  placement?: string | null;
  /** Share of the frame height, 5–90. */
  scale?: number | null;
  /** How it arrives: fade, rise, pop, slide, drop. See `ENTRANCES`. */
  enter?: string | null;
};

/** Whether this machine can draw graphics at all. */
export async function graphicsAvailable(): Promise<boolean> {
  return Boolean(await stat(path.join(PROJECT, "node_modules", "remotion")).catch(() => null));
}

/**
 * Draw every graphic of a render, in one browser.
 *
 * `remotion/render-stills.mjs` bundles the composition once (cached beside
 * the sources until they change) and draws each still through one Chrome.
 * The CLI did the bundle and the browser launch per still, which was eleven
 * seconds a graphic and most of the wait on a render with fourteen of them.
 * Pictures are placed by FFmpeg, as before, and never reach the browser.
 */
export async function renderGraphics(
  specs: GraphicSpec[],
  opts: { width: number; height: number; accent: string; dir: string },
): Promise<string[]> {
  const outs = specs.map((_, i) => path.join(opts.dir, `graphic-${i}.png`));
  const drawn: { out: string; props: unknown }[] = [];

  for (const [i, spec] of specs.entries()) {
    if (spec.kind === "image") {
      if (!spec.imagePath) throw new Error("that image is not in the store any more");
      await placeImage(spec, { ...opts, out: outs[i] });
      continue;
    }
    const seconds = Math.max(0.5, (spec.endMs - spec.startMs) / 1000);
    drawn.push({
      out: outs[i],
      props: {
        cues: [],
        style: null,
        accent: opts.accent,
        graphics: [
          {
            kind: spec.kind,
            text: spec.text,
            sub: spec.sub ?? null,
            icon: spec.icon ?? null,
            placement: spec.placement ?? null,
            scale: spec.scale ?? null,
            start: 0,
            seconds: Math.max(seconds, 1.5),
          },
        ],
      },
    });
  }

  /*
   * Stills are cached by what they are. The director renders a video and the
   * export renders it again with the same fourteen titles; the second time
   * nothing about a title has changed, and Chrome is eleven seconds a still
   * on this box. The key is the still's props, the frame size and the
   * bundle's identity (which changes when the composition source changes),
   * so an edited title or a new Graphics.tsx draws fresh.
   */
  const generation = await bundleGeneration();
  const cacheDir = path.join(PROJECT, ".stills");
  await mkdir(cacheDir, { recursive: true });
  const keyed = drawn.map((d) => ({
    ...d,
    cached: path.join(
      cacheDir,
      `${createHash("sha1").update(JSON.stringify({ g: generation, w: opts.width, h: opts.height, p: d.props })).digest("hex")}.png`,
    ),
  }));
  const fresh: typeof keyed = [];
  for (const d of keyed) {
    const hit = await copyFile(d.cached, d.out).then(() => true, () => false);
    if (!hit) fresh.push(d);
  }

  if (fresh.length) {
    const specsPath = path.join(opts.dir, "stills.json");
    await writeFile(
      specsPath,
      JSON.stringify({ width: opts.width, height: opts.height, accent: opts.accent, graphics: fresh.map(({ out, props }) => ({ out, props })) }),
    );
    await runNode(["render-stills.mjs", specsPath], PROJECT, 4 * 60_000 + fresh.length * 20_000);
    for (const d of fresh) {
      const size = (await stat(d.out).catch(() => null))?.size ?? 0;
      if (size < 500) throw new Error("a graphic came out empty");
      await copyFile(d.out, d.cached).catch(() => {});
    }
  }
  if (drawn.length) console.log(`[graphics] ${drawn.length - fresh.length} of ${drawn.length} stills from cache`);

  return outs;
}

/** The newest bundle's name: it is a hash of the composition sources. */
async function bundleGeneration(): Promise<string> {
  const dir = path.join(PROJECT, ".bundle");
  const names = await readdir(dir).catch(() => [] as string[]);
  let newest = { name: "none", at: 0 };
  for (const name of names) {
    const at = (await stat(path.join(dir, name)).catch(() => null))?.mtimeMs ?? 0;
    if (at > newest.at) newest = { name, at };
  }
  return newest.name;
}

function runNode(args: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (c) => {
      if (stderr.length < 4000) stderr += String(c);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("the graphics render timed out"));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`the graphics renderer could not start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`the graphics renderer exited ${code}: ${stderr.slice(0, 600)}`));
    });
  });
}


/**
 * A picture from the file store, sized and placed on a transparent frame.
 *
 * `scale` is a share of the frame's height, so the same graphic reads the same
 * in 16:9 and 9:16. A picture placed in a corner keeps a margin; "full" fills
 * the frame and is the one case where it covers the footage rather than
 * sitting on it.
 */
async function placeImage(
  spec: GraphicSpec,
  opts: { width: number; height: number; dir: string; out: string },
): Promise<string> {
  const share = Math.min(0.95, Math.max(0.05, (spec.scale ?? 40) / 100));
  const margin = Math.round(opts.height * 0.05);

  const boxH = spec.placement === "full" ? opts.height : Math.round(opts.height * share);
  const boxW =
    spec.placement === "full"
      ? opts.width
      : Math.min(
          Math.round(opts.width * share * 1.2),
          inCorner(spec.placement) ? Math.round(opts.width * CORNER_MAX_W) : opts.width,
        );

  /* A logo is a shape with holes in it: the studio's Anthropic wordmark is
     near-black on nothing, so over a dark cutaway it was black on black. A
     picture that carries transparency is set on a white card that hugs it;
     a photograph brings its own background and is left alone. */
  const source = cardBehindPicture(spec.imageMime, spec.placement) ? await pictureSize(spec.imagePath!) : null;
  /* The card has to hug the picture, so its size is settled here rather than
     inside the filtergraph: `force_original_aspect_ratio` works out the
     fitted size in there, where nothing downstream can ask what it came to. */
  const card = source
    ? (() => {
        const pad = Math.round(opts.height * CARD_PAD);
        const fit = Math.min(
          Math.max(1, boxW - pad * 2) / source.w,
          Math.max(1, boxH - pad * 2) / source.h,
        );
        const pw = Math.max(1, Math.round(source.w * fit));
        const ph = Math.max(1, Math.round(source.h * fit));
        const w = pw + pad * 2;
        const h = ph + pad * 2;
        return {
          pad,
          pw,
          ph,
          w,
          h,
          r: Math.max(2, Math.min(Math.round(opts.height * CARD_RADIUS), Math.floor(Math.min(w, h) / 2) - 1)),
        };
      })()
    : null;

  const x =
    spec.placement === "full"
      ? "(W-w)/2"
      : spec.placement === "top-left" || spec.placement === "bottom-left"
        ? String(margin)
        : spec.placement === "top-right" || spec.placement === "bottom-right"
          ? "W-w-" + margin
          : "(W-w)/2";
  const y =
    spec.placement === "full"
      ? "(H-h)/2"
      : spec.placement === "top-left" || spec.placement === "top-right"
        ? String(Math.round(opts.height * HEADER_BAND))
        : spec.placement === "bottom-left" || spec.placement === "bottom-right" || spec.placement === "bottom-center"
          ? "H-h-" + Math.round(opts.height * 0.12)
          : "(H-h)/2";

  /* Full frame sits on black, the way a product shot does on the channel;
     anything smaller sits on nothing, over the footage. */
  const graph: string[] = card
    ? [
        `[1:v]scale=${card.pw}:${card.ph}:flags=bicubic,format=rgba[pic]`,
        /* A white rounded rectangle: opaque everywhere, except within a
           corner's radius of its centre, where the distance takes the alpha
           down over half a pixel. */
        `[2:v]format=rgba,geq=r=255:g=255:b=255:` +
          `a='255*clip(${card.r}-hypot(max(max(${card.r}-X,X-${card.w - 1 - card.r}),0),max(max(${card.r}-Y,Y-${card.h - 1 - card.r}),0))+0.5,0,1)'[card]`,
        `[card][pic]overlay=x=${card.pad}:y=${card.pad}:format=auto[chip]`,
        `[0:v][chip]overlay=x=${x}:y=${y}:format=auto[out]`,
      ]
    : [
        `[1:v]scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,format=rgba[pic]`,
        `[0:v][pic]overlay=x=${x}:y=${y}:format=auto[out]`,
      ];

  await ffmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${spec.placement === "full" ? "black@1.0" : "black@0.0"}:s=${opts.width}x${opts.height},format=rgba`,
    "-i",
    spec.imagePath!,
    ...(card ? ["-f", "lavfi", "-i", `color=c=white:s=${card.w}x${card.h},format=rgba`] : []),
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[out]",
    "-frames:v",
    "1",
    opts.out,
  ]);

  if ((await stat(opts.out)).size < 200) throw new Error("that image came out empty");
  return opts.out;
}

/** A picture's own pixel size, for sizing the card that goes behind it. */
async function pictureSize(file: string): Promise<{ w: number; h: number } | null> {
  const out = await new Promise<string>((resolve) => {
    const child = spawn(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let text = "";
    child.stdout?.on("data", (c) => {
      text += String(c);
    });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(text));
  });
  const [w, h] = out.trim().split(",").map((n) => Number(n));
  return w > 0 && h > 0 ? { w, h } : null;
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (c) => {
      if (stderr.length < 2000) stderr += String(c);
    });
    child.on("error", (e) => reject(new Error(`ffmpeg could not start: ${e.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`)),
    );
  });
}

/**
 * The FFmpeg filter that lays the graphics over the picture.
 *
 * Each still is one `overlay` gated to its own seconds, with the alpha faded
 * in over 0.22s and out over 0.16s — in slower than out, because arriving is
 * the idea and leaving is not — and one of five arrivals, all on the same
 * ease-out curve so a run of graphics reads as one hand:
 *
 *   fade   a small upward settle, the default
 *   rise   the same, from further below
 *   pop    scaled up from 0.9, for a number or a word that is the point
 *   slide  in from the left and stops
 *   drop   in from above
 *
 * Returns null when there is nothing to lay over anything, so the caller can
 * keep its simpler command.
 */
export function overlayFilter(
  specs: GraphicSpec[],
  opts: { width: number; height: number; firstInput?: number; from?: string; out?: string },
): { filter: string; inputs: string[] } | null {
  if (specs.length === 0) return null;

  const first = opts.firstInput ?? 1;
  const parts: string[] = [];
  let chain = opts.from ?? "[0:v]";
  const IN = 0.22;

  specs.forEach((spec, i) => {
    const start = spec.startMs / 1000;
    const end = spec.endMs / 1000;
    const s = start.toFixed(3);
    const label = i === specs.length - 1 ? (opts.out ?? "[vout]") : `[v${i}]`;
    const enter = spec.enter ?? "fade";
    // 0 → 1 over the arrival, eased out, and 1 after. Everything below is a
    // function of this one number.
    const p = `min(1,(t-${s})/${IN})`;
    const ease = `(1-pow(1-${p},2))`;

    /*
     * The still is read only for its own window (`-t` on its input), so its
     * chain runs on its own clock: the fades and the pop are in local time,
     * and `setpts` moves it to where it sits on the film. It used to be a
     * looped input decoded on every frame of the whole video, twenty-five
     * times over on a busy cut, and that was most of the render.
     */
    const dur = Math.max(0.5, end - start);
    const local = `min(1,t/${IN})`;
    const localEase = `(1-pow(1-${local},2))`;
    const pre: string[] = ["format=rgba"];
    if (enter === "pop") {
      pre.push(`scale=w='iw*(0.9+0.1*${localEase})':h='ih*(0.9+0.1*${localEase})':eval=frame:flags=bilinear`);
    } else if (enter === "slam") {
      // A size too big, landing in a quarter of a second.
      pre.push(`scale=w='iw*(1.18-0.18*${localEase})':h='ih*(1.18-0.18*${localEase})':eval=frame:flags=bilinear`);
    } else if (enter === "zoom") {
      // The slow push a cutaway gets: 1.0 to 1.08 across the whole window,
      // cropped back to the frame so the edges never show.
      // The still is the frame's own size, so the crop back is a fixed
      // width and height with a per-frame centre: crop's w and h are
      // evaluated once and cannot follow t, but x and y can.
      pre.push(
        `scale=w='iw*(1+0.08*min(1,t/${dur.toFixed(3)}))':h='ih*(1+0.08*min(1,t/${dur.toFixed(3)}))':eval=frame:flags=bilinear`,
        `crop=${opts.width}:${opts.height}:(iw-${opts.width})/2:(ih-${opts.height})/2`,
      );
    }
    pre.push(
      `fade=t=in:st=0:d=${IN}:alpha=1`,
      `fade=t=out:st=${Math.max(0, dur - 0.16).toFixed(3)}:d=0.16:alpha=1`,
      `setpts=PTS-STARTPTS+${s}/TB`,
    );
    parts.push(`[${first + i}:v]${pre.join(",")}[g${i}]`);

    let x = "0";
    let y = "0";
    const lift = Math.round(opts.height * 0.012);
    const riseBy = Math.round(opts.height * 0.045);
    const slideBy = Math.round(opts.width * 0.06);
    if (enter === "pop" || enter === "slam" || enter === "zoom") {
      x = "(W-w)/2";
      y = "(H-h)/2";
    } else if (enter === "rise") {
      y = `'if(lt(t,${(start + IN).toFixed(3)}), ${riseBy}*(1-${ease}), 0)'`;
    } else if (enter === "slide") {
      x = `'if(lt(t,${(start + IN).toFixed(3)}), -${slideBy}*(1-${ease}), 0)'`;
    } else if (enter === "drop") {
      y = `'if(lt(t,${(start + IN).toFixed(3)}), -${riseBy}*(1-${ease}), 0)'`;
    } else {
      y = `'if(lt(t,${(start + IN).toFixed(3)}), ${lift}*(1-${ease}), 0)'`;
    }

    parts.push(
      `${chain}[g${i}]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${s},${end.toFixed(3)})'${label}`,
    );
    chain = label;
  });

  return { filter: parts.join(";"), inputs: specs.map((_, i) => `graphic-${i}.png`) };
}

/* ---------------------------------------------------------- cutaways */

export type BrollSpec = {
  /** Local path to the clip, already pulled from storage. */
  path: string;
  startMs: number;
  endMs: number;
  /** Where in the source the cutaway begins. */
  sourceInMs: number;
  /** `full` covers the frame; `pip` covers it with the speaker kept in a
   * circle at the top right (the channel's own layout); a corner sits over
   * it at `scale` of the height. */
  placement: string;
  scale: number;
};

/**
 * Cutaways over the picture, the speaker's sound continuing underneath.
 *
 * Each clip is trimmed at input, scaled to fill the frame (or to a corner),
 * moved onto the timeline with `setpts`, and laid over the chain for exactly
 * its window with a short fade at each end. The interview's own audio is not
 * touched: a cutaway is a picture over a sentence, not a replacement for it.
 */
export function brollFilter(
  specs: BrollSpec[],
  opts: { width: number; height: number; firstInput: number; from: string; out: string; accent?: string },
): string | null {
  if (specs.length === 0) return null;
  const parts: string[] = [];
  let chain = opts.from;
  const { width: W, height: H } = opts;

  /*
   * The speaker in a circle, made once for every picture-in-picture cutaway.
   *
   * The channel's editor keeps the presenter on screen while the footage
   * fills the frame: a circle at the top right, under the header, with a
   * thin ring in the accent. One crop of the speaker around the face, one
   * alpha circle drawn by `geq` with a half-pixel soft edge, split as many
   * ways as there are cutaways that want it — the per-pixel expression runs
   * on a 300-pixel square, not on the frame.
   */
  const pips = specs.filter((b) => b.placement === "pip");
  const circles: string[] = [];
  if (pips.length) {
    const portrait = H > W;
    // Head and shoulders, centred where a seated presenter's face sits in
    // the channel's own framing (about two fifths down a portrait frame).
    const side = Math.round(portrait ? W * 0.56 : H * 0.62);
    const cx = Math.round(W / 2);
    const cy = Math.round(portrait ? H * 0.4 : H * 0.46);
    const x0 = Math.max(0, Math.min(W - side, cx - Math.round(side / 2)));
    const y0 = Math.max(0, Math.min(H - side, cy - Math.round(side / 2)));
    const D = Math.round(portrait ? W * 0.28 : H * 0.3);
    const ring = 4;
    const inner = D - ring * 2;
    const R = D / 2;
    // A white ring, as measured from the editor's own cut; the accent is
    // kept for the type, not the frame.
    const accent = "white";
    const labels = pips.map((_, k) => `[pc${k}]`);
    parts.push(`${opts.from}split=2[pmain][pspk]`);
    parts.push(
      `[pspk]crop=${side}:${side}:${x0}:${y0},scale=${inner}:${inner},pad=${D}:${D}:${ring}:${ring}:color=${accent},format=rgba,` +
        `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip(${R.toFixed(1)}-sqrt(pow(X-${R.toFixed(1)},2)+pow(Y-${R.toFixed(1)},2))+0.5,0,1)',` +
        `split=${pips.length}${labels.join("")}`,
    );
    circles.push(...labels);
    chain = "[pmain]";
  }
  // Centre at (0.74 W, 0.31 H) on a portrait frame, measured from the
  // editor's cut: under the header, clear of the captions, off the face.
  const pipD = H > W ? W * 0.28 : H * 0.3;
  const pipX = Math.round((H > W ? W * 0.74 : W * 0.8) - pipD / 2);
  const pipY = Math.round((H > W ? H * 0.31 : H * 0.28) - pipD / 2);

  specs.forEach((b, i) => {
    const start = b.startMs / 1000;
    const end = b.endMs / 1000;
    const dur = Math.max(0.2, end - start);
    const pip = b.placement === "pip";
    const full = pip || b.placement === "full" || !b.placement;
    const share = Math.min(0.9, Math.max(0.15, b.scale / 100));
    const h = full ? H : Math.round(H * share);
    const w = full ? W : Math.round((h * 16) / 9);
    const margin = Math.round(H * 0.05);

    // Full-frame footage is taken down a step and vignetted, so the caption
    // over it reads and the cutaway sits behind the words rather than
    // competing with them, which is how the channel's own cutaways look.
    // Full-frame footage is taken down a step (a quarter under the pip, as
    // the editor does, so the circle reads) and vignetted.
    const tone = pip ? "eq=brightness=-0.12:saturation=0.85,vignette=PI/4," : full ? "eq=brightness=-0.05:saturation=0.9,vignette=PI/4.5," : "";
    parts.push(
      `[${opts.firstInput + i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
        `fps=30,${tone}fade=t=in:st=0:d=0.18,fade=t=out:st=${Math.max(0, dur - 0.14).toFixed(3)}:d=0.14,` +
        `setpts=PTS-STARTPTS+${start.toFixed(3)}/TB[b${i}]`,
    );

    const x = full ? "0" : b.placement.endsWith("left") ? String(margin) : `W-w-${margin}`;
    const y = full ? "0" : b.placement.startsWith("top") ? String(margin) : `H-h-${margin}`;
    const label = i === specs.length - 1 ? opts.out : `[bv${i}]`;
    const window = `enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`;
    if (pip) {
      const circle = circles.shift();
      parts.push(`${chain}[b${i}]overlay=x=0:y=0:eof_action=pass:${window}[bp${i}]`);
      parts.push(`[bp${i}]${circle}overlay=x=${pipX}:y=${pipY}:eof_action=pass:${window}${label}`);
    } else {
      parts.push(`${chain}[b${i}]overlay=x=${x}:y=${y}:eof_action=pass:${window}${label}`);
    }
    chain = label;
  });

  return parts.join(";");
}

/* ---------------------------------------------------------- punch-ins */

export type PunchSpec = { startMs: number; endMs: number; zoom: number };

/**
 * The picture pushing in on the speaker for a beat.
 *
 * One `scale` with a per-frame factor and a centred crop back to size. The
 * push takes a quarter of a second and holds; the cut back is instant, which
 * is how a punch-in reads as emphasis rather than as a camera move. Punches
 * never overlap — the writer refuses one that would — so the factors can
 * simply be summed.
 */
export function punchFilter(specs: PunchSpec[], opts: { width: number; height: number; from: string; out: string }): string | null {
  if (specs.length === 0) return null;
  const terms = specs.map((p) => {
    const s = (p.startMs / 1000).toFixed(3);
    const e = (p.endMs / 1000).toFixed(3);
    const z = (Math.max(1.02, Math.min(1.6, p.zoom)) - 1).toFixed(3);
    return `${z}*between(t,${s},${e})*min(1,(t-${s})/0.25)`;
  });
  const Z = `(1+${terms.join("+")})`;
  return (
    `${opts.from}scale=w='iw*${Z}':h='ih*${Z}':eval=frame:flags=bilinear,` +
    `crop=${opts.width}:${opts.height}:(iw-${opts.width})/2:(ih-${opts.height})/2${opts.out}`
  );
}

/* =================================================================== v2 */
/*
 * Director v2: the compositor's building blocks (PLAN.md §1 and §2 W5).
 *
 * Everything below is a pure string builder: it takes the plan's numbers and
 * the ffmpeg input indices the renderer assigned, and returns filtergraph
 * text. Nothing here opens a file except `makeMasks`, which draws two small
 * PNGs once per render. The rules these encode:
 *
 *   - **The host is framed on the eye line, statically, per cut.** A crop and
 *     a scale whose numbers are settled here in TypeScript, not a per-frame
 *     expression on the whole video. A push (slow 1.00→1.05 on a long take, a
 *     snap to 1.18 on a punchline) runs its per-frame `scale` inside its own
 *     segment only: Report A measured a whole-video `eval=frame` scale at
 *     +16 % of the encode against nothing for a windowed one.
 *   - **Three cutaway layouts, never the v1 34 % window.** `full` covers the
 *     frame; `split` puts a landscape clip at 1080×608 under the header with
 *     the host shifted down so her eyes sit at y ≈ 1150; `run` is the
 *     channel's own layout — the presenter in a circle over darkened footage.
 *     The split's rounded corners and the run's circle are static PNG masks
 *     through `alphamerge`, computed once: the v1 circle was a `geq`
 *     expression per pixel per frame, and Report A put that at +200 %.
 *   - **The host inside a `split` or `run` window is a seeked input, never a
 *     trim of the main stream.** A branch of the joined picture that starts
 *     late has to be buffered by ffmpeg until it starts — a 4-minute film
 *     is 25 GB of frames — where a second demuxer on the source costs one
 *     decoder for the window's own seconds and holds nothing.
 *   - **Motion clips are VP9 with alpha**, decoded by `libvpx-vp9` (the
 *     native decoder throws the alpha plane away and draws a black card) and
 *     laid on with `overlay` at their bounding box. A static hold is one PNG
 *     frame that `overlay` repeats — its default `eof_action` — for exactly
 *     the window `enable` opens.
 */

/* ---------------------------------------------------------- framing */

/**
 * How a host cut is framed: the zoom and the point it is anchored on.
 *
 * `eyeOut`, when the planner gives it, is where the anchor's y lands in the
 * output as a share of the height (director v2's layout drops the eye line
 * to 0.50 under a Zone-T card so the card clears the forehead). The planner
 * then owns the zoom as well: it has already chosen a scale that fills the
 * frame with the eyes there, so the `EYE_MAX` floor, which exists to lift
 * the eyes to 0.34, does not apply. Without it the anchor lands at
 * `EYE_TARGET` as before.
 */
export type Framing = { zoom: number; anchor: [number, number]; eyeOut?: number };

/** The zoom floor for a framing: none when the planner placed the eye line itself. */
const floorOf = (f: Framing): number => (f.eyeOut !== undefined ? 1 : minFramingZoom({ eyeY: f.anchor[1] }));

/** The hardest the picture is ever pushed in (§1). */
export const ZOOM_MAX = 1.25;

/**
 * The static crop for a host cut.
 *
 * The crop is W/z × H/z, placed so the anchor's x is centred and its y (the
 * eye line) lands at `EYE_TARGET`, each clamped to the frame. When the zoom
 * asked for cannot lift the eyes to `EYE_MAX` — a 1.00 on footage whose eyes
 * sit at 40 % — the zoom is raised to the least that can (`minFramingZoom`),
 * so the eye-line gate holds whatever the planner sent; `raised` says so.
 * Null when the effective zoom is 1: the caller keeps the plain normalise
 * chain, which is also what keeps the v1 path's command byte-identical.
 */
export function framingCrop(
  f: Framing,
  size: { width: number; height: number },
): { zoom: number; w: number; h: number; x: number; y: number; eyeOut: number; raised: boolean } | null {
  const [ax, ay] = f.anchor;
  const floor = floorOf(f);
  const target = f.eyeOut ?? EYE_TARGET;
  const zoom = Math.min(ZOOM_MAX, Math.max(f.zoom, floor));
  if (zoom <= 1.0005) return null;
  const { width: W, height: H } = size;
  const w = even(Math.round(W / zoom));
  const h = even(Math.round(H / zoom));
  const x = Math.round(clamp(ax * W - w / 2, 0, W - w));
  const y = Math.round(clamp(ay * H - target * h, 0, H - h));
  return { zoom, w, h, x, y, eyeOut: (ay * H - y) / h, raised: zoom > f.zoom + 1e-6 };
}

/** The crop above as filter text, or an empty string for no crop. */
export function framingChain(f: Framing, size: { width: number; height: number }): string {
  const c = framingCrop(f, size);
  return c ? `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${size.width}:${size.height}:flags=bicubic,` : "";
}

/**
 * A push, as a per-frame chain for its own segment.
 *
 * Z(t) rises from the cut's effective zoom to `to` over `rampS` seconds and
 * holds; the crop follows the same anchor rule as the static frame, so the
 * first frame of the segment is the same picture as the last frame of the
 * static one before it. The same floor and ceiling apply, so a plan cannot
 * push past 1.25.
 *
 * The crop's window is written in `t` and the frame size, never in `iw`/
 * `ih`: `crop` evaluates those once, at the first frame, and keeps them
 * while the frames from a per-frame `scale` grow — so a window written as
 * `(iw-W)/2` stops following the centre and the picture slides toward the
 * top-left as it zooms. (The v1 punch-in is written that way; it is left
 * as it is.) Here the scaled size at time t is W·Z(t) by construction.
 */
export function pushChain(from: Framing, to: number, rampS: number, size: { width: number; height: number }): string {
  const [ax, ay] = from.anchor;
  const z0 = Math.min(ZOOM_MAX, Math.max(from.zoom, floorOf(from)));
  const target = from.eyeOut ?? EYE_TARGET;
  const z1 = Math.min(ZOOM_MAX, Math.max(z0, to));
  const { width: W, height: H } = size;
  const ramp = Math.max(1 / 30, rampS).toFixed(3);
  const Z = `(${z0.toFixed(4)}+${(z1 - z0).toFixed(4)}*min(1,t/${ramp}))`;
  return (
    `scale=w='iw*${Z}':h='ih*${Z}':eval=frame:flags=bilinear,` +
    `crop=${W}:${H}:x='clip(${(ax * W).toFixed(1)}*${Z}-${W / 2},0,${W}*${Z}-${W})':y='clip(${(ay * H).toFixed(1)}*${Z}-${(target * H).toFixed(1)},0,${H}*${Z}-${H})',`
  );
}

/** What the effective framing of a cut comes to, for reports and lints. */
export function effectiveZoom(f: Framing): number {
  return Math.min(ZOOM_MAX, Math.max(f.zoom, floorOf(f)));
}

/* ---------------------------------------------------------- layouts */

/**
 * The layout numbers, as shares of the frame so a 16:9 export of a v2 plan
 * does not break; the px values in §1 are these on 1080×1920.
 */
export const LAYOUT = {
  /** `split`: the clip's band and its corner radius; the host under it. */
  splitTop: 230 / 1920,
  splitHeight: 608 / 1920,
  splitRadius: 24 / 1080,
  splitHostZoom: 1.12,
  splitEyeY: 1150 / 1920,
  /** `run`: the circle's centre and diameter (HOUSE_FORMAT, measured), ring width, footage level. */
  runCentre: [0.74, 0.31] as [number, number],
  runDiameter: 0.28,
  runRing: 4 / 1080,
  runFootage: 0.55,
  /** One grade for every fetched picture (§1). */
  grade: "eq=saturation=0.87:contrast=1.03,vignette=angle=PI/5",
  /** The push on a `full` clip and on a still, and the still's pan. */
  fullPush: 0.04,
  stillPush: 0.08,
  stillPan: 0.02,
} as const;

/** The pixel geometry of the layouts at a frame size. */
export function layoutGeometry(size: { width: number; height: number }) {
  const { width: W, height: H } = size;
  const D = even(Math.round(W * LAYOUT.runDiameter));
  return {
    split: { x: 0, y: Math.round(H * LAYOUT.splitTop), w: W, h: even(Math.round(H * LAYOUT.splitHeight)), r: Math.max(2, Math.round(W * LAYOUT.splitRadius)) },
    run: {
      d: D,
      ring: Math.max(1, Math.round(W * LAYOUT.runRing)),
      x: Math.round(W * LAYOUT.runCentre[0] - D / 2),
      y: Math.round(H * LAYOUT.runCentre[1] - D / 2),
    },
  };
}

/**
 * The two static masks, drawn once per render: a rounded rectangle the size
 * of the split band and a circle the size of the run's presenter. Grey
 * PNGs — `alphamerge` reads their luma as alpha — with a half-pixel soft
 * edge, the same expression `placeImage` uses for its card.
 */
export async function makeMasks(opts: { width: number; height: number; dir: string }): Promise<{ rounded: string; circle: string }> {
  const g = layoutGeometry(opts);
  const rounded = path.join(opts.dir, "mask-rounded.png");
  const circle = path.join(opts.dir, "mask-circle.png");
  const { w, h, r } = g.split;
  await ffmpeg([
    "-y", "-f", "lavfi", "-i", `color=c=black:s=${w}x${h},format=gray`,
    "-vf", `geq=lum='255*clip(${r}-hypot(max(max(${r}-X,X-${w - 1 - r}),0),max(max(${r}-Y,Y-${h - 1 - r}),0))+0.5,0,1)'`,
    "-frames:v", "1", rounded,
  ]);
  const R = g.run.d / 2;
  await ffmpeg([
    "-y", "-f", "lavfi", "-i", `color=c=black:s=${g.run.d}x${g.run.d},format=gray`,
    "-vf", `geq=lum='255*clip(${R.toFixed(1)}-hypot(X-${(R - 0.5).toFixed(1)},Y-${(R - 0.5).toFixed(1)})+0.5,0,1)'`,
    "-frames:v", "1", circle,
  ]);
  return { rounded, circle };
}

/**
 * An overlay's window on the film, as the `t` of the frames it covers.
 *
 * A frame at n/30 s has a `t` that is n/30 in the output's timebase and not
 * always in floating point: a cutaway asked for at 17.100 s tested
 * `between(t,17.100,…)` on a frame whose `t` came out 17.0999… and landed a
 * frame late, and every cutaway and motion clip in the lab render did (14 of
 * 14, measured). The window is opened half a frame early and closed half a
 * frame early instead, which makes the first frame the *nearest* frame to
 * `startMs` and the last the frame before the nearest to `endMs` — the same
 * count of frames, on the plan's clock. The overlay stream itself is moved
 * by the same half frame so `overlay` has its first frame in hand when the
 * window opens (it takes the overlay frame nearest below the main frame's
 * `t`, and a stream that starts exactly on the window would miss by the
 * same rounding).
 */
export function windowOf(startMs: number, endMs: number): { s: string; e: string; enable: string } {
  const half = 1 / 60;
  const s = Math.max(0, startMs / 1000 - half).toFixed(4);
  const e = Math.max(0, endMs / 1000 - half).toFixed(4);
  return { s, e, enable: `enable='between(t,${s},${e})'` };
}

/** A piece of the host read straight from the source for a cutaway window. */
export type HostInsert = {
  /** ffmpeg input index of the seeked source piece. */
  input: number;
  /** Where on the film the piece sits. */
  startMs: number;
  endMs: number;
  /** The face anchor of that source: [centre x, eye line]. */
  anchor: [number, number];
  /** The face box's height as a share of the frame, for the circle's crop. */
  faceHeight: number;
};

export type CutawayInput = RenderPlan["cutaways"][number] & {
  /** ffmpeg input index of the clip or still. */
  input: number;
  /** `split`: the host's zoom and eye line under the band, when the planner overrides §1's (see `RenderCutaway`). */
  hostZoom?: number;
  hostEyeY?: number;
  /** `split` / `run`: the host pieces under this window (a run's circle rides on the group's last item, after every clip of the run). */
  hosts?: HostInsert[];
  /** The mask input for this layout: the rounded band for `split`, the circle for `run`. */
  maskInput?: number;
};

/**
 * The cutaways of a v2 plan over the picture.
 *
 * Every clip is read from its own in point for its own window (the renderer
 * seeks it at the demuxer), scaled to cover, cropped at `cropX`, graded once,
 * and laid on for exactly `[startMs, endMs)`. Hard cuts: a reel's cutaways
 * land on the noun, not fade in behind it.
 */
export function cutawayFilter(
  specs: CutawayInput[],
  opts: { width: number; height: number; from: string; out: string },
): string | null {
  if (!specs.length) return null;
  const { width: W, height: H } = opts;
  const g = layoutGeometry(opts);
  const parts: string[] = [];
  let chain = opts.from;
  let n = 0;
  const next = (last: boolean) => (last ? opts.out : `[cw${n++}]`);

  /**
   * Cover the box, then crop it around the subject's x. The push and the
   * pan are per-frame scales; the crop's `iw`/`ih` are frozen at the first
   * frame (see `pushChain`), which is the cover size at Z = 1, so the
   * window is written as that size times Z(t).
   */
  const cover = (bw: number, bh: number, cropX: number, push: number, pan: number, durS: number) => {
    const Z = push > 0 ? `(1+${push.toFixed(3)}*min(1,t/${durS.toFixed(3)}))` : "1";
    const p = push > 0 ? `*${Z}` : "";
    const cx = pan > 0 ? `(${(cropX - pan / 2).toFixed(4)}+${pan.toFixed(4)}*min(1,t/${durS.toFixed(3)}))` : cropX.toFixed(4);
    return (
      `scale=w='max(${bw},${bh}*iw/ih)${p}':h='max(${bh},${bw}*ih/iw)${p}':eval=frame:flags=bicubic:force_divisible_by=2,` +
      `crop=${bw}:${bh}:x='clip(${cx}*iw*${Z}-${bw / 2},0,iw*${Z}-${bw})':y='clip(0.5*ih*${Z}-${bh / 2},0,ih*${Z}-${bh})',`
    );
  };

  specs.forEach((c, i) => {
    const last = i === specs.length - 1;
    const { s, enable: win } = windowOf(c.startMs, c.endMs);
    const dur = Math.max(0.2, (c.endMs - c.startMs) / 1000);
    const cropX = clamp(Number.isFinite(c.cropX) ? c.cropX : 0.5, 0, 1);
    const still = Boolean(c.still);
    const layout: Layout = c.layout ?? "full";

    if (layout === "full") {
      parts.push(
        `[${c.input}:v]${cover(W, H, cropX, still ? LAYOUT.stillPush : LAYOUT.fullPush, still ? LAYOUT.stillPan : 0, dur)}` +
          `${LAYOUT.grade},fps=30,setsar=1,format=yuv420p,setpts=PTS-STARTPTS+${s}/TB[ca${i}]`,
      );
      const label = next(last);
      parts.push(`${chain}[ca${i}]overlay=x=0:y=0:eof_action=pass:${win}${label}`);
      chain = label;
      return;
    }

    if (layout === "split") {
      /* The host first: the source at 1.12, moved so the eye line sits on
         `splitEyeY`, cropped to what is visible and laid over the frame; the
         clip's band then covers the seam. */
      for (const [j, h] of (c.hosts ?? []).entries()) {
        const z = clamp(c.hostZoom ?? LAYOUT.splitHostZoom, 1, ZOOM_MAX);
        const eyeY = clamp(c.hostEyeY ?? LAYOUT.splitEyeY, 0.3, 0.8);
        const sw = even(Math.round(W * z));
        const sh = even(Math.round(H * z));
        const xOff = Math.round(W / 2 - h.anchor[0] * sw);
        const yOff = Math.round(H * eyeY - h.anchor[1] * sh);
        const vx0 = Math.max(0, -xOff);
        const vy0 = Math.max(0, -yOff);
        const vw = even(Math.min(sw, W - Math.max(0, xOff)) - vx0);
        const vh = even(Math.min(sh, H - Math.max(0, yOff)) - vy0);
        const hw = windowOf(h.startMs, h.endMs);
        parts.push(
          `[${h.input}:v]setpts=PTS-STARTPTS,${normalise(W, H)}scale=${sw}:${sh}:flags=bicubic,crop=${vw}:${vh}:${vx0}:${vy0},` +
            `fps=30,setsar=1,format=yuv420p,setpts=PTS-STARTPTS+${hw.s}/TB[ch${i}_${j}]`,
        );
        const label = next(false);
        parts.push(`${chain}[ch${i}_${j}]overlay=x=${Math.max(0, xOff)}:y=${Math.max(0, yOff)}:eof_action=pass:${hw.enable}${label}`);
        chain = label;
      }
      const { x, y, w, h } = g.split;
      const mask = c.maskInput !== undefined ? `[${c.maskInput}:v]format=gray[cm${i}];` : "";
      parts.push(
        `${mask}[${c.input}:v]${cover(w, h, cropX, still ? LAYOUT.stillPush : 0, still ? LAYOUT.stillPan : 0, dur)}` +
          `${LAYOUT.grade},fps=30,setsar=1,format=yuva420p${mask ? `[cb${i}];[cb${i}][cm${i}]alphamerge` : ""},setpts=PTS-STARTPTS+${s}/TB[ca${i}]`,
      );
      const label = next(last);
      parts.push(`${chain}[ca${i}]overlay=x=${x}:y=${y}:eof_action=pass:${win}${label}`);
      chain = label;
      return;
    }

    /* run: footage full frame, taken down to 55 %, then the presenter in a
       circle for the whole run (the hosts ride on the group's last item, so
       no later clip of the run paints over the circle). */
    parts.push(
      `[${c.input}:v]${cover(W, H, cropX, still ? LAYOUT.stillPush : 0, still ? LAYOUT.stillPan : 0, dur)}` +
        `${LAYOUT.grade},colorlevels=romax=${LAYOUT.runFootage}:gomax=${LAYOUT.runFootage}:bomax=${LAYOUT.runFootage},` +
        `fps=30,setsar=1,format=yuv420p,setpts=PTS-STARTPTS+${s}/TB[ca${i}]`,
    );
    {
      const label = next(last && !(c.hosts ?? []).length);
      parts.push(`${chain}[ca${i}]overlay=x=0:y=0:eof_action=pass:${win}${label}`);
      chain = label;
    }
    const hosts = c.hosts ?? [];
    /* One mask input, split once for as many host pieces as the run spans. */
    const masked = hosts.length > 0 && c.maskInput !== undefined;
    if (masked) {
      parts.push(`[${c.maskInput}:v]format=gray${hosts.length > 1 ? `,split=${hosts.length}` : ""}${hosts.map((_, j) => `[cm${i}_${j}]`).join("")}`);
    }
    for (const [j, h] of hosts.entries()) {
      const { d, ring, x, y } = g.run;
      const inner = d - ring * 2;
      /* Head and shoulders: a square of 1.6 face heights, centred on the face
         and dropped a little so the eyes sit above the circle's middle. */
      const side = even(Math.round(clamp(h.faceHeight * H * 1.6, W * 0.4, W * 0.7)));
      const sx = Math.round(clamp(h.anchor[0] * W - side / 2, 0, W - side));
      const sy = Math.round(clamp(h.anchor[1] * H - side * 0.38, 0, H - side));
      const hw = windowOf(h.startMs, h.endMs);
      parts.push(
        `[${h.input}:v]setpts=PTS-STARTPTS,${normalise(W, H)}crop=${side}:${side}:${sx}:${sy},scale=${inner}:${inner}:flags=bicubic,` +
          `pad=${d}:${d}:${ring}:${ring}:color=white,fps=30,setsar=1,format=yuva420p` +
          `${masked ? `[cc${i}_${j}];[cc${i}_${j}][cm${i}_${j}]alphamerge` : ""},setpts=PTS-STARTPTS+${hw.s}/TB[ch${i}_${j}]`,
      );
      const label = next(last && j === hosts.length - 1);
      parts.push(`${chain}[ch${i}_${j}]overlay=x=${x}:y=${y}:eof_action=pass:${hw.enable}${label}`);
      chain = label;
    }
  });

  return parts.join(";");
}

/* ----------------------------------------------------- motion clips */

/** One rendered part of a motion clip, with the input the renderer gave it. */
export type MotionPart = { path: string; input: number; durationMs: number; still: boolean };
export type MotionInput = Omit<MotionClip, "parts"> & {
  parts: { full?: MotionPart; in?: MotionPart; hold?: MotionPart; out?: MotionPart };
};

/**
 * The motion clips over the picture, at their bounding boxes.
 *
 * A through-animated clip (`full`) plays from `startMs`. A static-after-
 * entrance one is three inputs: `in` from `startMs`, the `hold` PNG from
 * where `in` ends to where `out` begins, `out` ending on `endMs`. Each part
 * runs on its own clock and is moved to its place with `setpts`, as the v1
 * stills are; no per-frame expression anywhere, the motion is in the pixels.
 */
export function motionFilter(clips: MotionInput[], opts: { from: string; out: string }): string | null {
  if (!clips.length) return null;
  const parts: string[] = [];
  let chain = opts.from;
  const layers: { input: number; still: boolean; fromMs: number; toMs: number; x: number; y: number }[] = [];
  for (const c of clips) {
    if (c.parts.full) layers.push({ input: c.parts.full.input, still: c.parts.full.still, fromMs: c.startMs, toMs: c.endMs, x: c.x, y: c.y });
    else {
      const inEnd = c.startMs + (c.parts.in?.durationMs ?? 0);
      const outStart = c.endMs - (c.parts.out?.durationMs ?? 0);
      if (c.parts.hold) layers.push({ input: c.parts.hold.input, still: true, fromMs: inEnd, toMs: Math.max(inEnd, outStart), x: c.x, y: c.y });
      if (c.parts.in) layers.push({ input: c.parts.in.input, still: false, fromMs: c.startMs, toMs: inEnd, x: c.x, y: c.y });
      if (c.parts.out) layers.push({ input: c.parts.out.input, still: false, fromMs: outStart, toMs: c.endMs, x: c.x, y: c.y });
    }
  }
  layers.forEach((l, i) => {
    const { s, enable } = windowOf(l.fromMs, l.toMs);
    const label = i === layers.length - 1 ? opts.out : `[mv${i}]`;
    parts.push(`[${l.input}:v]${l.still ? "format=rgba," : ""}setpts=PTS-STARTPTS+${s}/TB[mc${i}]`);
    /* A still is one frame: `overlay`'s default `eof_action=repeat` keeps
       it for the window; a clip passes the picture through after its end. */
    parts.push(`${chain}[mc${i}]overlay=x=${l.x}:y=${l.y}${l.still ? "" : ":eof_action=pass"}:${enable}${label}`);
    chain = label;
  });
  return parts.join(";");
}

/** The merged furniture still over the whole film: one frame, repeated. */
export function furnitureFilter(input: number, opts: { from: string; out: string }): string {
  return `[${input}:v]format=rgba[furn];${opts.from}[furn]overlay=x=0:y=0${opts.out}`;
}

/* ---------------------------------------------------------- helpers */

/** The per-cut normalise chain the v1 renderer uses, as text (no label). */
export function normalise(W: number, H: number): string {
  return `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,`;
}

function even(n: number): number {
  return n % 2 === 0 ? n : n - 1;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* Re-exported so the renderer reads one module for the framing numbers. */
export { EYE_MAX, EYE_TARGET };
