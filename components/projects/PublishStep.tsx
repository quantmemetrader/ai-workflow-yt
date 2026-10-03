"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import type { Cover } from "@/lib/video/cover";
import { PlatformMark } from "@/components/ui/PlatformMark";
import { Card, Empty, Fact, GoButton, NextStep, PageBody, bigButton, smallButton, INK, MUTED, LINE } from "@/components/projects/kit";
import { uploadFiles, type UploadProgress } from "@/lib/client/upload";
import { beginWork } from "@/lib/client/busy";
import { notify } from "@/lib/client/notify";
import { useAsk } from "@/components/ui/useAsk";
import { OWN_ACCOUNTS } from "@/lib/social/own-accounts";
import { OWN_TO_PLACE, PUBLISH_ROWS, captionLimits, type PublishDraft } from "@/lib/projects/publish-rows";
import { platformsLine, publishPlatformName, type Publication, type PublishPlatform } from "@/lib/projects/publication";
import {
  markFinalAction,
  markPlacePublishedAction,
  savePublishDraftAction,
  remakeCoversAction,
  sendChannelsForApprovalAction,
  unmarkFinalAction,
  unmarkPlaceAction,
  writeCaptionsAction,
} from "@/app/(app)/projects/publish-actions";
import { approveAction } from "@/app/(app)/publish/actions";
import { renameFileAction } from "@/app/(app)/files/actions";

/**
 * 4 发布 — a project's publish page, top to bottom:
 *
 *   what to do now      one sentence and the one big button
 *   AI 成片             the render, to watch and download (and SRT)
 *   最终版视频          the team's own cut, uploaded back after they fixed
 *                       it up on their machine — "they will re-modify the
 *                       videos after AI makes them, then use that to post"
 *   发布到平台          one row per place: the studio's own 抖音 / 小红书 /
 *                       视频号 / B站 (posted by hand: download, copy the
 *                       caption, open the creator console, then 「我已发布」
 *                       with the link) and the channels connected in
 *                       Publish (sent to a named person for approval; only
 *                       their 批准 sends it)
 *
 * Which video goes and what each row says is kept on the project as you
 * type (`savePublishDraftAction`).
 */

export type PublishVideo = {
  id: string;
  name: string;
  durationMs: number | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  by: string;
  at: string;
  /** Where a pickable file is from: the project (a clip or other), or Files. */
  where?: "project" | "project-clip" | "files";
};

type Render = { id: string; fileId: string; proxyFileId: string | null; subtitleFileId: string | null; aspect: string; durationMs: number | null; sizeBytes: number | null; at: string };
type Channel = { id: string; platform: string; name: string; canPost: boolean };
type Post = {
  id: string;
  state: string;
  fileId: string | null;
  fileName: string | null;
  updatedAt: string;
  approval: { state: string; requestedById: string; requestedByName: string | null; approverName: string | null } | null;
  targets: { channelId: string; platform: string; channelName: string; state: string; url: string | null; error: string | null }[];
};

type Row = { key: string; platform: string; label: string; account: string; accountId?: string; studio?: string; place?: PublishPlatform; channel?: Channel };

