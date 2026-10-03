"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { useAsk } from "@/components/ui/useAsk";
import { restoreVersionAction } from "@/app/(app)/files/actions";
import { notify } from "@/lib/client/notify";
import { startUploads } from "@/lib/client/uploads";

/**
 * 上传新版本: a file picker whose one file becomes the next version of an
 * existing file. The bytes go the same way as any upload — through the tray,
 * multipart past 64 MB, surviving a change of page — and the file keeps its
 * id, its links, its sharing and its place.
 */
export function useNewVersion(zh: boolean) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<{ id: string; name: string } | null>(null);

  const pick = (id: string, name: string) => {
    target.current = { id, name };
    input.current?.click();
  };

  const picker = (
    <input
      ref={input}
      type="file"
      style={{ display: "none" }}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        const into = target.current;
        if (!file || !into) return;
        void startUploads([file], { versionOf: into.id }).then(({ uploaded }) => {
          if (uploaded) {
            notify(zh ? `已上传「${into.name}」的新版本` : `New version of “${into.name}” uploaded`, "ok");
            router.refresh();
          }
        });
      }}
    />
  );
  return { pick, picker };
}

export type VersionItem = {
  versionNo: number;
  author: string;
  date: string;
  note: string | null;
  /** Whether this version kept its own stored object (and so can be downloaded or restored). */
  stored: boolean;
};

/** The 版本 section of a file's page: every version, each downloadable, any earlier one restorable. */
export function FileVersions({
  fileId,
  fileName,
  current,
  versions,
  canEdit,
  zh,
}: {
  fileId: string;
  fileName: string;
  current: number;
  versions: VersionItem[];
  canEdit: boolean;
  zh: boolean;
}) {
  const t = (cn: string, en: string) => (zh ? cn : en);
  const router = useRouter();
  const ask = useAsk(zh);
  const [, start] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);
  const upload = useNewVersion(zh);
  /* The newest row is what the file is now, whatever its number. */
  const newest = versions.length ? Math.max(...versions.map((v) => v.versionNo)) : current;

  const restore = async (v: VersionItem) => {
    const ok = await ask.confirm({
      title: t(`恢复为 v${v.versionNo}？`, `Restore v${v.versionNo}?`),
      body: t(`会用 v${v.versionNo} 的内容生成一个新版本，作为当前版本。其他版本都会保留。`, `A new version is made from v${v.versionNo} and becomes current. Every other version is kept.`),
      confirm: t("恢复为当前版本", "Make current"),
    });
    if (!ok) return;
    setBusy(v.versionNo);
    start(async () => {
      const res = await restoreVersionAction(fileId, v.versionNo);
      setBusy(null);
      if ("error" in res && res.error) notify(res.error);
      else {
        notify(t(`已把 v${v.versionNo} 恢复为当前版本（v${res.version}）`, `v${v.versionNo} is current again (v${res.version})`), "ok");
        router.refresh();
      }
    });
  };

  return (
    <section style={{ border: "1px solid #ededed", borderRadius: 10, background: "#fff", padding: "10px 12px" }}>
      {ask.dialog}
      {upload.picker}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div className="lbl" style={{ padding: 0 }}>
          {t("版本", "Versions")}
        </div>
        <span style={{ flexGrow: 1 }} />
        {canEdit ? (
          <button
            type="button"
            onClick={() => upload.pick(fileId, fileName)}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 9px", border: "1px solid #ededed", borderRadius: 7, background: "#fff", color: "#262626", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}
          >
            <Icon name="upload" size={12} />
            {t("上传新版本", "Upload new version")}
          </button>
        ) : null}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
        {versions.map((v) => (
          <li key={v.versionNo} style={{ fontSize: 11.5, color: "#7c7c7c", display: "flex", flexDirection: "column", gap: 3 }}>
            <span>
              <span style={{ fontWeight: 500, color: "#171717" }}>v{v.versionNo}</span>
              {v.versionNo === newest ? <span style={{ marginLeft: 6, fontSize: 11, color: "#278f5e", background: "#e4faeb", borderRadius: 4, padding: "0 5px" }}>{t("当前", "Current")}</span> : null} · {v.author} · {v.date}
              {v.note ? ` · ${v.note}` : ""}
            </span>
            {v.stored ? (
              <span style={{ display: "flex", gap: 10 }}>
                <a href={`/api/files/${fileId}/download?v=${v.versionNo}`} style={{ color: "#007be0", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <Icon name="download" size={11} />
                  {t("下载", "Download")}
                </a>
                {canEdit && v.versionNo !== newest ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void restore(v)}
                    style={{ padding: 0, border: 0, background: "transparent", color: "#007be0", fontSize: 11.5, fontFamily: "inherit", cursor: busy !== null ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 3, opacity: busy !== null && busy !== v.versionNo ? 0.5 : 1 }}
                  >
                    <Icon name="undo" size={11} />
                    {busy === v.versionNo ? t("正在恢复…", "Restoring…") : t("恢复为当前版本", "Make current")}
                  </button>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
