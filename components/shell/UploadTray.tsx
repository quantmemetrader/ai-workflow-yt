"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  cancelUpload,
  dismissUpload,
  readUploads,
  serverUploads,
  subscribeUploads,
  uploadsInFlight,
  type UploadJob,
} from "@/lib/client/uploads";
import { bytes } from "@/components/chat/upload";

/**
 * The uploads, wherever you are.
 *
 * Mounted in the app layout, above every module, reading the store in
 * `uploads.ts`. Top right, under the top bar: the bottom corners belong to
 * the toaster, the busy bar and the collection toast, and an upload is the
 * one thing a person actively waits on, so it sits where the eye goes.
 *
 * Two things it does besides drawing:
 *   — refreshes the route each time a file lands, so the Files list you are
 *     looking at (or come back to) already has it;
 *   — asks before a reload or a closed tab while bytes are still moving. A
 *     navigation inside the app is fine — that is the whole point — but a
 *     `File` handle does not survive a reload, and neither would the upload.
 */
export function UploadTray({ locale }: { locale: string }) {
  const zh = locale.startsWith("zh");
  const router = useRouter();
  const jobs = useSyncExternalStore(subscribeUploads, readUploads, serverUploads);

  // Refresh once per outcome, not once per progress tick. A failed or
  // cancelled upload has had its row removed on the server, and the list
  // should stop showing it just as promptly as it starts showing a landed one.
  const landed = useRef(new Set<string>());
  useEffect(() => {
    let fresh = false;
    for (const j of jobs) {
      if (j.status !== "uploading" && !landed.current.has(j.key)) {
        landed.current.add(j.key);
        fresh = true;
      }
    }
    if (fresh) router.refresh();
  }, [jobs, router]);

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (!uploadsInFlight()) return;
      e.preventDefault();
      // Modern browsers show their own wording; the string only has to be set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  if (!jobs.length) return null;

  const moving = jobs.filter((j) => j.status === "uploading");
  const heading = moving.length
    ? zh
      ? `正在上传 ${moving.length} 个文件 · 可以继续浏览其他页面`
      : `Uploading ${moving.length} file${moving.length === 1 ? "" : "s"} · you can keep working`
    : zh
      ? "上传"
      : "Uploads";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: 18,
        top: 62,
        zIndex: 215,
        width: 340,
        maxWidth: "calc(100vw - 36px)",
        borderRadius: 12,
        border: "1px solid #e6e6e6",
        background: "#ffffff",
        boxShadow: "0 10px 32px rgba(23,23,23,0.14)",
        animation: "fadeUp .18s cubic-bezier(.32,.72,0,1) both",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "9px 12px 8px",
          fontSize: 11.5,
          fontWeight: 560,
          letterSpacing: "0.02em",
          color: "#5a5a5a",
          borderBottom: "1px solid #f0f0f0",
        }}
      >
        {heading}
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {jobs.map((j) => (
          <Row key={j.key} job={j} zh={zh} />
        ))}
      </div>
    </div>
  );
}

function Row({ job, zh }: { job: UploadJob; zh: boolean }) {
  const pct = Math.round(job.pct * 100);
  const failed = job.status === "failed";
  const done = job.status === "done";
  const status = done
    ? zh ? "已上传" : "Uploaded"
    : job.status === "cancelled"
      ? zh ? "已取消" : "Cancelled"
      : failed
        ? job.error ?? (zh ? "上传失败" : "Upload failed")
        : `${pct}% · ${bytes(Math.round(job.size * job.pct))} / ${bytes(job.size)}`;

  return (
    <div style={{ padding: "9px 12px 10px", borderBottom: "1px solid #f5f5f5" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            flexGrow: 1,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 520,
            color: "#222",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={job.name}
        >
          {job.name}
        </span>
        <button
          type="button"
          aria-label={job.status === "uploading" ? (zh ? "取消" : "Cancel") : zh ? "关闭" : "Dismiss"}
          onClick={() => (job.status === "uploading" ? cancelUpload(job.key) : dismissUpload(job.key))}
          style={{
            flexShrink: 0,
            width: 18,
            height: 18,
            padding: 0,
            border: 0,
            borderRadius: 5,
            background: "transparent",
            cursor: "pointer",
            color: "#b5b5b5",
            lineHeight: 0,
          }}
        >
          <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2.1, strokeLinecap: "round" }}>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      {job.status === "uploading" || done ? (
        <div style={{ marginTop: 7, height: 4, borderRadius: 2, background: "#efefef", overflow: "hidden" }}>
          <div
            style={{
              width: `${done ? 100 : pct}%`,
              height: "100%",
              borderRadius: 2,
              background: done ? "#278f5e" : "#171717",
              transition: "width .25s linear",
            }}
          />
        </div>
      ) : null}
      <div
        style={{
          marginTop: 5,
          fontSize: 11,
          lineHeight: 1.45,
          color: failed ? "#a02e2e" : done ? "#278f5e" : "#7a7a7a",
          overflowWrap: "anywhere",
        }}
      >
        {status}
      </div>
    </div>
  );
}