export function PublishStep({
  zh,
  projectId,
  title,
  status,
  canPublish,
  canChannels,
  viewerId,
  script,
  renders,
  rendering,
  finals,
  covers,
  pickable,
  published,
  draft: initialDraft,
  channels,
  posts,
  people,
}: {
  zh: boolean;
  projectId: string;
  title: string;
  status: string;
  canPublish: boolean;
  canChannels: boolean;
  viewerId: string;
  script: string;
  renders: Render[];
  rendering: { progress: number } | null;
  finals: PublishVideo[];
  /** 剪辑师's covers for the render, newest first (`video.cover`). */
  covers: Cover[];
  pickable: PublishVideo[];
  published: Publication | null;
  draft: PublishDraft;
  channels: Channel[];
  posts: Post[];
  people: { id: string; name: string }[];
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const ask = useAsk(zh);
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  const [uploads, setUploads] = React.useState<UploadProgress[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [writing, setWriting] = React.useState<string[]>([]);

  /* The rows: the studio's own accounts first, then the connected channels. */
  const rows: Row[] = React.useMemo(
    () => [
      ...OWN_ACCOUNTS.map((a) => ({ key: a.platform, platform: OWN_TO_PLACE[a.platform], label: zh ? a.zh : a.en, account: a.name, accountId: a.id, studio: a.studio, place: OWN_TO_PLACE[a.platform] })),
      ...channels.map((c) => ({ key: `ch:${c.id}:${c.platform}`, platform: c.platform, label: platformName(c.platform, zh), account: c.name, channel: c })),
    ],
    [channels, zh],
  );

  /* The draft: the video picked and each row's words. A row nobody touched
     is on, empty, until 撰稿人 or a person writes it. */
  const allVideoIds = React.useMemo(() => new Set([...finals.map((f) => f.id), ...renders.map((r) => r.fileId)]), [finals, renders]);
  const [draft, setDraft] = React.useState<PublishDraft>(() => {
    const fileId = initialDraft.fileId && allVideoIds.has(initialDraft.fileId) ? initialDraft.fileId : (finals[0]?.id ?? renders[0]?.fileId ?? null);
    return { fileId, coverFileId: initialDraft.coverFileId ?? null, rows: initialDraft.rows };
  });
  /* A new upload lands: pick it if nothing is picked yet. */
  React.useEffect(() => {
    setDraft((d) => (d.fileId && allVideoIds.has(d.fileId) ? d : { ...d, fileId: finals[0]?.id ?? renders[0]?.fileId ?? null }));
  }, [allVideoIds, finals, renders]);

  const firstSave = React.useRef(true);
  React.useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    const h = setTimeout(() => void savePublishDraftAction(projectId, draft), 700);
    return () => clearTimeout(h);
  }, [draft, projectId]);

  /* The studio's own accounts start on; a connected channel starts off —
     it posts for real once approved, so going there is a choice. */
  const fresh = (key: string) => ({ on: !key.startsWith("ch:"), title: "", body: "" });
  const rowOf = (key: string) => draft.rows[key] ?? fresh(key);
  const setRow = (key: string, patch: Partial<{ on: boolean; title: string; body: string }>) =>
    setDraft((d) => ({ ...d, rows: { ...d.rows, [key]: { ...(d.rows[key] ?? fresh(key)), ...patch } } }));

  const chosen: { id: string; name: string; kind: "final" | "render" } | null = (() => {
    const f = finals.find((x) => x.id === draft.fileId);
    if (f) return { id: f.id, name: f.name, kind: "final" };
    const r = renders.find((x) => x.fileId === draft.fileId);
    if (r) return { id: r.fileId, name: t(`AI 成片 · ${r.aspect}`, `AI render · ${r.aspect}`), kind: "render" };
    return null;
  })();

  const failed = (r: unknown) => {
    const e = r && typeof r === "object" && "error" in r ? (r as { error?: string }).error : null;
    if (e) notify(e);
    return Boolean(e);
  };

  async function upload(list: FileList | File[]) {
    const videos = Array.from(list).filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name));
    if (!videos.length) {
      notify(t("只能上传视频文件", "Only video files can go here"));
      return;
    }
    const done = beginWork(t(`上传 ${videos.length} 个视频`, `Uploading ${videos.length} video(s)`));
    const ids: string[] = [];
    try {
      const out = await uploadFiles(videos, {
        access: { mode: "everyone" },
        onProgress: setUploads,
        onDone: async (fileId) => {
          ids.push(fileId);
          await markFinalAction(projectId, [fileId]);
        },
      });
      if (out.uploaded) {
        notify(t(`已上传 ${out.uploaded} 个最终版视频`, `Uploaded ${out.uploaded} final video(s)`), "ok");
        if (ids.length) setDraft((d) => ({ ...d, fileId: ids[ids.length - 1] }));
      }
      if (out.failed) notify(t(`${out.failed} 个没传上去，再试一次`, `${out.failed} did not upload; try again`));
      router.refresh();
    } finally {
      done();
      setTimeout(() => setUploads([]), 1500);
    }
  }

  async function write(keys: string[]) {
    if (!keys.length) return;
    setWriting((w) => [...w, ...keys]);
    try {
      const r = await writeCaptionsAction(projectId, keys, script);
      if (failed(r) || !("rows" in r)) return;
      setDraft((d) => {
        const next = { ...d.rows };
        for (const [k, v] of Object.entries(r.rows)) next[k] = { on: next[k]?.on ?? true, title: v.title, body: v.body };
        return { ...d, rows: next };
      });
      notify(t("撰稿人写好了，看一下再发", "The copywriter wrote them; read before posting"), "ok");
    } finally {
      setWriting((w) => w.filter((k) => !keys.includes(k)));
    }
  }

  const placeOf = (place: PublishPlatform | undefined) => (place ? (published?.platforms.find((x) => x.key === place) ?? null) : null);
  const ownRowsOn = rows.filter((r) => !r.channel && rowOf(r.key).on);
  const channelRows = rows.filter((r) => r.channel);
  const livePost = posts.find((x) => x.state === "awaiting_approval" || x.state === "approved" || x.state === "publishing") ?? null;

  /* ---- what to do now ---- */
  const isDone = status === "done" && published && published.platforms.length > 0;
  const band = isDone ? (
    <NextStep state="done" zh={zh} text={t(`已发布到 ${platformsLine(published!.platforms, true)}。数据回来后在复盘里看效果。`, `Published to ${platformsLine(published!.platforms, false)}. See how it does in Review.`)}>
      <GoButton href={`/projects/${projectId}/review`}>{t("看复盘 →", "See the review →")}</GoButton>
    </NextStep>
  ) : finals.length === 0 && renders.length === 0 ? (
    <NextStep
      state="waiting"
      zh={zh}
      text={t("剪辑还没出成片，出了会在这里。你们已经有做好的视频的话，也可以直接上传。", "The editor has not rendered yet; it shows up here when done. Already have a finished video? Upload it.")}
    >
      <button type="button" style={bigButton("secondary")} onClick={() => fileInput.current?.click()}>
        <Icon name="upload" size={16} />
        {t("上传视频", "Upload a video")}
      </button>
    </NextStep>
  ) : finals.length === 0 ? (
    <NextStep
      state="you"
      zh={zh}
      text={
        renders.length
          ? t("下载 AI 成片，在本地改好后把最终版上传到这里。也可以直接发 AI 成片。", "Download the AI render, fix it up on your machine, then upload the final version here. Or post the render as it is.")
          : t("把要发的视频上传到这里；剪辑页出成片后也会出现在这里。", "Upload the video to post here; the editor's render shows up here too once it is made.")
      }
    >
      <button type="button" style={bigButton("primary")} onClick={() => fileInput.current?.click()}>
        <Icon name="upload" size={16} />
        {t("上传最终版视频", "Upload the final video")}
      </button>
    </NextStep>
  ) : (
    <NextStep state="you" zh={zh} text={t("选好要发的视频，填好各平台的标题和文案，然后发布。", "Pick the video, fill in each platform's title and caption, then post.")}>
      <button type="button" style={bigButton("primary")} onClick={() => document.getElementById("pub-platforms")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
        <Icon name="share" size={16} />
        {t("去填文案并发布", "Write and post")}
      </button>
    </NextStep>
  );

  const latest = renders[0] ?? null;

  return (
    <PageBody>
      <style>{CSS}</style>
      {ask.dialog}
      <input
        ref={fileInput}
        type="file"
        accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
        multiple
        hidden
        onChange={(e) => {
          const list = e.target.files;
          if (list?.length) void upload(list);
          e.target.value = "";
        }}
      />
      {band}

      {/* ---- 封面 ---- */}
      <Card
        icon="image"
        title={t("封面", "Cover")}
        sub={t("成片出来后剪辑师自动做三张，各配一个标题。选一张，发布时一起发到支持封面的平台（YouTube 等）。", "Three covers with titles, made when a render lands. Pick one; it goes out with the post where the platform takes a thumbnail.")}
        right={
          latest || covers.length ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await remakeCoversAction(projectId);
                  if (failed(r)) return;
                  notify(t("剪辑师正在重做封面，一两分钟后出现在这里", "Making new covers; they appear here in a minute or two"), "ok");
                  window.setTimeout(() => router.refresh(), 60_000);
                })
              }
              style={smallButton()}
            >
              {covers.length ? t("重做封面", "Make new ones") : t("做封面", "Make covers")}
            </button>
          ) : null
        }
      >
        {covers.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {covers.map((c) => {
              const on = draft.coverFileId === c.fileId;
              return (
                <div key={c.fileId} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, coverFileId: on ? null : c.fileId }))}
                    title={on ? t("已选这张封面", "Chosen") : t("用这张封面", "Use this cover")}
                    style={{ position: "relative", padding: 0, border: on ? "2px solid #171717" : `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden", background: "#111", cursor: "pointer", aspectRatio: c.aspect === "9:16" ? "9 / 16" : "16 / 9" }}
                  >
                    <img src={`/api/files/${c.fileId}/thumb`} alt={c.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    {on ? <span style={{ position: "absolute", top: 8, left: 8, background: "#171717", color: "#fff", fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: "2px 8px" }}>{t("发布用这张", "Posting this")}</span> : null}
                  </button>
                  <div style={{ fontSize: 12.5, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.title}>{c.title}</div>
                  <div style={{ display: "flex", gap: 8, fontSize: 12, color: MUTED }}>
                    <span>{c.aspect}</span>
                    <a href={`/api/files/${c.fileId}/download?download=1`} style={{ color: "#525252" }}>{t("下载", "Download")}</a>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty icon="image" text={latest ? t("剪辑师还没做封面。点右上角「做封面」。", "No covers yet. Press 「Make covers」.") : t("成片出来后，剪辑师会自动做三张封面。", "Covers are made when the render lands.")} />
        )}
      </Card>

      {/* ---- AI 成片 ---- */}
      <Card
        icon="film"
        title={t("AI 成片", "AI render")}
        sub={t("剪辑师做出的成片。下载后可在本地再修改，改好上传到下方「最终版视频」。", "What the editor rendered. Download it, fix it up locally, then upload the result under Final videos below.")}
        right={latest ? <SelectPill on={draft.fileId === latest.fileId} zh={zh} onClick={() => setDraft((d) => ({ ...d, fileId: latest.fileId }))} label={t("直接发 AI 成片", "Post the render")} /> : null}
      >
        {latest ? (
          <div className="pb-render">
            <RenderVideo render={latest} zh={zh} />
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <Fact label={t("画幅", "Shape")}>{latest.aspect}</Fact>
              <Fact label={t("时长", "Length")}>{clock(latest.durationMs)}</Fact>
              <Fact label={t("大小", "Size")}>{bytes(latest.sizeBytes)}</Fact>
              <Fact label={t("生成于", "Made")}>{when(latest.at, zh)}</Fact>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                <a href={`/api/files/${latest.fileId}/download?download=1`} style={bigButton("secondary")}>
                  <Icon name="download" size={15} />
                  {t("下载 MP4", "Download MP4")}
                </a>
                {latest.subtitleFileId ? (
                  <a href={`/api/files/${latest.subtitleFileId}/download?download=1`} style={bigButton("secondary")}>
                    <Icon name="doc" size={15} />
                    {t("下载字幕 SRT", "Download SRT")}
                  </a>
                ) : null}
              </div>
              {renders.length > 1 ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{t("更早的成片", "Earlier renders")}</div>
                  {renders.slice(1).map((r) => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #f0efeb", fontSize: 12.5 }}>
                      <span style={{ flexGrow: 1, color: INK }}>
                        {r.aspect} · {clock(r.durationMs)} · {when(r.at, zh)}
                      </span>
                      <a href={`/api/files/${r.fileId}/download?download=1`} style={smallButton()}>
                        <Icon name="download" size={12} />
                        {t("下载", "Download")}
                      </a>
                      <SelectPill small on={draft.fileId === r.fileId} zh={zh} onClick={() => setDraft((d) => ({ ...d, fileId: r.fileId }))} label={t("发这个", "Post this")} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : rendering ? (
          <Empty icon="film" text={t(`正在渲染 ${Math.round(rendering.progress)}%，好了会出现在这里`, `Rendering ${Math.round(rendering.progress)}%; it shows up here when done`)} />
        ) : (
          <Empty icon="film" text={t("还没有成片", "No render yet")}>
            <GoButton href={`/projects/${projectId}/edit`} kind="secondary">
              {t("去剪辑 →", "Go to Edit →")}
            </GoButton>
          </Empty>
        )}
      </Card>

      {/* ---- 最终版视频 ---- */}
      <Card
        icon="upload"
        title={t("最终版视频", "Final videos")}
        sub={t("你们在本地改好的版本，上传后选一个发布。", "The version you finished on your own machine. Upload it, then pick one to post.")}
        right={
          finals.length ? (
            <span style={{ fontSize: 12, color: MUTED }}>{t(`${finals.length} 个`, `${finals.length}`)}</span>
          ) : null
        }
      >
        <div
          className="pb-drop"
          data-on={dragging ? "1" : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files);
          }}
        >
          <Icon name="upload" size={20} />
          <div style={{ fontSize: 13.5, color: INK, fontWeight: 500 }}>{t("把视频拖到这里", "Drop videos here")}</div>
          <div style={{ fontSize: 12, color: MUTED }}>{t("MP4 / MOV，可一次选多个；大文件在后台上传，可以离开这一页", "MP4 / MOV, several at once; big files keep uploading if you leave the page")}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
            <button type="button" style={bigButton("primary")} onClick={() => fileInput.current?.click()}>
              <Icon name="upload" size={15} />
              {t("选择视频", "Choose videos")}
            </button>
            <button type="button" style={bigButton("secondary")} onClick={() => setPicking(true)}>
              <Icon name="folder" size={15} />
              {t("从文件中选择", "Pick from Files")}
            </button>
          </div>
        </div>
        {uploads.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
            {uploads.map((u, i) => (
              <div key={`${u.name}-${i}`} style={{ fontSize: 12.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                  <span style={{ color: u.error ? "#c42b2b" : MUTED }}>{u.error ? t("失败", "failed") : `${u.pct}%`}</span>
                </div>
                <div style={{ height: 4, background: "#efeee9", borderRadius: 4, marginTop: 4, overflow: "hidden" }}>
                  <div style={{ width: `${u.pct}%`, height: "100%", background: u.error ? "#c42b2b" : INK, transition: "width .2s ease" }} />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {finals.length ? (
          <div className="pb-tiles">
            {finals.map((f) => (
              <VideoTile
                key={f.id}
                video={f}
                zh={zh}
                on={draft.fileId === f.id}
                playing={playing === f.id}
                onPlay={() => setPlaying((p) => (p === f.id ? null : f.id))}
                onPick={() => setDraft((d) => ({ ...d, fileId: f.id }))}
                onRename={async () => {
                  const name = await ask.prompt({ title: t("重命名", "Rename"), placeholder: t("新名字", "New name"), initial: f.name, confirm: t("改名", "Rename") });
                  if (!name || name === f.name) return;
                  start(async () => {
                    if (!failed(await renameFileAction(f.id, name))) router.refresh();
                  });
                }}
                onRemove={async () => {
                  if (!(await ask.confirm({ title: t("从这个项目的最终版里移出？", "Take it out of this project's final videos?"), body: t("文件本身还在「文件」里。", "The file stays in Files."), confirm: t("移出", "Take it out") }))) return;
                  start(async () => {
                    if (!failed(await unmarkFinalAction(projectId, f.id))) router.refresh();
                  });
                }}
              />
            ))}
          </div>
        ) : null}
      </Card>

      {/* ---- 发布到平台 ---- */}
      <Card
        id="pub-platforms"
        icon="share"
        title={t("发布到平台", "Post to platforms")}
        sub={t("每个平台一行：打开要发的平台，写好标题和文案。抖音、小红书、视频号、B站 由你们手动发，发完点「我已发布」贴上链接。", "One row per platform. Turn on where it goes and write its title and caption. Douyin, Xiaohongshu, Channels and Bilibili are posted by hand — press 「我已发布」 with the link after.")}
        right={
          <button type="button" style={smallButton()} disabled={writing.length > 0} onClick={() => void write(rows.filter((r) => rowOf(r.key).on).map((r) => r.key))}>
            <Icon name="spark" size={13} />
            {writing.length ? t("撰稿人在写…", "Writing…") : t("AI 写全部文案", "AI: write all")}
          </button>
        }
      >
        <div className="pb-chosen">
          {chosen ? (
            <>
              <img src={`/api/files/${chosen.id}/thumb`} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 8, background: "#111", flexShrink: 0 }} />
              <div style={{ minWidth: 0, flexGrow: 1 }}>
                <div style={{ fontSize: 12, color: MUTED }}>{t("要发的视频", "The video to post")}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chosen.name}</div>
                <div style={{ fontSize: 12, color: MUTED }}>{chosen.kind === "final" ? t("最终版（你们改好的）", "Final (your version)") : t("AI 成片（未修改）", "AI render (as made)")}</div>
              </div>
              <a href={`/api/files/${chosen.id}/download?download=1`} style={smallButton()}>
                <Icon name="download" size={12} />
                {t("下载", "Download")}
              </a>
            </>
          ) : (
            <span style={{ fontSize: 13, color: "#95590a" }}>{t("还没选视频：先在上面上传最终版，或选「直接发 AI 成片」。", "No video picked yet: upload a final version above, or choose 「Post the render」.")}</span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          <GroupLabel text={t("自有账号 · 手动发布", "Own accounts · posted by hand")} />
          {rows
            .filter((r) => !r.channel)
            .map((r) => (
              <PlatformRow
                key={r.key}
                row={r}
                zh={zh}
                value={rowOf(r.key)}
                writing={writing.includes(r.key)}
                onChange={(patch) => setRow(r.key, patch)}
                onWrite={() => void write([r.key])}
                published={placeOf(r.place)}
                canPublish={canPublish}
                videoId={chosen?.id ?? null}
                pending={pending}
                onPublished={(url) =>
                  start(async () => {
                    if (!failed(await markPlacePublishedAction(projectId, r.place!, url, chosen?.id ?? null))) {
                      notify(t(`已记下：${r.label} 已发布`, `Noted: posted on ${r.label}`), "ok");
                      router.refresh();
                    }
                  })
                }
                onUndo={async () => {
                  if (!(await ask.confirm({ title: t(`撤回「${r.label} 已发布」的记录？`, `Undo "posted on ${r.label}"?`), confirm: t("撤回", "Undo") }))) return;
                  start(async () => {
                    if (!failed(await unmarkPlaceAction(projectId, r.place!))) router.refresh();
                  });
                }}
              />
            ))}

          {canChannels ? (
            <>
              <GroupLabel text={t("已连接的渠道 · 审批后自动发布", "Connected channels · posted after approval")} />
              {channelRows.length === 0 ? (
                <div style={{ fontSize: 12.5, color: MUTED }}>
                  {t("还没有连接渠道。", "No channel is connected.")}{" "}
                  <a href="/publish" style={{ color: "#1f5fbf" }}>
                    {t("去发布中心连接", "Connect one in Publish")}
                  </a>
                </div>
              ) : (
                channelRows.map((r) => {
                  const target = posts.flatMap((x) => x.targets.map((tg) => ({ ...tg, post: x }))).find((tg) => tg.channelId === r.channel!.id) ?? null;
                  return (
                    <PlatformRow
                      key={r.key}
                      row={r}
                      zh={zh}
                      value={rowOf(r.key)}
                      writing={writing.includes(r.key)}
                      onChange={(patch) => setRow(r.key, patch)}
                      onWrite={() => void write([r.key])}
                      published={target && target.state === "published" ? { key: "other", url: target.url } : null}
                      channelState={target ? { state: target.state === "draft" ? target.post.state : target.state, error: target.error } : null}
                      canPublish={false}
                      videoId={chosen?.id ?? null}
                      pending={pending}
                    />
                  );
                })
              )}
              {channelRows.length ? (
                <ChannelSend
                  zh={zh}
                  people={people}
                  viewerId={viewerId}
                  post={livePost}
                  pending={pending}
                  disabled={!chosen || !channelRows.some((r) => rowOf(r.key).on)}
                  onSend={(approverId) =>
                    start(async () => {
                      const on = channelRows.filter((r) => rowOf(r.key).on);
                      const res = await sendChannelsForApprovalAction(projectId, {
                        fileId: chosen?.id ?? null,
                        coverFileId: draft.coverFileId ?? null,
                        approverId,
                        rows: on.map((r) => ({ channelId: r.channel!.id, title: rowOf(r.key).title || title, body: rowOf(r.key).body })),
                      });
                      if (!failed(res)) {
                        notify(t("已提交审批，批准后自动发出", "Sent for approval; it goes out once approved"), "ok");
                        router.refresh();
                      }
                    })
                  }
                  onSelf={async () => {
                    if (!(await ask.confirm({ title: t("自己批准并发布？", "Approve and publish it yourself?"), body: t("你的名字会记录在批准记录上。", "Your name goes on the approval."), confirm: t("批准并发布", "Approve and publish") }))) return;
                    start(async () => {
                      const on = channelRows.filter((r) => rowOf(r.key).on);
                      const res = await sendChannelsForApprovalAction(projectId, {
                        fileId: chosen?.id ?? null,
                        coverFileId: draft.coverFileId ?? null,
                        approverId: viewerId,
                        rows: on.map((r) => ({ channelId: r.channel!.id, title: rowOf(r.key).title || title, body: rowOf(r.key).body })),
                      });
                      if (failed(res) || !("postId" in res) || !res.postId) return;
                      if (!failed(await approveAction(res.postId, ""))) {
                        notify(t("已批准，后台正在发出", "Approved; it is going out"), "ok");
                        router.refresh();
                      }
                    });
                  }}
                  onApprove={async (postId) => {
                    if (!(await ask.confirm({ title: t("批准并发布？", "Approve and publish?"), body: t("你的名字会记录在批准记录上。", "Your name goes on the approval."), confirm: t("批准并发布", "Approve and publish") }))) return;
                    start(async () => {
                      if (!failed(await approveAction(postId, ""))) {
                        notify(t("已批准，后台正在发出", "Approved; it is going out"), "ok");
                        router.refresh();
                      }
                    });
                  }}
                />
              ) : null}
            </>
          ) : null}
        </div>
        {!canPublish ? <div style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>{t("「我已发布」只有项目负责人或管理员可以点。", "Only the project's owner or an admin can press 「我已发布」.")}</div> : null}
        {ownRowsOn.length === 0 && !channelRows.length ? <div style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>{t("所有平台都关掉了。", "Every platform is off.")}</div> : null}
      </Card>

      {picking ? (
        <FilePicker
          zh={zh}
          files={pickable}
          onClose={() => setPicking(false)}
          onPick={(ids) =>
            start(async () => {
              const r = await markFinalAction(projectId, ids);
              if (!failed(r)) {
                setPicking(false);
                if (ids.length) setDraft((d) => ({ ...d, fileId: ids[ids.length - 1] }));
                router.refresh();
              }
            })
          }
        />
      ) : null}
    </PageBody>
  );
}

/* ------------------------------------------------------------- pieces */

function RenderVideo({ render, zh }: { render: Render; zh: boolean }) {
  const [proxyFailed, setProxyFailed] = React.useState(false);
  const src = proxyFailed ? render.fileId : (render.proxyFileId ?? render.fileId);
  const tall = render.aspect === "9:16";
  return (
    <video
      key={src}
      controls
      preload="metadata"
      playsInline
      poster={`/api/files/${render.fileId}/thumb`}
      src={`/api/files/${src}/download`}
      onError={() => {
        if (!proxyFailed && render.proxyFileId) setProxyFailed(true);
      }}
      aria-label={zh ? "AI 成片" : "AI render"}
      style={{ display: "block", width: tall ? "auto" : "100%", height: tall ? 420 : "auto", maxWidth: "100%", maxHeight: 420, aspectRatio: render.aspect.replace(":", " / "), objectFit: "contain", borderRadius: 12, background: "#000", justifySelf: "center" }}
    />
  );
}

function SelectPill({ on, label, onClick, zh, small = false }: { on: boolean; label: string; onClick: () => void; zh: boolean; small?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className="pb-pick" data-on={on ? "1" : undefined} style={small ? { height: 28, fontSize: 12 } : undefined}>
      <span className="pb-box">{on ? <Icon name="check" size={11} /> : null}</span>
      {on ? (zh ? "要发这个" : "Posting this") : label}
    </button>
  );
}

function VideoTile({
  video: f,
  zh,
  on,
  playing,
  onPlay,
  onPick,
  onRename,
  onRemove,
}: {
  video: PublishVideo;
  zh: boolean;
  on: boolean;
  playing: boolean;
  onPlay: () => void;
  onPick: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const tall = (f.height ?? 0) > (f.width ?? 0);
  return (
    <div className="pb-tile" data-on={on ? "1" : undefined}>
      <div style={{ position: "relative", background: "#111", borderRadius: 10, overflow: "hidden", aspectRatio: tall ? "9 / 12" : "16 / 10" }}>
        {playing ? (
          <video autoPlay controls playsInline src={`/api/files/${f.id}/download`} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
        ) : (
          <button type="button" onClick={onPlay} aria-label={t("播放", "Play")} style={{ all: "unset", cursor: "pointer", position: "absolute", inset: 0, display: "block" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${f.id}/thumb`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
            <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 38, height: 38, borderRadius: 99, background: "rgba(0,0,0,.55)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="play" size={16} />
            </span>
          </button>
        )}
        {f.durationMs ? <span style={{ position: "absolute", right: 6, bottom: 6, fontSize: 11, color: "#fff", background: "rgba(0,0,0,.6)", borderRadius: 5, padding: "1px 5px", pointerEvents: "none" }}>{clock(f.durationMs)}</span> : null}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginTop: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.name}>
        {f.name}
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
        {bytes(f.sizeBytes)} · {f.by} · {when(f.at, zh)}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <SelectPill small on={on} zh={zh} onClick={onPick} label={t("发布这个", "Post this")} />
        <span style={{ flexGrow: 1 }} />
        <button type="button" className="pb-link" onClick={onRename}>
          {t("改名", "Rename")}
        </button>
        <button type="button" className="pb-link pb-danger" onClick={onRemove}>
          {t("移出", "Remove")}
        </button>
      </div>
    </div>
  );
}

