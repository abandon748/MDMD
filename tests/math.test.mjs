import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export async function testMath({
  page,
  root,
  dialog,
  waitFor,
  restart,
  engineFixture,
}) {
  const dir = path.join(root, "math");
  await mkdir(dir);
  const file = path.join(dir, "公式.md");
  const source =
    "# Formula\n\nInline $x^2+y^2$ and $\\frac{1}{2}$.\n\n$$\n\\int_{-\\infty}^{+\\infty} e^{-x^2} dx = \\sqrt{\\pi}\n$$\n\nInvalid $\\unknownMDMD{x}$ stays.\n\n`$code$` and currency $5 and $10.\n\n$\\href{javascript:alert(1)}{unsafe}$\n\n";
  await writeFile(file, "\ufeff" + source.replaceAll("\n", "\r\n"));
  const state = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  await page.locator("#home-open").click();
  await dialog(file);
  await idle();
  await page.locator('[data-math-status="missing"]').first().waitFor();
  assert.equal(await page.locator("#preview .math-source").count(), 5);
  const requests = engineFixture.requests;
  await page.locator("#refresh").click();
  await page.locator('[data-math-status="missing"]').first().waitFor();
  assert.equal(engineFixture.requests, requests);
  await page.locator("#document-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#engines-manage").click();
  await page.locator("#engine-katex-download:not(:disabled)").waitFor();
  await page.locator("#engine-katex-download").click();
  await waitFor(
    async () =>
      (await page.locator("#engine-katex-status").innerText()) === "已就绪",
    "KaTeX installed",
  );
  await page.locator("#engines-close").click();
  await page.locator("#settings-close").click();
  await page.locator('[data-math-status="ready"]').first().waitFor();
  assert.equal(await page.locator('[data-math-status="ready"]').count(), 4);
  assert.equal(await page.locator('[data-math-status="failed"]').count(), 1);
  assert.equal(await page.locator("#preview .math-source a").count(), 0);
  assert.equal((await state()).content, source);
  assert.equal((await state()).dirty, false);
  assert.equal(await page.evaluate(() => !!window.katex), false);
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.fonts.check("16px KaTeX_Main")));
  await waitFor(
    async () =>
      await page.evaluate(() => {
        const n = Array.from(
          document.querySelector("#preview").textContent,
        ).filter((c) => !/\s/u.test(c)).length;
        return (
          document.querySelector("#wordcount").textContent ===
          `字数 ${n.toLocaleString()}`
        );
      }),
    "formula count updated",
  );
  await page.setViewportSize({ width: 640, height: 720 });
  await page.screenshot({ path: path.join(root, "math-640.png") });
  await page.setViewportSize({ width: 1320, height: 860 });
  // Block mapping goes through ordinary inline source, not generated KaTeX HTML.
  await page.locator('#preview [data-math="block"]').click({ button: "right" });
  await page.locator("#menu-inline").click();
  assert.match(await page.locator("#preview .cm-content").innerText(), /\$\$/);
  await page.locator("#inline-cancel").click();
  await page.locator('[data-math-status="ready"]').first().waitFor();
  assert.equal((await state()).content, source);
  // Damaged cache never becomes trusted output. Restore exact bytes and retry.
  const spec = engineFixture.specs.find((s) => s.id === "katex");
  const blob = path.join(
    root,
    "app-data",
    "engines",
    "blobs",
    spec.files.find((f) => f.kind === "js").sha256,
  );
  const bytes = await readFile(blob);
  await writeFile(blob, "broken");
  await page.locator("#refresh").click();
  await page.locator('[data-math-status="failed"]').first().waitFor();
  assert.equal(await page.locator("#preview .katex").count(), 0);
  await writeFile(blob, bytes);
  await page.locator("#refresh").click();
  await page.locator('[data-math-status="ready"]').first().waitFor();
  await page.evaluate(() => {
    window.mathFetch = window.fetch;
    window.fetch = async (input, init) => {
      const response = await window.mathFetch(input, init);
      if (
        String(input) ===
        window.__TAURI_INTERNALS__.convertFileSrc("engine_assets", "ipc")
      )
        await new Promise((resolve) => {
          window.mathRelease = resolve;
        });
      return response;
    };
  });
  await page.locator("#refresh").click();
  await page.waitForFunction(() => typeof window.mathRelease === "function");
  await page.locator("#new").click();
  await idle();
  await page.evaluate(() => {
    window.fetch = window.mathFetch;
    window.mathRelease();
  });
  assert.equal(await page.locator("#preview .katex").count(), 0);
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" + source.replaceAll("\n", "\r\n"),
  );
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  page = await restart();
  await page.locator("#home-open").click();
  await dialog(file);
  await idle();
  await page.locator('[data-math-status="ready"]').first().waitFor();
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: real KaTeX inline/block, missing/corrupt/invalid/trust fallback, verified offline fonts, unchanged source/BOM/CRLF, counts, inline source map/cancel, stale result, restart and narrow viewport.",
  );
  console.log("Math evidence:", root);
  return page;
}
