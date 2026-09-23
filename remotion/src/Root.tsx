import React from "react";
import { Composition } from "remotion";
import { Overlay, type OverlayProps } from "./Overlay";

/**
 * The one composition the product renders.
 *
 * Its size and length come from the cut it is going over, passed on the
 * command line by the worker, so this file never guesses a format.
 */
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
  </>
);
