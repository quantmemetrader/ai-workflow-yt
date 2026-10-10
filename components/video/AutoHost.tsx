"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { bigButton, smallButton } from "@/components/projects/kit";
import { notify } from "@/lib/client/notify";
import { uploadFiles } from "@/lib/client/upload";
import { autoHostAction, autoHostDefaultsAction, studioJobsAction } from "@/app/(app)/studio/actions";

type Voice = { id: string; name: string; source: "local" | "elevenlabs" };
type Engine = { id: string; for: "image" | "video"; zh: string; en: string; noteZh: string };
type Defaults = { host: { fileId: string; name: string; kind: "image" | "video" } | null; voices: Voice[]; engines: Engine[]; falReady: boolean };

/**
 * AI 自动生成 (10 Oct): the whole reel from the script, nothing filmed for
 * it. One clip of the host (remembered after the first time), her cloned
 * voice, and the job does the rest: voice, lip-sync, cut, b-roll, captions,
 * render. The page's own pulse takes over once the director starts.
 */
export function AutoHost({ projectId, zh, hasScript, onStarted }: { projectId: string; zh: boolean; hasScript: boolean; onStarted: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [d, setD] = React.useState<Defaults | null>(null);
  const [host, setHost] = React.useState<Defaults["host"]>(null);
  const [voice, setVoice] = React.useState("");
  const [engine, setEngine] = React.useState("");
  const [aspect, setAspect] = React.useState<"9:16" | "16:9" | "1:1">("9:16");
  const [uploading, setUploading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [job, setJob] = React.useState<{ id: string; progress: number; stage: string; status: string; error: string | null } | null>(null);
  const pick = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open || d) return;
    void autoHostDefaultsAction().then((r) => {
      const v = r as Defaults & { error?: string };
      if (v.error) return notify(v.error);
      setD(v);
      setHost(v.host);
      setVoice((v.voices.find((x) => /avon|亚芳/i.test(x.name)) ?? v.voices.find((x) => x.source === "elevenlabs") ?? v.voices[0])?.id ?? "");
    });
  }, [open, d]);
  const fits = (d?.engines ?? []).filter((e) => (!host || e.for === host.kind) && (d?.falReady || e.id.startsWith("local/")));
  React.useEffect(() => {
    if (!fits.some((e) => e.id === engine)) setEngine(fits[0]?.id ?? "");
  }, [fits, engine]);

  React.useEffect(() => {
    if (!job || job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return;
    const tick = window.setInterval(async () => {
      const r = (await studioJobsAction([job.id])) as { jobs?: { id: string; status: string; progress: number; error: string | null; result: { stage?: string } | null }[] };
      const j = r.jobs?.[0];
      if (!j) return;
      setJob((cur) => (cur ? { ...cur, status: j.status, progress: j.progress, error: j.error, stage: j.result?.stage ?? cur.stage } : cur));
      if (j.status === "succeeded") {
        notify(t("她的口播片段做好了，剪辑师正在剪", "Her take is in; the editor is cutting"), "ok");
        onStarted();
        router.refresh();
      }
    }, 5000);
    return () => window.clearInterval(tick);
  }, [job, onStarted, router, t]);

  const upload = async (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    setUploading(true);
    try {
      await uploadFiles(list, { onDone: (id, file) => setHost({ fileId: id, name: file.name, kind: file.type.startsWith("video/") ? "video" : "image" }) });
    } finally {
      setUploading(false);
    }
  };
  const go = async () => {
    if (!host) return;
    setBusy(true);
    try {
      const r = (await autoHostAction(projectId, { hostFileId: host.fileId, hostName: host.name, hostKind: host.kind, voiceId: voice, engine, aspect })) as { error?: string; jobId?: string };
      if (r.error) return notify(r.error);
      setJob({ id: r.jobId!, progress: 0, stage: "配音", status: "queued", error: null });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ ...bigButton("primary"), height: 36, fontSize: 13.5 }} disabled={!hasScript} title={hasScript ? undefined : t("先写好脚本", "Write the script first")}>
        <Icon name="spark" size={14} />
        {t("AI 自动生成（不用拍）", "AI makes it (nothing to film)")}
      </button>
    );
  }
  return (
    <div style={{ border: "1px solid #ebeae6", borderRadius: 12, padding: 14, background: "#fafaf8", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("AI 自动生成：脚本 → 她的声音 → 她的口型 → 剪辑 → 成片", "AI makes it: script → her voice → her lips → cut → film")}</div>
      <p style={{ margin: 0, fontSize: 12.5, color: "#6b6b6b", lineHeight: 1.6 }}>{t("用一段她面对镜头说话的视频（一次上传，以后记住），按这个项目的脚本读出来并对上口型，再由剪辑师加画面、字幕，渲染成片。一分钟的脚本大约等 10 到 15 分钟。", "One clip of her talking to camera (kept for next time), read in her cloned voice and lip-synced, then cut with b-roll and captions. About 10–15 minutes per minute of script.")}</p>
      {job ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 13 }}>{job.status === "failed" ? <span style={{ color: "#c42b2b" }}>{job.error ?? t("没做成", "Failed")}</span> : job.status === "succeeded" ? t("口播片段做好了，剪辑师接手中…", "Take ready; the editor is cutting…") : t(`正在${job.stage}…`, `Working: ${job.stage}…`)}</div>
          <span style={{ display: "block", height: 6, borderRadius: 3, background: "#eeede9", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${Math.max(3, Math.round(job.progress * 100))}%`, background: "#171717", transition: "width .4s ease" }} /></span>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
            <button type="button" style={smallButton()} disabled={uploading} onClick={() => pick.current?.click()}>
              <Icon name="upload" size={13} />
              {uploading ? t("上传中…", "Uploading…") : host ? t("换一段", "Change") : t("上传她的视频或照片", "Upload her clip or photo")}
            </button>
            <span style={{ color: "#6b6b6b", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{host ? host.name : t("正脸、光线好的一段，10 到 60 秒最好", "Front-facing, well lit, 10–60 s works best")}</span>
            <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" hidden onChange={(e) => void upload(e.target.files).then(() => (e.target.value = ""))} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label={t("声音", "Voice")} style={sel}>
              {(d?.voices ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select value={engine} onChange={(e) => setEngine(e.target.value)} aria-label={t("生成方式", "Engine")} style={sel}>
              {fits.map((e) => <option key={e.id} value={e.id}>{zh ? e.zh : e.en}</option>)}
            </select>
            <select value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)} aria-label={t("画幅", "Aspect")} style={sel}>
              <option value="9:16">{t("竖屏 9:16", "Portrait 9:16")}</option>
              <option value="16:9">{t("横屏 16:9", "Landscape 16:9")}</option>
              <option value="1:1">{t("方形 1:1", "Square 1:1")}</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={{ ...bigButton("primary"), height: 36 }} disabled={busy || !host || !voice || !engine} onClick={() => void go()}>
              {busy ? t("提交中…", "Sending…") : t("开始生成", "Start")}
            </button>
            <button type="button" className="se-link" onClick={() => setOpen(false)}>{t("取消", "Cancel")}</button>
          </div>
        </>
      )}
    </div>
  );
}

const sel: React.CSSProperties = { height: 34, border: "1px solid #dcdbd6", borderRadius: 9, padding: "0 10px", font: "inherit", fontSize: 13, background: "#fff", maxWidth: "100%" };
