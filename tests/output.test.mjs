import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
export async function testOutput({ page, root, dialog, waitFor }) {
  const file = path.join(root, "输出.md"),
    target = path.join(root, "输出.html");
  const source =
    "# Export\n\n中文 **bold**\n\n![pixel](pixel.png)\n\n$x^2$\n\n```mermaid\nflowchart LR\nA --> B\n```";
  await writeFile(file, source);
  await page
    .locator((await page.locator("#home").isVisible()) ? "#home-open" : "#open")
    .click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  await page.locator("#output-open").click();
  await page.locator("#output-html").click();
  await waitFor(
    async () =>
      /尚未就绪/.test(await page.locator("#output-message").innerText()),
    "unready resources block export",
  );
  await page.locator("#output-close").click();
  await page.locator("#document-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#engines-manage").click();
  for (const id of ["mermaid", "katex"]) {
    await page.locator(`#engine-${id}-download:not(:disabled)`).waitFor();
    await page.locator(`#engine-${id}-download`).click();
    await page.waitForFunction(
      (id) =>
        document.querySelector(`#engine-${id}-status`)?.textContent ===
        "已就绪",
      id,
      { timeout: 60000 },
    );
  }
  await page.locator("#engines-close").click();
  await page.locator("#settings-close").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".diagram-image")?.naturalWidth > 0 &&
      document.querySelector('[data-math-status="ready"]'),
    {},
    { timeout: 60000 },
  );
  await page.locator("#output-open").click();
  await page.locator("#output-html").click();
  await dialog("", true);
  await page.locator("#output-html:not(:disabled)").waitFor();
  assert.match(await page.locator("#output-message").innerText(), /取消/);
  await page.locator("#output-html").click();
  await dialog(target);
  await page.locator("#output-html:not(:disabled)").waitFor();
  assert.match(await page.locator("#output-message").innerText(), /已导出/);
  const html = await readFile(target, "utf8");
  assert.match(html, /data:image\/svg\+xml;base64/);
  assert.match(html, /data:font/);
  assert.match(html, /katex/);
  assert.match(html, /中文/);
  assert(!html.includes("diagram-controls"));
  assert(!html.includes("data-local-src"));
  const opened = await page.context().newPage();
  await opened.goto("file:///" + target.replaceAll("\\", "/"));
  await opened.waitForFunction(() =>
    [...document.images].every((i) => i.complete && i.naturalWidth),
  );
  assert.equal(await opened.locator("script,button").count(), 0);
  assert(
    await opened.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  );
  await opened.screenshot({ path: path.join(root, "export-html.png") });
  await opened.close();
  await page.locator("#output-html").click();
  await dialog(target, false, ["-ConfirmOverwrite"]);
  await page.locator("#output-html:not(:disabled)").waitFor();
  assert.match(await page.locator("#output-message").innerText(), /已存在/);
  assert.equal(await readFile(target, "utf8"), html);
  await page.locator("#output-style").selectOption("simple");
  await page.locator("#output-html").click();
  await dialog(path.join(root, "simple.html"));
  await page.locator("#output-html:not(:disabled)").waitFor();
  assert.match(
    await readFile(path.join(root, "simple.html"), "utf8"),
    /background:white/,
  );
  assert.equal(await readFile(file, "utf8"), source);
  await page.locator("#output-close").click();
  const empty = path.join(root, "空文档.md"),
    emptyTarget = path.join(root, "empty.html");
  await writeFile(empty, "");
  await page.locator("#open").click();
  await dialog(empty);
  await page.locator("#open:not(:disabled)").waitFor();
  await page.locator("#output-open").click();
  await page.locator("#output-html").click();
  await dialog(emptyTarget);
  await page.locator("#output-html:not(:disabled)").waitFor();
  const emptyHtml = await readFile(emptyTarget, "utf8");
  assert(!emptyHtml.includes("从一页文字开始"));
  assert(!emptyHtml.includes('class="welcome"'));
  await page.locator("#output-close").click();
  console.log(
    "PASS: HTML real image/KaTeX/Mermaid resources, offline reopen, style choices, missing-resource refusal, cancel, collision refusal, empty document exclusion and source preservation.",
  );
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  return page;
}
