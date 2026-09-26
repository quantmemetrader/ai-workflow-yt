"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { readRendering, serverRendering, subscribeRendering, writeRendering } from "@/lib/client/rendering";
import { notify } from "@/lib/client/notify";
import type { DirectorState } from "@/lib/video/director";

/**
 * The render, followed off the page.
 *
 * A small chip in the corner while "make the video" or a render is running
 * on a project you have left, and a toast when it lands: done, with the file,
 * or failed, with the reason. On the Video screen itself it draws nothing;
 * the strip there says it in full.
 */
type Answer = {
  id: string;
  title: string;
  director: DirectorState;
  export: { id: string; state: string; progress: number; fileId: string | null; error: string | null } | null;
};

const STEP: Record<string, [string, string]> = {
  footage: ["Footage", "素材"],
  voice: ["Voicing", "配音中"],
  transcribe: ["Transcribing", "转写中"],
  captions: ["Captions", "加字幕中"],
  cut: ["Cutting", "剪辑中"],
  design: ["Designing", "设计中"],
  pictures: ["Finding pictures", "找图中"],
  write: ["Writing", "写入中"],
  render: ["Rendering", "渲染中"],
};

export function RenderWatch({ locale }: { locale: string }) {
  const zh = locale.startsWith("zh");
  const pathname = usePathname();
  const job = useSyncExternalStore(subscribeRendering, readRendering, serverRendering);
  const [state, setState] = useState<Answer | null>(null);
  const onVideo = pathname === "/video";
  const told = useRef<string | null>(null);

  useEffect(() => {
    if (!job) return;
    let live = true;

    async function tick() {
      try {
        const res = await fetch(`/api/video/director?project=${encodeURIComponent(job!.projectId)}`, { cache: "no-store" });
        if (!live) return;
        if (res.status === 404) {
          writeRendering(null);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as Answer;
        if (!live) return;
        setState(data);

        const d = data.director ?? {};
        const directing = d.state === "queued" || d.state === "running";
        const exp = data.export;
        const rendering = exp ? exp.state === "queued" || exp.state === "rendering" : false;
        const key = `${d.state}:${exp?.id ?? ""}:${exp?.state ?? ""}`;

        if (!directing && !rendering) {
          if (told.current !== key) {
            told.current = key;
            if (d.state === "failed") {
              notify(zh ? `「${data.title}」制作中断：${d.error ?? ""}` : `“${data.title}” stopped: ${d.error ?? ""}`);
            } else if (exp?.state === "failed") {
              notify(zh ? `「${data.title}」渲染失败：${exp.error ?? ""}` : `“${data.title}” failed to render: ${exp.error ?? ""}`);
            } else if (exp?.state === "done" || d.state === "done") {
              notify(zh ? `「${data.title}」已完成，成片已在文件库。` : `“${data.title}” is done. The file is in Files.`, "ok");
            }
          }
          writeRendering(null);
        }
      } catch {
        // A dropped poll is not worth reporting; the next one runs.
      }
    }

    void tick();
    const id = setInterval(tick, 6000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [job, zh]);

  if (!job || onVideo || !state) return null;

  const d = state.director ?? {};
  const exp = state.export;
  const rendering = exp && (exp.state === "queued" || exp.state === "rendering");
  const label =
    d.state === "running" || d.state === "queued"
      ? `${(STEP[d.step ?? ""] ?? [d.step ?? "Working", d.step ?? "处理中"])[zh ? 1 : 0]}${d.step === "render" && exp ? ` ${Math.round(exp.progress)}%` : ""}`
      : rendering
        ? `${zh ? "渲染中" : "Rendering"} ${Math.round(exp!.progress)}%`
        : null;
  if (!label) return null;

  return (
    <Link
      href={`/video?project=${encodeURIComponent(state.id)}`}
      style={{
        position: "fixed",
        left: 72,
        bottom: 16,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 32,
        padding: "0 12px 0 10px",
        borderRadius: 16,
        background: "#171717",
        color: "#fff",
        fontSize: 12,
        textDecoration: "none",
        boxShadow: "0 6px 20px rgba(23,23,23,0.28)",
        maxWidth: 360,
      }}
    >
      <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, animation: "auraSpin 1s linear infinite", flexShrink: 0 }}>
        <circle cx="12" cy="12" r="8.6" stroke="rgba(255,255,255,.3)" strokeWidth="3" fill="none" />
        <path d="M12 3.4a8.6 8.6 0 0 1 8.6 8.6" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
      </svg>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label} · {state.title}
      </span>
    </Link>
  );
}
