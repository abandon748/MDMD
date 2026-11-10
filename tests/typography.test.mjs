import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export const defaultTypography = {
  bodyFont: "",
  codeFont: "",
  fontScale: 100,
  columnWidth: 900,
  outlineFontScale: 100,
  outlineArrowScale: 100,
  outlineGap: 20,
  swapPanes: false,
  softBreaks: true,
  codeLineNumbers: false,
  codeWrap: false,
};

export async function testTypography({ page, root, dialog, restart, waitFor }) {
  const raw = () => page.evaluate(() => localStorage.getItem("mdmd.settings"));
  const stored = async () => JSON.parse(await raw());
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
  const font = async (target, name) => {
    await page.locator(`#choose-${target}`).click();
    await page.locator("#font-name").fill(name);
    await page.locator("#font-apply").click();
    assert(await page.locator("#font-dialog").isHidden());
  };
  const shot = (name) =>
    page.screenshot({ path: path.join(root, `typography-${name}.png`) });
  await page.locator("#home-settings:not([disabled])").waitFor();
  await page.setViewportSize({ width: 1320, height: 860 });
  await open();
  assert.equal(await raw(), null);
  assert.equal(await page.locator("#value-fontScale").innerText(), "100%");
  assert.equal(await page.locator("#value-columnWidth").innerText(), "900px");
  assert(!(await page.locator("#setting-codeLineNumbers").isChecked()));
  assert(!(await page.locator("#setting-codeWrap").isChecked()));
  await page.locator("#choose-bodyFont").click();
  await page.locator("#font-name").fill("SimSun");
  await page.locator("#font-cancel").click();
  assert.equal(await raw(), null);
  assert(
    await page
      .locator("#choose-bodyFont")
      .evaluate((e) => e === document.activeElement),
  );
  await page.locator("#choose-codeFont").click();
  await page.locator("#font-name").fill("Arial");
  await page.keyboard.press("Escape");
  assert(await page.locator("#font-dialog").isHidden());
  assert(await page.locator("#settings-dialog").isVisible());
  assert.equal(await raw(), null);
  await font("bodyFont", " SimSun ");
  await font("codeFont", "Courier New");
  assert.deepEqual((await stored()).typography, {
    ...defaultTypography,
    bodyFont: "SimSun",
    codeFont: "Courier New",
  });
  for (const [key, min, max, step] of [
    ["fontScale", 75, 200, 5],
    ["columnWidth", 450, 1600, 50],
  ]) {
    const plus = page.locator(`[data-step=${key}][data-direction="1"]`),
      minus = page.locator(`[data-step=${key}][data-direction="-1"]`);
    let value = (await stored()).typography[key];
    while (value < max) {
      await plus.click();
      value += step;
      assert.equal((await stored()).typography[key], value);
    }
    assert(await plus.isDisabled());
    while (value > min) {
      await minus.click();
      value -= step;
      assert.equal((await stored()).typography[key], value);
    }
    assert(await minus.isDisabled());
    await page.locator(`#reset-${key}`).click();
    assert.equal((await stored()).typography[key], defaultTypography[key]);
  }
  await page.locator("#choose-bodyFont").click();
  for (const invalid of ["Arial; color:red", "Arial, serif", '"Arial"']) {
    await page.locator("#font-name").fill(invalid);
    await page.locator("#font-apply").click();
    assert(await page.locator("#font-dialog").isVisible());
    assert.match(await page.locator("#font-message").innerText(), /单个字体名/);
    assert.equal((await stored()).typography.bodyFont, "SimSun");
  }
  await page.locator("#font-name").fill("MDMD-Uninstalled-Font-Example");
  await page.locator("#font-apply").click();
  assert.match(
    await page
      .locator("#preview")
      .evaluate((e) => getComputedStyle(e).fontFamily),
    /MDMD-Uninstalled-Font-Example.*Segoe UI/,
  );
  await font("bodyFont", "SimSun");
  // A real storage method exception must leave the entire saved record unchanged.
  const beforeFailure = await raw();
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "mdmd.settings")
        throw new DOMException("test quota", "QuotaExceededError");
      return window.originalSetItem.call(this, k, v);
    };
  });
  await page.locator('[data-step=columnWidth][data-direction="1"]').click();
  await page.locator("#setting-codeWrap").click();
  assert(!(await page.locator("#setting-codeWrap").isChecked()));
  assert.equal(await page.locator("#value-columnWidth").innerText(), "900px");
  await page.locator("#choose-bodyFont").click();
  await page.locator("#font-name").fill("Arial");
  await page.locator("#font-apply").click();
  assert(await page.locator("#font-dialog").isVisible());
  assert.match(await page.locator("#font-message").innerText(), /保存失败/);
  assert.equal(await raw(), beforeFailure);
  await shot("save-failure");
  await page.evaluate(
    () => (Storage.prototype.setItem = window.originalSetItem),
  );
  await page.locator("#font-apply").click();
  await page.locator("#choose-bodyFont").click();
  await page.locator("#font-default").click();
  assert.equal((await stored()).typography.bodyFont, "");
  await page.locator("#choose-codeFont").click();
  await page.locator("#font-default").click();
  await page.keyboard.press("Escape");

  const file = path.join(root, "字体、栏宽及代码.md");
  const code =
    'const sample = "<script>&安全文本";\n\n' + "long_code_".repeat(100) + "\n";
  const source =
    "# 排版设置\n\n中文 English 123 与 `inline code`。\n\n## 代码显示\n\n```ts\n" +
    code +
    "```\n\n    indented\n    code\n\n```\n```\n\n" +
    Array.from(
      { length: 25 },
      (_, i) => `## 章节 ${i}\n\n正文内容用于检查大纲与字体重排。\n`,
    ).join("\n");
  await writeFile(file, source);
  await page.locator("#home-open").click();
  await dialog(file);
  await page.locator("#preview pre code").first().waitFor();
  assert.equal(
    await page.locator("#preview pre code").first().textContent(),
    code,
  );
  assert.equal(
    await page.locator("#preview pre").nth(0).locator(".code-line").count(),
    3,
  );
  assert.equal(
    await page.locator("#preview pre").nth(1).locator(".code-line").count(),
    2,
  );
  assert.equal(
    await page.locator("#preview pre").nth(2).locator(".code-line").count(),
    1,
  );
  await page.locator("#split-mode").click();
  await page.locator("#sync-scroll").uncheck();
  const editor = page.locator(".cm-content");
  const editorFont = await editor.evaluate(
    (e) => getComputedStyle(e).fontFamily,
  );
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n排版测试草稿");
  await waitFor(
    async () =>
      (await page.locator("#preview").innerText()).includes("排版测试草稿"),
    "typography draft rendered",
  );
  const draft = await editor.innerText();
  await page.locator("#outline .outline-toggle").first().click();
  await page.locator("#preview-scroll").evaluate((e) => (e.scrollTop = 180));
  const position = await page.locator("#position").textContent();
  await open();
  await font("bodyFont", "SimSun");
  await font("codeFont", "Courier New");
  await page.locator('[data-step=fontScale][data-direction="1"]').click();
  await page.locator('[data-step=columnWidth][data-direction="1"]').click();
  assert.equal(
    await page
      .locator("#preview")
      .evaluate((e) => getComputedStyle(e).fontSize),
    "16.8px",
  );
  assert.equal(
    await page
      .locator("#preview h1")
      .evaluate((e) => getComputedStyle(e).fontSize),
    "33.6px",
  );
  assert.equal(
    await page
      .locator("#preview")
      .evaluate((e) => getComputedStyle(e).maxWidth),
    "950px",
  );
  assert.match(
    await page
      .locator("#preview p code")
      .first()
      .evaluate((e) => getComputedStyle(e).fontFamily),
    /Courier New/,
  );
  assert.equal(
    await editor.evaluate((e) => getComputedStyle(e).fontFamily),
    editorFont,
  );
  assert.equal(await page.locator("#position").textContent(), position);
  assert.equal(await editor.innerText(), draft);
  assert.equal(
    await page
      .locator("#outline .outline-toggle")
      .first()
      .getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(await readFile(file, "utf8"), source);
  for (const numbered of [false, true])
    for (const wrap of [false, true]) {
      await page.locator("#setting-codeLineNumbers").setChecked(numbered);
      await page.locator("#setting-codeWrap").setChecked(wrap);
      const metric = await page
        .locator("#preview pre")
        .first()
        .evaluate((pre) => {
          const lines = pre.querySelectorAll(".code-line");
          return {
            overflow: pre.scrollWidth > pre.clientWidth,
            number: getComputedStyle(lines[0], "::before").content,
            wrapped:
              lines[2].getBoundingClientRect().height >
              lines[0].getBoundingClientRect().height * 2,
            blankHeight: lines[1].getBoundingClientRect().height,
            lineHeight: parseFloat(getComputedStyle(lines[1]).lineHeight),
          };
        });
      assert.equal(metric.overflow, !wrap);
      assert.equal(metric.wrapped, wrap);
      assert.equal(metric.number, numbered ? '"1"' : "none");
      assert(Math.abs(metric.blankHeight - metric.lineHeight) < 1);
      assert.equal(
        await page.locator("#preview pre code").first().textContent(),
        code,
      );
    }
  await page.keyboard.press("Escape");
  const selected = await page
    .locator("#preview pre code")
    .first()
    .evaluate((e) => {
      const range = document.createRange();
      range.selectNodeContents(e);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const text = selection.toString();
      selection.removeAllRanges();
      return text;
    });
  assert.equal(
    selected.trimEnd(),
    code.trimEnd(),
    "copied selection must contain code only",
  );
  await shot("split-numbered-wrap");
  await open();
  await page.locator("#settings-appearance").click();
  await page.locator("#theme-dark").check();
  await page.locator("#settings-general").click();
  await page.locator("#setting-wordcount").uncheck();
  await page.locator("#settings-typography").click();
  const saved = await stored();
  for (const width of [1320, 850]) {
    await page.setViewportSize({ width, height: width === 850 ? 560 : 860 });
    await shot(`settings-dark-${width}`);
    assert(
      await page
        .locator("#settings-dialog")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    );
    await page.locator("#choose-codeFont").click();
    await shot(`font-dark-${width}`);
    await page.locator("#font-cancel").click();
  }
  await page.keyboard.press("Escape");
  await page.locator("#read-mode").click();
  assert(
    await page
      .locator("#preview-scroll")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  await shot("reader-dark-850");
  await page.locator("#split-mode").click();
  await editor.focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () => !(await editor.innerText()).includes("排版测试草稿"),
    "typography keeps undo",
  );
  await page.locator("#home-back").click();
  if (await page.locator("#confirm-dialog").isVisible())
    await page.locator("button[value=discard]").click();
  page = await restart();
  await page.locator("#home-settings:not([disabled])").waitFor();
  assert.deepEqual(await stored(), saved);
  await open();
  assert.equal(await page.locator("#value-fontScale").innerText(), "105%");
  assert.equal(await page.locator("#value-bodyFont").innerText(), "SimSun");
  assert(await page.locator("#setting-codeLineNumbers").isChecked());
  assert(await page.locator("#setting-codeWrap").isChecked());
  await page.keyboard.press("Escape");
  for (const old of [
    { schemaVersion: 1, showWordCount: false },
    { schemaVersion: 2, showWordCount: false, theme: "dark" },
  ]) {
    const original = JSON.stringify(old);
    await page.evaluate(
      (raw) => localStorage.setItem("mdmd.settings", raw),
      original,
    );
    await page.reload();
    await page.locator("#home-settings:not([disabled])").waitFor();
    await open();
    assert.equal(await raw(), original);
    assert.equal(await page.locator("#value-fontScale").innerText(), "100%");
    await page.locator("#setting-codeWrap").check();
    assert.deepEqual(await stored(), {
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
      navigation: { history: true, favorites: true, files: true },
      showWordCount: false,
      theme: old.theme || "system",
      typography: { ...defaultTypography, codeWrap: true, softBreaks: false },
    });
    await page.keyboard.press("Escape");
  }
  for (const invalid of [
    { fontScale: 102 },
    { columnWidth: 1650 },
    { codeWrap: "true" },
    { bodyFont: "x;bad" },
    { codeFont: "x".repeat(81) },
  ]) {
    const record = JSON.stringify({
      schemaVersion: 3,
      theme: "dark",
      showWordCount: false,
      typography: { ...defaultTypography, ...invalid },
    });
    await page.evaluate(
      (v) => localStorage.setItem("mdmd.settings", v),
      record,
    );
    await page.reload();
    await page.locator("#home-settings:not([disabled])").waitFor();
    await open();
    assert.equal(await raw(), record);
    assert.match(
      await page.locator("#settings-message").innerText(),
      /读取失败/,
    );
    assert.equal(await page.locator("#value-columnWidth").innerText(), "900px");
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() =>
    localStorage.setItem(
      "mdmd.settings",
      JSON.stringify({ schemaVersion: 99 }),
    ),
  );
  await page.reload();
  await page.locator("#home-settings:not([disabled])").waitFor();
  await open();
  assert.equal(
    await page
      .locator(
        "#settings-typography-content button:enabled, #settings-typography-content input:enabled",
      )
      .count(),
    0,
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  await page.reload();
  await page.locator("#home-settings:not([disabled])").waitFor();
  console.log("Typography evidence:", root);
  console.log(
    "PASS: font preview/apply/cancel/default/fallback validation, size/width steps and bounds, all line-number/wrap combinations and copy text, settings rollback/retry, actual restart, schema1/2 migration and invalid/future protection, draft/undo/outline/editor preservation, narrow/dark layouts.",
  );
  return page;
}
