import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function testSnippets({ page, root, dialog, waitFor, restart }) {
  const dir = path.join(root, "snippets");
  await mkdir(dir);
  const file = path.join(dir, "片段.md");
  const original = "\ufeffBefore\r\n\r\n";
  await writeFile(file, original);
  const state = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const expect = (content) =>
    waitFor(async () => (await state()).content === content, "snippet source");
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  async function edit(value) {
    await page.locator("#editor .cm-content").fill(value);
    await page.keyboard.press("Control+End");
    await expect(value);
  }
  async function settings() {
    await page.locator("#document-settings").click();
    await page.locator("#settings-general").click();
  }
  async function open(value) {
    await page
      .locator(
        (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
      )
      .click();
    await dialog(value);
    await idle();
  }
  await open(file);
  await page.locator("#split-mode").click();
  // A typed slash triggers only at a supported empty line. Cancel is ordinary text.
  await edit("Before\n\n");
  await page.keyboard.type("/");
  await page.locator("#snippet-dialog[open]").waitFor();
  assert.equal(await page.locator("#snippet-list option").count(), 9);
  assert.equal(await readFile(file, "utf8"), original);
  await page.keyboard.press("Escape");
  await expect("Before\n\n/");
  await page.keyboard.press("Control+z");
  await expect("Before\n\n");
  // Search, no result, keyboard selection and one-step undo/redo.
  await page.locator("#insert-snippet").click();
  await page.locator("#snippet-filter").fill("no-such-template");
  assert(await page.locator("#snippet-apply").isDisabled());
  await page.locator("#snippet-filter").fill("table");
  assert.equal(await page.locator("#snippet-list option").count(), 1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const table = "Before\n\n| 文本 | 文本 |\n| --- | --- |\n| 文本 | 文本 |\n";
  await expect(table);
  await page.keyboard.press("Control+z");
  await expect("Before\n\n");
  await page.keyboard.press("Control+y");
  await expect(table);
  await edit("Nonempty");
  await page.locator("#insert-snippet").click();
  assert.equal(await page.locator("#snippet-dialog").isVisible(), false);
  await expect("Nonempty");
  // URL, fenced code and indented code must not unexpectedly show a picker.
  for (const prefix of ["https:", "```text\n", "    ", "- item "]) {
    await edit(prefix);
    await page.keyboard.type("/");
    await expect(prefix + "/");
    assert.equal(await page.locator("#snippet-dialog").isVisible(), false);
  }
  await edit("");
  await page.locator("#editor .cm-content").dispatchEvent("compositionstart");
  await page.keyboard.type("/");
  assert.equal(await page.locator("#snippet-dialog").isVisible(), false);
  await page.locator("#editor .cm-content").dispatchEvent("compositionend");
  // Inline snippets stay staged; cancel never changes the main buffer.
  await edit("Before");
  await page.locator("#read-mode").click();
  await page.locator("#refresh").click();
  await page.locator("#preview p").click();
  await page.locator("#inline-mode").click();
  if (await page.locator("#inline-source-toggle").isVisible())
    await page.locator("#inline-source-toggle").click();
  await page.locator("#inline-source .cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n\n");
  await page.keyboard.type("/");
  await page.locator("#snippet-dialog[open]").waitFor();
  await page.locator("#snippet-list").selectOption("task");
  await page.locator("#snippet-apply").click();
  assert.match(
    await page.locator("#inline-source .cm-content").innerText(),
    /- \[ \] 文本/,
  );
  await expect("Before");
  await page.locator("#inline-cancel").click();
  await expect("Before");
  await page.locator("#insert-table").click();
  assert(await page.locator("#insert-snippet").isDisabled());
  await page.locator("#inline-cancel").click();
  await page.locator("#split-mode").click();
  // English narrow dialog; the modal prevents auto-save until confirmed.
  await settings();
  await page.locator("#setting-language").selectOption("en");
  await page.locator("#setting-language:not(:disabled)").waitFor();
  await page.locator("#setting-autosave").check();
  await page.locator("#settings-close").click();
  await page.locator('#save-status[data-state="saved"]').waitFor();
  const savedBefore = await readFile(file, "utf8");
  await edit("Before\n\n");
  await page.keyboard.type("/");
  await page.locator("#snippet-dialog[open]").waitFor();
  await page.setViewportSize({ width: 640, height: 720 });
  await page.locator("#snippet-list").selectOption("code");
  await page.screenshot({ path: path.join(root, "snippets-en-640.png") });
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 20)
      .map((e) => ({
        id: e.id,
        tag: e.tagName,
        class: e.className,
        right: e.getBoundingClientRect().right,
      })),
  }));
  console.log("Snippet narrow layout", JSON.stringify(layout));
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.equal(
    await page.locator("#snippet-title").innerText(),
    "Insert snippet",
  );
  // Wait beyond the auto-save debounce while the modal is open.
  await page.waitForTimeout(1400);
  assert.equal(await readFile(file, "utf8"), savedBefore);
  await page.locator("#snippet-apply").click();
  const code = "Before\n\n```text\nText\n```\n";
  await expect(code);
  await page.locator('#save-status[data-state="saved"]').waitFor();
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" + code.replaceAll("\n", "\r\n"),
  );
  await edit("Cancel\n\n");
  await page.keyboard.type("/");
  await page.locator("#snippet-dialog[open]").waitFor();
  await page.waitForTimeout(1400);
  await page.locator("#snippet-cancel").click();
  await page.locator('#save-status[data-state="saved"]').waitFor();
  assert.equal(await readFile(file, "utf8"), "\ufeffCancel\r\n\r\n/");
  await page.setViewportSize({ width: 1320, height: 860 });
  await settings();
  await page.locator("#setting-autosave").uncheck();
  await page.locator("#settings-close").click();
  await edit("Before\n\n");
  await page.locator("#insert-snippet").click();
  await page.locator("#snippet-list").selectOption("heading");
  await page.locator("#snippet-apply").click();
  await expect("Before\n\n# Text\n");
  await writeFile(file, "EXTERNAL");
  await page.locator("#save").click();
  await idle();
  assert.equal(await readFile(file, "utf8"), "EXTERNAL");
  await expect("Before\n\n# Text\n");
  await page.locator("#home-back").click();
  await page.locator('button[value="discard"]').click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  const readonly = path.join(dir, "mixed.md");
  await writeFile(readonly, "# Mixed\r\n\n");
  await open(readonly);
  assert(await page.locator("#insert-snippet").isDisabled());
  await page.keyboard.press("Control+n");
  await idle();
  await page.locator("#insert-snippet").click();
  await page.locator("#snippet-list").selectOption("heading");
  await page.locator("#snippet-apply").click();
  await expect("# Text\n");
  assert.equal((await state()).path, null);
  await page.locator("#save").click();
  await dialog("", true);
  await idle();
  await expect("# Text\n");
  assert.equal((await state()).path, null);
  await page.locator("#home-back").click();
  await page.locator('button[value="discard"]').click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await page.evaluate(() => localStorage.clear());
  page = await restart();
  console.log(
    "PASS: slash empty-line trigger/cancel, search/empty result/keyboard selection, isolated undo/redo, URL/code/IME exclusions, inline draft cancel/table exclusion, English narrow dialog, modal auto-save pause, BOM/CRLF automatic save, external conflict preservation and readonly guard.",
  );
  console.log("Snippet evidence:", root);
  return page;
}
