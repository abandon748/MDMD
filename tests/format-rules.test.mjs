import assert from "node:assert/strict";
import MarkdownIt from "markdown-it";
import { formatEdit, installHighlight } from "../src/format-edit.ts";
import {
  actions,
  combinationError,
  bindings,
  defaultShortcuts,
  validShortcuts,
} from "../src/shortcuts.ts";
const apply = (s, e) => s.slice(0, e.from) + e.insert + s.slice(e.to);
for (const [action, expected] of Object.entries({
  bold: "**字😀**",
  italic: "*字😀*",
  strike: "~~字😀~~",
  highlight: "==字😀==",
  code: "`字😀`",
})) {
  const source = "前 字😀 后",
    e = formatEdit(source, 2, 5, action, "文本");
  const changed = apply(source, e);
  assert.equal(changed, `前 ${expected} 后`);
  assert.equal(
    apply(changed, formatEdit(changed, e.anchor, e.head, action, "文本")),
    source,
  );
}
assert.equal(formatEdit(" a ", 0, 3, "bold", "文本").insert, " **a** ");
assert.equal(formatEdit("", 0, 0, "bold", "文本").insert, "**文本**");
for (const text of ["a`b", "`edge`", " space ", "  "]) {
  const e = formatEdit(text, 0, text.length, "code", "文本");
  assert.equal(
    apply(e.insert, formatEdit(e.insert, e.anchor, e.head, "code", "文本")),
    text,
  );
  assert.equal(
    formatEdit(e.insert, 0, e.insert.length, "code", "文本").insert,
    text,
  );
}
let list = "  A\n  B";
for (const value of [
  "  - A\n  - B",
  "  1. A\n  2. B",
  "  - [ ] A\n  - [ ] B",
  "  A\n  B",
]) {
  list = apply(list, formatEdit(list, 0, list.length, "listCycle", "文本"));
  assert.equal(list, value);
}
const q = formatEdit("before\nA\nB\nafter", 7, 11, "quote", "文本");
assert.equal(apply("before\nA\nB\nafter", q), "before\n> A\n> B\nafter");
assert.equal(formatEdit("\nnext", 0, 0, "quote", "文本").insert, "> ");
assert.equal(
  formatEdit(
    "**bold** [link](url) ==亮==",
    0,
    "**bold** [link](url) ==亮==".length,
    "clear",
    "文本",
  ).insert,
  "bold link 亮",
);
const multi = "a\n```\nb";
const code = formatEdit(multi, 0, multi.length, "code", "文本");
assert.match(code.insert, /^````\n/);
assert.equal(
  formatEdit(code.insert, 0, code.insert.length, "code", "文本").insert,
  multi,
);
const parser = installHighlight(new MarkdownIt({ html: false }));
assert.match(parser.render("==**亮**=="), /<mark><strong>亮<\/strong><\/mark>/);
assert.match(parser.render("`==literal==`"), /<code>==literal==<\/code>/);
assert(!parser.render("```\n==literal==\n```").includes("<mark>"));
assert(!parser.render("\\==literal==").includes("<mark>"));
assert(!parser.render("==<script>x</script>==").includes("<script>"));
assert.throws(() => formatEdit("x", -1, 1, "bold", "文本"));
assert.throws(() => formatEdit("x".repeat(262145), 0, 0, "clear", "文本"));
const old = defaultShortcuts();
old.overrides.mdmd.new = "Ctrl+B";
assert(validShortcuts(old));
assert.equal(bindings(old).new, "Ctrl+B");
assert.notEqual(bindings(old).bold, "Ctrl+B");
const assigned = Object.values(bindings(old)).filter(Boolean);
assert.equal(new Set(assigned).size, assigned.length);
assert.equal(bindings(old).quote, "");
assert.equal(bindings(old).code, "");
console.log(
  "PASS: scoped formatting, toggle/selection, whitespace/Unicode, line boundaries, four list states, plain text/links/highlights, safe dynamic fences, escaped/code highlight exclusion, range bounds and old custom-key priority.",
);

const crowded = defaultShortcuts();
const pool = [
  "F2",
  "F3",
  "F4",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789"].map((k) => `Ctrl+Shift+${k}`),
].filter((k) => !combinationError(k));
Object.keys(actions)
  .filter((a) => a !== "bold")
  .forEach((a, i) => {
    crowded.overrides.mdmd[a] = pool[i];
  });
assert(validShortcuts(crowded));
assert(Object.values(bindings(crowded)).every((k) => typeof k === "string"));
assert.equal(new Set(Object.values(bindings(crowded))).size, 22);
