"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { approveNowAction } from "@/app/(app)/script/actions";
import { flowNoteAction, sendBackAction, startCutFromPageAction } from "@/app/(app)/projects/actions";
import { sendChannelMessage } from "@/app/(app)/chat/actions";
import { AGENT_LABELS, agentTag, type AgentKey } from "@/lib/agents/catalog";
import { frontierStep } from "@/lib/home/roles";
import { notify } from "@/lib/client/notify";
import { tabHref } from "@/lib/projects/tabs";
import type { ProjectDetail, ProjectStep } from "@/lib/projects/service";
import { Card, bigButton } from "@/components/projects/kit";

/**
 * The step the project is on, with the two presses Ryan asked for (27 Sep):
 * 「确认，交给下一位」 — confirm and hand on to the next person in the flow —
 * and 「写意见，退回给上一位」 — comments sent back to the previous person
 * (a script comes back with 编剧's edit suggestions, `sendBackAction`).
 * Only presses that can be pressed; where the work is done on the step's own
 * page, the press goes there.
 */
export function FlowMoves({ p, zh, canApprove }: { p: ProjectDetail; zh: boolean; canApprove: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");

  const now = p.status === "active" ? frontierStep(p.steps) : null;
  if (!now) return null;
  const i = p.steps.findIndex((x) => x.key === now.key);
  const next = p.steps.slice(i + 1).find((x) => x.state !== "skipped") ?? null;
  const prev = [...p.steps.slice(0, i)].reverse().find((x) => x.state !== "skipped") ?? null;
  const personOf = (x: ProjectStep) => (x.key === "clips" ? p.people.clips : x.key === "deliver" ? p.people.deliver : null);
  const nameOf = (x: ProjectStep | null) =>
    !x ? "" : x.owner === "you" ? (personOf(x)?.name ?? t("主持人", "the host")) : zh ? AGENT_LABELS[x.owner as AgentKey].nameLocal : AGENT_LABELS[x.owner as AgentKey].nameEn;
  const failed = (r: unknown) => {
    const e = r && typeof r === "object" && "error" in r ? (r as { error?: string }).error : null;
    if (e) notify(e);
    return Boolean(e);
  };
  const nextName = nameOf(next);

  /* The confirm press: a button that does it, or a link to the page where it is done. */
  let confirm: { label: string; run?: () => void; href?: string } | null = null;
  if (now.key === "topic") confirm = { label: t(`选题定了，交给 ${nextName}`, `Topic set, on to ${nextName}`), href: tabHref(p.id, "script") };
  else if (now.key === "script") {
    if (now.state === "running") confirm = null;
    else if (now.state === "you" && canApprove && p.script)
      confirm = {
        label: t(`确认稿子，交给 ${nextName}`, `Approve the script, on to ${nextName}`),
        run: () =>
          start(async () => {
            if (failed(await approveNowAction(p.script!.id))) return;
            await flowNoteAction(p.id, t(`确认了稿子，交给 ${nextName} 拍摄、上传素材。`, `Approved the script; over to ${nextName} to film and upload.`));
            notify(t(`已交给 ${nextName}`, `Handed to ${nextName}`), "ok");
            router.refresh();
          }),
      };
    else confirm = { label: t("去稿子页，分享给同事审阅", "Open the script and share it for review"), href: tabHref(p.id, "script") };
  } else if (now.key === "clips") {
    confirm =
      (p.video?.clips ?? 0) > 0
        ? {
            label: t(`素材齐了，交给 ${nextName}`, `Clips are in, on to ${nextName}`),
            run: () =>
              start(async () => {
                await flowNoteAction(p.id, t(`素材齐了，交给 ${nextName} 开剪。`, `The clips are in; over to ${nextName}.`));
                if (failed(await startCutFromPageAction(p.id, {}))) return;
                notify(t(`已交给 ${nextName}`, `Handed to ${nextName}`), "ok");
                router.refresh();
              }),
          }
        : { label: t("去上传拍好的视频", "Upload the footage"), href: tabHref(p.id, "edit") };
  } else if (now.key === "edit") {
    confirm =
      p.render?.state === "done" && p.render.fileId
        ? {
            label: t(`成片没问题，交给 ${nextName}`, `The film is good, on to ${nextName}`),
            run: () =>
              start(async () => {
                await flowNoteAction(p.id, t(`成片看过了，没问题，交给 ${nextName} 发布。`, `Watched the film; over to ${nextName} to publish.`));
                router.push(tabHref(p.id, "publish"));
              }),
          }
        : now.state === "running"
          ? null
          : { label: t("去剪辑页", "Open the edit"), href: tabHref(p.id, "edit") };
  } else if (now.key === "deliver") confirm = { label: t("去发布", "Go publish"), href: tabHref(p.id, "publish") };

  const back = prev
    ? {
        to: nameOf(prev),
        send: (text: string) =>
          start(async () => {
            if (failed(await sendBackAction(p.id, prev.key, text))) return;
            const slug = p.channel.slug;
            const r =
              prev.key === "edit"
                ? await sendChannelMessage(slug, `${agentTag("video")} 成片退回，按以下意见重新剪一版视频：${text}`)
                : prev.key === "topic"
                  ? await sendChannelMessage(slug, `${agentTag("research")} 选题退回：${text}\n请按这个意见换个方向，再交给编剧。`)
                  : null;
            if (failed(r)) return;
            notify(t(`已退回给 ${nameOf(prev)}`, `Sent back to ${nameOf(prev)}`), "ok");
            setNote("");
            setOpen(false);
            router.refresh();
            if (prev.key === "script") router.push(tabHref(p.id, "script"));
          }),
      }
    : null;

  if (!confirm && !back) return null;
  const who = nameOf(now);

  return (
    <Card icon="check" title={t(`这一步：${now.label}`, `This step: ${now.label}`)} sub={t(`现在由 ${who} 负责`, `${who} holds it now`)}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {confirm ? (
          confirm.href ? (
            <Link prefetch={false} href={confirm.href} style={bigButton("primary")}>
              {confirm.label} →
            </Link>
          ) : (
            <button type="button" onClick={confirm.run} disabled={pending} style={bigButton("primary", pending)}>
              {confirm.label}
            </button>
          )
        ) : null}
        {back ? (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={pending} style={bigButton("secondary", pending)}>
            {t(`写意见，退回给 ${back.to}`, `Send back to ${back.to}`)}
          </button>
        ) : null}
      </div>
      {open && back ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, maxWidth: 680 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
            rows={3}
            placeholder={t(`写下要改什么，${back.to} 会收到`, `Say what to change; ${back.to} gets it`)}
            style={{ width: "100%", boxSizing: "border-box", resize: "vertical", border: "1px solid #dcdbd6", borderRadius: 10, padding: "10px 12px", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.55, outline: "none" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => note.trim() && back.send(note.trim())} disabled={pending || !note.trim()} style={bigButton("primary", pending || !note.trim())}>
              {pending ? t("正在退回…", "Sending…") : t(`退回给 ${back.to}`, `Send back to ${back.to}`)}
            </button>
            <button type="button" onClick={() => setOpen(false)} style={bigButton("secondary")}>
              {t("取消", "Cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
