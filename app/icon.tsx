import { ImageResponse } from "next/og";

/**
 * The favicon, drawn rather than shipped as a file: a dark tile with the
 * channel's accent dash, the same mark the video header carries.
 */
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#171717",
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "0 12px",
          gap: 6,
        }}
      >
        <div style={{ width: 22, height: 5, background: "#d6e64f", borderRadius: 2 }} />
        <div style={{ color: "#fff", fontSize: 26, fontWeight: 700, fontFamily: "sans-serif", lineHeight: 1 }}>亚</div>
      </div>
    ),
    size,
  );
}
