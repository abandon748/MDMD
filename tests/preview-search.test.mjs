import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
export async function testPreviewSearch({ page, root, dialog, waitFor }) {
  const file = path.join(root, "正文搜索.md");
  const source =
    "# Search\n\nHello **world** 中文\n\nhello WORLD 中文\n\n```text\n中文 [.*]\n```\n";
  await writeFile(file, source);
  await page
    .locator((await page.locator("#home").isVisible()) ? "#home-open" : "#open")
    .click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  const stats = await page.locator("#wordcount").innerText();
  await page.keyboard.press("Control+f");
  await page.locator("#preview-query").fill("hello world");
  assert.equal(await page.locator("#preview-matches").innerText(), "1 / 2");
  assert.equal(
    await page.evaluate(() => CSS.highlights.get("mdmd-search").size),
    2,
  );
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#preview-matches").innerText(), "2 / 2");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#preview-matches").innerText(), "1 / 2");
  await page.keyboard.press("Shift+Enter");
  assert.equal(await page.locator("#preview-matches").innerText(), "2 / 2");
  await page.locator("#preview-query").fill("中文");
  assert.equal(await page.locator("#preview-matches").innerText(), "1 / 3");
  await page.locator("#refresh").click();
  await waitFor(
    async () =>
      await page.evaluate(() =>
        [...CSS.highlights.get("mdmd-search")].every(
          (r) => r.toString() === "中文",
        ),
      ),
    "fresh search ranges",
  );
  await page.screenshot({ path: path.join(root, "preview-search.png") });
  await page.locator("#preview-query").fill("[.*]");
  assert.equal(await page.locator("#preview-matches").innerText(), "1 / 1");
  await page.locator("#preview-query").fill("absent");
  assert.equal(await page.locator("#preview-matches").innerText(), "0 / 0");
  assert(await page.locator("#preview-next").isDisabled());
  await page.keyboard.press("Escape");
  assert(await page.locator("#preview-search").isHidden());
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("mdmd-search")),
    false,
  );
  assert.equal(await page.locator("#wordcount").innerText(), stats);
  assert.equal(await readFile(file, "utf8"), source);
  await page.locator("#split-mode").click();
  await page.keyboard.press("Control+f");
  await page.locator("#editor .cm-search").waitFor();
  assert(await page.locator("#preview-search").isHidden());
  await page.keyboard.press("Escape");
  await page.locator("#read-mode").click();
  await page.locator("#preview-find").click();
  await page.locator("#preview-query").fill("中文");
  const other = path.join(root, "搜索另一篇.md");
  await writeFile(other, "# Other\n");
  await page.locator("#open").click();
  await dialog(other);
  await page.locator("#open:not(:disabled)").waitFor();
  assert(await page.locator("#preview-search").isHidden());
  assert.equal(await page.locator("#preview-query").inputValue(), "");
  const large = path.join(root, "搜索容量.md");
  await writeFile(large, "# Limit\n\n" + "needle ".repeat(160000));
  await page.locator("#open").click();
  await dialog(large);
  await page.locator("#open:not(:disabled)").waitFor();
  await page.locator("#refresh").click();
  await page.locator("#preview-find").click();
  await page.locator("#preview-query").fill("needle");
  assert.equal(await page.locator("#preview-matches").innerText(), "1 / 10000");
  assert.match(await page.locator("#preview-search-note").innerText(), /上限/);
  await page.locator("#preview-search-close").click();
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: rendered search, inline spans, Chinese/code/literal matches, wrap navigation, refresh/reset, unchanged statistics/source, split source search and 1 MiB/10000 limit.",
  );
  return page;
}
