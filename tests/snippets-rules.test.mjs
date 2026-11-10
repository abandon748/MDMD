import assert from "node:assert/strict";
import {
  snippets,
  snippetRange,
  snippetEdit,
  snippetText,
} from "../src/snippets.ts";
import { english } from "../src/messages.ts";
assert.equal(Object.keys(snippets).length, 9);
for (const [key, info] of Object.entries(snippets)) {
  assert(english[info.label]);
  const edit = snippetEdit("Before\n\n/\n\nAfter", 9, key, "中文😀");
  assert.equal(edit.from, 8);
  assert.equal(edit.to, 9);
  const output =
    "Before\n\n/\n\nAfter".slice(0, edit.from) +
    edit.insert +
    "Before\n\n/\n\nAfter".slice(edit.to);
  assert(output.startsWith("Before\n\n"));
  assert(output.endsWith("\n\nAfter"));
  assert(!output.includes("{0}"));
  assert.equal(snippetText(key, "X"), info.body.replaceAll("{0}", "X"));
}
assert.deepEqual(snippetRange("", 0), { from: 0, to: 0 });
assert.deepEqual(snippetRange("\n", 0), { from: 0, to: 0 });
assert.deepEqual(snippetRange("/", 1), { from: 0, to: 1 });
assert.deepEqual(snippetRange("Before\n\n", 8), { from: 8, to: 8 });
for (const [s, pos] of [
  ["https:/", 7],
  ["```\n/\n```", 5],
  ["    /", 5],
  ["- /", 3],
  ["> /", 3],
  ["Text", 0],
  ["x".repeat(262145), 0],
  ["", -1],
  ["", 1],
  ["", NaN],
])
  assert.equal(snippetRange(s, pos), null);
assert.equal(
  snippetEdit("Before\n/\nAfter", 8, "heading", "X").insert,
  "\n# X\n",
);
assert.throws(() => snippetEdit("not empty", 0, "heading", "X"));
assert.throws(() => snippetText("constructor", "X"));
console.log(
  "PASS: all nine templates/translations, top-level range/code/nesting/size rejection, Unicode, surrounding bytes and block separators.",
);
