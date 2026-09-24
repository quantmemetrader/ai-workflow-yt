import type { Module } from "@/lib/db/schema";

/**
 * The left rail (spec §4.1). Icons and order come straight from the approved
 * design canvas, so the built product and the design stay one thing.
 *
 * `live` marks the modules that run on real data. The rest still open their
 * approved design screen, so navigation is never a dead end while the build
 * works through the spec's order.
 */
export type NavItem = {
  module: Module;
  href: string;
  label: string;
  labelZh: string;
  icon: string;
  live: boolean;
  /** A divider sits after this item: above is making the video, below is
   * running the business. */
  dividerAfter?: boolean;
  /**
   * Another surface of a module that already has a rail entry — Articles is
   * the writing module's second screen, not a twelfth entitlement.
   *
   * It is a rail icon and a jump target like any other; what it is not is the
   * thing `NAV_BY_MODULE` returns, because that map answers "what is this
   * module called" and a module has one name.
   */
  secondary?: boolean;
  /** Built, but kept off the rail for now. */
  parked?: boolean;
};

const ALL: NavItem[] = [
  {
    /*
     * 首页 — the day's work, not a page of its own subject.
     *
     * Gated on Chat, like Articles is on Script: it is a second surface of the
     * place the AI employees work, not a twelfth entitlement for an admin to
     * discover and grant. `secondary` keeps it out of `NAV_BY_MODULE`, which
     * answers "what is this module called" and must keep answering 聊天.
     */
    module: "chat",
    secondary: true,
    href: "/home",
    label: "Home",
    labelZh: "首页",
    live: true,
    icon: '<path d="M12 3.2 3.4 10v10.4h6V15h5.2v5.4h6V10z"/>',
  },
  {
    module: "chat",
    href: "/chat",
    label: "Chat",
    labelZh: "聊天",
    live: true,
    icon: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-2.8-.4L4 21l1.4-4.1A8.2 8.2 0 0 1 3.6 11.5 8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>',
  },
  {
    module: "files",
    href: "/files",
    label: "Files",
    labelZh: "文件",
    live: true,
    icon: '<path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z"/>',
  },
  {
    module: "research",
    href: "/research",
    label: "Market Research",
    labelZh: "市场调研",
    live: true,
    icon: '<rect x="3.4" y="12.6" width="4.2" height="7.4" rx="1.5"/><rect x="9.9" y="8.4" width="4.2" height="11.6" rx="1.5"/><rect x="16.4" y="4" width="4.2" height="16" rx="1.5"/>',
  },
  {
    module: "script",
    href: "/script",
    label: "All scripts",
    labelZh: "所有脚本",
    live: true,
    icon: '<path d="M6.4 3.4h7.4L18.6 8v12.6H6.4z"/><path d="M9.4 12.3h6M9.4 15.6h6" stroke="#f8f8f8" stroke-width="1.5" fill="none"/>',
  },
  {
    /*
     * Articles (P3): "the article generation page apart from the video page".
     *
     * Gated on Script, because it is the writing module's other surface — a
     * person who may write a script may write an article — and a twelfth
     * entitlement would be one an admin has to discover and grant before
     * anybody could see the screen at all.
     */
    module: "script",
    secondary: true,
    href: "/article",
    label: "Articles",
    labelZh: "文章",
    live: true,
    icon: '<rect x="3.4" y="4.8" width="13.2" height="14.4" rx="2"/><path d="M6.4 8.6h7.2M6.4 12h7.2M6.4 15.4h4.6" stroke="#f8f8f8" stroke-width="1.5" fill="none"/><path d="M16.6 8.6h2.1a1.9 1.9 0 0 1 1.9 1.9v6.8a1.9 1.9 0 0 1-1.9 1.9h-2.1z"/>',
    /* Parked at the client's request ("comment out article page for now"):
       the route still works, the rail does not offer it. */
    parked: true,
  },
  {
    module: "video",
    href: "/video",
    label: "All videos",
    labelZh: "所有视频",
    live: true,
    icon: '<rect x="3.4" y="5.4" width="12.4" height="13.2" rx="2.1"/><path d="m16.6 13 4.6 2.8V8.2L16.6 11z"/>',
  },
  {
    module: "publish",
    href: "/publish",
    label: "Publish",
    labelZh: "发布中",
    live: true,
    dividerAfter: true,
    icon: '<path d="M21.86 4.14a1.1 1.1 0 0 0-1.14-.18L2.9 11.13c-.86.34-.83 1.58.05 1.87l4.46 1.5 1.68 5.06c.24.72 1.15.93 1.68.38l2.4-2.5 4.4 3.23c.6.44 1.46.12 1.63-.6z"/>',
  },
  {
    module: "accounting",
    href: "/accounting",
    label: "Accounting",
    labelZh: "账务",
    live: true,
    icon: '<rect x="5.4" y="3.4" width="13.2" height="17.2" rx="2"/><path d="M8.4 8h7.2M8.4 12h7.2M8.4 16h4" stroke="#f8f8f8" stroke-width="1.5" fill="none"/>',
  },
  {
    module: "finance",
    href: "/finance",
    label: "Finance",
    labelZh: "财务",
    live: true,
    icon: '<circle cx="12" cy="12" r="8.6"/><path d="M14.8 9.4c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.9-2.8 2.1 0 2.9 5.7 1.4 5.7 4.3 0 1.2-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-2.9-1.6M12 6.4v1.4M12 16.3v1.4" stroke="#f8f8f8" stroke-width="1.5" fill="none"/>',
  },
  {
    module: "legal",
    href: "/legal",
    label: "Legal",
    labelZh: "法务",
    live: true,
    icon: '<path d="M12 3.2 4.4 6.2v5.6c0 4.4 3.1 8.3 7.6 9.3 4.5-1 7.6-4.9 7.6-9.3V6.2z"/>',
  },
  {
    module: "hr",
    href: "/hr",
    label: "HR",
    labelZh: "人事",
    live: true,
    icon: '<circle cx="12" cy="7.8" r="3.7"/><path d="M4.7 20.2a7.3 7.3 0 0 1 14.6 0z"/>',
  },
  {
    module: "admin",
    href: "/admin",
    label: "Admin",
    labelZh: "管理",
    live: true,
    icon: '<path d="M4 7.4h16M4 12h16M4 16.6h16" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="9" cy="7.4" r="2.2"/><circle cx="15" cy="16.6" r="2.2"/>',
  },
];

