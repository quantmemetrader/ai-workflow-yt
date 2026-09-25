"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ChannelRow, LogRow, PostRow } from "@/lib/publish/service";
import { CONNECTABLE, checkForPlatform, specFor } from "@/lib/publish/platforms";
import { PlatformMark, platformLabel } from "@/components/ui/PlatformMark";
import { Icon, type IconName } from "@/components/ui/Icon";
import {
  approveAction,
  createPostAction,
  rejectAction,
  requestApprovalAction,
  retryTargetAction,
  setChannelEnabledAction,
  setOverrideAction,
  setTargetOptionsAction,
  setTargetsAction,
  syncChannelsAction,
  updatePostAction,
  connectChannelAction,
} from "@/app/(app)/publish/actions";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { notify } from "@/lib/client/notify";
import { ModuleSidebar, type ScreenItem } from "@/components/shell/ModuleSidebar";

/**
 * Publish (spec §4.6), transcribed from the four `Pub-*` artboards.
 *
 * They are one screen with four tabs, for the reason the Script artboards are:
 * the channel board, the caption, the queue and the log are four views of the
 * same posts, and four routes would mean four copies of the same sidebar.
 *
 * The module's one promise is on every tab: **nothing leaves without an
 * approval record naming a person.** Approve is the only control that queues a
 * send, it is disabled for the person who asked for the approval, and what it
 * queues is a job — no screen in this module ever calls a platform.
 */
type Tab = "channels" | "caption" | "approvals" | "log";

const ACCENT = "#007be0";

