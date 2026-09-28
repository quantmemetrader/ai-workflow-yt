"use client";

import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import { notify } from "@/lib/client/notify";
import type { EditorBrief } from "@/lib/projects/brief";
import type { ProjectFile, ProjectFileRole } from "@/lib/projects/files";

/* The boxes' names, as `ROLE_LABEL` in lib/projects/files.ts has them; copied
   because that module is server-only and this one runs in the browser. */
const ROLE_LABEL: Record<ProjectFileRole, { zh: string; en: string }> = {
  clip: { zh: "素材", en: "Footage" },
  reference: { zh: "参考资料", en: "References" },
  render: { zh: "AI 成片", en: "AI renders" },
  final: { zh: "最终版视频", en: "Final videos" },
  other: { zh: "其他", en: "Other" },
};

/**
 * 脚本与资料: what the person cutting the video works from, in the desk's
 * right column.
 *
 * The client (28 Sep): "for the video page, there is no part that the video
 * maker knows which scripts are approved, what are some files for that
 * script". So, top to bottom: whether the script is approved (which version,
 * by whom, when — green; or orange, "not approved yet", with the way to the
 * script page), the approved words themselves, numbered, with the shot note
 * under each and one press to copy them all; then the project's files in
 * their boxes, each one a download.
 */
