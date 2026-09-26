"use client";

import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";
import * as React from "react";
import { useRouter } from "next/navigation";
import { startProjectAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";

/** A new project from a name, then straight into it. */
export function NewProjectButton({ zh, compact = false }: { zh: boolean; compact?: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [pending, start] = React.useTransition();
  function go() {
    const v = name.trim();
    if (!v) return;
    start(async () => {
      const r = await startProjectAction({ title: v });
      if ("error" in r && r.error) {
        notify(r.error);
        return;
      }
      setOpen(false);
      setName("");
      if ("id" in r && r.id) router.push(`/projects/${r.id}`); setTimeout(() => router.refresh(), 400);
    });
  }
  if (open)
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        style={{ display: "flex", gap: 6 }}
      >
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)} placeholder={t("项目名，例如：RWA 60 秒竖版", "Project name, e.g. RWA 60s vertical")} style={{ height: compact ? 28 : 34, minWidth: 0, width: compact ? "100%" : 260, padding: "0 10px", border: "1px solid #d9d9d9", borderRadius: 8, fontFamily: "inherit", fontSize: 12.5, outline: "none" }} />
        <button type="submit" disabled={pending || !name.trim()} style={{ height: compact ? 28 : 34, padding: "0 12px", borderRadius: 8, border: 0, background: "#171717", color: "#fff", fontFamily: "inherit", fontSize: 12.5, cursor: "pointer", flexShrink: 0 }}>
          {t("开始", "Start")}
        </button>
      </form>
    );
  return (
    <button type="button" onClick={() => setOpen(true)} style={{ height: compact ? 28 : 34, padding: "0 12px", borderRadius: 8, border: compact ? "1px dashed #d9d9d9" : 0, background: compact ? "transparent" : "#171717", color: compact ? "#525252" : "#fff", fontFamily: "inherit", fontSize: 12.5, cursor: "pointer", width: compact ? "100%" : undefined, textAlign: compact ? "left" : "center" }}>
      {/* Translate-proof: it sits in the rail under the projects. */}
      <Icon name="plus" size={13} /> <Tr zh="新项目" en="New project" inZh={zh} />
    </button>
  );
}
