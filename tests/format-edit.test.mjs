import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { testFormatPosition } from "./format-position.test.mjs";

export async function testFormatEdit({ page, root, dialog, waitFor, restart }) {
  await testFormatPosition({ page, root, dialog, waitFor });
  const dir = path.join(root, "format");
  await mkdir(dir);
  const file = path.join(dir, "格式.md"),
    source = "Before\n\nText\n\nAfter";
  await writeFile(file, "\ufeff" + source.replaceAll("\n", "\r\n"));
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  const state = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const expect = (content) =>
    waitFor(
      async () => (await state()).content === content,
      "formatted source",
    );
  async function edit(value) {
    await page.locator("#editor .cm-content").fill(value);
    await expect(value);
  }
  async function selectText() {
    await page.locator("#editor .cm-content").focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
  }
  async function settings() {
    await page.locator("#document-settings").click();
  }
  await page.locator("#home-open").click();
  await dialog(file);
  await idle();
  await page.locator("#split-mode").click();
  for (const [action, inner] of Object.entries({
    bold: "**Text**",
    italic: "*Text*",
    strike: "~~Text~~",
    quote: "> Text",
    code: "`Text`",
    link: "[Text](https://example.com)",
    listCycle: "- Text",
    highlight: "==Text==",
    clear: "Text",
  })) {
    const before =
      action === "clear" ? source.replace("Text", "**Text**") : source;
    await edit(before);
    await selectText();
    await page.locator("#format-action").selectOption(action);
    const after = source.replace("Text", inner);
    await expect(after);
    if (action === "highlight")
      assert.equal(await page.locator("#preview mark").innerText(), "Text");
    await page.keyboard.press("Control+z");
    await expect(before);
    await page.keyboard.press("Control+y");
    await expect(after);
  }
  // Built-in search/replace operates on the same buffer and remains undoable.
  await edit("word word");
  await page.locator("#find").click();
  await page.locator('#editor .cm-search input[name="search"]').fill("word");
  await page.locator('#editor .cm-search input[name="replace"]').fill("new");
  await page.locator('#editor .cm-search button[name="replaceAll"]').click();
  await expect("new new");
  await page.keyboard.press("Escape");
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+z");
  await expect("word word");
  await edit(source);
  await selectText();
  await page.locator("#editor .cm-content").dispatchEvent("compositionstart");
  await page.locator("#format-action").selectOption("bold");
  await expect(source);
  await page.locator("#editor .cm-content").dispatchEvent("compositionend");
  // Inline formatting stays in the draft and cancel is lossless.
  await page.locator("#read-mode").click();
  await page.locator("#refresh").click();
  await page.locator("#preview p").nth(1).click();
  await page.locator("#inline-mode").click();
  if (await page.locator("#inline-source-toggle").isVisible())
    await page.locator("#inline-source-toggle").click();
  await page.locator("#inline-source .cm-content").focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  assert.match(
    await page.locator("#inline-source .cm-content").innerText(),
    /\*\*Text\*\*/,
  );
  assert.equal((await state()).content, source);
  await page.locator("#inline-cancel").click();
  await expect(source);
  await page.locator("#insert-table").click();
  assert(await page.locator("#format-action").isDisabled());
  await page.locator("#inline-cancel").click();
  // All schemes expose working formatting, and custom assignments survive restart.
  await settings();
  await page.locator("#settings-shortcuts").click();
  for (const scheme of ["typora", "obsidian", "mdmd"]) {
    await page.locator(`[data-scheme="${scheme}"]`).click();
    assert.match(await page.locator("#shortcut-bold").innerText(), /B/);
    assert.equal(await page.locator("#shortcut-list button").count(), 22);
  }
  await page.locator("#shortcut-bold").click();
  await page.keyboard.press("F8");
  await waitFor(
    async () =>
      (await page.locator("#shortcut-bold").innerText()).includes("F8"),
    "custom format key",
  );
  await page.locator("#settings-general").click();
  await page.locator("#setting-language").selectOption("en");
  await page.locator("#setting-language:not(:disabled)").waitFor();
  await page.locator("#settings-close").click();
  await page.locator("#home-back").click();
  if (await page.locator("#confirm-dialog").isVisible())
    await page.locator('button[value="discard"]').click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  page = await restart();
  await page.locator("#home-open").click();
  await dialog(file);
  await idle();
  await page.locator("#split-mode").click();
  await edit(source);
  await selectText();
  await page.keyboard.press("Control+b");
  await expect(source);
  await page.keyboard.press("F8");
  await expect(source.replace("Text", "**Text**"));
  assert.equal(
    await page.locator('#format-action option[value="bold"]').innerText(),
    "Bold",
  );
  await page.setViewportSize({ width: 640, height: 720 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: path.join(root, "format-edit-640.png") });
  await page.setViewportSize({ width: 1320, height: 860 });
  // Formats participate in the newly implemented automatic save path.
  await settings();
  await page.locator("#settings-general").click();
  await page.locator("#setting-autosave").check();
  await page.locator("#settings-close").click();
  await page.locator('#save-status[data-state="saved"]').waitFor();
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" + source.replace("Text", "**Text**").replaceAll("\n", "\r\n"),
  );
  // Disable before mutating the external bytes; native save must still protect them.
  await settings();
  await page.locator("#settings-general").click();
  await page.locator("#setting-autosave").uncheck();
  await page.locator("#settings-close").click();
  await selectText();
  await page.locator("#format-action").selectOption("clear");
  await writeFile(file, "EXTERNAL");
  await page.locator("#save").click();
  await idle();
  assert.equal(await readFile(file, "utf8"), "EXTERNAL");
  assert.equal((await state()).content, source);
  await page.locator("#home-back").click();
  await page.locator('button[value="discard"]').click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await page.evaluate(() => localStorage.clear());
  page = await restart();
  console.log(
    "PASS: nine source format actions, surrounding text/undo/redo, real CM6 replace-all/undo, synthetic IME guard, inline draft cancel, table exclusion, three schemes/custom restart/old key suppression, English narrow toolbar, automatic BOM/CRLF save and external conflict protection.",
  );
  console.log("Format evidence:", root);
  return page;
}
