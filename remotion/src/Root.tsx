import React from "react";
import { AbsoluteFill, Composition } from "remotion";
import { Overlay, type OverlayProps } from "./Overlay";
import { Graphic, type GraphicProps } from "./Graphics";
import { useFonts } from "./fonts";

/**
 * The compositions the product renders.
 *
 * `Overlay` is the v1 one: every graphic and the captions of a cut in one
 * transparent pass, or one graphic as a still. Its size and length come
 * from the cut it goes over, passed by the worker, so this file never
 * guesses a format.
 *
 * `Clip` is director v2's: one graphic, as a transparent VP9 clip, cropped
 * to the box the graphic occupies (`remotion/render-clips.mjs`). The
 * graphic is laid out against the full frame it belongs to — `frame` — and
 * the composition is only `box` big, offset so that box is what Chrome
 * draws. A Zone-T card is 1080×500 pixels a frame instead of 1080×1920.
 */
export type ClipProps = {
  graphic: Omit<GraphicProps, "accent" | "seconds" | "frame">;
  accent: string;
  seconds: number;
  frame: { width: number; height: number };
  box: { x: number; y: number; w: number; h: number };
};

export const Clip: React.FC<ClipProps> = ({ graphic, accent, seconds, frame, box }) => {
  useFonts();
  return (
    <AbsoluteFill style={{ backgroundColor: "transparent", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: -box.x, top: -box.y, width: frame.width, height: frame.height }}>
        <Graphic {...graphic} accent={accent} seconds={seconds} frame={frame} />
      </div>
    </AbsoluteFill>
  );
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Overlay"
      component={Overlay}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={
        {
          cues: [],
          style: null,
          graphics: [],
          accent: "#007be0",
        } satisfies OverlayProps
      }
    />
    <Composition
      id="Clip"
      component={Clip}
      durationInFrames={90}
      fps={30}
      width={1080}
      height={500}
      defaultProps={
        {
          graphic: { kind: "hook", text: "美国三大安全机构 | 罕见联手 | 点名中国AI【蒸馏】", sub: null, options: { stepsMs: [0, 600, 1300] } },
          accent: "#d6e64f",
          seconds: 3,
          frame: { width: 1080, height: 1920 },
          box: { x: 0, y: 200, w: 1080, h: 500 },
        } satisfies ClipProps
      }
    />
  </>
);
