"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  AudioRow,
  CaptionRow,
  ClipRow,
  ExportRow,
  GraphicRow,
  ItemRow,
  ProjectRow,
} from "@/lib/video/service";
import {
  addCaptionAction,
  addClipAction,
  addMusicAction,
  addItemAction,
  createProjectAction,
  deleteProjectAction,
  directAction,
  exportAction,
  linkScriptAction,
  moveItemAction,
  removeCaptionAction,
  removeClipAction,
  removeItemAction,
  addGraphicAction,
  removeGraphicAction,
  setLookAction,
  autoEditAction,
  splitCaptionsAction,
  splitItemAction,
  updateGraphicAction,
  removeTrackAction,
  sendToPublishAction,
  snapshotAction,
  transcribeAction,
  undoAction,
  updateCaptionAction,
  updateItemAction,
  updateProjectAction,
  updateTrackAction,
  voiceOverAction,
} from "@/app/(app)/video/actions";
import type { ProjectSnapshot } from "@/lib/video/history";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { AgentHistory } from "@/components/shell/AgentHistory";
import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { NameDialog } from "@/components/ui/NameDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AccessDialog } from "@/components/video/AccessDialog";
import { AccessPicker, type AccessChoice } from "@/components/files/AccessPicker";
import { Graphics } from "@/components/video/Graphics";
import { Trim } from "@/components/video/Trim";
import { Editor } from "@/components/video/Editor";
import { Inspector } from "@/components/video/Inspector";
import { Director } from "@/components/video/Director";
import { uploadFiles } from "@/lib/client/upload";
import { beginWork } from "@/lib/client/busy";
import { notify } from "@/lib/client/notify";
import { writeRendering } from "@/lib/client/rendering";
import { languagesInOrder, primaryLanguage } from "@/lib/video/languages";
import { Poster } from "@/components/files/Poster";
import { Badge, Empty, Label, ModuleHeader, Row, Tabs, clip, field, ghost, solid, useAction } from "@/components/ui/kit";

/**
 * Video Edit (spec §4.5), as an assembly module.
 *
 * Reshaped on 19 September: the client's reference is one of their own
 * interviews, so this cuts real footage rather than generating any. Nothing on
 * this screen waits on Vertex AI, ElevenLabs or Azure; FFmpeg on the box does
 * the work, queued as a job.
 *
 * Four tabs, which is the order somebody actually works in: put the footage in
 * the bin, cut it on the timeline, caption it, render it.
 */
/*
 * The seven `Video-*` artboards, as tabs: Library, Project and Bin, Queue,
 * Preview, Audio and Export. Tabs rather than routes because they are seven
 * views of one cut, and seven routes would be seven copies of the same header.
 */
type Tab = "edit" | "library" | "bin" | "timeline" | "audio" | "graphics" | "preview" | "exports";

