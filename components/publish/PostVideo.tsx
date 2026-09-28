"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { uploadFiles } from "@/lib/client/upload";
import { beginWork } from "@/lib/client/busy";
import { notify } from "@/lib/client/notify";

/**
 * The video on a post, in the Publish composer.
 *
 * The composer used to be title and caption only, and even a post that did
 * carry a file went out as text (the worker never sent it). The client:
 * "the publish page can only upload text — need to be able to upload videos
 * and select videos". So: the attached video with 更换 / 移除, or two ways to
 * attach one — upload from this computer (the version the team fixed up
 * after the AI made it), or pick one already in Files (renders included).
 */
export type ComposerVideo = { id: string; name: string; durationMs: number | null; at: string };

export function PostVideo({
  fileId,
  fileName,
  videos,
  zh,
  disabled = false,
  onChange,
}: {
  fileId: string | null;
  fileName: string | null;
  videos: ComposerVideo[];
  zh: boolean;
  disabled?: boolean;
  onChange: (file: { id: string; name: string } | null) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const input = React.useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [pct, setPct] = React.useState<number | null>(null);
  const [q, setQ] = React.useState("");

  async function upload(file: File) {
    const done = beginWork(t("Uploading the video", "上传视频"));
    setPct(0);
    try {
      let landed: string | null = null;
      await uploadFiles([file], {
        access: { mode: "everyone" },
        onProgress: (u) => setPct(u[0]?.pct ?? 0),
        onDone: (id) => {
          landed = id;
        },
      });
      if (landed) {
        onChange({ id: landed, name: file.name });
        setOpen(false);
      } else notify(t("The video did not upload; try again", "视频没传上去，再试一次"));
    } finally {
      done();
      setPct(null);
    }
  }

  const shown = videos.filter((v) => !q.trim() || v.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 40);

  return (
    <div style={{ border: "1px solid #ededed", borderRadius: 10, padding: 10, background: "#fcfcfb" }}>
      <input
        ref={input}
        type="file"
        accept="video/*,.mp4,.mov,.m4v,.webm"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      {fileId ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${fileId}/thumb`} alt="" style={{ width: 72, height: 46, objectFit: "cover", borderRadius: 7, background: "#111", flexShrink: 0 }} onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
          <div style={{ minWidth: 0, flexGrow: 1 }}>
            <div style={{ fontSize: 11, color: "#999999" }}>{t("Video", "视频")}</div>
            <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName ?? fileId}</div>
          </div>
          <a href={`/api/files/${fileId}/download`} target="_blank" rel="noreferrer" style={mini}>
            <Icon name="play" size={11} />
            {t("Watch", "查看")}
          </a>
          <button type="button" style={mini} disabled={disabled} onClick={() => setOpen((o) => !o)}>
            {t("Change", "更换")}
          </button>
          <button type="button" style={{ ...mini, color: "#b42318" }} disabled={disabled} onClick={() => onChange(null)}>
            {t("Remove", "移除")}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#737373", flexGrow: 1 }}>{t("No video yet — this post would go out as text.", "还没有视频——现在发出去只有文字。")}</span>
          <button type="button" style={miniSolid} disabled={disabled || pct !== null} onClick={() => input.current?.click()}>
            <Icon name="upload" size={11} />
            {pct !== null ? `${pct}%` : t("Upload a video", "上传视频")}
          </button>
          <button type="button" style={mini} disabled={disabled} onClick={() => setOpen((o) => !o)}>
            <Icon name="folder" size={11} />
            {t("Pick from Files", "从文件中选择")}
          </button>
        </div>
      )}
      {fileId && pct !== null ? <div style={{ fontSize: 11.5, color: "#737373", marginTop: 6 }}>{t(`Uploading ${pct}%`, `上传中 ${pct}%`)}</div> : null}
      {open ? (
        <div style={{ marginTop: 10, borderTop: "1px solid #efefef", paddingTop: 10 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search videos", "搜索视频")} style={{ flexGrow: 1, height: 30, border: "1px solid #e2e2e2", borderRadius: 7, padding: "0 9px", fontFamily: "inherit", fontSize: 12.5 }} />
            {fileId ? (
              <button type="button" style={miniSolid} disabled={disabled || pct !== null} onClick={() => input.current?.click()}>
                <Icon name="upload" size={11} />
                {pct !== null ? `${pct}%` : t("Upload", "上传")}
              </button>
            ) : null}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, maxHeight: 240, overflowY: "auto" }}>
            {shown.length === 0 ? (
              <span style={{ fontSize: 12, color: "#999999" }}>{t("No videos in Files yet.", "文件里还没有视频。")}</span>
            ) : (
              shown.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onChange({ id: v.id, name: v.name });
                    setOpen(false);
                  }}
                  style={{ all: "unset", cursor: "pointer", borderRadius: 8, border: `1px solid ${v.id === fileId ? "#171717" : "#ececec"}`, padding: 5, background: "#fff", minWidth: 0 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${v.id}/thumb`} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover", borderRadius: 5, background: "#111", display: "block" }} onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                  <span style={{ display: "block", fontSize: 11, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const mini: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 9px", borderRadius: 7, border: "1px solid #e2e2e2", background: "#fff", color: "#404040", fontFamily: "inherit", fontSize: 11.5, cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap" };
const miniSolid: React.CSSProperties = { ...mini, background: "#171717", color: "#fff", borderColor: "#171717" };
