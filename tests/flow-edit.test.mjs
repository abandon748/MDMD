import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
export async function testFlowEdit({ page, root, dialog, waitFor }) {
  const dir = path.join(root, "flow-edit");
  await mkdir(dir);
  const file = path.join(dir, "流程.md");
  const original =
    "# Before\n\n```mermaid\nflowchart LR\n A[Alpha] --> B{Beta}\n```\n\nAfter";
  await writeFile(file, "\ufeff" + original.replaceAll("\n", "\r\n"));
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  await page
    .locator((await page.locator("#home").isVisible()) ? "#home-open" : "#open")
    .click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  await page.locator("#document-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#engines-manage").click();
  if (
    (await page.locator("#engine-mermaid-status").textContent()) !== "已就绪"
  ) {
    await page.locator("#engine-mermaid-download:not(:disabled)").waitFor();
    await page.locator("#engine-mermaid-download").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#engine-mermaid-status")?.textContent ===
        "已就绪",
      {},
      { timeout: 60000 },
    );
  }
  await page.locator("#engines-close").click();
  await page.locator("#settings-close").click();
  async function enter() {
    await page
      .getByRole("button", { name: "可视化编辑", exact: true })
      .click({ timeout: 60000 });
    await page.locator("#flow-grid").waitFor();
  }
  await enter();
  await page.getByRole("button", { name: "子图与样式", exact: true }).click();
  await page.getByRole("button", { name: "新建子图", exact: true }).click();
  assert(
    await page
      .locator(".diagram-edit-surface .graph-name-editor input")
      .isVisible(),
  );
  await page.locator("#inline-cancel").click();
  assert.equal((await native()).content, original);
  await enter();
  await page.locator("#inline-apply").click();
  assert.equal((await native()).content, original);
  await enter();
  await page
    .getByRole("textbox", { name: "节点文字 A", exact: true })
    .fill("Changed");
  await page.locator("#flow-direction").focus();
  await page.waitForFunction(
    () => !!document.querySelector("#flow-preview .diagram-image"),
    {},
    { timeout: 60000 },
  );
  assert.equal((await native()).content, original);
  await page.locator("#inline-cancel").click();
  assert.equal((await native()).content, original);
  await enter();
  await page.locator("#flow-add-node").click();
  assert.equal(await page.locator("#flow-grid input").count(), 4);
  await page.locator("#flow-undo").click();
  assert.equal(await page.locator("#flow-grid input").count(), 3);
  await page.locator("#flow-redo").click();
  assert.equal(await page.locator("#flow-grid input").count(), 4);
  await page.locator("#flow-direction").selectOption("TB");
  await page.locator("#flow-source").click();
  assert.match(
    await page.locator("#inline-source").innerText(),
    /flowchart TB/,
  );
  await page.locator("#flow-source").click();
  await page.screenshot({ path: path.join(dir, "visual-editor.png") });
  await page.locator("#inline-apply").click();
  await waitFor(async () => (await native()).dirty, "flow applied");
  assert.match((await native()).content, /N1\["N1"\]/);
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () => (await native()).content === original,
    "single transaction undo",
  );
  await page.keyboard.press("Control+y");
  await waitFor(async () => /N1/.test((await native()).content), "flow redo");
  await page.locator("#save").click();
  await waitFor(async () => !(await native()).dirty, "flow saved");
  const bytes = await readFile(file);
  assert.equal(bytes.subarray(0, 3).toString("hex"), "efbbbf");
  assert.match(bytes.toString(), /\r\n/);
  const complex = [
    "# Around",
    "",
    "```mermaid",
    "flowchart LR",
    "  %% Keep formatting",
    "  subgraph Pipeline",
    '    A["入口"] -->|继续| B{检查}',
    "  end",
    "  B --> C[完成]",
    "  style A fill:#ddeeff",
    "  linkStyle 0,1 stroke:#2468ac,opacity:0.7",
    "```",
    "",
    "After",
  ].join("\n");
  const complexFile = path.join(dir, "子图.md");
  await writeFile(complexFile, complex);
  await page.locator("#open").click();
  await dialog(complexFile);
  await page.locator("#open:not(:disabled)").waitFor();
  await page
    .getByRole("button", { name: "可视化编辑", exact: true })
    .click({ timeout: 60000 });
  const surface = page.locator(".diagram-edit-surface");
  await surface
    .getByRole("button", { name: "编辑图中文字：入口", exact: true })
    .click();
  await surface.getByRole("textbox").fill("新的入口");
  await surface.getByRole("textbox").press("Enter");
  await surface
    .getByRole("button", { name: "编辑图中文字：新的入口", exact: true })
    .waitFor();
  await surface
    .getByRole("button", { name: "编辑图中文字：继续", exact: true })
    .click();
  await surface.getByRole("textbox").fill("下一步");
  await page.locator("#inline-apply").click();
  const modified = complex
    .replace("入口", "新的入口")
    .replace("继续", "下一步");
  await waitFor(
    async () => (await native()).content === modified,
    "subgraph source-preserving label edits",
  );
  await page.locator("#save").click();
  await waitFor(async () => !(await native()).dirty, "complex flow saved");
  assert.equal(await readFile(complexFile, "utf8"), modified);
  const enterGraph = async () => {
    await page
      .getByRole("button", { name: "可视化编辑", exact: true })
      .click({ timeout: 60000 });
    await page.locator("[data-graph-tools]").waitFor();
  };
  const tool = (name) =>
    page
      .locator("[data-graph-tools]")
      .getByRole("button", { name, exact: true })
      .click();
  const pick = (id) => surface.locator(`[data-graph-id="${id}"]`).click();
  const applyDraft = () =>
    page.getByRole("button", { name: "应用到草稿", exact: true }).click();
  async function redraw(action) {
    const bar = await page.locator("[data-graph-tools]").elementHandle();
    await action();
    await waitFor(
      async () => !(await bar.evaluate((n) => n.isConnected)),
      "diagram draft operation: " + action.name,
    );
    await page.locator("[data-graph-tools]").waitFor();
    await bar.dispose();
  }
  async function createGroup() {
    await tool("新建子图");
    await page.getByRole("textbox", { name: "子图名称" }).fill("错误[标题]");
    await applyDraft();
    await page
      .getByText("无法安全修改这段源码。草稿已保留，可切换到源码编辑。", {
        exact: true,
      })
      .waitFor();
    assert.equal((await native()).content, modified);
    await page.getByRole("textbox", { name: "子图名称" }).fill("草稿组");
    await redraw(applyDraft);
  }
  async function move(id, parent) {
    await tool("移动节点");
    await pick(id);
    await redraw(() =>
      parent
        ? pick(parent)
        : page.getByRole("button", { name: "移至顶层", exact: true }).click(),
    );
  }
  async function readSvg() {
    return surface.locator("img").evaluate((img) => {
      const xml = new DOMParser().parseFromString(
        new TextDecoder().decode(
          Uint8Array.from(atob(img.src.split(",")[1]), (c) => c.charCodeAt(0)),
        ),
        "image/svg+xml",
      );
      return {
        groups: [...xml.querySelectorAll("g.cluster")].map((e) =>
          e.textContent.trim(),
        ),
        node: xml
          .querySelector('g.node[id*="-flowchart-A-"] rect')
          ?.getAttribute("style"),
        edges: [...xml.querySelectorAll("path.flowchart-link")].map((e) => [
          e.getAttribute("data-id"),
          e.getAttribute("style"),
        ]),
      };
    });
  }
  await enterGraph();
  await createGroup();
  await move("A", "MDGroup1");
  await page.locator("#inline-cancel").click();
  assert.equal((await native()).content, modified);
  await enterGraph();
  await createGroup();
  await tool("重命名子图");
  await pick("MDGroup1");
  await page.getByRole("textbox", { name: "子图名称" }).fill("交付组");
  await redraw(applyDraft);
  await move("A", "MDGroup1");
  await move("B", "");
  await redraw(() => page.locator("#flow-undo").click());
  await tool("移动节点");
  assert.equal(
    await surface.locator('[data-graph-id="B"]').getAttribute("data-parent"),
    "Pipeline",
  );
  await tool("结束选择");
  await redraw(() => page.locator("#flow-redo").click());
  await tool("移动节点");
  assert.equal(
    await surface.locator('[data-graph-id="B"]').getAttribute("data-parent"),
    "",
  );
  await tool("结束选择");
  await tool("节点样式");
  await pick("A");
  await page.getByLabel("颜色值", { exact: true }).fill("#cc9966");
  await redraw(applyDraft);
  await tool("连线样式");
  await pick("L_A_B_0");
  await page.getByLabel("样式属性").selectOption("stroke-width");
  await page.getByLabel("样式值").selectOption("4px");
  await redraw(applyDraft);
  const styled = await readSvg();
  assert(styled.groups.includes("交付组"));
  await surface.screenshot({
    path: path.join(dir, "subgraphs-and-styles.png"),
  });
  assert.match(styled.node, /#cc9966/i);
  assert.match(
    styled.edges.find(([id]) => id === "L_A_B_0")[1],
    /stroke-width:\s*4px/,
  );
  assert(
    !/stroke-width:\s*4px/.test(
      styled.edges.find(([id]) => id === "L_B_C_0")[1],
    ),
  );
  await redraw(() => page.locator("#flow-undo").click());
  assert(
    !/stroke-width:\s*4px/.test(
      (await readSvg()).edges.find(([id]) => id === "L_A_B_0")[1],
    ),
  );
  await redraw(() => page.locator("#flow-redo").click());
  await page.locator("#flow-source").click();
  await page.locator("#inline-source .cm-content").focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.insertText("%% roundtrip\n");
  assert.match(
    await page.locator("#inline-source").innerText(),
    /MDGroup1\["交付组"\]/,
  );
  await page.locator("#flow-source").click();
  await page.locator("[data-graph-tools]").waitFor();
  assert.equal((await native()).content, modified);
  await page.locator("#inline-apply").click();
  await waitFor(async () => (await native()).dirty, "graph applied");
  const final = (await native()).content;
  assert(final.includes("%% Keep formatting"));
  assert(final.includes("%% roundtrip\nflowchart LR"));
  assert(final.includes("linkStyle 0,1 stroke:#2468ac,opacity:0.7"));
  assert.match(final, /subgraph MDGroup1\["交付组"\]\s+A\["新的入口"\]\s+end/);
  assert(final.endsWith("\n\nAfter"));
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () => (await native()).content === modified,
    "exact graph undo",
  );
  await page.keyboard.press("Control+y");
  await waitFor(
    async () => (await native()).content === final,
    "exact graph redo",
  );
  await page.locator("#save").click();
  await waitFor(async () => !(await native()).dirty, "graph disk roundtrip");
  assert.equal(await readFile(complexFile, "utf8"), final);
  console.log(
    "PASS: actual subgraph create/rename/move in and out, semantic and rendered styles, shared linkStyle isolation, source roundtrip, cancel/apply/undo/redo/save.",
  );
  console.log(
    "PASS: Mermaid visual draft, preview, cancel, no-op, add, undo/redo, direction, source roundtrip, single document undo and BOM/CRLF save.",
  );
  return page;
}
