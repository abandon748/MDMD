import assert from "node:assert/strict";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function testInlineSwitch({ page, root, dialog, waitFor }) {
  const dir = path.join(root, "inline-switch");
  await mkdir(dir);
  const blocks = {
    paragraph: "段落甲乙 **粗体**。",
    heading: "## 标题甲乙",
    list: "- 列表甲乙\n  - 子项甲乙\n- 末项",
    table: "| 表头 | 数量 |\n| --- | --- |\n| 单元甲乙 | 2 |",
    code: "```js\nconst alpha = 1;\nconst beta = 2;\n```",
  };
  const source = Object.values(blocks).join("\n\n") + "\n\n结尾保护";
  const selectors = {
    paragraph: "#preview > p:first-child",
    heading: "#preview > h2",
    list: "#preview > ul > li:first-child",
    table: "#preview table tbody td:first-child",
    code: "#preview pre code",
  };
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const raw = () => page.locator("#inline-source .cm-content");
  async function open(file) {
    await page
      .locator(
        (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
      )
      .click();
    await dialog(file);
    await page.locator("#open:not(:disabled)").waitFor();
  }
  async function clickText(selector, offset = 2) {
    const locator = page.locator(selector);
    await locator.scrollIntoViewIfNeeded();
    const point = await locator.evaluate((node, offset) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && offset > text.length) {
        offset -= text.length;
        text = walker.nextNode();
      }
      if (!text) throw Error("Missing text point");
      const r = document.createRange();
      r.setStart(text, offset);
      r.collapse(true);
      const box = r.getBoundingClientRect();
      return { x: box.x + 0.2, y: box.y + box.height / 2 };
    }, offset);
    await page.mouse.click(point.x, point.y);
  }
  async function sourceMode() {
    if (await page.locator("#inline-source-toggle").isVisible())
      await page.locator("#inline-source-toggle").click();
    await raw().waitFor();
  }
  async function save() {
    await page.locator("#save").click();
    await page.locator('#save-status[data-state="saved"]').waitFor();
  }
  let count = 0;
  for (const from of Object.keys(blocks))
    for (const to of Object.keys(blocks)) {
      if (from === to) continue;
      const file = path.join(dir, `${from}-${to}.md`);
      await writeFile(file, "\ufeff" + source.replaceAll("\n", "\r\n"));
      await open(file);
      await clickText(selectors[from]);
      await page.locator("#inline-mode").click();
      await sourceMode();
      const replacement = blocks[from].replace(/甲乙|alpha/, "修改位置");
      await raw().fill(replacement + "\n");
      assert.equal((await native()).content, source, "draft remains staged");
      await clickText(selectors[to]);
      await waitFor(
        async () => (await native()).content.includes("修改位置"),
        `${from} applied before ${to}`,
      );
      assert.equal(
        (await native()).content,
        source.replace(blocks[from], replacement),
        `${from} -> ${to} preserves other blocks`,
      );
      if (["paragraph", "heading", "list"].includes(to)) {
        const before = await page.locator("#inline-rich").innerText();
        await page.keyboard.insertText("光标");
        const after = await page.locator("#inline-rich").innerText();
        assert.equal(
          after,
          before.slice(0, 2) + "光标" + before.slice(2),
          `${from} -> ${to} caret`,
        );
      } else {
        assert(await raw().isVisible(), `${from} -> ${to} source editor`);
        assert(
          (await raw().innerText()).includes(
            to === "table" ? "单元甲乙" : "const alpha",
          ),
        );
      }
      await page.locator("#inline-cancel").click();
      assert.equal(
        (await native()).content,
        source.replace(blocks[from], replacement),
        "cancel drops only destination draft",
      );
      await save();
      assert.equal(
        await readFile(file, "utf8"),
        "\ufeff" +
          source.replace(blocks[from], replacement).replaceAll("\n", "\r\n"),
      );
      count++;
    }
  console.log(
    `PASS: ${count} directed paragraph/heading/list/table/code switches, clicked rich caret, source identity, staged/cancel/save and outside-block BOM/CRLF bytes.`,
  );
  // Clicking code text should position the source cursor at that code, not the opening fence.
  const codeFile = path.join(dir, "code-caret.md");
  await writeFile(codeFile, source);
  await open(codeFile);
  await clickText(selectors.paragraph);
  await page.locator("#inline-mode").click();
  await clickText(selectors.code, 6);
  await page.keyboard.insertText("HERE");
  assert.match(
    await raw().innerText(),
    /const HEREalpha/,
    "code caret follows clicked text",
  );
  await page.locator("#inline-cancel").click();
  // A source draft that consumes the destination must not silently close editing.
  await clickText(selectors.code, 6);
  await page.locator("#inline-mode").click();
  await raw().fill("```js\nconst unclosed = 1;\n");
  await clickText("#preview > p:last-child");
  assert(await raw().isVisible(), "unclosed fence keeps the current draft");
  assert.match(await raw().innerText(), /unclosed/);
  assert.equal(
    (await native()).content,
    source,
    "ambiguous target does not apply",
  );
  await page.locator("#inline-cancel").click();
  for (const kind of Object.keys(blocks)) {
    const file = path.join(dir, `conflict-${kind}.md`);
    await writeFile(file, source);
    await open(file);
    if (kind === "table") {
      await page.locator(selectors.table).click({ button: "right" });
      await page.locator("#menu-table").click();
      await page
        .locator('#table-grid input[data-row="1"][data-col="0"]')
        .fill("本地表格");
    } else {
      await clickText(selectors[kind]);
      await page.locator("#inline-mode").click();
      await sourceMode();
      await raw().fill(blocks[kind].replace(/甲乙|alpha/, "本地草稿") + "\n");
    }
    const disk = "# 外部版本\n绝不覆盖";
    await writeFile(file, disk);
    await page.locator('#save-status[data-state="conflict"]').waitFor();
    const to = kind === "paragraph" ? "heading" : "paragraph";
    await clickText(selectors[to]);
    await waitFor(
      async () => (await native()).content.includes("本地"),
      "local applied during conflict",
    );
    await page.keyboard.insertText("目标草稿");
    await page.locator("#save").click();
    await page.locator("#open:not(:disabled)").waitFor();
    assert.equal(await readFile(file, "utf8"), disk);
    assert((await native()).content.includes("本地"));
    assert((await native()).content.includes("目标草稿"));
    await page.locator("#reload").click();
    await page.locator("button[value=cancel]").click();
    await page.locator("#open:not(:disabled)").waitFor();
    assert((await native()).content.includes("目标草稿"));
    await page.locator("#reload").click();
    await page.locator("button[value=discard]").click();
    await page.locator("#open:not(:disabled)").waitFor();
    assert.equal((await native()).content, disk);
  }
  console.log(
    "PASS: code text caret, ambiguous fence draft retention, five block types with real disk conflict, switched drafts retained, save rejected, cancel/reload explicit.",
  );
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(`Inline switch evidence: ${root}`);
  return page;
}
