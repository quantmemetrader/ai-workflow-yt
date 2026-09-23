import { ImageResponse } from "next/og";

/**
 * The card a shared link unfurls into. Drawn at request time in the house
 * look: dark ground, the accent dash, the studio's name, one line on what
 * the platform does.
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
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ width: 64, height: 14, background: "#d6e64f", borderRadius: 4, marginBottom: 28 }} />
        <div style={{ color: "#fff", fontSize: 76, fontWeight: 700, lineHeight: 1.1 }}>腾亚创变 工作台</div>
        <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 34, marginTop: 18 }}>Aura&apos;s Inno Lab</div>
        <div style={{ color: "rgba(255,255,255,0.86)", fontSize: 30, marginTop: 44, lineHeight: 1.4 }}>
          选题研究 · 脚本 · 剪辑 · 发布，一个助理全程跟进
        </div>
      </div>
    ),
    size,
  );
}
