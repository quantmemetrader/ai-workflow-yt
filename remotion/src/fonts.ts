import { continueRender, delayRender, staticFile } from "remotion";

/**
 * The faces the compositions set type in.
 *
 * Inter ships with the project (`public/fonts`, SIL OFL) so a title on the
 * box and a title in the studio look the same. The CJK Regular is the box's
 * own Noto Sans CJK, which Chrome finds through fontconfig, and the v1
 * graphics keep using it under the name "Noto Sans CJK SC".
 *
 * Director v2 sets its type in the static Black and Bold faces that
 * `scripts/fetch-cjk-font.sh --otf-only` puts in `public/fonts` (OFL,
 * 17 MB each, gitignored). They are registered here under one family of
 * their own, "Noto CJK Heavy", at weights 900 and 700 — not as "Noto Sans
 * CJK SC", because a family declared in the document hides the system
 * family of the same name for every weight, and a v1 title asking for 700
 * would then have been set in the Black, or in a synthesised bold, rather
 * than in the Regular it was designed on. Under a name of their own the two
 * faces are exactly the two weights the templates ask for, and the stack in
 * `theme.ts` falls back to the system face when the OTFs are not on the box.
 *
 * libass resolves the same OTFs as "Noto Sans CJK SC Black" for the
 * captions (Stage 0 record), so a caption and a card agree.
 */
const FACES: { family: string; file: string; weight: string }[] = [
  { family: "Inter", file: "fonts/InterVariable.ttf", weight: "100 900" },
  { family: "Noto CJK Heavy", file: "fonts/NotoSansCJKsc-Black.otf", weight: "900" },
  { family: "Noto CJK Heavy", file: "fonts/NotoSansCJKsc-Bold.otf", weight: "700" },
];

let loaded: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  if (loaded) return loaded;
  if (typeof document === "undefined") return Promise.resolve();
  const fonts = document.fonts as unknown as { add: (face: FontFace) => void };
  loaded = Promise.all(
    FACES.map((f) =>
      new FontFace(f.family, `url(${staticFile(f.file)})`, { weight: f.weight, style: "normal" })
        .load()
        .then((face) => {
          fonts.add(face);
        })
        // A missing file (the OTFs are fetched at deploy, not committed) is
        // a fallback face, not a failed render.
        .catch(() => undefined),
    ),
  ).then(() => undefined);
  return loaded;
}

/** Hold the frame until the faces are in, so the first still is not set in a fallback. */
export function useFonts() {
  if (typeof document === "undefined") return;
  const handle = delayRender("fonts");
  loadFonts().finally(() => continueRender(handle));
}
