import assert from "node:assert/strict";
import MarkdownIt from "markdown-it";
import { installExtensions } from "../src/extensions.ts";
const md = installExtensions(new MarkdownIt({ html: false }));
const source =
  "正文[^a] 重复[^a] 未定义[^none]\n\n> [!TIP]\n> 提示引用[^a]\n\n[^a]: 第一段 **粗体**\n\n    第二段\n\n    - 列表\n\n末段\n";
const result = md.render(source);
assert.equal((result.match(/id="fnref-1-/g) || []).length, 3);
assert.equal((result.match(/class="footnote-back"/g) || []).length, 3);
assert.match(result, /<p>第二段<\/p>/);
assert.match(result, /<li>列表<\/li>/);
assert.match(result, /未定义\[\^none\]/);
assert.match(result, /TIP|Tip/);
assert(!result.includes("<script>"));
const html = md.render(
  "x[^a]\n\n[^a]: <script>alert(1)</script>\n\n[^a]: duplicate\n",
);
assert(!html.includes("<script>"));
assert.match(html, /duplicate/);
const empty = md.render("x[^e]\n\n[^e]:\n    body\n");
assert.match(empty, /body/);
assert(!md.render("[^notdefined]").includes("footnote-ref"));
console.log(
  "PASS: multiline/blank/empty/duplicate/undefined footnotes, repeated and alert references have unique IDs/backlinks; HTML escaped.",
);
