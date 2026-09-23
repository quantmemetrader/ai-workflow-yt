import { brandMarkSvg } from "@/lib/brand/mark";

/**
 * The 腾亚 mark, top left of every screen (`lib/brand/mark.ts`).
 *
 * The SVG is a constant built in this codebase — no user text reaches it — so
 * setting it as markup is safe, and it keeps one drawing for the app, the
 * favicon and the home-screen icon.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="腾亚"
      style={{ display: "inline-flex", width: size, height: size, flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: brandMarkSvg(size) }}
    />
  );
}
