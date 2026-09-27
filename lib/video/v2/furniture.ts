import type { DesignInput } from "@/lib/video/v2/design";

/**
 * The furniture the brief asks for: 主标题「…」, 副标题, 水印「…」, 脚注「…」.
 * What the brief does not say comes from the project and the tenant; the
 * footnote defaults to the channel's own line, measured in `HOUSE_FORMAT`.
 *
 * Pure, and on its own so the v2 pipeline (`pipeline.ts`, which the lab
 * loads without the database) can read it without importing the director.
 */
export function furnitureFromBrief(brief: string, projectTitle: string, tenantName: string | null): DesignInput["furniture"] {
  const grab = (re: RegExp) => re.exec(brief)?.[1]?.trim() ?? null;
  const title = grab(/主标题[「“"『]([^」”"』]{1,40})[」”"』]/) ?? projectTitle;
  const sub = grab(/副标题[「“"『]([^」”"』]{1,60})[」”"』]/);
  const watermark = grab(/水印[「“"『]([^」”"』]{1,30})[」”"』]/) ?? tenantName;
  const footnote = grab(/脚注[「“"『]([^」”"』]{1,120})[」”"』]/) ?? "注：视频信息来自公开资料整理，仅作为观点分析，不构成任何投资建议。";
  return { header: { title, sub }, watermark, footnote };
}
