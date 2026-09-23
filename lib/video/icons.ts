/**
 * The icons a graphic can use.
 *
 * Not an icon *library* — a list. A model given "any icon you like" reaches
 * for a different visual language every thirty seconds, which is the exact
 * failure the craft notes call out: decoration standing in for a cut. These
 * are drawn in one weight, on one grid, and they are things a studio actually
 * points at: money, a rocket, a chart going up, a warning.
 *
 * Each is a path (or two) on a 24×24 grid, stroked — so it inherits the
 * accent colour and scales to any frame without a raster anywhere.
 */
export const ICONS: Record<string, { d: string[]; label: string; labelZh: string }> = {
  rocket: {
    label: "Rocket",
    labelZh: "火箭",
    d: [
      "M4.5 15.5c-1 2.5-.5 4 .5 4.5s2.5 1 4.5-.5",
      "M14 4c3.5 0 6 2.5 6 6 0 4.5-4.5 8-8 9.5L9 17l-2.5-3C8 12 11.5 4 14 4z",
      "M13.5 9.5h.01",
    ],
  },
  chart: { label: "Chart up", labelZh: "上升", d: ["M4 19h16", "m6 15 4-4 3 3 5-6"] },
  money: { label: "Money", labelZh: "金额", d: ["M4 6.5h16v11H4z", "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5"] },
  clock: { label: "Clock", labelZh: "时间", d: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16", "M12 8v4.5l3 1.8"] },
  warning: { label: "Warning", labelZh: "警告", d: ["M12 4.5 21 19H3z", "M12 10v4", "M12 16.6h.01"] },
  check: { label: "Done", labelZh: "完成", d: ["m4.5 12.5 5 5L20 7"] },
  people: {
    label: "People",
    labelZh: "团队",
    d: ["M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "M3.5 19.5c0-3 2.2-5 5-5s5 2 5 5", "M16 6.2a3 3 0 0 1 0 5.6", "M17 14.8c2 .6 3.5 2.4 3.5 4.7"],
  },
  globe: { label: "Globe", labelZh: "全球", d: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16", "M4 12h16", "M12 4c2.5 2.5 2.5 13 0 16M12 4c-2.5 2.5-2.5 13 0 16"] },
  camera: { label: "Camera", labelZh: "摄影", d: ["M3.5 8.5h13v10h-13z", "m16.5 12 4-2.5v7l-4-2.5"] },
  mic: { label: "Microphone", labelZh: "话筒", d: ["M12 4a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0v-5A2.5 2.5 0 0 1 12 4", "M6.5 11.5a5.5 5.5 0 0 0 11 0", "M12 17v3"] },
  bulb: { label: "Idea", labelZh: "想法", d: ["M9.5 17h5", "M10 20h4", "M12 4a5.5 5.5 0 0 1 3.2 10c-.5.4-.7 1-.7 1.5h-5c0-.6-.2-1.1-.7-1.5A5.5 5.5 0 0 1 12 4"] },
  pin: { label: "Place", labelZh: "地点", d: ["M12 21s6.5-6 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15 12 21 12 21", "M12 8.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4"] },
  calendar: { label: "Date", labelZh: "日期", d: ["M4.5 6.5h15v13h-15z", "M4.5 10.5h15", "M8.5 4v4M15.5 4v4"] },
  fire: { label: "Hot", labelZh: "热度", d: ["M12 3.5c3 3 5.5 5 5.5 8.5a5.5 5.5 0 0 1-11 0c0-1.7.8-3 2-4.2.3 1.3 1 2 2 2 0-2.6.7-4.6 1.5-6.3"] },
  play: { label: "Play", labelZh: "播放", d: ["M8 5.5 19 12 8 18.5z"] },
  lock: { label: "Private", labelZh: "私密", d: ["M6.5 10.5h11v9h-11z", "M9 10.5V8a3 3 0 0 1 6 0v2.5"] },
  cart: { label: "Shopping", labelZh: "购物", d: ["M3.5 5h2l2.2 9.5h9.6l2.2-7H7", "M9.5 19h.01M17 19h.01"] },
  plane: { label: "Travel", labelZh: "出行", d: ["M3 13.5 21 7l-4 11-4-4-4 3z"] },
  chip: { label: "Chip", labelZh: "芯片", d: ["M8 8h8v8H8z", "M5 10h3M5 14h3M16 10h3M16 14h3", "M10 5v3M14 5v3M10 16v3M14 16v3"] },
  building: { label: "Company", labelZh: "公司", d: ["M5 20V6l7-2.5V20", "M12 20h7V9.5l-7-2", "M8 9.5h1M8 13h1M15 12h1M15 15.5h1"] },
};

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS);

export function isIconName(value: unknown): value is IconName {
  return typeof value === "string" && value in ICONS;
}

/** Where a picture or an icon sits in the frame. */
export const PLACEMENTS = ["center", "top-left", "top-right", "bottom-left", "bottom-right", "bottom-center", "full"] as const;
export type Placement = (typeof PLACEMENTS)[number];

export function isPlacement(value: unknown): value is Placement {
  return (PLACEMENTS as readonly string[]).includes(String(value));
}
