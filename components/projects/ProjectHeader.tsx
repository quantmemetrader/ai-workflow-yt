"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { AccessPicker } from "@/components/files/AccessPicker";
import { PublishedPill } from "@/components/projects/Published";
import { deleteProjectAction, renameProjectAction, setProjectAccessAction, setProjectStatusAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";
import { PROJECT_TABS, tabOfPath, type ProjectTab, type TabState } from "@/lib/projects/tabs";
import type { PublishedPlace } from "@/lib/projects/publication";

export type HeaderProject = {
  id: string;
  title: string;
  status: string;
  canManage: boolean;
  /** Started by this person: 「仅自己」 is only true for them. */
  mine?: boolean;
  /** Opened by its shared link rather than as a member (`ProjectDetail.linkOnly`). */
  linkOnly?: "view" | "edit" | null;
  access: { mode: "private" | "everyone" | "groups" | "people"; groups?: string[]; userIds?: string[]; link?: "view" | "edit" };
  published: PublishedPlace[];
  tabs: Partial<Record<ProjectTab, TabState>>;
};

/**
 * The top of every project page: where you are (项目 / name), the name
 * itself (the pencil, or a double-click, to rename), its state, who can see it, archive and
 * delete — and the row of tabs, one per page, the numbered steps with a
 * green tick once done and an orange dot on the one to do now.
 */
export function ProjectHeader({ p, zh }: { p: HeaderProject; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const active = tabOfPath(pathname);
  const [pending, start] = React.useTransition();
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState(p.title);
  const [sharing, setSharing] = React.useState(false);
  React.useEffect(() => setName(p.title), [p.title]);
  /* A rename that would leave it nameless says so and keeps the old name
     (QA, 2 Oct: an empty name silently went back). */
  /* Esc drops the edit; the blur that may follow must not save it. */
  const dropName = React.useRef(false);
  React.useEffect(() => {
    if (naming) dropName.current = false;
  }, [naming]);
  const saveName = () => {
    if (pending || dropName.current) return;
    const next = name.trim();
    if (!next) {
      notify(t("名字不能为空，原来的名字没有改", "A project needs a name; the old one is kept"));
      setName(p.title);
      setNaming(false);
      return;
    }
    if (next === p.title) return setNaming(false);
    start(async () => {
      const r = await renameProjectAction(p.id, next);
      if (r?.error) notify(r.error);
      else notify(t("已改名，脚本标题也一起改了", "Renamed; the script's title follows"), "ok");
      setNaming(false);
      router.refresh();
    });
  };
  /* Who can see it, said to whoever is looking (QA, 2 Oct: a colleague
     who opened a private project by its link was told 「仅自己」). */
  const linkWord = (l: "view" | "edit" | undefined | null) => (l === "edit" ? t("有链接可编辑", "link can edit") : l === "view" ? t("有链接可查看", "link can view") : "");
  const reach =
    p.access.mode === "everyone"
      ? t("全工作室可见", "Everyone")
      : p.access.mode === "private"
        ? p.mine
          ? t("仅自己", "Private")
          : t("仅创建者可见", "Owner only")
        : p.access.mode === "groups"
          ? t("部分分组", "Groups")
          : t(`${p.access.userIds?.length ?? 0} 人可见`, `${p.access.userIds?.length ?? 0} people`);
  const reachLine = p.linkOnly
    ? `${reach} · ${p.linkOnly === "edit" ? t("你通过链接打开，可编辑", "you opened the link: can edit") : t("你通过链接打开，只能查看", "you opened the link: view only")}`
    : p.access.mode !== "everyone" && p.access.link
      ? `${reach} · ${linkWord(p.access.link)}`
      : reach;
  /* Someone who came by the shared link sees the page it was shared from,
     the script, not every page of the project (QA, 2 Oct). */
  const tabs = p.linkOnly ? PROJECT_TABS.filter((x) => x.key === "script") : PROJECT_TABS;

  const statusPill =
    p.status === "done" ? (
      <PublishedPill zh={zh} platforms={p.published} size="md" links />
    ) : (
      <span style={{ fontSize: 11.5, fontWeight: 500, color: p.status === "archived" ? "#7c7c7c" : "#0f5bd5", background: p.status === "archived" ? "#f0f0f0" : "#e6effd", borderRadius: 999, padding: "0 9px", lineHeight: "22px", whiteSpace: "nowrap", flexShrink: 0 }}>
        {p.status === "archived" ? t("已归档", "Archived") : t("进行中", "In progress")}
      </span>
    );

  return (
    <div style={{ flexShrink: 0, background: "rgba(250,250,248,.92)", borderBottom: "1px solid #e7e6e2" }}>
      <style>{HEADER_CSS}</style>
      <div style={{ padding: "12px 32px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Link prefetch={false} href="/projects" className="ph-quiet" style={{ fontSize: 12, color: "#8a8a8a", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <Icon name="folder" size={13} />
            {t("项目", "Projects")}
          </Link>
          <span style={{ color: "#c8c8c4" }}>/</span>
          {naming ? (
            <form
              style={{ flexGrow: 1, minWidth: 0 }}
              onSubmit={(e) => {
                e.preventDefault();
                saveName();
              }}
            >
              <input
                autoFocus
                value={name}
                maxLength={80}
                aria-label={t("项目名字", "Project name")}
                placeholder={t("给项目起个名字", "Name the project")}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    dropName.current = true;
                    setName(p.title);
                    setNaming(false);
                  }
                }}
                style={{ fontSize: 18, fontWeight: 600, border: "1px solid #d9d9d9", borderRadius: 8, padding: "2px 8px", width: "100%", fontFamily: "inherit" }}
              />
            </form>
          ) : (
            <>
              <h1 onDoubleClick={() => p.canManage && setNaming(true)} title={p.canManage ? t("双击或点旁边的笔改名", "Double-click or press the pencil to rename") : undefined} style={{ fontSize: 18, fontWeight: 600, margin: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: p.canManage ? "text" : "default" }}>
                {p.title}
              </h1>
              {/* A press you can see: double-click alone was a hidden way in (QA, 2 Oct). */}
              {p.canManage ? (
                <button type="button" className="ph-quiet" onClick={() => setNaming(true)} aria-label={t("改名", "Rename")} title={t("改名", "Rename")} style={{ ...quiet("#8a8a8a"), width: 26, padding: 0, justifyContent: "center" }}>
                  <Icon name="pen" size={13} />
                </button>
              ) : null}
            </>
          )}
          {statusPill}
          <span style={{ flexGrow: 1 }} />
          <button type="button" className="ph-quiet" onClick={() => p.canManage && setSharing(true)} disabled={!p.canManage} title={p.canManage ? t("更改谁能看到", "Change who can see it") : undefined} style={quiet("#7a7a7a")}>
            <Icon name={p.access.mode === "everyone" ? "eye" : "lock"} size={12} />
            {reachLine}
          </button>
          {p.canManage ? (
            <>
              {/* Said, not silent (QA, 2 Oct: one press and nothing told you
                  where it went). The same button reads 取消归档 after, which is the undo. */}
              <button
                type="button"
                className="ph-quiet"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const archiving = p.status !== "archived";
                    const r = await setProjectStatusAction(p.id, archiving ? "archived" : "active");
                    if (r?.error) notify(r.error);
                    else notify(archiving ? t("已归档。在项目列表的「已归档」里能找到，按「取消归档」就能恢复。", "Archived. Find it under Archived in the list; press Unarchive to bring it back.") : t("已恢复为进行中", "Back in progress"), "ok");
                    router.refresh();
                  })
                }
                style={quiet("#7a7a7a")}
              >
                {p.status === "archived" ? t("取消归档", "Unarchive") : t("归档", "Archive")}
              </button>
              <button
                type="button"
                className="ph-quiet ph-danger"
                disabled={pending}
                style={quiet("#c42b2b")}
                onClick={() => {
                  if (!window.confirm(t("删除这个项目？对话、脚本和视频会从列表里消失。", "Delete this project? Its chat, script and video leave every list."))) return;
                  start(async () => {
                    const r = await deleteProjectAction(p.id);
                    if (r?.error) notify(r.error);
                    else {
                      notify(t("项目已删除", "Project deleted"), "ok");
                      router.push("/projects");
                    }
                  });
                }}
              >
                {t("删除", "Delete")}
              </button>
            </>
          ) : null}
        </div>
        <nav aria-label={t("项目页面", "Project pages")} style={{ display: "flex", gap: 2, marginTop: 10, overflowX: "auto" }}>
          {tabs.map((tab) => {
            const state = tab.n ? p.tabs[tab.key] : undefined;
            const on = active === tab.key;
            return (
              <Link key={tab.key} prefetch={false} href={`/projects/${p.id}${tab.path}`} aria-current={on ? "page" : undefined} className="ph-tab" data-on={on ? "1" : undefined}>
                {tab.n ? (
                  <span className="ph-num" data-state={state}>
                    {state === "done" ? <Icon name="check" size={11} /> : tab.n}
                  </span>
                ) : (
                  <Icon name={tab.key === "overview" ? "chat" : "folder"} size={13} />
                )}
                {zh ? tab.zh : tab.en}
                {state === "now" ? <span className="ph-now">{t("进行中", "now")}</span> : null}
              </Link>
            );
          })}
        </nav>
      </div>
      {sharing ? (
        <AccessPicker
          title={t("谁可以看到并参与这个项目？", "Who can see and work on this project?")}
          zh={zh}
          initial={p.access.mode === "groups" ? { mode: "groups", groups: p.access.groups ?? [] } : p.access.mode === "people" ? { mode: "people", userIds: p.access.userIds ?? [] } : { mode: p.access.mode }}
          confirm={t("保存", "Save")}
          note={t("对话、脚本和视频都跟着这个设置。AI 员工始终可以参与。", "The chat, script and video follow this. The AI employees can always take part.")}
          onClose={() => setSharing(false)}
          onConfirm={(choice) =>
            start(async () => {
              const r = await setProjectAccessAction(p.id, choice as Parameters<typeof setProjectAccessAction>[1]);
              if (r?.error) notify(r.error);
              setSharing(false);
              router.refresh();
            })
          }
        />
      ) : null}
    </div>
  );
}