export function ScriptBrief({ projectId, zh, brief, files }: { projectId: string; zh: boolean; brief: EditorBrief | null; files: ProjectFile[] }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const scriptHref = `/projects/${projectId}/script`;
  const newer = brief?.approved && brief.latestVersion > brief.approved.version ? brief.latestVersion : null;

  const copyAll = () => {
    if (!brief) return;
    const text = brief.beats
      .map((b) => b.voiceover.trim())
      .filter(Boolean)
      .join("\n\n");
    navigator.clipboard?.writeText(text).then(
      () => notify(t("脚本已复制", "Script copied"), "ok"),
      () => notify(t("复制失败", "Couldn't copy")),
    );
  };

  const order: ProjectFileRole[] = ["reference", "clip", "render", "final", "other"];
  const groups = order.map((role) => ({ role, list: files.filter((f) => f.role === role) })).filter((g) => g.list.length > 0);

  return (
    <div style={{ padding: "4px 12px 16px", display: "flex", flexDirection: "column", gap: 14, fontSize: 12.5, color: "#171717" }}>
      {/* ---- approved or not ---- */}
      {!brief ? (
        <Status tone="warn" icon="doc" title={t("这个项目还没有脚本", "No script yet")}>
          <Link prefetch={false} href={scriptHref} style={LINK}>
            {t("去写脚本 →", "Write one →")}
          </Link>
        </Status>
      ) : brief.approved ? (
        <Status tone="ok" icon="check" title={t(`已批准 · 第 ${brief.approved.version} 版`, `Approved · v${brief.approved.version}`)}>
          <span style={{ color: "#3f6b52" }}>
            {[brief.approved.by, brief.approved.at ? when(brief.approved.at, zh) : null].filter(Boolean).join(" · ") || t("按这一版剪", "Cut to this version")}
          </span>
          {newer ? (
            <span style={{ display: "block", marginTop: 4, color: "#95590a" }}>
              {t(`第 ${newer} 版还在改、没批准，先按第 ${brief.approved.version} 版剪。`, `v${newer} is still being edited — cut to v${brief.approved.version}.`)}
            </span>
          ) : null}
        </Status>
      ) : brief.beats.length === 0 ? (
        /* A talk-to-camera cut made straight from what the host said: no
           script was written, which is not the same as one waiting for a yes. */
        <Status tone="plain" icon="doc" title={t("这条片没有写脚本", "No script for this one")}>
          <span style={{ color: "#6b6b6b" }}>{t("按主持人的口播直接剪。", "Cut straight from what the host said.")} </span>
          <Link prefetch={false} href={scriptHref} style={LINK}>
            {t("去写一份 →", "Write one →")}
          </Link>
        </Status>
      ) : (
        <Status tone="warn" icon="pen" title={t("脚本还没批准", "Script not approved yet")}>
          <span style={{ color: "#7a4b00" }}>{t("下面是现在的草稿，批准前可能还会改。", "Below is the current draft — it may still change.")} </span>
          <Link prefetch={false} href={scriptHref} style={LINK}>
            {t("去脚本页 →", "Open the script →")}
          </Link>
        </Status>
      )}

      {/* ---- the words ---- */}
      {brief && (brief.approved || brief.beats.length > 0) ? (
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={HEAD}>{t("脚本", "Script")}</span>
            <span style={{ flexGrow: 1 }} />
            {brief.beats.length ? (
              <button type="button" onClick={copyAll} style={SMALL} title={t("复制全部口播", "Copy all the narration")}>
                <Icon name="doc" size={12} />
                {t("复制", "Copy")}
              </button>
            ) : null}
            <Link prefetch={false} href={scriptHref} style={{ ...SMALL, textDecoration: "none" }}>
              <Icon name="external" size={12} />
              {t("打开", "Open")}
            </Link>
          </div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, lineHeight: 1.45 }}>{brief.title}</div>
          {brief.beats.length === 0 ? (
            <p style={{ margin: 0, color: "#999999" }}>{t("还没有内容。", "Nothing written yet.")}</p>
          ) : (
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {brief.beats.map((b, i) => (
                <li key={b.ord} style={{ display: "flex", gap: 8 }}>
                  <span style={{ flexShrink: 0, width: 20, fontSize: 10.5, color: "#a3a3a3", fontVariantNumeric: "tabular-nums", paddingTop: 2 }}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ minWidth: 0 }}>
                    {b.voiceover.trim() ? <span style={{ display: "block", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{b.voiceover}</span> : <span style={{ display: "block", color: "#a3a3a3" }}>{t("（无口播）", "(no narration)")}</span>}
                    {b.visual.trim() ? <span style={{ display: "block", marginTop: 2, fontSize: 11.5, color: "#8a8a8a", lineHeight: 1.5 }}>{t("画面：", "Shot: ")}{b.visual}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      {/* ---- the files ---- */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={HEAD}>{t("资料与文件", "Files")}</span>
          <span style={{ flexGrow: 1 }} />
          <Link prefetch={false} href={`/projects/${projectId}/files`} style={{ ...SMALL, textDecoration: "none" }}>
            <Icon name="folder" size={12} />
            {t("全部文件", "All files")}
          </Link>
        </div>
        {groups.length === 0 ? (
          <p style={{ margin: 0, color: "#999999", lineHeight: 1.55 }}>{t("这个项目还没有文件。", "No files in this project yet.")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {groups.map((g) => (
              <div key={g.role}>
                <div style={{ fontSize: 11, color: "#8a8a8a", marginBottom: 4 }}>
                  {zh ? ROLE_LABEL[g.role].zh : ROLE_LABEL[g.role].en} · {g.list.length}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {g.list.map((f) => (
                    <a
                      key={f.id}
                      href={`/api/files/${f.id}/download?download=1`}
                      className="sb-file"
                      title={t(`下载 ${f.name}`, `Download ${f.name}`)}
                      style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 7px", borderRadius: 7, border: "1px solid #efefed", background: "#fff", color: "#262626", textDecoration: "none", minWidth: 0 }}
                    >
                      <span style={{ color: "#8a8a8a", display: "flex", flexShrink: 0 }}>
                        <Icon name={iconFor(f)} size={13} />
                      </span>
                      <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                      <span style={{ flexShrink: 0, fontSize: 10.5, color: "#a3a3a3", fontVariantNumeric: "tabular-nums" }}>{f.durationMs ? clock(f.durationMs) : size(f.sizeBytes)}</span>
                      <span style={{ color: "#a3a3a3", display: "flex", flexShrink: 0 }}>
                        <Icon name="download" size={12} />
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <style>{`.sb-file:hover{border-color:#d6d5d0 !important;background:#fafaf8 !important}`}</style>
    </div>
  );
}

function Status({ tone, icon, title, children }: { tone: "ok" | "warn" | "plain"; icon: IconName; title: string; children?: React.ReactNode }) {
  const c = tone === "ok" ? { bg: "#eef8f2", line: "#cbe9d8", ink: "#1e7a4f" } : tone === "warn" ? { bg: "#fff6e5", line: "#f4ddb0", ink: "#95590a" } : { bg: "#f5f5f3", line: "#e6e6e3", ink: "#404040" };
  return (
    <div style={{ padding: "9px 11px", borderRadius: 9, background: c.bg, border: `1px solid ${c.line}`, lineHeight: 1.5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: c.ink, marginBottom: children ? 2 : 0 }}>
        <Icon name={icon} size={13} />
        {title}
      </div>
      {children ? <div style={{ fontSize: 12 }}>{children}</div> : null}
    </div>
  );
}

function iconFor(f: ProjectFile): IconName {
  const m = f.mime ?? "";
  if (m.startsWith("video/") || f.kind === "video") return "film";
  if (m.startsWith("image/") || f.kind === "image") return "image";
  if (m.startsWith("audio/")) return "play";
  return "doc";
}

function when(iso: string, zh: boolean): string {
  try {
    return new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Hong_Kong" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function size(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

const HEAD: React.CSSProperties = { fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", color: "#999999", fontWeight: 600 };
const LINK: React.CSSProperties = { color: "#1f5fbf", textDecoration: "none", fontWeight: 500 };
const SMALL: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 8px", borderRadius: 6, border: "1px solid #e5e5e2", background: "#fff", color: "#404040", fontFamily: "inherit", fontSize: 11.5, cursor: "pointer" };
