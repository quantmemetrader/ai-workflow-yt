"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { addExampleFilesAction } from "@/app/(app)/train/actions";
import { notify } from "@/lib/client/notify";
import type { TrainKey } from "@/lib/agents/train-keys";

/**
 * One employee's card on AI 训练 as a drop target (Rahul, 4 Oct): files dropped
 * on 文案's card become 文案's examples, on 法务's card 法务's, and so on.
 */
export function ExampleDrop({ agent, name, zh, enabled, children }: { agent: TrainKey; name: string; zh: boolean; enabled: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const depth = React.useRef(0);
  if (!enabled) return <>{children}</>;
  const files = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return (
    <div
      style={{ position: "relative" }}
      onDragEnter={(e) => { if (!files(e)) return; depth.current += 1; setOver(true); }}
      onDragOver={(e) => { if (!files(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={(e) => { if (!files(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={async (e) => {
        depth.current = 0;
        setOver(false);
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        const form = new FormData();
        for (const f of Array.from(e.dataTransfer.files)) form.append("file", f);
        setBusy(true);
        try {
          const r = await addExampleFilesAction(agent, form);
          for (const msg of r.errors) notify(msg);
          if (r.added) { notify(zh ? `已给${name}加入 ${r.added} 篇范例` : `Added ${r.added} example${r.added === 1 ? "" : "s"} for ${name}`, "ok"); router.refresh(); }
        } catch {
          notify(zh ? "上传失败：文件可能太大，请到训练页粘贴文字" : "Upload failed: the file may be too large");
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {over || busy ? (
        <div aria-hidden style={{ position: "absolute", inset: 0, borderRadius: 14, border: "2px dashed #1f6feb", background: "rgba(245,249,255,.92)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", fontSize: 14, fontWeight: 600, color: "#1f4f9f", zIndex: 5 }}>
          {busy ? (zh ? "正在加入范例…" : "Adding…") : zh ? `松开，加为「${name}」的范例` : `Drop to add as ${name}'s examples`}
        </div>
      ) : null}
    </div>
  );
}
