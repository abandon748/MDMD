import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { defaultTypography } from "./typography.test.mjs";

const fields = [
  ["outlineFontScale", 75, 200, 5, "%"],
  ["outlineArrowScale", 75, 150, 5, "%"],
  ["outlineGap", 0, 80, 5, "px"],
];
export async function testOutlineLayout({
  page,
  root,
  dialog,
  restart,
  waitFor,
}) {
  const raw = () => page.evaluate(() => localStorage.getItem("mdmd.settings"));
  const stored = async () => JSON.parse(await raw());
  const ready = () => page.locator("#home-settings:not([disabled])").waitFor();
  const open = async () => {
    await page
      .locator(
        (await page.locator("#home").isVisible())
          ? "#home-settings"
          : "#document-settings",
      )
      .click();
    await page.locator("#settings-typography").click();
  };
  const close = () => page.locator("#settings-close").click();
  const step = (key, direction) =>
    page.locator(`[data-step="${key}"][data-direction="${direction}"]`);
  const reset = (key) => page.locator(`#reset-${key}`).click();
  const shot = (name) =>
    page.screenshot({ path: path.join(root, `outline-layout-${name}.png`) });
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
  const metrics = () =>
    page.evaluate(() => {
      const get = (selector) => document.querySelector(selector);
      const style = (selector) => getComputedStyle(get(selector));
      const box = (selector) => get(selector).getBoundingClientRect();
      return {
        font: parseFloat(style(".outline-label").fontSize),
        arrow: parseFloat(style(".outline-toggle").fontSize),
        hitWidth: box(".outline-toggle").width,
        hitHeight: box(".outline-toggle").height,
        sidebar: box(".sidebar").width,
        gap: box("#panes").left - box(".sidebar").right,
        body: style("#preview").fontSize,
        tabs: style("#tab-outline").fontSize,
      };
    });
  await ready();
  await page.setViewportSize({ width: 1320, height: 860 });
  await open();
  assert.equal(await raw(), null);
  for (const [key, min, max, increment, unit] of fields) {
    assert.equal(
      await page.locator(`#value-${key}`).innerText(),
      `${defaultTypography[key]}${unit}`,
    );
    let value = defaultTypography[key];
    while (value < max) {
      await step(key, 1).click();
      value += increment;
      assert.equal((await stored()).typography[key], value);
    }
    assert(await step(key, 1).isDisabled());
    while (value > min) {
      await step(key, -1).click();
      value -= increment;
      assert.equal((await stored()).typography[key], value);
    }
    assert(await step(key, -1).isDisabled());
    await reset(key);
    assert.deepEqual((await stored()).typography, defaultTypography);
  }
  const beforeFailure = await raw();
  await page.evaluate(() => {
    window.outlineSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "mdmd.settings")
        throw new DOMException("test quota", "QuotaExceededError");
      return window.outlineSetItem.call(this, key, value);
    };
  });
  for (const [key, , , , unit] of fields) {
    await step(key, 1).click();
    assert.equal(await raw(), beforeFailure);
    assert.equal(
      await page.locator(`#value-${key}`).innerText(),
      `${defaultTypography[key]}${unit}`,
    );
    assert.match(
      await page.locator("#settings-message").innerText(),
      /保存失败/,
    );
  }
  await shot("save-failure");
  await page.evaluate(
    () => (Storage.prototype.setItem = window.outlineSetItem),
  );
  await close();

  // Real legacy shapes omit all newly introduced fields.
  const {
    outlineFontScale,
    outlineArrowScale,
    outlineGap,
    ...legacyTypography
  } = defaultTypography;
  for (const version of [1, 2, 3, 4, 5]) {
    const old = { schemaVersion: version, showWordCount: false };
    if (version >= 2) old.theme = "dark";
    if (version >= 3)
      old.typography = {
        ...legacyTypography,
        columnWidth: 1000,
        codeWrap: true,
      };
    if (version >= 4)
      old.navigation = { history: false, favorites: true, files: false };
    if (version >= 5)
      old.shortcuts = {
        scheme: "typora",
        overrides: { mdmd: {}, typora: { open: "F6" }, obsidian: {} },
      };
    const original = JSON.stringify(old);
    await load(original);
    await open();
    assert.equal(await raw(), original, "loading never rewrites old data");
    for (const [key, , , , unit] of fields)
      assert.equal(
        await page.locator(`#value-${key}`).innerText(),
        `${defaultTypography[key]}${unit}`,
      );
    await step("outlineGap", 1).click();
    const next = await stored();
    assert.equal(next.schemaVersion, 16);
    assert.deepEqual(next.typography, {
      ...defaultTypography,
      ...old.typography,
      swapPanes: false,
      softBreaks: false,
      outlineGap: 25,
    });
    assert.equal(next.theme, old.theme || "system");
    assert.equal(next.showWordCount, false);
    assert.deepEqual(
      next.navigation,
      old.navigation || { history: true, favorites: true, files: true },
    );
    assert.deepEqual(
      next.shortcuts,
      old.shortcuts || {
        scheme: "mdmd",
        overrides: { mdmd: {}, typora: {}, obsidian: {} },
      },
    );
    await close();
  }
  const valid = { ...(await stored()), typography: defaultTypography };
  for (const [key, min, max] of fields) {
    for (const bad of [
      undefined,
      "100",
      min - 5,
      max + 5,
      min + 1,
      min + 0.5,
      null,
    ]) {
      const record = JSON.stringify({
        ...valid,
        typography: { ...defaultTypography, [key]: bad },
      });
      await load(record);
      await open();
      assert.equal(await raw(), record);
      assert.match(
        await page.locator("#settings-message").innerText(),
        /读取失败/,
      );
      for (const [name, , , , unit] of fields)
        assert.equal(
          await page.locator(`#value-${name}`).innerText(),
          `${defaultTypography[name]}${unit}`,
        );
      await close();
    }
  }
  // Migration must not fill a missing pre-existing required field.
  const incomplete = { ...legacyTypography };
  delete incomplete.fontScale;
  await load(
    JSON.stringify({ ...valid, schemaVersion: 5, typography: incomplete }),
  );
  await open();
  assert.match(await page.locator("#settings-message").innerText(), /读取失败/);
  await close();
  await load('{"schemaVersion":99}');
  await open();
  assert.equal(
    await page
      .locator(
        "#settings-typography-content button:enabled, #settings-typography-content input:enabled",
      )
      .count(),
    0,
  );
  assert.equal(await raw(), '{"schemaVersion":99}');
  await close();
  await load(null);

  const data = path.join(root, "outline-layout");
  await mkdir(data);
  const file = path.join(data, "目录排版.md");
  const source =
    "# 长标题用于检查目录大字号的省略与提示\n\n" +
    Array.from(
      { length: 40 },
      (_, i) =>
        `${"#".repeat((i % 5) + 2)} 章节 ${i}\n\n正文内容 English 123。\n`,
    ).join("\n");
  await writeFile(file, source);
  await page.locator("#home-open").click();
  await dialog(file);
  await page.locator("#outline .outline-label").first().waitFor();
  const base = await metrics();
  assert.equal(base.font, 12);
  assert.equal(base.arrow, 12);
  assert.equal(base.gap, 20);
  assert.equal(base.hitWidth, 22);
  assert.equal(base.hitHeight, 30);
  await page.locator("#outline .outline-label").nth(5).click();
  await page.locator("#outline .outline-toggle").first().click();
  await page.locator("#split-mode").click();
  await page.locator("#sync-scroll").uncheck();
  const editor = page.locator(".cm-content");
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n目录设置草稿");
  await waitFor(
    async () =>
      (await page.locator("#preview").innerText()).includes("目录设置草稿"),
    "outline layout draft",
  );
  await page.locator("#preview-scroll").evaluate((e) => (e.scrollTop = 200));
  await page.waitForTimeout(100);
  const content = () => editor.locator(".cm-line").allTextContents();
  const draft = await content();
  const position = await page.locator("#position").textContent();
  await page.evaluate(() => {
    window.outlineNode = document.querySelector(".outline-label");
    window.previewNode = document.querySelector("#preview h1");
    window.activeOutline = document.querySelector(
      ".outline-label[aria-current]",
    );
    window.previewTop = document.querySelector("#preview-scroll").scrollTop;
  });
  await open();
  await step("outlineFontScale", 1).click();
  assert.equal((await metrics()).font, 12.6);
  assert.equal((await metrics()).arrow, base.arrow);
  await step("outlineArrowScale", 1).click();
  assert.equal((await metrics()).arrow, 12.6);
  await step("outlineGap", 1).click();
  const adjusted = await metrics();
  assert.equal(adjusted.gap, 25);
  assert.equal(adjusted.sidebar, base.sidebar);
  assert.equal(adjusted.body, base.body);
  assert.equal(adjusted.tabs, base.tabs);
  assert.equal(adjusted.hitWidth, base.hitWidth);
  assert.equal(adjusted.hitHeight, base.hitHeight);
  assert.deepEqual(await content(), draft);
  assert.equal(await page.locator("#position").textContent(), position);
  assert.equal(await readFile(file, "utf8"), source);
  assert.equal(
    await page.locator(".outline-toggle").first().getAttribute("aria-expanded"),
    "false",
  );
  assert(
    await page.evaluate(
      () =>
        window.outlineNode === document.querySelector(".outline-label") &&
        window.previewNode === document.querySelector("#preview h1") &&
        window.activeOutline ===
          document.querySelector(".outline-label[aria-current]") &&
        window.previewTop ===
          document.querySelector("#preview-scroll").scrollTop,
    ),
  );
  // Test maximum scale independently from body, in both themes and narrow panes.
  for (const [key, , max] of fields)
    while ((await stored()).typography[key] < max) await step(key, 1).click();
  await page.locator("#settings-appearance").click();
  await page.locator("#theme-dark").check();
  await page.locator("#settings-typography").click();
  for (const width of [1320, 850]) {
    await page.setViewportSize({ width, height: width === 850 ? 650 : 860 });
    await step("outlineArrowScale", 1).scrollIntoViewIfNeeded();
    await shot(`settings-dark-${width}`);
    assert(
      await page
        .locator("#settings-dialog")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    );
  }
  await close();
  await page.locator("#read-mode").click();
  await page.locator(".outline-toggle").first().click();
  assert.equal(
    await page.locator(".outline-toggle").first().getAttribute("aria-expanded"),
    "true",
  );
  await page.locator(".outline-label").nth(5).click();
  await waitFor(
    async () =>
      (await page
        .locator(".outline-label")
        .nth(5)
        .getAttribute("aria-current")) !== null,
    "scaled heading jump",
  );
  assert.equal((await metrics()).font, 24);
  assert.equal((await metrics()).arrow, 18);
  assert.equal((await metrics()).gap, 80);
  assert.equal((await metrics()).hitWidth, 22);
  assert.equal((await metrics()).hitHeight, 30);
  assert(
    await page
      .locator("#outline")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  assert(
    await page
      .locator(".outline-label")
      .first()
      .evaluate((e) => e.scrollWidth > e.clientWidth && !!e.title),
  );
  await shot("reader-dark-max-850");
  await page
    .locator("#preview-scroll")
    .evaluate((e) => (e.scrollTop = e.scrollHeight));
  await waitFor(
    async () =>
      (await page.locator(".outline-label[aria-current]").innerText()).includes(
        "章节 39",
      ),
    "scaled current heading follows scroll",
  );
  await open();
  for (const [key, min] of fields)
    while ((await stored()).typography[key] > min) await step(key, -1).click();
  await page.locator("#settings-appearance").click();
  await page.locator("#theme-light").check();
  await close();
  assert.equal((await metrics()).font, 9);
  assert.equal((await metrics()).arrow, 9);
  assert.equal((await metrics()).gap, 0);
  assert.equal((await metrics()).hitWidth, 22);
  assert.equal((await metrics()).hitHeight, 30);
  await shot("reader-light-min-850");
  await open();
  for (const [key] of fields) {
    await reset(key);
    await step(key, 1).click();
  }
  const persisted = await raw();
  await close();
  await page.locator("#split-mode").click();
  await editor.focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () => !(await content()).join("\n").includes("目录设置草稿"),
    "outline layout keeps undo",
  );
  await page.locator("#home-back").click();
  if (await page.locator("#confirm-dialog").isVisible())
    await page.locator("button[value=discard]").click();
  page = await restart();
  await ready();
  assert.equal(await raw(), persisted);
  await page.locator("#home-open").click();
  await dialog(file);
  await page.locator(".outline-label").first().waitFor();
  assert.equal((await metrics()).font, 12.6);
  assert.equal((await metrics()).arrow, 12.6);
  assert.equal((await metrics()).gap, 25);
  await shot("restart");
  await page.locator("#home-back").click();
  await ready();
  const empty = path.join(data, "无标题.md");
  await writeFile(empty, "没有标题的正文。");
  await page.locator("#home-open").click();
  await dialog(empty);
  await page.locator(".empty-outline").waitFor();
  await open();
  await step("outlineFontScale", 1).click();
  await close();
  assert.equal(await page.locator(".outline-label").count(), 0);
  assert(await page.locator(".empty-outline").isVisible());
  await page.locator("#home-back").click();
  await ready();
  await load(null);
  console.log("Outline layout evidence:", root);
  console.log(
    "PASS: directory typography defaults/steps/bounds/reset, independent rendered geometry and fixed hit areas, draft/undo/outline node/collapse/current/scroll preservation, long titles/empty outline/jump/follow, write rollback, schema1-5 migration and invalid/future protection, actual restart, narrow dark/light extremes.",
  );
  return page;
}
