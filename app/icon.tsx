import { ImageResponse } from "next/og";
import { brandMarkDataUri } from "@/lib/brand/mark";

/**
 * The favicon: the 腾亚 mark (`lib/brand/mark.ts`), drawn from the same SVG as
 * the corner of every screen. An `<img>` of the SVG rather than `next/og`
 * text, because its font is not the studio's and would draw other glyphs.
 */
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    // eslint-disable-next-line jsx-a11y/alt-text
    <img src={brandMarkDataUri(64)} width={64} height={64} />,
    size,
  );
}
