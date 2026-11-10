import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { defaultTypography } from "./typography.test.mjs";

export async function testTheme({ page, root, dialog, restart, waitFor }) {
  const stored = () =>
    page.evaluate(() => localStorage.getItem("mdmd.settings"));
  const resolved = () => page.locator("html").getAttribute("data-theme");
  const expectTheme = async (value) =>
    waitFor(async () => (await resolved()) === value, `theme ${value}`);
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
  const choose = async (value) => page.locator(`#theme-${value}`).check();
  const shot = async (name) =>
    page.screenshot({ path: path.join(root, `theme-${name}.png`) });
  await page.locator("#home-settings:not([disabled])").waitFor();
  await page.setViewportSize({ width: 1320, height: 860 });
  assert.equal(await stored(), null);
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme("dark");
  assert.equal(
    await stored(),
    null,
    "system notifications do not write defaults",
  );
  await shot("home-dark");
  await settings();
  assert(await page.locator("#theme-system").isChecked());
  await page.locator("#settings-close").focus();
  await page.keyboard.press("Shift+Tab");
  assert(
    await page
      .locator("#css-edit")
      .evaluate((e) => e === document.activeElement),
  );
  await page.locator("#theme-system").focus();
  await page.keyboard.press("ArrowRight");
  await expectTheme("light");
  await page.keyboard.press("Tab");
  assert(
    await page
      .locator("#palette-manage")
      .evaluate((e) => e === document.activeElement),
  );
  await page.emulateMedia({ colorScheme: "light" });
  await choose("dark");
  await expectTheme("dark");
  await shot("settings-dark");
  await page.locator("#settings-general").click();
  await page.locator("#setting-wordcount").uncheck();
  assert.deepEqual(JSON.parse(await stored()), {
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
    theme: "dark",
    typography: defaultTypography,
  });
  await page.keyboard.press("Escape");
  // Actual process restarts use the same isolated WebView2 profile.
  for (const value of ["dark", "light", "system"]) {
    await settings();
    await choose(value);
    await page.keyboard.press("Escape");
    page = await restart();
    await page.locator("#home-settings:not([disabled])").waitFor();
    await page.emulateMedia({ colorScheme: "dark" });
    await expectTheme(value === "system" ? "dark" : value);
    assert.equal(JSON.parse(await stored()).theme, value);
    assert.equal(JSON.parse(await stored()).showWordCount, false);
  }
  await settings();
  const prior = await stored();
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "mdmd.settings")
        throw new DOMException("test quota", "QuotaExceededError");
      return window.originalSetItem.call(this, key, value);
    };
  });
  await page.locator("#theme-light").click();
  assert(await page.locator("#theme-system").isChecked());
  assert.equal(await resolved(), "dark");
  assert.equal(await stored(), prior);
  assert.match(await page.locator("#settings-message").innerText(), /保存失败/);
  await shot("write-failure");
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalSetItem;
  });
  await choose("light");
  await expectTheme("light");
  await page.keyboard.press("Escape");
  const legacy = JSON.stringify({ schemaVersion: 1, showWordCount: false });
  await page.evaluate(
    (value) => localStorage.setItem("mdmd.settings", value),
    legacy,
  );
  await page.reload();
  await page.locator("#home-settings:not([disabled])").waitFor();
  assert.equal(
    await stored(),
    legacy,
    "read migration must not rewrite old record",
  );
  await settings();
  assert(await page.locator("#theme-system").isChecked());
  await choose("dark");
  assert.deepEqual(JSON.parse(await stored()), {
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
    theme: "dark",
    typography: { ...defaultTypography, softBreaks: false },
  });
  await page.keyboard.press("Escape");
  for (const bad of [
    { schemaVersion: 2, showWordCount: false, theme: "invalid" },
    { schemaVersion: 2, theme: "dark" },
    { schemaVersion: 99, showWordCount: false, theme: "light" },
  ]) {
    const raw = JSON.stringify(bad);
    await page.evaluate(
      (value) => localStorage.setItem("mdmd.settings", value),
      raw,
    );
    await page.reload();
    await page.locator("#home-settings:not([disabled])").waitFor();
    await settings();
    assert(await page.locator("#theme-system").isChecked());
    assert.equal(await stored(), raw);
    assert.equal(
      await page.locator("#theme-light").isDisabled(),
      bad.schemaVersion === 99,
    );
    assert.match(
      await page.locator("#settings-message").innerText(),
      /读取失败|版本暂不支持/,
    );
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  await page.reload();
  await page.locator("#home-settings:not([disabled])").waitFor();
  const file = path.join(root, "主题与阅读排版.md");
  const source = [
    "# 阅读排版与主题",
    "",
    "正文 **加粗**、*强调*、~~删除线~~ 与 `inline code`。 [示例链接](https://example.com)",
    "",
    "## 项目目录与实现",
    "",
    "> 引用中的说明，保留清晰层次和足够留白。",
    "",
    "- 第一项\n  - 嵌套内容\n- 第二项",
    "",
    "1. 开始阅读\n2. 切换主题",
    "",
    "| 路径 | 职责 |\n| --- | --- |\n| src/ | 界面与文档预览 |\n| tests/ | 回归验证 |",
    "",
    "```ts\nconst theme = 'system';\n" + "long_code_".repeat(90) + "\n```",
    "",
    "### 三级标题",
    "#### 四级标题",
    "##### 五级标题",
    "###### 六级标题",
    "",
    Array.from({ length: 12 }, (_, i) => `| 列 ${i}`).join("") +
      "|\n" +
      "| --- ".repeat(12) +
      "|\n" +
      "| 单元格 ".repeat(12) +
      "|",
    "",
    "---",
    "",
    "![本地图片](pixel.png)",
    "",
    ...Array.from(
      { length: 30 },
      (_, i) =>
        `## 章节 ${i}\n\n中文与 English text，检查阅读位置和大纲跟随。\n`,
    ),
  ].join("\n");
  await writeFile(file, source);
  await page.locator("#home-open").click();
  await dialog(file);
  await page.locator("#preview h6").waitFor();
  for (const value of ["light", "dark"]) {
    await settings();
    await choose(value);
    await page.keyboard.press("Escape");
    const metrics = await page.locator("#preview").evaluate((e) => ({
      fontSize: getComputedStyle(e).fontSize,
      lineHeight: getComputedStyle(e).lineHeight,
      maxWidth: getComputedStyle(e).maxWidth,
      headings: [...e.querySelectorAll("h1,h2,h3,h4,h5,h6")]
        .slice(0, 6)
        .map((h) => getComputedStyle(h).fontSize),
      overflow: e.parentElement.scrollWidth > e.parentElement.clientWidth,
      codeScroll:
        e.querySelector("pre").scrollWidth > e.querySelector("pre").clientWidth,
      tableScroll: [...e.querySelectorAll(".table-scroll")].some(
        (t) => t.scrollWidth > t.clientWidth,
      ),
      tableFill:
        Math.abs(
          e.querySelector("table").getBoundingClientRect().width -
            e.querySelector(".table-scroll").clientWidth,
        ) < 2,
    }));
    assert.deepEqual(metrics, {
      fontSize: "16px",
      lineHeight: "28.8px",
      maxWidth: "900px",
      headings: ["32px", "26px", "22px", "19px", "17px", "16px"],
      overflow: false,
      codeScroll: true,
      tableScroll: true,
      tableFill: true,
    });
    await shot(`reader-${value}`);
    const palette = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        [
          "text",
          "heading",
          "muted",
          "accent",
          "surface",
          "canvas",
          "soft",
          "code-text",
          "error",
          "error-bg",
          "warning",
          "warning-bg",
        ].map((name) => [name, style.getPropertyValue("--" + name).trim()]),
      );
    });
    const luminance = (hex) => {
      const values = hex
        .slice(1)
        .match(/../g)
        .map((v) => parseInt(v, 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    for (const [fg, bg] of [
      ["text", "surface"],
      ["muted", "canvas"],
      ["accent", "surface"],
      ["code-text", "soft"],
      ["error", "error-bg"],
      ["warning", "warning-bg"],
    ]) {
      const a = luminance(palette[fg]),
        b = luminance(palette[bg]);
      assert(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5,
        `${value} contrast ${fg}/${bg}`,
      );
    }
  }
  await page.locator("#split-mode").click();
  assert.equal(
    await page
      .locator(".cm-gutters")
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    await page
      .locator(".cm-editor")
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    "editor gutter follows dark surface",
  );
  // Isolate theme preservation from the separately tested bidirectional scroll sync.
  await page.locator("#sync-scroll").uncheck();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n主题切换保留草稿");
  await waitFor(
    async () =>
      (await page.locator("#preview").innerText()).includes("主题切换保留草稿"),
    "draft preview",
  );
  await page.locator("#outline .outline-toggle").first().click();
  await page.locator("#preview-scroll").evaluate((e) => (e.scrollTop = 280));
  const before = await page.evaluate(() => {
    document.querySelector("#preview h1").themeSentinel = true;
    return {
      position: document.querySelector("#position").textContent,
      scroll: document.querySelector("#preview-scroll").scrollTop,
      editorScroll: document.querySelector(".cm-scroller").scrollTop,
    };
  });
  const draft = await editor.innerText();
  await settings();
  await choose("light");
  await choose("dark");
  await page.keyboard.press("Escape");
  assert.equal(await editor.innerText(), draft);
  assert.equal(
    await page
      .locator("#outline .outline-toggle")
      .first()
      .getAttribute("aria-expanded"),
    "false",
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      position: document.querySelector("#position").textContent,
      scroll: document.querySelector("#preview-scroll").scrollTop,
      editorScroll: document.querySelector(".cm-scroller").scrollTop,
    })),
    before,
  );
  assert(await page.locator("#preview h1").evaluate((e) => e.themeSentinel));
  assert((await page.locator("#filename").innerText()).startsWith("●"));
  assert.equal(await readFile(file, "utf8"), source);
  await shot("split-dark");
  for (const width of [1320, 850]) {
    await page.setViewportSize({ width, height: width === 850 ? 560 : 860 });
    await page.locator("#read-mode").click();
    assert(
      await page
        .locator("#preview-scroll")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    );
    await settings();
    await shot(`settings-dark-${width}`);
    assert(
      await page
        .locator("#settings-dialog")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    );
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1320, height: 860 });
  await page.locator("#split-mode").click();
  await editor.focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () => !(await editor.innerText()).includes("主题切换保留草稿"),
    "undo survives theme change",
  );
  await page.locator("#home-back").click();
  if (await page.locator("#confirm-dialog").isVisible())
    await page.locator("button[value=discard]").click();
  await page.locator("#home").waitFor({ state: "visible" });
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await page.locator("#home-settings:not([disabled])").waitFor();
  console.log("Theme evidence:", root);
  console.log(
    "PASS: theme defaults/system media tracking/manual priority, actual restart in all modes, old schema migration, invalid/future records, write rollback, shared settings, typography/overflow/contrast, dirty document/scroll/outline/undo preservation.",
  );
  return page;
}
