import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function testInlineInput({ page, root, dialog }) {
  const file = path.join(root, "中文输入编辑.md");
  const source =
    "# 标题甲乙\n\n甲乙丙丁\n\n**粗体文字** 和普通文字\n\n- 列表甲乙\n- 列表丙丁\n\n> 引用甲乙\n\n尾部保留\n\n" +
    [2, 3, 4, 5, 6].map((n) => "#".repeat(n) + " 标题甲乙").join("\n\n");
  await writeFile(file, "\ufeff" + source.replaceAll("\n", "\r\n"));
  await page
    .locator((await page.locator("#home").isVisible()) ? "#home-open" : "#open")
    .click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  const cdp = await page.context().newCDPSession(page);
  const area = () => page.locator("#inline-rich");
  const results = [];
  const selection = () =>
    area().evaluate((root) => {
      const s = getSelection();
      return {
        text: s.focusNode?.textContent,
        offset: s.focusOffset,
        inside: root.contains(s.focusNode),
      };
    });
  async function caret(selector, offset) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    const point = await page.locator(selector).evaluate((node, offset) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      const range = document.createRange();
      range.setStart(text, offset);
      range.collapse(true);
      const r = range.getBoundingClientRect();
      return { x: r.x + 0.2, y: r.y + r.height / 2 };
    }, offset);
    await page.mouse.click(point.x, point.y);
  }
  async function enter(selector = "#preview > p:first-of-type", offset = 2) {
    await caret(selector, offset);
    await page.locator("#inline-mode").click();
    await area().waitFor();
  }
  async function check(name, run) {
    try {
      await run();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({
        name,
        passed: false,
        error: String(error),
        html: await area().evaluate((n) => n.innerHTML),
        selection: await selection(),
      });
    }
    await cdp.send("Input.imeSetComposition", {
      text: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
    if (await page.locator("#inline-cancel").isVisible())
      await page.locator("#inline-cancel").click();
  }
  await check("中文组合提交与撤销光标", async () => {
    await enter();
    await cdp.send("Input.imeSetComposition", {
      text: "中",
      selectionStart: 1,
      selectionEnd: 1,
    });
    await cdp.send("Input.imeSetComposition", {
      text: "中文",
      selectionStart: 2,
      selectionEnd: 2,
    });
    assert.equal(await area().innerText(), "甲乙中文丙丁");
    await page.locator("#inline-apply").evaluate((b) => b.click());
    assert(await area().isVisible(), "uncommitted IME must keep draft");
    await cdp.send("Input.insertText", { text: "中文" });
    assert.equal(await area().innerText(), "甲乙中文丙丁");
    await page.keyboard.press("Control+z");
    assert.equal(await area().innerText(), "甲乙丙丁");
    assert.deepEqual(await selection(), {
      text: "甲乙丙丁",
      offset: 2,
      inside: true,
    });
    await page.keyboard.press("Control+y");
    assert.equal(await area().innerText(), "甲乙中文丙丁");
    assert.equal((await selection()).offset, 4);
  });
  await check("中文组合取消不丢原文", async () => {
    await enter();
    await cdp.send("Input.imeSetComposition", {
      text: "测试",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await cdp.send("Input.imeSetComposition", {
      text: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
    assert.equal(await area().innerText(), "甲乙丙丁");
    assert.equal((await selection()).offset, 2);
  });
  await check("回车分段撤销重做光标", async () => {
    await enter();
    await page.keyboard.press("Enter");
    assert.deepEqual(await area().locator("p").allTextContents(), [
      "甲乙",
      "丙丁",
    ]);
    await page.keyboard.press("Control+z");
    assert.equal(await area().innerText(), "甲乙丙丁");
    assert.equal((await selection()).offset, 2);
    await page.keyboard.press("Control+y");
    assert.deepEqual(await area().locator("p").allTextContents(), [
      "甲乙",
      "丙丁",
    ]);
    assert.deepEqual(await selection(), {
      text: "丙丁",
      offset: 0,
      inside: true,
    });
  });
  await check("尾部空段可撤销重做", async () => {
    await enter(undefined, 4);
    await page.keyboard.press("Enter");
    assert.equal(await area().locator("p").count(), 2);
    await page.keyboard.press("Control+z");
    assert.equal(await area().locator("p").count(), 1);
    await page.keyboard.press("Control+y");
    assert.equal(await area().locator("p").count(), 2);
  });
  await check("退格字符撤销光标", async () => {
    await enter(undefined, 3);
    await page.keyboard.press("Backspace");
    assert.equal(await area().innerText(), "甲乙丁");
    await page.keyboard.press("Control+z");
    assert.equal(await area().innerText(), "甲乙丙丁");
    assert.equal((await selection()).offset, 3);
    await page.keyboard.press("Control+y");
    assert.equal(await area().innerText(), "甲乙丁");
    assert.equal((await selection()).offset, 2);
  });
  for (const selector of [
    ...[1, 2, 3, 4, 5, 6].map((n) => `#preview > h${n}`),
    "#preview > ul > li:first-child",
    "#preview > blockquote p",
    "#preview > p strong",
  ]) {
    await check(`${selector} 输入／换行／退格连续撤销重做`, async () => {
      await enter(selector, 2);
      const states = [];
      const snapshot = async () => ({
        html: await area().innerHTML(),
        caret: await selection(),
      });
      states.push(await snapshot());
      await cdp.send("Input.imeSetComposition", {
        text: "中文",
        selectionStart: 2,
        selectionEnd: 2,
      });
      await cdp.send("Input.insertText", { text: "中文" });
      states.push(await snapshot());
      await page.keyboard.press("Enter");
      states.push(await snapshot());
      await page.keyboard.press("Backspace");
      states.push(await snapshot());
      for (let i = states.length - 2; i >= 0; i--) {
        await page.keyboard.press("Control+z");
        assert.deepEqual(await snapshot(), states[i], `undo ${i}`);
      }
      for (let i = 1; i < states.length; i++) {
        await page.keyboard.press("Control+y");
        assert.deepEqual(await snapshot(), states[i], `redo ${i}`);
      }
    });
  }
  await check("Shift+Enter 换行撤销重做保留光标", async () => {
    await enter();
    await page.keyboard.press("Shift+Enter");
    const html = await area().innerHTML(),
      after = await selection();
    assert.equal(await area().locator("br").count(), 1);
    await page.keyboard.press("Control+z");
    assert.equal(await area().innerText(), "甲乙丙丁");
    await page.keyboard.press("Control+y");
    assert.equal(await area().innerHTML(), html);
    assert.deepEqual(await selection(), after);
  });
  for (const key of ["Backspace", "Delete", "IME"]) {
    await check(`中文选区 ${key} 与撤销恢复选区`, async () => {
      await enter();
      await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.press("Shift+ArrowRight");
      assert.equal(
        await page.evaluate(() => getSelection().toString()),
        "丙丁",
      );
      if (key === "IME") {
        await cdp.send("Input.imeSetComposition", {
          text: "替换",
          selectionStart: 2,
          selectionEnd: 2,
        });
        await cdp.send("Input.insertText", { text: "替换" });
      } else await page.keyboard.press(key);
      assert.equal(
        await area().innerText(),
        key === "IME" ? "甲乙替换" : "甲乙",
      );
      await page.keyboard.press("Control+z");
      assert.equal(await area().innerText(), "甲乙丙丁");
      assert.equal(
        await page.evaluate(() => getSelection().toString()),
        "丙丁",
      );
      await page.keyboard.press("Control+y");
      assert.equal(
        await area().innerText(),
        key === "IME" ? "甲乙替换" : "甲乙",
      );
    });
  }
  await check("块开头退格不删除其他块，撤销后新输入清除重做", async () => {
    await enter(undefined, 0);
    await page.keyboard.press("Backspace");
    assert.equal(await area().innerText(), "甲乙丙丁");
    assert.equal(await page.locator("#preview > h1").innerText(), "标题甲乙");
    await page.keyboard.insertText("甲");
    await page.keyboard.press("Control+z");
    await page.keyboard.insertText("新");
    await page.keyboard.press("Control+y");
    assert.equal(await area().innerText(), "新甲乙丙丁");
  });
  // Assert exact source and disk bytes after a real IME + Enter transaction chain.
  await enter();
  await cdp.send("Input.imeSetComposition", {
    text: "中文",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await cdp.send("Input.insertText", { text: "中文" });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");
  await page.locator("#inline-apply").click();
  await page.locator("#save").click();
  await page.locator('#save-status[data-state="saved"]').waitFor();
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" +
      source.replace("甲乙丙丁", "甲乙中文\n\n丙丁").replaceAll("\n", "\r\n"),
  );
  results.push({
    name: "组合提交与回车重做后应用保存：精确源码及 BOM/CRLF",
    passed: true,
  });
  await enter();
  await cdp.send("Input.imeSetComposition", {
    text: "本地输入",
    selectionStart: 4,
    selectionEnd: 4,
  });
  await cdp.send("Input.insertText", { text: "本地输入" });
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");
  const disk = "# 外部版本\n不要覆盖";
  await writeFile(file, disk);
  await page.locator('#save-status[data-state="conflict"]').waitFor();
  await page.locator("#save").click();
  await page.locator("#open:not(:disabled)").waitFor();
  assert.equal(await readFile(file, "utf8"), disk);
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  assert((await native()).content.includes("本地输入"));
  await page.locator("#reload").click();
  await page.locator("button[value=cancel]").click();
  await page.locator("#open:not(:disabled)").waitFor();
  assert((await native()).content.includes("本地输入"));
  await page.locator("#reload").click();
  await page.locator("button[value=discard]").click();
  await page.locator("#open:not(:disabled)").waitFor();
  assert.equal((await native()).content, disk);
  results.push({
    name: "中文输入重做后的磁盘冲突拒绝覆盖、取消保留及明确重载",
    passed: true,
  });
  await writeFile(
    path.join(root, "inline-input-results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
  assert(
    results.every((r) => r.passed),
    "inline input checks failed",
  );
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await cdp.detach();
  console.log(`PASS: inline input checks. Evidence: ${root}`);
  return page;
}
