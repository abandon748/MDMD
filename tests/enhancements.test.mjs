import assert from "node:assert/strict";
import { writeFile, readFile, access } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
export async function testEnhancements({
  page,
  root,
  dialog,
  restart,
  waitFor,
}) {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const requests = [];
  let recovered = false;
  const server = createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Set-Cookie", "secret=never-return");
    if (req.url === "/retry" && !recovered) {
      res.writeHead(503);
      return res.end();
    }
    if (req.url === "/redirect" || req.url === "/loop") {
      res.writeHead(302, { Location: req.url === "/loop" ? "/loop" : "/ok" });
      return res.end();
    }
    if (req.url === "/bad") {
      return res.end("<script>bad</script>");
    }
    if (req.url === "/svg") {
      res.setHeader("Content-Type", "image/svg+xml");
      return res.end("<svg/>");
    }
    if (req.url === "/large") {
      return res.end(Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]));
    }
    if (req.url === "/timeout") return;
    res.end(png);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`,
    file = path.join(root, "增强.md");
  const source =
    `# 增强\n\n![网络](${url}/retry)\n\n文字[^n] 再次[^n] 未定义[^missing]\n\n[^n]: 第一段 **粗体**\n\n    第二段\n\n    - 脚注列表\n\n- [x] 已完成\n  - [ ] 子任务\n- [ ] 未完成\n\n` +
    ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]
      .map((x) => `> [!${x}]\n> ${x} 内容\n`)
      .join("\n") +
    "\n| A | B |\n|---|---|\n| C | D |\n\n```text\n第一行\nsecond line\n```\n\n```mermaid\nflowchart LR\n A[Alpha] --> B{Beta}\n B --> C(Gamma)\n```\n";
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  const open = async () => {
    await page
      .locator(
        (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
      )
      .click();
    await dialog(file);
    await idle();
  };
  const settings = async () => {
    await page.locator("#document-settings").click();
    await page.locator("#settings-typography").click();
  };
  try {
    await writeFile(file, source);
    await open();
    assert.equal(requests.length, 0, "no automatic remote image request");
    await page
      .getByRole("button", { name: "加载网络图片", exact: true })
      .click();
    await page
      .getByRole("button", { name: "加载失败，点击重试", exact: true })
      .waitFor();
    recovered = true;
    await page
      .getByRole("button", { name: "加载失败，点击重试", exact: true })
      .click();
    await waitFor(
      () =>
        page
          .locator("#preview img[data-local-src]")
          .evaluate((i) => i.naturalWidth === 1 && !i.hidden),
      "decoded image",
    );
    const id = (await native()).id;
    const image = (target) =>
      page.evaluate(
        ({ id, target }) =>
          window.__TAURI_INTERNALS__
            .invoke("preview_link", { id, kind: "image", target })
            .then(
              (x) => ({ ok: true, ...x }),
              (e) => ({ error: String(e) }),
            ),
        { id, target },
      );
    assert((await image(url + "/redirect")).ok);
    for (const route of ["/loop", "/bad", "/svg", "/large", "/timeout"])
      assert((await image(url + route)).error, route);
    assert((await image("file:///C:/secret")).error);
    assert(
      (await image(url.replace("http://", "http://user:pass@") + "/ok")).error,
    );
    assert(
      requests.every(
        (r) =>
          !r.headers.cookie && !r.headers.authorization && !r.headers.referer,
      ),
    );
    assert.equal((await native()).content, source);
    if (process.env.MDMD_TEST_LIVE_IMAGES === "1") {
      const target = "https://www.mdview.cn/logo_big.png",
        live = await image(target);
      const report = {
        target,
        ok: !!live.ok,
        error: live.error,
        bytes: live.content ? Buffer.from(live.content, "base64").length : 0,
      };
      if (live.ok)
        report.dimensions = await page.evaluate(async (data) => {
          const img = new Image();
          img.src = `data:${data.contentType};base64,${data.content}`;
          await img.decode();
          return [img.naturalWidth, img.naturalHeight];
        }, live);
      await writeFile(
        path.join(root, "live-image.json"),
        JSON.stringify(report, null, 2),
      );
      console.log("LIVE IMAGE: " + JSON.stringify(report));
    }
    console.log(
      "PASS: remote image explicit consent, decoded image, failure/retry, redirect limits, type/signature/size/timeouts, anonymous headers; source unchanged.",
    );
    assert.equal(await page.locator("#preview .footnote-ref").count(), 2);
    assert.equal(await page.locator("#fn-1 .footnote-back").count(), 2);
    assert.match(await page.locator("#fn-1").innerText(), /第二段/);
    assert.match(await page.locator("#fn-1").innerText(), /脚注列表/);
    await page.locator('#preview a[href="#fn-1"]').first().click();
    await page.locator('#fn-1 a[href="#fnref-1-2"]').click();
    assert(await page.locator("#fnref-1-2").isVisible());
    assert.equal(
      await page
        .locator("#preview [id]")
        .evaluateAll((ns) => new Set(ns.map((n) => n.id)).size),
      await page.locator("#preview [id]").count(),
    );
    const colors = await page
      .locator(".markdown-alert")
      .evaluateAll((ns) => ns.map((n) => getComputedStyle(n).borderLeftColor));
    assert.equal(new Set(colors).size, 5);
    assert.equal(await page.locator(".alert-title span").count(), 5);
    assert.match(
      await page
        .locator(".task-done")
        .evaluate((n) => getComputedStyle(n).textDecorationLine),
      /line-through/,
    );
    assert.equal(
      await page
        .locator(".task-text")
        .nth(1)
        .evaluate((n) => getComputedStyle(n).textDecorationLine),
      "none",
    );
    await settings();
    await page.locator("#setting-task-strike").uncheck();
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("mdmd.settings")).schemaVersion,
      ),
      16,
    );
    await page.evaluate(() => {
      window.oldSet = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw Error("full");
      };
    });
    await page.locator("#setting-task-strike").click();
    assert(!(await page.locator("#setting-task-strike").isChecked()));
    await page.evaluate(() => (Storage.prototype.setItem = window.oldSet));
    await page.locator("#settings-close").click();
    page = await restart();
    await open();
    assert.equal(
      await page
        .locator(".task-done")
        .evaluate((n) => getComputedStyle(n).textDecorationLine),
      "none",
    );
    const legacy = await page.evaluate(() => {
      const v = JSON.parse(localStorage.getItem("mdmd.settings"));
      v.schemaVersion = 15;
      delete v.taskStrike;
      const raw = JSON.stringify(v);
      localStorage.setItem("mdmd.settings", raw);
      return raw;
    });
    page = await restart();
    await open();
    await settings();
    assert(await page.locator("#setting-task-strike").isChecked());
    assert.equal(
      await page.evaluate(() => localStorage.getItem("mdmd.settings")),
      legacy,
    );
    await page.locator("#settings-appearance").click();
    await page.locator("#theme-dark").check();
    assert.equal(
      new Set(
        await page
          .locator(".markdown-alert")
          .evaluateAll((ns) =>
            ns.map((n) => getComputedStyle(n).borderLeftColor),
          ),
      ).size,
      5,
    );
    await page.locator("#theme-light").check();
    await page.locator("#settings-close").click();
    await page.locator("#preview .task-check").last().click();
    await waitFor(
      async () => (await native()).content.includes("- [x] 未完成"),
      "task update",
    );
    await page.locator("#split-mode").click();
    await page.locator("#editor .cm-content").focus();
    await page.keyboard.press("Control+z");
    await waitFor(async () => (await native()).content === source, "task undo");
    await page.keyboard.press("Control+y");
    await waitFor(
      async () => (await native()).content.includes("- [x] 未完成"),
      "task redo",
    );
    await page.keyboard.press("Control+z");
    await waitFor(
      async () => (await native()).content === source,
      "task restore",
    );
    await page.locator("#read-mode").click();
    await page.getByRole("button", { name: "编辑表格", exact: true }).click();
    await page.locator("#table-grid input").first().fill("表头");
    await page.locator("#inline-apply").click();
    await waitFor(
      async () => (await native()).content.includes("表头"),
      "table grid entry",
    );
    await page.locator("#split-mode").click();
    await page.locator("#editor .cm-content").focus();
    await page.keyboard.press("Control+z");
    await waitFor(
      async () => (await native()).content === source,
      "table undo",
    );
    await page.locator("#read-mode").click();
    const numbered = page.locator("[data-code-numbers]").first();
    await numbered.click();
    assert.equal(
      await page.locator("#preview pre[data-line-numbers=true]").count(),
      1,
    );
    const ready = path.join(root, "enhance-copy-ready"),
      expected = path.join(root, "enhance-copy.txt");
    await writeFile(expected, "第一行\nsecond line\n");
    const clip = promisify(execFile)(
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
      ],
      { windowsHide: true, timeout: 30000 },
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
    }, "clipboard saved");
    await page.getByRole("button", { name: "复制代码", exact: true }).click();
    const copied = await clip;
    if (copied.e) throw copied.e;
    assert(JSON.parse(copied.v.stdout).restored);
    await page.evaluate(() => {
      window.clipboardWrite = navigator.clipboard.writeText;
      navigator.clipboard.writeText = async () => {
        throw Error("denied");
      };
    });
    await page.getByRole("button", { name: "已复制", exact: true }).click();
    await page
      .getByRole("button", { name: "复制失败，请重试", exact: true })
      .waitFor();
    await page.evaluate(
      () => (navigator.clipboard.writeText = window.clipboardWrite),
    );
    await page.locator("#refresh").click();
    assert.equal(
      await page.locator("#preview pre[data-line-numbers]").count(),
      0,
    );
    assert.equal(
      await page.locator(".preview-tools [data-code-numbers]").count(),
      1,
      "Mermaid has no ordinary code tools",
    );
    console.log(
      "PASS: task strike toggle/restart/write failure/undo/redo, table grid visible entry/application/undo, native clipboard copy excludes line numbers, per-block override and refresh, five alert colors, multiline/repeated footnote links.",
    );
    await page.locator("#document-settings").click();
    await page.locator("#settings-general").click();
    await page.locator("#engines-manage").click();
    if (
      (await page.locator("#engine-mermaid-status").textContent()) !== "已就绪"
    ) {
      await page.locator("#engine-mermaid-download:not(:disabled)").click();
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
    await page.locator(".diagram-image").waitFor();
    await page
      .getByRole("button", { name: "加载网络图片", exact: true })
      .click();
    await waitFor(
      () =>
        page
          .locator("#preview img[data-local-src]")
          .evaluate((i) => i.naturalWidth === 1 && !i.hidden),
      "export image",
    );
    await page.locator("#output-open").click();
    await page.locator("#output-html").click();
    const exported = path.join(root, "增强.html");
    await dialog(exported);
    await page.locator("#output-html:not(:disabled)").waitFor();
    assert.match(await page.locator("#output-message").innerText(), /已导出/);
    await page.locator("#output-close").click();
    const html = await readFile(exported, "utf8");
    assert(!/preview-tools|network-image|data-document-edit/.test(html));
    const output = await page.context().newPage();
    await output.goto("file:///" + exported.replaceAll("\\", "/"));
    assert.equal(await output.locator("button,script").count(), 0);
    assert.equal(await output.locator("#fn-1 .footnote-back").count(), 2);
    assert.match(
      await output
        .locator(".task-done")
        .evaluate((n) => getComputedStyle(n).textDecorationLine),
      /line-through/,
    );
    assert.equal(
      new Set(
        await output
          .locator(".markdown-alert")
          .evaluateAll((ns) =>
            ns.map((n) => getComputedStyle(n).borderLeftColor),
          ),
      ).size,
      5,
    );
    await output.screenshot({
      path: path.join(root, "enhancements-export.png"),
    });
    await output.close();
    console.log(
      "PASS: schema 15 default/no load rewrite, dark callouts and offline HTML export with task style, footnote backlinks, embedded image and no application tools.",
    );
    await page
      .getByRole("button", { name: "可视化编辑", exact: true })
      .click({ timeout: 60000 });
    const canvas = page.locator("#flow-canvas");
    await canvas.waitFor();
    const node = canvas.locator("[data-node=A]");
    const initial = await node.getAttribute("transform");
    let box = await node.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 50,
      box.y + box.height / 2 + 40,
      { steps: 5 },
    );
    await page.mouse.up();
    assert.notEqual(await node.getAttribute("transform"), initial);
    assert.equal((await native()).content, source, "drag is session-only");
    await node.dblclick();
    await page
      .getByRole("textbox", { name: "选中节点文字", exact: true })
      .fill("画布修改");
    await canvas.locator("[data-node=B]").click();
    await node.dblclick();
    const selectedBox = await node.boundingBox();
    const inputBox = await page
      .getByRole("textbox", { name: "选中节点文字", exact: true })
      .boundingBox();
    assert(
      inputBox.x >= selectedBox.x &&
        inputBox.x + inputBox.width <= selectedBox.x + selectedBox.width + 1,
    );
    assert(
      inputBox.y >= selectedBox.y &&
        inputBox.y < selectedBox.y + selectedBox.height,
    );
    assert.equal(
      await page
        .getByRole("textbox", { name: "选中节点文字", exact: true })
        .inputValue(),
      "画布修改",
      "node change cannot discard unblurred text",
    );
    const canvasLabel = page.getByRole("textbox", {
      name: "选中节点文字",
      exact: true,
    });
    await canvasLabel.evaluate((n) => {
      n.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      n.value = "画布组合";
      n.dispatchEvent(
        new InputEvent("input", { bubbles: true, isComposing: true }),
      );
    });
    assert.equal(
      await page
        .getByRole("textbox", { name: "节点文字 A", exact: true })
        .inputValue(),
      "画布修改",
    );
    await canvasLabel.evaluate((n) =>
      n.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "组合" }),
      ),
    );
    await waitFor(
      async () =>
        (await page
          .getByRole("textbox", { name: "节点文字 A", exact: true })
          .inputValue()) === "画布组合",
      "composition committed",
    );
    await canvasLabel.fill("画布修改");
    await page
      .locator(".flow-stage")
      .screenshot({ path: path.join(root, "flow-inline-text.png") });
    await page
      .getByRole("combobox", { name: "选中节点形状", exact: true })
      .selectOption("round");
    const a = await node.boundingBox(),
      c = await canvas.locator("[data-node=C]").boundingBox();
    await page.keyboard.down("Alt");
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    assert.equal(await canvas.locator("[data-edge]").count(), 3);
    await page.locator("#flow-undo").click();
    assert.equal(await canvas.locator("[data-edge]").count(), 2);
    await page.locator("#flow-redo").click();
    assert.equal(await canvas.locator("[data-edge]").count(), 3);
    await page.screenshot({ path: path.join(root, "enhancements-canvas.png") });
    await page.locator("#inline-apply").click();
    await waitFor(
      async () => (await native()).content.includes("画布修改"),
      "canvas apply",
    );
    await page.locator("#split-mode").click();
    await page.locator("#editor .cm-content").focus();
    await page.keyboard.press("Control+z");
    await waitFor(
      async () => (await native()).content === source,
      "canvas exact document undo",
    );
    await page.locator("#read-mode").click();
    // Shared save guard also applies to canvas drafts.
    await page.getByRole("button", { name: "可视化编辑", exact: true }).click();
    await page.locator("#flow-canvas [data-node=A]").dblclick();
    await page
      .getByRole("textbox", { name: "选中节点文字", exact: true })
      .fill("冲突草稿");
    await page.locator("#flow-direction").focus();
    await writeFile(file, "# 外部版本\n");
    await page.locator('#save-status[data-state="conflict"]').waitFor();
    await page.locator("#save").click();
    await idle();
    assert.equal(await readFile(file, "utf8"), "# 外部版本\n");
    assert((await native()).content.includes("冲突草稿"));
    await page.locator("#reload").click();
    await page.locator('button[value="discard"]').click();
    await idle();
    console.log(
      "PASS: canvas actual drag/double-click text/shape/Alt-connect, same undo/redo, apply/exact document undo and real external conflict protection.",
    );
    await page.locator("#home-back").click();
    await page.locator("#home-open:not(:disabled)").waitFor();
    return page;
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
