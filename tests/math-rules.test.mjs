import assert from "node:assert/strict";
import MarkdownIt from "markdown-it";
import { installMath } from "../src/math-rules.ts";
const parser = installMath(new MarkdownIt({ html: false }));
const render = (s) => parser.render(s);
for (const s of ["$x^2$", "a $\\frac{1}{2}$ b", "$a\\$b$"])
  assert.match(render(s), /data-math="inline"/);
for (const s of [
  "`$x$`",
  "```tex\n$x$\n```",
  "    $x$",
  "\\$x$",
  "$ x$",
  "$x $",
  "$5 and $10",
  "$x",
  "$$x$$",
  "$x\ny$",
])
  assert.doesNotMatch(render(s), /data-math=/, s);
assert.match(render("$$\nx^2\n$$"), /data-math="block"/);
assert.doesNotMatch(render("$$\nx^2"), /data-math=/);
assert.match(render("> $$\n> x^2\n> $$"), /data-math="block"/);
assert.match(render("$<script>alert(1)</script>$"), /&lt;script&gt;/);
assert.deepEqual(
  parser
    .parse("# Heading\n\n$$\nx\n$$", {})
    .find((t) => t.type === "mdmd-math-block").map,
  [2, 5],
);
console.log(
  "PASS: inline/block math delimiters, escape/currency/unclosed/code exclusion, quoted block, HTML escaping and source map.",
);
