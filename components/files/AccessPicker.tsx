"use client";

import { useEffect, useState } from "react";
import { studioPeopleAction } from "@/app/(app)/files/actions";

export type AccessChoice =
  | { mode: "private" }
  | { mode: "everyone" }
  | { mode: "groups"; groups: string[] }
  | { mode: "people"; userIds: string[] };

const GROUPS = [
  { id: "admin", en: "Admins", zh: "管理员" },
  { id: "member", en: "Members", zh: "成员" },
  { id: "guest", en: "Guests", zh: "访客" },
] as const;

const box = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "10px 11px",
  borderRadius: 9,
  cursor: "pointer",
  fontSize: 13,
  textAlign: "left",
  width: "100%",
  font: "inherit",
  background: "#fff",
  color: "#171717",
} as const;

/** The hidden eye: private. Also used on file rows. */
export function EyeOffGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c5 0 9 4.5 10 7-0.4 1-1.3 2.4-2.6 3.7M6.2 6.3C4.2 7.6 2.7 9.6 2 12c1 2.5 5 7 10 7 1.7 0 3.2-.5 4.6-1.2" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export function GlobeGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </svg>
  );
}

export function PersonGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" />
    </svg>
  );
}

export function PeopleGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
      <path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.3c1.6.7 2.7 2.3 3 4.7" />
    </svg>
  );
}

/** One word for a row's access, with its icon. */
export function visibilityLabel(
  v: "private" | "everyone" | "groups" | "people" | undefined,
  groups: string[] | undefined,
  zh: boolean,
  people?: number,
) {
  if (v === "everyone") return zh ? "所有人" : "Everyone";
  if (v === "people") return zh ? `你和另外 ${people ?? 0} 人` : `You + ${people ?? 0} ${people === 1 ? "person" : "people"}`;
  if (v === "groups") {
    const names = GROUPS.filter((g) => groups?.includes(g.id)).map((g) => (zh ? g.zh : g.en));
    return names.join(zh ? "、" : ", ") || (zh ? "指定组" : "Groups");
  }
  return zh ? "仅自己" : "Only me";
}

/**
 * Who can see these files: asked the moment files are added, and again
 * whenever the owner changes their mind: private, specific people, everyone,
 * or one or more groups. Giving someone *edit* stays in the file's Share box.
 */