function quiet(color: string): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 8px", border: 0, borderRadius: 7, background: "transparent", color, fontFamily: "inherit", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 };
}

const HEADER_CSS = `
.ph-quiet { transition: background-color .15s ease, color .15s ease; }
.ph-quiet:hover:not(:disabled) { background: rgba(0,0,0,.05) !important; color: #171717 !important; }
.ph-danger:hover:not(:disabled) { background: #fdecea !important; color: #b42318 !important; }
.ph-tab { display: inline-flex; align-items: center; gap: 7px; height: 40px; padding: 0 14px; font-size: 13.5px; color: #6b6b6b; text-decoration: none; border-bottom: 2px solid transparent; white-space: nowrap; transition: color .15s ease, border-color .15s ease; }
.ph-tab:hover { color: #171717; }
.ph-tab[data-on] { color: #171717; font-weight: 600; border-bottom-color: #171717; }
.ph-num { width: 20px; height: 20px; border-radius: 99px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; border: 1px solid #d4d4d0; color: #6b6b6b; background: #fff; }
.ph-num[data-state="done"] { background: #22a061; border-color: #22a061; color: #fff; }
.ph-num[data-state="now"] { background: #f0a53a; border-color: #f0a53a; color: #fff; }
.ph-now { font-size: 10.5px; font-weight: 600; color: #95590a; background: #fff4df; border-radius: 99px; padding: 0 7px; line-height: 18px; }
`;
