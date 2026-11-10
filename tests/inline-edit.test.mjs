import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export async function testInlineEdit({ page, root, dialog, waitFor, restart }) {
  const dir = path.join(root, "inline-edit");
  await mkdir(dir);
  const file = path.join(dir, "就地 😀.md");
  const source =
    "# 同名\n\n保留 **首段** 😀\n\n# 同名\n\n第二段 [link][ref]\n\n- 一\n  - 子项\n- 二\n\n> 引用\n>\n> - 内层\n\n```js\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[ref]: https://example.com\n\n结尾不带换行";
  await writeFile(file, "\ufeff" + source.replaceAll("\n", "\r\n"));
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  const state = (value) =>
    waitFor(
      async () =>
        (await page.locator("#save-status").getAttribute("data-state")) ===
        value,
      value,
    );
  const block = () => page.locator("#inline-source .cm-content");
  async function edit(value) {
    if (await page.locator("#inline-source-toggle").isVisible())
      await page.locator("#inline-source-toggle").click();
    await block().focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText(value);
  }
  async function open(file) {
    await page
      .locator(
        (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
      )
      .click();
    await dialog(file);
    await idle();
  }
  async function enter(selector, nth = 0) {
    await page.locator(selector).nth(nth).click({ button: "right" });
    // Recreate the delayed preview render while the context menu is open.
    await page.evaluate(() => document.getElementById("refresh").click());
    await page.locator("#menu-inline").click();
    if (await page.locator("#inline-source-toggle").isVisible())
      await page.locator("#inline-source-toggle").click();
    if (await page.locator("#inline-source-toggle").isVisible())
      await page.locator("#inline-source-toggle").click();
    await block().waitFor();
  }
  await open(file);
  const initial = await native();
  await enter("#preview h1", 1);
  assert.equal(await page.locator("#preview > h1:not([hidden])").count(), 1);
  await edit("# 修改第二个标题");
  await state("inline-draft");
  assert.equal(
    (await native()).content,
    source,
    "block draft has not replaced document",
  );
  await page.keyboard.press("Control+z");
  await waitFor(
    async () => (await block().innerText()).includes("同名"),
    "local undo",
  );
  await page.keyboard.press("Control+y");
  await waitFor(
    async () => (await block().innerText()).includes("修改第二个标题"),
    "local redo",
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#inline-source").count(), 0);
  assert.equal((await native()).content, source);
  await enter("#preview h1", 1);
  await edit("# 修改第二个标题");
  await page.keyboard.press("Control+Enter");
  await state("dirty");
  const modified = source.replace(
    "# 同名\n\n第二段",
    "# 修改第二个标题\n\n第二段",
  );
  assert.equal(
    (await native()).content,
    modified,
    "replace by exact range, preserve reference and all other bytes",
  );
  assert.equal((await native()).id, initial.id);
  await page.keyboard.press("Control+z");
  await state("saved");
  assert.equal((await native()).content, source);
  await page.keyboard.press("Control+y");
  await state("dirty");
  assert.equal((await native()).content, modified);
  await page.locator("#save").click();
  await idle();
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" + modified.replaceAll("\n", "\r\n"),
  );

  // Nested DOM nodes select the enclosing top-level source block.
  for (const [selector, expected] of [
    ["#preview ul li", "- 一\n  - 子项\n- 二\n"],
    ["#preview blockquote li", "> 引用\n>\n> - 内层\n"],
    ["#preview pre code", "```js\nconst x = 1;\n```\n"],
    ["#preview table td", "| A | B |\n|---|---|\n| 1 | 2 |\n"],
  ]) {
    await enter(selector);
    await page.keyboard.press("Control+a");
    // Copy-free check of CodeMirror's rendered lines for these small blocks.
    assert.equal(
      (await block().innerText()).replaceAll("\r", "").trimEnd(),
      expected.trimEnd(),
    );
    await edit("临时取消");
    await page.locator("#inline-cancel").click();
    assert.equal((await native()).content, modified);
  }
  await enter("#preview pre code");
  await edit("```js\nconst x = 2;\n```");
  await page.keyboard.press("Control+s");
  await idle();
  await state("saved");
  const saved = modified.replace("const x = 1;", "const x = 2;");
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" + saved.replaceAll("\n", "\r\n"),
  );
  assert.equal((await native()).content, saved);
  await enter("#preview > p", 2); // final paragraph; no terminal newline
  await edit("新结尾 <script>window.inlineInjected=true</script>");
  await page.locator("#read-mode").click();
  await state("dirty");
  const ending = saved.replace(
    "结尾不带换行",
    "新结尾 <script>window.inlineInjected=true</script>",
  );
  assert.equal((await native()).content, ending);
  assert.equal(await page.evaluate(() => window.inlineInjected), undefined);
  assert.equal(await page.locator("#preview script").count(), 0);
  await enter("#preview h1");
  await edit("# 关闭草稿");
  await page.locator("#home-back").click();
  await page.locator("button[value=cancel]").click();
  await idle();
  assert((await native()).content.startsWith("# 关闭草稿"));
  assert.equal(
    await page.locator("#inline-source").count(),
    0,
    "leaving applies draft before document guard",
  );
  await page.locator("#save").click();
  await idle();

  // Disk changes do not replace staged source; rejected save keeps the applied draft.
  await enter("#preview h1");
  await edit("# 内部冲突草稿");
  await writeFile(file, "# 外部版本\n必须保留");
  await state("conflict");
  assert((await block().innerText()).includes("内部冲突草稿"));
  await page.keyboard.press("Control+s");
  await idle();
  assert.match(await page.locator("#error-text").innerText(), /已停止保存/);
  assert((await native()).content.startsWith("# 内部冲突草稿"));
  assert.equal(await readFile(file, "utf8"), "# 外部版本\n必须保留");
  await page.locator("#reload").click();
  await page.locator("button[value=cancel]").click();
  await idle();
  assert((await native()).content.startsWith("# 内部冲突草稿"));
  await page.locator("#reload").click();
  await page.locator("button[value=discard]").click();
  await idle();
  await state("saved");
  assert.equal((await native()).content, "# 外部版本\n必须保留");
  await page.keyboard.press("F2");
  if (await page.locator("#inline-source-toggle").isVisible())
    await page.locator("#inline-source-toggle").click();
  await block().waitFor();
  await edit("# 外部版本已编辑");
  await page.setViewportSize({ width: 640, height: 720 });
  await page.screenshot({ path: path.join(root, "inline-edit-640.png") });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1320, height: 860 });
  await page.keyboard.press("Escape");

  // A composition in progress must not be applied by an action button.
  await page.keyboard.press("F2");
  await edit("# 输入法草稿");
  await block().dispatchEvent("compositionstart", { data: "中" });
  await block().dispatchEvent("compositionupdate", { data: "中文" });
  await page.locator("#inline-apply").evaluate((button) => button.click());
  assert.equal(await page.locator("#inline-source").count(), 1);
  assert.match(await page.locator("#error-text").innerText(), /输入法组合/);
  assert.equal((await native()).content, "# 外部版本\n必须保留");
  await block().dispatchEvent("compositionend", { data: "中文" });
  await page.locator("#inline-cancel").click();
  await page.locator("#inline-source").waitFor({ state: "detached" });

  // Large documents deliberately defer preview. Old source mapping cannot be used.
  const large = path.join(dir, "映射待刷新.md");
  await writeFile(large, "# 待刷新\n\n" + "正文\n\n".repeat(270000));
  await open(large);
  await page.keyboard.press("F2");
  assert.equal(await page.locator("#inline-source").count(), 0);
  assert.match(await page.locator("#error-text").innerText(), /映射已过期/);

  // Empty buffer can be edited in place; Save As cancellation keeps the applied text.
  await page.locator("#new").click();
  await idle();
  await page.keyboard.press("F2");
  if (await page.locator("#inline-source-toggle").isVisible())
    await page.locator("#inline-source-toggle").click();
  await block().waitFor();
  await edit("# 空文档的新内容");
  await page.keyboard.press("Control+s");
  await dialog("", true);
  await idle();
  assert.equal((await native()).content, "# 空文档的新内容");
  assert.equal((await native()).path, null);
  await page.locator("#home-back").click();
  await page.locator("button[value=discard]").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  const readOnly = path.join(dir, "混合.md");
  await writeFile(readOnly, "# 混合\r\n\n保留\r\n");
  await open(readOnly);
  assert(await page.locator("#inline-mode").isDisabled());
  await page.keyboard.press("F2");
  assert.equal(await page.locator("#inline-source").count(), 0);
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();

  // The new action uses the existing settings transaction and persists independently.
  await page.locator("#home-settings").click();
  await page.locator("#settings-shortcuts").click();
  await page.locator('[data-scheme="typora"]').click();
  assert.match(await page.locator("#shortcut-inline").innerText(), /\//);
  await page.locator("#settings-general").click();
  await page.locator("#setting-language").selectOption("en");
  await page.locator("#setting-language:not(:disabled)").waitFor();
  await page.locator("#settings-close").click();
  await open(file);
  await page.keyboard.press("Control+/");
  if (await page.locator("#inline-source-toggle").isVisible())
    await page.locator("#inline-source-toggle").click();
  await block().waitFor();
  assert.equal(
    await page.locator("#inline-apply").innerText(),
    "Apply and preview",
  );
  await page.keyboard.press("Escape");
  await page.locator("#document-settings").click();
  await page.locator("#settings-shortcuts").click();
  await page.locator("#shortcut-inline").click();
  await page.keyboard.press("Control+s");
  assert.match(
    await page.locator("#shortcut-message").innerText(),
    /conflict/i,
  );
  await page.keyboard.press("F8");
  await waitFor(
    async () =>
      (await page.locator("#shortcut-inline").innerText()).includes("F8"),
    "inline custom shortcut",
  );
  await page.locator("#settings-appearance").click();
  await page.locator("#css-edit").click();
  await page
    .locator("#css-source")
    .fill("button, .cm-line, .inline-hint { display: none !important; }");
  await page.locator("#css-enabled").check();
  await page.locator("#css-apply").click();
  await page.locator("#settings-close").click();
  page = await restart();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await open(file);
  await page.keyboard.press("F8");
  if (await page.locator("#inline-source-toggle").isVisible())
    await page.locator("#inline-source-toggle").click();
  await block().waitFor();
  assert(await page.locator("#inline-apply").isVisible());
  assert(await page.locator("#inline-source .cm-line").first().isVisible());
  assert(await page.locator(".inline-hint").isVisible());
  await page.keyboard.press("Escape");
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  page = await restart();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: inline source ranges/nested blocks/duplicate headings, staged cancel/apply/undo, source and BOM/CRLF preservation, no-final-newline/XSS, save/leave/cancel, disk conflict/reload guard, empty draft/save picker cancel, readonly/narrow UI, synthetic IME guard, stale mapping rejection, English/Typora/custom shortcut conflict and restart, CSS editor exclusion.",
  );
  console.log("Inline edit evidence:", root);
  return page;
}