function GroupLabel({ text }: { text: string }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, marginTop: 6 }}>{text}</div>;
}

function PlatformRow({
  row,
  zh,
  value,
  writing,
  onChange,
  onWrite,
  published,
  channelState = null,
  canPublish,
  videoId,
  pending,
  onPublished,
  onUndo,
}: {
  row: Row;
  zh: boolean;
  value: { on: boolean; title: string; body: string };
  writing: boolean;
  onChange: (patch: Partial<{ on: boolean; title: string; body: string }>) => void;
  onWrite: () => void;
  published: { key: string; url: string | null } | null;
  channelState?: { state: string; error: string | null } | null;
  canPublish: boolean;
  videoId: string | null;
  pending: boolean;
  onPublished?: (url: string) => void;
  onUndo?: () => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [asking, setAsking] = React.useState(false);
  const [link, setLink] = React.useState("");
  const lim = captionLimits(row.key);
  const spec = PUBLISH_ROWS.find((x) => x.key === (row.channel ? row.platform : row.key));
  const over = value.title.length > lim.title || value.body.length > lim.body;
  return (
    <div className="pb-row" data-off={value.on ? undefined : "1"}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" role="switch" aria-checked={value.on} className="pb-switch" data-on={value.on ? "1" : undefined} onClick={() => onChange({ on: !value.on })} aria-label={t(`发到${row.label}`, `Post to ${row.label}`)}>
          <span />
        </button>
        <PlatformMark platform={row.platform} size={20} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>{row.label}</div>
          <div style={{ fontSize: 11.5, color: MUTED }}>
            {row.account}
            {row.accountId ? ` · ID ${row.accountId}` : ""}
            {spec ? ` · ${spec.shape}` : ""}
          </div>
        </div>
        <span style={{ flexGrow: 1 }} />
        {published ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#1e7a4f", fontWeight: 600 }}>
            <span style={{ width: 18, height: 18, borderRadius: 99, background: "#22a061", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="check" size={11} />
            </span>
            {t("已发布", "Posted")}
            {published.url ? (
              <a href={published.url} target="_blank" rel="noreferrer" style={{ color: "#1f5fbf", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 3 }}>
                {t("看帖子", "Open post")}
                <Icon name="external" size={11} />
              </a>
            ) : null}
            {onUndo && canPublish ? (
              <button type="button" className="pb-link" onClick={onUndo} disabled={pending}>
                {t("撤回", "Undo")}
              </button>
            ) : null}
          </span>
        ) : channelState ? (
          <span style={{ fontSize: 12, color: channelState.state === "failed" ? "#c42b2b" : "#1f5fbf" }} title={channelState.error ?? undefined}>
            {stateWord(channelState.state, zh)}
          </span>
        ) : null}
      </div>
      {value.on ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          <label className="pb-field">
            <span>
              {t("标题", "Title")}
              <em data-over={value.title.length > lim.title ? "1" : undefined}>
                {value.title.length}/{lim.title}
              </em>
            </span>
            <input value={value.title} onChange={(e) => onChange({ title: e.target.value })} placeholder={t("写一个标题，或让 AI 写", "A title, or let AI write one")} />
          </label>
          <label className="pb-field">
            <span>
              {t("文案", "Caption")}
              <em data-over={value.body.length > lim.body ? "1" : undefined}>
                {value.body.length}/{lim.body}
              </em>
            </span>
            <textarea value={value.body} onChange={(e) => onChange({ body: e.target.value })} rows={Math.min(8, Math.max(2, value.body.split("\n").length + Math.floor(value.body.length / 70)))} placeholder={t("文案和话题标签", "Caption and hashtags")} />
          </label>
          {over ? <div style={{ fontSize: 12, color: "#c42b2b" }}>{t("超过这个平台的字数上限了", "Over this platform's limit")}</div> : null}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={smallButton()} onClick={onWrite} disabled={writing}>
              <Icon name="spark" size={12} />
              {writing ? t("撰稿人在写…", "Writing…") : t("AI 写文案", "AI: write it")}
            </button>
            <button
              type="button"
              style={smallButton()}
              onClick={() => {
                const text = [value.title, value.body].filter(Boolean).join("\n\n");
                if (!text) return notify(t("还没有文案", "Nothing to copy yet"));
                void navigator.clipboard.writeText(text).then(
                  () => notify(t("已复制标题和文案", "Title and caption copied"), "ok"),
                  () => notify(t("复制失败，手动选中复制", "Could not copy; select it by hand")),
                );
              }}
            >
              <CopyIcon />
              {t("复制文案", "Copy caption")}
            </button>
            {!row.channel ? (
              <>
                {videoId ? (
                  <a href={`/api/files/${videoId}/download?download=1`} style={smallButton()}>
                    <Icon name="download" size={12} />
                    {t("下载视频", "Download video")}
                  </a>
                ) : null}
                {row.studio ? (
                  <a href={row.studio} target="_blank" rel="noreferrer" style={smallButton()}>
                    <Icon name="external" size={12} />
                    {t("打开创作者后台", "Open creator console")}
                  </a>
                ) : null}
                <span style={{ flexGrow: 1 }} />
                {canPublish && !published ? (
                  asking ? (
                    <form
                      style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
                      onSubmit={(e) => {
                        e.preventDefault();
                        onPublished?.(link);
                        setAsking(false);
                      }}
                    >
                      <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("贴上帖子链接（可留空）", "Paste the post link (optional)")} className="pb-linkbox" />
                      <button type="submit" style={smallButton(true)} disabled={pending}>
                        {t("确认", "Confirm")}
                      </button>
                      <button type="button" className="pb-link" onClick={() => setAsking(false)}>
                        {t("取消", "Cancel")}
                      </button>
                    </form>
                  ) : (
                    <button type="button" style={smallButton(true)} onClick={() => setAsking(true)}>
                      <Icon name="check" size={12} />
                      {t("我已发布", "I posted it")}
                    </button>
                  )
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChannelSend({
  zh,
  people,
  viewerId,
  post,
  pending,
  disabled,
  onSend,
  onApprove,
  onSelf,
}: {
  zh: boolean;
  people: { id: string; name: string }[];
  viewerId: string;
  post: Post | null;
  pending: boolean;
  disabled: boolean;
  onSend: (approverId: string | null) => void;
  onApprove: (postId: string) => void;
  /** Send it and approve it at once: for someone who can approve. */
  onSelf: () => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [approver, setApprover] = React.useState<string>("");
  if (post && post.state === "awaiting_approval") {
    const mine = post.approval?.requestedById === viewerId;
    return (
      <div className="pb-send">
        <div style={{ flexGrow: 1, fontSize: 13, color: INK }}>
          {t("等待批准", "Waiting for approval")}
          {post.approval?.approverName ? t(` · 已请 ${post.approval.approverName} 批准`, ` · asked ${post.approval.approverName}`) : ""}
          {post.approval?.requestedByName ? <span style={{ color: MUTED }}>{t(` · ${post.approval.requestedByName} 提交`, ` · from ${post.approval.requestedByName}`)}</span> : null}
        </div>
        <button type="button" style={bigButton("primary", pending)} disabled={pending} onClick={() => onApprove(post.id)}>
          <Icon name="check" size={15} />
          {mine ? t("我自己批准并发布", "Approve it myself and publish") : t("批准并发布", "Approve and publish")}
        </button>
      </div>
    );
  }
  if (post && (post.state === "approved" || post.state === "publishing")) {
    return (
      <div className="pb-send">
        <div style={{ fontSize: 13, color: "#1f5fbf" }}>{t("已批准，正在发出…", "Approved; going out…")}</div>
      </div>
    );
  }
  return (
    <div className="pb-send">
      <div style={{ fontSize: 12.5, color: MUTED, flexGrow: 1, minWidth: 200 }}>{t("没有具名批准，任何内容都不会发出。选一位同事批准：", "Nothing goes out without a named approval. Pick who approves:")}</div>
      <select value={approver} onChange={(e) => setApprover(e.target.value)} className="pb-select">
        <option value="">{t("任何有权批准的人", "Anyone who can approve")}</option>
        {people
          .filter((p) => p.id !== viewerId)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      <button type="button" style={bigButton("primary", disabled || pending)} disabled={disabled || pending} onClick={() => onSend(approver || null)}>
        <Icon name="share" size={15} />
        {t("提交审批", "Send for approval")}
      </button>
      <button type="button" style={bigButton("secondary", disabled || pending)} disabled={disabled || pending} onClick={onSelf}>
        <Icon name="check" size={15} />
        {t("我自己批准并发布", "Approve it myself")}
      </button>
    </div>
  );
}

function FilePicker({ zh, files, onClose, onPick }: { zh: boolean; files: PublishVideo[]; onClose: () => void; onPick: (ids: string[]) => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [sel, setSel] = React.useState<string[]>([]);
  const [q, setQ] = React.useState("");
  const shown = files.filter((f) => !q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div role="dialog" aria-modal="true" aria-label={t("从文件中选择", "Pick from Files")} onMouseDown={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()} style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(23,23,23,.25)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "8vh" }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(720px, 94vw)", maxHeight: "80vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 14, border: `1px solid ${LINE}`, boxShadow: "0 24px 64px rgba(23,23,23,.22)", overflow: "hidden" }}>
        <div style={{ padding: "16px 18px 10px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 600, flexGrow: 1 }}>{t("选已有的视频作为最终版", "Use an existing video as the final version")}</div>
          <button type="button" className="pb-link" onClick={onClose}>
            {t("关闭", "Close")}
          </button>
        </div>
        <div style={{ padding: "0 18px 10px" }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("按名字找", "Search by name")} className="pb-linkbox" style={{ width: "100%" }} />
        </div>
        <div style={{ overflowY: "auto", padding: "0 18px 12px", minHeight: 120 }}>
          {shown.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: MUTED, fontSize: 13 }}>{t("没有可选的视频", "No videos to pick")}</div>
          ) : (
            shown.map((f) => {
              const on = sel.includes(f.id);
              return (
                <button key={f.id} type="button" onClick={() => setSel((s) => (on ? s.filter((x) => x !== f.id) : [...s, f.id]))} className="pb-pickrow" data-on={on ? "1" : undefined}>
                  <span className="pb-box">{on ? <Icon name="check" size={11} /> : null}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${f.id}/thumb`} alt="" style={{ width: 64, height: 40, objectFit: "cover", borderRadius: 6, background: "#111", flexShrink: 0 }} onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                  <span style={{ minWidth: 0, flexGrow: 1, textAlign: "left" }}>
                    <span style={{ display: "block", fontSize: 13, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: MUTED }}>
                      {f.where === "project-clip" ? t("本项目素材", "This project's footage") : f.where === "project" ? t("本项目", "This project") : t("文件", "Files")} · {clock(f.durationMs)} · {bytes(f.sizeBytes)} · {f.by}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 18px", borderTop: `1px solid ${LINE}` }}>
          <button type="button" style={bigButton("secondary")} onClick={onClose}>
            {t("取消", "Cancel")}
          </button>
          <button type="button" style={bigButton("primary", !sel.length)} disabled={!sel.length} onClick={() => onPick(sel)}>
            {t(`设为最终版${sel.length ? ` · ${sel.length}` : ""}`, `Use as final${sel.length ? ` · ${sel.length}` : ""}`)}
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

/* ------------------------------------------------------------- words */

function platformName(platform: string, zh: boolean): string {
  const map: Record<string, [string, string]> = { youtube: ["YouTube", "YouTube"], linkedin: ["LinkedIn", "LinkedIn"], tiktok: ["TikTok", "TikTok"], instagram: ["Instagram", "Instagram"], facebook: ["Facebook", "Facebook"], x: ["X", "X"], threads: ["Threads", "Threads"] };
  const m = map[platform];
  return m ? (zh ? m[0] : m[1]) : publishPlatformName(platform, zh);
}

function stateWord(state: string, zh: boolean): string {
  const w: Record<string, [string, string]> = {
    draft: ["草稿", "Draft"],
    awaiting_approval: ["等待批准", "Awaiting approval"],
    approved: ["已批准", "Approved"],
    scheduled: ["已排期", "Scheduled"],
    publishing: ["发布中", "Publishing"],
    published: ["已发布", "Published"],
    failed: ["发布失败", "Failed"],
    cancelled: ["已取消", "Cancelled"],
  };
  return (w[state] ?? [state, state])[zh ? 0 : 1];
}

function clock(ms: number | null): string {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function bytes(n: number | null): string {
  if (!n) return "—";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** "9月28日 14:05" on the studio's clock (UTC+8), the same on server and browser. */
function when(iso: string, zh: boolean): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const d = new Date(at + 8 * 3_600_000);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return zh ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${hm}` : `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${hm}`;
}

const CSS = `
.pb-render { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 860px) { .pb-render { grid-template-columns: 1fr; } }
.pb-drop { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 22px 14px; border: 1.5px dashed #d6d5d0; border-radius: 12px; background: #fbfbfa; color: #6b6b6b; text-align: center; transition: border-color .15s ease, background-color .15s ease; }
.pb-drop[data-on] { border-color: #1f6feb; background: #f2f7ff; }
.pb-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; margin-top: 14px; }
.pb-tile { border: 1px solid #e7e6e2; border-radius: 12px; padding: 10px; background: #fff; transition: border-color .15s ease, box-shadow .15s ease; min-width: 0; }
.pb-tile[data-on] { border-color: #171717; box-shadow: 0 0 0 2px rgba(23,23,23,.08); }
.pb-pick { display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid #d6d5d0; background: #fff; color: #333; font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.pb-pick[data-on] { background: #eef8f2; border-color: #9fd6b6; color: #1e7a4f; }
.pb-box { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid #bdbcb7; display: inline-flex; align-items: center; justify-content: center; background: #fff; flex-shrink: 0; }
.pb-pick[data-on] .pb-box, .pb-pickrow[data-on] .pb-box { background: #22a061; border-color: #22a061; color: #fff; }
.pb-link { border: 0; background: none; padding: 2px 4px; font-family: inherit; font-size: 12px; color: #555; cursor: pointer; border-radius: 5px; }
.pb-link:hover { background: #f1f0ec; color: #171717; }
.pb-danger:hover { background: #fdecea; color: #b42318; }
.pb-chosen { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px; background: #f7f7f5; border: 1px solid #ecebe7; }
.pb-row { border: 1px solid #e7e6e2; border-radius: 12px; padding: 12px 14px; background: #fff; }
.pb-row[data-off] { background: #fafaf9; }
.pb-row[data-off] > div:first-child { opacity: .65; }
.pb-switch { width: 34px; height: 20px; border-radius: 99px; border: 0; background: #d4d3ce; position: relative; cursor: pointer; flex-shrink: 0; padding: 0; transition: background-color .15s ease; }
.pb-switch span { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 99px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: transform .15s ease; }
.pb-switch[data-on] { background: #22a061; }
.pb-switch[data-on] span { transform: translateX(14px); }
.pb-field { display: flex; flex-direction: column; gap: 4px; }
.pb-field > span { display: flex; justify-content: space-between; font-size: 12px; color: #6b6b6b; }
.pb-field em { font-style: normal; color: #a3a3a3; }
.pb-field em[data-over] { color: #c42b2b; font-weight: 600; }
.pb-field input, .pb-field textarea, .pb-linkbox, .pb-select { font-family: inherit; font-size: 13.5px; color: #171717; border: 1px solid #dcdbd6; border-radius: 8px; padding: 8px 10px; background: #fff; outline: none; }
.pb-field textarea { resize: vertical; line-height: 1.6; }
.pb-field input:focus, .pb-field textarea:focus, .pb-linkbox:focus, .pb-select:focus { border-color: #171717; }
.pb-linkbox { height: 32px; padding: 0 10px; min-width: 240px; }
.pb-select { height: 40px; }
.pb-send { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 14px; border-radius: 12px; background: #f5f9ff; border: 1px solid #d6e4fb; }
.pb-pickrow { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: none; padding: 8px; border-radius: 9px; cursor: pointer; font-family: inherit; }
.pb-pickrow:hover { background: #f5f5f3; }
.pb-pickrow[data-on] { background: #eef8f2; }
`;
