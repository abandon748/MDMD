import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
export async function testTasks({ page, root, dialog, waitFor }) {
  const file = path.join(root, "任务.md"),
    source =
      "# Tasks\n\n- [ ] one\n  - [X] nested\n\n> - [x] quoted\n\n```\n- [ ] code\n```\n";
  await writeFile(file, "\ufeff" + source.replaceAll("\n", "\r\n"));
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  await page
    .locator((await page.locator("#home").isVisible()) ? "#home-open" : "#open")
    .click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  assert.equal(await page.locator(".task-check").count(), 3);
  await page.locator(".task-check").first().click();
  await waitFor(
    async () =>
      (await native()).content === source.replace("- [ ] one", "- [x] one"),
    "task applied",
  );
  await page.keyboard.press("Control+z");
  await waitFor(async () => (await native()).content === source, "task undo");
  await page.keyboard.press("Control+y");
  await waitFor(async () => (await native()).dirty, "task redo");
  await page.locator("#save").click();
  await waitFor(async () => !(await native()).dirty, "task saved");
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" +
      source.replace("- [ ] one", "- [x] one").replaceAll("\n", "\r\n"),
  );
  await page.locator("#output-open").click();
  await page.locator("#output-html").click();
  const html = path.join(root, "tasks.html");
  await dialog(html);
  await page.locator("#output-html:not(:disabled)").waitFor();
  assert.match(await readFile(html, "utf8"), /☑/);
  await page.locator("#output-close").click();
  const readonly = path.join(root, "readonly-tasks.md");
  await writeFile(readonly, "- [ ] first\r\n- [x] mixed\n");
  await page.locator("#open").click();
  await dialog(readonly);
  await page.locator("#open:not(:disabled)").waitFor();
  assert(await page.locator(".task-check").first().isDisabled());
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: task check, undo/redo, exact BOM/CRLF save, static HTML checkbox state, readonly protection.",
  );
  return page;
}
