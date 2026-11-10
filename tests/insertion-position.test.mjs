import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export async function testInsertionPosition({ page, root, dialog, waitFor }) {
  const original =
    "# 定位标题\n\n前段甲乙后段\n\n- 列表甲乙\n\n```text\n代码甲乙\n```\n\n最后保留";
  const file = path.join(root, "图片片段位置.md");
  const image = path.join(root, "定位.png");
  await writeFile(file, original);
  await writeFile(
    image,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const state = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const expect = async (text) => {
    try {
      await waitFor(
        async () => (await state()).content === text,
        "insertion source",
      );
    } catch (error) {
      assert.equal((await state()).content, text);
      throw error;
    }
  };
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  await page.locator("#home-open").click();
  await dialog(file);
  await idle();
  async function clickText(selector, needle, offset) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    const point = await page.locator(selector).evaluate(
      (root, { needle, offset }) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const start = node.textContent.indexOf(needle);
          if (start < 0) continue;
          const range = document.createRange();
          range.setStart(node, start + offset);
          range.setEnd(node, start + offset + 1);
          const rect = range.getBoundingClientRect();
          return { x: rect.left + 1, y: rect.top + rect.height / 2 };
        }
        throw new Error("Missing caret text");
      },
      { needle, offset },
    );
    await page.mouse.click(point.x, point.y);
  }
  async function reset() {
    if (await page.locator("#inline-cancel").count())
      await page.locator("#inline-cancel").click();
    await page.locator("#read-mode").click();
    if ((await state()).content !== original) {
      await page.locator("#inline-mode").focus();
      await page.keyboard.press("Control+z");
      await expect(original);
    }
    await page.locator("#refresh").click();
  }
  // The source pane overrides an earlier preview point; selection is retained
  // when the toolbar and native file picker take focus.
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await insert("# 定位标题\n\n前", original.slice(original.indexOf("段甲")));
  async function insert(prefix, suffix) {
    await page.locator("#insert-image").click();
    await dialog(image);
    await idle();
    if (await page.locator("#inline-apply").count())
      await page.locator("#inline-apply").click();
    await waitFor(
      async () => (await state()).content.includes("![图片]"),
      "image applied",
    );
    const text = (await state()).content;
    assert(
      text.startsWith(prefix + "![图片](assets/"),
      "image follows caret, not document/block end",
    );
    assert(text.endsWith(suffix), "suffix preserved");
    await page.keyboard.press("Control+z");
    await expect(original);
    await page.keyboard.press("Control+y");
    await expect(text);
    await reset();
  }
  // Reading preview, split preview (over stale source caret), rich draft, code draft.
  for (const mode of ["read", "split", "inline"]) {
    await page.locator(`#${mode === "split" ? "split" : "read"}-mode`).click();
    if (mode === "split") {
      await page.locator("#editor .cm-content").focus();
      await page.keyboard.press("Control+End");
    }
    await clickText("#preview > p:first-of-type", "前段甲乙后段", 3);
    if (mode === "inline") await page.locator("#inline-mode").click();
    await insert(
      "# 定位标题\n\n前段甲",
      "乙后段\n\n" + original.split("乙后段\n\n")[1],
    );
  }
  await clickText("#preview h1", "定位标题", 2);
  await insert("# 定位", "标题" + original.slice(original.indexOf("\n")));
  await clickText("#preview li", "列表甲乙", 3);
  await insert(
    original.slice(0, original.indexOf("列表甲乙")) + "列表甲",
    "乙\n\n" + original.split("乙\n\n")[1],
  );
  await clickText("#preview pre code", "代码甲乙", 3);
  await insert(
    original.slice(0, original.indexOf("代码甲乙")) + "代码甲",
    "乙\n```\n\n最后保留",
  );
  // Native picker cancellation leaves the rich draft and caret in place.
  await clickText("#preview > p:first-of-type", "前段甲乙后段", 3);
  await page.locator("#inline-mode").click();
  await page.keyboard.insertText("草稿");
  await page.locator("#insert-image").click();
  await dialog("", true);
  await idle();
  assert(await page.locator("#inline-rich").isVisible());
  assert.equal(
    await page.locator("#inline-rich").innerText(),
    "前段甲草稿乙后段",
  );
  await page.keyboard.insertText("续");
  assert.equal(
    await page.locator("#inline-rich").innerText(),
    "前段甲草稿续乙后段",
  );
  const broken = path.join(root, "损坏.png");
  await writeFile(broken, "not an image");
  await page.locator("#insert-image").click();
  await dialog(broken);
  await idle();
  assert.match(await page.locator("#error-text").innerText(), /图片格式无效/);
  assert(await page.locator("#inline-rich").isVisible());
  await page.keyboard.insertText("留");
  assert.equal(
    await page.locator("#inline-rich").innerText(),
    "前段甲草稿续留乙后段",
  );
  await expect(original);
  await page.locator("#inline-cancel").click();
  // Nonempty preview positions are explicitly rejected for snippets, never EOF.
  for (const mode of ["read", "split", "inline"]) {
    await page.locator(`#${mode === "split" ? "split" : "read"}-mode`).click();
    await clickText("#preview > p:first-of-type", "前段甲乙后段", 3);
    if (mode === "inline") await page.locator("#inline-mode").click();
    await page.locator("#insert-snippet").click();
    assert.equal(await page.locator("#snippet-dialog").isVisible(), false);
    assert.match(await page.locator("#error-text").innerText(), /顶层空行/);
    assert(await page.locator("#inline-rich").isVisible());
    await expect(original);
    await reset();
  }
  // A newly created rich empty paragraph uses its DOM caret, not the hidden
  // source selection. Cancel preserves both paragraphs; apply remains staged.
  await clickText("#preview > p:first-of-type", "前段甲乙后段", 3);
  await page.locator("#inline-mode").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  const richBefore = await page.locator("#inline-rich").innerHTML();
  await page.locator("#insert-snippet").click();
  await page.locator("#snippet-cancel").click();
  assert.equal(await page.locator("#inline-rich").innerHTML(), richBefore);
  await page.locator("#insert-snippet").click();
  await page.locator("#snippet-list").selectOption("quote");
  await page.locator("#snippet-apply").click();
  assert.match(
    await page
      .locator("#inline-source .cm-content")
      .evaluate((node) =>
        [...node.querySelectorAll(".cm-line")]
          .map((line) => line.textContent)
          .join("\n"),
      ),
    /前段甲乙后段\s+> 文本/,
  );
  await expect(original);
  await page.keyboard.press("Control+z");
  assert.doesNotMatch(
    await page
      .locator("#inline-source .cm-content")
      .evaluate((node) =>
        [...node.querySelectorAll(".cm-line")]
          .map((line) => line.textContent)
          .join("\n"),
      ),
    /> 文本/,
  );
  await page.keyboard.press("Control+y");
  assert.match(
    await page
      .locator("#inline-source .cm-content")
      .evaluate((node) =>
        [...node.querySelectorAll(".cm-line")]
          .map((line) => line.textContent)
          .join("\n"),
      ),
    /> 文本/,
  );
  await page.locator("#inline-apply").click();
  await expect(
    original.replace("前段甲乙后段\n\n", "前段甲乙后段\n\n> 文本\n\n\n"),
  );
  await reset();

  // Inline source can insert between two local paragraphs while keeping the
  // original block draft unapplied; cancel abandons only that block draft.
  await clickText("#preview > p:first-of-type", "前段甲乙后段", 3);
  await page.locator("#inline-mode").click();
  await page.locator("#inline-source-toggle").click();
  await page.locator("#inline-source .cm-content").fill("前段\n\n后段");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.locator("#insert-snippet").click();
  await page.locator("#snippet-list").selectOption("rule");
  await page.locator("#snippet-apply").click();
  assert.equal(
    await page
      .locator("#inline-source .cm-content")
      .evaluate((node) =>
        [...node.querySelectorAll(".cm-line")]
          .map((line) => line.textContent)
          .join("\n"),
      ),
    "前段\n\n---\n\n后段",
  );
  await expect(original);
  await page.locator("#inline-cancel").click();

  // Formatted selection replacement is one transaction, and cancel does not
  // normalize the original asterisk/link spelling.
  await page.locator("#split-mode").click();
  const formatted =
    "# 保留\n\n甲**粗体乙丙**丁 [链接](https://example.com)\n\n尾段";
  await page.locator("#editor .cm-content").fill(formatted);
  await expect(formatted);
  await page.locator("#read-mode").click();
  await page.locator("#refresh").click();
  await clickText("#preview p strong", "粗体乙丙", 2);
  await page.locator("#inline-mode").click();
  await page.keyboard.press("Shift+ArrowRight");
  await page.locator("#insert-image").click();
  await dialog("", true);
  await idle();
  await page.locator("#inline-apply").click();
  await expect(formatted);
  await clickText("#preview p strong", "粗体乙丙", 2);
  await page.locator("#inline-mode").click();
  await page.keyboard.press("Shift+ArrowRight");
  await page.locator("#insert-image").click();
  await dialog(image);
  await idle();
  await page.keyboard.press("Control+z");
  assert.equal(
    await page
      .locator("#inline-source .cm-content")
      .evaluate((node) =>
        [...node.querySelectorAll(".cm-line")]
          .map((line) => line.textContent)
          .join("\n"),
      ),
    formatted.split("\n\n")[1] + "\n",
  );
  await page.keyboard.press("Control+y");
  await page.locator("#inline-apply").click();
  await waitFor(
    async () => (await state()).content.includes("![图片]"),
    "formatted image selection",
  );
  assert.match(
    (await state()).content,
    /甲\*\*粗体!\[图片\]\(assets\/[^)]+\)丙\*\*丁 \[链接\]\(<https:\/\/example.com>\)\n\n尾段$/,
  );
  await page.screenshot({
    path: path.join(root, "image-at-formatted-selection.png"),
  });
  const withImage = (await state()).content;
  await clickText("#preview p strong", "粗体", 1);
  await page.locator("#insert-image").click();
  assert.match(await page.locator("#error-text").innerText(), /无法安全定位/);
  assert(await page.locator("#inline-source").isVisible());
  await expect(withImage);
  await page.locator("#inline-cancel").click();
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").fill(original);
  await expect(original);
  await page.locator("#refresh").click();
  // Split source empty line in the middle: cancellation, insert, undo/redo.
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.locator("#insert-snippet").click();
  await page.locator("#snippet-cancel").click();
  await expect(original);
  await page.locator("#insert-snippet").click();
  await page.locator("#snippet-list").selectOption("rule");
  await page.locator("#snippet-apply").click();
  const inserted =
    "# 定位标题\n\n---\n\n" + original.slice(original.indexOf("前段"));
  await expect(inserted);
  await page.keyboard.press("Control+z");
  await expect(original);
  await page.keyboard.press("Control+y");
  await expect(inserted);
  await writeFile(file, "EXTERNAL");
  await page.locator("#save").click();
  await idle();
  assert.equal(await readFile(file, "utf8"), "EXTERNAL");
  await expect(inserted);
  await page.locator("#home-back").click();
  await page.locator('button[value="discard"]').click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: image caret in reading/split source/split preview/rich/header/list/code and formatted selection; undo/redo, cancelled/failed picker draft and caret preservation, complex-map refusal; snippet nonempty refusal in three modes, rich empty paragraph and inline/split middle empty-line insert/cancel/undo/redo; external save conflict.",
  );
}
