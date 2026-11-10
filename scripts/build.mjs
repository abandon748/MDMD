import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/renderer.ts"],
  bundle: true,
  outfile: "dist/renderer.js",
  platform: "browser",
  target: "chrome130",
  sourcemap: true,
});
await Promise.all(
  ["index.html", "style.css"].map((name) =>
    copyFile(`src/${name}`, `dist/${name}`),
  ),
);
console.log("Built dist/");
