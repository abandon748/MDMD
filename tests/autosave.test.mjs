import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";

export async function testAutoSave({ page, root, dialog, waitFor, restart }) {
  const dir = path.join(root, "autosave");
  await mkdir(dir);
  const file = path.join(dir, "自动 保存.md");
  const original = "\ufeff# 标题\r\n\r\n初始正文";
  await writeFile(file, original);
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  const state = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const raw = () => page.evaluate(() => localStorage.getItem("mdmd.settings"));
  async function saveStyle(enabled) {
    const style = await page.locator("#save").evaluate((button) => ({
      highlighted: button.classList.contains("auto-save-enabled"),
      background: getComputedStyle(button).backgroundColor,
    }));
    assert.equal(style.highlighted, enabled);
    assert.equal(style.background === "rgba(0, 0, 0, 0)", !enabled);
  }
  const pause = () =>
    page.waitForFunction(
      () =>
        document.querySelector("#autosave-status").dataset.paused === "true",
    );
  async function settings() {
    await page
      .locator(
        (await page.locator("#home").isVisible())
          ? "#home-settings"
          : "#document-settings",
      )
      .click();
    await page.locator("#settings-general").click();
  }
  async function toggle(value) {
    await settings();
    await page.locator("#setting-autosave").setChecked(value);
    await page.locator("#settings-close").click();
    await saveStyle(value);
  }
  async function edit(text) {
    await page.locator("#editor .cm-content").fill(text);
  }
  async function readWhenSaved(filePath) {
    if (
      (await page.locator("#save-status").getAttribute("data-state")) !==
      "saved"
    )
      return "";
    return readFile(filePath, "utf8");
  }
  async function saved(text) {
    await waitFor(
      async () => (await readWhenSaved(file)) === text,
      "automatic disk bytes",
    );
    await idle();
    assert.equal((await state()).dirty, false);
  }
  await settings();
  assert.equal(await page.locator("#setting-autosave").isChecked(), false);
  assert.equal(await raw(), null);
  await page.locator("#settings-close").click();
  await page.locator("#home-open").click();
  await dialog(file);
  await idle();
  await saveStyle(false);
  await page.screenshot({ path: path.join(root, "save-manual-style.png") });
  await page.locator("#split-mode").click();
  await edit("# 标题\n\n默认关闭");
  await page.waitForTimeout(1500);
  assert.equal(await readFile(file, "utf8"), original);
  await toggle(true);
  await page.screenshot({ path: path.join(root, "save-auto-style.png") });
  assert.equal(JSON.parse(await raw()).schemaVersion, 16);
  assert.equal(JSON.parse(await raw()).autoSave, true);
  // Each later edit restarts the quiet interval; persist final text only.
  await edit("# 标题\n\n第一版");
  await page.waitForTimeout(650);
  await edit("# 标题\n\n第二版 😀");
  await page.waitForTimeout(650);
  assert.equal(await readFile(file, "utf8"), original);
  await saved("\ufeff# 标题\r\n\r\n第二版 😀");
  await toggle(false);
  await edit("暂停保存");
  await page.waitForTimeout(1500);
  assert.equal(await readFile(file, "utf8"), "\ufeff# 标题\r\n\r\n第二版 😀");
  await toggle(true);
  await saved("\ufeff暂停保存");
  await edit("# 标题\n\n第二版 😀");
  await saved("\ufeff# 标题\r\n\r\n第二版 😀");
  // Main undo remains live and is itself eligible for auto-save.
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+z");
  await waitFor(async () => (await state()).dirty, "undo remains dirty");
  await page.keyboard.press("Control+y");
  await waitFor(async () => !(await state()).dirty, "redo returns to baseline");

  assert.equal((await state()).content, "# 标题\n\n第二版 😀");

  // Do not end an IME composition, or save while a modal is being used.
  await edit("# 输入法");
  await page.locator("#editor .cm-content").dispatchEvent("compositionstart");
  await page.waitForTimeout(1500);
  assert.equal(await readFile(file, "utf8"), "\ufeff# 标题\r\n\r\n第二版 😀");
  await page.locator("#editor .cm-content").dispatchEvent("compositionend");
  await saved("\ufeff# 输入法");
  await edit("# 弹窗暂停");
  await settings();
  await page.waitForTimeout(1500);
  assert.equal(await readFile(file, "utf8"), "\ufeff# 输入法");
  await page.locator("#settings-close").click();
  await saved("\ufeff# 弹窗暂停");

  // A delayed native save is a single operation; manual save cannot overlap it.
  await page.evaluate(() => {
    window.autoFetch = window.fetch;
    window.autoCalls = 0;
    window.fetch = async (input, init) => {
      if (
        String(input) !==
        window.__TAURI_INTERNALS__.convertFileSrc("document_action", "ipc")
      )
        return window.autoFetch(input, init);
      window.autoCalls++;
      const response = await window.autoFetch(input, init);
      await new Promise((resolve) => {
        window.autoRelease = resolve;
      });
      return response;
    };
  });
  await edit("# 串行保存");
  await page.waitForFunction(() => !!window.autoRelease);
  assert(await page.locator("#save").isDisabled());
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.insertText("MUST NOT INSERT");
  assert.equal(
    await page.locator("#editor .cm-content").innerText(),
    "# 串行保存",
  );
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(1300);
  assert.equal(await page.evaluate(() => window.autoCalls), 1);
  await page.evaluate(() => {
    window.fetch = window.autoFetch;
    window.autoRelease();
  });
  await saved("\ufeff# 串行保存");

  // Unapplied blocks keep their cancellation contract.
  await page.locator("#read-mode").click();
  await page.locator("#preview h1").click();
  await page.locator("#inline-mode").click();
  if (await page.locator("#inline-source-toggle").isVisible())
    await page.locator("#inline-source-toggle").click();
  await page.locator("#inline-source .cm-content").fill("# 草稿");
  await page.waitForTimeout(1500);
  assert.equal(await readFile(file, "utf8"), "\ufeff# 串行保存");
  await page.locator("#inline-cancel").click();
  await page.locator("#insert-table").click();
  await page
    .locator('#table-grid input[data-row="0"][data-col="0"]')
    .fill("表头");
  await page.waitForTimeout(1500);
  assert.equal(await readFile(file, "utf8"), "\ufeff# 串行保存");
  await page.locator("#inline-apply").click();
  await waitFor(
    async () => (await readWhenSaved(file)).includes("表头"),
    "applied table saves",
  );
  await idle();
  await page.locator("#split-mode").click();

  // Real external bytes are never overwritten. No repeated automatic retries.
  await writeFile(file, "外部版本");
  await edit("# 本地冲突草稿");
  await pause();
  await page.waitForTimeout(1500);
  assert.equal(await readFile(file, "utf8"), "外部版本");
  assert.equal((await state()).content, "# 本地冲突草稿");
  await page.locator("#reload").click();
  await page.locator('button[value="cancel"]').click();
  await idle();
  assert.equal((await state()).content, "# 本地冲突草稿");
  await page.locator("#reload").click();
  await page.locator('button[value="discard"]').click();
  await idle();
  assert.equal((await state()).content, "外部版本");
  await edit("恢复后自动保存");
  await saved("恢复后自动保存");

  // Actual filesystem backup failure; recovery is explicit, not a retry loop.
  const blocked = path.join(dir, "blocked");
  await mkdir(blocked);
  const failedFile = path.join(blocked, "失败.md");
  await writeFile(failedFile, "基线");
  await writeFile(path.join(blocked, ".mdmd-backups"), "占用");
  await page.locator("#open").click();
  await dialog(failedFile);
  await idle();
  await edit("保留草稿");
  await pause();
  assert.equal(await readFile(failedFile, "utf8"), "基线");
  await unlink(path.join(blocked, ".mdmd-backups"));
  await page.waitForTimeout(1500);
  assert.equal(await readFile(failedFile, "utf8"), "基线");
  await page.locator("#save").click();
  await idle();
  assert.equal(await readFile(failedFile, "utf8"), "保留草稿");
  assert.equal(
    await page.locator("#autosave-status").getAttribute("data-paused"),
    "false",
  );

  // Untitled content never opens a save picker automatically.
  await page.locator("#new").click();
  await idle();
  await edit("未命名内容");
  await page.waitForTimeout(1500);
  assert.equal((await state()).path, null);
  assert(await page.locator("#open").isEnabled());
  await page.locator("#save").click();
  await dialog("", true);
  await idle();
  assert.equal((await state()).content, "未命名内容");
  const first = path.join(dir, "首次保存.md");
  await page.locator("#save").click();
  await dialog(first);
  await idle();
  await edit("已有路径");
  await waitFor(
    async () => (await readWhenSaved(first)) === "已有路径",
    "first manual save enables automatic saving",
  );

  await idle();
  const readOnlyFile = path.join(dir, "只读.md");
  const readOnlyBytes = "a\r\nb\nc";
  await writeFile(readOnlyFile, readOnlyBytes);
  await page.locator("#open").click();
  await dialog(readOnlyFile);
  await idle();
  await page.waitForTimeout(1500);
  assert(await page.locator("#save").isDisabled());
  assert.equal(await readFile(readOnlyFile, "utf8"), readOnlyBytes);
  await page.setViewportSize({ width: 640, height: 720 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: path.join(root, "autosave-status-640.png") });
  await page.setViewportSize({ width: 1320, height: 860 });

  // Persist preference across a real process restart; changing settings is transactional.
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  page = await restart();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await settings();
  assert(await page.locator("#setting-autosave").isChecked());
  await saveStyle(true);
  const stored = await raw();
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
  });
  await page.locator("#setting-autosave").click();
  assert(await page.locator("#setting-autosave").isChecked());
  assert.equal(await raw(), stored);
  await saveStyle(true);
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalSetItem;
  });
  await page.locator("#setting-language").selectOption("en");
  await page.locator("#setting-language:not(:disabled)").waitFor();
  await page.setViewportSize({ width: 640, height: 720 });
  await page.locator("#setting-autosave").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, "autosave-settings-640.png") });
  await page.setViewportSize({ width: 1320, height: 860 });
  await page.locator("#settings-close").click();
  // Legacy/invalid/future records never silently opt into disk writes.
  for (const record of [
    { ...JSON.parse(stored), schemaVersion: 12 },
    { ...JSON.parse(stored), autoSave: "yes" },
    { schemaVersion: 99 },
  ]) {
    await page.evaluate(
      (record) => localStorage.setItem("mdmd.settings", JSON.stringify(record)),
      record,
    );
    await page.reload();
    await page.locator("#home-open:not(:disabled)").waitFor();
    await settings();
    assert.equal(await page.locator("#setting-autosave").isChecked(), false);
    await saveStyle(false);
    assert.equal(await raw(), JSON.stringify(record));
    await page.locator("#settings-close").click();
  }
  await page.evaluate(() => localStorage.clear());
  page = await restart();
  console.log(
    "PASS: autosave default/quiet debounce, BOM/CRLF/EOF, undo, IME/modal/block draft pause, single-flight save and input guard, external conflict/cancel/reload, real backup failure/manual recovery, untitled save/cancel, persistence/rollback/legacy/invalid/future settings, narrow English settings.",
  );
  console.log("Autosave evidence:", root);
  return page;
}
