import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export async function testTableInsertion({ page, root, dialog, waitFor }) {
  const file = path.join(root, "表格插入定位.md");
  const original =
    "# 标题\n\n第一段文字\n\n- 列表一\n  - 子项\n- 列表二\n\n> 引用文字\n\n```js\nconst keep = 1;\n```\n\n最后一段";
  await writeFile(file, "\ufeff" + original.replaceAll("\n", "\r\n"));
  await page.locator("#home-open").click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const expect = (value) =>
    waitFor(
      async () => (await native()).content === value,
      "exact table insertion source",
    );
  async function insert(prefix, suffix, key = false) {
    if (key) await page.keyboard.press("Control+t");
    else await page.locator("#insert-table").click();
    await page
      .locator('#table-grid input[data-row="0"][data-col="0"]')
      .fill("定位表头");
    if (prefix === "# 标题")
      await page.screenshot({
        path: path.join(root, "table-insertion-after-heading.png"),
      });
    await page.locator("#inline-apply").click();
    await waitFor(
      async () => (await native()).content.includes("定位表头"),
      "table applied",
    );
    const text = (await native()).content;
    assert(text.startsWith(prefix), "prefix outside insertion unchanged");
    assert(text.endsWith(suffix), "suffix outside insertion unchanged");
    const index = text.indexOf("| 定位表头");
    assert(
      index >= prefix.length && index < text.length - suffix.length,
      "table is between clicked block and following source",
    );
    assert.equal(await page.locator("#preview table").count(), 1);
    await page.keyboard.press("Control+z");
    await expect(original);
    await page.locator('#save-status[data-state="saved"]').waitFor();
    await waitFor(
      async () => (await page.locator("#preview table").count()) === 0,
      "preview caught up after undo",
    );
  }
  for (const [selector, end] of [
    ["#preview h1", original.indexOf("第一段")],
    ["#preview > p:first-of-type", original.indexOf("- 列表一")],
    ["#preview ul ul li", original.indexOf("> 引用")],
    ["#preview blockquote p", original.indexOf("```js")],
    ["#preview pre code", original.indexOf("最后一段")],
  ]) {
    await page.locator(selector).click();
    // Block maps may include the separator blank line, but no content is replaced.
    const prefix = original.slice(0, end).trimEnd();
    const suffix = original.slice(end);
    await insert(prefix, suffix);
  }
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown"); // top-level empty line after the heading
  await insert(
    "# 标题\n",
    "\n第一段文字" + original.split("第一段文字")[1],
    true,
  );
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await insert(
    original.slice(0, original.indexOf("- 列表一")).trimEnd(),
    original.slice(original.indexOf("- 列表一")),
  );
  await page.locator("#split-mode").click();
  await page.locator("#preview blockquote p").click();
  await insert(
    original.slice(0, original.indexOf("```js")).trimEnd(),
    original.slice(original.indexOf("```js")),
  );
  await page.locator("#preview > p:first-of-type").click();
  await page.locator("#inline-mode").click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("保留草稿");
  await page.locator("#insert-table").click();
  await page.locator("#table-grid").waitFor();
  await page.locator("#inline-cancel").click();
  assert(
    (await native()).content.includes("保留草稿"),
    "cancel table keeps previously applied text draft",
  );
  const richDraft = (await native()).content;
  await page.locator("#preview > p:first-of-type").click();
  await page.locator("#inline-mode").click();
  await page.locator("#insert-table").click();
  await page
    .locator('#table-grid input[data-row="0"][data-col="0"]')
    .fill("就地插表");
  await page.locator("#inline-apply").click();
  await waitFor(
    async () => (await native()).content.includes("就地插表"),
    "inline table applied",
  );
  let inserted = (await native()).content;
  assert(inserted.indexOf("就地插表") > inserted.indexOf("保留草稿"));
  assert(inserted.indexOf("就地插表") < inserted.indexOf("- 列表一"));
  await page.keyboard.press("Control+z");
  await expect(richDraft);
  await page.keyboard.press("Control+z");
  await expect(original);
  await page.locator("#refresh").click();
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.insertText("源码输入");
  await page.keyboard.press("Control+t");
  await page
    .locator('#table-grid input[data-row="0"][data-col="0"]')
    .fill("即时插表");
  await page.locator("#inline-apply").click();
  await waitFor(
    async () => (await native()).content.includes("即时插表"),
    "immediate source table applied",
  );
  inserted = (await native()).content;
  assert(inserted.indexOf("即时插表") > inserted.indexOf("源码输入"));
  assert(inserted.indexOf("即时插表") < inserted.indexOf("- 列表一"));
  await page.keyboard.press("Control+z");
  await expect(original.replace("第一段文字", "第一段文字源码输入"));
  await page.keyboard.press("Control+z");
  await expect(original);
  await page.locator("#refresh").click();
  await page.locator("#preview h1").click();
  await page.locator("#insert-table").click();
  await page
    .locator('#table-grid input[data-row="0"][data-col="0"]')
    .fill("保存位置");
  await page.locator("#save").click();
  await page.locator('#save-status[data-state="saved"]').waitFor();
  const saved = (await native()).content;
  assert(saved.indexOf("保存位置") < saved.indexOf("第一段文字"));
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" + saved.replaceAll("\n", "\r\n"),
  );
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    `PASS: table insertion after selected heading/paragraph/list/quote/code, source empty-line caret and shortcut, applied rich draft retained on table cancel, undo and BOM/CRLF save. Evidence: ${root}`,
  );
}