export const NAV: NavItem[] = ALL.filter((n) => !n.parked);

export const NAV_BY_MODULE = new Map(NAV.filter((n) => !n.secondary).map((n) => [n.module, n]));

/* ------------------------------------------------------------------ crumbs */

/**
 * The screens *inside* a module, for the one line at the top that says where
 * you are.
 *
 * Only the routes a person can arrive at and then wonder about. A script's own
 * page (`/script/<id>`) is not here: the screen already puts the script's title
 * in its header, and repeating it above would be the same words twice.
 *
 * These labels are copied from the sidebars that already name these screens
 * (`ResearchSidebar.SCREENS`, the Files views) rather than written afresh —
 * the same screen must not have two names.
 */
export type CrumbItem = { href: string; label: string; labelZh: string };

const SCREENS: CrumbItem[] = [
  { href: "/research/compare", label: "Search & compare", labelZh: "搜索与对比" },
  { href: "/research/performance", label: "Content performance", labelZh: "内容表现" },
  { href: "/research/inbox", label: "Comment inbox", labelZh: "评论收件箱" },
  { href: "/research/backlog", label: "Topic backlog", labelZh: "选题储备" },
  { href: "/files/recent", label: "Recent", labelZh: "最近" },
  { href: "/files/shared", label: "Shared with me", labelZh: "共享给我" },
  { href: "/files/trash", label: "Trash", labelZh: "回收站" },
];

/**
 * The pages that are not a module at all.
 *
 * Settings and Search sit outside the rail's list, so without this the top bar
 * would have nothing to say on two of the screens people reach most often.
 */
const LOOSE: CrumbItem[] = [
  { href: "/home", label: "Home", labelZh: "首页" },
  { href: "/flow", label: "Flow", labelZh: "自动化流程" },
  { href: "/settings", label: "Settings", labelZh: "设置" },
  { href: "/search", label: "Search", labelZh: "搜索" },
];

/** `/research/backlog` is under `/research`; `/researchxyz` is not. */
function covers(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Where this path is, said in at most two steps: the module, then the screen.
 *
 * Longest match wins, so `/article` resolves to Articles rather than to the
 * Script module it is gated on, and `/files/trash` to Trash rather than to the
 * `/files` it hangs off.
 */
export function locate(pathname: string): { module: CrumbItem | null; screen: CrumbItem | null } {
  const longest = (items: CrumbItem[]) =>
    items
      .filter((i) => covers(i.href, pathname))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null;

  const loose = longest(LOOSE);
  if (loose) return { module: loose, screen: null };

  return { module: longest(NAV), screen: longest(SCREENS) };
}
