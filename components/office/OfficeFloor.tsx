"use client";

import * as React from "react";
import { ART_H, ART_W, FLOW_KEYS, SUPPORT_ZONE, drawAmbient, drawClock, drawFlow, drawRoom, drawStation, seatBox, seatsFor, type LookKey } from "@/components/office/art";
import { LOOKS } from "@/components/office/looks";
import { STATUS_TONE, jobOf, nameOf, statusWord, taskLine, type OfficeMember } from "@/components/office/text";

/**
 * The office floor: every AI employee at a desk, drawn on a canvas in our own
 * pixel art (owner, 2 Oct: "like Munder Difflin, a pixel office"). The art is
 * 320x200 art pixels, scaled up with nearest-neighbour so it never blurs;
 * whole-number scales when the column allows it.
 *
 * Text never goes on the canvas: the bubbles, the tooltip and the hit areas
 * are HTML laid over it, so Chinese stays crisp and every desk is a real
 * button a keyboard can reach.
 */

const CSS = `
[data-office] .of-hit { position: absolute; border: 0; padding: 0; margin: 0; background: transparent; cursor: pointer; border-radius: 6px; }
[data-office] .of-hit:focus-visible { outline: 2px solid #3a2f3d; outline-offset: -2px; }
[data-office] .of-bub { position: absolute; transform: translate(-50%, -100%); display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; pointer-events: none;
  font-size: 11px; line-height: 15px; font-weight: 600; padding: 1px 6px; border-radius: 3px; border: 2px solid; box-shadow: 0 2px 0 rgba(58,47,61,.14); }
[data-office] .of-bub::after { content: ""; position: absolute; left: 50%; bottom: -6px; width: 4px; height: 4px; margin-left: -2px; background: var(--edge); }
[data-office] .of-bub.wait { animation: ofBob 1.2s steps(2, jump-none) infinite; }
[data-office] .of-bub .dot { width: 6px; height: 6px; background: currentColor; animation: ofBlink 1s steps(2, jump-none) infinite; }
[data-office] .of-bub .bang { display: inline-flex; align-items: center; justify-content: center; width: 12px; height: 12px; border-radius: 2px; background: #c77d0a; color: #fff; font-size: 10px; line-height: 1; }
[data-office] .of-bub.idle { font-weight: 500; opacity: .92; }
[data-office] .of-tip { position: absolute; z-index: 3; width: 220px; padding: 10px 12px; border-radius: 10px; background: #fff; border: 1px solid #e6e4df;
  box-shadow: 0 8px 24px rgba(30,25,20,.12), 0 1px 2px rgba(0,0,0,.06); pointer-events: none; }
[data-office] .of-step { position: absolute; transform: translateX(-50%); white-space: nowrap; pointer-events: none; font-size: 11px; line-height: 16px; color: #6f665a; font-weight: 600; }
[data-office] .of-step b { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; margin-right: 4px; border-radius: 3px; background: #3a2f3d; color: #fff; font-size: 10px; font-weight: 700; }
[data-office] .of-zone { position: absolute; transform: translateY(-50%); pointer-events: none; font-size: 11px; line-height: 16px; font-weight: 600; color: #5d6b7a; background: #e3eaf1; padding: 0 6px; border-radius: 3px; border: 1px solid #c7d3e0; }
[data-office] .of-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
@keyframes ofBob { 0%, 100% { transform: translate(-50%, -100%); } 50% { transform: translate(-50%, calc(-100% - 2px)); } }
@keyframes ofBlink { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { [data-office] .of-bub.wait, [data-office] .of-bub .dot { animation: none; } }
`;

