import assert from "node:assert/strict";
import { writeFile, readFile, readdir, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
export async function testVersions({ page, root, dialog, waitFor }) {
  const dir = path.join(root, "versions");
  await mkdir(dir);
  const file = path.join(dir, "版本.md");
  const original = "# Original\n\nold",
    newer = original + "\nnew";
  await writeFile(file, "\ufeff" + original.replaceAll("\n", "\r\n"));
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  await page
    .locator((await page.locator("#home").isVisible()) ? "#home-open" : "#open")
    .click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  await page.locator("#versions-open").click();
  await waitFor(
    async () =>
      /没有可用/.test(await page.locator("#versions-message").innerText()),
    "empty versions",
  );
  await page.locator("#versions-close").click();
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\nnew");
  await page.locator("#save").click();
  await waitFor(async () => !(await native()).dirty, "new version saved");
  const backup = path.join(
    dir,
    ".mdmd-backups",
    (await readdir(path.join(dir, ".mdmd-backups")))[0],
  );
  const bytes = await readFile(backup);
  await page.locator("#versions-open").click();
  await page.locator("#versions-list button").first().click();
  await page.locator("#versions-apply:not(:disabled)").waitFor();
  assert.equal(await page.locator("#versions-source").inputValue(), original);
  await page.locator("#versions-close").click();
  assert.equal((await native()).content, newer);
  await page.locator("#versions-open").click();
  await page.locator("#versions-list button").first().click();
  await page.locator("#versions-apply:not(:disabled)").waitFor();
  await writeFile(backup, "changed");
  await page.locator("#versions-apply").click();
  await waitFor(
    async () =>
      /恢复失败/.test(await page.locator("#versions-message").innerText()),
    "changed backup refused",
  );
  assert.equal((await native()).content, newer);
  await page.locator("#versions-close").click();
  await writeFile(backup, bytes);
  await page.locator("#versions-open").click();
  await page.locator("#versions-list button").first().click();
  await page.locator("#versions-apply:not(:disabled)").click();
  await waitFor(
    async () => (await native()).content === original,
    "restored buffer",
  );
  assert.equal(
    await page.locator("#autosave-status").getAttribute("data-paused"),
    "true",
  );
  assert.equal(
    (await readFile(file)).toString(),
    "\ufeff" + newer.replaceAll("\n", "\r\n"),
  );
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+z");
  await waitFor(async () => (await native()).content === newer, "restore undo");
  await page.keyboard.press("Control+y");
  await waitFor(
    async () => (await native()).content === original,
    "restore redo",
  );
  await writeFile(file, "external");
  await page.locator("#save").click();
  await waitFor(
    async () => await page.locator("#error").isVisible(),
    "external conflict",
  );
  assert.equal(await readFile(file, "utf8"), "external");
  assert.equal((await native()).content, original);
  await writeFile(file, "\ufeff" + newer.replaceAll("\n", "\r\n"));
  await page.locator("#save").click();
  await waitFor(async () => !(await native()).dirty, "restored saved");
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" + original.replaceAll("\n", "\r\n"),
  );
  assert.equal(await readFile(backup, "utf8"), bytes.toString());
  await mkdir(path.join(dir, ".moye-backups"));
  await writeFile(
    path.join(dir, ".moye-backups", `版本.md-${randomUUID()}.bak`),
    "legacy",
  );
  await page.locator("#versions-open").click();
  await waitFor(
    async () => (await page.locator("#versions-list button").count()) === 3,
    "legacy included",
  );
  await page.locator("#versions-close").click();
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: empty/list/read/cancel, changed-backup refusal, memory-only restore, undo/redo, auto-save pause, external conflict, BOM/CRLF saved restoration and legacy backup discovery.",
  );
  return page;
}
