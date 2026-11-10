import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export async function testRichEdit({ page, root, dialog, waitFor }) {
  const file = path.join(root, "直接排版编辑.md");
  const source =
    "# 标题\n\n开头 **粗体** 和 *斜体*、~~删线~~、==高亮==、[链接](https://example.com)。\n\n第二段 😀 保留。\n\n- 父项\n  - 子项\n- 另一项\n\n> 引用内容\n\n```js\nconst keep = 1;\n```\n\n## 二级\n\n### 三级\n\n#### 四级\n\n##### 五级\n\n###### 六级\n\n结尾原样";
  await writeFile(file, "\ufeff" + source.replaceAll("\n", "\r\n"));
  await page
    .locator((await page.locator("#home").isVisible()) ? "#home-open" : "#open")
    .click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const rich = () => page.locator("#inline-rich");
  async function caret(selector, offset) {
    const point = await page.locator(selector).evaluate((node, offset) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      const range = document.createRange();
      range.setStart(text, offset);
      range.collapse(true);
      const r = range.getBoundingClientRect();
      return { x: r.x + 0.2, y: r.y + r.height / 2 };
    }, offset);
    await page.mouse.click(point.x, point.y);
  }
  await caret("#preview > p strong", 1);
  await page.locator("#inline-mode").click();
  await rich().waitFor();
  assert(!(await page.locator("#inline-source").isVisible()));
  assert.equal(await rich().locator("strong").innerText(), "粗体");
  await page.keyboard.insertText("新");
  assert.equal(
    await rich().locator("strong").innerText(),
    "粗新体",
    "clicked text position is used",
  );
  assert.equal(
    (await native()).content,
    source,
    "visual draft not written to document",
  );
  await page.keyboard.press("Control+z");
  assert.equal(await rich().locator("strong").innerText(), "粗体");
  await page.keyboard.press("Control+y");
  assert.equal(await rich().locator("strong").innerText(), "粗新体");
  await page.locator("#inline-cancel").click();
  assert.equal((await native()).content, source);
  await caret("#preview > p strong", 1);
  await page.locator("#inline-mode").click();
  await page.keyboard.insertText("新");
  await page.locator("#inline-apply").click();
  await waitFor(
    async () => (await native()).content.includes("粗新体"),
    "rich apply",
  );
  const first = (await native()).content;
  assert(first.startsWith("# 标题\n\n"));
  assert(first.endsWith("结尾原样"));
  assert(first.includes("```js\nconst keep = 1;\n```"));
  await waitFor(
    async () =>
      (await page.locator("#preview > p strong").innerText()) === "粗新体",
    "preview updated",
  );
  assert.equal(await page.locator("#preview em").innerText(), "斜体");
  assert.equal(
    await page.locator("#preview a").getAttribute("href"),
    "https://example.com",
  );
  // Select a different block while editing: apply once, then edit the clicked block.
  await caret("#preview h1", 1);
  await page.locator("#inline-mode").click();
  await page.keyboard.insertText("改");
  await page.locator("#preview > p").filter({ hasText: "第二段" }).click();
  assert(await rich().isVisible());
  assert.match(await rich().innerText(), /第二段/);
  assert((await native()).content.startsWith("# 标改题"));
  await page.locator("#inline-cancel").click();
  // Nested lists retain their structure; changes are Markdown, never HTML.
  await caret("#preview li li", 1);
  await page.locator("#inline-mode").click();
  await page.keyboard.insertText("新");
  await page.locator("#inline-apply").click();
  await waitFor(
    async () => (await native()).content.includes("子新项"),
    "nested list apply",
  );
  assert.equal(await page.locator("#preview li li").count(), 1);
  await caret("#preview blockquote p", 2);
  await page.locator("#inline-mode").click();
  await page.keyboard.insertText("测试");
  await rich().dispatchEvent("compositionstart");
  await page.locator("#inline-apply").click();
  assert(await rich().isVisible(), "IME guard keeps draft");
  await rich().dispatchEvent("compositionend");
  await page.locator("#inline-apply").click();
  await page.locator("#save").click();
  await page.locator('#save-status[data-state="saved"]').waitFor();
  const bytes = await readFile(file, "utf8");
  assert(bytes.startsWith("\ufeff"));
  assert(bytes.includes("\r\n"));
  assert(!bytes.includes("<strong>"));
  // Code remains on its existing source editor.
  await page.locator("#preview pre").click();
  await page.locator("#inline-mode").click();
  assert(await page.locator("#inline-source").isVisible());
  assert.equal(await rich().count(), 0);
  // Source-only blocks must also allow click-to-switch, including changed line counts.
  await page
    .locator("#inline-source .cm-content")
    .fill("```js\nconst keep = 1;\nconst added = 2;\n```\n");
  await page.locator("#preview h2").scrollIntoViewIfNeeded();
  await caret("#preview h2", 1);
  assert(
    await rich().isVisible(),
    "code draft switches to clicked formatted block",
  );
  assert.equal(await rich().locator("h2").innerText(), "二级");
  await page.keyboard.insertText("新");
  assert.equal(await rich().locator("h2").innerText(), "二新级");
  await waitFor(
    async () => (await native()).content.includes("const added = 2;"),
    "source draft applied on switch",
  );
  await page.locator("#inline-source-toggle").click();
  await page.locator("#preview > p strong").scrollIntoViewIfNeeded();
  await caret("#preview > p strong", 1);
  assert(
    await rich().isVisible(),
    "explicit source mode can switch back to formatted text",
  );
  assert.equal(await rich().locator("strong").innerText(), "粗新体");
  await page.keyboard.insertText("切");
  assert.equal(await rich().locator("strong").innerText(), "粗切新体");
  await rich().dispatchEvent("compositionstart");
  await page.locator("#preview h2").click();
  assert.equal(
    await rich().locator("strong").innerText(),
    "粗切新体",
    "composition refuses switch without losing the draft",
  );
  await rich().dispatchEvent("compositionend");
  await page.locator("#inline-cancel").click();
  await caret("#preview > p strong", 1);
  await page.locator("#inline-mode").click();
  // Rich selection formatting must stay visible and undoable within the draft.
  await rich().evaluate((area) => {
    const text = area.querySelector("p").firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    area.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.locator("#format-action").selectOption("highlight");
  assert.equal(await rich().locator("mark").first().innerText(), "开头");
  await page.keyboard.press("Control+z");
  assert.equal(await rich().locator("mark").count(), 1);
  await rich().evaluate((area) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "<script>window.injected=1</script>");
    clipboardData.setData(
      "text/html",
      '<img src=x onerror="window.injected=1">',
    );
    area.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  });
  assert.equal(await rich().locator("script,img").count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert((await rich().innerText()).includes("<script>"));
  await page.locator("#inline-cancel").click();
  for (let level = 2; level <= 6; level++) {
    await page.locator(`#preview h${level}`).scrollIntoViewIfNeeded();
    await caret(`#preview h${level}`, 1);
    await page.locator("#inline-mode").click();
    assert(await rich().locator(`h${level}`).isVisible());
    await page.keyboard.insertText("测");
    assert((await rich().locator(`h${level}`).innerText()).includes("测"));
    await page.locator("#inline-cancel").click();
  }
  await page.locator("#preview a").scrollIntoViewIfNeeded();
  // Links in reading retain their normal open action; edit the parent, then the link text.
  await caret("#preview > p strong", 1);
  await page.locator("#inline-mode").click();
  await caret("#inline-rich a", 1);
  await page.keyboard.insertText("新");
  assert.equal(
    await rich().locator("a").getAttribute("href"),
    "https://example.com",
  );
  await page.screenshot({ path: path.join(root, "rich-inline-edit.png") });
  await page.locator("#inline-cancel").click();
  // The switch regression intentionally applied code/heading changes after the earlier save.
  await page.locator("#save").click();
  await page.locator('#save-status[data-state="saved"]').waitFor();
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    `PASS: visual styles/clicked caret/draft/apply/cancel/undo/redo, cross-block, nested list/quote, IME, BOM/CRLF/code fallback. Evidence: ${root}`,
  );
  return page;
}
