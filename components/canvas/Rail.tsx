"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { arrangeRail, type RailLayout } from "@/lib/nav-layout";
import { saveRailLayoutAction } from "@/app/(app)/rail-actions";
import { notify } from "@/lib/client/notify";
import { PhoneDock } from "@/components/shell/PhoneDock";
import { RailAccount, type RailAccountInfo } from "@/components/shell/RailAccount";
import { LangToggle } from "@/components/shell/ThemeToggle";
import { BrandMark } from "@/components/brand/BrandMark";
import { useLocalPreference } from "@/lib/client/preference";
import { useResizable } from "@/components/ui/Resizer";
import { RAIL_BACK, RAIL_MAIN, railActive, type RailItem } from "@/lib/nav";
import type { Module } from "@/lib/db/schema";
import { Tr, TR_EN } from "@/components/ui/Tr";

/**
 * The module rail.
 *
 * It began as the artboards' 52px column of icons and nothing else, and the
 * client's answer to that was plain: *"the left hand side, better to have the
 * words next to the icons"*. An icon is a reminder of a name you already know;
 * it is not a way to learn one. So the rail is now a named list, open by
 * default, and 腾亚 is written next to its mark at the top rather than being a
 * tile you hover to identify.
 *
 * Collapsing back to the icons is kept, and the width is draggable in between
 * like every other column here. Both are remembered in this browser.
 *
 * Seven entries since 28 Sep (`RAIL_MAIN`: 首页 · 视频 · 选题 · 数据 · 文件 ·
 * 消息 · AI 员工), with the back office folded under 后台 for owners and
 * admins (`RAIL_BACK`) — the studio found eighteen entries and a project
 * tree too much to find their way in.
 * The hover tooltip only exists while it is collapsed — a label beside a label
 * is noise.
 */
const WIDTH_KEY = "rail";
const RAIL_MIN = 148;
const RAIL_MAX = 268;
const RAIL_DEFAULT = 186;
const COLLAPSED = 52;

type Zone = "main" | "more" | "back";
type Arranged = { main: RailItem[]; more: RailItem[]; back: RailItem[] };

