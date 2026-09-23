import { ImageResponse } from "next/og";
import { brandMarkDataUri } from "@/lib/brand/mark";

/** The home-screen icon: the 腾亚 mark, square, because iOS rounds it. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    // eslint-disable-next-line jsx-a11y/alt-text
    <img src={brandMarkDataUri(180, { square: true })} width={180} height={180} />,
    size,
  );
}
