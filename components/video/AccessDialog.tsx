"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  projectAccessAction,
  shareProjectAction,
  unshareProjectAction,
} from "@/app/(app)/video/actions";

type Entry = { subjectType: string; subjectId: string; relation: string; label: string };
type Access = {
  canManage: boolean;
  relation: string;
  entries: Entry[];
  people: { id: string; name: string; email: string }[];
};

const btn = {
  height: 28,
  padding: "0 11px",
  borderRadius: 7,
  border: "1px solid #e2e2e2",
  background: "#fff",
  color: "#171717",
  font: "inherit",
  fontSize: 12,
  cursor: "pointer",
} as const;
const select = { ...btn, padding: "0 6px" } as const;

/**
 * Who can open a project.
 *
 * What someone makes is theirs until they share it: with one person, with
 * everyone on staff, or with everybody holding a role. Owners and admins of
 * the studio can always open everything and change anybody's access, which the
 * dialog says, so nobody wonders why an admin sees a "private" cut.
 */
export function AccessDialog({
  projectId,
  title,
  zh,
  onClose,
}: {
  projectId: string;
  title: string;
  zh: boolean;
  onClose: () => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState("everyone");
  const [relation, setRelation] = useState<"viewer" | "editor">("editor");
  const [pending, start] = useTransition();

  const load = () =>
    projectAccessAction(projectId).then((res) => {
      if ("error" in res) setError(res.error ?? "Could not load access");
      else setAccess(res.access);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const act = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
      await load();
      router.refresh();
    });

  const everyone = access?.entries.find((e) => e.subjectType === "tenant");

  return (
    <div
      onMouseDown={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 215, background: "rgba(23,23,23,0.18)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "14vh" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Who can open this", "谁可以打开")}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        style={{ width: "min(460px, 92vw)", padding: "17px 18px 14px", background: "#fff", borderRadius: 14, border: "1px solid #e2e2e2", boxShadow: "0 24px 64px rgba(23,23,23,0.22)" }}
      >
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("Who can open", "谁可以打开")} “{title}”</div>
        <p style={{ fontSize: 12, color: "#7c7c7c", lineHeight: 1.6, margin: "6px 0 12px" }}>
          {t(
            "Only you until you share it. The studio's owner and admins can always open every project. Sharing a project also shares the footage in it.",
            "分享之前只有你能看到。工作室的所有者和管理员始终可以打开所有项目。分享项目也会分享其中的素材。",
          )}
        </p>

        {!access && !error && <div style={{ fontSize: 12, color: "#999" }}>{t("Loading…", "加载中…")}</div>}

        {access && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              <Row label={t("Owner and admins", "所有者和管理员")} right={t("full access", "完全权限")} />
              {access.entries.length === 0 && (
                <Row label={t("Nobody else. Private.", "没有其他人。私有。")} right="" />
              )}
              {access.entries.map((e) => (
                <Row
                  key={`${e.subjectType}:${e.subjectId}`}
                  label={e.label}
                  right={e.relation === "editor" ? t("can edit", "可编辑") : t("can view", "可查看")}
                  onRemove={
                    access.canManage
                      ? () => act(() => unshareProjectAction(projectId, e.subjectType, e.subjectId))
                      : undefined
                  }
                  removeLabel={t("remove", "移除")}
                />
              ))}
            </div>

            {access.canManage ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...select, flex: "1 1 180px", minWidth: 0 }}>
                  <option value="everyone">{t("Everyone in the studio", "工作室所有人")}</option>
                  <option value="role:member">{t("All members", "所有成员")}</option>
                  <option value="role:guest">{t("All guests", "所有访客")}</option>
                  {access.people.map((p) => (
                    <option key={p.id} value={`user:${p.id}`}>
                      {p.name} · {p.email}
                    </option>
                  ))}
                </select>
                <select value={relation} onChange={(e) => setRelation(e.target.value as "viewer" | "editor")} style={select}>
                  <option value="viewer">{t("can view", "可查看")}</option>
                  <option value="editor">{t("can edit", "可编辑")}</option>
                </select>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => shareProjectAction(projectId, target, relation))}
                  style={{ ...btn, background: "#171717", color: "#fff", borderColor: "#171717" }}
                >
                  {t("Share", "分享")}
                </button>
                {everyone && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => act(() => unshareProjectAction(projectId, "tenant", everyone.subjectId))}
                    style={btn}
                  >
                    {t("Make private", "设为私有")}
                  </button>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#7c7c7c" }}>
                {t("Only the owner or an admin can change who has access.", "只有所有者或管理员可以更改访问权限。")}
              </div>
            )}
          </>
        )}

        {error && <div style={{ fontSize: 12, color: "#c0392b", marginTop: 10 }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" onClick={onClose} style={btn}>
            {t("Done", "完成")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, right, onRemove, removeLabel }: { label: string; right: string; onRemove?: () => void; removeLabel?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "6px 9px", border: "1px solid #ededed", borderRadius: 8 }}>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ color: "#7c7c7c", fontSize: 11.5 }}>{right}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} style={{ border: 0, background: "transparent", color: "#7c7c7c", cursor: "pointer", font: "inherit", fontSize: 11.5, padding: 0 }}>
          {removeLabel}
        </button>
      )}
    </div>
  );
}
