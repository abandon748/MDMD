import assert from "node:assert/strict";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
export async function testExtensions({ page, root, dialog, waitFor }) {
  const file = path.join(root, "扩展.md"),
    source =
      "# Extensions\n\n++under++ text[^one]\n\n[^one]: footnote **body**\n\n> [!NOTE]\n> Notice\n\n[[child|Open child]]\n\n![[pixel.png]]\n\n![[child.md]]\n\n![[missing.md]]\n";
  await writeFile(file, source);
  await writeFile(
    path.join(root, "child.md"),
    "# Embedded\n\nChild **body**\n\n![[child.md]]",
  );
  await page
    .locator((await page.locator("#home").isVisible()) ? "#home-open" : "#open")
    .click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  assert.equal(await page.locator("#preview u").innerText(), "under");
  assert.equal(await page.locator("#preview .markdown-alert").count(), 1);
  assert.match(await page.locator("#fn-1").innerText(), /footnote body/);
  await page.locator('#preview a[href="#fn-1"]').click();
  assert(await page.locator("#error").isHidden());
  await page.locator('.wiki-embed[data-embed-status="ready"]').waitFor();
  await page.locator('.wiki-embed[data-embed-status="failed"]').waitFor();
  assert.match(await page.locator(".embedded-body").innerText(), /Child body/);
  assert.equal(await page.locator("[data-embed]").count(), 2);
  assert.equal(await readFile(file, "utf8"), source);
  await writeFile(path.join(root, "missing.md"), "# Repaired");
  await page.locator("#refresh").click();
  await waitFor(
    async () =>
      (await page.locator('.wiki-embed[data-embed-status="ready"]').count()) ===
      2,
    "embed retry",
  );
  await page.screenshot({ path: path.join(root, "extensions.png") });
  await page
    .locator("#preview")
    .getByRole("link", { name: "Open child", exact: true })
    .click();
  await waitFor(
    async () =>
      (await page.locator("#preview h1").first().innerText()) === "Embedded",
    "Wiki opens document",
  );
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: underline/notes/alerts, anchor jump, Wiki image/document link, one-level embeds, missing retry, original source preserved.",
  );
  return page;
}
