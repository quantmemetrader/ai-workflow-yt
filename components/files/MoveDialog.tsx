"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { moveItemsAction, moveTargetsAction } from "@/app/(app)/files/actions";
import { notify } from "@/lib/client/notify";

type Target = { id: string; name: string; parentId: string | null };

/** What is being moved: files, folders, or (from 移动所选) several files. */
export type MoveItems = { files: string[]; folders: string[]; label: string };

/**
 * 移动到…: the folders this person can put things into, as a tree, with
 * 根目录 at the top. A folder being moved is left out along with everything
 * under it — it cannot go inside itself — and the server refuses that too.
 */
export function MoveDialog({
  zh,
  items,
  currentFolderId,
  onClose,
  onMoved,
}: {
  zh: boolean;
  items: MoveItems;
  /** Where the items are now, drawn as 当前位置 and not offered. */
  currentFolderId?: string | null;
  onClose: () => void;
  onMoved?: () => void;
}) {
  const t = (cn: string, en: string) => (zh ? cn : en);
  const id = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    void moveTargetsAction().then((res) => {
      if (!live) return;
      if ("error" in res && res.error) notify(res.error);
      setTargets(res.folders ?? []);
    });
    return () => {
      live = false;
    };
  }, []);

  /* The tree: children by parent, a folder whose parent is not offered
     (shared to you alone) drawn at the top. Moved folders and their
     descendants are left out. */
  const { children, hidden } = useMemo(() => {
    const list = targets ?? [];
    const known = new Set(list.map((f) => f.id));
    const byParent = new Map<string | null, Target[]>();
    for (const f of list) {
      const parent = f.parentId && known.has(f.parentId) ? f.parentId : null;
      byParent.set(parent, [...(byParent.get(parent) ?? []), f]);
    }
    const out = new Set<string>();
    const walk = (fid: string) => {
      out.add(fid);
      for (const c of byParent.get(fid) ?? []) walk(c.id);
    };
    for (const fid of items.folders) walk(fid);
    return { children: byParent, hidden: out };
  }, [targets, items.folders]);

  const flat: { folder: Target; depth: number; hasKids: boolean }[] = [];
  const draw = (parent: string | null, depth: number) => {
    for (const f of children.get(parent) ?? []) {
      if (hidden.has(f.id)) continue;
      const kids = (children.get(f.id) ?? []).filter((c) => !hidden.has(c.id));
      flat.push({ folder: f, depth, hasKids: kids.length > 0 });
      if (open.has(f.id)) draw(f.id, depth + 1);
    }
  };
  draw(null, 0);

  const toggle = (fid: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(fid)) next.delete(fid);
      else next.add(fid);
      return next;
    });

  const go = () => {
    if (chosen === undefined) return;
    const name = chosen === null ? t("根目录", "Top level") : (targets?.find((f) => f.id === chosen)?.name ?? "");
    start(async () => {
      const res = await moveItemsAction({ files: items.files, folders: items.folders }, chosen);
      if ("error" in res && res.error) {
        notify(res.error);
        return;
      }
      const failed = "failed" in res && res.failed ? res.failed : 0;
      if ("moved" in res && !res.moved && !failed) {
        notify(t(`已经在「${name}」里了`, `Already in “${name}”`), "info");
        onClose();
        return;
      }
      notify(
        failed
          ? t(`已移到「${name}」，${failed} 项没有权限移动`, `Moved to “${name}”; ${failed} could not be moved`)
          : t(`已移到「${name}」`, `Moved to “${name}”`),
        failed ? "info" : "ok",
      );
      onClose();
      onMoved?.();
      router.refresh();
    });
  };

  const row = (key: string, label: string, depth: number, value: string | null, extra?: React.ReactNode) => {
    const on = chosen === value;
    const here = (currentFolderId ?? null) === value && items.folders.length === 0 && value !== null;
    return (
      <div
        key={key}
        role="option"
        aria-selected={on}
        aria-disabled={here}
        tabIndex={here ? -1 : 0}
        onClick={() => !here && setChosen(value)}
        onDoubleClick={() => value && toggle(value)}
        onKeyDown={(e) => {
          if (here) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setChosen(value);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 32,
          padding: `0 8px 0 ${8 + depth * 18}px`,
          borderRadius: 7,
          cursor: here ? "default" : "pointer",
          background: on ? "#eaf2fe" : "transparent",
          color: here ? "#b0b0b0" : "#262626",
          fontSize: 13,
        }}
      >
        {extra ?? <span style={{ width: 16, flexShrink: 0 }} />}
        <Icon name={value === null ? "folderOpen" : "folder"} size={14} color={on ? "#1f6feb" : "#7c7c7c"} />
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {here ? <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#b0b0b0", flexShrink: 0 }}>{t("当前位置", "Current")}</span> : null}
      </div>
    );
  };

  return (
    <div
      onMouseDown={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 215, background: "rgba(23,23,23,0.18)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "12vh" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        tabIndex={-1}
        style={{
          width: "min(440px, 92vw)",
          padding: "17px 18px 14px",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e2e2",
          boxShadow: "0 24px 64px rgba(23,23,23,0.22)",
          animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div id={`${id}-title`} style={{ fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t(`把「${items.label}」移动到…`, `Move “${items.label}” to…`)}
        </div>
        <div role="listbox" aria-label={t("目标文件夹", "Destination")} style={{ margin: "12px 0 0", border: "1px solid #ededed", borderRadius: 10, padding: 4, height: "min(340px, 50vh)", overflowY: "auto" }}>
          {targets === null ? (
            <div style={{ padding: 14, fontSize: 12.5, color: "#999" }}>{t("正在读取文件夹…", "Loading folders…")}</div>
          ) : (
            <>
              {row("root", t("根目录", "Top level"), 0, null)}
              {flat.map(({ folder, depth, hasKids }) =>
                row(
                  folder.id,
                  folder.name,
                  depth + 1,
                  folder.id,
                  hasKids ? (
                    <button
                      type="button"
                      aria-label={open.has(folder.id) ? t("收起", "Collapse") : t("展开", "Expand")}
                      aria-expanded={open.has(folder.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(folder.id);
                      }}
                      style={{ width: 16, height: 16, padding: 0, border: 0, background: "transparent", color: "#7c7c7c", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transform: open.has(folder.id) ? "rotate(90deg)" : undefined, transition: "transform .12s ease" }}
                    >
                      <Icon name="next" size={12} />
                    </button>
                  ) : undefined,
                ),
              )}
              {flat.length === 0 ? (
                <div style={{ padding: "8px 12px", fontSize: 12, color: "#999" }}>{t("没有其他你可以编辑的文件夹", "No other folders you can edit")}</div>
              ) : null}
            </>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: "#999", marginTop: 8, lineHeight: 1.5 }}>
          {t("移动后，目标文件夹的共享设置会对它生效；单独设置的权限保持不变。", "Once moved, the destination folder's sharing applies to it; its own sharing stays as it is.")}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" onClick={onClose} style={ghost}>
            {t("取消", "Cancel")}
          </button>
          <button type="button" disabled={chosen === undefined || pending} onClick={go} style={{ ...solid, opacity: chosen === undefined || pending ? 0.45 : 1, cursor: chosen === undefined || pending ? "default" : "pointer" }}>
            {pending ? t("正在移动…", "Moving…") : t("移动", "Move")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 移动到… on a file's own page. */
export function MoveFileButton({ id, name, folderId, zh }: { id: string; name: string; folderId: string | null; zh: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn s" onClick={() => setOpen(true)} style={{ height: 30, color: "#171717", marginRight: 6, display: "inline-flex", alignItems: "center", gap: 5 }}>
        <Icon name="move" size={13} />
        {zh ? "移动到…" : "Move to…"}
      </button>
      {open ? <MoveDialog zh={zh} items={{ files: [id], folders: [], label: name }} currentFolderId={folderId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const ghost: React.CSSProperties = {
  height: 32,
  padding: "0 13px",
  borderRadius: 8,
  border: "1px solid #ededed",
  background: "#fff",
  color: "#525252",
  fontSize: 12.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};

const solid: React.CSSProperties = {
  height: 32,
  padding: "0 15px",
  borderRadius: 8,
  border: 0,
  background: "#171717",
  color: "#fff",
  fontSize: 12.5,
  fontWeight: 500,
  fontFamily: "inherit",
  letterSpacing: "inherit",
};
