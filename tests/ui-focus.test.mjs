import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function testUiFocus({ page, root, dialog, restart, waitFor }) {
  const file = path.join(root, "工具栏专注.md");
  await writeFile(file, "# 专注标题\n\n保留编辑内容。\n");
  const settings = async () => {
    await page
      .locator(
        (await page.locator("#home").isVisible())
          ? "#home-settings"
          : "#document-settings",
      )
      .click();
    await page.locator("#settings-general").click();
  };
  const open = async () => {
    await page
      .locator(
        (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
      )
      .click();
    await dialog(file);
    await page.locator("#open:not(:disabled)").waitFor();
  };
  const raw = () => page.evaluate(() => localStorage.getItem("mdmd.settings"));
  await open();
  assert.equal(await page.locator(".toolbar #external-options").count(), 0);
  assert.equal(
    await page
      .locator("#format-action")
      .evaluate((n) => getComputedStyle(n).borderTopWidth),
    "0px",
  );
  const order = await page
    .locator(".toolbar button, .toolbar select")
    .evaluateAll((ns) => ns.map((n) => n.id));
  assert(order.indexOf("external-edit") < order.indexOf("format-action"));
  assert(order.indexOf("insert-snippet") > order.indexOf("insert-table"));
  await settings();
  await page.locator("#external-options").click();
  await page.locator("#external-close:not(:disabled)").waitFor();
  await page.locator("#external-close").click();
  assert(await page.locator("#settings-dialog").isVisible());
  for (const key of ["modes", "external", "format", "insert"])
    await page.locator(`#setting-tools-${key}`).uncheck();
  assert.equal(JSON.parse(await raw()).schemaVersion, 16);
  await page.locator("#settings-close").click();
  assert.equal(await page.locator("[data-toolbar-group]:visible").count(), 0);
  assert(await page.locator("#document-settings").isVisible());
  await page.keyboard.press("F3");
  assert(
    await page.locator("#editor").isVisible(),
    "hidden mode control retains shortcut",
  );
  page = await restart();
  await open();
  assert.equal(await page.locator("[data-toolbar-group]:visible").count(), 0);
  await settings();
  const before = await raw();
  await page.evaluate(() => {
    window.savedSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw Error("disk full");
    };
  });
  await page.locator("#setting-tools-modes").click();
  assert(!(await page.locator("#setting-tools-modes").isChecked()));
  assert.equal(await raw(), before);
  await page.evaluate(() => (Storage.prototype.setItem = window.savedSetItem));
  for (const key of ["modes", "external", "format", "insert"])
    await page.locator(`#setting-tools-${key}`).check();
  await page.locator("#settings-close").click();
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").fill("# 专注修改\n\n未保存。");
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  await waitFor(
    async () => (await native()).content.includes("专注修改"),
    "draft ready",
  );
  const state = await native();
  await page.locator("#focus-toggle").click();
  for (const selector of [
    ".toolbar",
    "#sidebar",
    ".pane-heading",
    "#document-view footer",
  ])
    assert.equal(await page.locator(selector + ":visible").count(), 0);
  assert(await page.locator("#editor").isVisible());
  assert(await page.locator("#preview").isVisible());
  await page.keyboard.press("Escape");
  assert(await page.locator(".toolbar").isVisible());
  assert.equal((await native()).content, state.content);
  await page.locator("#read-mode").click();
  await page.locator("#focus-toggle").click();
  await page.mouse.move(400, 2);
  await page.locator("#focus-exit").click();
  assert(await page.locator("#sidebar").isVisible());
  await page.locator("#inline-mode").click();
  await page.locator("#inline-rich").waitFor();
  await page.locator("#focus-toggle").click();
  await page.keyboard.press("Escape");
  assert(
    await page.locator("#inline-rich").isVisible(),
    "focus exit keeps block draft",
  );
  await page.locator("#inline-cancel").click();
  await page.locator("#save").click();
  await page.locator('#save-status[data-state="saved"]').waitFor();
  await settings();
  // Read-only migration, then upgrade on an explicit edit.
  const old = JSON.parse(await raw());
  old.schemaVersion = 13;
  delete old.toolbarVisibility;
  await page.evaluate(
    (value) => localStorage.setItem("mdmd.settings", JSON.stringify(value)),
    old,
  );
  await page.reload();
  await page.locator("#document-settings:not(:disabled)").waitFor();
  assert.equal(JSON.parse(await raw()).schemaVersion, 13);
  await settings();
  for (const key of ["modes", "external", "format", "insert"])
    assert(await page.locator(`#setting-tools-${key}`).isChecked());
  await page.locator("#setting-tools-format").uncheck();
  assert.equal(JSON.parse(await raw()).schemaVersion, 16);
  await page.locator("#setting-tools-format").check();
  await page.locator("#settings-close").click();
  await open();
  await page.locator("#focus-toggle").click();
  await page.screenshot({ path: path.join(root, "focus-reading.png") });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(root, "toolbar-updated.png") });
  console.log(
    `PASS: toolbar groups, settings editor, order/style, persistence/migration/write failure, focus read/split/draft exit. Evidence: ${root}`,
  );
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  return page;
}
