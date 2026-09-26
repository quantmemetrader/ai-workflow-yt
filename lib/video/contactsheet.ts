import "server-only";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

/**
 * A contact sheet: pictures in a grid, each with a caption, one JPEG.
 *
 * Two readers. The lead, reviewing a sourcing run, wants every candidate
 * the judge saw with its score, and every chosen window with its line and
 * its credit, on one page they can open with the Read tool. And the lab's
 * grader (W7) wants the same for rendered frames. Both are this.
 *
 * ffmpeg does all of it: each picture is scaled into a fixed cell with a
 * caption strip drawn under it (`drawtext` reading the caption from a file,
 * because a caption with Chinese, colons and quotes cannot be put on a
 * filter line), then the cells are concatenated and tiled. A picture that
 * ffmpeg cannot open becomes a grey cell that says so, rather than sinking
 * the sheet. The CJK face is the system Noto Sans CJK.
 */

const exec = promisify(execFile);

export type SheetCell = { image: string | null; label: string };

export type SheetOptions = {
  cols?: number;
  cellW?: number;
  cellH?: number;
  /** Caption lines under each cell. */
  labelLines?: number;
  fontSize?: number;
  fontFile?: string;
  title?: string;
};

export const SHEET_FONT = process.env.DV2_SHEET_FONT || "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc";

/* ffmpeg's filter-graph escaping for a path or a literal inside an option value. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

/** A CJK glyph takes two columns of a Latin one. */
const cols = (s: string) => Array.from(s).reduce((n, ch) => n + (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch) ? 2 : 1), 0);

/** Wrap a caption to the cell's width, `lines` lines at most, on the explicit breaks first. */
export function wrapLabel(text: string, width: number, lines: number): string {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of Array.from(para)) {
      if (cols(line + ch) > width) {
        out.push(line);
        line = ch;
      } else line += ch;
    }
    out.push(line);
  }
  return out.slice(0, lines).join("\n");
}

async function renderCell(cell: SheetCell, i: number, dir: string, o: Required<Omit<SheetOptions, "title">>): Promise<string> {
  const out = path.join(dir, `cell_${String(i).padStart(3, "0")}.png`);
  /* drawtext's line height at this size is about 1.2 em plus the spacing. */
  const labelH = o.labelLines * (Math.round(o.fontSize * 1.25) + 4) + 10;
  const textFile = path.join(dir, `label_${i}.txt`);
  const width = Math.floor(o.cellW / (o.fontSize * 0.52));
  await writeFile(textFile, wrapLabel(`#${i + 1} ${cell.label}`, width, o.labelLines));
  const draw = `drawtext=fontfile=${esc(o.fontFile)}:textfile=${esc(textFile)}:fontsize=${o.fontSize}:fontcolor=white:x=6:y=${o.cellH + 5}:line_spacing=4`;
  /* `setsar=1`: a picture with a non-square pixel aspect (a scaled web JPEG often carries one) would otherwise fail `concat`, which insists every cell agree. */
  const frame = `scale=${o.cellW}:${o.cellH}:force_original_aspect_ratio=decrease,setsar=1,pad=${o.cellW}:${o.cellH}:(ow-iw)/2:(oh-ih)/2:color=#1a1a1c,pad=${o.cellW}:${o.cellH + labelH}:0:0:color=#141416,${draw}`;
  if (cell.image) {
    try {
      await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", cell.image, "-frames:v", "1", "-vf", frame, out], { timeout: 30_000 });
      return out;
    } catch {
      /* fall through to the placeholder */
    }
  }
  await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=#2a2a2e:s=${o.cellW}x${o.cellH}`, "-frames:v", "1", "-vf", frame, out], { timeout: 30_000 });
  return out;
}

/**
 * Render the sheet to `out` (a .jpg or .png path) and return that path.
 * Cells are numbered from 1 in the order given, which is the order the
 * judge saw them, so a score table reads straight onto the sheet.
 */
export async function sheet(cells: SheetCell[], out: string, opts: SheetOptions = {}): Promise<string> {
  if (!cells.length) throw new Error("sheet: no cells");
  const o = { cols: opts.cols ?? 4, cellW: opts.cellW ?? 320, cellH: opts.cellH ?? 320, labelLines: opts.labelLines ?? 4, fontSize: opts.fontSize ?? 14, fontFile: opts.fontFile ?? SHEET_FONT };
  const dir = path.join(path.dirname(out), `.sheet-${path.basename(out).replace(/\.[^.]+$/, "")}`);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await mkdir(dir, { recursive: true });
  try {
    const files: string[] = [];
    /* Four at a time: each cell is one ffmpeg process. */
    for (let i = 0; i < cells.length; i += 4) {
      const batch = await Promise.all(cells.slice(i, i + 4).map((c, j) => renderCell(c, i + j, dir, o)));
      files.push(...batch);
    }
    const rows = Math.ceil(files.length / o.cols);
    const args = ["-hide_banner", "-loglevel", "error", "-y"];
    for (const f of files) args.push("-i", f);
    const inputs = files.map((_, i) => `[${i}:v]`).join("");
    let graph = `${inputs}concat=n=${files.length}:v=1:a=0,tile=${o.cols}x${rows}:padding=4:margin=8:color=#0E0E10`;
    if (opts.title) {
      const titleFile = path.join(dir, "title.txt");
      await writeFile(titleFile, opts.title);
      graph += `,pad=iw:ih+40:0:40:color=#0E0E10,drawtext=fontfile=${esc(o.fontFile)}:textfile=${esc(titleFile)}:fontsize=20:fontcolor=white:x=12:y=10`;
    }
    args.push("-filter_complex", graph, "-frames:v", "1", "-q:v", "3", out);
    await exec("ffmpeg", args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
