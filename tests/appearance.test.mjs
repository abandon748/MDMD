import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { defaultTypography } from "./typography.test.mjs";

export async function testAppearance({ page, root, dialog, restart, waitFor }) {
  const defaults = { palette: "default", corners: "rounded", custom: [] };
  const raw = () => page.evaluate(() => localStorage.getItem("mdmd.settings"));
  const stored = async () => JSON.parse(await raw());
  const ready = () => page.locator("#home-open:not([disabled])").waitFor();
  const settings = async () => {
    await page
      .locator(
        (await page.locator("#home").isVisible())
          ? "#home-settings"
          : "#document-settings",
      )
      .click();
    await page.locator("#settings-appearance").click();
  };
  const close = async () => {
    await page.evaluate(() => {
      window.appearanceClosed = false;
      document.querySelector("#settings-dialog").addEventListener(
        "close",
        () => {
          window.appearanceClosed = true;
        },
        { once: true },
      );
    });
    await page.locator("#settings-close").click();
    await waitFor(
      () => page.evaluate(() => window.appearanceClosed),
      "settings close and focus restoration",
    );
  };
  const manage = () => page.locator("#palette-manage").click();
  const apply = () => page.locator("#palette-apply").click();
  const corner = (value) =>
    page.locator("#setting-corners").selectOption(value);
  const shot = (name) =>
    page.screenshot({ path: path.join(root, `appearance-${name}.png`) });
  const previewRadii = () =>
    page
      .locator(".corner-preview-table, .corner-preview-samples pre")
      .evaluateAll((nodes) =>
        nodes.map((node) => getComputedStyle(node).borderRadius),
      );
  const controlsRadii = () =>
    page
      .locator("#settings-dialog, #settings-close")
      .evaluateAll((nodes) =>
        nodes.map((node) => getComputedStyle(node).borderRadius),
      );
  const load = async (value) => {
    await page.evaluate(
      (value) =>
        value === null
          ? localStorage.removeItem("mdmd.settings")
          : localStorage.setItem("mdmd.settings", value),
      value,
    );
    await page.reload();
    await ready();
  };
  const color = () =>
    page
      .locator("html")
      .evaluate((e) => getComputedStyle(e).getPropertyValue("--text").trim());
  await ready();
  await page.setViewportSize({ width: 1320, height: 860 });
  await settings();
  assert.equal(await raw(), null);
  assert.equal(await page.locator("#setting-palette").inputValue(), "default");
  assert.equal(await page.locator("#setting-corners").inputValue(), "rounded");
  assert.deepEqual(await previewRadii(), ["8px", "8px"]);
  const controls = await controlsRadii();
  await page.locator("#corner-preview").scrollIntoViewIfNeeded();
  await shot("preview-rounded");
  await manage();
  assert(await page.locator("#palette-name").isDisabled());
  assert(await page.locator("#palette-delete").isDisabled());
  await page.locator("#palette-copy").click();
  await page.locator("#palette-name").fill("取消方案");
  await page.keyboard.press("Escape");
  assert(await page.locator("#palette-dialog").isHidden());
  assert(await page.locator("#settings-dialog").isVisible());
  assert.equal(await raw(), null);
  await manage();
  assert.equal(await page.locator("#palette-select option").count(), 1);
  await page.locator("#palette-copy").click();
  await page.locator("#palette-name").fill("默认");
  await apply();
  assert.match(await page.locator("#palette-message").innerText(), /重复/);
  await page.locator("#palette-name").fill("我的阅读配色");
  await page.locator("#palette-light-text").fill("#224466");
  await page.locator("#palette-dark-text").fill("#baccdd");
  await shot("manager");
  await apply();
  const id = (await stored()).appearance.palette;
  await page.locator("#theme-light").check();
  assert.equal(await color(), "#224466");
  await page.locator("#theme-dark").check();
  assert.equal(await color(), "#baccdd");
  await page.locator("#corner-preview").scrollIntoViewIfNeeded();
  await shot("preview-dark");
  await page.locator("#theme-system").check();
  await page.emulateMedia({ colorScheme: "light" });
  await waitFor(
    async () => (await color()) === "#224466",
    "custom system light",
  );
  const beforeSystem = await raw();
  await page.emulateMedia({ colorScheme: "dark" });
  await waitFor(
    async () => (await color()) === "#baccdd",
    "custom system dark",
  );
  assert.equal(await raw(), beforeSystem);
  // Each draft modification is transactional, including deletion and save failure.
  await manage();
  await page.locator("#palette-delete").click();
  await page.locator("#palette-cancel").click();
  assert.equal((await stored()).appearance.palette, id);
  await manage();
  await page.locator("#palette-name").fill("重命名");
  const beforeFailure = await raw();
  await page.evaluate(() => {
    window.appearanceSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "mdmd.settings")
        throw new DOMException("test quota", "QuotaExceededError");
      return window.appearanceSet.call(this, k, v);
    };
  });
  await apply();
  assert.equal(await raw(), beforeFailure);
  assert.match(await page.locator("#palette-message").innerText(), /保存失败/);
  await page.locator("#palette-cancel").click();
  await page.locator("#setting-palette").selectOption("default");
  assert.equal(await page.locator("#setting-palette").inputValue(), id);
  assert.equal(await raw(), beforeFailure);
  await corner("square");
  assert.equal(await page.locator("#setting-corners").inputValue(), "rounded");
  assert.deepEqual(
    await previewRadii(),
    ["8px", "8px"],
    "failed write must roll preview back with setting",
  );
  await page.evaluate(() => {
    Storage.prototype.setItem = window.appearanceSet;
  });
  await manage();
  await page.locator("#palette-name").fill("重命名");
  await apply();
  assert.equal((await stored()).appearance.custom[0].name, "重命名");
  await corner("square");
  assert.deepEqual(await previewRadii(), ["0px", "0px"]);
  assert.deepEqual(
    await controlsRadii(),
    controls,
    "settings controls are outside corner scope",
  );
  await page.locator("#corner-preview").scrollIntoViewIfNeeded();
  await shot("preview-square");
  await shot("settings");
  await manage();
  await page.locator("#palette-select").focus();
  await page.keyboard.press("Shift+Tab");
  assert(
    await page
      .locator("#palette-apply")
      .evaluate((e) => e === document.activeElement),
  );
  await page.keyboard.press("Tab");
  assert(
    await page
      .locator("#palette-select")
      .evaluate((e) => e === document.activeElement),
  );
  await shot("manager-saved");
  await page.setViewportSize({ width: 640, height: 720 });
  assert(
    await page
      .locator("#palette-dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  await page.locator("#palette-apply").scrollIntoViewIfNeeded();
  await shot("manager-640");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1320, height: 860 });
  await close();
  const persistent = await raw();
  page = await restart();
  await ready();
  assert.equal(await raw(), persistent);
  await settings();
  assert.equal(await page.locator("#setting-corners").inputValue(), "square");
  assert.deepEqual(
    await previewRadii(),
    ["0px", "0px"],
    "preview follows persisted setting after restart",
  );
  assert.equal(await page.locator("#setting-palette").inputValue(), id);
  await page.locator("#theme-light").check();
  assert.equal(await color(), "#224466");
  await page.locator("#settings-general").click();
  await page.locator("#setting-language").selectOption("en");
  await page.locator("#settings-appearance").click();
  assert.equal(
    await page.locator("#corner-preview-label").innerText(),
    "Corner preview",
  );
  await page.setViewportSize({ width: 640, height: 720 });
  await page.locator("#corner-preview").scrollIntoViewIfNeeded();
  assert(
    await page
      .locator("#settings-dialog")
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  );
  assert(
    await page
      .locator("#corner-preview")
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  );
  await shot("preview-english-640");
  await page.locator("#settings-general").click();
  await page.locator("#setting-language").selectOption("system");
  await close();
  await page.setViewportSize({ width: 1320, height: 860 });
  const data = path.join(root, "appearance-fixtures");
  await mkdir(data);
  const file = path.join(data, "配色与圆角.md");
  const source =
    "# 配色与圆角\n\n正文 `inline`\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\n> 引用\n";
  await writeFile(file, source);
  await page.locator("#home-open").click();
  await dialog(file);
  await page.locator("#preview pre").waitFor();
  const radii = () =>
    page.evaluate(() =>
      ["#preview pre", "#preview .table-scroll", "#preview table"].map(
        (s) => getComputedStyle(document.querySelector(s)).borderRadius,
      ),
    );
  assert.deepEqual(await radii(), ["0px", "0px", "0px"]);
  await shot("reading-square");
  await page.locator("#split-mode").click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n草稿保留");
  await waitFor(
    async () =>
      (await page.locator("#preview").innerText()).includes("草稿保留"),
    "draft render",
  );
  const draft = await page.locator(".cm-line").allTextContents();
  await page.evaluate(() => {
    window.appearanceNode = document.querySelector("#preview pre");
  });
  await settings();
  await corner("rounded");
  assert.deepEqual(await previewRadii(), ["8px", "8px"]);
  await page.locator("#setting-palette").selectOption("default");
  await close();
  assert.deepEqual(await radii(), ["8px", "8px", "8px"]);
  assert.equal(await color(), "#303740");
  assert(
    await page.evaluate(
      () => window.appearanceNode === document.querySelector("#preview pre"),
    ),
  );
  assert.deepEqual(await page.locator(".cm-line").allTextContents(), draft);
  assert.equal(await readFile(file, "utf8"), source);
  assert.equal(
    await page
      .locator("#preview p code")
      .evaluate((e) => getComputedStyle(e).borderRadius),
    "4px",
  );
  await shot("reading-rounded");
  await settings();
  await page.locator("#setting-palette").selectOption(id);
  await manage();
  await page.locator("#palette-delete").click();
  await apply();
  assert.deepEqual((await stored()).appearance, defaults);
  await close();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () =>
      !(await page.locator(".cm-content").innerText()).includes("草稿保留"),
    "undo survived appearance",
  );
  await page.locator("#home-back").click();
  if (await page.locator("#confirm-dialog").isVisible())
    await page.locator("button[value=discard]").click();
  await ready();
  // Schema 7 must preserve both booleans; older migrations run in the full suite.
  const legacy = {
    schemaVersion: 7,
    theme: "dark",
    showWordCount: false,
    typography: { ...defaultTypography, swapPanes: true, softBreaks: false },
    navigation: { history: false, favorites: true, files: true },
    shortcuts: {
      scheme: "typora",
      overrides: { mdmd: {}, typora: { open: "F6" }, obsidian: {} },
    },
  };
  await load(JSON.stringify(legacy));
  await settings();
  assert.equal(await raw(), JSON.stringify(legacy));
  await corner("square");
  const next = await stored();
  assert.equal(next.schemaVersion, 16);
  assert.deepEqual(next.typography, legacy.typography);
  assert.deepEqual(next.shortcuts, legacy.shortcuts);
  assert.deepEqual(next.navigation, legacy.navigation);
  assert.deepEqual(next.appearance, { ...defaults, corners: "square" });
  await close();
  for (const appearance of [
    { ...defaults, palette: "missing" },
    { ...defaults, corners: "invalid" },
    { ...defaults, custom: [{ id: "test", name: "x", light: {}, dark: {} }] },
  ]) {
    const bad = JSON.stringify({ ...next, appearance });
    await load(bad);
    await settings();
    assert.equal(await raw(), bad);
    assert.equal(
      await page.locator("#setting-corners").inputValue(),
      "rounded",
    );
    assert.match(
      await page.locator("#settings-message").innerText(),
      /读取失败/,
    );
    await close();
  }
  await load('{"schemaVersion":99}');
  await settings();
  for (const id of ["setting-palette", "setting-corners", "palette-manage"])
    assert(await page.locator(`#${id}`).isDisabled());
  assert.equal(await raw(), '{"schemaVersion":99}');
  await close();
  await load(null);
  console.log("Appearance evidence:", root);
  console.log(
    "PASS: palettes copy/rename/delete/select, light/dark/system, draft cancellation, failed writes rollback, restart, content radii, unchanged Markdown/editor draft/undo/preview nodes, schema7 migration and invalid/future preservation.",
  );
  return page;
}
