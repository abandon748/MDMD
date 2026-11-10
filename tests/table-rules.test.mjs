import assert from "node:assert/strict";
import MarkdownIt from "markdown-it";
import {
  parseTable,
  writeTable,
  newTable,
  tableInsertionPosition,
} from "../src/table-model.ts";
const md = new MarkdownIt({ html: false });
const source =
  "\n| **A** | `B` |\n| :-- | --: |\n| x\\|y | [a][ref] |\n| 中文😀 | \\末尾 |\n\n";
const m = parseTable(source);
assert.deepEqual(m.align, ["left", "right"]);
assert.equal(m.cells[1][0], "x\\|y");
const render = (s) => md.render(s);
assert.equal(render(writeTable(m)), render(source));
assert.equal(parseTable(writeTable(m)).prefix, "\n");
assert.equal(parseTable(writeTable(m)).suffix, "\n\n");
m.cells[1][0] = "a|b";
assert.equal(parseTable(writeTable(m)).cells[1][0], "a\\|b");
for (const s of [
  "",
  "A|B\n---|---\nx",
  "A|B\n---|---\nx|y|z",
  "> A|B\n> ---|---",
  "A|B\n---|---\nx|y\n\n[ref]: /a",
  "# x\n\nA|B\n---|---",
  "A|B\n---|---\nx|y\n\nC|D\n---|---",
])
  assert.throws(() => parseTable(s), s);
for (const ending of ["", "text", "text\n", "text\n\n", "```\ncode\n```"])
  assert.equal(
    md.parse(ending + newTable(ending), {}).at(-1).type,
    "table_close",
  );
assert.throws(() => newTable("```\nunclosed"));
const positions =
  "# H\n\nparagraph\n\n- A\n  - B\n\n> quote\n\n```js\nx\n```\n\nend";
for (const [needle, next] of [
  ["H", "\nparagraph"],
  ["paragraph", "\n- A"],
  ["B", "> quote"],
  ["quote", "\n```js"],
  ["x\n", "\nend"],
]) {
  const point = tableInsertionPosition(positions, positions.indexOf(needle));
  assert.equal(
    positions.slice(point),
    positions.slice(positions.indexOf(next)),
  );
}
assert.equal(tableInsertionPosition(positions, 4), 4);
assert.equal(tableInsertionPosition("", 0), 0);
assert.throws(() => tableInsertionPosition(positions, -1));
assert.throws(() =>
  parseTable(
    "|" +
      Array(51).fill(" a ").join("|") +
      "|\n|" +
      Array(51).fill("---").join("|") +
      "|",
  ),
);
m.cells[1][0] = "line\nnext";
assert.throws(() => writeTable(m));
assert.equal(parseTable("a|b\n---|---").cells.length, 1);
console.log(
  "PASS: table raw Markdown/escaped pipes/Unicode/alignment, semantic roundtrip, strict rectangular/top-level/bounded tables, whitespace retention, safe append and unclosed fence rejection.",
);
