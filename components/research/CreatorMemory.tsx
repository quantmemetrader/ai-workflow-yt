"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CreatorMemoryState } from "@/lib/creator/service";
import { syncCreatorAction } from "@/app/(app)/research/actions";
import { notify } from "@/lib/client/notify";
import { beginWork } from "@/lib/client/busy";
import { Badge, ghost } from "@/components/ui/kit";

/**
 * The channel as memory.
 *
 * What the assistant knows about the creator's own videos, said plainly: how
 * many are synced, when, what the best ones were, and whether the voice note
 * it carries into every prompt exists. The Sync button is the whole control;
 * the note itself is edited in Admin → Knowledge like any other.
 */
export function CreatorMemory({ state, syncing, zh, canAdmin }: { state: CreatorMemoryState; syncing: boolean; zh: boolean; canAdmin: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const [, start] = useTransition();
  const [open, setOpen] = useState(false);

  const sync = () =>
    start(async () => {
      const done = beginWork(t("Syncing the channel", "同步频道"));
      try {
        const res = await syncCreatorAction();
        if (res.error) notify(res.error);
        else notify(t("Syncing. The voice note is rewritten when it lands.", "正在同步，完成后会重写风格记忆。"), "ok");
        router.refresh();
      } finally {
        done();
      }
    });

  const mins = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");
  const when = state.lastSyncedAt ? state.lastSyncedAt.toISOString().slice(0, 10) : null;

  return (
    <div style={{ margin: "0 20px 18px", border: "1px solid #ededed", borderRadius: 12, background: "#fff", padding: "13px 15px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10.5, fontWeight: 500, color: "#999999" }}>{t("Your channel, as memory", "你的频道 · 风格记忆")}</div>
        {state.channels.map((c) => (
          <Badge key={c.id} tone="quiet">
            {c.name}
          </Badge>
        ))}
        {state.voice ? (
          <Badge tone={state.voice.active ? "good" : "warn"}>
            {state.voice.active ? t(`voice note v${state.voice.version}`, `风格记忆 v${state.voice.version}`) : t("voice note off", "风格记忆已关闭")}
          </Badge>
        ) : (
          <Badge tone="warn">{t("no voice note yet", "还没有风格记忆")}</Badge>
        )}
        <div style={{ flexGrow: 1 }} />
        <span style={{ fontSize: 11, color: "#999999" }}>
          {state.videos
            ? t(`${state.videos} videos · ${state.transcripts} with transcripts${when ? ` · synced ${when}` : ""}`, `${state.videos} 支视频 · ${state.transcripts} 支有文字稿${when ? ` · 同步于 ${when}` : ""}`)
            : t("nothing synced yet", "尚未同步")}
        </span>
        <button type="button" disabled={syncing || state.channels.length === 0} onClick={sync} style={{ ...ghost, height: 26, fontSize: 11.5, opacity: syncing ? 0.6 : 1 }}>
          {syncing ? t("Syncing…", "同步中…") : t("Sync now", "立即同步")}
        </button>
      </div>

      <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "#7c7c7c", lineHeight: 1.55 }}>
        {state.channels.length === 0
          ? t("Connect a YouTube channel in Publish and the assistant starts learning from it.", "在“发布”中连接 YouTube 频道后，助理会开始从中学习。")
          : t(
              "Every upload on the channel is read through YouTube's own API: titles, descriptions, tags, length, what it earned. A model folds them into one voice note that goes in front of every prompt, so scripts and cuts sound like this channel and not like a model. Transcripts are kept for the videos that were cut here.",
              "频道的每支视频都通过 YouTube 官方接口读取：标题、简介、标签、时长、播放量。模型把它们浓缩成一份风格记忆，放在每次对话的最前面，让剧本和剪辑都像这个频道，而不是像模型。在这里剪出来的视频会保留文字稿。",
            )}
      </p>

      {state.top.length > 0 ? (
        <div style={{ display: "flex", gap: 8, marginTop: 10, overflowX: "auto", paddingBottom: 2 }}>
          {state.top.map((v) => (
            <a
              key={v.id}
              href={`https://www.youtube.com/watch?v=${v.externalId}`}
              target="_blank"
              rel="noreferrer"
              title={v.title}
              style={{ flexShrink: 0, width: 150, textDecoration: "none", color: "#171717" }}
            >
              <div style={{ width: 150, height: 84, borderRadius: 7, background: "#f3f3f3", overflow: "hidden" }}>
                {v.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : null}
              </div>
              <div style={{ fontSize: 11.5, lineHeight: 1.35, marginTop: 5, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2 }}>{v.title}</div>
              <div style={{ fontSize: 10.5, color: "#999999", marginTop: 2 }}>
                {v.views.toLocaleString()} · {mins(v.durationSec)}
              </div>
            </a>
          ))}
        </div>
      ) : null}

      {state.voice ? (
        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...ghost, height: 24, fontSize: 11 }}>
            {open ? t("Hide the voice note", "收起风格记忆") : t("Read the voice note", "查看风格记忆")}
          </button>
          {canAdmin ? (
            <Link href="/admin" style={{ fontSize: 11, color: "#007be0", marginLeft: 10 }}>
              {t("Edit in Admin", "在后台编辑")}
            </Link>
          ) : null}
          {open ? (
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12, lineHeight: 1.6, color: "#383838", background: "#f8f8f8", borderRadius: 8, padding: 12, marginTop: 8, maxHeight: 360, overflowY: "auto" }}>
              {state.voice.body}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
