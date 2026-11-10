import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { defaultTypography } from "./typography.test.mjs";

export async function testVisibility({ page, root, dialog, restart, waitFor }) {
  const keys = ["history", "favorites", "files"];
  const defaults = { history: true, favorites: true, files: true };
  const data = path.join(root, "visibility-data");
  await mkdir(data);
  const empty = path.join(data, "空目录");
  await mkdir(empty);
  const a = path.join(data, "甲.md"),
    b = path.join(data, "乙.md");
  await writeFile(a, "# 甲\n\n正文");
  await writeFile(b, "# 乙");
  const raw = () => page.evaluate(() => localStorage.getItem("mdmd.settings"));
  const ready = () => page.locator("#home-settings:not([disabled])").waitFor();
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
  const close = () => page.keyboard.press("Escape");
  const toggle = (key, value) =>
    page.locator(`#setting-${key}`).setChecked(value);
  const idle = () =>
    waitFor(() => page.locator("#open").isEnabled(), "visibility idle");
  const open = async (file) => {
    await page.keyboard.press("Control+o");
    await dialog(file);
    await waitFor(
      async () =>
        (await page.locator("#filepath").innerText()) === file &&
        (await page.locator("#open").isEnabled()),
      "visibility file opened",
    );
  };
  const selected = (key) =>
    page.locator(`#tab-${key}`).getAttribute("aria-pressed");
  const shot = (name) =>
    page.screenshot({ path: path.join(root, `visibility-${name}.png`) });
  await ready();
  await page.setViewportSize({ width: 1320, height: 860 });
  assert.equal(await raw(), null);
  await settings();
  for (const key of keys)
    assert(await page.locator(`#setting-${key}`).isChecked());
  assert.equal(await raw(), null);
  await shot("general");
  await close();

  // Hiding the active no-document panel returns to home without dismissing settings.
  for (const key of keys) {
    if (key === "files") {
      await page.locator("#home-folder").click();
      await dialog(empty, false, ["-Folder"]);
      await page.locator("#folder-welcome").waitFor({ state: "visible" });
      await idle();
    } else await page.locator(`#home-${key}`).click();
    await settings();
    await toggle(key, false);
    assert(await page.locator("#home").isVisible());
    assert(await page.locator("#settings-dialog").isVisible());
    assert(
      await page
        .locator(`#setting-${key}`)
        .evaluate((e) => e === document.activeElement),
    );
    await close();
    await waitFor(
      () =>
        page
          .locator("#home-settings")
          .evaluate((e) => e === document.activeElement),
      "dialog close event restores home settings focus",
    );
    await settings();
    await toggle(key, true);
    await close();
    assert(await page.locator("#home").isVisible());
  }

  await open(a);
  await page.locator("#tab-favorites").click();
  await page.locator("#favorite-file").click();
  await idle();
  await page.locator("#favorite-folder").click();
  await idle();
  const favoritesPath = path.join(root, "app-data", "favorites.json");
  const historyPath = path.join(root, "app-data", "history.json");
  const favoritesBefore = await readFile(favoritesPath, "utf8");
  const historyBefore = await readFile(historyPath, "utf8");
  // Each active tab falls back to outline. Re-enabling does not steal navigation.
  for (const key of keys) {
    await page.locator(`#tab-${key}`).click();
    await settings();
    await toggle(key, false);
    assert.equal(await selected("outline"), "true");
    assert(await page.locator(`#tab-${key}`).isHidden());
    assert.equal(await page.locator("#filepath").innerText(), a);
    await toggle(key, true);
    assert.equal(await selected("outline"), "true");
    await close();
  }
  assert.equal(await readFile(favoritesPath, "utf8"), favoritesBefore);
  assert.equal(await readFile(historyPath, "utf8"), historyBefore);
  await page.locator("#tab-favorites").click();
  await settings();
  await toggle("history", false);
  assert.equal(
    await selected("favorites"),
    "true",
    "inactive toggle preserves active panel",
  );
  await close();
  await open(b);
  assert.notEqual(
    await readFile(historyPath, "utf8"),
    historyBefore,
    "hidden history keeps recording",
  );
  await settings();
  await toggle("history", true);
  await toggle("files", false);
  await close();
  await page.locator("#tab-history").click();
  assert((await page.locator("#history-list").innerText()).includes("乙.md"));
  await page.locator("#tab-favorites").click();
  await page
    .locator('#favorites-list .favorite-open[data-kind="folder"]')
    .click();
  assert(await page.locator("#settings-dialog").isVisible());
  assert.match(
    await page.locator("#settings-message").innerText(),
    /文件栏已隐藏/,
  );
  assert.equal(await page.locator("#filepath").innerText(), b);
  await toggle("files", true);
  await close();
  await page
    .locator('#favorites-list .favorite-open[data-kind="folder"]')
    .click();
  await idle();
  assert.equal(await selected("files"), "true");
  const folderName = await page.locator("#folder-name").innerText();

  await page.locator("#split-mode").click();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("# 未保存\n\n正文");
  await page.keyboard.press("Control+a");
  await waitFor(
    async () =>
      (await page.locator("#wordcount").innerText()) === "源码选中 6 · 全文 5",
    "draft preview settled",
  );
  const statsBefore = await page.locator("#wordcount").innerText();
  await settings();
  const savedBefore = await raw();
  await page.evaluate(() => {
    window.savedSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "mdmd.settings")
        throw new DOMException("test", "QuotaExceededError");
      return window.savedSetItem.call(this, key, value);
    };
  });
  await page.locator("#setting-files").click();
  assert(await page.locator("#setting-files").isChecked());
  assert.equal(await selected("files"), "true");
  assert.equal(await raw(), savedBefore);
  assert.match(await page.locator("#settings-message").innerText(), /保存失败/);
  await page.evaluate(() => {
    Storage.prototype.setItem = window.savedSetItem;
  });
  for (const key of keys) await toggle(key, false);
  await page.locator("#settings-appearance").click();
  await page.locator("#theme-dark").check();
  await page.locator("#settings-typography").click();
  await page.locator("#setting-codeWrap").check();
  await page.locator("#settings-general").click();
  await page.setViewportSize({ width: 850, height: 650 });
  await shot("narrow-dark");
  await close();
  assert.equal(await selected("outline"), "true");
  await page.locator(".cm-content").focus();
  await waitFor(
    async () => (await page.locator("#wordcount").innerText()) === statsBefore,
    "selection restored on editor focus",
  );
  assert.equal(await page.locator("#wordcount").innerText(), statsBefore);
  assert.equal(
    (await page.locator(".cm-line").allTextContents()).join("\n"),
    "# 未保存\n\n正文",
  );
  assert.equal(await readFile(b, "utf8"), "# 乙");
  assert(await page.locator("#confirm-dialog").isHidden());
  await settings();
  await toggle("files", true);
  await close();
  await page.locator("#tab-files").click();
  assert.equal(await page.locator("#folder-name").innerText(), folderName);
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () => (await page.locator(".cm-content").innerText()) === "# 乙",
    "undo survives toggles",
  );
  await settings();
  await toggle("files", false);
  await page.locator("#setting-wordcount").uncheck();
  await close();
  const allOff = await raw();
  page = await restart();
  await ready();
  assert.equal(await raw(), allOff);
  assert.deepEqual(JSON.parse(allOff).navigation, {
    history: false,
    favorites: false,
    files: false,
  });
  assert.equal(JSON.parse(allOff).theme, "dark");
  assert.equal(JSON.parse(allOff).typography.codeWrap, true);
  assert.equal(JSON.parse(allOff).showWordCount, false);
  assert(await page.locator("#home-history").isHidden());
  assert(await page.locator("#home-favorites").isHidden());
  await page.locator("#home-folder").click();
  assert(await page.locator("#settings-dialog").isVisible());
  assert.match(
    await page.locator("#settings-message").innerText(),
    /文件栏已隐藏/,
  );
  await shot("folder-guidance");
  await close();
  await open(b);
  assert.equal(await page.locator(".sidebar-tabs button:visible").count(), 1);
  await shot("outline-only");
  await settings();
  for (const key of keys) await toggle(key, true);
  await close();
  await page.locator("#tab-favorites").click();
  assert.equal(await page.locator(".favorite-open").count(), 2);
  while (await page.locator(".favorite-remove").count()) {
    await page.locator(".favorite-remove").first().click();
    await idle();
  }
  assert.deepEqual(
    JSON.parse(await readFile(favoritesPath, "utf8")).entries,
    [],
  );
  // Restore the empty isolated profile expected by the following favorites suite.
  await unlink(favoritesPath);
  await page.locator("#home-back").click();
  await ready();

  // Read-only migration, complete write on explicit change, strict bad/future records.
  for (const version of [1, 2, 3]) {
    const old = { schemaVersion: version, showWordCount: false };
    if (version >= 2) old.theme = "dark";
    if (version >= 3)
      old.typography = { ...defaultTypography, columnWidth: 1000 };
    const text = JSON.stringify(old);
    await page.evaluate(
      (value) => localStorage.setItem("mdmd.settings", value),
      text,
    );
    await page.reload();
    await ready();
    await settings();
    for (const key of keys)
      assert(await page.locator(`#setting-${key}`).isChecked());
    assert.equal(await raw(), text);
    await toggle("history", false);
    assert.deepEqual(JSON.parse(await raw()), {
      schemaVersion: 16,
      taskStrike: true,
      doubleClickEdit: false,
      toolbarVisibility: {
        modes: true,
        external: true,
        format: true,
        insert: true,
      },
      autoSave: false,
      linkPreview: true,
      language: "system",
      titleFormat: "path",
      customCss: { enabled: false, source: "" },
      appearance: { palette: "default", corners: "rounded", custom: [] },
      shortcuts: {
        scheme: "mdmd",
        overrides: { mdmd: {}, typora: {}, obsidian: {} },
      },
      theme: old.theme || "system",
      showWordCount: false,
      typography: {
        ...(old.typography || defaultTypography),
        swapPanes: false,
        softBreaks: false,
      },
      navigation: { ...defaults, history: false },
    });
    await close();
  }
  for (const invalid of [
    null,
    {},
    { ...defaults, files: "false" },
    { ...defaults, history: 0 },
  ]) {
    const text = JSON.stringify({
      schemaVersion: 5,
      shortcuts: {
        scheme: "mdmd",
        overrides: { mdmd: {}, typora: {}, obsidian: {} },
      },
      theme: "dark",
      showWordCount: false,
      typography: defaultTypography,
      navigation: invalid,
    });
    await page.evaluate(
      (value) => localStorage.setItem("mdmd.settings", value),
      text,
    );
    await page.reload();
    await ready();
    await settings();
    for (const key of keys)
      assert(await page.locator(`#setting-${key}`).isChecked());
    assert.equal(await raw(), text);
    assert.match(
      await page.locator("#settings-message").innerText(),
      /读取失败/,
    );
    await close();
  }
  await page.evaluate(() =>
    localStorage.setItem("mdmd.settings", '{"schemaVersion":99}'),
  );
  await page.reload();
  await ready();
  await settings();
  for (const key of keys)
    assert(await page.locator(`#setting-${key}`).isDisabled());
  assert.equal(await raw(), '{"schemaVersion":99}');
  await close();
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  await page.reload();
  await ready();
  console.log("Visibility evidence:", root);
  console.log(
    "PASS: navigation defaults/independent toggles, active/no-document fallback and focus, hidden history recording, preserved favorites/folder/draft/selection/undo, folder guidance, write rollback/retry, actual restart, schemas1/2/3/4 and future protection, narrow/dark layouts.",
  );
  return page;
}
