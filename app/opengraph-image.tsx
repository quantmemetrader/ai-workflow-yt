import { ImageResponse } from "next/og";
import { brandMarkDataUri } from "@/lib/brand/mark";

/**
 * The card a shared link unfurls into — on WhatsApp, WeChat, Slack, anywhere.
 *
 * It carries the same 腾亚 mark as the favicon and the corner of every screen
 * (`lib/brand/mark.ts`), as an `<img>` of that SVG: the mark's characters are
 * outlines, so they draw the same on the crawler's machine as on ours. The
 * wordmark and the one line under it are set in the sans that `next/og`
 * ships, which has the Han glyphs these need.
 *
 * No English line. The studio dropped its English name, and a card that still
 * said the old one kept surfacing the wrong studio in chat previews long after
 * the site had changed — link previews are cached for weeks, so what this
 * draws is what people see for a long time.
 */
export const alt = "腾亚创变 工作台";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#171717",
          display: "flex",
          alignItems: "center",
          padding: "0 96px",
          fontFamily: "sans-serif",
        }}
      >
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <img src={brandMarkDataUri(220)} width={220} height={220} style={{ marginRight: 72, flexShrink: 0 }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ width: 64, height: 14, background: "#d6e64f", borderRadius: 4, marginBottom: 28 }} />
          <div style={{ color: "#fff", fontSize: 84, fontWeight: 700, lineHeight: 1.1 }}>腾亚创变 工作台</div>
          <div style={{ color: "rgba(255,255,255,0.86)", fontSize: 32, marginTop: 36, lineHeight: 1.4 }}>
            选题研究 · 脚本 · 剪辑 · 发布，一个助理全程跟进
          </div>
        </div>
      </div>
    ),
    size,
  );
}
