import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  defaultAppearance,
  defaultColors,
  colorKeys,
  appearanceError,
} from "../src/appearance.ts";
assert.equal(appearanceError(defaultAppearance()), "");
const palette = { id: "test", name: "测试", ...structuredClone(defaultColors) };
const valid = { palette: "test", corners: "square", custom: [palette] };
assert.equal(appearanceError(valid), "");
assert.equal(
  appearanceError({
    palette: "p0",
    corners: "rounded",
    custom: Array.from({ length: 20 }, (_, i) => ({
      ...palette,
      id: `p${i}`,
      name: `p${i}`,
    })),
  }),
  "",
);
for (const name of ["", "   ", "name\n"])
  assert(appearanceError({ ...valid, custom: [{ ...palette, name }] }));
for (const bad of [
  null,
  {},
  { ...valid, corners: "8px" },
  { ...valid, palette: "missing" },
  { ...valid, custom: [palette, palette] },
  { ...valid, custom: [{ ...palette, name: " 默认 " }] },
  { ...valid, custom: [{ ...palette, name: "默认" }] },
  { ...valid, custom: [{ ...palette, name: "x".repeat(41) }] },
  {
    ...valid,
    custom: [
      {
        ...palette,
        light: { ...palette.light, text: "url(https://example.com)" },
      },
    ],
  },
  { ...valid, custom: [{ ...palette, dark: {} }] },
  {
    ...valid,
    custom: Array.from({ length: 21 }, (_, i) => ({
      ...palette,
      id: `p${i}`,
      name: `p${i}`,
    })),
  },
  {
    ...valid,
    custom: [
      { ...palette, name: "Test" },
      { ...palette, id: "other", name: "test" },
    ],
  },
])
  assert(appearanceError(bad), JSON.stringify(bad));
const css = await readFile(
  new URL("../src/style.css", import.meta.url),
  "utf8",
);
for (const mode of ["light", "dark"]) {
  const block = (
    mode === "light" ? css : css.split(':root[data-theme="dark"] {')[1]
  ).split("}")[0];
  for (const key of colorKeys)
    assert.equal(
      block.match(new RegExp(`--${key}: (#[a-f0-9]+);`))[1],
      defaultColors[mode][key],
    );
}
console.log(
  "PASS: appearance validation, names/IDs/limit/hex colors and immutable default palette matches CSS.",
);
