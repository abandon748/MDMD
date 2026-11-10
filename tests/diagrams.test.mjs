import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export async function testDiagrams({
  page,
  root,
  dialog,
  waitFor,
  restart,
  engineFixture,
}) {
  const dir = path.join(root, "diagrams");
  await mkdir(dir);
  const file = path.join(dir, "图表.md");
  const source =
    "# Diagrams\n\n```mermaid\nflowchart LR\n A[Alpha] --> B[Beta]\n```\n\n```mermaid\nsequenceDiagram\n Alice->>Bob: Hello\n```\n\n```markmap\n# Root\n## Alpha\n## Beta\n```\n\n```mermaid\nnot-a-diagram invalid\n```\n";
  await writeFile(file, "\ufeff" + source.replaceAll("\n", "\r\n"));
  const state = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  const ready = () =>
    page.waitForFunction(
      () =>
        document.querySelectorAll('.diagram[data-diagram-status="ready"]')
          .length === 3 &&
        [...document.querySelectorAll(".diagram-image")].every(
          (i) => i.complete && i.naturalWidth > 0,
        ),
      {},
      { timeout: 60000 },
    );
  await page.locator("#home-open").click();
  await dialog(file);
  await idle();
  await page.locator('pre[data-diagram-status="failed"]').first().waitFor();
  assert.equal(await page.locator(".diagram-image").count(), 0);
  const requests = engineFixture.requests;
  await page.locator("#refresh").click();
  await page.locator('pre[data-diagram-status="failed"]').first().waitFor();
  assert.equal(engineFixture.requests, requests);
  await page.locator("#document-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#engines-manage").click();
  for (const id of ["mermaid", "markmap"]) {
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
  await ready();
  assert.equal(
    await page.locator('#preview > pre[data-diagram-status="failed"]').count(),
    1,
  );
  assert.equal((await state()).content, source);
  assert.equal((await state()).dirty, false);
  assert.equal(
    await page.evaluate(() => !!window.mermaid || !!window.markmap),
    false,
  );
  assert.equal(await page.locator("#preview svg").count(), 0);
  await waitFor(
    async () =>
      await page.evaluate(() => {
        const clone = document.querySelector("#preview").cloneNode(true);
        clone.querySelectorAll("[data-stat-ignore]").forEach((n) => n.remove());
        const count = [...clone.textContent].filter(
          (c) => !/\s/u.test(c),
        ).length;
        return (
          document.querySelector("#wordcount").textContent ===
          `字数 ${count.toLocaleString()}`
        );
      }),
    "diagram controls/hidden sources excluded from statistics",
  );
  const graph = page.locator(".diagram").first();
  const svg = Buffer.from(
    (await graph.locator("img").getAttribute("src")).split(",")[1],
    "base64",
  ).toString();
  assert.match(svg, /Alpha/);
  assert.match(svg, /Beta/);
  assert.equal(await graph.locator("pre").isVisible(), false);
  await graph.getByRole("button", { name: "查看源码", exact: true }).click();
  assert.equal(await graph.locator("pre").isVisible(), true);
  assert.equal(
    await graph.locator("code").textContent(),
    "flowchart LR\n A[Alpha] --> B[Beta]\n",
  );
  await graph.getByRole("button", { name: "查看源码", exact: true }).click();
  const zoomIn = graph.getByRole("button", { name: "+", exact: true });
  await zoomIn.dblclick();
  assert.equal(
    await page.locator("#read-mode").getAttribute("aria-pressed"),
    "true",
    "diagram controls do not trigger source-location mode",
  );
  await graph.getByRole("button", { name: "适应宽度", exact: true }).click();
  for (let i = 0; i < 4; i++) await zoomIn.click();
  assert(await zoomIn.isDisabled());
  assert.equal(
    await graph.locator("img").evaluate((i) => i.style.width),
    "200%",
  );
  const zoomOut = graph.getByRole("button", { name: "−", exact: true });
  for (let i = 0; i < 7; i++) await zoomOut.click();
  assert(await zoomOut.isDisabled());
  await graph.getByRole("button", { name: "适应宽度", exact: true }).click();
  await graph.getByRole("button", { name: "编辑源码", exact: true }).click();
  assert.match(
    await page.locator("#preview .cm-content").innerText(),
    /```mermaid/,
  );
  await page.locator("#inline-cancel").click();
  await ready();
  assert.equal((await state()).content, source);
  await page.locator("#document-settings").click();
  await page.locator("#settings-appearance").click();
  await page.locator('input[name="theme"][value="dark"]').check();
  await page.locator("#settings-close").click();
  await ready();
  const darkSvg = Buffer.from(
    (await page.locator(".diagram img").first().getAttribute("src")).split(
      ",",
    )[1],
    "base64",
  ).toString();
  assert.notEqual(darkSvg, svg);
  await page.setViewportSize({ width: 640, height: 720 });
  await page.screenshot({ path: path.join(root, "diagrams-dark-640.png") });
  await page
    .locator('.diagram[data-engine="markmap"]')
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, "markmap-dark-640.png") });
  await page.setViewportSize({ width: 1320, height: 860 });
  const spec = engineFixture.specs.find((s) => s.id === "mermaid"),
    blob = path.join(
      root,
      "app-data",
      "engines",
      "blobs",
      spec.files.find((f) => f.kind === "js").sha256,
    );
  const bytes = await readFile(blob);
  await writeFile(blob, "bad");
  await page.locator("#refresh").click();
  await waitFor(
    async () =>
      (await page
        .locator('#preview > pre[data-diagram-status="failed"]')
        .count()) === 3,
    "corrupt mermaid fallback",
  );
  await writeFile(blob, bytes);
  await page.locator("#refresh").click();
  await ready();
  await page.evaluate(() => {
    window.diagramFetch = window.fetch;
    window.fetch = async (input, init) => {
      const response = await window.diagramFetch(input, init);
      if (
        String(input) ===
        window.__TAURI_INTERNALS__.convertFileSrc("engine_assets", "ipc")
      )
        await new Promise((resolve) => {
          window.diagramRelease = resolve;
        });
      return response;
    };
  });
  await page.locator("#refresh").click();
  await page.waitForFunction(() => typeof window.diagramRelease === "function");
  await page.locator("#new").click();
  await idle();
  await page.evaluate(() => {
    window.fetch = window.diagramFetch;
    window.diagramRelease();
  });
  assert.equal(await page.locator(".diagram").count(), 0);
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
  await ready();
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: real Mermaid flow/sequence and markmap image rendering, no automatic download, missing/invalid/corrupt recovery, isolated globals/SVG, source view/edit cancel, zoom bounds, dark theme, stale responses, offline restart and exact BOM/CRLF source.",
  );
  console.log("Diagram evidence:", root);
  return page;
}
