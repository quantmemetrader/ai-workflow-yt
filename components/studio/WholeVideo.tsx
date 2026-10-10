"use client";

import * as React from "react";
import Link from "next/link";
import { notify } from "@/lib/client/notify";
import { AutoHost } from "@/components/video/AutoHost";
import { projectsForAutoAction } from "@/app/(app)/studio/actions";
import { setScriptLengthAction, startFromTopicAction, startProjectAction } from "@/app/(app)/projects/actions";

type Row = { id: string; title: string; hasScript: boolean };

/**
 * 整条视频 from the Studio (10 Oct: "let's have that video made from here
 * too"). Pick a project that has a script, or type a topic and let 文案 draft
 * one; then the same AI 自动生成 panel as on the project's 剪辑 page runs the
 * whole thing: her voice, her face, the cut, the render.
 */
export function WholeVideoPanel({ zh }: { zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [pick, setPick] = React.useState<string>("");
  const [topic, setTopic] = React.useState("");
  const [secs, setSecs] = React.useState(60);
  const [busy, setBusy] = React.useState(false);
  const [project, setProject] = React.useState<{ id: string; title: string; fresh: boolean } | null>(null);
  React.useEffect(() => {
    void projectsForAutoAction().then((r) => {
      const v = r as { rows?: Row[]; error?: string };
      if (v.error) return notify(v.error);
      setRows(v.rows ?? []);
    });
  }, []);
  const usable = (rows ?? []).filter((r) => r.hasScript);

  const startNew = async () => {
    const said = topic.trim();
    if (!said) return;
    setBusy(true);
    try {
      const r = (await startProjectAction({ message: said })) as { error?: string; id?: string };
      if (r.error || !r.id) return notify(r.error ?? t("没建成项目", "Could not start the project"));
      await setScriptLengthAction(r.id, secs).catch(() => null);
      await startFromTopicAction({ kind: "project", id: r.id }, { write: true }).catch(() => null);
      setProject({ id: r.id, title: said, fresh: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="st-card">
      <p className="st-help">{t("从脚本到成片，一次做完：文案写稿（或用已有的）→ 她的克隆声音读 → 她的视频对口型 → 剪辑师加画面、字幕 → 渲染。做好的在项目的「剪辑」页看、下载、导出到剪映。", "Script to film in one go: the writer drafts (or an existing script) → read in her cloned voice → her clip lip-synced → the editor adds pictures and captions → rendered. The result is on the project's 剪辑 page to watch, download or export to CapCut.")}</p>
      {project ? (
        <>
          <div className="st-out">
            <div className="st-out-name">{project.title}</div>
            <div style={{ fontSize: 12.5, color: "#6b6b6b" }}>{project.fresh ? t("项目已建好，文案正在写初稿（约一两分钟）。下面可以直接开始，生成会等稿子写好再读。", "Project started; the writer is drafting (a minute or two). You can start below; the job waits for the draft.") : t("用这个项目的脚本。", "Using this project's script.")}</div>
            <Link href={`/projects/${project.id}/edit`}>{t("打开项目的剪辑页 →", "Open the project's edit page →")}</Link>
          </div>
          <AutoHost projectId={project.id} zh={zh} hasScript onStarted={() => notify(t("已交给剪辑师，进度在项目的「剪辑」页", "Handed to the editor; progress is on the project's edit page"), "ok")} />
          <button type="button" className="st-link" onClick={() => setProject(null)}>{t("换一个项目", "Another project")}</button>
        </>
      ) : (
        <>
          <label className="st-label">{t("A. 用已有的脚本", "A. An existing script")}</label>
          <div className="st-row">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t("项目", "Project")}>
              <option value="">{rows === null ? t("正在读取项目…", "Loading projects…") : usable.length ? t("选一个有脚本的项目", "Pick a project with a script") : t("还没有带脚本的项目", "No project with a script yet")}</option>
              {usable.map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
            <button type="button" className="st-solid" disabled={!pick} onClick={() => { const r = usable.find((x) => x.id === pick); if (r) setProject({ id: r.id, title: r.title, fresh: false }); }}>
              {t("用这个", "Use this")}
            </button>
          </div>
          <label className="st-label">{t("B. 或者一句话新建", "B. Or start from one line")}</label>
          <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} placeholder={t("想做什么主题？一句话就行", "What is it about? One line is enough")} />
          <div className="st-row">
            <select value={secs} onChange={(e) => setSecs(Number(e.target.value))} aria-label={t("时长", "Length")}>
              <option value={60}>{t("1 分钟", "1 min")}</option>
              <option value={180}>{t("3 分钟", "3 min")}</option>
              <option value={300}>{t("5 分钟", "5 min")}</option>
            </select>
            <span style={{ flex: 1 }} />
            <button type="button" className="st-solid" disabled={busy || topic.trim().length < 2} onClick={() => void startNew()}>
              {busy ? t("建项目中…", "Starting…") : t("新建并写稿", "Start and draft")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