export function Rail({ modules, locale, account, isAdmin = false, layout: savedLayout = null }: { modules: Module[]; locale: string; account?: RailAccountInfo; /** Owner or admin: sees the folded 后台 group. */ isAdmin?: boolean; /** This person's own order and pins (`lib/nav-layout.ts`). */ layout?: RailLayout | null }) {
  const pathname = usePathname();
  const zh = locale.startsWith("zh");
  const [state, setState] = useLocalPreference("aura:rail", ["open", "icons"] as const, "open");
  /* On a phone the rail is a drawer (MobileNav) and always shows its names. */
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 760px)");
    const on = () => setPhone(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  /* Editing the rail needs its names, so it opens while the editor is up. */
  const [editing, setEditing] = useState(false);
  const open = phone || editing || state === "open";
  const { width, handle } = useResizable(WIDTH_KEY, {
    min: RAIL_MIN,
    max: RAIL_MAX,
    initial: RAIL_DEFAULT,
    edge: "right",
  });

  const [tip, setTip] = useState<{ text: string; en: string; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warm = useRef(0);

  const holds = (i: RailItem) => !i.module || modules.includes(i.module);
  const items = RAIL_MAIN.filter(holds);
  const [layout, setLayout] = useState<RailLayout | null>(savedLayout);
  const arranged = arrangeRail(items, isAdmin ? RAIL_BACK.filter(holds) : [], layout);
  const { main, more: extra } = arranged;
  const [morePref, setMorePref] = useLocalPreference("aura:rail-more", ["closed", "open"] as const, "closed");
  const moreOpen = editing || morePref === "open" || extra.some((i) => railActive(i, pathname));

  /* ---- arranging: drag any entry (always), pin and unpin (in the editor) ---- */
  const navRef = useRef<HTMLElement>(null);
  const [saving, setSaving] = useState(false);
  const commit = (next: Arranged) => {
    const l: RailLayout = { main: next.main.map((i) => i.href), more: next.more.map((i) => i.href), back: next.back.map((i) => i.href) };
    setLayout(l);
    setSaving(true);
    saveRailLayoutAction(l)
      .then((r) => {
        if (!r.ok) throw new Error("not saved");
      })
      .catch(() => notify(zh ? "侧栏顺序没能保存，请再试一次" : "Couldn't save the sidebar order. Try again."))
      .finally(() => setSaving(false));
  };
  const reset = () => {
    setLayout(null);
    saveRailLayoutAction(null).catch(() => notify(zh ? "没能恢复默认，请再试一次" : "Couldn't restore the default. Try again."));
  };
  /** Moves an entry to `index` of `zone`. 后台 entries stay in 后台; the rest move freely between the rail and 更多. */
  const move = (href: string, zone: Zone, index: number) => {
    const lists: Arranged = { main: [...arranged.main], more: [...arranged.more], back: [...arranged.back] };
    const from = (Object.keys(lists) as Zone[]).find((z) => lists[z].some((i) => i.href === href));
    if (!from || (from === "back") !== (zone === "back")) return;
    const at = lists[from].findIndex((i) => i.href === href);
    const [it] = lists[from].splice(at, 1);
    let to = Math.max(0, Math.min(index, lists[zone].length + (from === zone ? 1 : 0)));
    if (from === zone && at < to) to -= 1;
    if (from === zone && at === to) return;
    lists[zone].splice(to, 0, it);
    commit(lists);
  };
  /** One step up or down, crossing from the rail into 更多 and back (the keyboard's way to drag). */
  const nudge = (href: string, dir: -1 | 1) => {
    if (arranged.back.some((i) => i.href === href)) {
      const at = arranged.back.findIndex((i) => i.href === href);
      return move(href, "back", at + (dir > 0 ? 2 : -1));
    }
    const flat = [...arranged.main.map((i) => ["main", i] as const), ...arranged.more.map((i) => ["more", i] as const)];
    const at = flat.findIndex(([, i]) => i.href === href);
    const nextAt = at + dir;
    if (nextAt < 0 || nextAt >= flat.length) return;
    const inMain = arranged.main.length;
    if (dir < 0) {
      const [z, other] = flat[nextAt];
      if (z === "main" && at === inMain) return move(href, "main", arranged.main.length);
      return move(href, z, (z === "main" ? arranged.main : arranged.more).indexOf(other));
    }
    const [z, other] = flat[nextAt];
    if (z === "more" && at === inMain - 1) return move(href, "more", 0);
    return move(href, z, (z === "main" ? arranged.main : arranged.more).indexOf(other) + 1);
  };
  const pin = (href: string, on: boolean) => (on ? move(href, "main", arranged.main.length) : move(href, "more", 0));

  const [drag, setDrag] = useState<{ href: string; zone: Zone; x: number; y: number } | null>(null);
  const [drop, setDrop] = useState<{ zone: Zone; index: number; top: number; head: boolean } | null>(null);
  const swallowClick = useRef(false);
  const dropAt = useCallback((y: number, zone: Zone) => {
    const nav = navRef.current;
    if (!nav) return null;
    const allowed: Zone[] = zone === "back" ? ["back"] : ["main", "more"];
    const navTop = nav.getBoundingClientRect().top;
    let best: { zone: Zone; index: number; top: number; head: boolean; d: number } | null = null;
    for (const el of nav.querySelectorAll<HTMLElement>("[data-rail-zone]")) {
      const z = el.dataset.railZone as Zone;
      if (!allowed.includes(z)) continue;
      const r = el.getBoundingClientRect();
      const isItem = el.dataset.railIndex !== undefined;
      /* Right over a group's heading (the folded 更多 above all): into that group, whatever is nearer. */
      if (!isItem && y >= r.top && y <= r.bottom) return { zone: z, index: Number(el.dataset.railHead ?? 0), top: r.bottom - navTop, head: true };
      const spots = isItem
        ? [
            { index: Number(el.dataset.railIndex), top: r.top },
            { index: Number(el.dataset.railIndex) + 1, top: r.bottom },
          ]
        : [{ index: Number(el.dataset.railHead ?? 0), top: r.bottom }];
      for (const s of spots) {
        const d = Math.abs(y - s.top);
        if (!best || d < best.d) best = { zone: z, index: s.index, top: s.top - navTop, head: !isItem, d };
      }
    }
    /* Dragged well away from anywhere it may go (a 后台 entry up among the rail's own): nothing moves. */
    return best && best.d <= 40 ? best : null;
  }, []);
  const grab = (e: React.PointerEvent<HTMLElement>, item: RailItem, zone: Zone) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-rail-nodrag]")) return;
    const start = { x: e.clientX, y: e.clientY };
    let live = false;
    const onMove = (ev: PointerEvent) => {
      if (!live) {
        if (Math.abs(ev.clientY - start.y) < 6 && Math.abs(ev.clientX - start.x) < 6) return;
        live = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        hide();
      }
      ev.preventDefault();
      setDrag({ href: item.href, zone, x: ev.clientX, y: ev.clientY });
      const d = dropAt(ev.clientY, zone);
      setDrop(d ? { zone: d.zone, index: d.index, top: d.top, head: d.head } : null);
      /* Near the top or bottom of a rail longer than the screen: it scrolls. */
      const sc = navRef.current?.querySelector<HTMLElement>(".rail-scroll");
      if (sc) {
        const r = sc.getBoundingClientRect();
        if (ev.clientY < r.top + 28) sc.scrollTop -= 12;
        else if (ev.clientY > r.bottom - 28) sc.scrollTop += 12;
      }
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (live) {
        swallowClick.current = true;
        setTimeout(() => (swallowClick.current = false), 0);
        const d = ev.type === "pointerup" ? dropAt(ev.clientY, zone) : null;
        if (d) move(item.href, d.zone, d.index);
      }
      setDrag(null);
      setDrop(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  const dragged = drag ? [...arranged.main, ...arranged.more, ...arranged.back].find((i) => i.href === drag.href) : undefined;
  const entry = (item: RailItem, zone: Zone, index: number, small = false) =>
    editing ? (
      <EditRow
        key={item.href}
        item={item}
        zone={zone}
        index={index}
        zh={zh}
        lifted={drag?.href === item.href}
        onGrab={(e) => grab(e, item, zone)}
        onPin={zone === "back" ? undefined : () => pin(item.href, zone === "more")}
        onNudge={(dir) => nudge(item.href, dir)}
      />
    ) : (
      <RailLink
        key={item.href}
        item={item}
        active={railActive(item, pathname)}
        open={open}
        zh={zh}
        show={show}
        hide={hide}
        small={small}
        zone={zone}
        index={index}
        lifted={drag?.href === item.href}
        onGrab={(e) => grab(e, item, zone)}
      />
    );
  /* The brand goes home, and home is a Chat surface: somebody without Chat
     was bounced to "你还没有「聊天」的权限" on every press (QA, 3 Oct). Their
     first module instead. */
  const homeHref = modules.includes("chat") ? "/home" : (items[0]?.href ?? "/settings");
  const back = arranged.back;
  /* 后台 is folded until opened, and opens by itself on one of its pages. */
  const [backPref, setBackPref] = useLocalPreference("aura:rail-back", ["closed", "open"] as const, "closed");
  const backActive = back.some((i) => railActive(i, pathname));
  /* Always open (Ryan, 30 Sep: "no need to fold the back office"). */
  const backOpen = true;
  void backPref;
  void setBackPref;

  // A tooltip due after the rail has gone would set state on nothing.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // The clock is read inside the timer callback rather than in the handler
  // body: these run on pointer events, never during render, and reading it
  // here keeps that obvious to both a reader and the compiler's lint rule.
  const show = useCallback((e: React.MouseEvent<HTMLElement>, text: string, en: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const top = rect.top + rect.height / 2;
    if (timer.current) clearTimeout(timer.current);

    // Instant when the pointer is already travelling down the rail; a beat's
    // delay on first hover so the tooltip never flickers past.
    timer.current = setTimeout(
      () => setTip({ text, en, top }),
      performance.now() - warm.current < 400 ? 0 : 350,
    );
  }, []);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    warm.current = performance.now();
    setTip(null);
  }, []);

  return (
    <nav
      ref={navRef}
      className="app-rail"
      data-editing={editing ? "" : undefined}
      onClickCapture={(e) => {
        if (swallowClick.current) {
          e.preventDefault();
          e.stopPropagation();
          swallowClick.current = false;
        }
      }}
      aria-label={zh ? "模块" : "Modules"}
      style={{
        width: open ? width : COLLAPSED,
        flexShrink: 0,
        position: "relative",
        background: "#f8f8f8",
        borderRight: "1px solid #ededed",
        display: "flex",
        flexDirection: "column",
        alignItems: open ? "stretch" : "center",
        padding: open ? "10px 8px" : "10px 0",
        gap: 3,
        minHeight: 0,
      }}
    >
      <style>{`.rail-edit-row{display:flex;align-items:center;gap:7px;height:32px;margin-bottom:2px;padding:0 4px 0 2px;border-radius:8px;background:#fff;border:1px solid #ececec;color:#3a3a3a;font-size:12.5px;cursor:grab;touch-action:none;user-select:none}.rail-edit-row:focus-visible{outline:2px solid #171717;outline-offset:1px}.rail-edit-row.lifted{opacity:.35}.rail-edit-row svg.ico{width:16px;height:16px;fill:currentColor;flex-shrink:0;color:#6b6b6b}.rail-edit-row .lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rail-grip{color:#b4b4b4;display:flex;flex-shrink:0}.rail-pin{border:0;background:transparent;width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#9a9a9a;cursor:pointer;flex-shrink:0}.rail-pin:hover{background:#f1f1f1;color:#171717}.rail-pin.on{color:#171717}.rail-zone-head{font-size:11px;font-weight:600;color:#8a8a8a;letter-spacing:.04em;padding:8px 4px 3px;display:flex;align-items:center;gap:6px}.rail-zone-empty{border:1px dashed #d8d8d8;border-radius:8px;height:30px;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:#a3a3a3}.rail-drop{position:absolute;left:10px;right:10px;height:2px;border-radius:2px;background:#171717;pointer-events:none;z-index:5;transform:translateY(-1px)}.rail-drop:before{content:"";position:absolute;left:-3px;top:-2px;width:6px;height:6px;border-radius:50%;background:#171717}.rail-btn{border:1px solid #e4e4e4;background:#fff;border-radius:7px;height:26px;padding:0 10px;font:inherit;font-size:12px;cursor:pointer;color:#3a3a3a}.rail-btn.dark{background:#171717;border-color:#171717;color:#fff}.rail-btn:hover{border-color:#cfcfcf}.rail-btn.dark:hover{background:#000}a.r.lifted{opacity:.35}.rail-ghost{position:fixed;z-index:2000;pointer-events:none;display:flex;align-items:center;gap:8px;height:30px;padding:0 12px;border-radius:8px;background:#fff;box-shadow:0 6px 22px rgba(0,0,0,.16),0 0 0 1px rgba(0,0,0,.05);font-size:12.5px;color:#171717;transform:translate(14px,-120%)}.rail-ghost svg{width:15px;height:15px;fill:currentColor}.rail-step{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#ecebe7;color:#6b6b6b;font-size:10px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}.r.on .rail-step{background:#171717;color:#fff}`}</style>
      {/* Only while it is open: there is nothing to drag a 52px strip to. */}
      {open && !phone ? handle : null}

      {/* Everything above the foot scrolls when the studio has more projects
          than the screen has height; 历史记录, 收起 and the account stay put. */}
      <div
        className="rail-scroll"
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          overscrollBehavior: "contain",
          scrollbarWidth: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: open ? "stretch" : "center",
          gap: 3,
          margin: "0 -2px",
          padding: "0 2px",
        }}
      >
      <Link
        href={homeHref}
        aria-label="腾亚创变"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          marginBottom: 10,
          padding: open ? "0 5px" : 0,
          color: "#171717",
          minWidth: 0,
        }}
      >
        <BrandMark size={28} />
        {open && (
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            腾亚创变
          </span>
        )}
      </Link>

      {editing ? (
        <div style={{ padding: "2px 4px 6px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#171717" }}>
            <Tr zh="编辑侧栏" en="Edit sidebar" inZh={zh} />
          </div>
          <div style={{ fontSize: 11.5, color: "#7c7c7c", lineHeight: 1.55 }}>
            <Tr zh="按住拖动调整顺序。点图钉固定在侧栏，再点一次收进「更多」。平时也可以直接拖动。" en="Hold and drag to reorder. Press the pin to keep an item on the sidebar; press it again to fold it into More. You can drag at any time, too." inZh={zh} />
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button type="button" className="rail-btn dark" onClick={() => setEditing(false)}>
              <Tr zh="完成" en="Done" inZh={zh} />
            </button>
            <button type="button" className="rail-btn" onClick={reset} disabled={!layout} style={layout ? undefined : { opacity: 0.45, cursor: "default" }}>
              <Tr zh="恢复默认" en="Reset" inZh={zh} />
            </button>
            {saving ? (
              <span style={{ fontSize: 11, color: "#a3a3a3" }}>
                <Tr zh="保存中" en="Saving" inZh={zh} />
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {editing ? (
        <div className="rail-zone-head" data-rail-zone="main" data-rail-head="0">
          <Tr zh="固定在侧栏" en="On the sidebar" inZh={zh} />
        </div>
      ) : null}
      {main.map((item, i) => entry(item, "main", i))}
      {editing && !main.length ? (
        <div className="rail-zone-empty">
          <Tr zh="拖到这里" en="Drop here" inZh={zh} />
        </div>
      ) : null}
      {editing ? (
        <>
          <div className="rail-zone-head" data-rail-zone="more" data-rail-head="0">
            <Tr zh="收在「更多」里" en="Folded under More" inZh={zh} />
          </div>
          {extra.map((item, i) => entry(item, "more", i))}
          {!extra.length ? (
            <div className="rail-zone-empty">
              <Tr zh="拖到这里" en="Drop here" inZh={zh} />
            </div>
          ) : null}
        </>
      ) : extra.length ? (
        <>
          <button
            type="button"
            className={`r${open ? " wide" : ""}`}
            /* Dropping an entry here folds it into 更多 even while 更多 is shut. */
            data-rail-zone="more"
            data-rail-head="0"
            onClick={() => setMorePref(moreOpen ? "closed" : "open")}
            aria-expanded={moreOpen}
            title={open ? undefined : zh ? "更多" : "More"}
            style={{ border: 0, background: drop?.head && drop.zone === "more" && !moreOpen ? "#ecebe7" : "transparent", boxShadow: drop?.head && drop.zone === "more" && !moreOpen ? "inset 0 0 0 1.5px #171717" : undefined, cursor: "pointer", fontFamily: "inherit", letterSpacing: "inherit", color: "#7c7c7c" }}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <circle cx="6" cy="12" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="18" cy="12" r="1.6" fill="currentColor" />
            </svg>
            {open ? (
              <span style={{ display: "flex", alignItems: "center", gap: 6, flexGrow: 1 }}>
                <Tr zh="更多" en="More" inZh={zh} />
                <svg viewBox="0 0 24 24" width="11" height="11" style={{ marginLeft: "auto", width: 11, height: 11, transform: moreOpen ? "rotate(180deg)" : undefined, transition: "transform .15s" }} aria-hidden>
                  <path d="m6.5 9.5 5.5 5.5 5.5-5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            ) : null}
          </button>
          {moreOpen ? extra.map((item, i) => entry(item, "more", i, true)) : null}
        </>
      ) : null}

      {back.length ? (
        <>
          <div style={{ height: 1, background: "#e2e2e2", margin: open ? "8px 9px" : "8px 0", width: open ? "auto" : 22 }} />
          <div className={editing ? "rail-zone-head" : `r${open ? " wide" : ""}`} data-rail-zone="back" data-rail-head="0" title={open ? undefined : zh ? "后台" : "Back office"} style={editing ? undefined : { color: "#7c7c7c", cursor: "default" }}>
            {editing ? null : (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            )}
            {open ? (
              <span>
                <Tr zh="后台" en="Back office" inZh={zh} />
              </span>
            ) : null}
          </div>
          {backOpen
            ? back.map((item, i) => entry(item, "back", i, true))
            : null}
        </>
      ) : null}

      </div>

      {drop && !(drop.head && drop.zone === "more" && !moreOpen) ? <span className="rail-drop" style={{ top: drop.top }} aria-hidden /> : null}
      {drag && dragged ? (
        <span className="rail-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden>
          <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: dragged.icon }} />
          {zh ? dragged.labelZh : dragged.label}
        </span>
      ) : null}

      {editing ? null : (
        <button
          type="button"
          onClick={() => {
            hide();
            setEditing(true);
          }}
          title={open ? undefined : zh ? "编辑侧栏" : "Edit sidebar"}
          aria-label={zh ? "编辑侧栏" : "Edit sidebar"}
          className={`r${open ? " wide" : ""}`}
          style={{ border: 0, background: "transparent", cursor: "pointer", fontFamily: "inherit", letterSpacing: "inherit" }}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M4.5 19.5h3.8L19 8.8a2.2 2.2 0 0 0 0-3.1l-.7-.7a2.2 2.2 0 0 0-3.1 0L4.5 15.7z M13.6 6.6l3.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {open && (
            <span>
              <Tr zh="编辑侧栏" en="Edit sidebar" inZh={zh} />
            </span>
          )}
        </button>
      )}

      <LangToggle zh={zh} wide={open} />
      {/* Dark mode is switched off for now (4 Oct); the work is kept on branch wt-darkv2. */}
      {/* <ThemeToggle zh={zh} wide={open} initial="light" /> */}

      <button
        type="button"
        onClick={() => setState(open ? "icons" : "open")}
        title={open ? (zh ? "收起侧栏" : "Collapse") : zh ? "展开侧栏" : "Expand"}
        aria-label={open ? (zh ? "收起侧栏" : "Collapse sidebar") : zh ? "展开侧栏" : "Expand sidebar"}
        aria-expanded={open}
        className={`r${open ? " wide" : ""}`}
        /* The family only: a whole `font: inherit` also brought in the
           page's 16px and made 收起 the largest word in the rail. */
        style={{ border: 0, background: "transparent", cursor: "pointer", fontFamily: "inherit", letterSpacing: "inherit" }}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <path
            d={open ? "M14.6 6.6 9.2 12l5.4 5.4" : "M9.4 6.6 14.8 12l-5.4 5.4"}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {open && (
          <span>
            <Tr zh="收起" en="Collapse" inZh={zh} />
          </span>
        )}
      </button>

      {/* The signed-in person, at the foot as well as in the top bar: the
        * owner asked for it here, beside 历史记录 and 收起. Named and with the
        * role (the old bare avatar said who you were, never what you were). */}
      {account ? <RailAccount account={account} zh={zh} wide={open} /> : null}
      {/* On a phone the rail is this dock at the foot of the screen, in the person's own order. */}
      <PhoneDock main={arranged.main} more={arranged.more} back={arranged.back} pathname={pathname} zh={zh} account={account} />

      {tip && (
        <span
          role="tooltip"
          style={{
            position: "fixed",
            left: 58,
            top: tip.top,
            transform: "translateY(-50%)",
            zIndex: 50,
            display: "flex",
            gap: 6,
            borderRadius: 6,
            padding: "4px 8px",
            background: "#171717",
            color: "#fff",
            font: "500 12px/16px 'TG Latin', 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', system-ui, sans-serif",
            boxShadow: "0 2px 6px rgba(0,0,0,.14)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {zh ? <Tr zh={tip.text} en={tip.en} /> : tip.text}
        </span>
      )}
    </nav>
  );
}

/** One entry: its icon, its name while the rail is open, a tooltip while it is not. */
function RailLink({
  item,
  active,
  open,
  zh,
  show,
  hide,
  small = false,
  zone,
  index,
  lifted,
  onGrab,
}: {
  item: RailItem;
  active: boolean;
  open: boolean;
  zh: boolean;
  show: (e: React.MouseEvent<HTMLElement>, text: string, en: string) => void;
  hide: () => void;
  small?: boolean;
  zone: Zone;
  index: number;
  lifted: boolean;
  onGrab: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  const label = zh ? item.labelZh : item.label;
  /* Translate-proof in Chinese: the English a translated page shows. */
  const en = TR_EN[item.labelZh] ?? item.label;
  return (
    <Link
      href={item.href}
      /* No prefetch: every refresh on a working page re-prefetched them all. */
      prefetch={false}
      className={`r${active ? " on" : ""}${open ? " wide" : ""}${lifted ? " lifted" : ""}`}
      aria-label={label}
      data-rail-zone={zone}
      data-rail-index={index}
      draggable={false}
      onPointerDown={onGrab}
      aria-current={active ? "page" : undefined}
      onMouseEnter={open ? undefined : (e: React.MouseEvent<HTMLElement>) => show(e, label, en)}
      onMouseLeave={open ? undefined : hide}
      onClick={hide}
      style={small && open ? { paddingLeft: 18 } : undefined}
    >
      <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: item.icon }} />
      {open && <span>{zh ? <Tr zh={item.labelZh} en={en} /> : label}</span>}
      {item.step ? <span className="rail-step" aria-hidden style={open ? { marginLeft: "auto" } : { position: "absolute", right: 3, bottom: 3 }}>{item.step}</span> : null}
      <RailSpinner wide={open} />
    </Link>
  );
}

/**
 * The click answered at once. A page whose scripts are not cached yet can take
 * a moment to arrive from the server, and a rail entry that does nothing for
 * that moment reads as broken. Same spinner the chat sidebar uses.
 */
function RailSpinner({ wide }: { wide: boolean }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span className="spin" aria-hidden style={wide ? { marginLeft: "auto" } : { position: "absolute", right: 4, top: 4, width: 8, height: 8 }} />;
}

/** An entry in the editor: a handle to drag, its name, and the pin. Alt+↑/↓ moves it from the keyboard. */
function EditRow({
  item,
  zone,
  index,
  zh,
  lifted,
  onGrab,
  onPin,
  onNudge,
}: {
  item: RailItem;
  zone: Zone;
  index: number;
  zh: boolean;
  lifted: boolean;
  onGrab: (e: React.PointerEvent<HTMLElement>) => void;
  onPin?: () => void;
  onNudge: (dir: -1 | 1) => void;
}) {
  const label = zh ? item.labelZh : item.label;
  const pinned = zone === "main";
  const pinTip = pinned ? (zh ? "收进「更多」" : "Fold into More") : zh ? "固定在侧栏" : "Pin to the sidebar";
  return (
    <div
      className={`rail-edit-row${lifted ? " lifted" : ""}`}
      data-rail-zone={zone}
      data-rail-index={index}
      tabIndex={0}
      aria-label={`${label}${zh ? "，按 Alt 加方向键移动" : ", Alt+arrow keys to move"}`}
      onPointerDown={onGrab}
      onKeyDown={(e) => {
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          onNudge(e.key === "ArrowUp" ? -1 : 1);
          const el = e.currentTarget;
          requestAnimationFrame(() => (document.querySelector<HTMLElement>(`[data-rail-zone][tabindex="0"][aria-label^="${label}"]`) ?? el).focus());
        }
      }}
    >
      <span className="rail-grip" aria-hidden>
        <svg viewBox="0 0 24 24" width="14" height="14">
          <g fill="currentColor">
            <circle cx="9" cy="6.5" r="1.5" />
            <circle cx="15" cy="6.5" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="17.5" r="1.5" />
            <circle cx="15" cy="17.5" r="1.5" />
          </g>
        </svg>
      </span>
      <svg className="ico" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: item.icon }} />
      <span className="lbl">{zh ? <Tr zh={item.labelZh} en={TR_EN[item.labelZh] ?? item.label} /> : label}</span>
      {onPin ? (
        <button type="button" data-rail-nodrag className={`rail-pin${pinned ? " on" : ""}`} onClick={onPin} title={pinTip} aria-label={`${pinTip}：${label}`} aria-pressed={pinned}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
            <path d="M9 3.8h6l-.8 5.4 3.3 3.3v1.6H6.5v-1.6l3.3-3.3zM12 14.1v6.1" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
