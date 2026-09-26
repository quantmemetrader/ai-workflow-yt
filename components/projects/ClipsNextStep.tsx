"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";
import { askNotifications, canAskNotifications } from "@/lib/client/live";

/**
 * The clips card's next step, once footage is in.
 *
 * The owner: "once the user uploads clips and says done, show the user it's
 * being rendered." After an upload landed the card used to say nothing
 * more — the next press (一键成片) was on another card, and nothing started
 * by itself. This is the panel the card shows once clips are in and no
 * film is being made or out yet:
 *
 *   — 素材传好了 · 开始剪, the one press (the one-go: script + clips → cut +
 *     render 9:16), loud right after an upload landed (`justLanded`);
 *   — 还要传更多, quiet, which opens the file picker again;
 *   — 传完自动开始剪, a setting kept on the project: when it is on, the cut
 *     starts a minute after the last upload lands, and the card counts that
 *     minute down with 现在开始 and 取消 beside it;
 *   — a quiet, once-only line asking whether to send a browser notification
 *     when the film is out (only while the browser has not been asked).
 *
 * The countdown is drawn from `dueAt`, which the server holds; the parent
 * refreshes when it changes (it is in the page's pulse stamp).
 */
export function ClipsNextStep({
  zh,
  clips,
  hasBeats,
  justLanded,
  retry = false,
  autoCut,
  starting,
  disabled,
  onStart,
  onMore,
  onToggleAuto,
  onStartNow,
  onCancelAuto,
}: {
  zh: boolean;
  clips: number;
  hasBeats: boolean;
  justLanded: boolean;
  /** The last cut or render stopped: the same press, worded as the retry
   *  the toast and the chip's 重试 sent the person here for. */
  retry?: boolean;
  autoCut: { on: boolean; dueAt: string | null };
  starting: boolean;
  disabled: boolean;
  onStart: () => void;
  onMore: () => void;
  onToggleAuto: (on: boolean) => void;
  onStartNow: () => void;
  onCancelAuto: () => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const armed = autoCut.dueAt !== null;
  const now = useNow(1000, armed);
  const secs = armed && now !== null ? Math.max(0, Math.ceil((new Date(autoCut.dueAt!).getTime() - now) / 1000)) : null;

  /* Whether to offer the browser's notification: asked once, quietly. The
     permission and the "asked" mark are the browser's, so they are read as
     an external store — false on the server and at hydration, the truth
     after. */
  const askable = React.useSyncExternalStore(subscribeAsked, readAskable, () => false);
  const settle = () => {
    try {
      localStorage.setItem(ASKED_KEY, "1");
    } catch {
      // Then it is asked again next time; harmless.
    }
    window.dispatchEvent(new Event(ASKED_EVENT));
  };

  return (
    <div style={{ marginTop: 10, padding: "12px 14px", borderRadius: 12, background: justLanded ? "#f1f7f3" : "#fafaf9", border: `1px solid ${justLanded ? "#cfe6d8" : "#ececea"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 220px", minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
            {/* Words that change in place go through `Tr`: under Chrome's
                translate a bare text node that changes stays frozen on its
                first translation (the countdown would sit at one number). */}
            {justLanded ? <Tr zh="素材传好了？" en="Clips uploaded?" inZh={zh} /> : retry ? <Tr zh="上次没做成，再来一次？" en="The last try stopped. Again?" inZh={zh} /> : <Tr zh={`${clips} 段素材在项目里`} en={`${clips} clips in the project`} inZh={zh} />}
          </span>
          <span style={{ display: "block", fontSize: 11.5, color: "#525252", marginTop: 2, lineHeight: 1.5 }}>
            {t("按一下就开始剪：转写 → 按脚本粗剪 → 图形 → 渲染 9:16。进度在这页、首页和项目对话里都能看到，好了会提醒你。", "One press starts the cut: transcribe → cut to the script → design → render 9:16. Progress shows here, on Home and in the project chat; you are told when it is out.")}
          </span>
        </span>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" onClick={onStart} disabled={disabled || starting} style={{ ...btn(true), height: 34, opacity: disabled || starting ? 0.6 : 1 }}>
            <Icon name="scissors" size={13} />
            {starting ? <Tr zh="开始中…" en="Starting…" inZh={zh} /> : retry && !justLanded ? <Tr zh="重试 · 重新开始剪" en="Try again · start the cut" inZh={zh} /> : <Tr zh="素材传好了 · 开始剪" en="Clips are in · start the cut" inZh={zh} />}
          </button>
          <button type="button" onClick={onMore} disabled={disabled} className="pj-quiet" style={{ ...btn(false), border: "1px solid transparent", background: "transparent", color: "#525252", height: 34 }}>
            <Icon name="upload" size={13} />
            {t("还要传更多", "Upload more")}
          </button>
        </span>
      </div>

      {hasBeats ? (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e9e9e6", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5, color: "#171717" }}>
            <input type="checkbox" checked={autoCut.on} disabled={disabled} onChange={(e) => onToggleAuto(e.target.checked)} style={{ accentColor: "#171717" }} />
            <Tr zh="传完自动开始剪" en="Start the cut when uploads finish" inZh={zh} />
          </label>
          {armed && secs !== null ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "#1f5fbf", fontVariantNumeric: "tabular-nums", flexWrap: "wrap" }}>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: "#4a90e2", animation: "auraPulse 1.4s ease-in-out infinite" }} />
              <span>{secs > 0 ? <Tr zh={`${secs} 秒后自动开始剪`} en={`Starts in ${secs}s`} inZh={zh} /> : <Tr zh="正在开始…" en="Starting…" inZh={zh} />}</span>
              <button type="button" onClick={onStartNow} disabled={disabled || starting} className="pj-quiet" style={quietBtn("#171717")}>
                {t("现在开始", "Start now")}
              </button>
              <button type="button" onClick={onCancelAuto} disabled={disabled} className="pj-quiet" style={quietBtn("#525252")}>
                {t("取消", "Cancel")}
              </button>
            </span>
          ) : (
            <span style={{ fontSize: 11.5, color: "#7c7c7c" }}>
              {t("最后一段传完 60 秒后自动开始；有片子在做时不会重复开始。", "Starts a minute after the last upload lands; never while a film is already being made.")}
            </span>
          )}
        </div>
      ) : null}

      {askable ? (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e9e9e6", display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#7c7c7c", flexWrap: "wrap" }}>
          <span style={{ minWidth: 0 }}>{t("成片出来时想收到浏览器通知？", "Want a browser notification when the film is out?")}</span>
          <button
            type="button"
            className="pj-quiet"
            style={quietBtn("#171717")}
            onClick={() => {
              void askNotifications().finally(settle);
            }}
          >
            {t("开启通知", "Turn on")}
          </button>
          <button type="button" className="pj-quiet" style={quietBtn("#7c7c7c")} onClick={settle}>
            {t("不用", "No thanks")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const ASKED_KEY = "aura:notify-asked";
const ASKED_EVENT = "aura:notify-asked";

function readAskable(): boolean {
  try {
    if (localStorage.getItem(ASKED_KEY) === "1") return false;
  } catch {
    // Private mode: ask, this once.
  }
  return canAskNotifications();
}

function subscribeAsked(onChange: () => void): () => void {
  window.addEventListener(ASKED_EVENT, onChange);
  return () => window.removeEventListener(ASKED_EVENT, onChange);
}

function btn(primary: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 13px", borderRadius: 9, border: primary ? "1px solid #171717" : "1px solid #e2e2e2", background: primary ? "#171717" : "#fff", color: primary ? "#fff" : "#171717", fontFamily: "inherit", fontSize: 12.5, fontWeight: primary ? 500 : 400, cursor: "pointer", whiteSpace: "nowrap" };
}

function quietBtn(color: string): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 8px", borderRadius: 7, border: "1px solid transparent", background: "transparent", color, fontFamily: "inherit", fontSize: 11.5, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" };
}

function useNow(ms: number, on: boolean): number | null {
  return React.useSyncExternalStore(
    (onChange) => {
      if (!on) return () => undefined;
      const id = setInterval(onChange, ms);
      return () => clearInterval(id);
    },
    () => (on ? Math.floor(Date.now() / ms) * ms : null),
    () => null,
  );
}
