"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Badge, field, ghost, solid } from "@/components/ui/kit";
import { notify } from "@/lib/client/notify";
import { capcutExportAction, capcutStateAction } from "@/app/(app)/video/capcut-actions";
import type { CapcutJob } from "@/lib/video/capcut/service";

/**
 * 导出到剪映 / CapCut（可编辑）: the button beside 开始渲染 and the dialog it opens.
 *
 * The client's most asked-for thing (Oct 2026): take the edit into 剪映 and
 * keep working on it there, cuts and captions and voice-over still separate,
 * rather than a flattened MP4. The worker builds a draft folder with its media
 * and zips it (`lib/video/capcut/export.ts`); this asks for one, follows the
 * job, and says plainly where the folder goes on a Mac and on Windows, because
 * "unzip it" alone leaves a person with a folder and no idea what to do next.
 */
export function CapcutExport({ projectId, zh, disabled }: { projectId: string; zh: boolean; disabled?: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ jobs: CapcutJob[]; aspect: string; languages: string[] } | null>(null);

  const load = useCallback(async () => {
    const res = await capcutStateAction(projectId);
    if ("error" in res) return;
    setState(res);
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    void capcutStateAction(projectId).then((res) => {
      if (alive && !("error" in res)) setState(res);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  /* Asked again every few seconds while a draft is being made, and not at
     all otherwise: the job takes a minute or two and nothing else moves. */
  const live = Boolean(state?.jobs.some((j) => j.status === "queued" || j.status === "running"));
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [live, load]);

  const latest = state?.jobs[0] ?? null;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        style={{ ...ghost, display: "inline-flex", alignItems: "center", gap: 6, opacity: disabled ? 0.45 : 1 }}
        title={t("Export an editable draft for CapCut / JianYing", "导出可继续编辑的剪映 / CapCut 草稿")}
      >
        <Icon name="scissors" size={14} />
        {t("Export to CapCut (editable)", "导出到剪映 / CapCut（可编辑）")}
        {live && latest ? <span style={{ fontSize: 11, color: "#007be0", fontVariantNumeric: "tabular-nums" }}>{Math.round(latest.progress * 100)}%</span> : null}
      </button>
      {open && state ? <Dialog zh={zh} projectId={projectId} state={state} onClose={() => setOpen(false)} onQueued={load} /> : null}
    </>
  );
}

function Dialog({
  zh,
  projectId,
  state,
  onClose,
  onQueued,
}: {
  zh: boolean;
  projectId: string;
  state: { jobs: CapcutJob[]; aspect: string; languages: string[] };
  onClose: () => void;
  onQueued: () => Promise<void>;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const id = useId();
  const [app, setApp] = useState<"jianying" | "capcut">(state.jobs[0]?.app ?? (zh ? "jianying" : "capcut"));
  const [aspect, setAspect] = useState(state.aspect);
  const [language, setLanguage] = useState(state.languages.includes("zh-CN") ? "zh-CN" : (state.languages[0] ?? "zh-CN"));
  const [sending, setSending] = useState(false);
  const live = state.jobs.some((j) => j.status === "queued" || j.status === "running");

  const start = async () => {
    setSending(true);
    try {
      const res = await capcutExportAction(projectId, { app, aspect, captionLanguage: language });
      if ("error" in res && res.error) notify(res.error);
      else await onQueued();
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      onMouseDown={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 215, background: "rgba(23,23,23,0.18)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "8vh", overflowY: "auto" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        tabIndex={-1}
        style={{
          width: "min(560px, 94vw)",
          padding: "18px 20px 16px",
          marginBottom: 40,
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e2e2",
          boxShadow: "0 24px 64px rgba(23,23,23,0.22)",
          animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both",
        }}
      >
        <div id={`${id}-title`} style={{ fontSize: 14.5, fontWeight: 600 }}>
          {t("Export to CapCut / JianYing (editable)", "导出到剪映 / CapCut（可编辑）")}
        </div>
        <p style={{ fontSize: 12.5, color: "#7c7c7c", lineHeight: 1.65, margin: "8px 0 0" }}>
          {t(
            "Makes a CapCut draft from this cut: every clip with its trim and order, captions as text, voice-over and music on their own tracks, titles as editable text. It comes as a zip with the footage inside, plus SRT captions and an FCPXML as a fallback.",
            "把这条剪辑做成剪映草稿：每段素材保留剪切点和顺序，字幕是可改的文字，配音和音乐在各自的音轨上，标题等图形文字也能直接改。下载的是一个压缩包，里面带着素材，另附 SRT 字幕和 FCPXML 作为备用。",
          )}
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          {/* The two apps read the same tracks but stamp their drafts differently; the draft is written for one. */}
          <div style={{ display: "flex", gap: 4 }} role="group" aria-label={t("Which app", "用哪个软件打开")}>
            {(
              [
                ["jianying", t("JianYing Pro", "剪映专业版")],
                ["capcut", "CapCut"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setApp(key)}
                style={{ ...ghost, background: app === key ? "#171717" : "#fff", color: app === key ? "#fff" : "#525252", borderColor: app === key ? "#171717" : "#ededed" }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {["16:9", "9:16", "1:1"].map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAspect(a)}
                style={{ ...ghost, background: aspect === a ? "#171717" : "#fff", color: aspect === a ? "#fff" : "#525252", borderColor: aspect === a ? "#171717" : "#ededed" }}
              >
                {a}
              </button>
            ))}
          </div>
          {state.languages.length > 1 ? (
            <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ ...field, width: 170, height: 30 }} aria-label={t("Main caption language", "主字幕语言")}>
              {state.languages.map((l) => (
                <option key={l} value={l}>
                  {l === "zh-CN" ? "简体中文" : l === "en" ? "English" : l}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" disabled={sending || live} onClick={() => void start()} style={{ ...solid, marginLeft: "auto", opacity: sending || live ? 0.45 : 1 }}>
            {live ? t("Making the draft…", "正在生成草稿…") : t("Make the draft", "开始导出")}
          </button>
        </div>

        {state.jobs.length ? (
          <div style={{ marginTop: 14 }}>
            {state.jobs.slice(0, 3).map((j) => (
              <JobRow key={j.id} job={j} zh={zh} />
            ))}
          </div>
        ) : null}

        <HowToOpen zh={zh} app={app} />

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" onClick={onClose} style={ghost}>
            {t("Close", "关闭")}
          </button>
        </div>
      </div>
    </div>
  );
}

function JobRow({ job, zh }: { job: CapcutJob; zh: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const running = job.status === "running" || job.status === "queued";
  const [showNotes, setShowNotes] = useState(false);
  return (
    <div style={{ borderTop: "1px solid #f3f3f3", padding: "10px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {job.app ? <Badge tone="quiet">{job.app === "capcut" ? "CapCut" : t("JianYing", "剪映")}</Badge> : null}
        {job.aspect ? <Badge tone="quiet">{job.aspect}</Badge> : null}
        <Badge tone={job.status === "succeeded" ? "good" : job.status === "failed" ? "bad" : "warn"}>
          {job.status === "succeeded"
            ? t("ready", "已完成")
            : job.status === "failed"
              ? t("failed", "失败")
              : job.status === "running"
                ? `${t("making", "生成中")} ${Math.round(job.progress * 100)}%`
                : t("queued", "排队中")}
        </Badge>
        {job.sizeBytes ? <span style={{ fontSize: 11.5, color: "#999999" }}>{size(job.sizeBytes)}</span> : null}
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          {job.notes.length ? (
            <button type="button" onClick={() => setShowNotes((v) => !v)} style={{ ...ghost, height: 26, fontSize: 11.5 }}>
              {showNotes ? t("Hide notes", "收起说明") : t(`${job.notes.length} notes`, `${job.notes.length} 条说明`)}
            </button>
          ) : null}
          {job.fileId && job.available ? (
            <a href={`/api/files/${job.fileId}/download`} style={{ fontSize: 12, color: "#007be0", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name="download" size={13} />
              {t("Download zip", "下载压缩包")}
            </a>
          ) : job.fileId ? (
            <span style={{ fontSize: 11.5, color: "#999999" }}>{t("deleted from Files", "已从文件库删除")}</span>
          ) : null}
        </span>
      </div>
      {running ? (
        <div style={{ height: 4, background: "#f3f3f3", borderRadius: 2, marginTop: 7 }}>
          <div style={{ height: "100%", width: `${Math.max(3, Math.round(job.progress * 100))}%`, background: "#007be0", borderRadius: 2, transition: "width .4s" }} />
        </div>
      ) : null}
      {job.error ? <p style={{ fontSize: 11.5, color: "#e03636", margin: "7px 0 0", lineHeight: 1.5, overflowWrap: "anywhere" }}>{job.error}</p> : null}
      {showNotes ? (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 11.5, color: "#7c7c7c", lineHeight: 1.6 }}>
          {job.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Where the folder goes. The same words are in 使用说明.txt inside the zip. */
function HowToOpen({ zh, app }: { zh: boolean; app: "jianying" | "capcut" }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const code: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, background: "#f6f6f6", borderRadius: 5, padding: "1px 5px", overflowWrap: "anywhere" };
  return (
    <div style={{ marginTop: 14, padding: "12px 14px", background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 10, fontSize: 12, color: "#525252", lineHeight: 1.7 }}>
      <div style={{ fontWeight: 600, color: "#171717", marginBottom: 4 }}>{t("How to open it", "怎么打开")}</div>
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        <li>{t("Quit CapCut / JianYing first, then unzip the download.", "先完全退出剪映 / CapCut，再解压下载的压缩包。")}</li>
        <li>
          {t("Move the draft folder (named after the video) into the drafts folder:", "把以视频标题命名的草稿文件夹整个移到草稿目录：")}
          <div style={{ marginTop: 4 }}>
            Mac：<span style={code}>~/Movies/{app === "capcut" ? "CapCut" : "JianyingPro"}/User Data/Projects/com.lveditor.draft</span>
          </div>
          <div>
            Windows：<span style={code}>%LOCALAPPDATA%\{app === "capcut" ? "CapCut" : "JianyingPro"}\User Data\Projects\com.lveditor.draft</span>
          </div>
          <div style={{ color: "#999999" }}>
            {t("On a Mac, press Command+Shift+G in Finder and paste the path.", "Mac 上在访达里按 Command+Shift+G，粘贴路径即可前往。")}
          </div>
          <div style={{ color: "#999999" }}>
            {t("If you changed the drafts location, it is under Settings > Draft location.", "如果改过草稿位置，以「设置 > 草稿位置」里显示的为准。")}
          </div>
        </li>
        <li>
          {t(
            "Open the app: the draft is in the list under its title. If not, quit and reopen it, or open and close any other draft.",
            "打开软件，草稿列表里就能看到这条视频。没有的话，彻底退出再打开一次，或进入任意一个草稿再退出。",
          )}
        </li>
        <li>
          {t(
            "If clips show as missing, choose Relink and point it at the materials folder inside the draft once.",
            "如果素材显示丢失，点「重新链接」，选草稿里的 materials 文件夹一次即可全部找回。",
          )}
        </li>
      </ol>
      <div style={{ marginTop: 6, color: "#999999" }}>
        {t(
          "Some newer builds may not list drafts copied in from outside. Then use the fallback: import the footage from materials, and the SRT under 备用文件 via Text > Local captions. The FCPXML opens in DaVinci Resolve and Final Cut Pro; neither CapCut nor JianYing imports XML.",
          "个别较新版本可能不显示从外部放入的草稿。这时请用备用方式：导入 materials 里的素材，再在「文本 > 本地字幕」导入「备用文件」里的 SRT。FCPXML 可在 DaVinci Resolve 和 Final Cut Pro 打开（剪映和 CapCut 都不支持导入 XML）。",
        )}
      </div>
    </div>
  );
}

function size(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
