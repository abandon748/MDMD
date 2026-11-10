import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { english } from "../src/messages.ts";
import { t, setLocale, validLanguage } from "../src/i18n.ts";
import { defaultShortcuts, bindingError } from "../src/shortcuts.ts";
import { appearanceError } from "../src/appearance.ts";

for (const value of ["system", "zh-CN", "en"]) assert(validLanguage(value));
for (const value of [undefined, null, "fr", "zh-TW", 1, {}])
  assert(!validLanguage(value));
const slots = (s) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort();
for (const [key, value] of Object.entries(english)) {
  assert(value.trim(), key);
  assert.deepEqual(slots(value), slots(key), `placeholder mismatch: ${key}`);
}
// Catch new untranslated owned messages without scanning or modifying user data.
for (const file of [
  "renderer",
  "preview-tools",
  "flow-canvas",
  "diagram-labels",
  "graph-tools",
  "rich-edit",
  "preview-search",
  "syntax",
  "math",
  "diagrams",
  "flow-edit",
  "output",
  "versions",
  "embeds",
  "outline",
  "shortcuts",
  "appearance",
  "custom-css",
  "link-preview",
  "integration",
  "app-icon",
  "engines",
  "feedback",
  "table-edit",
]) {
  const source = await readFile(`src/${file}.ts`, "utf8");
  for (const match of source.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*")/g)) {
    const key = JSON.parse(match[1]);
    assert(Object.hasOwn(english, key), `missing translation: ${key}`);
  }
}
setLocale("en");
assert.equal(t("已保存"), "Saved");
assert.equal(t("从{0}选择文档", ["$& 设置"]), "Choose a document from $& 设置");
assert.match(bindingError(defaultShortcuts(), "save", "Ctrl+O"), /Open file/);
assert.equal(appearanceError(null), "Invalid palette record");
assert.equal(t("用户正文不翻译"), "用户正文不翻译");
setLocale("zh-CN");
assert.equal(t("已保存"), "已保存");
console.log(
  "PASS: language enum, catalog completeness/placeholders, translated validation, literal interpolation and Chinese fallback.",
);
