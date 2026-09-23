import "server-only";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { CARD_PAD, CARD_RADIUS, cardBehindPicture } from "@/lib/video/presets";

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
  const boxW = spec.placement === "full" ? opts.width : Math.round(opts.width * share * 1.2);

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
        ? String(margin)
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
