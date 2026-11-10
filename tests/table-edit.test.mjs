import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { testTableInsertion } from "./table-insertion.test.mjs";

export async function testTableEdit({ page, root, dialog, waitFor, restart }) {
  await testTableInsertion({ page, root, dialog, waitFor });
  const dir = path.join(root, "table-edit");
  await mkdir(dir);
  const file = path.join(dir, "表格 😀.md");
  const table =
    "| Name | Amount |\n| :-- | --: |\n| **B** | 2 |\n| A\\|一 | 10 |";
  const original =
    "# Before\n\n" + table + "\n\n[ref]: /local\n\nAfter 无尾换行";
  await writeFile(file, "\ufeff" + original.replaceAll("\n", "\r\n"));
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  const cell = (r, c) =>
    page.locator(`#table-grid input[data-row="${r}"][data-col="${c}"]`);
  const values = () =>
    page
      .locator("#table-grid input")
      .evaluateAll((nodes) => nodes.map((n) => n.value));
  const source = () => page.locator("#inline-source .cm-content");
  async function open(file) {
    await page
      .locator(
        (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
      )
      .click();
    await dialog(file);
    await idle();
  }
  async function enter() {
    await page.locator("#preview table td").first().click({ button: "right" });
    await page.locator("#menu-table").click();
    await cell(0, 0).waitFor();
  }
  async function raw(text) {
    await source().focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText(text);
  }
  async function state(value) {
    await waitFor(
      async () =>
        (await page.locator("#save-status").getAttribute("data-state")) ===
        value,
      value,
    );
  }
  await open(file);
  await enter();
  assert.deepEqual(await values(), [
    "Name",
    "Amount",
    "**B**",
    "2",
    "A\\|一",
    "10",
  ]);
  assert(await page.locator("#table-row-delete").isDisabled());
  await page.locator("#inline-apply").click();
  await state("saved");
  assert.equal(
    (await native()).content,
    original,
    "no-op apply does not normalize source",
  );
  await enter();
  await cell(1, 0).fill("草稿");
  assert.equal((await native()).content, original);
  await page.locator("#inline-cancel").click();
  assert.equal((await native()).content, original);
  await enter();
  for (const id of [
    "row-before",
    "row-after",
    "row-delete",
    "row-down",
    "col-before",
    "col-after",
    "col-delete",
    "col-right",
    "sort-up",
    "sort-down",
  ]) {
    await cell(1, 0).focus();
    const before = await values();
    await page.locator(`#table-${id}`).click();
    const after = await values();
    if (JSON.stringify(after) === JSON.stringify(before)) continue;
    await page.locator("#table-undo").click();
    assert.deepEqual(await values(), before, id + " undo");
    await page.locator("#table-redo").click();
    assert.deepEqual(await values(), after, id + " redo");
    await page.locator("#table-undo").click();
  }
  await cell(1, 0).focus();
  await page.locator("#table-align").selectOption("center");
  await page.locator("#table-source").click();
  assert.match(await source().innerText(), /:---:/);
  await source().dispatchEvent("compositionstart");
  await page.locator("#table-undo").evaluate((b) => b.click());
  assert(await source().isVisible());
  assert.match(await source().innerText(), /:---:/);
  await source().dispatchEvent("compositionend");
  await page.locator("#table-source").click();
  await page.locator("#table-undo").click();
  assert.equal(await page.locator("#table-align").inputValue(), "left");
  const beforeDrag = await values();
  await page
    .locator("#table-grid th button")
    .first()
    .dragTo(page.locator("#table-grid th").nth(1));
  assert.deepEqual(await values(), [
    "Amount",
    "Name",
    "2",
    "**B**",
    "10",
    "A\\|一",
  ]);
  await page.locator("#table-undo").click();
  assert.deepEqual(await values(), beforeDrag);
  await cell(1, 0).focus();
  await page.keyboard.press("Tab");
  assert(await cell(1, 1).evaluate((n) => n === document.activeElement));
  await page.keyboard.press("Shift+Tab");
  assert(await cell(1, 0).evaluate((n) => n === document.activeElement));
  await cell(1, 0).fill("a|b `code` 😀");
  await page.locator("#table-source").click();
  assert.match(await source().innerText(), /a\\\|b `code` 😀/);
  await raw("| A | B |\n| --- | --- |\n| only |");
  await page.locator("#table-source").click();
  assert(await source().isVisible());
  await page.locator("#inline-apply").click();
  assert.equal(await page.locator("#inline-source").count(), 1);
  assert.equal((await native()).content, original);
  await page.locator("#preview h1").click();
  assert(await source().isVisible(), "invalid table blocks click-to-switch");
  assert.match(await source().innerText(), /only/);
  assert.equal((await native()).content, original);
  await raw(table);
  await page.locator("#table-source").click();
  await cell(1, 0).fill("a|b `code` 😀");
  await cell(1, 0).dispatchEvent("compositionstart");
  await page.locator("#inline-apply").evaluate((b) => b.click());
  assert.equal(await page.locator("#inline-source").count(), 1);
  await cell(1, 0).dispatchEvent("compositionend");
  await page.locator("#dismiss-error").click();
  await page.locator("#table-expand").click();
  assert(await page.locator(".table-expanded").isVisible());
  await page.locator("#table-expand").click();
  await page.setViewportSize({ width: 640, height: 720 });
  await page.screenshot({ path: path.join(root, "table-edit-640.png") });
  await page.locator("#table-expand").click();
  await cell(1, 0).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(root, "table-edit-expanded-640.png"),
  });
  await page.locator("#table-expand").click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1320, height: 860 });
  await cell(1, 0).focus();
  await page.keyboard.press("Control+s");
  await idle();
  await state("saved");
  const saved = (await native()).content;
  assert(saved.startsWith("# Before\n\n| Name | Amount |"));
  assert(saved.endsWith("\n\n[ref]: /local\n\nAfter 无尾换行"));
  assert(saved.includes("a\\|b `code` 😀"));
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" + saved.replaceAll("\n", "\r\n"),
  );
  // Selecting the last paragraph still permits a staged append.
  await page.locator("#preview > p:last-of-type").click();
  await page.keyboard.press("Control+t");
  await cell(0, 0).waitFor();
  assert.equal(await page.locator("#table-grid input").count(), 6);
  await page.locator("#inline-cancel").click();
  assert.equal((await native()).content, saved);
  await page.locator("#insert-table").click();
  await cell(0, 0).fill("新增表头");
  await page.locator("#inline-apply").click();
  await state("dirty");
  assert((await native()).content.startsWith(saved + "\n\n| 新增表头"));
  await page.keyboard.press("Control+z");
  await state("saved");
  assert.equal((await native()).content, saved);
  // Disk conflict must preserve both the staged table and the external file.
  await page.locator("#refresh").click();
  await enter();
  await cell(1, 0).fill("本地冲突");
  await writeFile(file, "# 外部版本\n保留");
  await state("conflict");
  assert.equal(await cell(1, 0).inputValue(), "本地冲突");
  await page.keyboard.press("Control+s");
  await idle();
  assert.match(await page.locator("#error-text").innerText(), /已停止保存/);
  assert((await native()).content.includes("本地冲突"));
  assert.equal(await readFile(file, "utf8"), "# 外部版本\n保留");
  await page.locator("#reload").click();
  await page.locator("button[value=cancel]").click();
  await idle();
  assert((await native()).content.includes("本地冲突"));
  await page.locator("#reload").click();
  await page.locator("button[value=discard]").click();
  await idle();
  assert.equal((await native()).content, "# 外部版本\n保留");
  const bad = path.join(dir, "不规则.md");
  await writeFile(bad, "A|B\n---|---\nonly");
  await open(bad);
  await page.locator("#preview table").click({ button: "right" });
  await page.locator("#menu-table").click();
  assert.equal(await page.locator("#table-grid").count(), 0);
  assert.equal((await native()).content, "A|B\n---|---\nonly");
  await page.locator("#new").click();
  await idle();
  await page.locator("#insert-table").click();
  await cell(0, 0).fill("新文档");
  await page.keyboard.press("Control+s");
  await dialog("", true);
  await idle();
  assert.equal((await native()).path, null);
  assert((await native()).content.includes("新文档"));
  await page.locator("#home-back").click();
  await page.locator("button[value=discard]").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await page.locator("#home-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#setting-language").selectOption("en");
  await page.locator("#setting-language:not(:disabled)").waitFor();
  await page.locator("#settings-shortcuts").click();
  await page.locator("#shortcut-table").click();
  await page.keyboard.press("F9");
  await waitFor(
    async () =>
      (await page.locator("#shortcut-table").innerText()).includes("F9"),
    "table custom shortcut",
  );
  await page.locator("#settings-close").click();
  page = await restart();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await open(file);
  await page.keyboard.press("F9");
  await cell(0, 0).waitFor();
  assert.equal(
    await page.locator("#table-row-after").innerText(),
    "Insert row below",
  );
  await page.locator("#table-col-delete").click();
  assert(await page.locator("#table-col-delete").isDisabled());
  await page.locator("#table-row-after").click();
  await page.setViewportSize({ width: 640, height: 720 });
  await page.screenshot({ path: path.join(root, "table-edit-en-640.png") });
  await page.locator("#table-expand").click();
  await cell(1, 0).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(root, "table-edit-en-expanded-640.png"),
  });
  await page.locator("#table-expand").click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1320, height: 860 });
  await page.locator("#inline-cancel").click();
  const readOnly = path.join(dir, "只读.md");
  await writeFile(readOnly, "# 混合\r\n\n正文\r\n");
  await open(readOnly);
  assert(await page.locator("#insert-table").isDisabled());
  await page.keyboard.press("F9");
  assert.equal(await page.locator("#table-grid").count(), 0);
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  page = await restart();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: table no-op preservation, cell/row/column/alignment/sort/drag/Tab operations and undo/redo, source/grid validation, synthetic IME, Chinese/English narrow/expanded UI, escaped pipes/Unicode/BOM/CRLF preservation, staged insertion/cancel/main undo, save picker cancel, conflict/reload protection, irregular-source rejection, last-column/header guard, custom shortcut restart, readonly rejection.",
  );
  console.log("Table edit evidence:", root);
  return page;
}
