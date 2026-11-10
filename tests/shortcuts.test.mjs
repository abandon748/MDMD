import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultTypography } from "./typography.test.mjs";

export async function testShortcuts({ page, root, dialog, waitFor, restart }) {
  const data = path.join(root, "shortcuts-data");
  await mkdir(data);
  const file = path.join(data, "快捷键.md"),
    copy = path.join(data, "副本.md");
  await writeFile(file, "# 原文");
  const raw = () => page.evaluate(() => localStorage.getItem("mdmd.settings"));
  const config = async () => JSON.parse(await raw()).shortcuts;
  const ready = () => page.locator("#home-open:not([disabled])").waitFor();
  const idle = () =>
    waitFor(() => page.locator("#open").isEnabled(), "shortcut command idle");
  const content = async () =>
    (await page.locator(".cm-line").allTextContents()).join("\n");
  const expectContent = (text) =>
    waitFor(async () => (await content()) === text, `source ${text}`);
  const settings = async () => {
    await page
      .locator(
        (await page.locator("#home").isVisible())
          ? "#home-settings"
          : "#document-settings",
      )
      .click();
    await page.locator("#settings-shortcuts").click();
  };
  const scheme = (name) => page.locator(`[data-scheme="${name}"]`).click();
  const record = (action) => page.locator(`#shortcut-${action}`).click();
  const assign = async (action, key) => {
    await record(action);
    await page.keyboard.press(key);
    await waitFor(
      async () =>
        (await page
          .locator(`#shortcut-${action}`)
          .getAttribute("aria-pressed")) === "false",
      "binding saved",
    );
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await page.locator("#settings-dialog").waitFor({ state: "hidden" });
  };
  const shot = (name) =>
    page.screenshot({ path: path.join(root, `shortcuts-${name}.png`) });
  await ready();
  await page.setViewportSize({ width: 1320, height: 860 });
  assert.equal(await raw(), null);
  await settings();
  assert.equal(await page.locator("#shortcut-list button").count(), 22);
  assert.equal(
    await page.locator('[data-scheme="mdmd"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await raw(), null);
  assert.equal(await page.locator("#shortcut-inline").innerText(), "F2");
  assert.equal(await page.locator("#shortcut-quote").innerText(), "未绑定");
  assert.equal(await page.locator("#shortcut-code").innerText(), "未绑定");
  assert.deepEqual(
    await page
      .locator("#shortcut-list button")
      .evaluateAll((nodes) => nodes.slice(0, 3).map((n) => n.id)),
    ["shortcut-inline", "shortcut-split", "shortcut-external"],
  );
  await assign("quote", "Control+Shift+q");
  assert.equal((await config()).overrides.mdmd.quote, "Ctrl+Shift+Q");
  await assign("quote", "Backspace");
  assert.equal(await page.locator("#shortcut-quote").innerText(), "未绑定");
  assert.equal((await config()).overrides.mdmd.quote, undefined);
  await scheme("typora");
  assert.equal((await config()).scheme, "typora");
  assert.match(await page.locator("#shortcut-redo").innerText(), /Shift/);
  assert.match(await page.locator("#shortcut-inline").innerText(), /\//);
  assert.match(await page.locator("#shortcut-quote").innerText(), /Q/);
  await scheme("obsidian");
  assert.equal(await page.locator("#shortcut-split").innerText(), "F3");
  assert.match(await page.locator("#shortcut-inline").innerText(), /E/);
  await shot("presets");
  await close();
  await page.keyboard.press("Control+o");
  await dialog(file);
  await waitFor(
    async () =>
      (await page.locator("#filepath").innerText()) === file &&
      (await page.locator("#open").isEnabled()),
    "default open",
  );
  for (const [name, key] of [
    ["mdmd", "F2"],
    ["typora", "Control+/"],
    ["obsidian", "Control+e"],
  ]) {
    await settings();
    await scheme(name);
    await shot(`mapping-${name}`);
    await close();
    await page.locator("#preview h1").click();
    await page.keyboard.press(key);
    assert(
      await page.locator("#inline-rich").isVisible(),
      `${name} opens inline, not split`,
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("F3");
    assert(await page.locator("#editor").isVisible(), `${name} F3 opens split`);
    for (const formatKey of ["Control+Shift+q", "Control+Shift+Backquote"]) {
      await page.locator("#editor .cm-content").focus();
      await page.keyboard.press("Control+a");
      await page.keyboard.press(formatKey);
      if (name === "mdmd") await expectContent("# 原文");
      else {
        await waitFor(
          async () => (await content()) !== "# 原文",
          `${name} ${formatKey} formats`,
        );
        await page.keyboard.press("Control+z");
        await expectContent("# 原文");
      }
    }
    await page.keyboard.press("F3");
    assert(await page.locator("#editor").isHidden());
  }
  await page.keyboard.press("F3");
  assert(await page.locator("#editor").isVisible());
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("# 草稿");
  await page.keyboard.press("Control+z");
  await expectContent("# 原文");
  await page.keyboard.press("Control+Shift+z");
  await expectContent("# 草稿");
  await settings();
  await scheme("mdmd");
  const initial = await raw();
  await record("open");
  await page.keyboard.press("Control+s");
  assert.match(
    await page.locator("#shortcut-message").innerText(),
    /保存.*冲突/,
  );
  assert.equal(await raw(), initial);
  assert.equal(
    await readFile(file, "utf8"),
    "# 原文",
    "recorded Save cannot leak into document",
  );
  await page.keyboard.press("Control+a");
  assert.match(await page.locator("#shortcut-message").innerText(), /保留/);
  await page.keyboard.press("a");
  assert.match(await page.locator("#shortcut-message").innerText(), /普通字符/);
  await page.keyboard.press("Escape");
  assert(await page.locator("#settings-dialog").isVisible());
  assert.equal(await raw(), initial);
  await record("open");
  await page.keyboard.press("Tab");
  assert.equal(
    await page.locator("#shortcut-open").getAttribute("aria-pressed"),
    "false",
  );
  await record("open");
  await page.evaluate(() => {
    const node = document.activeElement;
    for (const flags of [
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
    ])
      node.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F6",
          code: "F6",
          bubbles: true,
          cancelable: true,
          ...flags,
        }),
      );
  });
  assert.equal(await raw(), initial);
  await page.keyboard.press("F6");
  assert.equal((await config()).overrides.mdmd.open, "F6");
  assert.equal(
    await page.locator("#open").getAttribute("aria-keyshortcuts"),
    "F6",
  );
  assert.match(await page.locator("#home-open kbd").innerText(), /F6/);
  await scheme("typora");
  assert.equal((await config()).overrides.mdmd.open, "F6");
  assert.equal((await config()).overrides.typora.open, undefined);
  await assign("open", "Control+Shift+o");
  await scheme("mdmd");
  assert.match(await page.locator("#shortcut-open").innerText(), /F6/);
  // Reset can conflict with another custom action; never steal its mapping.
  await assign("new", "Control+o");
  await record("open");
  await page.keyboard.press("Backspace");
  assert.match(
    await page.locator("#shortcut-message").innerText(),
    /新建文件.*冲突/,
  );
  assert.equal((await config()).overrides.mdmd.open, "F6");
  await page.keyboard.press("Escape");
  await assign("new", "Backspace");
  await assign("open", "Backspace");
  assert.equal((await config()).overrides.mdmd.open, undefined);
  await assign("open", "F6");
  await assign("save", "F7");
  await assign("saveAs", "F8");
  await assign("split", "F9");
  await assign("settings", "F10");
  await assign("undo", "Control+q");
  // Ctrl+B is now Bold; explicitly free it before assigning Redo.
  await assign("bold", "Control+Shift+b");
  await assign("redo", "Control+b");
  await assign("find", "Control+j");
  await assign("refresh", "Control+Shift+r");
  const beforeFailure = await raw();
  await page.evaluate(() => {
    window.savedShortcutSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "mdmd.settings")
        throw new DOMException("test quota", "QuotaExceededError");
      return window.savedShortcutSetItem.call(this, key, value);
    };
  });
  await record("open");
  await page.keyboard.press("Control+Shift+o");
  assert.equal(await raw(), beforeFailure);
  assert.match(await page.locator("#shortcut-message").innerText(), /保存失败/);
  assert.match(await page.locator("#open").getAttribute("title"), /F6/);
  await page.keyboard.press("Escape");
  await scheme("obsidian");
  assert.equal(await raw(), beforeFailure);
  assert.equal(
    await page.locator('[data-scheme="mdmd"]').getAttribute("aria-pressed"),
    "true",
  );
  await page.evaluate(() => {
    Storage.prototype.setItem = window.savedShortcutSetItem;
  });
  await assign("external", "Control+Shift+e");
  await assign("new", "F4");
  await page.locator("#settings-general").click();
  await page.locator("#setting-history").uncheck();
  await page.locator("#settings-appearance").click();
  await page.locator("#theme-dark").check();
  await page.locator("#settings-shortcuts").click();
  await page.setViewportSize({ width: 850, height: 650 });
  await shot("custom-dark");
  await close();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  assert.equal(
    await content(),
    "# 草稿",
    "old undo no longer reaches CodeMirror",
  );
  await page.keyboard.press("Control+q");
  await expectContent("# 原文");
  await page.keyboard.press("Control+y");
  assert.equal(await content(), "# 原文", "old redo disabled");
  await page.keyboard.press("Control+b");
  await expectContent("# 草稿");
  await page.keyboard.press("F7");
  await waitFor(
    async () => (await readFile(file, "utf8")) === "# 草稿",
    "custom save",
  );
  await idle();
  await page.keyboard.press("F9");
  assert(await page.locator("#editor").isHidden());
  await page.keyboard.press("F3");
  assert(await page.locator("#editor").isHidden(), "old split disabled");
  await page.keyboard.press("F9");
  assert(await page.locator("#editor").isVisible());
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+f");
  assert.equal(await page.locator(".cm-search").count(), 0);
  await page.keyboard.press("Control+j");
  assert(await page.locator(".cm-search").isVisible());
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+r");
  assert.equal(await page.locator("#preview h1").innerText(), "草稿");
  await page.keyboard.press("F8");
  await dialog(copy);
  await waitFor(
    async () =>
      (await page.locator("#filepath").innerText()) === copy &&
      (await page.locator("#open").isEnabled()),
    "custom Save As",
  );
  assert.equal(await readFile(copy, "utf8"), "# 草稿");
  await page.keyboard.press("F6");
  await dialog("", true);
  await idle();
  assert.equal(await page.locator("#filepath").innerText(), copy);
  await page.keyboard.press("Control+,");
  assert(await page.locator("#settings-dialog").isHidden());
  await page.keyboard.press("F10");
  await page.locator("#settings-dialog").waitFor({ state: "visible" });
  await close();
  await page.keyboard.press("F4");
  await waitFor(
    async () =>
      (await page.locator("#filename").innerText()).includes("未命名"),
    "custom new memory document",
  );
  assert.match(await page.locator("#welcome-shortcuts").innerText(), /F6/);
  const persistent = await raw();
  page = await restart();
  await ready();
  assert.equal(await raw(), persistent);
  assert.equal(JSON.parse(persistent).schemaVersion, 16);
  assert.equal(JSON.parse(persistent).navigation.history, false);
  assert.equal(JSON.parse(persistent).theme, "dark");
  assert.equal((await config()).overrides.typora.open, "Ctrl+Shift+O");
  await page.keyboard.press("F10");
  await page.locator("#settings-dialog").waitFor({ state: "visible" });
  await page.locator("#settings-shortcuts").click();
  await shot("restart");
  await close();
  // Home new still uses the native create-file workflow with a remapped key.
  const created = path.join(data, "新建.md");
  await page.keyboard.press("F4");
  await dialog(created);
  await waitFor(
    async () =>
      (await page.locator("#filepath").innerText()) === created &&
      (await page.locator("#open").isEnabled()),
    "custom home new",
  );
  assert.equal(await readFile(created, "utf8"), "");
  await page.locator("#home-back").click();
  await ready();
  for (const version of [1, 2, 3, 4]) {
    const old = { schemaVersion: version, showWordCount: false };
    if (version >= 2) old.theme = "dark";
    if (version >= 3) old.typography = { ...defaultTypography, codeWrap: true };
    if (version >= 4)
      old.navigation = { history: false, favorites: true, files: false };
    const text = JSON.stringify(old);
    await page.evaluate(
      (value) => localStorage.setItem("mdmd.settings", value),
      text,
    );
    await page.reload();
    await ready();
    await settings();
    assert.equal(await raw(), text);
    await scheme("obsidian");
    const stored = JSON.parse(await raw());
    assert.equal(stored.schemaVersion, 16);
    assert.equal(stored.showWordCount, false);
    assert.equal(stored.theme, old.theme || "system");
    assert.deepEqual(stored.typography, {
      ...(old.typography || defaultTypography),
      swapPanes: false,
      softBreaks: false,
    });
    assert.deepEqual(
      stored.navigation,
      old.navigation || { history: true, favorites: true, files: true },
    );
    assert.deepEqual(stored.shortcuts, {
      scheme: "obsidian",
      overrides: { mdmd: {}, typora: {}, obsidian: {} },
    });
    await close();
  }
  // Defaults changed, but valid old explicit bindings must not invalidate all settings.
  const legacyPreset = JSON.parse(await raw());
  legacyPreset.shortcuts = {
    scheme: "obsidian",
    overrides: {
      mdmd: { quote: "Ctrl+Shift+Q" },
      typora: {},
      obsidian: { open: "F3", find: "Ctrl+E" },
    },
  };
  const legacyText = JSON.stringify(legacyPreset);
  await page.evaluate(
    (text) => localStorage.setItem("mdmd.settings", text),
    legacyText,
  );
  await page.reload();
  await ready();
  await settings();
  assert.equal(
    await raw(),
    legacyText,
    "reading old settings must not rewrite them",
  );
  assert.equal(await page.locator("#shortcut-open").innerText(), "F3");
  assert.match(await page.locator("#shortcut-find").innerText(), /E/);
  assert.notEqual(await page.locator("#shortcut-split").innerText(), "F3");
  assert.doesNotMatch(await page.locator("#shortcut-inline").innerText(), /E/);
  assert.equal(await page.locator("#settings-message").innerText(), "");
  await scheme("mdmd");
  assert.match(await page.locator("#shortcut-quote").innerText(), /Q/);
  await assign("quote", "Backspace");
  assert.equal(await page.locator("#shortcut-quote").innerText(), "未绑定");
  await close();
  for (const bad of [
    null,
    { scheme: "oops", overrides: {} },
    {
      scheme: "mdmd",
      overrides: { mdmd: { open: "Ctrl+S" }, typora: {}, obsidian: {} },
    },
  ]) {
    const value = JSON.stringify({
      schemaVersion: 5,
      theme: "dark",
      showWordCount: false,
      typography: defaultTypography,
      navigation: { history: false, favorites: true, files: true },
      shortcuts: bad,
    });
    await page.evaluate(
      (text) => localStorage.setItem("mdmd.settings", text),
      value,
    );
    await page.reload();
    await ready();
    await settings();
    assert.equal(await raw(), value);
    assert.match(
      await page.locator("#settings-message").innerText(),
      /读取失败/,
    );
    assert.equal(
      await page.locator('[data-scheme="mdmd"]').getAttribute("aria-pressed"),
      "true",
    );
    await close();
  }
  await page.evaluate(() =>
    localStorage.setItem("mdmd.settings", '{"schemaVersion":99}'),
  );
  await page.reload();
  await ready();
  await settings();
  assert.equal(
    await page.locator("#settings-shortcuts-content button:enabled").count(),
    0,
  );
  await close();
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  await page.reload();
  await ready();
  console.log("Shortcuts evidence:", root);
  console.log(
    "PASS: three schemes and independent overrides, conflict/reset conflict/reserved/plain/IME/repeat guards, Escape/Tab cancel, write/scheme failure rollback, dynamic hints, real remapped command execution and old-key suppression, draft/undo preservation, actual restart, schema1-4 migration/bad/future protection, narrow/dark settings.",
  );
  return page;
}
