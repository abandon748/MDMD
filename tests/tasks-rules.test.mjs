import assert from "node:assert/strict";
import MarkdownIt from "markdown-it";
import { installTasks, taskChange } from "../src/tasks.ts";
const parser = installTasks(new MarkdownIt({ html: false }));
const source =
  "- [ ] one\n  - [X] nested\n\n> - [x] quoted\n\n```\n- [ ] code\n```\n";
const html = parser.render(source);
const offsets = [...html.matchAll(/data-task-offset="(\d+)"/g)].map(
  (m) => +m[1],
);
assert.equal(offsets.length, 3);
assert.deepEqual(
  offsets.map((i) => source[i]),
  [" ", "X", "x"],
);
for (const offset of offsets) {
  const change = taskChange(source, offset);
  const result =
    source.slice(0, change.from) + change.insert + source.slice(change.to);
  assert.equal(result.length, source.length);
}
assert.throws(() => taskChange(source, 0));
assert.throws(() => taskChange(source, 2));
assert(!parser.render("ordinary [ ] text").includes("checkbox"));
console.log(
  "PASS: task mapping including nesting/quotes, fenced exclusion and one-character changes.",
);
