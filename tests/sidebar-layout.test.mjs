import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function testSidebarLayout({ page, root, dialog, waitFor }) {
  const file = path.join(root, "侧栏与模式.md");
  const source = "# 一级标题\n\n原始正文\n\n## 二级标题\n\n测试分栏。\n";
  await writeFile(file, source);
  await page
    .locator((await page.locator("#home").isVisible()) ? "#home-open" : "#open")
    .click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  await page.locator("#read-mode").click();
  const handle = page.locator("#sidebar-divider");
  const width = () =>
    page.locator("#sidebar").evaluate((n) => n.getBoundingClientRect().width);
  const expectWidth = (value) =>
    waitFor(
      async () => Math.abs((await width()) - value) < 1,
      `sidebar width ${value}`,
    );
  const initial = await width();
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const original = await native();
  async function drag(delta, cancel = false) {
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + Math.min(150, box.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta, y, { steps: 8 });
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
  }
  await drag(80);
  await expectWidth(initial + 80);
  await drag(50, true);
  await expectWidth(initial + 80);
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expectWidth(initial + 70);
  await page.keyboard.press("Home");
  await expectWidth(160);
  await drag(-100);
  await expectWidth(160);
  await handle.press("End");
  const maximum = Number(await handle.getAttribute("aria-valuemax"));
  await expectWidth(maximum);
  await drag(200);
  await expectWidth(maximum);
  await page.locator("#tab-history").click();
  await expectWidth(maximum);
  await page.locator("#tab-outline").click();
  await handle.dblclick();
  await expectWidth(initial);
  // Browser pointercancel must restore the start width and remove capture styling.
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 4, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 64, box.y + 100);
  await handle.dispatchEvent("pointercancel");
  await page.mouse.up();
  await expectWidth(initial);
  assert.equal(
    await page
      .locator("body")
      .evaluate((n) => n.classList.contains("resizing-sidebar")),
    false,
  );
  assert.equal((await native()).content, original.content);
  assert.equal((await native()).dirty, original.dirty);
  assert.deepEqual(
    await page
      .locator(".mode-switch button")
      .evaluateAll((ns) => ns.map((n) => n.id)),
    ["read-mode", "split-mode", "inline-mode"],
  );
  async function selected(id) {
    assert.deepEqual(
      await page
        .locator('.mode-switch [aria-pressed="true"]')
        .evaluateAll((ns) => ns.map((n) => n.id)),
      [id],
    );
  }
  await selected("read-mode");
  await page.locator("#inline-mode").click();
  if (await page.locator("#inline-source-toggle").isVisible())
    await page.locator("#inline-source-toggle").click();
  await page.locator("#inline-source").waitFor();
  await selected("inline-mode");
  await page.locator("#inline-cancel").click();
  await selected("read-mode");
  await page.locator("#split-mode").click();
  await selected("split-mode");
  await drag(45);
  await expectWidth(initial + 45);
  await page.locator("#inline-mode").click();
  if (await page.locator("#inline-source-toggle").isVisible())
    await page.locator("#inline-source-toggle").click();
  await selected("inline-mode");
  await page.locator("#inline-source .cm-content").focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("# 从就地编辑应用");
  await page.locator("#split-mode").click();
  await selected("split-mode");
  await waitFor(
    async () => (await native()).content.includes("从就地编辑应用"),
    "inline draft applies on mode switch",
  );
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () => (await native()).content === source,
    "mode switch undo",
  );
  await page.locator("#read-mode").click();
  await waitFor(
    async () => (await page.locator("#preview h1").innerText()) === "一级标题",
    "preview catches up after undo",
  );
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await handle.press("End");
  await page.setViewportSize({ width: 640, height: 700 });
  await waitFor(
    async () => (await width()) < 480,
    "narrow viewport clamps width",
  );
  assert(
    await page
      .locator("#panes")
      .evaluate((n) => n.getBoundingClientRect().width >= 319),
  );
  await page.setViewportSize(viewport);
  await expectWidth(maximum);
  await handle.dblclick();
  await expectWidth(initial);
  await drag(45);
  await page.screenshot({ path: path.join(root, "sidebar-mode-layout.png") });
  await handle.dblclick();
  console.log(
    "PASS: sidebar drag/bounds/cancel/reset/tab retention, grouped modes/draft apply/undo.",
  );
  return page;
}
