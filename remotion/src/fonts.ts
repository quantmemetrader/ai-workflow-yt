import { continueRender, delayRender, staticFile } from "remotion";

/**
 * The faces the compositions set type in.
 *
 * Inter ships with the project (`public/fonts`, SIL OFL) so a title on the
 * box and a title in the studio look the same; the CJK face is the box's
 * own Noto Sans CJK, which Chrome finds through fontconfig. Both are the
 * faces libass draws the captions with, so a caption and a header agree.
 */
let loaded: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  if (loaded) return loaded;
  if (typeof document === "undefined") return Promise.resolve();
  const face = new FontFace("Inter", `url(${staticFile("fonts/InterVariable.ttf")})`, {
    weight: "100 900",
    style: "normal",
  });
  loaded = face
    .load()
    .then((f) => {
      (document.fonts as unknown as { add: (face: FontFace) => void }).add(f);
    })
    .catch(() => undefined);
  return loaded;
}

/** Hold the frame until Inter is in, so the first still is not set in a fallback. */
export function useFonts() {
  if (typeof document === "undefined") return;
  const handle = delayRender("fonts");
  loadFonts().finally(() => continueRender(handle));
}
