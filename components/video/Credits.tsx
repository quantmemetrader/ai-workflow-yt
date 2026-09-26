"use client";

import { useState } from "react";
import type { DirectorState } from "@/lib/video/director";
import { Badge, Label, Row, chip, clip } from "@/components/ui/kit";

/**
 * 素材来源: every fetched asset the director put in this video, and the
 * text to paste under the post.
 *
 * The director's sourcing takes clips and pictures from anywhere on the
 * internet, credited, not licensed (PLAN.md §4). That only holds if the
 * credits are visible to the person publishing: a line on the end card,
 * a block in the post body, and this panel where they can check who made
 * what before the video goes out and answer a claim afterwards. It reads
 * `director.assets` and `director.credits` as `persistDesign` writes them;
 * a project the v1 director made has neither and shows nothing.
 */
type AssetLike = {
  fileId?: string;
  credit?: string;
  candidate?: {
    platform?: string;
    title?: string;
    url?: string;
    author?: { name?: string; url?: string };
    licence?: string;
    durationMs?: number;
  };
  window?: { start: number; end: number };
};

const PLATFORM_ZH: Record<string, string> = {
  douyin: "抖音",
  tiktok: "TikTok",
  bilibili: "B站",
  youtube: "YouTube",
  pinterest: "Pinterest",
  bing: "Bing",
  pexels: "Pexels",
  unsplash: "Unsplash",
  openverse: "Openverse",
  wikimedia: "Wikimedia Commons",
  flickr: "Flickr",
};

export function Credits({ director, zh }: { director: DirectorState; zh: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const assets = (Array.isArray(director.assets) ? director.assets : []) as AssetLike[];
  const block = director.credits?.block ?? "";
  const [copied, setCopied] = useState(false);
  if (!assets.length && !block) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access is denied in some embeds; the text is still on screen to select.
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Label style={{ margin: "12px 0 8px" }}>
          {t("Sources", "素材来源")} · {assets.length}
        </Label>
        <div style={{ flexGrow: 1 }} />
        {block ? (
          <button type="button" onClick={copy} style={{ ...chip, height: 26, fontSize: 11.5 }} title={t("Copy the credits text for the post", "复制发布用的致谢文本")}>
            {copied ? t("Copied", "已复制") : t("Copy credits", "复制致谢文本")}
          </button>
        ) : null}
      </div>
      {director.credits?.line ? <p style={{ margin: "0 0 8px", fontSize: 11.5, color: "#525252", lineHeight: 1.55 }}>{director.credits.line}</p> : null}
      <Row head>
        <span style={{ width: 92 }}>{t("Platform", "平台")}</span>
        <span style={{ width: 150 }}>{t("Author", "作者")}</span>
        <span style={{ flexGrow: 1 }}>{t("Title", "标题")}</span>
        <span style={{ width: 150 }}>{t("Licence", "许可")}</span>
        <span style={{ width: 52 }} />
      </Row>
      {assets.map((a, i) => {
        const c = a.candidate ?? {};
        const platform = c.platform ? (PLATFORM_ZH[c.platform] ?? c.platform) : "";
        return (
          <Row key={a.fileId ?? i}>
            <span style={{ width: 92, ...clip }}>{platform ? <Badge tone="quiet">{platform}</Badge> : null}</span>
            <span style={{ width: 150, ...clip }} title={c.author?.name}>
              {c.author?.url ? (
                <a href={c.author.url} target="_blank" rel="noreferrer" style={{ color: "#171717" }}>
                  {c.author.name}
                </a>
              ) : (
                c.author?.name ?? ""
              )}
            </span>
            <span style={{ flexGrow: 1, ...clip }} title={c.title ?? a.credit}>
              {c.title ?? a.credit ?? ""}
              {a.window ? <span style={{ color: "#999999" }}>{` · ${(a.window.start / 1000).toFixed(1)}–${(a.window.end / 1000).toFixed(1)}s`}</span> : null}
            </span>
            <span style={{ width: 150, color: "#525252", ...clip }} title={c.licence}>
              {c.licence ?? t("credited, not licensed", "引用并注明来源")}
            </span>
            <span style={{ width: 52, textAlign: "right" }}>
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer" style={{ color: "#007be0", fontSize: 11.5 }}>
                  {t("open", "打开")}
                </a>
              ) : null}
            </span>
          </Row>
        );
      })}
      {block ? (
        <pre style={{ margin: "10px 0 0", padding: "10px 12px", background: "#f7f7f7", borderRadius: 8, fontSize: 11, lineHeight: 1.55, whiteSpace: "pre-wrap", color: "#525252", fontFamily: "inherit" }}>{block}</pre>
      ) : null}
    </div>
  );
}
