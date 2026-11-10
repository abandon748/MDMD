import assert from "node:assert/strict";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function testStatistics({ page, root, dialog, restart, waitFor }) {
  const data = path.join(root, "statistics-data");
  await mkdir(data);
  const output = () => page.locator("#wordcount").innerText();
  const expect = (text) => waitFor(async () => (await output()) === text, text);
  const open = async (file) => {
    await page.keyboard.press("Control+o");
    await dialog(file);
    await waitFor(
      async () =>
        (await page.locator("#filepath").innerText()) === file &&
        (await page.locator("#open").isEnabled()),
      "file open finished",
    );
  };
  const settings = async () => {
    await page.locator("#document-settings").click();
    await page.locator("#settings-general").click();
  };
  const select = async (selector, reverse = false) => {
    await page.locator(selector).evaluate((node, reverse) => {
      document.activeElement?.blur();
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      if (reverse)
        selection.setBaseAndExtent(
          range.endContainer,
          range.endOffset,
          range.startContainer,
          range.startOffset,
        );
      else selection.addRange(range);
    }, reverse);
  };
  await page.locator("#home-open:not([disabled])").waitFor();
  await page.setViewportSize({ width: 1320, height: 860 });
  const file = path.join(data, "统计口径.md");
  const original =
    "# 中A😀\n\n**粗体** [链接](https://example.invalid)\n\n- 列表\n\n|甲|乙|\n|--|--|\n|丙|丁|\n\n```txt\na b\n\n中😀\n```\n\n![图片替代文字](missing.png)\n\né &amp; \\*\n\n---\n";
  await writeFile(file, original);
  await open(file);
  await expect("字数 21");
  await select("#preview h1");
  await expect("选中 3 · 全文 21");
  await select("#preview h1", true);
  await expect("选中 3 · 全文 21");
  await select("#preview table");
  await expect("选中 4 · 全文 21");
  await select("#preview pre code");
  await expect("选中 4 · 全文 21");
  await select("#preview");
  await expect("选中 21 · 全文 21");
  await page.evaluate(() => {
    const r = document.createRange();
    r.setStart(document.querySelector("#tab-outline").firstChild, 0);
    r.setEnd(document.querySelector("#preview h1").firstChild, 1);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await expect("字数 21");
  // Select a real whitespace text node, not a collapsed caret.
  await page.evaluate(() => {
    const p = document.querySelector("#preview p");
    const node = [...p.childNodes].find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent === " ",
    );
    const r = document.createRange();
    r.selectNodeContents(node);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await expect("选中 0 · 全文 21");
  await settings();
  await expect("字数 21");
  await page.locator("#settings-typography").click();
  await page.locator("#setting-codeLineNumbers").check();
  await page.locator("#setting-codeWrap").check();
  await page.keyboard.press("Escape");
  await select("#preview pre code");
  await expect("选中 4 · 全文 21");
  await page.screenshot({ path: path.join(root, "statistics-preview.png") });
  await page.locator("#split-mode").click();
  const editor = page.locator(".cm-content");
  await editor.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("# 中A😀\n\n**粗体**");
  await expect("字数 5");
  await page.keyboard.press("Control+a");
  await expect("源码选中 10 · 全文 5");
  await page.screenshot({ path: path.join(root, "statistics-source.png") });
  assert.equal(await readFile(file, "utf8"), original);
  await page.keyboard.press("ArrowRight");
  await expect("字数 5");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("ArrowRight");
  await expect("字数 21");
  await page.keyboard.press("Control+y");
  await page.keyboard.press("ArrowRight");
  await expect("字数 5");
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("ab ab");
  await expect("字数 4");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+d");
  await expect("源码选中 2 · 全文 4");
  await page.keyboard.press("Control+d");
  await expect("源码选中 4 · 全文 4");
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("# 中A😀\n\n**粗体**");
  await expect("字数 5");
  await page.keyboard.press("Control+s");
  await expect("字数 5");
  await page.locator("#read-mode").click();
  await expect("字数 5");
  await settings();
  await page.locator("#setting-wordcount").uncheck();
  await page.keyboard.press("Escape");
  await select("#preview h1");
  assert(await page.locator("#wordcount").isHidden());
  const stored = await page.evaluate(() =>
    localStorage.getItem("mdmd.settings"),
  );
  page = await restart();
  await page.locator("#home-open:not([disabled])").waitFor();
  await open(file);
  assert(await page.locator("#wordcount").isHidden());
  assert.equal(
    await page.evaluate(() => localStorage.getItem("mdmd.settings")),
    stored,
  );
  await settings();
  await page.locator("#setting-wordcount").check();
  await page.keyboard.press("Escape");
  await expect("字数 5");
  for (const [name, content, expected] of [
    ["empty", "", 0],
    ["whitespace", " \t\n\u00a0", 0],
    ["unicode", "\ufeff# 👩‍💻 é 𠮷\r\n\r\nHello, world!\r\n", 18],
  ]) {
    const sample = path.join(data, `${name}-statistics.md`);
    await writeFile(sample, content);
    await open(sample);
    await expect(`字数 ${expected}`);
  }
  const large = path.join(data, "large-statistics.md");
  await writeFile(large, "a".repeat(1024 * 1024 + 1));
  await open(large);
  await expect("字数 待刷新");
  await page.locator("#split-mode").click();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+ArrowRight");
  await expect("源码选中 1 · 全文 待刷新");
  await page.locator("#refresh").click();
  await expect(`字数 ${(1024 * 1024 + 1).toLocaleString()}`);
  const largeCopy = path.join(data, "large-copy-statistics.md");
  await page.keyboard.press("Control+Shift+s");
  await dialog(largeCopy);
  await waitFor(
    async () =>
      (await page.locator("#filepath").innerText()) === largeCopy &&
      (await page.locator("#open").isEnabled()),
    "large Save As finished",
  );
  await expect("字数 待刷新");
  await page.locator("#refresh").click();
  await expect(`字数 ${(1024 * 1024 + 1).toLocaleString()}`);
  for (const width of [1320, 850]) {
    await page.setViewportSize({ width, height: width === 850 ? 560 : 860 });
    await page.screenshot({
      path: path.join(root, `statistics-large-${width}.png`),
    });
    assert(
      await page
        .locator("#document-view footer")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    );
  }
  await page.locator("#home-back").click();
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  await page.reload();
  await page.locator("#home-open:not([disabled])").waitFor();
  console.log("Statistics evidence:", root);
  console.log(
    "PASS: rendered Unicode count, punctuation/code/table/link/image rules, forward/reverse/multi-block/whitespace/outside selections, source literal selection, edit/undo/redo/save, display toggle and real restart, empty/BOM/CRLF/Unicode, large pending/manual refresh, responsive footer.",
  );
  return page;
}
