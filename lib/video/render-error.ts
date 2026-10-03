/**
 * What a failed render says to the person who asked for it.
 *
 * FFmpeg's own words ("moov atom not found", "Invalid data found when
 * processing input") are for the log, not for the editor: the studio read
 * them as a fault in the product, and the bar beside them invited another
 * render of the same broken file. The raw text stays in the job's error and
 * the worker log; the screen says what happened and what to do, in Chinese.
 *
 * No server imports: the editor runs this on rows already written in English
 * before the render learned to say it itself.
 */

/** FFmpeg/ffprobe saying the bytes are not a picture it can decode. */
export const UNDECODABLE_STDERR =
  /moov atom not found|Invalid data found when processing input|could not find codec parameters|does not contain any stream|Unknown input format|Failed to read frame size|EBML header parsing failed/i;

export const UNREADABLE_ZH =
  "有素材无法读取：它不是能解码的视频（可能已损坏、没有上传完整，或只是改了扩展名）。请把它从素材库移除，换一个文件后再渲染。";

export function readableRenderError(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "";
  if (UNDECODABLE_STDERR.test(text)) return UNREADABLE_ZH;
  if (/^(Error:\s*)?FFmpeg (exited|could not start)|ffmpeg exited|ffprobe failed/i.test(text)) {
    return "渲染时 FFmpeg 出错，详细信息已记入日志。请稍后重试；如果仍然失败，请联系管理员。";
  }
  return text;
}
