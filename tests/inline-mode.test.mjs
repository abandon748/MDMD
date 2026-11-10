import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export async function testInlineMode({ page, root, dialog, waitFor }) {
  const file = path.join(root, "模式保留.md");
  const other = path.join(root, "另一文件.md");
  const original =
    "# 标题\n\n段落原文\n\n- 列表原文\n\n```js\nconst x = 1;\n```\n";
  await writeFile(file, original);
  await writeFile(other, "# 另一文件\n");
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  const mode = async (name) => {
    for (const key of ["read", "split", "inline"])
      assert.equal(
        await page.locator(`#${key}-mode`).getAttribute("aria-pressed"),
        String(key === name),
      );
  };
  const open = async (p) => {
    await page
      .locator(
        (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
      )
      .click();
    await dialog(p);
    await idle();
  };
  await open(file);
  await page.locator("#preview h1").click();
  await page.keyboard.press("F2");
  await page.locator("#inline-mode").click();
  assert(
    await page
      .locator("#inline-rich")
      .evaluate((node) => node.contains(document.activeElement)),
    "reselecting inline mode restores the active draft focus",
  );
  await page.locator("#inline-rich").fill("改坏的标题");
  await page.locator("#inline-cancel").click();
  await mode("inline");
  assert.equal(
    await page.locator(".inline-editor").count(),
    0,
    "cancel does not recreate a draft",
  );
  assert.equal((await native()).content, original);
  await page.locator("#preview > p").first().click();
  await page.locator("#inline-rich").fill("应用段落");
  await page.locator("#inline-apply").click();
  await mode("inline");
  assert.equal(await page.locator(".inline-editor").count(), 0);
  await waitFor(
    async () => (await native()).content.includes("应用段落"),
    "apply draft",
  );
  await page.locator("#save").click();
  await idle();
  await mode("inline");
  const saved = await readFile(file, "utf8");
  assert(saved.includes("应用段落"));
  await page.locator("#preview > ul li").click();
  await page.locator("#inline-rich").waitFor();
  await page.keyboard.press("Escape");
  await mode("inline");
  assert.equal((await native()).content, saved);
  await page.locator("#preview pre code").click();
  await page.locator("#inline-source .cm-content").fill("```js\nlocal\n```\n");
  await writeFile(file, "# 外部版本\n");
  await page.locator('#save-status[data-state="conflict"]').waitFor();
  await page.locator("#save").click();
  await idle();
  await mode("inline");
  assert.equal(await readFile(file, "utf8"), "# 外部版本\n");
  assert((await native()).content.includes("local"));
  await page.locator("#reload").click();
  await page.locator('button[value="cancel"]').click();
  await idle();
  await mode("inline");
  await page.locator("#reload").click();
  await page.locator('button[value="discard"]').click();
  await idle();
  await mode("inline");
  assert.equal((await native()).content, "# 外部版本\n");
  await page.locator("#read-mode").click();
  await mode("read");
  await page.locator("#preview h1").click();
  assert.equal(await page.locator(".inline-editor").count(), 0);
  await page.locator("#split-mode").click();
  await mode("split");
  await page.locator("#inline-mode").click();
  await page.locator("#inline-cancel").click();
  await mode("inline");
  await open(other);
  await mode("read");
  await page.locator("#preview h1").dblclick();
  assert.equal(await page.locator(".inline-editor").count(), 0);
  await page.locator("#document-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#setting-double-click-edit").check();
  await page.locator("#settings-close").click();
  await page.locator("#preview h1").dblclick();
  await page.locator("#inline-cancel").click();
  await mode("read");
  // A canceled open picker preserves the user's selected mode.
  await page.locator("#inline-mode").click();
  await page.locator("#inline-cancel").click();
  await page.locator("#open").click();
  await dialog("", true);
  await idle();
  await mode("inline");
  await writeFile(other, "# 混合\r\n\r\n只读\n");
  await page.locator("#reload").click();
  await idle();
  assert((await native()).readOnly);
  await mode("read");
  assert(await page.locator("#inline-mode").isDisabled());
  await page.screenshot({ path: path.join(root, "inline-mode-readonly.png") });
  await page.locator("#document-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#setting-double-click-edit").uncheck();
  await page.locator("#settings-close").click();
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: manual inline mode survives cancel/apply/Esc/save/reload/open-picker cancel; next paragraph/list/code edits; external conflict retained; explicit read/split and different/readonly file reset; double-click opt-in remains temporary.",
  );
  return page;
}
