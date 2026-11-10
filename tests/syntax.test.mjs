import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function testSyntax({
  page,
  root,
  dialog,
  waitFor,
  restart,
  engineFixture,
}) {
  const dir = path.join(root, "syntax");
  await mkdir(dir);
  const file = path.join(dir, "高亮.md");
  const samples = [
    [
      "js",
      "const answer = 42;\n/* first\nsecond */\nconsole.log('<script>window.injected=1</script>');\n",
    ],
    ["python", "def hello(name):\n    return 'Hello ' + name\n"],
    ["rust", "fn main() { let value = 42; }\n"],
    ["c++", "#include <iostream>\nint main() { return 0; }\n"],
    ["json", '{"answer":42,"ok":true}\n'],
    ["html", '<div class="test">hello</div>\n'],
    ["", "function hello() { const answer = 42; return answer; }\n"],
    ["text", "const unchanged = true;\n"],
    ["unknown-mdmd", "const unknown = true;\n"],
    ["js", "// " + "x".repeat(65536) + "\n"],
  ];
  const source =
    "# Syntax\n\n" +
    samples.map(([lang, s]) => "```" + lang + "\n" + s + "```\n\n").join("") +
    "Inline `const text = 3` stays plain.\n";
  await writeFile(file, "\ufeff" + source.replaceAll("\n", "\r\n"));
  const state = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const codes = () => page.locator("#preview pre > code");
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  async function checkText() {
    assert.deepEqual(
      await codes().allTextContents(),
      samples.map((s) => s[1]),
    );
    assert.equal((await state()).content, source);
  }
  await page.locator("#home-open").click();
  await dialog(file);
  await idle();
  await page.locator('[data-highlight="missing"]').first().waitFor();
  await checkText();
  assert.equal(await page.locator("#preview .hljs-keyword").count(), 0);
  const requests = engineFixture.requests;
  await page.locator("#refresh").click();
  await page.locator('[data-highlight="missing"]').first().waitFor();
  assert.equal(
    engineFixture.requests,
    requests,
    "document render never downloads resources",
  );
  await page.locator("#document-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#engines-manage").click();
  await page.locator("#engines-refresh:not(:disabled)").waitFor();
  await page.locator("#engine-highlight-download").click();
  await waitFor(
    async () =>
      (await page.locator("#engine-highlight-status").innerText()) === "已就绪",
    "engine installed",
  );
  await page.locator("#engines-close").click();
  await page.locator("#settings-close").click();
  await waitFor(
    async () =>
      (await codes().nth(0).getAttribute("data-highlight")) === "ready",
    "syntax loaded",
  );
  await checkText();
  assert(await codes().nth(0).locator(".hljs-keyword").count());
  assert(
    (await codes().nth(0).locator(".code-line .hljs-comment").count()) >= 2,
    "multiline comment survives line wrappers",
  );
  assert(await codes().nth(5).locator(".hljs-tag").count());
  assert.equal(await codes().nth(6).getAttribute("data-highlight"), "ready");
  assert.equal(await codes().nth(7).getAttribute("data-highlight"), "plain");
  assert.equal(await codes().nth(8).getAttribute("data-highlight"), "unknown");
  assert.equal(await codes().nth(9).getAttribute("data-highlight"), "limit");
  assert.equal(
    await page.evaluate(() => window.hljs || window.injected || null),
    null,
  );
  assert.equal(await page.locator("#preview p code span").count(), 0);
  const light = await codes()
    .first()
    .locator(".hljs-keyword")
    .first()
    .evaluate((n) => getComputedStyle(n).color);
  await page.locator("#document-settings").click();
  await page.locator("#settings-appearance").click();
  await page.locator('input[name="theme"][value="dark"]').check();
  await page.locator("#settings-close").click();
  const dark = await codes()
    .first()
    .locator(".hljs-keyword")
    .first()
    .evaluate((n) => getComputedStyle(n).color);
  assert.notEqual(light, dark);
  await page.screenshot({ path: path.join(root, "syntax-dark.png") });
  await page.locator("#document-settings").click();
  await page.locator("#settings-typography").click();
  await page.locator("#setting-codeLineNumbers").check();
  await page.locator("#setting-codeWrap").check();
  await page.locator("#settings-close").click();
  await checkText();
  await page.setViewportSize({ width: 640, height: 720 });
  await page.screenshot({ path: path.join(root, "syntax-dark-640.png") });
  await page.setViewportSize({ width: 1320, height: 860 });
  // Every loaded language and alias remains library-defined, not guessed in app code.
  assert.equal(engineFixture.specs[0].version, "11.12.0");
  // Corruption must be detected on explicit refresh; the Markdown bytes remain unchanged.
  const blob = path.join(
    root,
    "app-data",
    "engines",
    "blobs",
    engineFixture.specs[0].files[0].sha256,
  );
  const valid = await readFile(blob);
  await writeFile(blob, "bad");
  await page.locator("#refresh").click();
  await page.locator('[data-highlight="failed"]').first().waitFor();
  await checkText();
  await writeFile(blob, valid);
  await page.locator("#refresh").click();
  await page.locator('[data-highlight="ready"]').first().waitFor();
  await checkText();
  // A verified resource can still fail to execute; keep raw code and allow retry.
  await page.evaluate(() => {
    window.syntaxOriginal = window.fetch;
    window.fetch = async (input, init) => {
      const response = await window.syntaxOriginal(input, init);
      if (
        String(input) !==
        window.__TAURI_INTERNALS__.convertFileSrc("engine_assets", "ipc")
      )
        return response;
      const files = await response.json();
      files.find((f) => f.kind === "js").content = btoa("window.hljs={}");
      return new Response(JSON.stringify(files), {
        headers: { "Content-Type": "application/json", "Tauri-Response": "ok" },
      });
    };
  });
  await page.locator("#refresh").click();
  await page.locator('[data-highlight="failed"]').first().waitFor();
  await checkText();
  await page.evaluate(() => {
    window.fetch = window.syntaxOriginal;
  });
  await page.locator("#refresh").click();
  await page.locator('[data-highlight="ready"]').first().waitFor();
  // A delayed engine read must never decorate a different document or block draft.
  await page.evaluate(() => {
    window.syntaxFetch = window.fetch;
    window.fetch = async (input, init) => {
      const response = await window.syntaxFetch(input, init);
      if (
        String(input) ===
        window.__TAURI_INTERNALS__.convertFileSrc("engine_assets", "ipc")
      )
        await new Promise((resolve) => {
          window.syntaxRelease = resolve;
        });
      return response;
    };
  });
  await page.locator("#refresh").click();
  await page.waitForFunction(() => typeof window.syntaxRelease === "function");
  await page.locator("#new").click();
  await idle();
  await page.evaluate(() => {
    window.fetch = window.syntaxFetch;
    window.syntaxRelease();
  });
  assert.equal((await state()).content, "");
  assert.equal(await codes().count(), 0);
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" + source.replaceAll("\n", "\r\n"),
  );
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await page.evaluate(() => localStorage.clear());
  page = await restart();
  await page.locator("#home-open").click();
  await dialog(file);
  await idle();
  await page.locator('[data-highlight="ready"]').first().waitFor();
  await checkText();
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: verified local highlight engine install/reuse/restart, no implicit download, explicit languages/aliases and auto detection, unknown/plain/limit fallback, multiline spans and exact source/BOM/CRLF, dark theme/line numbers/wrap, corruption/retry, stale results and XSS isolation.",
  );
  console.log("Syntax evidence:", root);
  return page;
}
