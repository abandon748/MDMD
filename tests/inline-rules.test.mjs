import assert from "node:assert/strict";
import {
  blockRange,
  blockReplacement,
  codeSourcePosition,
} from "../src/inline-edit.ts";
const source = "# 同名\n\n# 同名\n\n😀 no newline";
const range = blockRange(source, 3, 4);
assert.equal(source.slice(range.from, range.to), "# 同名\n");
assert.equal(blockReplacement("# 同名\n", "# 新标题"), "# 新标题\n");
assert.equal(blockReplacement("last", "new"), "new");
assert.equal(blockReplacement("last\n", ""), "");
assert.equal(blockReplacement("- item\n\n", "- changed\n"), "- changed\n\n");
assert.equal(blockReplacement("- item\n\n", "- changed"), "- changed\n\n");
assert.equal(
  blockReplacement("- item\n\n", "- changed\n\n\n"),
  "- changed\n\n\n",
);
assert.equal(source.slice(blockRange(source, 5, 6).from), "😀 no newline");
assert.equal(
  codeSourcePosition("```js\nconst a\nconst a\n```", "const a\nconst a\n", 14),
  20,
);
assert.equal(codeSourcePosition("  ~~~js\n  abc\n  ~~~", "abc\n", 2), 12);
assert.equal(
  codeSourcePosition("    first\n\n    second\n", "first\n\nsecond\n", 9),
  17,
);
assert.equal(codeSourcePosition("```\nabc\n```", "stale", 2), null);
for (const args of [
  [0, 1],
  [1, 1],
  [1, 100],
  [1.2, 2],
  [NaN, 2],
])
  assert.throws(() => blockRange(source, ...args));
console.log(
  "PASS: exclusive line ranges, duplicates, Unicode, end-of-file, block newline preservation/deletion and invalid mappings.",
);
