import assert from "node:assert/strict";
import { writeFile, readFile, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

export async function testClipboardEdit({ page, root, dialog, waitFor }) {
  const source = "# 标题保留\n\n甲乙丙丁\n\n- 列表一\n- 列表二\n\n尾段保留";
  const file = path.join(root, "剪贴板编辑.md");
  await writeFile(file, "\ufeff" + source.replaceAll("\n", "\r\n"));
  await page.locator("#home-open").click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  const state = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const expect = (s) =>
    waitFor(async () => (await state()).content === s, "clipboard source");
  const rich = () => page.locator("#inline-rich");
  async function select(selector, from, to = from) {
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.locator(selector).scrollIntoViewIfNeeded();
    const points = await page.locator(selector).evaluate(
      (node, offsets) => {
        const text = document
          .createTreeWalker(node, NodeFilter.SHOW_TEXT)
          .nextNode();
        return offsets.map((offset) => {
          const r = document.createRange();
          r.setStart(text, offset);
          r.collapse(true);
          const b = r.getBoundingClientRect();
          return { x: b.left + 0.2, y: b.top + b.height / 2 };
        });
      },
      [from, to],
    );
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    await page.mouse.move(points[1].x, points[1].y, { steps: 8 });
    await page.mouse.up();
  }
  async function enter() {
    await page.locator("#read-mode").click();
    await page.locator("#refresh").click();
    await select("#preview > p:first-of-type", 0);
    await page.locator("#inline-mode").click();
  }
  async function pasteEvent(text = null, html = "<b>HTML only</b>") {
    await rich().evaluate(
      (node, { text, html }) => {
        const data = new DataTransfer();
        if (text !== null) data.setData("text/plain", text);
        if (html) data.setData("text/html", html);
        node.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: data,
          }),
        );
      },
      { text, html },
    );
  }
  await enter();
  await select("#inline-rich p", 3, 1);
  await pasteEvent();
  assert.equal(
    await rich().innerText(),
    "甲乙丙丁",
    "HTML-only clipboard must not delete selection",
  );
  await pasteEvent("");
  assert.equal(
    await rich().innerText(),
    "甲乙丙丁",
    "empty text must not delete selection",
  );
  await rich().evaluate((node) => {
    node.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true }),
    );
    const data = new DataTransfer();
    data.items.add(new File(["image"], "test.png", { type: "image/png" }));
    node.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  assert.equal(
    await rich().innerText(),
    "甲乙丙丁",
    "missing/file-only data preserves selection",
  );
  for (const blocked of ["composition", "readonly", "cross-block"]) {
    await select("#inline-rich p", 3, 1);
    await rich().evaluate((node, blocked) => {
      if (blocked === "composition")
        node.dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true }),
        );
      if (blocked === "readonly") node.contentEditable = "false";
      if (blocked === "cross-block") {
        const outside = document.querySelector("#preview h1").firstChild;
        getSelection().setBaseAndExtent(
          node.querySelector("p").firstChild,
          1,
          outside,
          2,
        );
      }
      const cut = new ClipboardEvent("cut", {
        bubbles: true,
        cancelable: true,
      });
      node.dispatchEvent(cut);
      if (!cut.defaultPrevented)
        throw new Error(`unsafe cut allowed: ${blocked}`);
    }, blocked);
    await pasteEvent("不应写入");
    assert.equal(await rich().innerText(), "甲乙丙丁", blocked);
    await rich().evaluate((node, blocked) => {
      if (blocked === "composition")
        node.dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true }),
        );
      if (blocked === "readonly") node.contentEditable = "true";
    }, blocked);
  }
  await select("#inline-rich p", 3, 1);
  await pasteEvent("插入😀");
  assert.equal(await rich().innerText(), "甲插入😀丁");
  await page.keyboard.press("Control+z");
  assert.equal(await rich().innerText(), "甲乙丙丁");
  const selection = () =>
    rich().evaluate((root) => {
      const s = getSelection();
      return [
        [s.anchorNode, s.anchorOffset],
        [s.focusNode, s.focusOffset],
      ].map(([n, o]) => {
        const r = document.createRange();
        r.selectNodeContents(root);
        r.setEnd(n, o);
        return r.toString().length;
      });
    });
  assert.deepEqual(
    await selection(),
    [3, 1],
    "paste undo restores actual reverse selection",
  );
  await page.keyboard.press("Control+y");
  assert.equal(await rich().innerText(), "甲插入😀丁");
  await page.locator("#inline-cancel").click();
  await expect(source);

  const sentinel = `MDMD clipboard restore ${Date.now()}`;
  const expected = path.join(root, "clipboard-edit-restore.txt"),
    ready = path.join(root, "clipboard-edit-ready");
  await writeFile(expected, sentinel);
  const guard = promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.resolve("tests/feedback-clipboard.ps1"),
      "-ExpectedFilePath",
      expected,
      "-ReadyFilePath",
      ready,
      "-TimeoutSeconds",
      "300",
    ],
    { windowsHide: true, timeout: 315000 },
  ).then(
    (v) => ({ v }),
    (e) => ({ e }),
  );
  await waitFor(async () => {
    try {
      await access(ready);
      return true;
    } catch {
      return false;
    }
  }, "clipboard backup");
  const cdp = await page.context().newCDPSession(page);
  const setClip = (text) =>
    page.evaluate((text) => navigator.clipboard.writeText(text), text);
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  try {
    await cdp.send("Browser.grantPermissions", {
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
      origin: new URL(page.url()).origin,
    });
    for (const mode of ["read", "split"]) {
      await page.locator(`#${mode}-mode`).click();
      await page.locator("#refresh").click();
      await select("#preview > p:first-of-type", 1, 3);
      await page.keyboard.press("Control+c");
      assert.equal(await clip(), "乙丙");
      await page.keyboard.press("Control+x");
      await expect(source);
      await setClip("不应写入");
      await page.keyboard.press("Control+v");
      await expect(source);
    }
    await page.locator("#split-mode").click();
    const editor = page.locator("#editor .cm-content");
    await editor.focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Control+c");
    assert.equal(await clip(), "乙丙");
    await expect(source);
    await page.keyboard.press("Control+x");
    await expect(source.replace("乙丙", ""));
    assert.equal(await clip(), "乙丙");
    await page.keyboard.press("Control+z");
    await expect(source);
    await setClip("中文😀\r\n第二行");
    await page.keyboard.press("Control+v");
    const pasted = source.replace("乙丙", "中文😀\n第二行");
    await expect(pasted);
    await page.keyboard.press("Control+z");
    await expect(source);
    await page.keyboard.press("Control+y");
    await expect(pasted);
    await page.keyboard.press("Control+z");
    await expect(source);

    await enter();
    await select("#inline-rich p", 3, 1);
    await page.keyboard.press("Control+c");
    assert.equal(await clip(), "乙丙");
    await page.keyboard.press("Control+x");
    assert.equal(await rich().innerText(), "甲丁");
    assert.equal(await clip(), "乙丙");
    await page.keyboard.press("Control+z");
    assert.equal(await rich().innerText(), "甲乙丙丁");
    assert.deepEqual(await selection(), [3, 1]);
    await page.keyboard.press("Control+y");
    assert.equal(await rich().innerText(), "甲丁");
    await page.keyboard.press("Control+z");
    await setClip("剪贴板😀");
    await page.keyboard.press("Control+v");
    assert.equal(await rich().innerText(), "甲剪贴板😀丁");
    await page.keyboard.press("Control+z");
    assert.deepEqual(await selection(), [3, 1]);
    await page.keyboard.press("Control+y");
    assert.equal(await rich().innerText(), "甲剪贴板😀丁");
    await expect(source);
    await page.locator("#inline-cancel").click();
    await expect(source);

    await enter();
    await page.locator("#inline-source-toggle").click();
    await page.locator("#inline-source .cm-content").focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Control+x");
    assert.equal(await clip(), "乙丙");
    await page.keyboard.press("Control+v");
    await expect(source);
    await page.locator("#inline-apply").click();
    await expect(source);

    for (const [selector, text, replacement] of [
      ["h1", "标题保留", "标题粘贴"],
      ["ul > li:first-child", "列表一", "列表粘贴"],
    ]) {
      await page.locator("#read-mode").click();
      await page.locator("#refresh").click();
      await select(`#preview ${selector}`, 0);
      await page.locator("#inline-mode").click();
      await select(`#inline-rich ${selector}`, 0, text.length);
      await page.keyboard.press("Control+c");
      assert.equal(await clip(), text);
      await page.keyboard.press("Control+x");
      assert.equal(await clip(), text);
      await page.keyboard.press("Control+z");
      assert.equal(await rich().locator(selector).innerText(), text);
      await setClip(replacement);
      await page.keyboard.press("Control+v");
      assert.equal(await rich().locator(selector).innerText(), replacement);
      await page.keyboard.press("Control+z");
      assert.equal(await rich().locator(selector).innerText(), text);
      await page.keyboard.press("Control+y");
      assert.equal(await rich().locator(selector).innerText(), replacement);
      await page.locator("#inline-cancel").click();
      await expect(source);
    }

    // Plain text only: CRLF, tabs, markup and emoji survive apply/save without
    // importing clipboard HTML or changing any text outside this block.
    await enter();
    await select("#inline-rich p", 1, 3);
    await setClip("中文😀\r\n第二行\t<b>文字</b>");
    await page.keyboard.press("Control+v");
    assert.equal(await rich().locator("b").count(), 0);
    await page.keyboard.press("Control+z");
    assert.equal(await rich().innerText(), "甲乙丙丁");
    assert.deepEqual(await selection(), [1, 3]);
    await page.keyboard.press("Control+y");
    const pastedText = await rich().innerText();
    assert(pastedText.includes("中文😀") && pastedText.includes("第二行"));
    assert(pastedText.includes("<b>文字</b>"));
    await page.locator("#inline-apply").click();
    const saved = (await state()).content;
    assert(saved.startsWith("# 标题保留\n\n甲中文😀"));
    assert(saved.includes("第二行\t\\<b\\>文字\\</b\\>丁"));
    assert(saved.endsWith("\n\n- 列表一\n- 列表二\n\n尾段保留"));
    await page.locator("#save").click();
    await page.locator('#save-status[data-state="saved"]').waitFor();
    assert.equal(
      await readFile(file, "utf8"),
      "\ufeff" + saved.replaceAll("\n", "\r\n"),
    );

    await enter();
    await select("#inline-rich p", 1);
    await setClip("本地保留");
    await page.keyboard.press("Control+v");
    await writeFile(file, "EXTERNAL");
    await page.locator('#save-status[data-state="conflict"]').waitFor();
    await page.locator("#save").click();
    await page.locator("#open:not(:disabled)").waitFor();
    assert.equal(await readFile(file, "utf8"), "EXTERNAL");
    assert((await state()).content.includes("本地保留"));
    await page.locator("#reload").click();
    await page.locator('button[value="cancel"]').click();
    await page.locator("#open:not(:disabled)").waitFor();
    assert((await state()).content.includes("本地保留"));
    await page.locator("#reload").click();
    await page.locator('button[value="discard"]').click();
    await page.locator("#open:not(:disabled)").waitFor();
    await expect("EXTERNAL");
  } finally {
    await setClip(sentinel);
    const result = await guard;
    if (result.e) throw result.e;
    assert.equal(JSON.parse(result.v.stdout).restored, true);
    await cdp.detach();
  }
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: empty/HTML-only paste preservation; real clipboard copy/cut/paste in read/split preview/source and inline rich/source, Unicode/CRLF, directed undo/redo, staged cancel, literal markup, BOM/CRLF save and external conflict; OS clipboard restored.",
  );
}
