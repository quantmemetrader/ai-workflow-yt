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
};

export const NAV: NavItem[] = [
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
    label: "Script",
    labelZh: "剧本",
    live: true,
    icon: '<path d="M6.4 3.4h7.4L18.6 8v12.6H6.4z"/><path d="M9.4 12.3h6M9.4 15.6h6" stroke="#f8f8f8" stroke-width="1.5" fill="none"/>',
  },
  {
    module: "video",
    href: "/video",
    label: "Video Edit",
    labelZh: "视频剪辑",
    live: true,
    icon: '<rect x="3.4" y="5.4" width="12.4" height="13.2" rx="2.1"/><path d="m16.6 13 4.6 2.8V8.2L16.6 11z"/>',
  },
  {
    module: "publish",
    href: "/publish",
    label: "Publish",
    labelZh: "发布",
    live: true,
    dividerAfter: true,
    icon: '<path d="M21.86 4.14a1.1 1.1 0 0 0-1.14-.18L2.9 11.13c-.86.34-.83 1.58.05 1.87l4.46 1.5 1.68 5.06c.24.72 1.15.93 1.68.38l2.4-2.5 4.4 3.23c.6.44 1.46.12 1.63-.6z"/>',
  },
  {
    module: "accounting",
    href: "/accounting",
    label: "Accounting",
    labelZh: "会计",
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

export const NAV_BY_MODULE = new Map(NAV.map((n) => [n.module, n]));
