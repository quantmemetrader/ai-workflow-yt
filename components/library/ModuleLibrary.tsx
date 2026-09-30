"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/client/notify";
import { uploadFiles } from "@/lib/client/upload";
import { deleteFilesAction } from "@/app/(app)/files/actions";
import { trainWithFileAction } from "@/app/(app)/library/actions";
import { newDocAction } from "@/app/(app)/docs/actions";
import type { LibraryFile, LibModule } from "@/lib/files/module-library";

const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
/* Opens in the document editor (`/docs/[id]`): documents, not footage. */
const editable = (f: LibraryFile) => f.kind === "doc" || /\.(docx?|odt|rtf|wps|pages|txt|md|markdown|pdf|html?)$/i.test(f.name);
const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/**
 * A module's 资料库: drop files in, find them, clean them up; each says
 * whether AI has read it and whether it trains the module's AI employee.
 */
export function ModuleLibrary({ module, title, agentName, zh, folderId, files, canTrain }: { module: LibModule; title: string; agentName: string; zh: boolean; folderId: string; files: LibraryFile[]; canTrain: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const input = React.useRef<HTMLInputElement | null>(null);
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [picking, setPicking] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [pending, start] = React.useTransition();

  /* Files still being read by AI: look again in a little while. */
  const unread = files.some((f) => !f.read);
  React.useEffect(() => {
    if (!unread) return;
    const id = window.setTimeout(() => router.refresh(), 15_000);
    return () => window.clearTimeout(id);
  }, [unread, files, router]);

  async function add(list: FileList | File[]) {
    const arr = Array.from(list);
    if (!arr.length) return;
    setBusy(t(`正在上传 ${arr.length} 个文件…`, `Uploading ${arr.length}…`));
    const res = await uploadFiles(arr, { folderId, onProgress: (u) => setBusy(t(`正在上传… ${Math.round(u.reduce((a, x) => a + x.pct, 0) / Math.max(1, u.length))}%`, `Uploading… ${Math.round(u.reduce((a, x) => a + x.pct, 0) / Math.max(1, u.length))}%`)) });
    setBusy(null);
    notify(res.failed ? t(`上传了 ${res.uploaded} 个，${res.failed} 个没传上`, `${res.uploaded} uploaded, ${res.failed} failed`) : t(`上传了 ${res.uploaded} 个文件，AI 正在读`, `${res.uploaded} uploaded; AI is reading them`), res.failed ? "info" : "ok");
    router.refresh();
  }

  const needle = q.trim().toLowerCase();
  const shown = files.filter((f) => !needle || f.name.toLowerCase().includes(needle) || f.ownerName.toLowerCase().includes(needle));
  const trainedCount = files.filter((f) => f.training).length;
  const btn = (primary = false, danger = false): React.CSSProperties => ({ height: 32, padding: "0 13px", borderRadius: 8, border: `1px solid ${danger ? "#e5484d" : primary ? "#171717" : "#dcdbd6"}`, background: primary ? "#171717" : "#fff", color: danger ? "#c62a2f" : primary ? "#fff" : "#262626", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1080 }}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 650, color: "#171717" }}>{title}</div>
        <div style={{ fontSize: 13, color: "#6b6b6b", marginTop: 4, lineHeight: 1.6 }}>
          {t(`上传合同、发票、记录等。上传后 AI 会自动读完，问${agentName}时会用到。`, `Upload contracts, invoices, records. AI reads each on arrival and ${agentName} uses them when answering.`)}
          {canTrain ? t(`想让${agentName}以后照着某个文件的做法来做，就点那个文件右边的「用来训练」（现在 ${trainedCount} 个）。`, ` Files switched to "Train" teach ${agentName} how to work (${trainedCount} now).`) : null}
          {t("同部门的同事都能看、能改这里的文件；点「编辑」直接在网页里改，点「分享」发给别的同事。", " Everyone in this team can open and edit these; Edit changes a file in the browser, Share sends it to someone else.")}
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        style={{ border: `2px dashed ${over ? "#1f6feb" : "#d6d5d0"}`, background: over ? "#f0f6ff" : "#fafaf8", borderRadius: 14, padding: "22px 16px", textAlign: "center", cursor: "pointer", color: "#525252", fontSize: 13.5 }}
      >
        {busy ?? t("把文件拖到这里，或点这里选择（可以一次选多个）", "Drop files here, or click to choose (several at once)")}
        <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && void add(e.target.files)} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("按文件名或上传人搜索", "Search by name or uploader")} style={{ flexGrow: 1, minWidth: 200, height: 34, border: "1px solid #dcdbd6", borderRadius: 9, padding: "0 12px", fontFamily: "inherit", fontSize: 13, outline: "none" }} />
        {!picking ? (
          <button
            type="button"
            style={btn(true)}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await newDocAction(module);
                if ("error" in r && r.error) return notify(r.error);
                if ("id" in r && r.id) router.push(`/docs/${r.id}`);
              })
            }
          >
            {t("新建文档", "New document")}
          </button>
        ) : null}
        {picking ? (
          <>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t(`已选 ${picked.size} 个`, `${picked.size} selected`)}</span>
            <button type="button" style={btn()} onClick={() => setPicked(new Set(shown.map((f) => f.id)))}>{t("全选", "All")}</button>
            <button
              type="button"
              style={btn(false, true)}
              disabled={!picked.size || pending}
              onClick={() => {
                if (!picked.size || !window.confirm(t(`把 ${picked.size} 个文件移到回收站？30 天内可以恢复。`, `Move ${picked.size} files to the trash?`))) return;
                start(async () => {
                  const res = await deleteFilesAction([...picked]);
                  if (res.error) notify(res.error);
                  else notify(t(`已删除 ${res.deleted} 个`, `Deleted ${res.deleted}`), "ok");
                  setPicking(false);
                  setPicked(new Set());
                  router.refresh();
                });
              }}
            >
              {t("删除所选", "Delete")}
            </button>
            <button type="button" style={btn()} onClick={() => { setPicking(false); setPicked(new Set()); }}>{t("取消", "Cancel")}</button>
          </>
        ) : files.length ? (
          <button type="button" style={btn()} onClick={() => setPicking(true)}>{t("选择多个", "Select")}</button>
        ) : null}
      </div>

      <div style={{ border: "1px solid #e7e6e2", borderRadius: 14, background: "#fff", overflow: "hidden" }}>
        {shown.length ? (
          shown.map((f, i) => {
            const on = picked.has(f.id);
            return (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: i ? "1px solid #f0efeb" : 0, background: on ? "#eaf2fe" : undefined, cursor: picking ? "pointer" : undefined }} onClick={picking ? () => setPicked((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; }) : undefined}>
                {picking ? <input type="checkbox" readOnly checked={on} style={{ flexShrink: 0 }} /> : null}
                <div style={{ minWidth: 0, flexGrow: 1 }}>
                  {picking ? (
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: "#171717", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                  ) : (
                    <Link href={editable(f) ? `/docs/${f.id}` : `/api/files/${f.id}/download`} prefetch={false} target={editable(f) ? undefined : "_blank"} style={{ display: "block", fontSize: 13.5, fontWeight: 500, color: "#171717", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </Link>
                  )}
                  <div style={{ fontSize: 12, color: "#8a8a8a", marginTop: 2 }}>{[f.ownerName, day(f.createdAt), size(f.sizeBytes)].filter(Boolean).join(" · ")}</div>
                </div>
                <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 600, padding: "0 8px", lineHeight: "20px", borderRadius: 99, color: f.read ? "#1e7a4f" : "#95590a", background: f.read ? "#e7f6ee" : "#fff4df" }}>{f.read ? t("AI 已读", "AI read") : t("AI 读取中", "AI reading")}</span>
                {!picking ? (
                  editable(f) ? (
                    <>
                      <Link href={`/docs/${f.id}`} prefetch={false} style={{ ...btn(), height: 28, fontSize: 12, padding: "0 10px", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                        {t("编辑", "Edit")}
                      </Link>
                      <Link href={`/docs/${f.id}?share=1`} prefetch={false} style={{ ...btn(), height: 28, fontSize: 12, padding: "0 10px", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                        {t("分享", "Share")}
                      </Link>
                    </>
                  ) : (
                    <a href={`/api/files/${f.id}/download?download=1`} style={{ ...btn(), height: 28, fontSize: 12, padding: "0 10px", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                      {t("下载", "Download")}
                    </a>
                  )
                ) : null}
                {canTrain && !picking ? (
                  <button
                    type="button"
                    disabled={pending}
                    title={f.training ? t(`${agentName}在照着这个文件学`, `${agentName} learns from this`) : t(`用这个文件训练${agentName}`, `Train ${agentName} with this`)}
                    onClick={() =>
                      start(async () => {
                        const res = await trainWithFileAction(module, f.id, !f.training);
                        if (res.error) return notify(res.error);
                        notify(f.training ? t("已不再用来训练", "No longer used for training") : t(`已设为${agentName}的训练范例`, `Now trains ${agentName}`), "ok");
                        router.refresh();
                      })
                    }
                    style={{ ...btn(f.training), height: 28, fontSize: 12, padding: "0 10px" }}
                  >
                    {f.training ? t("已用于训练", "Training on") : t("用来训练", "Train with it")}
                  </button>
                ) : null}
              </div>
            );
          })
        ) : (
          <div style={{ padding: "28px 16px", textAlign: "center", color: "#8a8a8a", fontSize: 13.5 }}>{files.length ? t("没有找到这个文件", "No file matches") : t("还没有文件。把第一个文件拖进来吧。", "No files yet. Drop the first one in.")}</div>
        )}
      </div>
    </div>
  );
}
