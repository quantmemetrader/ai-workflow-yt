import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { Captions, type CaptionsProps, type Cue, type CaptionStyle } from "./Captions";
import { Graphic, type GraphicKind } from "./Graphics";
import { useFonts } from "./fonts";

/**
 * Everything that goes over the picture, in one pass.
 *
 * One render rather than one per graphic: the whole overlay is drawn once onto
 * transparency and composited by FFmpeg in a single filter, so a video with
 * captions and six lower thirds costs one Chrome render and one encode instead
 * of seven of each.
 */
export type OverlayGraphic = {
  kind: GraphicKind;
  text: string;
  sub?: string | null;
  start: number;
  seconds: number;
  /** For an `icon` graphic: which one, from the app's own set. */
  icon?: string | null;
  /** Where it sits in the frame. */
  placement?: string | null;
  /** Share of frame height, 5–90, for an icon. */
  scale?: number | null;
};

export type OverlayProps = {
  cues: Cue[];
  style: CaptionStyle | null;
  graphics: OverlayGraphic[];
  accent: string;
};

export const Overlay: React.FC<OverlayProps> = ({ cues, style, graphics, accent }) => {
  const { fps } = useVideoConfig();
  useFonts();

  return (
    // Transparent: the picture underneath is the studio's footage, untouched.
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      {graphics.map((g, i) => (
        <Sequence
          key={`${g.kind}-${g.start}-${i}`}
          from={Math.round(g.start * fps)}
          durationInFrames={Math.max(1, Math.round(g.seconds * fps))}
        >
          <Graphic
            kind={g.kind}
            text={g.text}
            sub={g.sub}
            accent={accent}
            seconds={g.seconds}
            icon={g.icon}
            placement={g.placement}
            scale={g.scale}
          />
        </Sequence>
      ))}
      {style && cues.length > 0 ? (
        <Captions cues={cues} style={style} accent={accent} />
      ) : null}
    </AbsoluteFill>
  );
};

export type { CaptionsProps, Cue, CaptionStyle };
