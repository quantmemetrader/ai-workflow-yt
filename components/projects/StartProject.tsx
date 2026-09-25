"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { startProjectAction } from "@/app/(app)/projects/actions";
import { Icon } from "@/components/ui/Icon";
import { notify } from "@/lib/client/notify";

/** The one-press confirm behind `/projects/new`. */
export function StartProject({ zh, title, brief, from, ask }: { zh: boolean; title: string; brief: string; from: string; ask: string }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [name, setName] = React.useState(title);
  const [pending, start] = React.useTransition();
  function go() {
    if (!name.trim()) return;
    start(async () => {
      const r = await startProjectAction({ title: name.trim(), message: ask || undefined, source: { kind: from || "link", label: from === "digest" ? t("晨报信号", "Morning signal") : undefined } });
      if ("error" in r && r.error) {
        notify(r.error);
        return;
      }
      if ("id" in r && r.id) router.replace(`/projects/${r.id}`); setTimeout(() => router.refresh(), 400);
    });
  }
  return (
    <div style={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f4f3f0", backgroundImage: "radial-gradient(#d8d5cf 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
      <div style={{ width: 520, maxWidth: "calc(100% - 32px)", background: "#fff", border: "1px solid #e2e2e2", borderRadius: 16, padding: "22px 24px", boxShadow: "0 8px 30px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#999999" }}>
          <Icon name="film" size={14} />
          {t("新项目", "New project")}
          {from === "digest" ? ` · ${t("来自晨报", "from the morning brief")}` : ""}
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", marginTop: 10, fontSize: 20, fontWeight: 600, border: "1px solid #e2e2e2", borderRadius: 10, padding: "8px 12px", fontFamily: "inherit", outline: "none" }} />
        {brief ? <p style={{ fontSize: 13, color: "#525252", lineHeight: 1.65, margin: "12px 0 0", whiteSpace: "pre-wrap" }}>{brief}</p> : null}
        {ask ? <p style={{ fontSize: 12.5, color: "#0f5bd5", margin: "10px 0 0" }}>{t("开始后会交给：", "Once started it goes to: ")}{ask.split(" ")[0]}</p> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button type="button" onClick={() => router.back()} style={{ height: 34, padding: "0 14px", borderRadius: 9, border: "1px solid #e2e2e2", background: "#fff", fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>
            {t("取消", "Cancel")}
          </button>
          <button type="button" disabled={pending || !name.trim()} onClick={go} style={{ height: 34, padding: "0 16px", borderRadius: 9, border: 0, background: "#171717", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="plus" size={13} /> {t("开始这个项目", "Start this project")}
          </button>
        </div>
      </div>
    </div>
  );
}
