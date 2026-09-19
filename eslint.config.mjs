import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    /**
     * The design canvas, which is not application code.
     *
     * `public/app/**` is the browsable copy of the artboards (`/demo`), and
     * `design/canvas/**` is the artboards themselves. Both are hand-authored
     * ES5 for a standalone HTML runtime with no build step, so the rules that
     * make sense for the app (no `this` aliasing, no unused catch bindings)
     * are noise here. The shipped screens are the transcriptions in
     * `components/canvas/`, and those are linted like everything else.
     */
    "public/app/**",
    "design/canvas/**",
    // A standalone Tailwind sandbox for trying the design tokens; it has its
    // own toolchain and is not part of the app.
    "design/espresso-preview/**",
  ]),

  {
    /**
     * pm2 loads its process definition with `require`, so the file has to be
     * CommonJS. The rule is right for the app and wrong for this one file.
     */
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