/** Whole-number scales when they fill most of the column; quarter steps otherwise. */
function fitScale(width: number): number {
  const s = width / ART_W;
  if (s >= 3) return 3;
  const whole = Math.floor(s);
  if (whole >= 2 && whole * ART_W >= width * 0.9) return whole;
  return Math.max(1, Math.floor(s * 4) / 4);
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function OfficeFloor({ members, zh, selected, onPick }: { members: OfficeMember[]; zh: boolean; selected: LookKey | null; onPick: (key: LookKey) => void }) {
  const wrap = React.useRef<HTMLDivElement | null>(null);
  const canvas = React.useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = React.useState(0);
  const [hover, setHover] = React.useState<LookKey | null>(null);
  const reduced = useReducedMotion();

  const seats = React.useMemo(() => seatsFor(members.map((m) => m.key)), [members]);
  const byKey = React.useMemo(() => new Map(members.map((m) => [m.key, m])), [members]);
  const scale = width ? fitScale(width) : 2;
  const cssW = ART_W * scale;
  const cssH = ART_H * scale;

  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  /* What a frame needs, kept in a ref so the loop is not torn down every
     time the data refreshes (every 10s) or the pointer moves. */
  const live = React.useRef({ seats, byKey, hover, selected, reduced });
  const paintRef = React.useRef<(() => void) | null>(null);
  live.current = { seats, byKey, hover, selected, reduced };

  React.useEffect(() => {
    const cv = canvas.current;
    if (!cv || !width) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    const room = document.createElement("canvas");
    room.width = ART_W;
    room.height = ART_H;
    const roomCtx = room.getContext("2d");
    const scene = document.createElement("canvas");
    scene.width = ART_W;
    scene.height = ART_H;
    const sc = scene.getContext("2d");
    const out = cv.getContext("2d");
    if (!roomCtx || !sc || !out) return;
    drawRoom(roomCtx);

    let tick = 0;
    const paint = () => {
      const { seats: ss, byKey: bk, hover: hv, selected: sel, reduced: rm } = live.current;
      const motion = !rm;
      sc.drawImage(room, 0, 0);
      drawClock(sc, new Date());
      drawAmbient(sc, tick, motion);
      drawFlow(sc, ss, (k) => bk.get(k)?.status ?? "idle", tick, motion);
      ss.forEach((s, i) => {
        const m = bk.get(s.key);
        drawStation(sc, s, LOOKS[s.key], m?.status ?? "idle", { tick, seed: i * 3 + 1 }, motion, hv === s.key || sel === s.key);
      });
      out.imageSmoothingEnabled = false;
      out.clearRect(0, 0, cv.width, cv.height);
      out.drawImage(scene, 0, 0, cv.width, cv.height);
    };

    /* About 9 frames a second, nothing while the tab is hidden, and a single
       still frame when the person asked for less motion. */
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 110) return;
      last = t;
      tick++;
      paint();
    };
    const start = () => {
      cancelAnimationFrame(raf);
      paint();
      if (!live.current.reduced && document.visibilityState === "visible") raf = requestAnimationFrame(loop);
    };
    const onVis = () => (document.visibilityState === "visible" ? start() : cancelAnimationFrame(raf));
    start();
    document.addEventListener("visibilitychange", onVis);
    // With motion off there is no loop, so data and hover changes repaint here.
    const still = reduced ? window.setInterval(paint, 30_000) : 0;
    paintRef.current = paint;
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      if (still) window.clearInterval(still);
      paintRef.current = null;
    };
  }, [width, cssW, cssH, reduced]);

  // Repaint at once on a change when there is no animation loop to pick it up.
  React.useEffect(() => {
    if (!reduced) return;
    paintRef.current?.();
  }, [reduced, hover, selected, members]);

  const working = members.filter((m) => m.status === "working").length;
  const waiting = members.filter((m) => m.status === "waiting").length;
  const label = zh
    ? `像素办公室：${members.length} 位同事，${working} 位工作中，${waiting} 位等你`
    : `Pixel office: ${members.length} colleagues, ${working} working, ${waiting} waiting on you`;
  const compact = scale < 2.4;
  const tipSeat = hover ? seats.find((s) => s.key === hover) : null;
  const tipMember = hover ? byKey.get(hover) : null;

  return (
    <div data-office="" ref={wrap} style={{ position: "relative", width: "100%" }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div style={{ position: "relative", width: cssW, height: cssH, margin: "0 auto" }} onMouseLeave={() => setHover(null)}>
        <canvas ref={canvas} role="img" aria-label={label} style={{ width: cssW, height: cssH, display: "block", imageRendering: "pixelated", borderRadius: 8 }} />

        {seats.map((s) => {
          const m = byKey.get(s.key);
          const status = m?.status ?? "idle";
          const tone = STATUS_TONE[status];
          const b = seatBox(s);
          const name = nameOf(s.key, zh);
          return (
            <React.Fragment key={s.key}>
              <span
                aria-hidden
                className={`of-bub ${status === "waiting" ? "wait" : status === "idle" ? "idle" : ""}`}
                style={{ left: b.headX * scale, top: b.headY * scale - 3, color: tone.ink, background: status === "idle" ? "#fbfaf8" : tone.bg, borderColor: tone.edge, ["--edge" as string]: tone.edge }}
              >
                {status === "waiting" ? <span className="bang">!</span> : status === "working" ? <span className="dot" /> : null}
                {compact ? null : <span style={{ color: "#3a2f3d" }}>{name}</span>}
                {compact ? null : <span style={{ opacity: 0.5 }}>·</span>}
                <span>{statusWord(status, zh)}</span>
              </span>
              <button
                type="button"
                className="of-hit"
                aria-label={zh ? `${name}，${statusWord(status, zh)}。${m ? taskLine(m, zh) : ""}。在右边给${name}派活` : `${name}, ${statusWord(status, zh)}. ${m ? taskLine(m, zh) : ""}. Message them on the right`}
                aria-pressed={selected === s.key}
                onMouseEnter={() => setHover(s.key)}
                onFocus={() => setHover(s.key)}
                onBlur={() => setHover((h) => (h === s.key ? null : h))}
                onClick={() => onPick(s.key)}
                style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale }}
              />
            </React.Fragment>
          );
        })}

        {seats
          .filter((s) => FLOW_KEYS.includes(s.key))
          .map((s) => {
            const i = FLOW_KEYS.indexOf(s.key);
            return compact && scale < 1.6 ? null : (
              <span key={`step-${s.key}`} className="of-step" aria-hidden style={{ left: s.cx * scale, top: (s.dy + 19) * scale + 2 }}>
                <b>{i + 1}</b>
                {stepWord(s.key, zh)}
              </span>
            );
          })}
        {seats.some((s) => !FLOW_KEYS.includes(s.key)) ? (
          <span className="of-zone" aria-hidden style={{ left: (SUPPORT_ZONE.x + 6) * scale, top: (SUPPORT_ZONE.y + SUPPORT_ZONE.h) * scale }}>
            {zh ? "随叫随到" : "On call"}
          </span>
        ) : null}

        {tipSeat && tipMember ? <Tip member={tipMember} zh={zh} x={tipSeat.cx * scale} top={(tipSeat.dy - 30) * scale} bottom={(tipSeat.dy + 20) * scale} areaW={cssW} areaH={cssH} /> : null}
      </div>

      <ul className="of-sr">
        {members.map((m) => (
          <li key={m.key}>
            {nameOf(m.key, zh)}：{statusWord(m.status, zh)}。{taskLine(m, zh)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What each desk on the line does, in the order the work goes. */
function stepWord(key: LookKey, zh: boolean): string {
  const words: Partial<Record<LookKey, [string, string]>> = {
    research: ["找选题", "Find topics"],
    planning: ["定计划", "Plan the day"],
    script: ["写脚本", "Write the script"],
    video: ["剪视频", "Cut the video"],
    article: ["写文案发布", "Copy and publish"],
  };
  const w = words[key];
  return w ? (zh ? w[0] : w[1]) : "";
}

function Tip({ member, zh, x, top, bottom, areaW, areaH }: { member: OfficeMember; zh: boolean; x: number; top: number; bottom: number; areaW: number; areaH: number }) {
  const tone = STATUS_TONE[member.status];
  const w = 220;
  const left = Math.max(4, Math.min(areaW - w - 4, x - w / 2));
  // Under the desk, unless that runs off the floor; then over the head.
  const style: React.CSSProperties = bottom + 120 < areaH ? { left, top: bottom + 4 } : { left, bottom: areaH - top + 4 };
  return (
    <div className="of-tip" role="tooltip" style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#171717" }}>{nameOf(member.key, zh)}</span>
        <span style={{ fontSize: 11, fontWeight: 500, color: tone.ink, background: tone.bg, borderRadius: 999, padding: "0 7px", lineHeight: "18px" }}>{statusWord(member.status, zh)}</span>
      </div>
      <div style={{ fontSize: 12, color: "#8a8a8a", marginTop: 3, lineHeight: 1.5 }}>{jobOf(member.key, zh)}</div>
      <div style={{ fontSize: 12.5, color: "#3f3f3f", marginTop: 6, lineHeight: 1.55, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{taskLine(member, zh)}</div>
      <div style={{ fontSize: 11.5, color: "#a3a3a3", marginTop: 6 }}>{zh ? "点一下派任务；聊天、训练在下面的卡片上" : "Click to assign; chat and train on the card below"}</div>
    </div>
  );
}