export function PublishScreen({
  channels,
  posts,
  log,
  counts,
  people,
  viewerId,
  locale,
  model,
}: {
  channels: ChannelRow[];
  posts: PostRow[];
  log: LogRow[];
  counts: Record<string, number>;
  people: { id: string; name: string }[];
  viewerId: string;
  locale: string;
  model: string;
}) {
  const zh = locale.startsWith("zh");
  const t = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const agent = useInlineAgent({ module: "publish" });
  const [busy, start] = useTransition();
  const [tab, setTab] = useState<Tab>("channels");
  const [selectedId, setSelected] = useState<string | null>(posts[0]?.id ?? null);
  const [composing, setComposing] = useState(false);
  const [confirming, setConfirming] = useState<PostRow | null>(null);

  const selected = posts.find((p) => p.id === selectedId) ?? posts[0] ?? null;
  const waiting = posts.filter((p) => p.state === "awaiting_approval");

  /** Every action goes through here: one place that reports a failure, and one
   * place that refreshes. A silent failure is how the Research module ended up
   * swallowing its own errors. */
  const run = (fn: () => Promise<{ error?: string } | void>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) {
        notify(res.error);
        return;
      }
      after?.();
      router.refresh();
    });


  /* The design draws these down a 212px column, the way every other
     desktop artboard in the set does — not across the top. */
  const SCREENS: ScreenItem<Tab>[] = [
    { key: "channels", label: "Channel board", labelZh: "渠道看板", badge: channels.length },
    { key: "caption", label: "Composer", labelZh: "文案", badge: counts.draft },
    { key: "approvals", label: "Approval queue", labelZh: "审批队列", badge: waiting.length },
    { key: "log", label: "Publish log", labelZh: "发布日志" },
  ];

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", minHeight: 0 }}>
    <ModuleSidebar
      title="Publish"
      titleZh="发布中"
      screens={SCREENS}
      active={tab}
      onChange={setTab}
      zh={zh}
      storageKey="publish-sidebar"
    />
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <header
        style={{
          height: 56,
          flexShrink: 0,
          borderBottom: "1px solid #ededed",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 22px",
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600 }}>{t("Publish", "发布中")}</span>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {t("nothing goes out without a named approval", "没有具名批准，任何内容都不会发出")}
        </span>
        <button
          type="button"
          onClick={() => setComposing(true)}
          style={{ ...solid, marginLeft: "auto" }}
        >
          {t("New post", "新建发布")}
        </button>
      </header>

      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", padding: "18px 22px 30px" }}>
          {tab === "channels" && (
            <ChannelBoard
              channels={channels}
              zh={zh}
              busy={busy}
              onToggle={(id, on) => run(() => setChannelEnabledAction(id, on))}
              onSync={() => run(() => syncChannelsAction())}
              onConnect={(platform) => {
                /* The consent screen is opened here, not on the server: a
                   redirect from a server action would take the whole tab to
                   Google, and coming back would land on a page that had lost
                   whatever was being written. */
                start(async () => {
                  const res = await connectChannelAction(platform);
                  if ("error" in res && res.error) {
                    notify(res.error);
                    return;
                  }
                  if ("url" in res && res.url) window.open(res.url, "_blank", "noopener,noreferrer");
                });
              }}
            />
          )}

          {tab === "caption" && (
            <Caption
              posts={posts}
              channels={channels}
              selected={selected}
              zh={zh}
              busy={busy}
              people={people}
              viewerId={viewerId}
              onSelect={setSelected}
              onSave={(id, input) => run(() => updatePostAction(id, input))}
              onTargets={(id, channelIds) => run(() => setTargetsAction(id, channelIds))}
              onOverride={(targetId, input) => run(() => setOverrideAction(targetId, input))}
              onOptions={(targetId, options) => run(() => setTargetOptionsAction(targetId, options))}
              onRequest={(id, approverId, note) =>
                run(() => requestApprovalAction(id, approverId, note), () => setTab("approvals"))
              }
            />
          )}

          {tab === "approvals" && (
            <Approvals
              posts={waiting}
              zh={zh}
              busy={busy}
              viewerId={viewerId}
              onApprove={(post) => setConfirming(post)}
              onReject={(id, note) => run(() => rejectAction(id, note))}
            />
          )}

          {tab === "log" && (
            <LogTable log={log} zh={zh} busy={busy} onRetry={(id) => run(() => retryTargetAction(id))} />
          )}
        </div>

        <ResearchAgentPanel
          accent={ACCENT}
          zh={zh}
          scope={t("Publishing", "发布中")}
          note={agentNote(channels, posts, waiting.length, zh)}
          placeholder={t("Ask about what is going out…", "询问即将发布的内容…")}
          model={model}
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
      </div>

      {composing && (
        <NewPostDialog
          channels={channels}
          zh={zh}
          busy={busy}
          onClose={() => setComposing(false)}
          onCreate={(input) =>
            run(
              async () => {
                const res = await createPostAction(input);
                if ("id" in res && res.id) setSelected(res.id);
                return res;
              },
              () => {
                setComposing(false);
                setTab("caption");
              },
            )
          }
        />
      )}

      {confirming && (
        <ConfirmDialog
          title={t(`Approve and publish?`, "批准并发布？")}
          body={t(
            `${confirming.title} goes to ${confirming.targets.length} channel${confirming.targets.length === 1 ? "" : "s"} as soon as the worker picks it up. Your name is recorded on the approval.`,
            `《${confirming.title}》将发往 ${confirming.targets.length} 个渠道，由后台任务立即处理。你的名字会记录在批准记录上。`,
          )}
          confirm={t("Approve and publish", "批准并发布")}
          cancel={t("Cancel", "取消")}
          onClose={() => setConfirming(null)}
          onConfirm={() => run(() => approveAction(confirming.id, ""))}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- channels */

function ChannelBoard({
  channels,
  zh,
  busy,
  onToggle,
  onSync,
  onConnect,
}: {
  channels: ChannelRow[];
  zh: boolean;
  busy: boolean;
  onToggle: (id: string, on: boolean) => void;
  onSync: () => void;
  /** Start connecting one of the studio's own accounts on this platform. */
  onConnect: (platform: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [connecting, setConnecting] = useState(false);
  const minute = useMinute();

  if (!channels.length) {
    return (
      <>
        {connecting ? (
          <ConnectChannel zh={zh} onClose={() => setConnecting(false)} onPick={onConnect} />
        ) : null}
        <Empty
          icon="share"
          title={t("No channel is connected yet", "还没有连接任何渠道")}
          body={t(
            "Connect one of your own accounts and it appears here, along with what it is allowed to do.",
            "连接你自己的账号后，它会出现在这里，并显示它被授权可以做什么。",
          )}
        >
          <button type="button" onClick={() => setConnecting(true)} style={solid}>
            {t("Add channel", "添加渠道")}
          </button>
        </Empty>
      </>
    );
  }

  /* The platforms the studio could still connect, as one-press chips under
     the board. The board used to end at the last card and leave the rest of
     the column blank; this is the next thing anybody on this tab does. */
  const connected = new Set(channels.map((c) => c.platform));
  const more = CONNECTABLE.filter((p) => !connected.has(p));
  /* Anything a card draws a note for counts: a state that is not "can
     post", a token running out, an issue or an error from the platform. */
  const attention = channels.filter(
    (c) => c.enabled && (channelHealth(c).tone !== "good" || c.tokenExpiresSoon || c.issues.length > 0 || Boolean(c.lastError)),
  ).length;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: BOARD_CSS }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{t("Channels", "渠道")}</span>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {attention
            ? t(`${channels.length} connected · ${attention} need a look`, `已连接 ${channels.length} 个 · ${attention} 个需要留意`)
            : t(`${channels.length} connected · all fine`, `已连接 ${channels.length} 个 · 都正常`)}
        </span>
        <span style={{ flexGrow: 1 }} />
        <button type="button" onClick={onSync} disabled={busy} style={ghost}>
          {busy ? t("Checking…", "检查中…") : t("Check now", "立即检查")}
        </button>
        <button type="button" onClick={() => setConnecting(true)} disabled={busy} style={solid}>
          {t("Add channel", "添加渠道")}
        </button>
      </div>

      {connecting ? (
        <ConnectChannel
          zh={zh}
          onClose={() => setConnecting(false)}
          onPick={onConnect}
        />
      ) : null}

      {/* Each card its own height: a healthy channel has two figures and a
          footer, and stretching it to its neighbour's notes left a card
          that was mostly blank. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12, alignItems: "start" }}>
        {channels.map((c) => (
          <ChannelCard key={c.id} c={c} zh={zh} busy={busy} minute={minute} onToggle={onToggle} onConnect={onConnect} />
        ))}
      </div>

      {more.length ? (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t("Also available", "还可以连接")}</span>
            <span style={{ fontSize: 11.5, color: "#999999" }}>
              {t("Sign in as the account you publish from; it opens in a new tab. Come back and press Check now.", "用要发布的账号登录，会在新标签页打开；回来后点“立即检查”。")}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {more.map((p) => (
              <button key={p} type="button" className="pub-more" disabled={busy} onClick={() => onConnect(p)}>
                <PlatformMark platform={p} size={15} />
                {platformLabel(p)}
                <Icon name="plus" size={12} color="#b3b3b3" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

const BOARD_CSS = `
.pub-more { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 10px 0 11px; border-radius: 10px; border: 1px solid #ececec; background: #fff; color: #383838; font-size: 12.5px; font-family: inherit; letter-spacing: inherit; cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease; }
.pub-more:hover { border-color: #dcdcdc; box-shadow: 0 2px 8px rgba(20,30,60,.06); }
.pub-more:disabled { opacity: .6; cursor: default; }
@media (prefers-reduced-motion: reduce) { .pub-more { transition: none; } }
`;

/* ------------------------------------------------------- channel health */

/** Tints for a channel's state, the same soft set the rest of the app uses. */
const TONES = {
  good: { bg: "#e7f6ee", fg: "#1e7a4f", line: "#cbe9d8" },
  warn: { bg: "#fff4df", fg: "#95590a", line: "#f4ddb0" },
  bad: { bg: "#fdecec", fg: "#c43c3c", line: "#f6cfcf" },
  quiet: { bg: "#f3f3f1", fg: "#5f5f5f", line: "#e6e6e3" },
} as const;

type Tone = keyof typeof TONES;

/** The pill in a card's corner: can it post, in one word. */
function channelHealth(c: ChannelRow): { tone: Tone; en: string; zh: string } {
  if (!c.enabled) return { tone: "quiet", en: "switched off", zh: "已停用" };
  if (c.needsReconnect) return { tone: "bad", en: "needs reconnecting", zh: "需重新连接" };
  if (c.status === "error") return { tone: "bad", en: "connection error", zh: "连接出错" };
  if (c.canPost) return { tone: "good", en: "can post", zh: "可发布" };
  return { tone: "quiet", en: "read only", zh: "只读" };
}

/**
 * What a platform's error means for the person looking at the card.
 *
 * `lastError` is the platform's own sentence, kept intact on purpose — the
 * log and the tooltip still show it word for word — but a red "Rate limit
 * exceeded. Please retry after 1 seconds." on the board read as a broken
 * channel when it is a pause the next round gets past. So the card says what
 * it means and what to do, and the raw text is one hover away.
 */
function describeError(raw: string): { tone: Tone; en: string; zh: string; reconnect: boolean } {
  const s = raw.toLowerCase();
  if (/rate.?limit|too many requests|\b429\b|retry after|throttl/.test(s)) {
    return { tone: "warn", zh: "平台暂时限流，稍后会自动重试", en: "The platform is rate-limiting; it retries on its own shortly", reconnect: false };
  }
  if (/quota/.test(s)) {
    return { tone: "warn", zh: "平台今天的调用额度用完了，额度恢复后会自动继续", en: "Today's platform quota is used up; it carries on when it resets", reconnect: false };
  }
  if (/invalid_grant|expired|revoked|unauthori[sz]ed|\b401\b|re-?auth|reconnect|invalid (access )?token/.test(s)) {
    return { tone: "bad", zh: "授权已过期，需要重新连接", en: "The sign-in has expired; reconnect the account", reconnect: true };
  }
  if (/forbidden|\b403\b|permission|scope|insufficient/.test(s)) {
    return { tone: "bad", zh: "账号权限不足，需要重新授权", en: "The account lacks a permission; authorise it again", reconnect: true };
  }
  if (/timeout|timed out|etimedout|econnreset|enotfound|network|fetch failed|\b50[0-4]\b|unavailable|bad gateway/.test(s)) {
    return { tone: "warn", zh: "平台暂时连不上，稍后会自动重试", en: "The platform could not be reached; it tries again shortly", reconnect: false };
  }
  return { tone: "bad", zh: "连接出错（悬停查看平台原话）", en: "Connection error (hover for the platform's words)", reconnect: false };
}

/**
 * When a token runs out, in words.
 *
 * Before the browser has a clock (the server's HTML, and hydration) it is the
 * date and time; afterwards "today at 03:20", "in 3 days" or "expired".
 * `tokenExpiresSoon` is the server's reading (within seven days) and decides
 * the colour either way, so the card never changes colour on hydration.
 */
function tokenWords(at: Date, minute: number | null, zh: boolean): string {
  const ms = at.getTime();
  const stamp = `${hkDate(ms, zh)} ${hkTime(ms)}`;
  if (minute === null) return zh ? `授权将于 ${stamp} 到期` : `Sign-in expires ${stamp}`;
  const now = minute * 60_000;
  if (ms <= now) return zh ? `授权已于 ${stamp} 到期` : `Sign-in expired ${stamp}`;
  const days = hkDay(ms) - hkDay(now);
  if (days === 0) return zh ? `授权今天 ${hkTime(ms)} 到期` : `Sign-in expires today at ${hkTime(ms)}`;
  if (days === 1) return zh ? `授权明天 ${hkTime(ms)} 到期` : `Sign-in expires tomorrow at ${hkTime(ms)}`;
  return zh ? `授权 ${days} 天后到期（${hkDate(ms, zh)}）` : `Sign-in expires in ${days} days (${hkDate(ms, zh)})`;
}

function ChannelCard({
  c,
  zh,
  busy,
  minute,
  onToggle,
  onConnect,
}: {
  c: ChannelRow;
  zh: boolean;
  busy: boolean;
  minute: number | null;
  onToggle: (id: string, on: boolean) => void;
  onConnect: (platform: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const health = channelHealth(c);
  const pill = TONES[health.tone];
  const error = c.lastError ? describeError(c.lastError) : null;
  const expiring = Boolean(c.tokenExpiresAt && c.tokenExpiresSoon);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: "1px solid #ececec",
        borderRadius: 12,
        padding: "14px 14px 12px",
        background: c.enabled ? "#fff" : "#fafafa",
        opacity: c.enabled ? 1 : 0.72,
        boxShadow: "0 1px 2px rgba(0,0,0,.03)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        {/* The channel's own picture, with the platform's mark on the
            corner: the picture says which account, the logo which platform. */}
        <span style={{ position: "relative", flexShrink: 0, width: 36, height: 36 }}>
          {c.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.avatarUrl}
              alt=""
              style={{ width: 36, height: 36, borderRadius: 10, objectFit: "cover", display: "block", background: "#f3f3f3" }}
            />
          ) : (
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "#f3f3f1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <PlatformMark platform={c.platform} size={17} />
            </span>
          )}
          {c.avatarUrl ? (
            <span
              style={{
                position: "absolute",
                right: -4,
                bottom: -4,
                width: 18,
                height: 18,
                borderRadius: 6,
                background: "#fff",
                boxShadow: "0 0 0 1.5px #fff, 0 1px 2px rgba(0,0,0,.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <PlatformMark platform={c.platform} size={12} />
            </span>
          ) : null}
        </span>
        <span style={{ minWidth: 0, flexGrow: 1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.displayName ?? c.username ?? c.platform}
          </span>
          <span style={{ fontSize: 11.5, color: "#999999", display: "flex", alignItems: "center", gap: 5, minWidth: 0, marginTop: 1 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {platformLabel(c.platform)}
              {c.username ? ` · ${c.username}` : ""}
            </span>
            {c.profileUrl ? (
              <a
                href={c.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={t("Open the profile", "打开主页")}
                aria-label={t("Open the profile", "打开主页")}
                style={{ display: "inline-flex", color: "#b3b3b3", flexShrink: 0 }}
              >
                <Icon name="external" size={11} />
              </a>
            ) : null}
          </span>
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            flexShrink: 0,
            alignSelf: "flex-start",
            padding: "2px 9px 2px 7px",
            borderRadius: 999,
            background: pill.bg,
            color: pill.fg,
            fontSize: 11,
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 3, background: pill.fg, opacity: 0.7 }} />
          {zh ? health.zh : health.en}
        </span>
      </div>

      {/* Two small figures rather than a row of grey pills. */}
      <div style={{ display: "flex", gap: 22, marginTop: 14 }}>
        <Figure label={t("Followers", "粉丝")} value={countWord(c.followers, zh)} />
        {c.tokenExpiresAt ? (
          <Figure
            label={t("Sign-in valid to", "授权有效至")}
            value={hkDate(c.tokenExpiresAt.getTime(), zh)}
            tone={expiring ? "warn" : undefined}
          />
        ) : null}
      </div>

      {expiring && c.tokenExpiresAt ? (
        <Notice
          tone="warn"
          glyph="clock"
          title={tokenWords(c.tokenExpiresAt, minute, zh)}
          detail={t("It may stop posting once it runs out.", "到期后可能无法发布")}
          action={
            <NoticeAction onClick={() => onConnect(c.platform)} disabled={busy} tone="warn">
              {t("Re-authorise", "重新授权")}
            </NoticeAction>
          }
        />
      ) : null}

      {c.needsReconnect && !error?.reconnect ? (
        <Notice
          tone="bad"
          glyph="alert"
          title={t("This account has to be reconnected before it can post.", "这个账号需要重新连接才能发布。")}
          action={
            <NoticeAction onClick={() => onConnect(c.platform)} disabled={busy} tone="bad">
              {t("Reconnect", "重新连接")}
            </NoticeAction>
          }
        />
      ) : null}

      {c.issues.length > 0 ? <Notice tone="warn" glyph="alert" title={c.issues.join(" · ")} /> : null}

      {error && c.lastError ? (
        <Notice
          tone={error.tone}
          glyph="alert"
          title={zh ? error.zh : error.en}
          raw={c.lastError}
          action={
            error.reconnect ? (
              <NoticeAction onClick={() => onConnect(c.platform)} disabled={busy} tone={error.tone}>
                {t("Reconnect", "重新连接")}
              </NoticeAction>
            ) : null
          }
        />
      ) : null}

      {/* The footer sits on the card's floor, so two cards side by side end
          on the same line whatever is written in them. */}
      <div style={{ flexGrow: 1, minHeight: 14 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 10, borderTop: "1px solid #f3f3f1" }}>
        <span style={{ fontSize: 11, color: "#a3a3a3", flexGrow: 1, minWidth: 0 }}>
          {c.syncedAt ? `${t("Checked", "检查于")} ${checkedWords(c.syncedAt.getTime(), minute, zh)}` : t("Never checked", "尚未检查")}
        </span>
        <button type="button" onClick={() => onToggle(c.id, !c.enabled)} disabled={busy} style={{ ...ghost, height: 28 }}>
          {c.enabled ? t("Switch off", "停用") : t("Switch on", "启用")}
        </button>
      </div>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: "#a3a3a3" }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: tone ? TONES[tone].fg : "#171717", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  );
}

/**
 * A soft tinted note inside a card: amber for "keep an eye on it", rose for
 * "this needs you". `raw`, when given, is the platform's own sentence, put in
 * the tooltip rather than on the card.
 */
function Notice({
  tone,
  glyph,
  title,
  detail,
  raw,
  action,
}: {
  tone: Tone;
  glyph: "clock" | "alert";
  title: string;
  detail?: string;
  raw?: string;
  action?: React.ReactNode;
}) {
  const c = TONES[tone];
  return (
    <div
      title={raw}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        marginTop: 12,
        padding: "8px 8px 8px 10px",
        borderRadius: 9,
        background: c.bg,
        border: `1px solid ${c.line}`,
        color: c.fg,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.5,
        cursor: raw ? "help" : undefined,
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
        {glyph === "clock" ? (
          <>
            <circle cx="12" cy="12" r="8.2" />
            <path d="M12 7.8V12l2.8 1.7" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="8.2" />
            <path d="M12 7.8v5M12 16.2v.1" />
          </>
        )}
      </svg>
      <span style={{ minWidth: 0, flexGrow: 1 }}>
        {title}
        {detail ? <span style={{ display: "block", fontWeight: 400, opacity: 0.8, marginTop: 1 }}>{detail}</span> : null}
      </span>
      {action}
    </div>
  );
}

function NoticeAction({ onClick, disabled, tone, children }: { onClick: () => void; disabled: boolean; tone: Tone; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flexShrink: 0,
        alignSelf: "center",
        height: 26,
        padding: "0 10px",
        borderRadius: 7,
        border: `1px solid ${TONES[tone].line}`,
        background: "#fff",
        color: TONES[tone].fg,
        fontSize: 11.5,
        fontWeight: 600,
        fontFamily: "inherit",
        letterSpacing: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- caption */

/**
 * Which platform to connect.
 *
 * Only the picking happens here. The consent screen belongs to the platform,
 * and what comes back is read from the platform by "Check now" — nothing about
 * a channel is typed in by hand, which is why there is no form.
 */
/**
 * What this platform would refuse, counted as you type.
 *
 * Shown per channel rather than once for the post, because the limits differ
 * by an order of magnitude — the same caption is comfortable on LinkedIn and
 * four times over on X — and because each channel can override the wording.
 */
function PlatformLimits({
  platform,
  title,
  body,
  tags,
  zh,
}: {
  platform: string;
  title: string | null;
  body: string;
  tags: string[];
  zh: boolean;
}) {
  const spec = specFor(platform);
  if (!spec) return null;

  const issues = checkForPlatform(platform, { title, body, tags });
  const used = body.length;
  const share = Math.min(1, used / spec.bodyMax);

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flexGrow: 1, height: 3, borderRadius: 2, background: "#f3f3f3", overflow: "hidden" }}>
          <div
            style={{
              width: `${share * 100}%`,
              height: 3,
              background: used > spec.bodyMax ? "#e03636" : share > 0.85 ? "#db7706" : "#c7c7c7",
            }}
          />
        </div>
        <span
          style={{
            fontSize: 10.5,
            fontVariantNumeric: "tabular-nums",
            color: used > spec.bodyMax ? "#e03636" : "#999999",
          }}
        >
          {used.toLocaleString()} / {spec.bodyMax.toLocaleString()}
        </span>
      </div>

      {issues.map((issue, i) => (
        <p
          key={i}
          style={{
            fontSize: 11,
            lineHeight: 1.5,
            margin: "6px 0 0",
            color: issue.level === "error" ? "#e03636" : "#a35f00",
          }}
        >
          {zh ? issue.textZh : issue.text}
        </p>
      ))}
    </div>
  );
}

/**
 * The extras a platform asks for.
 *
 * Drawn from the platform's own spec rather than hard-coded per channel, so a
 * platform that gains a field gains a control. Saved on change rather than on
 * a Save button: these are single choices, and a dropdown that needs
 * confirming is a dropdown people forget to confirm.
 */
function PlatformExtras({
  platform,
  options,
  disabled,
  zh,
  onChange,
}: {
  platform: string;
  options: Record<string, unknown>;
  disabled: boolean;
  zh: boolean;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const spec = specFor(platform);
  if (!spec || spec.fields.length === 0) return null;

  const set = (key: string, value: unknown) => onChange({ ...options, [key]: value });

  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: "1px solid #f3f3f3",
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      {spec.fields.map((f) => {
        const label = zh ? f.labelZh : f.label;
        const note = zh ? f.noteZh : f.note;

        if (f.kind === "toggle") {
          return (
            <label
              key={f.key}
              title={note}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#525252" }}
            >
              <input
                type="checkbox"
                disabled={disabled}
                checked={options[f.key] === true}
                onChange={(e) => set(f.key, e.target.checked)}
              />
              {label}
            </label>
          );
        }

        if (f.kind === "select") {
          return (
            <label key={f.key} style={{ fontSize: 11, color: "#999999" }} title={note}>
              <span style={{ display: "block", marginBottom: 3 }}>{label}</span>
              <select
                disabled={disabled}
                value={String(options[f.key] ?? f.options?.[0]?.value ?? "")}
                onChange={(e) => set(f.key, e.target.value)}
                style={{ ...field, height: 28, width: 180 }}
              >
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {zh ? o.labelZh : o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        return (
          <label key={f.key} style={{ fontSize: 11, color: "#999999", flexGrow: 1, minWidth: 220 }} title={note}>
            <span style={{ display: "block", marginBottom: 3 }}>{label}</span>
            <input
              disabled={disabled}
              defaultValue={String(options[f.key] ?? "")}
              placeholder={f.placeholder}
              maxLength={f.max}
              onBlur={(e) => {
                if (String(options[f.key] ?? "") !== e.target.value) set(f.key, e.target.value);
              }}
              style={{ ...field, height: 28, width: "100%" }}
            />
          </label>
        );
      })}
    </div>
  );
}

function ConnectChannel({
  zh,
  onClose,
  onPick,
}: {
  zh: boolean;
  onClose: () => void;
  onPick: (platform: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Add a channel", "添加渠道")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: "rgba(23,23,23,0.28)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "13vh",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: "calc(100vw - 32px)",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #ededed",
          boxShadow: "0 24px 60px rgba(23,23,23,0.22)",
          padding: 18,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Add a channel", "添加渠道")}</div>
        <p style={{ fontSize: 11.5, color: "#7c7c7c", lineHeight: 1.6, margin: "7px 0 14px" }}>
          {t(
            "Pick a platform and sign in as the account you want to publish from. It opens in a new tab; come back and press Check now.",
            "选择平台并用要发布的账号登录。会在新标签页打开；回来后点“立即检查”。",
          )}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {CONNECTABLE.map((platform) => (
            <button
              key={platform}
              type="button"
              onClick={() => {
                onPick(platform);
                onClose();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                height: 40,
                padding: "0 12px",
                borderRadius: 10,
                border: "1px solid #ededed",
                background: "#fff",
                cursor: "pointer",
                fontSize: 12.5,
                fontFamily: "inherit",
                letterSpacing: "inherit",
                color: "#171717",
                textAlign: "left",
              }}
            >
              <PlatformMark platform={platform} size={17} />
              {platformLabel(platform)}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 15 }}>
          <button type="button" onClick={onClose} style={ghost}>
            {t("Cancel", "取消")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Caption({
  posts,
  channels,
  selected,
  zh,
  busy,
  people,
  viewerId,
  onSelect,
  onSave,
  onTargets,
  onOverride,
  onOptions,
  onRequest,
}: {
  posts: PostRow[];
  channels: ChannelRow[];
  selected: PostRow | null;
  zh: boolean;
  busy: boolean;
  people: { id: string; name: string }[];
  viewerId: string;
  onSelect: (id: string) => void;
  onSave: (id: string, input: { title?: string; body?: string; scheduledFor?: string | null }) => void;
  onTargets: (id: string, channelIds: string[]) => void;
  onOverride: (targetId: string, input: { title?: string | null; body?: string | null }) => void;
  /** Per-platform extras, stored on the target and sent with the post. */
  onOptions: (targetId: string, options: Record<string, unknown>) => void;
  onRequest: (id: string, approverId: string | null, note: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [approver, setApprover] = useState<string | null>(null);

  if (!posts.length) {
    return (
      <Empty
        icon="pen"
        title={t("Nothing is being written", "还没有待发布的内容")}
        body={t(
          "New post starts one: a master caption, and the channels it goes to.",
          "点击“新建发布”开始：写一份主文案，并选择投放渠道。",
        )}
      />
    );
  }

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
      <div style={{ width: 232, flexShrink: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        {posts.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            style={{
              textAlign: "left",
              border: 0,
              borderRadius: 9,
              padding: "9px 10px",
              cursor: "pointer",
              background: selected?.id === p.id ? "#f3f3f3" : "transparent",
              fontFamily: "inherit",
              letterSpacing: "inherit",
              color: "#171717",
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 500, display: "block" }}>{p.title}</span>
            <span style={{ fontSize: 11, color: "#999999", display: "block", marginTop: 2 }}>
              <StateWord state={p.state} zh={zh} /> · {p.targets.length} {t("channels", "个渠道")}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <input
            key={`${selected.id}-title`}
            defaultValue={selected.title}
            onBlur={(e) =>
              e.target.value.trim() !== selected.title && onSave(selected.id, { title: e.target.value })
            }
            style={{
              width: "100%",
              border: 0,
              outline: "none",
              fontSize: 19,
              fontWeight: 600,
              fontFamily: "inherit",
              color: "#171717",
              padding: 0,
            }}
          />
          <p style={{ fontSize: 11.5, color: "#999999", margin: "6px 0 14px" }}>
            {t("The master caption. A channel that overrides nothing uses this.", "主文案。未单独覆写的渠道使用它。")}
          </p>

          <textarea
            key={`${selected.id}-body`}
            defaultValue={selected.body}
            onBlur={(e) => e.target.value !== selected.body && onSave(selected.id, { body: e.target.value })}
            placeholder={t("Write the caption…", "写下文案…")}
            style={{ ...field, minHeight: 150, resize: "vertical", lineHeight: 1.65, padding: "11px 13px" }}
          />

          <div className="lbl" style={{ padding: 0, margin: "20px 0 8px" }}>
            {t("Channels", "渠道")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {channels.map((c) => {
              const on = selected.targets.some((x) => x.channelId === c.id);
              const sent = selected.targets.find((x) => x.channelId === c.id)?.state === "published";
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy || sent || !c.enabled}
                  onClick={() =>
                    onTargets(
                      selected.id,
                      on
                        ? selected.targets.filter((x) => x.channelId !== c.id).map((x) => x.channelId)
                        : [...selected.targets.map((x) => x.channelId), c.id],
                    )
                  }
                  style={{
                    ...chip,
                    background: on ? "#171717" : "#fff",
                    color: on ? "#fff" : "#525252",
                    borderColor: on ? "#171717" : "#ededed",
                    opacity: c.enabled ? 1 : 0.5,
                  }}
                >
                  <PlatformMark platform={c.platform} size={12} mono={on} />
                  {c.displayName ?? c.username ?? c.platform}
                  {sent ? ` · ${t("sent", "已发送")}` : ""}
                </button>
              );
            })}
          </div>

          {selected.targets.length > 0 && (
            <>
              <div className="lbl" style={{ padding: 0, margin: "20px 0 8px" }}>
                {t("Per-channel wording", "各渠道文案")}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {selected.targets.map((tg) => (
                  <div key={tg.id} style={{ border: "1px solid #ededed", borderRadius: 10, padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <PlatformMark platform={tg.platform} size={13} />
                      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{tg.channelName}</span>
                      <span style={{ fontSize: 11, color: "#999999" }}>{platformLabel(tg.platform)}</span>
                      <Badge
                        tone={tg.state === "published" ? "good" : tg.state === "failed" ? "bad" : "quiet"}
                        text={<StateWord state={tg.state} zh={zh} />}
                      />
                      {tg.body !== null && (
                        <button
                          type="button"
                          onClick={() => onOverride(tg.id, { body: null, title: null })}
                          disabled={busy}
                          style={{ ...ghost, marginLeft: "auto", height: 24, fontSize: 11 }}
                        >
                          {t("Follow master", "跟随主文案")}
                        </button>
                      )}
                    </div>
                    <textarea
                      key={`${tg.id}-body`}
                      defaultValue={tg.body ?? ""}
                      disabled={tg.state === "published"}
                      placeholder={t("Follows the master. Type to override.", "默认跟随主文案。输入内容即为覆写。")}
                      onBlur={(e) => {
                        const next = e.target.value;
                        if ((tg.body ?? "") === next) return;
                        onOverride(tg.id, { body: next.trim() ? next : null });
                      }}
                      style={{ ...field, minHeight: 66, resize: "vertical", lineHeight: 1.6, padding: "9px 11px" }}
                    />
                    {/* What this platform would refuse, said while it can
                        still be fixed rather than after a person's name is on
                        an approval. */}
                    <PlatformLimits
                      platform={tg.platform}
                      title={tg.title ?? selected.title}
                      body={tg.body ?? selected.body}
                      tags={selected.tags}
                      zh={zh}
                    />

                    {/* The extras this platform asks for: YouTube's category,
                        Instagram's first comment, LinkedIn's visibility. */}
                    <PlatformExtras
                      platform={tg.platform}
                      options={tg.options ?? {}}
                      disabled={busy || tg.state === "published"}
                      zh={zh}
                      onChange={(next) => onOptions(tg.id, next)}
                    />

                    {tg.error && (
                      <p style={{ fontSize: 11.5, color: "#e03636", margin: "7px 0 0", lineHeight: 1.5 }}>
                        {tg.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="lbl" style={{ padding: 0, margin: "22px 0 8px" }}>
            {t("When", "时间")}
          </div>
          <input
            key={`${selected.id}-when`}
            type="datetime-local"
            defaultValue={selected.scheduledFor ? toLocalInput(selected.scheduledFor) : ""}
            onBlur={(e) => onSave(selected.id, { scheduledFor: e.target.value || null })}
            style={{ ...field, width: 230 }}
          />
          <p style={{ fontSize: 11, color: "#999999", margin: "6px 0 0" }}>
            {t("Leave it empty to go out as soon as it is approved.", "留空表示批准后立即发布。")}
          </p>

          {(selected.state === "draft" || selected.state === "failed") && (
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 22 }}>
              <select
                value={approver ?? ""}
                onChange={(e) => setApprover(e.target.value || null)}
                style={{ ...field, width: 200, height: 32 }}
              >
                <option value="">{t("Anyone who can approve", "任何有权批准的人")}</option>
                {people
                  .filter((p) => p.id !== viewerId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={busy || selected.targets.length === 0}
                onClick={() => onRequest(selected.id, approver, "")}
                style={{ ...solid, opacity: busy || !selected.targets.length ? 0.45 : 1 }}
              >
                {t("Send for approval", "提交审批")}
              </button>
              {selected.targets.length === 0 && (
                <span style={{ fontSize: 11.5, color: "#999999" }}>
                  {t("Choose a channel first.", "请先选择渠道。")}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ approvals */

function Approvals({
  posts,
  zh,
  busy,
  viewerId,
  onApprove,
  onReject,
}: {
  posts: PostRow[];
  zh: boolean;
  busy: boolean;
  viewerId: string;
  onApprove: (post: PostRow) => void;
  onReject: (id: string, note: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [notes, setNotes] = useState<Record<string, string>>({});

  if (!posts.length) {
    return (
      <Empty
        icon="check"
        title={t("Nothing is waiting", "没有待审批的内容")}
        body={t(
          "Posts appear here when somebody sends them for approval.",
          "有人提交审批后，内容会出现在这里。",
        )}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
      {posts.map((p) => {
        /*
         * The person who asked cannot be the person who approves. The spec
         * wants an approval record naming somebody; a record naming the author
         * is a rubber stamp with extra steps. The server refuses it too.
         */
        const askedByMe = p.approval?.requestedById === viewerId;

        return (
          <div key={p.id} style={{ border: "1px solid #ededed", borderRadius: 11, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{p.title}</span>
              <span style={{ fontSize: 11.5, color: "#999999" }}>
                {p.targets.map((x) => x.channelName).join(", ")}
              </span>
              {p.scheduledFor && (
                <Badge tone="quiet" text={`${t("scheduled", "定时")} ${hkStamp(p.scheduledFor)}`} />
              )}
            </div>

            <p
              style={{
                fontSize: 12.5,
                color: "#383838",
                lineHeight: 1.6,
                margin: "10px 0 0",
                whiteSpace: "pre-wrap",
              }}
            >
              {p.body || t("No caption written.", "尚未写文案。")}
            </p>

            <p style={{ fontSize: 11, color: "#999999", margin: "10px 0 0" }}>
              {t("Asked by", "提交人")} {p.approval?.requestedByName ?? p.ownerName ?? "—"}
              {p.approval?.approverName ? ` · ${t("for", "指定")} ${p.approval.approverName}` : ""}
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 13 }}>
              <input
                value={notes[p.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                placeholder={t("A note, if you want one on the record", "可留言，会记录在案")}
                style={{ ...field, flexGrow: 1, height: 32 }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => onReject(p.id, notes[p.id] ?? "")}
                style={ghost}
              >
                {t("Send back", "退回")}
              </button>
              <button
                type="button"
                disabled={busy || askedByMe}
                onClick={() => onApprove(p)}
                title={askedByMe ? t("You asked for this one, so somebody else has to approve it", "这是你提交的，需要由他人批准") : undefined}
                style={{ ...solid, opacity: busy || askedByMe ? 0.45 : 1 }}
              >
                {t("Approve and publish", "批准并发布")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ log */

function LogTable({
  log,
  zh,
  busy,
  onRetry,
}: {
  log: LogRow[];
  zh: boolean;
  busy: boolean;
  onRetry: (targetId: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);

  if (!log.length) {
    /* An empty log is a true statement and a dead end. It now says what the
       log is *for* and what fills it, because somebody reading it has almost
       always arrived wondering whether something went out. */
    return (
        <Empty
          icon="upload"
          title={t("Nothing has been published yet", "还没有发布记录")}
          body={t(
            "Every attempt lands here — the one that worked and the three before it — with the platform's own answer kept exactly as it came back.",
            "每一次尝试都会记录在这里：成功的那次，以及之前失败的几次，并原样保留平台返回的内容。",
          )}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 12, borderTop: "1px solid #efefec" }}>
            {[
              t(
                "A post reaches this log only after someone approves it by name. That is the module's one rule.",
                "只有经人具名批准后，内容才会进入这里。这是本模块唯一的规则。",
              ),
              t(
                "The worker sends it, not the browser — so closing the tab cannot half-publish anything.",
                "发送由后台工作进程完成，而不是浏览器，所以关闭页面不会造成“发了一半”。",
              ),
              t(
                "A platform that answers late — a scheduled post, a video still transcoding — updates this log when it does.",
                "平台稍后才有结果（定时发布、视频仍在转码）时，会在有结果时回写这里。",
              ),
            ].map((line) => (
              <p key={line} style={{ display: "flex", gap: 7, fontSize: 11.5, color: "#999999", lineHeight: 1.6, margin: 0 }}>
                <Icon name="check" size={12} color="#b8b8b4" style={{ marginTop: 3 }} />
                <span>{line}</span>
              </p>
            ))}
          </div>
        </Empty>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ ...row, borderBottom: "1px solid #ededed", color: "#999999", fontSize: 10.5, fontWeight: 500, height: 30 }}>
        <span style={{ width: 130 }}>{t("When", "时间")}</span>
        <span style={{ flexGrow: 1 }}>{t("Post", "帖子")}</span>
        <span style={{ width: 140 }}>{t("Channel", "渠道")}</span>
        <span style={{ width: 90 }}>{t("Result", "结果")}</span>
        <span style={{ width: 70 }} />
      </div>
      {log.map((l) => (
        <div key={l.id} style={{ ...row, borderBottom: "1px solid #f3f3f3", minHeight: 44, alignItems: "flex-start", paddingTop: 10 }}>
          <span style={{ width: 130, fontSize: 11.5, color: "#7c7c7c" }}>
            {hkStamp(l.at)}
          </span>
          <span style={{ flexGrow: 1, minWidth: 0 }}>
            <span
              style={{ fontSize: 12.5, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={l.postTitle}
            >
              {l.postTitle}
            </span>
            {l.error && (
              <span style={{ fontSize: 11.5, color: "#e03636", display: "block", marginTop: 3, lineHeight: 1.5 }}>
                {l.error}
              </span>
            )}
          </span>
          <span style={{ width: 140, fontSize: 11.5, color: "#7c7c7c" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <PlatformMark platform={l.platform} size={11} />
              {l.channelName}
            </span>
          </span>
          <span style={{ width: 90 }}>
            <Badge
              tone={l.state === "published" ? "good" : "bad"}
              text={l.state === "published" ? t("published", "已发布") : t("failed", "失败")}
            />
          </span>
          <span style={{ width: 70, display: "flex", justifyContent: "flex-end", gap: 6 }}>
            {l.platformUrl ? (
              <a href={l.platformUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: ACCENT }}>
                {t("open", "打开")}
              </a>
            ) : l.state === "failed" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRetry(l.id)}
                style={{ ...ghost, height: 24, fontSize: 11, padding: "0 8px" }}
              >
                {t("retry", "重试")}
              </button>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ new post */

function NewPostDialog({
  channels,
  zh,
  busy,
  onClose,
  onCreate,
}: {
  channels: ChannelRow[];
  zh: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: { title: string; body: string; channelIds: string[] }) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  return (
    <div
      onMouseDown={busy ? undefined : onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 210,
        background: "rgba(23,23,23,0.2)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "10vh",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("New post", "新建发布")}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
        style={{
          width: "min(560px, 92vw)",
          maxHeight: "78vh",
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e2e2",
          boxShadow: "0 24px 64px rgba(23,23,23,0.22)",
          overflow: "hidden",
          animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both",
        }}
      >
        <div style={{ padding: "17px 18px 0" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{t("New post", "新建发布")}</div>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("What is it called?", "标题是什么？")}
            style={{ ...field, marginTop: 12 }}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("The master caption. You can refine it per channel afterwards.", "主文案。之后可按渠道单独调整。")}
            style={{ ...field, marginTop: 8, minHeight: 110, resize: "vertical", lineHeight: 1.6, padding: "10px 12px" }}
          />
        </div>

        <div className="lbl" style={{ padding: "16px 18px 6px", margin: 0 }}>
          {t(`Channels · ${picked.length}`, `渠道 · ${picked.length}`)}
        </div>
        <div style={{ overflowY: "auto", padding: "0 18px 8px", minHeight: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {channels.length === 0 ? (
            <p style={{ fontSize: 12, color: "#999999", margin: 0, lineHeight: 1.6 }}>
              {t("No channel is connected yet.", "还没有连接任何渠道。")}
            </p>
          ) : (
            channels.map((c) => {
              const on = picked.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!c.enabled}
                  onClick={() => setPicked((cur) => (on ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}
                  style={{
                    ...chip,
                    background: on ? "#171717" : "#fff",
                    color: on ? "#fff" : "#525252",
                    borderColor: on ? "#171717" : "#ededed",
                    opacity: c.enabled ? 1 : 0.5,
                  }}
                >
                  <PlatformMark platform={c.platform} size={12} mono={on} />
                  {c.displayName ?? c.username ?? c.platform}
                </button>
              );
            })
          )}
        </div>

        <div
          style={{
            flexShrink: 0,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            padding: "12px 18px 14px",
            borderTop: "1px solid #f3f3f3",
          }}
        >
          <button type="button" onClick={onClose} disabled={busy} style={ghost}>
            {t("Cancel", "取消")}
          </button>
          <button
            type="button"
            onClick={() => onCreate({ title, body, channelIds: picked })}
            disabled={busy || !title.trim()}
            style={{ ...solid, opacity: busy || !title.trim() ? 0.45 : 1 }}
          >
            {busy ? t("Creating…", "创建中…") : t("Create", "创建")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the clock */

/**
 * The minute, in the browser only.
 *
 * "Today at 03:20" and "in 3 days" are readings of the clock, and a render
 * that reads the clock draws one thing on the server and another in the
 * browser. So the server (and hydration) get null — the cards then print
 * the date — and the browser's first render after that gets the minute,
 * refreshed twice a minute while the tab is open.
 */
const subscribeMinute = (onChange: () => void) => {
  const id = setInterval(onChange, 30_000);
  return () => clearInterval(id);
};
const readMinute = (): number | null => Math.floor(Date.now() / 60_000);
const serverMinute = (): number | null => null;

function useMinute(): number | null {
  return useSyncExternalStore(subscribeMinute, readMinute, serverMinute);
}

/** The studio's clock: Hong Kong, UTC+8, no summer time. Plain arithmetic,
 * so the server and the browser print the same thing. The card used to slice
 * `toISOString()`, which printed UTC: "检查于 19:20" for a check at 03:20. */
const HK_OFFSET = 8 * 3_600_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hkDay(ms: number): number {
  return Math.floor((ms + HK_OFFSET) / 86_400_000);
}

function hkDate(ms: number, zh: boolean): string {
  const d = new Date(ms + HK_OFFSET);
  return zh ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日` : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function hkTime(ms: number): string {
  const d = new Date(ms + HK_OFFSET);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** "2026-09-26 03:20" in the studio's clock, for the queue and the log. */
function hkStamp(date: Date): string {
  const d = new Date(date.getTime() + HK_OFFSET);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/** When a channel was last read: "今天 03:20" once the browser has a clock. */
function checkedWords(ms: number, minute: number | null, zh: boolean): string {
  if (minute !== null) {
    const days = hkDay(minute * 60_000) - hkDay(ms);
    if (days === 0) return `${zh ? "今天" : "today"} ${hkTime(ms)}`;
    if (days === 1) return `${zh ? "昨天" : "yesterday"} ${hkTime(ms)}`;
  }
  return `${hkDate(ms, zh)} ${hkTime(ms)}`;
}

/** A follower count, the same on the server and in the browser
 * (`toLocaleString` is not): 255, 1,204, 3.2万 / 32K. */
function countWord(n: number, zh: boolean): string {
  const trim = (x: number) => (Math.round(x * 10) / 10).toString();
  if (zh && n >= 10_000) return `${trim(n / 10_000)}万`;
  if (!zh && n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (!zh && n >= 10_000) return `${trim(n / 1_000)}K`;
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* ------------------------------------------------------------- fragments */

function agentNote(channels: ChannelRow[], posts: PostRow[], waiting: number, zh: boolean) {
  const live = channels.filter((c) => c.canPost && c.enabled && !c.needsReconnect).length;
  if (zh) {
    return `${live} 个渠道可发布，共 ${posts.length} 条内容，其中 ${waiting} 条等待批准。没有具名批准，任何内容都不会发出。`;
  }
  return `${live} channel${live === 1 ? "" : "s"} can post. ${posts.length} post${posts.length === 1 ? "" : "s"} here, ${waiting} waiting for approval. Nothing goes out without a named approval.`;
}

function StateWord({ state, zh }: { state: string; zh: boolean }) {
  const EN: Record<string, string> = {
    draft: "draft",
    awaiting_approval: "waiting for approval",
    approved: "approved",
    scheduled: "scheduled",
    publishing: "publishing",
    published: "published",
    failed: "failed",
    cancelled: "cancelled",
  };
  const CN: Record<string, string> = {
    draft: "草稿",
    awaiting_approval: "等待批准",
    approved: "已批准",
    scheduled: "已排期",
    publishing: "发布中",
    published: "已发布",
    failed: "失败",
    cancelled: "已取消",
  };
  return <>{(zh ? CN : EN)[state] ?? state}</>;
}

function Badge({ tone, text }: { tone: "good" | "bad" | "warn" | "quiet"; text: React.ReactNode }) {
  const palette = {
    good: { bg: "#e4faeb", fg: "#278f5e" },
    bad: { bg: "#ffe7e7", fg: "#e03636" },
    warn: { bg: "#fff3e2", fg: "#a35f00" },
    quiet: { bg: "#f3f3f3", fg: "#525252" },
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 19,
        padding: "0 7px",
        borderRadius: 10,
        background: palette.bg,
        color: palette.fg,
        fontSize: 10.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

/**
 * What a tab says when it has nothing to show.
 *
 * A soft dashed card with a line icon, the way the projects list and Files
 * say it, rather than a heading floating at the top of a blank column. The
 * next step (a button, or the log's three notes) sits inside it.
 */
function Empty({ title, body, icon, children }: { title: string; body: string; icon: IconName; children?: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 560, marginTop: 4, padding: "24px 24px 22px", border: "1px dashed #e0e0dc", borderRadius: 14, background: "#fcfcfb" }}>
      <span style={{ width: 40, height: 40, borderRadius: 11, background: "#f1f1ef", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} color="#8a8a86" />
      </span>
      <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 12 }}>{title}</div>
      <p style={{ fontSize: 12.5, color: "#8a8a8a", lineHeight: 1.65, margin: "6px 0 0" }}>{body}</p>
      {children ? <div style={{ marginTop: 14 }}>{children}</div> : null}
    </div>
  );
}

/** A `datetime-local` input wants wall-clock time with no zone on it. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "0 4px" };

const field: React.CSSProperties = {
  width: "100%",
  height: 34,
  padding: "0 11px",
  border: "1px solid #e2e2e2",
  borderRadius: 9,
  outline: "none",
  background: "#fff",
  fontSize: 12.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  color: "#171717",
};

const chip: React.CSSProperties = {
  height: 28,
  padding: "0 11px",
  // The channel chips carry a logo now, so they lay out as a row rather than
  // as a line of text with a picture jammed into it.
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 8,
  border: "1px solid #ededed",
  background: "#fff",
  color: "#525252",
  fontSize: 12,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};

const ghost: React.CSSProperties = {
  height: 30,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid #ededed",
  background: "#fff",
  color: "#525252",
  fontSize: 12,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};

const solid: React.CSSProperties = {
  height: 30,
  padding: "0 14px",
  borderRadius: 8,
  border: 0,
  background: "#171717",
  color: "#fff",
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};
