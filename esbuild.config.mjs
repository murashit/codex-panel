import esbuild from "esbuild";

import { buildStyles } from "./scripts/build-styles.mjs";

await buildStyles();

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  platform: "node",
  target: "es2022",
  jsx: "automatic",
  outfile: "main.js",
  sourcemap: false,
  minify: true,
  logLevel: "info",
});
