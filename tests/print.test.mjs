import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
export async function testPrint({ page, root, dialog, waitFor }) {
  const file = path.join(root, "打印.md"),
    source =
      "# Print sample\n\n" +
      Array.from(
        { length: 80 },
        (_, i) => `Paragraph ${i} 中文测试 **bold**.`,
      ).join("\n\n");
  await writeFile(file, source);
  await page
    .locator((await page.locator("#home").isVisible()) ? "#home-open" : "#open")
    .click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  await page.locator("#output-open").click();
  assert.equal(await page.locator("#output-paper").inputValue(), "A4");
  assert.equal(await page.locator("#output-margin").inputValue(), "15");
  await page.evaluate(() => {
    window.savedPrint = window.print;
    window.print = () => {
      window.printCapture =
        "<html><head>" +
        document.head.innerHTML +
        "</head><body>" +
        document.querySelector("#print-root").outerHTML +
        "</body></html>";
      window.printCalls = (window.printCalls || 0) + 1;
    };
  });
  await page.locator("#output-margin").fill("4");
  await page.locator("#output-print").click();
  await waitFor(
    async () => /失败/.test(await page.locator("#output-message").innerText()),
    "invalid margin",
  );
  assert.equal(await page.evaluate(() => window.printCalls || 0), 0);
  await page.locator("#output-margin").fill("10");
  await page.locator("#output-orientation").selectOption("landscape");
  await page.locator("#output-print").click();
  await waitFor(
    async () =>
      /已返回/.test(await page.locator("#output-message").innerText()),
    "print returns",
  );
  assert.equal(await page.locator("#print-root").count(), 0);
  const html = await page.evaluate(() => window.printCapture);
  assert.match(html, /size:A4 landscape/);
  assert.match(html, /margin:10mm/);
  const printPage = await page.context().newPage();
  await printPage.setContent(html);
  await printPage.emulateMedia({ media: "print" });
  const pdf = await printPage.pdf({
    preferCSSPageSize: true,
    printBackground: true,
  });
  await writeFile(path.join(root, "print-landscape.pdf"), pdf);
  assert.match(pdf.toString("latin1"), /%PDF/);
  assert.match(pdf.toString("latin1"), /MediaBox\s*\[0 0 841/);
  assert.equal(
    await printPage.locator("#print-preview h1").innerText(),
    "Print sample",
  );
  await printPage.screenshot({ path: path.join(root, "print-snapshot.png") });
  await printPage.close();
  await page.evaluate(() => (window.print = window.savedPrint));
  await page.locator("#output-close").click();
  assert.equal(await readFile(file, "utf8"), source);
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: print settings/bounds, snapshot-only layout, return cleanup, source preservation and Chromium A4 landscape PDF generation; native print dialog completion is not simulated as successful saving.",
  );
  return page;
}
