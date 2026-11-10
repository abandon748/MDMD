import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { defaultTypography } from "./typography.test.mjs";

export async function testSplitBreaks({
  page,
  root,
  dialog,
  restart,
  waitFor,
}) {
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
    await page.locator("#settings-typography").click();
  };
  const close = () => page.locator("#settings-close").click();
  const toggle = (key, value) =>
    page.locator(`#setting-${key}`).setChecked(value);
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
  const shot = (name) =>
    page.screenshot({ path: path.join(root, `split-breaks-${name}.png`) });
  await ready();
  await page.setViewportSize({ width: 1320, height: 860 });
  await settings();
  assert.equal(await raw(), null);
  assert(!(await page.locator("#setting-swapPanes").isChecked()));
  assert(await page.locator("#setting-softBreaks").isChecked());
  await close();
  const { swapPanes, softBreaks, ...oldTypography } = defaultTypography;
  for (const version of [1, 2, 3, 4, 5, 6]) {
    const old = { schemaVersion: version, showWordCount: false };
    if (version >= 2) old.theme = "dark";
    if (version >= 3)
      old.typography = {
        ...oldTypography,
        columnWidth: 1000,
        outlineGap: 25,
        codeWrap: true,
      };
    if (version >= 4)
      old.navigation = { history: false, favorites: true, files: true };
    if (version >= 5)
      old.shortcuts = {
        scheme: "typora",
        overrides: { mdmd: {}, typora: { open: "F6" }, obsidian: {} },
      };
    const text = JSON.stringify(old);
    await load(text);
    await settings();
    assert.equal(await raw(), text);
    assert(!(await page.locator("#setting-softBreaks").isChecked()));
    assert(!(await page.locator("#setting-swapPanes").isChecked()));
    await toggle("swapPanes", true);
    const value = await stored();
    assert.equal(value.schemaVersion, 16);
    assert.deepEqual(value.typography, {
      ...defaultTypography,
      ...old.typography,
      swapPanes: true,
      softBreaks: false,
    });
    assert.equal(value.showWordCount, false);
    assert.equal(value.theme, old.theme || "system");
    assert.deepEqual(
      value.navigation,
      old.navigation || { history: true, favorites: true, files: true },
    );
    assert.deepEqual(
      value.shortcuts,
      old.shortcuts || {
        scheme: "mdmd",
        overrides: { mdmd: {}, typora: {}, obsidian: {} },
      },
    );
    await close();
  }
  const valid = { ...(await stored()), typography: defaultTypography };
  for (const key of ["swapPanes", "softBreaks"])
    for (const value of [undefined, null, "true", 1]) {
      const text = JSON.stringify({
        ...valid,
        typography: { ...defaultTypography, [key]: value },
      });
      await load(text);
      await settings();
      assert.equal(await raw(), text);
      assert.match(
        await page.locator("#settings-message").innerText(),
        /读取失败/,
      );
      assert(!(await page.locator("#setting-swapPanes").isChecked()));
      assert(await page.locator("#setting-softBreaks").isChecked());
      await close();
    }
  await load('{"schemaVersion":99}');
  await settings();
  assert(await page.locator("#setting-swapPanes").isDisabled());
  assert(await page.locator("#setting-softBreaks").isDisabled());
  await close();
  await load(null);
  const data = path.join(root, "split-breaks");
  await mkdir(data);
  const file = path.join(data, "分栏换行.md");
  const source =
    "# 分栏与换行\n\nalpha\nbeta\n\nhard  \nbreak\n\nslash\\\nbreak\n\n> 引用一\n> 引用二\n\n- 列表一\n  列表二\n\n```txt\na\nb\n```\n\n    x\n    y\n\n" +
    Array.from(
      { length: 35 },
      (_, i) => `## 章节 ${i}\n\n正文第一行 ${i}\n正文第二行 ${i}\n`,
    ).join("\n");
  await writeFile(file, source);
  const open = async (file) => {
    await page
      .locator(
        (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
      )
      .click();
    await dialog(file);
    await waitFor(
      async () =>
        (await page.locator("#filepath").innerText()) === file &&
        (await page.locator("#open").isEnabled()),
      "split/breaks open",
    );
  };
  await open(file);
  const breaks = () =>
    page.locator("#preview > p").first().locator("br").count();
  const geometry = () =>
    page.evaluate(() => {
      const box = (selector) =>
        document.querySelector(selector).getBoundingClientRect();
      const p = box("#panes"),
        e = box(".editor-pane"),
        v = box(".preview-pane"),
        d = box("#divider");
      return {
        editor: e.left,
        preview: v.left,
        divider: d.left,
        ratio: (e.width / p.width) * 100,
        height: e.height,
        previewHeight: v.height,
        previewWidth: v.width,
        width: p.width,
        left: p.left,
      };
    });
  assert.equal(await breaks(), 1);
  await page.locator("#split-mode").click();
  await page.locator("#sync-scroll").uncheck();
  assert((await geometry()).editor < (await geometry()).preview);
  let divider = page.locator("#divider");
  await divider.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  assert.equal(await divider.getAttribute("aria-valuenow"), "40");
  const editor = page.locator(".cm-content");
  const content = () => editor.locator(".cm-line").allTextContents();
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n测试草稿");
  await waitFor(
    async () =>
      (await page.locator("#preview").innerText()).includes("测试草稿"),
    "split draft",
  );
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+End");
  const selected = await page.evaluate(() => getSelection().toString());
  const draft = await content();
  await page.locator(".outline-toggle").first().click();
  await page.locator("#preview-scroll").evaluate((e) => (e.scrollTop = 180));
  await page.evaluate(() => {
    window.splitPreview = document.querySelector("#preview h1");
    window.splitEditor = document.querySelector(".cm-content");
  });
  await settings();
  await toggle("swapPanes", true);
  const swapped = await geometry();
  assert(swapped.editor > swapped.preview);
  assert(Math.abs(swapped.ratio - 40) < 0.1);
  assert.equal(swapped.height, swapped.previewHeight);
  assert.match(await divider.getAttribute("aria-valuetext"), /40%.*右侧/);
  assert(
    await page.evaluate(
      () =>
        window.splitPreview === document.querySelector("#preview h1") &&
        window.splitEditor === document.querySelector(".cm-content"),
    ),
  );
  assert.deepEqual(await content(), draft);
  assert.equal(await readFile(file, "utf8"), source);
  await close();
  await editor.focus();
  assert.equal(await page.evaluate(() => getSelection().toString()), selected);
  await divider.focus();
  const before = (await geometry()).divider;
  await page.keyboard.press("ArrowLeft");
  assert.equal(await divider.getAttribute("aria-valuenow"), "42");
  assert((await geometry()).divider < before);
  await page.keyboard.press("ArrowRight");
  assert.equal(await divider.getAttribute("aria-valuenow"), "40");
  const drag = async (fraction) => {
    const b = await divider.boundingBox(),
      g = await geometry();
    await page.mouse.move(b.x + b.width / 2, b.y + 50);
    await page.mouse.down();
    await page.mouse.move(g.left + g.width * fraction, b.y + 50, { steps: 5 });
    await page.mouse.up();
  };
  await drag(0.9);
  assert.equal(await divider.getAttribute("aria-valuenow"), "25");
  await drag(0.1);
  assert.equal(await divider.getAttribute("aria-valuenow"), "75");
  await drag(0.6);
  assert.equal(await divider.getAttribute("aria-valuenow"), "40");
  await page.locator("#read-mode").click();
  assert(await divider.isHidden());
  assert(
    Math.abs((await geometry()).previewWidth - (await geometry()).width) < 1,
  );
  await page.locator("#split-mode").click();
  assert((await geometry()).editor > (await geometry()).preview);
  // Establish the selection after pointer resizing and mode navigation.
  await editor.focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+End");
  const breakSelected = await page.evaluate(() => getSelection().toString());
  assert.equal(breakSelected, selected);
  await settings();
  await toggle("swapPanes", false);
  assert((await geometry()).editor < (await geometry()).preview);
  assert(Math.abs((await geometry()).ratio - 40) < 0.2);
  await toggle("swapPanes", true);
  const oldRecord = await raw();
  await page.evaluate(() => {
    window.splitSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "mdmd.settings")
        throw new DOMException("test quota", "QuotaExceededError");
      return window.splitSetItem.call(this, k, v);
    };
  });
  for (const key of ["swapPanes", "softBreaks"]) {
    await page.locator(`#setting-${key}`).click();
    assert.equal(await raw(), oldRecord);
    assert(await page.locator(`#setting-${key}`).isChecked());
    assert.equal(await breaks(), 1);
    assert((await geometry()).editor > (await geometry()).preview);
    assert.match(
      await page.locator("#settings-message").innerText(),
      /保存失败/,
    );
  }
  await page.evaluate(() => (Storage.prototype.setItem = window.splitSetItem));
  const count = await page.locator("#wordcount").innerText();
  const code = await page.locator("#preview pre code").allTextContents();
  for (const enabled of [false, true, false]) {
    await toggle("softBreaks", enabled);
    assert.equal(await breaks(), enabled ? 1 : 0);
    assert.equal(
      await page.locator("#preview > p").nth(1).locator("br").count(),
      1,
    );
    assert.equal(
      await page.locator("#preview > p").nth(2).locator("br").count(),
      1,
    );
    assert.equal(
      await page.locator("#preview blockquote br").count(),
      enabled ? 1 : 0,
    );
    assert.equal(await page.locator("#preview li br").count(), enabled ? 1 : 0);
    assert.deepEqual(
      await page.locator("#preview pre code").allTextContents(),
      code,
    );
    assert.equal(
      await page
        .locator(".outline-toggle")
        .first()
        .getAttribute("aria-expanded"),
      "false",
    );
    await waitFor(
      async () => (await page.locator("#wordcount").innerText()) === count,
      "soft breaks count unchanged",
    );
    assert.deepEqual(await content(), draft);
    assert.equal(await readFile(file, "utf8"), source);
  }
  await page.locator("#settings-appearance").click();
  await page.locator("#theme-dark").check();
  await page.locator("#settings-typography").click();
  await page.locator("#setting-softBreaks").scrollIntoViewIfNeeded();
  await shot("settings-dark");
  await close();
  await page.setViewportSize({ width: 850, height: 650 });
  await shot("swapped-dark-850");
  assert.equal((await geometry()).height, (await geometry()).previewHeight);
  assert(
    await page
      .locator("#panes")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  await editor.focus();
  await waitFor(
    async () =>
      (await page.evaluate(() => getSelection().toString())) === breakSelected,
    "soft breaks retains editor selection",
  );
  await page.keyboard.press("Control+z");
  await waitFor(
    async () => !(await content()).join("\n").includes("测试草稿"),
    "breaks keeps undo",
  );
  await page.locator(".outline-toggle").first().click();
  await page.locator(".outline-label").nth(5).click();
  await waitFor(
    async () =>
      (await page
        .locator(".outline-label")
        .nth(5)
        .getAttribute("aria-current")) !== null,
    "swapped outline jump",
  );
  await page.locator("#sync-scroll").check();
  await page.waitForTimeout(180);
  await page
    .locator("#preview-scroll")
    .evaluate((e) => (e.scrollTop = e.scrollHeight));
  await waitFor(
    async () =>
      await page.locator(".cm-scroller").evaluate((e) => e.scrollTop > 100),
    "swapped preview to editor sync",
  );
  await page.waitForTimeout(180);
  await page.locator(".cm-scroller").evaluate((e) => (e.scrollTop = 0));
  await waitFor(
    async () =>
      await page.locator("#preview-scroll").evaluate((e) => e.scrollTop < 100),
    "swapped editor to preview sync",
  );
  await page.locator("#home-back").click();
  if (await page.locator("#confirm-dialog").isVisible())
    await page.locator("button[value=discard]").click();
  const persistent = await raw();
  page = await restart();
  divider = page.locator("#divider");
  await ready();
  assert.equal(await raw(), persistent);
  await open(file);
  assert.equal(await breaks(), 0);
  await page.locator("#split-mode").click();
  assert((await geometry()).editor > (await geometry()).preview);
  assert.equal(await divider.getAttribute("aria-valuenow"), "50");
  await shot("restart");
  // Read-only mixed endings: preview preferences never rewrite the original bytes.
  const readonly = path.join(data, "只读.md"),
    readonlySource = "# 只读\r\n\r\nfirst\nsecond\n";
  await writeFile(readonly, readonlySource);
  await open(readonly);
  assert(await page.locator("#save").isDisabled());
  await settings();
  await toggle("softBreaks", true);
  await close();
  assert.equal(await breaks(), 1);
  assert.equal(await readFile(readonly, "utf8"), readonlySource);
  // Keep the existing large-document manual-refresh boundary.
  const large = path.join(data, "大文档.md");
  await writeFile(large, "# 大文档\n\na\nb\n\n" + "x".repeat(1024 * 1024 + 1));
  await open(large);
  await settings();
  await toggle("softBreaks", false);
  await close();
  assert.match(await page.locator("#wordcount").innerText(), /待刷新/);
  assert.match(await page.locator("#outline").innerText(), /点击刷新/);
  await page.locator("#refresh").click();
  await waitFor(
    async () =>
      !(await page.locator("#wordcount").innerText()).includes("待刷新"),
    "manual large parse",
  );
  assert.equal(await breaks(), 0);
  await settings();
  await toggle("softBreaks", true);
  await close();
  assert.match(await page.locator("#wordcount").innerText(), /待刷新/);
  assert.equal(await breaks(), 0, "no eager large parse");
  await page.locator("#refresh").click();
  await waitFor(async () => (await breaks()) === 1, "large refresh new breaks");
  await page.locator("#home-back").click();
  await ready();
  await load(null);
  console.log("Split/breaks evidence:", root);
  console.log(
    "PASS: fresh defaults/legacy semantics/schema1-6 migration and validation, swapped geometry/editor ratio/pointer+keyboard bounds/read-only reading layout, rollback, soft/hard/block/code rules, draft/selection/undo/outline/count preservation, reversed sync scroll, actual restart, read-only bytes and large manual refresh.",
  );
  return page;
}
