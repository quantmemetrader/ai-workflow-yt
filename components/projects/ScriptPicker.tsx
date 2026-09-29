"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type PickerScript = { id: string; title: string; status: "brief" | "drafting" | "awaiting_approval" | "locked" | "archived"; version: number; updatedAt: string; href: string };
type PickerGroup = { projectId: string | null; title: string; updatedAt: string; scripts: PickerScript[] };

const STATUS: Record<PickerScript["status"], { zh: string; en: string; ink: string; bg: string }> = {
  brief: { zh: "待写", en: "To write", ink: "#5f5f5f", bg: "#f1f1ef" },
  drafting: { zh: "未批准", en: "Not approved", ink: "#1f5fbf", bg: "#e9f2fe" },
  awaiting_approval: { zh: "待审批", en: "In review", ink: "#95590a", bg: "#fff4df" },
  locked: { zh: "已批准", en: "Approved", ink: "#1e7a4f", bg: "#e7f6ee" },
  archived: { zh: "已归档", en: "Archived", ink: "#7c7c7c", bg: "#f0f0f0" },
};

/**
 * 「所有脚本」 as a drawer: every script this person may open, one folder per
 * project (and 未归入项目), with search; picking one goes to it. Mounted on
 * the script page so a writer can switch scripts without leaving.
 *
 *   <ScriptPicker zh currentId={scriptId} onClose={() => setOpen(false)} />
 *
 * It fetches its own list from `/api/script/folders` when it opens.
 */
export function ScriptPicker({ zh, currentId, onClose }: { zh: boolean; currentId?: string | null; onClose: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [groups, setGroups] = React.useState<PickerGroup[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [closed, setClosed] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    let live = true;
    fetch("/api/script/folders", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { groups: PickerGroup[] }) => live && setGroups(j.groups))
      .catch(() => live && setFailed(true));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      live = false;
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const shown = (groups ?? [])
    .map((g) => ({ ...g, scripts: needle ? g.scripts.filter((s) => s.title.toLowerCase().includes(needle) || g.title.toLowerCase().includes(needle)) : g.scripts }))
    .filter((g) => g.scripts.length > 0);
  const total = (groups ?? []).reduce((n, g) => n + g.scripts.length, 0);
  const keyOf = (g: PickerGroup) => g.projectId ?? "__loose";

  return (
    <div role="dialog" aria-label={t("所有脚本", "All scripts")} style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(23,23,23,.28)" }} />
      <aside style={{ position: "relative", marginLeft: "auto", width: "min(460px, 100vw)", height: "100%", background: "#fff", boxShadow: "-12px 0 40px rgba(0,0,0,.14)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 18px 10px" }}>
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: "#171717" }}>{t("所有脚本", "All scripts")}</div>
            <div style={{ fontSize: 12.5, color: "#8a8a8a", marginTop: 2 }}>{groups ? t(`${total} 份，按项目分文件夹`, `${total}, in one folder per project`) : t("正在读取…", "Loading…")}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={t("关闭", "Close")} style={{ width: 34, height: 34, border: 0, borderRadius: 9, background: "transparent", cursor: "pointer", color: "#525252" }}>
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div style={{ padding: "0 18px 12px" }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("搜脚本或项目…", "Search scripts or projects…")}
            style={{ width: "100%", boxSizing: "border-box", height: 40, padding: "0 12px", border: "1px solid #dcdbd6", borderRadius: 10, fontFamily: "inherit", fontSize: 14, outline: "none" }}
          />
        </div>
        <div style={{ flexGrow: 1, overflowY: "auto", padding: "0 10px 18px" }}>
          {failed ? <div style={{ padding: 18, fontSize: 13, color: "#c42b2b" }}>{t("没读到脚本列表，关掉再试一次。", "Could not load the list; close and try again.")}</div> : null}
          {groups && !shown.length ? <div style={{ padding: 18, fontSize: 13, color: "#8a8a8a" }}>{needle ? t("没有找到。", "Nothing found.") : t("还没有脚本。", "No scripts yet.")}</div> : null}
          {shown.map((g) => {
            const k = keyOf(g);
            const open = needle ? true : !closed.has(k);
            return (
              <div key={k} style={{ marginBottom: 4 }}>
                <button
                  type="button"
                  onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                  aria-expanded={open}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", height: 38, padding: "0 8px", border: 0, borderRadius: 8, background: "transparent", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}
                >
                  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="#8a8a8a" strokeWidth={2} strokeLinecap="round" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s ease", flexShrink: 0 }}><path d="m9 6 6 6-6 6" /></svg>
                  <FolderGlyph />
                  <span style={{ flexGrow: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "#171717", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.projectId ? g.title : t("未归入项目", "Not in a project")}</span>
                  <span style={{ fontSize: 12, color: "#9a9a9a" }}>{g.scripts.length}</span>
                </button>
                {open
                  ? g.scripts.map((s) => {
                      const st = STATUS[s.status];
                      const on = s.id === currentId;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            onClose();
                            if (!on) router.push(s.href);
                          }}
                          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 44, padding: "6px 10px 6px 42px", border: 0, borderRadius: 8, background: on ? "#eef4fe" : "transparent", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}
                        >
                          <span style={{ flexGrow: 1, minWidth: 0, fontSize: 13.5, color: "#262626", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: st.ink, background: st.bg, borderRadius: 999, padding: "0 8px", lineHeight: "20px", whiteSpace: "nowrap" }}>{zh ? st.zh : st.en}</span>
                          {on ? <span style={{ fontSize: 11.5, color: "#1f5fbf" }}>{t("当前", "Open")}</span> : null}
                        </button>
                      );
                    })
                  : null}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={17} height={17} aria-hidden style={{ flexShrink: 0 }}>
      <path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z" fill="#f2c94c" />
    </svg>
  );
}
