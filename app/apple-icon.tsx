import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          alignItems: "flex-start",
          padding: "0 34px",
          gap: 14,
        }}
      >
        <div style={{ width: 56, height: 12, background: "#d6e64f", borderRadius: 4 }} />
        <div style={{ color: "#fff", fontSize: 72, fontWeight: 700, fontFamily: "sans-serif", lineHeight: 1 }}>腾亚</div>
      </div>
    ),
    size,
  );
}