export function AccessPicker({
  title,
  zh,
  initial = { mode: "private" },
  confirm,
  note,
  onConfirm,
  onClose,
}: {
  title: string;
  zh: boolean;
  initial?: AccessChoice;
  confirm: string;
  note?: string;
  onConfirm: (choice: AccessChoice) => void;
  onClose: () => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [mode, setMode] = useState<AccessChoice["mode"]>(initial.mode);
  const [groups, setGroups] = useState<string[]>(initial.mode === "groups" ? initial.groups : ["member"]);
  const [picked, setPicked] = useState<string[]>(initial.mode === "people" ? initial.userIds : []);
  const [people, setPeople] = useState<{ id: string; name: string; email: string }[] | null>(null);
  const [q, setQ] = useState("");
  // The studio's people, fetched once, only when that option is opened.
  useEffect(() => {
    if (mode !== "people" || people) return;
    void studioPeopleAction().then((res) => setPeople("people" in res ? (res.people ?? []) : []));
  }, [mode, people]);

  const choice: AccessChoice =
    mode === "groups" ? { mode, groups } : mode === "people" ? { mode, userIds: picked } : { mode };
  const ready = (mode !== "groups" || groups.length > 0) && (mode !== "people" || picked.length > 0);
  const shown = (people ?? []).filter((p) => !q || `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase()));
  const option = (m: AccessChoice["mode"]) => ({
    ...box,
    border: mode === m ? "1.5px solid #171717" : "1px solid #e2e2e2",
  });

  return (
    <div
      onMouseDown={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(23,23,23,0.18)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "14vh" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        style={{ width: "min(420px, 92vw)", padding: "17px 18px 14px", background: "#fff", borderRadius: 14, border: "1px solid #e2e2e2", boxShadow: "0 24px 64px rgba(23,23,23,0.22)" }}
      >
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 12 }}>{title}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <button type="button" onClick={() => setMode("private")} style={option("private")}>
            <span style={{ marginTop: 1 }}><EyeOffGlyph size={16} /></span>
            <span>
              <span style={{ fontWeight: 500, display: "block" }}>{t("Private", "私有")}</span>
              <span style={{ fontSize: 11.5, color: "#7c7c7c" }}>{t("Only you.", "只有你自己。")}</span>
            </span>
          </button>
          <div role="button" tabIndex={0} onClick={() => setMode("people")} onKeyDown={(e) => { if (e.key === "Enter") setMode("people"); }} style={option("people")}>
            <span style={{ marginTop: 1 }}><PersonGlyph size={16} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 500, display: "block" }}>{t("Specific people", "指定的人")}</span>
              <span style={{ fontSize: 11.5, color: "#7c7c7c" }}>{t("You and the people you tick. Nobody else.", "你和你勾选的人，其他人都看不到。")}</span>
              {mode === "people" && (
                <span style={{ display: "block", marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t("Search name or email", "搜索姓名或邮箱")}
                    style={{ width: "100%", height: 28, padding: "0 8px", borderRadius: 7, border: "1px solid #e2e2e2", font: "inherit", fontSize: 12.5, boxSizing: "border-box" }}
                  />
                  <span style={{ display: "block", maxHeight: 150, overflowY: "auto", marginTop: 6 }}>
                    {people === null ? (
                      <span style={{ fontSize: 12, color: "#999999" }}>{t("Loading…", "加载中…")}</span>
                    ) : shown.length === 0 ? (
                      <span style={{ fontSize: 12, color: "#999999" }}>{t("Nobody matches.", "没有匹配的人。")}</span>
                    ) : (
                      shown.map((p) => (
                        <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, padding: "4px 0", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={picked.includes(p.id)}
                            onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))}
                          />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.name} <span style={{ color: "#999999" }}>· {p.email}</span>
                          </span>
                        </label>
                      ))
                    )}
                  </span>
                  {picked.length > 0 && (
                    <span style={{ display: "block", fontSize: 11.5, color: "#525252", marginTop: 4 }}>
                      {t(`You + ${picked.length} selected`, `你 + 已选 ${picked.length} 人`)}
                    </span>
                  )}
                </span>
              )}
            </span>
          </div>
          <button type="button" onClick={() => setMode("everyone")} style={option("everyone")}>
            <span style={{ marginTop: 1 }}><GlobeGlyph size={16} /></span>
            <span>
              <span style={{ fontWeight: 500, display: "block" }}>{t("Everyone in the studio", "工作室所有人")}</span>
              <span style={{ fontSize: 11.5, color: "#7c7c7c" }}>{t("All staff can view it. Guests cannot.", "所有员工可查看，访客不可见。")}</span>
            </span>
          </button>
          <div role="button" tabIndex={0} onClick={() => setMode("groups")} onKeyDown={(e) => { if (e.key === "Enter") setMode("groups"); }} style={option("groups")}>
            <span style={{ marginTop: 1 }}><PeopleGlyph size={16} /></span>
            <span style={{ flex: 1 }}>
              <span style={{ fontWeight: 500, display: "block" }}>{t("Choose groups", "选择组")}</span>
              <span style={{ fontSize: 11.5, color: "#7c7c7c" }}>{t("One or more. They can view it.", "可多选，组内成员可查看。")}</span>
              {mode === "groups" && (
                <span style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                  {GROUPS.map((g) => (
                    <label key={g.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={groups.includes(g.id)}
                        onChange={(e) => setGroups((cur) => (e.target.checked ? [...cur, g.id] : cur.filter((x) => x !== g.id)))}
                      />
                      {zh ? g.zh : g.en}
                    </label>
                  ))}
                </span>
              )}
            </span>
          </div>
        </div>

        {note && <p style={{ fontSize: 11.5, color: "#999999", lineHeight: 1.55, margin: "10px 0 0" }}>{note}</p>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" onClick={onClose} style={{ height: 30, padding: "0 12px", borderRadius: 8, border: "1px solid #e2e2e2", background: "#fff", font: "inherit", fontSize: 12.5, cursor: "pointer" }}>
            {t("Cancel", "取消")}
          </button>
          <button
            type="button"
            autoFocus
            disabled={!ready}
            onClick={() => onConfirm(choice)}
            style={{ height: 30, padding: "0 14px", borderRadius: 8, border: "1px solid #171717", background: "#171717", color: "#fff", font: "inherit", fontSize: 12.5, cursor: ready ? "pointer" : "default", opacity: ready ? 1 : 0.45 }}
          >
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
