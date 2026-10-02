"use client";

import * as React from "react";
import { PORTRAIT_H, PORTRAIT_W, drawPortrait, type LookKey } from "@/components/office/art";
import { LOOKS } from "@/components/office/looks";

/** The same pixel person as on the floor, from the chest up, at a whole-number scale. */
export function Portrait({ who, scale = 2, tint }: { who: LookKey; scale?: number; tint: string }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  React.useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) drawPortrait(ctx, LOOKS[who]);
  }, [who]);
  return (
    <canvas
      ref={ref}
      width={PORTRAIT_W}
      height={PORTRAIT_H}
      aria-hidden
      style={{ width: PORTRAIT_W * scale, height: PORTRAIT_H * scale, imageRendering: "pixelated", display: "block", background: tint, borderRadius: 8, flexShrink: 0 }}
    />
  );
}
