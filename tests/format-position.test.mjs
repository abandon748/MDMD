import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export async function testFormatPosition({ page, root, dialog, waitFor }) {
  const file = path.join(root, "格式选区定位.md");
  const source = "# 标题保留\n\n甲乙丙丁戊\n\n末段保留";
  await writeFile(file, source);
  await page.locator("#home-open").click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  const state = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const expect = (text) =>
    waitFor(
      async () => (await state()).content === text,
      "format position source",
    );
  const rich = () => page.locator("#inline-rich");
  async function select(selector, from, to) {
    // Start a fresh selection, rather than native dragging of the prior range.
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.locator(selector).scrollIntoViewIfNeeded();
    const points = await page.locator(selector).evaluate(
      (node, offsets) => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const text = walker.nextNode();
        return offsets.map((offset) => {
          const range = document.createRange();
          range.setStart(text, offset);
          range.setEnd(text, offset + 1);
          const r = range.getBoundingClientRect();
          return { x: r.left + 1, y: r.top + r.height / 2 };
        });
      },
      [from, to],
    );
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    await page.mouse.move(points[1].x, points[1].y, { steps: 8 });
    await page.mouse.up();
  }
  async function menu(action) {
    const values = await page
      .locator("#format-action option")
      .evaluateAll((nodes) => nodes.map((n) => n.value));
    await page.locator("#format-action").click();
    await page.keyboard.press("Home");
    for (let i = 0; i < values.indexOf(action); i++)
      await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
  }
  for (const mode of ["read", "split", "inline"]) {
    for (const [action, tag] of [
      ["bold", "b,strong"],
      ["italic", "i,em"],
      ["strike", "s,strike,del"],
      ["highlight", "mark"],
      ["code", "code"],
      ["link", "a"],
    ]) {
      await page
        .locator(`#${mode === "split" ? "split" : "read"}-mode`)
        .click();
      await page.locator("#refresh").click();
      if (mode === "split") {
        await page.locator("#editor .cm-content").focus();
        await page.keyboard.press("Control+End");
      }
      await select("#preview > p:first-of-type", 1, 3);
      if (mode === "inline") await page.locator("#inline-mode").click();
      await menu(action);
      assert(
        await rich().isVisible(),
        `${mode}/${action}: active preview selection becomes rich draft`,
      );
      assert.equal(
        await rich().locator(tag).innerText(),
        "乙丙",
        `${mode}/${action}: exact selected text`,
      );
      await expect(source);
      await page.keyboard.press("Control+z");
      assert.equal(await rich().innerText(), "甲乙丙丁戊");
      assert.equal(await rich().locator(tag).count(), 0);
      assert.equal(
        await page.evaluate(() => window.getSelection()?.toString()),
        "乙丙",
      );
      await page.keyboard.press("Control+y");
      assert.equal(await rich().locator(tag).innerText(), "乙丙");
      await page.locator("#inline-cancel").click();
      await expect(source);
      console.log(`PASS: ${mode}/${action} selection and undo/redo`);
    }
  }
  // Block formats use the current paragraph, not the heading or document tail.
  for (const mode of ["read", "split", "inline"]) {
    for (const [action, tag] of [
      ["quote", "blockquote"],
      ["listCycle", "ul"],
    ]) {
      await page
        .locator(`#${mode === "split" ? "split" : "read"}-mode`)
        .click();
      await page.locator("#refresh").click();
      await select("#preview > p:first-of-type", 1, 3);
      if (mode === "inline") await page.locator("#inline-mode").click();
      await menu(action);
      assert.equal(await rich().locator(tag).innerText(), "甲乙丙丁戊");
      await page.keyboard.press("Control+z");
      assert.equal(await rich().locator(tag).count(), 0);
      assert.equal(
        await page.evaluate(() => window.getSelection()?.toString()),
        "乙丙",
      );
      await page.keyboard.press("Control+y");
      assert.equal(await rich().locator(tag).innerText(), "甲乙丙丁戊");
      await expect(source);
      await page.locator("#inline-cancel").click();
    }
  }
  await page.locator("#read-mode").click();
  // A preview range across independent blocks is rejected rather than truncated.
  await page.locator("#preview").evaluate((root) => {
    const p = root.querySelectorAll(":scope > p");
    window
      .getSelection()
      .setBaseAndExtent(p[0].firstChild, 2, p[1].firstChild, 2);
  });
  await menu("bold");
  assert.equal(await page.locator("#inline-rich").count(), 0);
  assert.match(await page.locator("#error-text").innerText(), /同一个正文块/);
  await expect(source);
  await select("#preview > p:first-of-type", 1, 3);
  await page.locator("#inline-mode").click();
  await page.locator("#preview").evaluate((root) => {
    const first = root.querySelector("#inline-rich p").firstChild;
    const last = root.querySelector(":scope > p:last-of-type").firstChild;
    window.getSelection().setBaseAndExtent(first, 1, last, 2);
  });
  await menu("bold");
  assert.equal(await rich().locator("b,strong").count(), 0);
  assert.match(await page.locator("#error-text").innerText(), /同一个正文块/);
  await page.locator("#inline-cancel").click();
  await expect(source);
  // Reverse selection survives menu focus, undo and a different next action.
  await select("#preview > p:first-of-type", 3, 1);
  await menu("bold");
  await page.keyboard.press("Control+z");
  assert.equal(
    await page.evaluate(() => window.getSelection()?.toString()),
    "乙丙",
  );
  assert.deepEqual(
    await rich().evaluate((root) => {
      const s = window.getSelection();
      return [
        [s.anchorNode, s.anchorOffset],
        [s.focusNode, s.focusOffset],
      ].map(([n, o]) => {
        const range = document.createRange();
        range.selectNodeContents(root);
        range.setEnd(n, o);
        return range.toString().length;
      });
    }),
    [3, 1],
  );
  await menu("italic");
  assert.equal(await rich().locator("i,em").innerText(), "乙丙");
  assert.equal(await page.locator("#error").isVisible(), false);
  await page.screenshot({
    path: path.join(root, "format-reverse-selection.png"),
  });
  await menu("clear");
  assert.equal(await rich().locator("i,em").count(), 0);
  await page.keyboard.press("Control+z");
  assert.equal(await rich().locator("i,em").innerText(), "乙丙");
  await page.keyboard.press("Control+y");
  assert.equal(await rich().locator("i,em").count(), 0);
  await page.keyboard.press("Control+z");
  await page.locator("#inline-apply").click();
  await expect(source.replace("乙丙", "*乙丙*"));
  await page.keyboard.press("Control+z");
  await expect(source);
  await page.locator("#refresh").click();
  // Inline source selection must survive the same native menu focus change.
  await select("#preview > p:first-of-type", 1, 3);
  await page.locator("#inline-mode").click();
  await page.locator("#inline-source-toggle").click();
  await page.locator("#inline-source .cm-content").focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await menu("bold");
  const raw = () =>
    page
      .locator("#inline-source .cm-content")
      .evaluate((node) =>
        [...node.querySelectorAll(".cm-line")]
          .map((n) => n.textContent)
          .join("\n"),
      );
  assert.match(await raw(), /^甲\*\*乙丙\*\*丁戊/);
  await page.keyboard.press("Control+z");
  assert.match(await raw(), /^甲乙丙丁戊/);
  await page.keyboard.press("Control+y");
  assert.match(await raw(), /^甲\*\*乙丙\*\*丁戊/);
  await page.locator("#inline-cancel").click();
  await expect(source);

  // A rendered code selection maps both endpoints into its literal source.
  await page.locator("#split-mode").click();
  const fenced = "```text\n甲乙丙丁戊\n```\n\n末段保留";
  await page.locator("#editor .cm-content").fill(fenced);
  await expect(fenced);
  await page.locator("#read-mode").click();
  await page.locator("#refresh").click();
  await select("#preview pre code", 1, 3);
  await menu("bold");
  assert.equal(await raw(), "```text\n甲**乙丙**丁戊\n```\n");
  await page.keyboard.press("Control+z");
  assert.equal(await raw(), "```text\n甲乙丙丁戊\n```\n");
  await page.keyboard.press("Control+y");
  await page.locator("#inline-apply").click();
  await expect(fenced.replace("乙丙", "**乙丙**"));
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").fill(source);
  await expect(source);
  await page.locator("#read-mode").click();
  await page.locator("#refresh").click();
  // Collapsed selection keeps typing at the clicked position, not block start.
  await select("#preview > p:first-of-type", 2, 2);
  await menu("bold");
  await page.keyboard.insertText("新");
  assert.equal(await rich().innerText(), "甲乙新丙丁戊");
  await page.keyboard.press("Control+z");
  assert.equal(await rich().innerText(), "甲乙丙丁戊");
  await page.keyboard.press("Control+y");
  await page.locator("#inline-apply").click();
  await expect(source.replace("乙丙", "乙**新**丙"));
  await writeFile(file, "EXTERNAL");
  await page.locator("#save").click();
  await page.locator("#open:not(:disabled)").waitFor();
  assert.equal(await readFile(file, "utf8"), "EXTERNAL");
  await expect(source.replace("乙丙", "乙**新**丙"));
  await page.locator("#home-back").click();
  await page.locator('button[value="discard"]').click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: format real-menu selection in read/split preview/inline; six inline actions, quote/list/clear, reverse direction, undo/redo/reformat, inline source and code range, cross-block refusal, collapsed typing and external conflict.",
  );
}
