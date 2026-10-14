import type { RailItem } from "@/lib/nav";

/**
 * Each person's own arrangement of the rail (15 Oct: "let them drag the sidebar
 * content to whatever the user wants … pin, unpin").
 *
 * Stored as page addresses, not as positions, so an entry added to the rail
 * later still shows up (in its default place, at the end of its group) and an
 * entry somebody has lost access to simply drops out.
 *
 * `main` is what sits on the rail, `more` what is folded under 更多, `back`
 * the order of the 后台 group.
 */
export type RailLayout = { main: string[]; more: string[]; back: string[] };

const isHref = (v: unknown): v is string => typeof v === "string" && v.startsWith("/") && v.length < 80;

/** Whatever came from the database or a request, made safe; null when it is not a layout. */
export function cleanRailLayout(v: unknown): RailLayout | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? [...new Set(x.filter(isHref))].slice(0, 40) : []);
  const out = { main: list(o.main), more: list(o.more), back: list(o.back) };
  /* The same page in two groups: the first one wins. */
  out.more = out.more.filter((h) => !out.main.includes(h));
  return out.main.length || out.more.length || out.back.length ? out : null;
}

/** The rail in this person's order. `items` and `back` are the entries they may see. */
export function arrangeRail(items: RailItem[], back: RailItem[], layout: RailLayout | null): { main: RailItem[]; more: RailItem[]; back: RailItem[] } {
  if (!layout) return { main: items.filter((i) => !i.more), more: items.filter((i) => i.more), back };
  const pick = (pool: RailItem[], hrefs: string[], used: Set<string>) =>
    hrefs.flatMap((h) => {
      const it = pool.find((i) => i.href === h);
      if (!it || used.has(h)) return [];
      used.add(h);
      return [it];
    });
  const used = new Set<string>();
  const main = pick(items, layout.main, used);
  const more = pick(items, layout.more, used);
  for (const i of items) if (!used.has(i.href)) (i.more ? more : main).push(i);
  const usedBack = new Set<string>();
  const b = pick(back, layout.back, usedBack);
  for (const i of back) if (!usedBack.has(i.href)) b.push(i);
  return { main, more, back: b };
}