export function VideoScreen({
  projects,
  project,
  clips,
  items,
  captions,
  graphics,
  autoEditing,
  exports: renders,
  footage,
  pictures = [],
  scripts = [],
  audio,
  voices,
  transcribing,
  transcriptionConfigured,
  heavyPaused = false,
  locale,
  model,
}: {
  projects: ProjectRow[];
  project: ProjectRow | null;
  clips: ClipRow[];
  items: ItemRow[];
  captions: CaptionRow[];
  graphics: GraphicRow[];
  /** A first cut is being made right now. */
  autoEditing: boolean;
  exports: ExportRow[];
  footage: { id: string; name: string; kind: string; durationMs: number | null }[];
  /** Pictures that can go on a graphic. */
  pictures?: { id: string; name: string }[];
  /** Scripts a cut can be tied to, when this person holds Script. */
  scripts?: { id: string; title: string; status: string }[];
  audio: AudioRow[];
  voices: { id: string; name: string; description: string | null }[];
  /** A transcription is queued or running for this project. */
  transcribing: boolean;
  /** Whether this deployment holds a transcription key at all. */
  transcriptionConfigured: boolean;
  /** Rendering and auto-edit are paused on this server (lib/jobs/heavy.ts). */
  heavyPaused?: boolean;
  locale: string;
  model: string;
}) {
  const zh = locale.startsWith("zh");
  const t = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const { busy, run } = useAction();

  /*
   * Undo.
   *
   * Everything here saves the moment you do it, which is right — and it left
   * people reaching for the browser's Back button to take something back,
   * which navigated away instead. So the editor keeps a short stack of whole
   * project states: before each change it pushes the one it has, and ⌘Z puts
   * it back. It covers the assistant too, which is the case that matters:
   * "undo what it just did" is one step, not forty.
   */
  const [past, setPast] = useState<ProjectSnapshot[]>([]);
  const [future, setFuture] = useState<ProjectSnapshot[]>([]);
  const current = useRef<ProjectSnapshot | null>(null);
  const projectId = project?.id ?? null;

  // The state as it stands, refreshed after every change so the *next* undo
  // has somewhere to go back to. One small query, off the critical path.
  const remember = useCallback(async () => {
    if (!projectId) return;
    const res = await snapshotAction(projectId);
    if ("snapshot" in res && res.snapshot) current.current = res.snapshot;
  }, [projectId]);

  /* Opening a different project starts a fresh history: undoing into another
     project's arrangement would be a very bad surprise. Derived during render
     rather than in an effect, which would clear the stack one frame late. */
  const [stackFor, setStackFor] = useState(projectId);
  if (stackFor !== projectId) {
    setStackFor(projectId);
    setPast([]);
    setFuture([]);
  }

  useEffect(() => {
    /* The remembered state belongs to whichever project is open. Cleared here
       rather than during render — a ref written while rendering is a lie to
       the next render — and immediately re-read. */
    current.current = null;
    void remember();
  }, [remember]);

  /** Wraps `run` for anything that changes the cut. */
  const edit = useCallback(
    (fn: () => Promise<{ error?: string } | void>, label?: string) => {
      const before = current.current;
      run(async () => {
        const res = await fn();
        if (res && "error" in res && res.error) return res;
        if (before) {
          setPast((stack) => [...stack.slice(-19), before]);
          setFuture([]);
        }
        await remember();
        return res;
      }, undefined, label);
    },
    [run, remember],
  );

  const undo = useCallback(() => {
    const last = past[past.length - 1];
    if (!last || !projectId) return;
    const now = current.current;
    run(async () => {
      const res = await undoAction(projectId, last);
      if (res.error) return res;
      setPast((stack) => stack.slice(0, -1));
      if (now) setFuture((stack) => [...stack.slice(-19), now]);
      current.current = last;
      return {};
    });
  }, [past, projectId, run]);

  const redo = useCallback(() => {
    const next = future[future.length - 1];
    if (!next || !projectId) return;
    const now = current.current;
    run(async () => {
      const res = await undoAction(projectId, next);
      if (res.error) return res;
      setFuture((stack) => stack.slice(0, -1));
      if (now) setPast((stack) => [...stack.slice(-19), now]);
      current.current = next;
      return {};
    });
  }, [future, projectId, run]);

  // ⌘Z / Ctrl-Z anywhere on this screen that is not a text box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
  /* One thread per project, picked up again when the project is reopened. */
  const agent = useInlineAgent({ module: "video", projectId: project?.id }, { key: project ? `video:${project.id}` : undefined });
  const history = <AgentHistory zh={zh} current={agent.conversationId} onPick={(id) => void agent.load(id)} onNew={agent.reset} />;
  /* The editor, not the media bin. This module is one job — cutting a video —
     and opening on a list of files asked people to go and find it. */
  const [tab, setTab] = useState<Tab>("edit");
  const [naming, setNaming] = useState(false);

  /*
   * Footage dropped straight onto the editor.
   *
   * It goes into the file store like any other upload — same permissions,
   * same audit trail, same place Files shows it — and is then added to this
   * project's bin, which is what somebody dropping a clip on an editor means.
   */
  /* Who sees new footage is asked as it is added, like in Files. Anyone who
     can open this project sees what is in it either way. */
  const [askingUpload, setAskingUpload] = useState<File[] | null>(null);
  const uploadIntoProject = (list: FileList) => {
    const files = Array.from(list);
    if (files.length) setAskingUpload(files);
  };
  const sendIntoProject = async (files: File[], access: AccessChoice) => {
    const done = beginWork(zh ? `上传 ${files.length} 个文件` : `Uploading ${files.length} file(s)`);
    const told = new Set<string>();
    try {
      const outcome = await uploadFiles(files, {
        access,
        onProgress: (uploads) => {
          // A refused upload says why, in the toaster, rather than vanishing.
          for (const u of uploads) if (u.error && !told.has(u.name)) {
            told.add(u.name);
            notify(`${u.name}: ${u.error}`);
          }
        },
        onDone: async (fileId) => {
          /* Into the bin, and onto the end of the timeline. Footage dropped on
             an editor is footage somebody means to cut; it used to land in the
             bin only, which read as an upload that did nothing. */
          const res = await addClipAction(project?.id ?? "", fileId);
          if ("error" in res && res.error) {
            notify(res.error);
            return;
          }
          if ("id" in res && res.id && project) await addItemAction(project.id, "clip", res.id, "");
        },
      });
      if (outcome.uploaded > 0) notify(zh ? `已上传 ${outcome.uploaded} 个文件` : `Uploaded ${outcome.uploaded} file(s)`, "ok");
      router.refresh();
    } finally {
      done();
    }
  };

  const totalMs = items.reduce((n, i) => n + i.lengthMs, 0);
  const directing = project?.director?.state === "queued" || project?.director?.state === "running";
  /* A clip whose length the worker has not measured yet: the timeline cannot
     draw it to size until it has, so the page keeps asking. */
  const measuring = clips.some((c) => c.durationMs === null && !c.peaksError);
  const rendering = renders.some((r) => r.state === "queued" || r.state === "rendering");
  const speaking = audio.some((a) => a.state === "pending" || a.state === "speaking");
  const done = renders.filter((r) => r.state === "done" && r.fileId);

  /*
   * A render takes minutes and happens on the worker, so the page asks for the
   * state again while one is running. It stops as soon as nothing is in hand:
   * there is nothing to poll for on a screen of finished renders.
   */
  useEffect(() => {
    if (!rendering && !transcribing && !speaking && !autoEditing && !directing && !measuring) return;
    const id = setInterval(() => router.refresh(), directing || measuring ? 4000 : 5000);
    return () => clearInterval(id);
  }, [rendering, transcribing, speaking, autoEditing, directing, measuring, router]);

  if (!project) {
    return (
      <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <ModuleHeader
          title={t("Video Edit", "视频剪辑")}
          note={t("cut, caption and export real footage", "剪辑、加字幕并导出实拍素材")}
          right={
            <button type="button" onClick={() => setNaming(true)} style={solid}>
              {t("New project", "新建项目")}
            </button>
          }
        />
        <div style={{ padding: "18px 22px" }}>
          <Empty
            title={t("No projects yet", "还没有项目")}
            body={t(
              "A project is a cut: footage from the file store, a timeline, captions and the exports the channels need. Nothing here generates video, so nothing here is waiting on a credential.",
              "一个项目就是一次剪辑：来自文件库的素材、时间线、字幕，以及各渠道需要的导出版本。本模块不生成视频，因此不依赖任何外部凭证。",
            )}
          />
        </div>
        {naming && (
          <NameDialog
            title={t("New project", "新建项目")}
            placeholder={t("What is it called?", "项目名称")}
            confirm={t("Create", "创建")}
            cancel={t("Cancel", "取消")}
            onClose={() => setNaming(false)}
            onSubmit={(name) =>
              run(async () => {
                const res = await createProjectAction(name, null);
                if ("error" in res && res.error) return res;
                /* Straight into the new cut's editor, whichever tab this was
                   pressed from: a project you just named is a project you
                   are about to work on. */
                if ("id" in res && res.id) {
                  setTab("edit");
                  router.push(`/video?project=${res.id}`);
                }
                return {};
              })
            }
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <ModuleHeader
        title={project.title}
        note={t(`${clock(totalMs)} on the timeline · ${clips.length} in the bin`, `时间线 ${clock(totalMs)} · 素材 ${clips.length} 个`)}
        right={
          <>
            {projects.length > 1 && (
              <select
                value={project.id}
                onChange={(e) => router.push(`/video?project=${e.target.value}`)}
                style={{ ...field, width: 210, height: 30 }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setNaming(true)}
              style={ghost}
            >
              {t("New project", "新建项目")}
            </button>
          </>
        }
      />

      {heavyPaused && (
        <div
          role="status"
          style={{ margin: "10px 22px 0", padding: "9px 12px", borderRadius: 9, background: "#fff7e6", border: "1px solid #f5d9a3", color: "#7a4b00", fontSize: 12.5, lineHeight: 1.55 }}
        >
          {t(
            "Rendering, the director's full cut and auto-edit are paused: the current server cannot take the load. You can still ask for them; they wait in the queue and start by themselves once the new server is live. Cutting, captions, uploads and previews work as usual.",
            "渲染、导演一键成片和自动剪辑暂时停用：当前服务器无法承受这类负载。你仍然可以提交，任务会排队，新服务器上线后自动开始。剪辑、字幕、上传和预览照常可用。",
          )}
        </div>
      )}

      {askingUpload && (
        <AccessPicker
          zh={zh}
          title={
            zh
              ? `谁可以看这 ${askingUpload.length} 个文件？`
              : `Who can see ${askingUpload.length === 1 ? `“${askingUpload[0].name}”` : `these ${askingUpload.length} files`}?`
          }
          confirm={t("Upload", "上传")}
          note={t(
            "Anyone who can open this project sees the footage in it, whatever you pick here. This sets who sees the file in Files.",
            "能打开此项目的人都能看到其中的素材。这里设置的是文件库中谁能看到该文件。",
          )}
          onClose={() => setAskingUpload(null)}
          onConfirm={(access) => {
            const files = askingUpload;
            setAskingUpload(null);
            void sendIntoProject(files, access);
          }}
        />
      )}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "edit", label: t("Edit", "剪辑"), badge: items.length },
          { key: "library", label: t("Projects", "项目"), badge: projects.length },
          { key: "bin", label: t("Media bin", "素材库"), badge: clips.length },
          { key: "timeline", label: t("Cut list", "片段列表"), badge: items.length },
          { key: "audio", label: t("Audio", "音频"), badge: audio.length + captions.length },
          { key: "graphics", label: t("Graphics", "图形"), badge: graphics.length },
          { key: "preview", label: t("Preview", "预览"), badge: done.length },
          { key: "exports", label: t("Export", "导出"), badge: renders.length },
        ]}
      />

      {tab === "edit" ? (
        <Director
          key={`director-${project.id}`}
          director={project.director ?? {}}
          clipCount={clips.length}
          scripts={scripts}
          scriptId={project.scriptId}
          scriptTitle={project.scriptTitle}
          busy={busy}
          zh={zh}
          /* Snapshotted first, like any edit: "undo what it just did" has to
             cover the whole run, cuts and captions and graphics together. */
          onMake={(input) =>
            edit(async () => {
              const res = await directAction(project.id, input);
              // Followed off the page: the chip in the corner and the toast
              // when it lands come from this.
              if (!("error" in res && res.error)) {
                writeRendering({ projectId: project.id, title: project.title });
                if (heavyPaused) notify(t("Queued. It starts once the new server is live.", "已排队，新服务器上线后自动开始。"), "ok");
              }
              return res;
            }, t("Starting the director", "开始制作"))
          }
          onLinkScript={(scriptId) => run(() => linkScriptAction(project.id, scriptId))}
          onUpload={(files) => void uploadIntoProject(files)}
        />
      ) : null}

      {tab === "edit" ? (
        <Editor
          key={`editor-${project.id}`}
          items={items}
          clips={clips}
          captions={captions}
          preferredLanguage={project.director?.language ?? null}
          graphics={graphics}
          audio={audio}
          accent={project.accent}
          zh={zh}
          busy={busy}
          onTrim={(itemId, input) => edit(() => updateItemAction(itemId, input))}
          onMove={(itemId, dir) => edit(() => moveItemAction(itemId, dir))}
          onRemove={(itemId) => edit(() => removeItemAction(itemId))}
          onAddClip={(clipId) => edit(() => addItemAction(project.id, "clip", clipId, ""))}
          onSplit={(itemId, atMs) => edit(() => splitItemAction(itemId, atMs))}
          onRetimeCaption={(id, input) => edit(() => updateCaptionAction(id, input))}
          onRetimeGraphic={(id, input) => edit(() => updateGraphicAction(id, input))}
          onMoveTrack={(id, startMs) => edit(() => updateTrackAction(id, { startMs }))}
          /* Dropped on the timeline. The item lands at the end and is then
             walked into place, because the timeline is an ordered sequence
             rather than a set of free positions. */
          onDropClip={(clipId, atMs) =>
            run(async () => {
              const res = await addItemAction(project.id, "clip", clipId, "");
              if (res && "error" in res && res.error) return res;
              const before = items.filter((i) => {
                const at = items.slice(0, items.indexOf(i)).reduce((sum, x) => sum + x.lengthMs, 0);
                return at + i.lengthMs / 2 < atMs;
              }).length;
              const steps = items.length - before;
              if ("id" in res && typeof res.id === "string") {
                for (let n = 0; n < steps; n++) await moveItemAction(res.id, "up");
              }
              return {};
            })
          }
          onUpload={(files) => void uploadIntoProject(files)}
          onUndo={past.length ? undo : null}
          onRedo={future.length ? redo : null}
          /* The + on each track. Captions and graphics land at the playhead,
             which is the frame somebody is looking at when they press it. */
          onAddCaption={(atMs) =>
            run(() =>
              addCaptionAction(project.id, {
                startMs: atMs,
                endMs: atMs + 2500,
                text: t("New caption", "新字幕"),
                /* The language already on this cut, so a new line joins the
                   track that exists rather than starting a second one. */
                language: captions[0]?.language ?? "zh-HK",
              }),
            )
          }
          onAddGraphic={(atMs) =>
            run(() =>
              addGraphicAction(project.id, {
                kind: "lower-third",
                text: t("Name", "姓名"),
                startMs: atMs,
                endMs: atMs + 4000,
              }),
            )
          }
          /* One conversation for this project, not two. It used to be an
             AgentDock with a hook of its own, so a prompt sent from the
             inspector's chips and a question typed in the panel were two
             separate threads that could not see each other's work. */
          assistant={
            <ResearchAgentPanel
              accent="#007be0"
              dock
              zh={zh}
              model={model}
              scope={t(`${items.length} cuts`, `${items.length} 个片段`)}
              note={t(
                "Ask for the change and it makes it: cut the bit where you stumble, put a name on, punch in on the line that matters, cut to the b-roll, tighten the pauses. Or ask for the whole video.",
                "直接说要改什么，它就改：剪掉口误、加姓名条、在关键句推近、切空镜、压缩停顿。也可以直接让它把整支片做出来。",
              )}
              placeholder={t("What should change?", "要改什么？")}
              tools={history}
              onAsk={(prompt) => void agent.send(prompt)}
              thread={
                <InlineAgentThread
                  messages={agent.messages}
                  notice={agent.notice}
                  conversationId={agent.conversationId}
                  zh={zh}
                />
              }
            />
          }
          inspector={(selected) => (
            <Inspector
              selected={selected}
              items={items}
              clips={clips}
              captions={captions}
              graphics={graphics}
              zh={zh}
              busy={busy}
              hasCaptions={captions.length > 0}
              onAsk={(prompt) => void agent.send(prompt)}
              onTrim={(itemId, input) => edit(() => updateItemAction(itemId, input))}
              onTransition={(itemId, input) => edit(() => updateItemAction(itemId, input))}
              onMove={(itemId, dir) => edit(() => moveItemAction(itemId, dir))}
              onRemove={(itemId) => edit(() => removeItemAction(itemId))}
              onCaption={(id, input) => edit(() => updateCaptionAction(id, input))}
              onRemoveCaption={(id) => edit(() => removeCaptionAction(id))}
              onGraphic={(id, input) => edit(() => updateGraphicAction(id, input))}
              onRemoveGraphic={(id) => edit(() => removeGraphicAction(id))}
            />
          )}
        />
      ) : (
      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", padding: "18px 22px 40px" }}>
          {tab === "library" && (
            <Library
              projects={projects}
              current={project}
              zh={zh}
              /* Opening a project used to swap which one was selected and
                 leave you on the Projects tab, so the only thing that changed
                 was which card had a border — it read as a dead click. The
                 point of opening a cut is to work on it, and the editor is
                 where that happens: not the cut list. */
              onOpen={(id) => {
                router.push(`/video?project=${id}`);
                setTab("edit");
              }}
              onNew={() => setNaming(true)}
              onRename={(id, title) => run(() => updateProjectAction(id, { title }))}
              /* Gone from the list, and if it was the one open, the screen
                 moves to whichever is left. */
              onDelete={(id) =>
                run(async () => {
                  const res = await deleteProjectAction(id);
                  if ("error" in res && res.error) return res;
                  if (id === project.id) router.push("/video");
                  return {};
                })
              }
            />
          )}

          {tab === "bin" && (
            <Bin
              clips={clips}
              footage={footage}
              zh={zh}
              busy={busy}
              onAdd={(fileId) => run(() => addClipAction(project.id, fileId))}
              onRemove={(clipId) => run(() => removeClipAction(clipId))}
              onToTimeline={(clipId) => {
                edit(() => addItemAction(project.id, "clip", clipId, ""));
                setTab("timeline");
              }}
            />
          )}

          {tab === "timeline" && (
            <Timeline
              key={`timeline-${project.id}`}
              items={items}
              clips={clips}
              totalMs={totalMs}
              zh={zh}
              busy={busy}
              hasCaptions={captions.length > 0}
              autoEditing={autoEditing}
              onAutoEdit={() =>
                edit(async () => {
                  const res = await autoEditAction(project.id, captions[0]?.language ?? "zh-HK");
                  if (heavyPaused && !("error" in res && res.error)) notify(t("Auto-edit queued. It starts once the new server is live.", "自动剪辑已排队，新服务器上线后自动开始。"), "ok");
                  return res;
                })
              }
              onAddClip={(clipId) => edit(() => addItemAction(project.id, "clip", clipId, ""))}
              onAddTitle={(text) => edit(() => addItemAction(project.id, "title", null, text))}
              onUpdate={(itemId, input) => edit(() => updateItemAction(itemId, input))}
              onMove={(itemId, dir) => edit(() => moveItemAction(itemId, dir))}
              onRemove={(itemId) => edit(() => removeItemAction(itemId))}
            />
          )}

          {tab === "audio" && (
            <>
              <AudioTracks
                key={`audio-${project.id}`}
                tracks={audio}
                voices={voices}
                footage={footage}
                zh={zh}
                busy={busy}
                onAddMusic={(fileId, gain) => run(() => addMusicAction(project.id, fileId, gain))}
                onUpdate={(trackId, input) => edit(() => updateTrackAction(trackId, input))}
                onRemove={(trackId) => edit(() => removeTrackAction(trackId))}
                onSpeak={(input) => run(() => voiceOverAction(project.id, input))}
              />

              {/* Captions live here too: tracks and subtitles are the same
                  job, which is what somebody hears and reads. */}
              <Captions
                key={`captions-${project.id}`}
                captions={captions}
                preferredLanguage={project.director?.language ?? null}
                totalMs={totalMs}
                zh={zh}
                busy={busy}
                onAdd={(input) => edit(() => addCaptionAction(project.id, input))}
                onUpdate={(id, input) => edit(() => updateCaptionAction(id, input))}
                onRemove={(id) => edit(() => removeCaptionAction(id))}
                onSplit={(text, language) => edit(() => splitCaptionsAction(project.id, text, language))}
                transcribing={transcribing}
                transcriptionConfigured={transcriptionConfigured}
                onTranscribe={(language, diarize) => run(() => transcribeAction(project.id, language, diarize))}
              />
            </>
          )}

          {tab === "graphics" && (
            <Graphics
              graphics={graphics}
              pictures={pictures}
              captionPreset={project.captionPreset}
              accent={project.accent}
              totalMs={totalMs}
              zh={zh}
              busy={busy}
              onAdd={(input) => edit(() => addGraphicAction(project.id, input))}
              onUpdate={(id, input) => edit(() => updateGraphicAction(id, input))}
              onRemove={(id) => edit(() => removeGraphicAction(id))}
              onLook={(input) => edit(() => setLookAction(project.id, input))}
            />
          )}

          {tab === "preview" && <Preview renders={done} zh={zh} />}

          {tab === "exports" && (
            <Exports
              key={`exports-${project.id}`}
              renders={renders}
              captionLanguages={languagesInOrder(captions, project.director?.language ?? null)}
              hasCaptions={captions.length > 0}
              canRender={items.length > 0}
              zh={zh}
              busy={busy}
              onExport={(input) =>
                run(async () => {
                  const res = await exportAction(project.id, input);
                  if (!("error" in res && res.error)) {
                    writeRendering({ projectId: project.id, title: project.title });
                    if (heavyPaused) notify(t("Render queued. It starts once the new server is live.", "渲染已排队，新服务器上线后自动开始。"), "ok");
                  }
                  return res;
                })
              }
              onPublish={(exportId) =>
                run(async () => {
                  const res = await sendToPublishAction(exportId);
                  if ("postId" in res && res.postId) router.push(`/publish?post=${res.postId}`);
                  return res;
                })
              }
            />
          )}
        </div>

        <ResearchAgentPanel
          accent="#007be0"
          zh={zh}
          scope={t("This cut", "本次剪辑")}
          note={t(
            `${items.length} cut${items.length === 1 ? "" : "s"}, ${clock(totalMs)}, ${captions.length} caption${captions.length === 1 ? "" : "s"}. Rendering runs on this machine with FFmpeg.`,
            `${items.length} 个片段，共 ${clock(totalMs)}，${captions.length} 条字幕。渲染由本机 FFmpeg 完成。`,
          )}
          placeholder={t("Ask about this cut…", "询问这次剪辑…")}
          model={model}
          tools={history}
          onAsk={(prompt) => void agent.send(prompt)}
          thread={
            <InlineAgentThread
              messages={agent.messages}
              notice={agent.notice}
              conversationId={agent.conversationId}
              zh={zh}
            />
          }
        />
      </div>
      )}

      {naming && (
        <NameDialog
          title={t("New project", "新建项目")}
          placeholder={t("What is it called?", "项目名称")}
          confirm={t("Create", "创建")}
          cancel={t("Cancel", "取消")}
          onClose={() => setNaming(false)}
          onSubmit={(name) =>
              run(async () => {
                const res = await createProjectAction(name, null);
                if ("error" in res && res.error) return res;
                /* Straight into the new cut's editor, whichever tab this was
                   pressed from: a project you just named is a project you
                   are about to work on. */
                if ("id" in res && res.id) {
                  setTab("edit");
                  router.push(`/video?project=${res.id}`);
                }
                return {};
              })
            }
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- media bin */

function Bin({
  clips,
  footage,
  zh,
  busy,
  onAdd,
  onRemove,
  onToTimeline,
}: {
  clips: ClipRow[];
  footage: { id: string; name: string; kind: string; durationMs: number | null }[];
  zh: boolean;
  busy: boolean;
  onAdd: (fileId: string) => void;
  onRemove: (clipId: string) => void;
  onToTimeline: (clipId: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const inBin = new Set(clips.map((c) => c.fileId));
  const available = footage.filter((f) => !inBin.has(f.id));

  return (
    <>
      <p style={{ fontSize: 12, color: "#999999", margin: "0 0 14px", lineHeight: 1.6 }}>
        {t(
          "Footage is a reference to a file, never a copy. Trimming a cut does not touch the master, and the bin only ever shows what you may open.",
          "素材只是对文件的引用，不会复制。裁剪片段不会改动原始文件，素材库也只显示你有权打开的内容。",
        )}
      </p>

      {clips.length === 0 ? (
        <Empty title={t("The bin is empty", "素材库是空的")} />
      ) : (
        clips.map((c) => (
          <Row key={c.id} style={{ alignItems: "center" }}>
            <span style={{ flexGrow: 1, ...clip }} title={c.label}>{c.label}</span>
            <span style={{ width: 100, color: "#7c7c7c", fontVariantNumeric: "tabular-nums" }}>
              {c.durationMs ? clock(c.durationMs) : ""}
            </span>
            <span style={{ width: 200, display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button type="button" disabled={busy} onClick={() => onToTimeline(c.id)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                {t("add to timeline", "加入时间线")}
              </button>
              <button type="button" disabled={busy} onClick={() => onRemove(c.id)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                {t("remove", "移除")}
              </button>
            </span>
          </Row>
        ))
      )}

      <Label>{t("Add footage from the file store", "从文件库添加素材")}</Label>
      {available.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#999999", margin: 0, lineHeight: 1.6 }}>
          {/* Two different situations, and they used to read the same. Saying
              "upload some" to somebody whose only clip is already in the bin
              sends them to look for a file that is right in front of them. */}
          {footage.length > 0
            ? t(
                "Everything you can open is already in this bin.",
                "你能打开的素材都已经在这个素材库里了。",
              )
            : t(
                "No video or audio files you can open. Upload some in Files and they appear here.",
                "没有你有权打开的视频或音频文件。在“文件”中上传后会出现在这里。",
              )}{" "}
          <Link href="/files" style={{ color: "#007be0" }}>
            {t("Open Files", "打开文件库")}
          </Link>
        </p>
      ) : (
        available.map((f) => (
          <Row key={f.id} style={{ alignItems: "center" }}>
            <Poster
              src={`/api/files/${f.id}/thumb`}
              style={{ width: 56, height: 32, borderRadius: 4, objectFit: "cover", flexShrink: 0, background: "#111" }}
            />
            <span style={{ flexGrow: 1, ...clip }} title={f.name}>{f.name}</span>
            <span style={{ width: 80 }}>
              <Badge tone="quiet">{f.kind}</Badge>
            </span>
            <span style={{ width: 100, color: "#7c7c7c", fontVariantNumeric: "tabular-nums" }}>
              {f.durationMs ? clock(f.durationMs) : ""}
            </span>
            <span style={{ width: 80, textAlign: "right" }}>
              <button type="button" disabled={busy} onClick={() => onAdd(f.id)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                {t("add", "关注")}
              </button>
            </span>
          </Row>
        ))
      )}
    </>
  );
}

/* -------------------------------------------------------------- timeline */

function Timeline({
  items,
  clips,
  totalMs,
  zh,
  busy,
  hasCaptions,
  autoEditing,
  onAutoEdit,
  onAddClip,
  onAddTitle,
  onUpdate,
  onMove,
  onRemove,
}: {
  items: ItemRow[];
  clips: ClipRow[];
  totalMs: number;
  zh: boolean;
  busy: boolean;
  /** Nothing the first cut does works without a transcript. */
  hasCaptions: boolean;
  autoEditing: boolean;
  onAutoEdit: () => void;
  onAddClip: (clipId: string) => void;
  onAddTitle: (text: string) => void;
  onUpdate: (itemId: string, input: { inMs?: number; outMs?: number | null; text?: string; holdMs?: number }) => void;
  onMove: (itemId: string, direction: "up" | "down") => void;
  onRemove: (itemId: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [title, setTitle] = useState("");
  const [clipId, setClipId] = useState(clips[0]?.id ?? "");
  /** Which cut is open in the trim editor. One at a time: two video elements
   * streaming the same master is two downloads for one decision. */
  const [openTrim, setOpenTrim] = useState<string | null>(null);

  return (
    <>
      {/* ------------------------------------------------- the first cut --
          The one button that does the job rather than a piece of it. Dead air
          out from the measured word timings, the model's read of what
          matters, captions moved onto the result, graphics placed. It is a
          first pass to argue with, which is what a first pass is for — so it
          says what it will do before it does it. */}
      <div
        style={{
          border: "1px solid #ededed",
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          background: "#fcfcfc",
        }}
      >
        <div style={{ minWidth: 220, flexGrow: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("Cut this for me", "帮我剪一版")}</div>
          <p style={{ fontSize: 11.5, color: "#7c7c7c", lineHeight: 1.6, margin: "5px 0 0" }}>
            {hasCaptions
              ? t(
                  "Removes the dead air using the transcript's own word timings, keeps what is worth keeping, moves the captions onto the new cut and places a name and chapter marks. It replaces the timeline, and tells you what it took out.",
                  "根据转写的逐词时间轴去掉空白，保留值得保留的部分，把字幕对到新剪辑上，并放置姓名条与章节标记。会替换现有时间线，并列出删掉了什么。",
                )
              : t(
                  "Transcribe the cut first, in the Audio tab. Everything this does is built on what was actually said, so there is nothing to work from until then.",
                  "请先在“音频”标签页转写。这里所有操作都基于实际说出的内容，未转写前无从下手。",
                )}
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !hasCaptions || autoEditing || items.length === 0}
          onClick={() => onAutoEdit()}
          style={{
            ...solid,
            height: 34,
            opacity: busy || !hasCaptions || autoEditing || items.length === 0 ? 0.45 : 1,
          }}
        >
          {autoEditing ? t("Cutting…", "剪辑中…") : t("Make a first cut", "生成初剪")}
        </button>
      </div>

      {items.length > 0 && (
        <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", marginBottom: 16, background: "#f3f3f3" }}>
          {items.map((i, n) => (
            <div
              key={i.id}
              title={`${i.kind === "title" ? t("Title", "标题卡") : i.clipLabel} · ${clock(i.lengthMs)}`}
              style={{
                width: `${totalMs ? (i.lengthMs / totalMs) * 100 : 0}%`,
                minWidth: 3,
                background: i.kind === "title" ? "#383838" : n % 2 ? "#5aa7e8" : "#007be0",
                borderRight: "1px solid #fff",
              }}
            />
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <Empty
          title={t("Nothing on the timeline", "时间线是空的")}
          body={t("Add a clip from the bin, or a title card.", "从素材库添加片段，或加入一张标题卡。")}
        />
      ) : (
        items.map((i, n) => (
          <div key={i.id} style={{ borderTop: "1px solid #f3f3f3", padding: "11px 0" }}>
            <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ width: 26, fontSize: 11, color: "#c7c7c7" }}>{String(n + 1).padStart(2, "0")}</span>

              {i.kind === "title" ? (
                <>
                  <Badge tone="quiet">{t("title card", "标题卡")}</Badge>
                  <input
                    key={`${i.id}-text`}
                    defaultValue={i.text ?? ""}
                    onBlur={(e) => e.target.value !== (i.text ?? "") && onUpdate(i.id, { text: e.target.value })}
                    placeholder={t("What it says", "卡片文字")}
                    style={{ ...field, flexGrow: 1, minWidth: 180, height: 30 }}
                  />
                  <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11.5, color: "#7c7c7c" }}>
                    {t("hold", "停留")}
                    <input
                      key={`${i.id}-hold`}
                      defaultValue={String(i.holdMs / 1000)}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && Math.round(v * 1000) !== i.holdMs) onUpdate(i.id, { holdMs: v * 1000 });
                      }}
                      style={{ ...field, width: 66, height: 28, textAlign: "right" }}
                    />
                    s
                  </label>
                </>
              ) : (
                <>
                  <span style={{ flexGrow: 1, minWidth: 90, fontSize: 12.5, ...clip }} title={i.clipLabel ?? ""}>{i.clipLabel ?? t("(missing clip)", "（素材丢失）")}</span>
                  <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11.5, color: "#7c7c7c" }}>
                    {t("in", "入点")}
                    <input
                      key={`${i.id}-in`}
                      defaultValue={clock(i.inMs)}
                      onBlur={(e) => {
                        const v = parseClock(e.target.value);
                        if (v !== null && v !== i.inMs) onUpdate(i.id, { inMs: v });
                      }}
                      style={{ ...field, width: 90, height: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                    />
                  </label>
                  <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11.5, color: "#7c7c7c" }}>
                    {t("out", "出点")}
                    <input
                      key={`${i.id}-out`}
                      defaultValue={i.outMs === null ? "" : clock(i.outMs)}
                      placeholder={t("end", "结尾")}
                      onBlur={(e) => {
                        if (!e.target.value.trim()) {
                          if (i.outMs !== null) onUpdate(i.id, { outMs: null });
                          return;
                        }
                        const v = parseClock(e.target.value);
                        if (v !== null && v !== i.outMs) onUpdate(i.id, { outMs: v });
                      }}
                      style={{ ...field, width: 90, height: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                    />
                  </label>
                </>
              )}

              <span style={{ width: 70, textAlign: "right", fontSize: 11.5, color: "#7c7c7c", fontVariantNumeric: "tabular-nums" }}>
                {clock(i.lengthMs)}
              </span>

              <span style={{ display: "flex", gap: 4 }}>
                <button type="button" disabled={busy || n === 0} onClick={() => onMove(i.id, "up")} style={{ ...ghost, height: 26, width: 28, padding: 0 }} aria-label={t("Move up", "上移")}>
                  &uarr;
                </button>
                <button type="button" disabled={busy || n === items.length - 1} onClick={() => onMove(i.id, "down")} style={{ ...ghost, height: 26, width: 28, padding: 0 }} aria-label={t("Move down", "下移")}>
                  &darr;
                </button>
                <button type="button" disabled={busy} onClick={() => onRemove(i.id)} style={{ ...ghost, height: 26, width: 28, padding: 0 }} aria-label={t("Remove", "删除")}>
                  &times;
                </button>
              </span>
            </div>

            {/* Trimming by eye. Collapsed by default because a timeline of
                twenty cuts should still read as a list; open, it is the whole
                editor — waveform, draggable in and out, and the range played
                back on its own. */}
            {i.kind !== "title" && i.clipId ? (
              <div style={{ marginTop: 8, marginLeft: 35 }}>
                <button
                  type="button"
                  onClick={() => setOpenTrim((cur) => (cur === i.id ? null : i.id))}
                  style={{
                    ...ghost,
                    height: 26,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    style={{
                      width: 11,
                      height: 11,
                      fill: "none",
                      stroke: "#7c7c7c",
                      strokeWidth: 2.4,
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                      transform: openTrim === i.id ? "rotate(90deg)" : "none",
                    }}
                  >
                    <path d="m9 5 7 7-7 7" />
                  </svg>
                  {openTrim === i.id ? t("Close", "收起") : t("Trim by eye", "可视化修剪")}
                </button>

                {openTrim === i.id ? (
                  <div style={{ marginTop: 10, maxWidth: 720 }}>
                    {(() => {
                      const c = clips.find((x) => x.id === i.clipId);
                      if (!c) return null;
                      return (
                        <Trim
                          fileId={c.fileId}
                          durationMs={c.durationMs ?? Math.max(i.outMs ?? 0, i.inMs + 1000)}
                          inMs={i.inMs}
                          outMs={i.outMs ?? c.durationMs ?? i.inMs + 1000}
                          peaks={c.peaks}
                          peaksError={c.peaksError}
                          zh={zh}
                          onChange={(next) => onUpdate(i.id, { inMs: next.inMs, outMs: next.outMs })}
                        />
                      );
                    })()}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))
      )}

      <Label>{t("Add to the timeline", "加入时间线")}</Label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={clipId} onChange={(e) => setClipId(e.target.value)} style={{ ...field, width: 250, height: 32 }}>
          {clips.length === 0 && <option value="">{t("nothing in the bin", "素材库为空")}</option>}
          {clips.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="button" disabled={busy || !clipId} onClick={() => onAddClip(clipId)} style={ghost}>
          {t("Add clip", "添加片段")}
        </button>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("A title card", "标题卡文字")} style={{ ...field, width: 240, height: 32 }} />
        <button
          type="button"
          disabled={busy || !title.trim()}
          onClick={() => {
            onAddTitle(title);
            setTitle("");
          }}
          style={ghost}
        >
          {t("Add title", "添加标题卡")}
        </button>
      </div>
    </>
  );
}

/* -------------------------------------------------------------- captions */

function Captions({
  captions,
  preferredLanguage,
  totalMs,
  zh,
  busy,
  onAdd,
  onUpdate,
  onRemove,
  onSplit,
  transcribing,
  transcriptionConfigured,
  onTranscribe,
}: {
  captions: CaptionRow[];
  preferredLanguage?: string | null;
  totalMs: number;
  zh: boolean;
  busy: boolean;
  onAdd: (input: { startMs: number; endMs: number; text: string; language: string }) => void;
  onUpdate: (id: string, input: { startMs?: number; endMs?: number; text?: string }) => void;
  onRemove: (id: string) => void;
  onSplit: (text: string, language: string) => void;
  transcribing: boolean;
  transcriptionConfigured: boolean;
  onTranscribe: (language: string, diarize: boolean) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  /* The language the cut already has, so the list is not empty on arrival. */
  const [language, setLanguage] = useState(primaryLanguage(captions, preferredLanguage) ?? "zh-HK");
  const [diarize, setDiarize] = useState(true);
  const [bulk, setBulk] = useState("");
  const shown = captions.filter((c) => c.language === language);

  return (
    <>
      <div style={{ display: "flex", gap: 9, alignItems: "center", marginBottom: 14 }}>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ ...field, width: 170, height: 32 }}>
          <option value="zh-HK">繁體中文 (zh-HK)</option>
          <option value="zh-CN">简体中文 (zh-CN)</option>
          <option value="en">English</option>
        </select>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {t(`${shown.length} in this language`, `该语言共 ${shown.length} 条`)}
        </span>
      </div>

      {/* Captions from the footage itself, rather than typed or guessed. */}
      <div
        style={{
          border: "1px solid #ededed",
          borderRadius: 11,
          padding: "12px 14px",
          marginBottom: 20,
          background: "#fcfcfc",
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>
          {t("Transcribe the cut", "从音频生成字幕")}
        </div>
        <p style={{ fontSize: 11.5, color: "#7c7c7c", margin: "5px 0 10px", lineHeight: 1.6, maxWidth: 580 }}>
          {transcriptionConfigured
            ? t(
                "Reads the audio of this timeline and writes captions with real timings, breaking lines where somebody actually paused. The spoken language is detected, not declared, so a mix of Cantonese, Mandarin and English is handled as it is spoken. This replaces every caption in the chosen language.",
                "读取本时间线的音频，按真实停顿断句并生成带准确时间轴的字幕。语言由系统识别而非预先指定，因此粤语、普通话与英语混说也能处理。此操作会覆盖所选语言的全部字幕。",
              )
            : t(
                "No transcription key is configured on this deployment, so captions have to be typed or split from a script.",
                "本部署尚未配置转写密钥，字幕需手动输入或从文稿切分。",
              )}
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={busy || transcribing || !transcriptionConfigured || totalMs <= 0}
            onClick={() => onTranscribe(language, diarize)}
            style={{ ...solid, opacity: busy || transcribing || !transcriptionConfigured || totalMs <= 0 ? 0.45 : 1 }}
          >
            {transcribing ? t("Transcribing…", "转写中…") : t("Transcribe", "开始转写")}
          </button>
          <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={diarize} onChange={(e) => setDiarize(e.target.checked)} />
            {t("mark who is speaking", "区分不同说话人")}
          </label>
          {transcribing && (
            <span style={{ fontSize: 11.5, color: "#999999" }}>
              {t(
                "It runs on the worker: the audio is extracted, joined in timeline order and sent off. Minutes on a long interview.",
                "在后台任务中运行：先提取音频、按时间线顺序拼接再上传。较长的访谈需要数分钟。",
              )}
            </span>
          )}
          {totalMs <= 0 && (
            <span style={{ fontSize: 11.5, color: "#999999" }}>
              {t("Put some footage on the timeline first.", "请先在时间线上放入素材。")}
            </span>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty title={t("No captions in this language", "该语言还没有字幕")} />
      ) : (
        shown.map((c) => (
          <Row key={c.id} style={{ alignItems: "center" }}>
            <input
              key={`${c.id}-start`}
              defaultValue={clock(c.startMs)}
              onBlur={(e) => {
                const v = parseClock(e.target.value);
                if (v !== null && v !== c.startMs) onUpdate(c.id, { startMs: v });
              }}
              style={{ ...field, width: 92, height: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
            />
            <input
              key={`${c.id}-end`}
              defaultValue={clock(c.endMs)}
              onBlur={(e) => {
                const v = parseClock(e.target.value);
                if (v !== null && v !== c.endMs) onUpdate(c.id, { endMs: v });
              }}
              style={{ ...field, width: 92, height: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
            />
            <input
              key={`${c.id}-text`}
              defaultValue={c.text}
              onBlur={(e) => e.target.value !== c.text && onUpdate(c.id, { text: e.target.value })}
              style={{ ...field, flexGrow: 1, minWidth: 180, height: 28 }}
            />
            <button type="button" disabled={busy} onClick={() => onRemove(c.id)} style={{ ...ghost, height: 26, width: 28, padding: 0 }} aria-label={t("Remove", "删除")}>
              &times;
            </button>
          </Row>
        ))
      )}

      <Label>{t("Add one", "新增一条")}</Label>
      <AddCaption zh={zh} busy={busy} language={language} onAdd={onAdd} />

      <Label>{t("Or paste the script and split it", "或粘贴脚本自动切分")}</Label>
      <p style={{ fontSize: 11.5, color: "#999999", margin: "0 0 8px", lineHeight: 1.6, maxWidth: 560 }}>
        {t(
          "One line becomes one caption, spread evenly across the cut. That is a starting point, not a transcript: the timings are a guess until somebody watches it, and this replaces every caption in the chosen language.",
          "每一行变成一条字幕，按时长平均分配。这只是起点，不是转写：在有人实际观看校对前，时间轴只是估算。此操作会覆盖所选语言的全部字幕。",
        )}
      </p>
      <textarea
        value={bulk}
        onChange={(e) => setBulk(e.target.value)}
        placeholder={t("One line per caption", "每行一条字幕")}
        style={{ ...field, minHeight: 130, resize: "vertical", lineHeight: 1.7, padding: "10px 12px", maxWidth: 680 }}
      />
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          disabled={busy || !bulk.trim() || totalMs <= 0}
          onClick={() => {
            onSplit(bulk, language);
            setBulk("");
          }}
          style={{ ...solid, opacity: busy || !bulk.trim() || totalMs <= 0 ? 0.45 : 1 }}
        >
          {t("Split across the cut", "按时长切分")}
        </button>
        {totalMs <= 0 && (
          <span style={{ fontSize: 11.5, color: "#999999", marginLeft: 9 }}>
            {t("Put something on the timeline first.", "请先在时间线上放入内容。")}
          </span>
        )}
      </div>
    </>
  );
}

function AddCaption({
  zh,
  busy,
  language,
  onAdd,
}: {
  zh: boolean;
  busy: boolean;
  language: string;
  onAdd: (input: { startMs: number; endMs: number; text: string; language: string }) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [form, setForm] = useState({ start: "00:00", end: "00:03", text: "" });

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} style={{ ...field, width: 92, height: 30, textAlign: "right" }} />
      <input value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} style={{ ...field, width: 92, height: 30, textAlign: "right" }} />
      <input value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder={t("What is said", "字幕内容")} style={{ ...field, width: 320, height: 30 }} />
      <button
        type="button"
        disabled={busy || !form.text.trim()}
        onClick={() => {
          const start = parseClock(form.start);
          const end = parseClock(form.end);
          if (start === null || end === null) return;
          onAdd({ startMs: start, endMs: end, text: form.text, language });
          setForm({ start: form.end, end: clock(end + 3000), text: "" });
        }}
        style={{ ...ghost, opacity: busy || !form.text.trim() ? 0.5 : 1 }}
      >
        {t("Add", "关注")}
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- exports */

function Exports({
  renders,
  captionLanguages,
  hasCaptions,
  canRender,
  zh,
  busy,
  onExport,
  onPublish,
}: {
  renders: ExportRow[];
  /** The languages this cut has captions in, first one first. */
  captionLanguages: string[];
  hasCaptions: boolean;
  canRender: boolean;
  zh: boolean;
  busy: boolean;
  onExport: (input: { aspect: string; burnCaptions: boolean; captionLanguage: string }) => void;
  /** Hand a finished render to Publish as a draft post. */
  onPublish?: (exportId: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [aspect, setAspect] = useState("16:9");
  const [burn, setBurn] = useState(true);
  const [language, setLanguage] = useState(captionLanguages[0] ?? "zh-HK");
  const stateLabel = (state: string) =>
    state === "queued" ? t("queued", "排队中") : state === "done" ? t("done", "完成") : state === "failed" ? t("failed", "失败") : state;

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {["16:9", "9:16", "1:1"].map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAspect(a)}
              style={{
                ...ghost,
                background: aspect === a ? "#171717" : "#fff",
                color: aspect === a ? "#fff" : "#525252",
                borderColor: aspect === a ? "#171717" : "#ededed",
              }}
            >
              {a}
            </button>
          ))}
        </div>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!hasCaptions} style={{ ...field, width: 170, height: 30 }}>
          <option value="zh-HK">繁體中文</option>
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select>
        <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12, cursor: hasCaptions ? "pointer" : "default", opacity: hasCaptions ? 1 : 0.5 }}>
          <input type="checkbox" checked={burn} disabled={!hasCaptions} onChange={(e) => setBurn(e.target.checked)} />
          {t("burn the captions in", "把字幕压制进画面")}
        </label>
        <button
          type="button"
          disabled={busy || !canRender}
          onClick={() => onExport({ aspect, burnCaptions: burn, captionLanguage: language })}
          style={{ ...solid, opacity: busy || !canRender ? 0.45 : 1 }}
        >
          {t("Render", "开始渲染")}
        </button>
      </div>
      <p style={{ fontSize: 11.5, color: "#999999", margin: "0 0 20px", lineHeight: 1.6, maxWidth: 560 }}>
        {t(
          "FFmpeg on this machine, queued as a job. A long master takes minutes; the finished file lands in the file store with your permissions on it, and an unburnt caption track comes out beside it as an SRT.",
          "由本机 FFmpeg 处理，以后台任务排队执行。较长的成片需要数分钟；完成的文件会保存到文件库并带上你的权限，未压制的字幕会以 SRT 形式一并输出。",
        )}
      </p>

      {renders.length === 0 ? (
        <Empty title={t("Nothing rendered yet", "还没有渲染记录")} />
      ) : (
        renders.map((r) => (
          <div key={r.id} style={{ borderTop: "1px solid #f3f3f3", padding: "11px 0" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Badge tone="quiet">{r.aspect}</Badge>
              <Badge
                tone={r.state === "done" ? "good" : r.state === "failed" ? "bad" : "warn"}
              >
                {r.state === "rendering" ? `${t("rendering", "渲染中")} ${Math.round(r.progress)}%` : stateLabel(r.state)}
              </Badge>
              <span style={{ fontSize: 11.5, color: "#7c7c7c" }}>
                {r.burnCaptions === "burn" ? t("captions burnt in", "字幕已压制") : t("captions beside it", "字幕单独输出")}
                {" · "}
                {r.captionLanguage}
              </span>
              {r.durationMs && (
                <span style={{ fontSize: 11.5, color: "#7c7c7c", fontVariantNumeric: "tabular-nums" }}>{clock(r.durationMs)}</span>
              )}
              {r.sizeBytes && (
                <span style={{ fontSize: 11.5, color: "#999999" }}>{(r.sizeBytes / 1_048_576).toFixed(0)} MB</span>
              )}
              <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#c7c7c7" }}>{r.requestedByName ?? ""}</span>
                {r.state === "done" && r.fileId && onPublish && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPublish(r.id)}
                    style={{ ...ghost, height: 26, fontSize: 11.5 }}
                  >
                    {t("Send to Publish", "发送到发布")}
                  </button>
                )}
                {r.fileId && (
                  <Link href={`/files/${r.fileId}`} style={{ fontSize: 11.5, color: "#007be0" }}>
                    {t("open", "打开")}
                  </Link>
                )}
                {r.subtitleFileId && (
                  <Link href={`/files/${r.subtitleFileId}`} style={{ fontSize: 11.5, color: "#007be0" }}>
                    SRT
                  </Link>
                )}
              </span>
            </div>

            {r.state === "rendering" && (
              <div style={{ height: 4, background: "#f3f3f3", borderRadius: 2, marginTop: 7 }}>
                <div style={{ height: "100%", width: `${Math.round(r.progress)}%`, background: "#007be0", borderRadius: 2 }} />
              </div>
            )}
            {r.error && (
              <p style={{ fontSize: 11.5, color: "#e03636", margin: "7px 0 0", lineHeight: 1.5, overflowWrap: "anywhere" }}>
                {r.error}
              </p>
            )}
          </div>
        ))
      )}
    </>
  );
}

/* ------------------------------------------------------------- fragments */

/** mm:ss, or h:mm:ss past an hour. What an editor types. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** The inverse, forgiving: "90", "1:30" and "0:01:30" are all ninety seconds. */
function parseClock(value: string): number | null {
  const parts = value.trim().split(":").map((p) => Number(p));
  if (!parts.length || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  const seconds = parts.reduce((acc, p) => acc * 60 + p, 0);
  return Math.round(seconds * 1000);
}

/* --------------------------------------------------------------- library */

/**
 * Every cut in the studio.
 *
 * `Video-Library` on the canvas: the project is the unit of work, and the
 * library is where somebody picks up what they were doing yesterday.
 */
function Library({
  projects,
  current,
  zh,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: {
  projects: ProjectRow[];
  current: ProjectRow;
  zh: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  /* A project can be renamed and deleted from here. There was no way to do
     either, so a studio's list only ever grew, test cuts included. */
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);
  const [sharing, setSharing] = useState<ProjectRow | null>(null);
  /* Sort, remembered per browser. Recently edited first is what a working
     studio wants; the rest are there for finding one cut among many. */
  type SortKey = "updated" | "created" | "title" | "length" | "rendered";
  const [sort, setSort] = useState<SortKey>(() => {
    try {
      const v = localStorage.getItem("aura:video:sort");
      return v === "created" || v === "title" || v === "length" || v === "rendered" ? v : "updated";
    } catch {
      return "updated";
    }
  });
  const pickSort = (v: SortKey) => {
    setSort(v);
    try {
      localStorage.setItem("aura:video:sort", v);
    } catch {}
  };
  const sorted = [...projects].sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title, zh ? "zh" : "en");
    if (sort === "length") return b.durationMs - a.durationMs;
    if (sort === "created") return b.createdAt.getTime() - a.createdAt.getTime();
    if (sort === "rendered") return Number(Boolean(b.masterFileId)) - Number(Boolean(a.masterFileId)) || b.updatedAt.getTime() - a.updatedAt.getTime();
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
  /* Times are shown in the viewer's own zone, which the server cannot know:
     rendered after mount so the server's copy and the browser's agree. */
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const when = (d: Date) =>
    mounted
      ? new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d)
      : d.toISOString().slice(0, 10);

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{t("Projects", "项目")}</span>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {t("yours, and the ones shared with you", "你的项目，以及分享给你的")}
        </span>
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#7c7c7c" }}>
          {t("Sort", "排序")}
          <select value={sort} onChange={(e) => pickSort(e.target.value as SortKey)} style={{ ...field, height: 26, fontSize: 11.5, width: 150 }}>
            <option value="updated">{t("Recently edited", "最近编辑")}</option>
            <option value="created">{t("Newest first", "最新创建")}</option>
            <option value="title">{t("Title A–Z", "按标题 A–Z")}</option>
            <option value="length">{t("Longest first", "最长优先")}</option>
            <option value="rendered">{t("Rendered first", "已渲染优先")}</option>
          </select>
        </label>
        <button type="button" onClick={onNew} style={{ ...solid, marginLeft: "auto" }}>
          {t("New project", "新建项目")}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {sorted.map((p) => (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !renaming) onOpen(p.id);
            }}
            style={{
              textAlign: "left",
              border: p.id === current.id ? "1px solid #171717" : "1px solid #ededed",
              borderRadius: 11,
              padding: 13,
              background: "#fff",
              cursor: "pointer",
              font: "inherit",
              color: "#171717",
            }}
          >
            {/* The render's frame, or the first clip's, with the length on it. */}
            <div style={{ position: "relative", marginBottom: 10, borderRadius: 7, overflow: "hidden", background: "#111", aspectRatio: "16 / 9" }}>
              {p.posterFileId ? (
                <Poster src={`/api/files/${p.posterFileId}/thumb`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 11 }}>
                  {t("no footage yet", "还没有素材")}
                </div>
              )}
              {p.durationMs > 0 && (
                <span style={{ position: "absolute", right: 6, bottom: 6, background: "rgba(0,0,0,0.72)", color: "#fff", fontSize: 10.5, padding: "1px 6px", borderRadius: 4, fontVariantNumeric: "tabular-nums" }}>
                  {clock(p.durationMs)}
                </span>
              )}
            </div>
            {renaming?.id === p.id ? (
              <input
                autoFocus
                value={renaming.title}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenaming({ id: p.id, title: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const title = renaming.title.trim();
                    if (title && title !== p.title) onRename(p.id, title);
                    setRenaming(null);
                  }
                  if (e.key === "Escape") setRenaming(null);
                }}
                onBlur={() => {
                  const title = renaming.title.trim();
                  if (title && title !== p.title) onRename(p.id, title);
                  setRenaming(null);
                }}
                aria-label={t("Project name", "项目名称")}
                style={{ ...field, height: 28, width: "100%", fontSize: 13, fontWeight: 500 }}
              />
            ) : (
              <span style={{ fontSize: 13, fontWeight: 500, display: "block", ...clip }} title={p.title}>
                {p.title}
              </span>
            )}
            <span style={{ fontSize: 11.5, color: "#999999", display: "block", marginTop: 4 }}>
              {clock(p.durationMs)} · {p.itemCount} {t("cuts", "个片段")} · {p.clipCount} {t("in the bin", "个素材")}
            </span>
            <span style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
              {p.masterFileId ? (
                <Badge tone="good">{t("rendered", "已渲染")}</Badge>
              ) : (
                <Badge tone="quiet">{t("not rendered", "未渲染")}</Badge>
              )}
              {p.id === current.id && <Badge tone="info">{t("open", "当前")}</Badge>}
              <Badge tone="quiet">
                {p.visibility === "everyone"
                  ? t("everyone", "所有人")
                  : p.visibility === "shared"
                    ? t("shared", "已分享")
                    : t("private", "私有")}
              </Badge>
              {p.relation === "viewer" || p.relation === "commenter" ? <Badge tone="quiet">{t("view only", "仅查看")}</Badge> : null}
            </span>
            <span style={{ fontSize: 10.5, color: "#c7c7c7", display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
              <span style={{ ...clip, minWidth: 0 }}>
                {p.ownerName ?? ""} · {when(p.updatedAt)}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSharing(p);
                }}
                style={{ marginLeft: "auto", border: 0, background: "transparent", color: "#7c7c7c", cursor: "pointer", font: "inherit", fontSize: 10.5, padding: 0 }}
              >
                {t("access", "权限")}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenaming({ id: p.id, title: p.title });
                }}
                style={{ border: 0, background: "transparent", color: "#7c7c7c", cursor: "pointer", font: "inherit", fontSize: 10.5, padding: 0 }}
              >
                {t("rename", "重命名")}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleting(p);
                }}
                style={{ border: 0, background: "transparent", color: "#7c7c7c", cursor: "pointer", font: "inherit", fontSize: 10.5, padding: 0 }}
              >
                {t("delete", "删除")}
              </button>
            </span>
          </div>
        ))}
      </div>

      {sharing ? <AccessDialog projectId={sharing.id} title={sharing.title} zh={zh} onClose={() => setSharing(null)} /> : null}

      {deleting ? (
        <ConfirmDialog
          title={t(`Delete “${deleting.title}”?`, `删除「${deleting.title}」？`)}
          body={t(
            "The cut, its captions and graphics go with it. Rendered files stay in Files.",
            "剪辑、字幕和图形会一起删除。已渲染的成片仍保留在文件库中。",
          )}
          confirm={t("Delete", "删除")}
          cancel={t("Keep it", "保留")}
          danger
          onConfirm={() => {
            onDelete(deleting.id);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </>
  );
}

/* ----------------------------------------------------------------- audio */

/**
 * Voice-over and music, over the cut.
 *
 * `Video-Audio` on the canvas. Two kinds of track and they behave differently
 * on purpose: music ducks under speech and sits at about 0.15 of its recorded
 * level, a voice-over does neither because speech under speech is not a mix,
 * it is a mess.
 */
function AudioTracks({
  tracks,
  voices,
  footage,
  zh,
  busy,
  onAddMusic,
  onUpdate,
  onRemove,
  onSpeak,
}: {
  tracks: AudioRow[];
  voices: { id: string; name: string; description: string | null }[];
  footage: { id: string; name: string; kind: string; durationMs: number | null }[];
  zh: boolean;
  busy: boolean;
  onAddMusic: (fileId: string, gain: number) => void;
  onUpdate: (trackId: string, input: { gain?: number; startMs?: number; duckUnderSpeech?: boolean }) => void;
  onRemove: (trackId: string) => void;
  onSpeak: (input: { text: string; voiceId: string; label: string; startMs: number; gain: number }) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [musicId, setMusicId] = useState("");
  const [voiceId, setVoiceId] = useState(voices[0]?.id ?? "");
  const [script, setScript] = useState("");
  const audioFiles = footage.filter((f) => f.kind === "audio");

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{t("Audio", "音频")}</span>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {t("laid over the cut, mixed at render", "叠加在成片之上，渲染时混音")}
        </span>
      </div>

      {tracks.length === 0 ? (
        <Empty title={t("No tracks yet", "还没有音轨")} />
      ) : (
        tracks.map((a) => (
          <Row key={a.id} style={{ alignItems: "center" }}>
            <Badge tone={a.kind === "voiceover" ? "info" : "quiet"}>
              {a.kind === "voiceover" ? t("voice", "配音") : t("music", "音乐")}
            </Badge>
            <span style={{ flexGrow: 1, ...clip }} title={a.label}>
              {a.label}
              {a.state === "pending" && <span style={{ color: "#a35f00", marginLeft: 8 }}>{t("queued", "排队中")}</span>}
              {a.state === "speaking" && <span style={{ color: "#a35f00", marginLeft: 8 }}>{t("speaking…", "合成中…")}</span>}
              {a.state === "failed" && <span style={{ color: "#e03636", marginLeft: 8 }}>{a.error}</span>}
            </span>
            <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11.5, color: "#7c7c7c" }}>
              {t("from", "起始")}
              <input
                key={`${a.id}-start`}
                defaultValue={clock(a.startMs)}
                onBlur={(e) => {
                  const v = parseClock(e.target.value);
                  if (v !== null && v !== a.startMs) onUpdate(a.id, { startMs: v });
                }}
                style={{ ...field, width: 84, height: 26, textAlign: "right" }}
              />
            </label>
            <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11.5, color: "#7c7c7c" }}>
              {t("level", "音量")}
              <input
                key={`${a.id}-gain`}
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                defaultValue={a.gain}
                onMouseUp={(e) => onUpdate(a.id, { gain: Number((e.target as HTMLInputElement).value) })}
                onTouchEnd={(e) => onUpdate(a.id, { gain: Number((e.target as HTMLInputElement).value) })}
                style={{ width: 96 }}
              />
              <span style={{ width: 30, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {a.gain.toFixed(2)}
              </span>
            </label>
            {a.kind === "music" && (
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5, color: "#7c7c7c", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={a.duckUnderSpeech}
                  onChange={(e) => onUpdate(a.id, { duckUnderSpeech: e.target.checked })}
                />
                {t("duck under speech", "遇人声自动压低")}
              </label>
            )}
            {a.fileId && (
              <Link href={`/files/${a.fileId}`} style={{ fontSize: 11.5, color: "#007be0" }}>
                {t("open", "打开")}
              </Link>
            )}
            <button type="button" disabled={busy} onClick={() => onRemove(a.id)} style={{ ...ghost, height: 24, width: 28, padding: 0 }}>
              &times;
            </button>
          </Row>
        ))
      )}

      <Label>{t("Lay music under it", "添加背景音乐")}</Label>
      {audioFiles.length === 0 ? (
        <p style={{ fontSize: 12, color: "#999999", margin: 0, lineHeight: 1.6 }}>
          {t("No audio files you can open. Upload some in Files.", "没有你有权打开的音频文件，请先在“文件”中上传。")}{" "}
          <Link href="/files" style={{ color: "#007be0" }}>
            {t("Open Files", "打开文件库")}
          </Link>
        </p>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={musicId} onChange={(e) => setMusicId(e.target.value)} style={{ ...field, width: 300, height: 32 }}>
            <option value="">{t("Choose a file", "选择文件")}</option>
            {audioFiles.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !musicId}
            onClick={() => {
              onAddMusic(musicId, 0.15);
              setMusicId("");
            }}
            style={{ ...ghost, opacity: busy || !musicId ? 0.5 : 1 }}
          >
            {t("Add under the cut", "加入到成片下方")}
          </button>
          <span style={{ fontSize: 11, color: "#c7c7c7" }}>
            {t("Starts at 0.15 and ducks under speech. Both adjustable above.", "默认音量 0.15，并在有人声时自动压低，均可在上方调整。")}
          </span>
        </div>
      )}

      <Label>{t("Record a voice-over", "生成配音")}</Label>
      {voices.length === 0 ? (
        <p style={{ fontSize: 12, color: "#999999", margin: 0, lineHeight: 1.6 }}>
          {t(
            "No speech key is configured on this deployment, so a voice-over has to be recorded elsewhere and uploaded as a file.",
            "本部署尚未配置语音密钥，配音需在别处录制后作为文件上传。",
          )}
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} style={{ ...field, width: 320, height: 32 }}>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !script.trim() || !voiceId}
              onClick={() => {
                onSpeak({
                  text: script,
                  voiceId,
                  label: script.trim().slice(0, 40),
                  startMs: 0,
                  gain: 1,
                });
                setScript("");
              }}
              style={{ ...solid, opacity: busy || !script.trim() ? 0.45 : 1 }}
            >
              {t("Speak it", "生成")}
            </button>
            <span style={{ fontSize: 11, color: "#c7c7c7" }}>
              {script.trim().length} {t("characters", "个字符")}
            </span>
          </div>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder={t("What should be said?", "配音内容")}
            style={{ ...field, minHeight: 110, resize: "vertical", lineHeight: 1.7, padding: "10px 12px", maxWidth: 680 }}
          />
        </>
      )}
    </>
  );
}

/* --------------------------------------------------------------- preview */

/**
 * Watching it, and watching two of them side by side.
 *
 * `Video-Preview` on the canvas. A real `<video>` on the rendered file rather
 * than a still: the point of a preview is the cut, and a cut is a thing in
 * time. Two at once because the question is almost always "is this one better
 * than that one".
 */
function Preview({ renders, zh }: { renders: ExportRow[]; zh: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [left, setLeft] = useState(renders[0]?.id ?? "");
  const [right, setRight] = useState("");

  if (!renders.length) {
    return (
      <Empty
        title={t("Nothing to watch yet", "还没有可预览的成片")}
        body={t("Render the cut and it appears here, at whichever aspect you chose.", "渲染完成后会出现在这里，按你选择的画幅显示。")}
      />
    );
  }

  const a = renders.find((r) => r.id === left) ?? renders[0];
  const b = renders.find((r) => r.id === right) ?? null;

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <select value={a.id} onChange={(e) => setLeft(e.target.value)} style={{ ...field, width: 260, height: 32 }}>
          {renders.map((r) => (
            <option key={r.id} value={r.id}>
              {r.aspect} · {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11.5, color: "#999999" }}>{t("compare with", "对比")}</span>
        <select value={right} onChange={(e) => setRight(e.target.value)} style={{ ...field, width: 260, height: 32 }}>
          <option value="">{t("nothing", "不对比")}</option>
          {renders
            .filter((r) => r.id !== a.id)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.aspect} · {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              </option>
            ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: b ? "1fr 1fr" : "1fr", gap: 16, maxWidth: b ? 980 : 640 }}>
        <Player render={a} zh={zh} />
        {b && <Player render={b} zh={zh} />}
      </div>
    </>
  );
}

function Player({ render, zh }: { render: ExportRow; zh: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 7 }}>
        <Badge tone="quiet">{render.aspect}</Badge>
        <span style={{ fontSize: 11.5, color: "#7c7c7c" }}>
          {render.burnCaptions === "burn" ? t("captions burnt in", "字幕已压制") : t("captions beside it", "字幕单独输出")}
        </span>
        {render.durationMs && (
          <span style={{ fontSize: 11.5, color: "#999999", fontVariantNumeric: "tabular-nums" }}>
            {clock(render.durationMs)}
          </span>
        )}
        {render.fileId && (
          <Link href={`/files/${render.fileId}`} style={{ marginLeft: "auto", fontSize: 11.5, color: "#007be0" }}>
            {t("open the file", "打开文件库")}
          </Link>
        )}
      </div>
      {/* The download route issues a signed, short-lived redirect after the
          same permission check every other read makes. */}
      <video
        key={render.id}
        src={`/api/files/${render.fileId}/download`}
        controls
        preload="metadata"
        style={{
          width: "100%",
          borderRadius: 10,
          background: "#111111",
          aspectRatio: render.aspect.replace(":", " / "),
          objectFit: "contain",
        }}
      />
    </div>
  );
}
