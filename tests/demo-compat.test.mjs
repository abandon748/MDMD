import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function testDemoCompat({ page, root, dialog, restart, waitFor }) {
  // This is a copy: the user's original demo is never opened or written by tests.
  const bytes = await readFile(
    new URL("./fixtures/mdview-demo.md", import.meta.url),
  );
  const file = path.join(root, "演示副本.md");
  const normalized = bytes.toString("utf8").replace(/\r\n|\r/g, "\n");
  await writeFile(file, bytes);
  const native = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const open = async (target = file) => {
    await page
      .locator(
        (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
      )
      .click();
    await dialog(target);
    await page.locator("#open:not(:disabled)").waitFor();
  };
  const settings = async () => {
    await page.locator("#document-settings").click();
    await page.locator("#settings-general").click();
  };
  await open();
  assert.equal((await native()).readOnly, true);
  const border = (selector) =>
    page
      .locator(selector)
      .first()
      .evaluate((n) => getComputedStyle(n).borderLeftColor);
  assert.notEqual(
    await border("#preview .alert-warning"),
    await border("#preview .alert-note"),
  );
  await settings();
  assert.equal(
    await page.locator("#setting-double-click-edit").isChecked(),
    false,
  );
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
  await page.locator("#preview .diagram").first().waitFor({ timeout: 60000 });
  const edits = page.locator("#preview [data-document-edit]");
  assert.equal(await edits.count(), 5);
  for (const b of await edits.all()) {
    assert(await b.isDisabled());
    assert.match(await b.getAttribute("title"), /混合换行/);
  }
  await page.locator("#reload").click();
  await page.locator("#open:not(:disabled)").waitFor();
  assert.match(
    await page.locator("#notice-text").textContent(),
    /已重新读取磁盘文件。文件仍为只读/,
  );
  assert.equal((await native()).readOnly, true);
  assert.deepEqual(await readFile(file), bytes);
  await page.waitForFunction(
    () =>
      !document
        .querySelector("#notice-text")
        ?.textContent?.includes("已重新读取磁盘文件"),
    {},
    { timeout: 6000 },
  );
  assert(await page.locator("#notice").isVisible());
  assert(await page.locator("#notice-normalize").isEnabled());
  await page.screenshot({ path: path.join(root, "demo-readonly.png") });
  const sourceId = (await native()).id;
  const copyFile = path.join(root, "可编辑副本.md");
  await page.locator("#notice-copy").click();
  await dialog(copyFile, true, [
    "-ExpectedTitle",
    "另存为可编辑副本",
    "-ExpectedFileName",
    "演示副本-可编辑副本.md",
  ]);
  await page.locator("#open:not(:disabled)").waitFor();
  assert.equal((await native()).id, sourceId);
  assert.equal((await native()).readOnly, true);
  // Even accepting the Windows overwrite prompt cannot replace the original.
  await page.locator("#notice-copy").click();
  await dialog(file, false, ["-ConfirmOverwrite"]);
  await page.locator("#open:not(:disabled)").waitFor();
  assert.match(
    await page.locator("#error-text").textContent(),
    /同名文件或目录已存在/,
  );
  assert.deepEqual(await readFile(file), bytes);
  assert.equal((await native()).id, sourceId);
  // Source changes while the save dialog is open must stop stale conversion.
  await page.locator("#notice-copy").click();
  await writeFile(file, Buffer.concat([bytes, Buffer.from("\n外部修改\n")]));
  await dialog(copyFile);
  await page.locator("#open:not(:disabled)").waitFor();
  assert.match(await page.locator("#error-text").textContent(), /源文件已变化/);
  await assert.rejects(readFile(copyFile), { code: "ENOENT" });
  assert.equal((await native()).id, sourceId);
  await writeFile(file, bytes);
  await page.locator("#reload").click();
  await page.locator("#open:not(:disabled)").waitFor();
  await page.locator("#notice-copy").click();
  await dialog(copyFile);
  await page.locator("#open:not(:disabled)").waitFor();
  assert.equal((await native()).readOnly, false);
  assert.equal((await native()).path, copyFile);
  assert.equal((await native()).eol, "LF");
  assert.equal(await readFile(copyFile, "utf8"), normalized);
  assert.deepEqual(await readFile(file), bytes);
  assert.match(
    await page.locator("#notice-text").textContent(),
    /已创建可编辑副本/,
  );
  await page.locator("#editor .cm-content").fill("# 可编辑并保存\n副本内容");
  await page.locator("#save").click();
  await waitFor(
    async () =>
      (await readFile(copyFile, "utf8")) === "# 可编辑并保存\n副本内容",
    "editable copy saved",
  );
  page = await restart();
  await open(copyFile);
  assert.equal((await native()).readOnly, false);
  assert.equal((await native()).content, "# 可编辑并保存\n副本内容");
  await open();
  assert.equal((await native()).readOnly, true);
  assert.deepEqual(await readFile(file), bytes);
  // Normalize a separate test original in place, never the user's demo.
  const convertDir = path.join(root, "normalize-original");
  await mkdir(convertDir);
  const convertFile = path.join(convertDir, "原文件.md");
  const raw = Buffer.from("\ufeff# 原件\r\n第一行\n末行\r结束");
  const converted = "\ufeff# 原件\n第一行\n末行\n结束";
  await writeFile(convertFile, raw);
  await open(convertFile);
  const before = await native();
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  const confirm = async () => {
    await page.locator("#notice-normalize").click();
    await page.locator("#normalize-dialog[open]").waitFor();
  };
  await confirm();
  await page.locator('#normalize-dialog button[value="keep"]').click();
  await idle();
  await confirm();
  await page.keyboard.press("Escape");
  await idle();
  assert.deepEqual(await readFile(convertFile), raw);
  assert.equal((await native()).id, before.id);
  assert.equal((await native()).readOnly, true);
  // New prompts must stay translated and reachable in a narrow window.
  await settings();
  await page.locator("#setting-language").selectOption("en");
  await page.locator("#setting-language:not(:disabled)").waitFor();
  await page.locator("#settings-close").click();
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  await page.setViewportSize({ width: 640, height: 720 });
  assert(
    await page
      .locator("#notice")
      .evaluate((n) => n.scrollWidth <= n.clientWidth),
  );
  await confirm();
  assert.equal(
    await page.locator("#normalize-title").innerText(),
    "Normalize and edit original",
  );
  assert.match(
    await page.locator("#normalize-dialog p").first().innerText(),
    /Original bytes are backed up/,
  );
  assert(
    await page
      .locator("#normalize-dialog")
      .evaluate((n) => n.scrollWidth <= n.clientWidth),
  );
  await page.screenshot({ path: path.join(root, "normalize-en-640.png") });
  await page.keyboard.press("Escape");
  await idle();
  await page.setViewportSize(viewport);
  await settings();
  await page.locator("#setting-language").selectOption("zh-CN");
  await page.locator("#setting-language:not(:disabled)").waitFor();
  await page.locator("#settings-close").click();
  const denied = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const state = await invoke("document_state");
    return Promise.all(
      ["old-session", state.id].map(async (id, index) => {
        try {
          await invoke("document_action", {
            id,
            revision: state.revision + index,
            name: "normalize-newlines",
            discard: false,
          });
          return false;
        } catch {
          return true;
        }
      }),
    );
  });
  assert.deepEqual(denied, [true, true]);
  await confirm();
  await writeFile(convertFile, "外部程序修改\n");
  await page.locator("#normalize-confirm").click();
  await idle();
  assert.equal(await readFile(convertFile, "utf8"), "外部程序修改\n");
  assert.equal((await native()).readOnly, true);
  assert.match(
    await page.locator("#error-text").textContent(),
    /磁盘文件已改变/,
  );
  await writeFile(convertFile, raw);
  await page.locator("#reload").click();
  await idle();
  const backupDir = path.join(convertDir, ".mdmd-backups");
  await writeFile(backupDir, "阻止备份");
  await confirm();
  await page.locator("#normalize-confirm").click();
  await idle();
  assert.equal((await native()).readOnly, true);
  assert.equal((await native()).dirty, false);
  assert.deepEqual(await readFile(convertFile), raw);
  await unlink(backupDir);
  await confirm();
  await page.locator("#normalize-confirm").click();
  await idle();
  const after = await native();
  assert.equal(after.path, convertFile);
  assert.equal(after.readOnly, false);
  assert.equal(after.eol, "LF");
  assert.equal(after.bom, true);
  assert.equal(after.dirty, false);
  assert.equal(await readFile(convertFile, "utf8"), converted);
  assert.deepEqual(await readFile(after.backupPath), raw);
  assert.equal(
    await page.locator("#split-mode").getAttribute("aria-pressed"),
    "true",
  );
  assert.match(
    await page.locator("#notice-text").textContent(),
    /已备份并统一为 LF/,
  );
  assert(await page.locator("#notice-normalize").isHidden());
  await page.screenshot({ path: path.join(root, "normalized-original.png") });
  await page.locator("#editor .cm-content").fill("# 转换后保存\n正文");
  await page.locator("#save").click();
  await idle();
  assert.equal(await readFile(convertFile, "utf8"), "\ufeff# 转换后保存\n正文");
  assert.deepEqual(await readFile(after.backupPath), raw);
  page = await restart();
  await open(convertFile);
  assert.equal((await native()).readOnly, false);
  assert.equal((await native()).content, "# 转换后保存\n正文");
  // Restoring original bytes also restores its mixed-newline protection.
  await writeFile(convertFile, await readFile(after.backupPath));
  await page.locator("#reload").click();
  await idle();
  assert.equal((await native()).readOnly, true);
  assert.deepEqual(await readFile(convertFile), raw);
  await open();
  // Simulate the user fixing a COPY externally; reload must actually see new bytes.
  await writeFile(file, normalized);
  await page.locator("#reload").click();
  await page.locator("#open:not(:disabled)").waitFor();
  assert.equal((await native()).readOnly, false);
  assert.match(
    await page.locator("#notice-text").textContent(),
    /已重新读取磁盘文件/,
  );
  assert(!/混合换行/.test(await page.locator("#notice-text").textContent()));
  await page.locator("#notice").waitFor({ state: "hidden", timeout: 6000 });
  await writeFile(file, normalized + "\n外部写入\n");
  await page.locator('#save-status[data-state="conflict"]').waitFor();
  await page.locator("#reload").click();
  await idle();
  assert((await native()).content.endsWith("外部写入\n"));
  await writeFile(file, normalized);
  await waitFor(
    async () => (await native()).external,
    "new conflict after reload",
  );
  await page.waitForFunction(
    () =>
      !document
        .querySelector("#notice-text")
        ?.textContent?.includes("已重新读取磁盘文件"),
  );
  assert(await page.locator("#notice").isVisible());
  await page.locator("#reload").click();
  await idle();
  const heading = page.locator("#preview h1").first();
  await heading.dblclick();
  assert.equal(await page.locator(".inline-editor").count(), 0);
  assert.equal(
    await page.locator("#read-mode").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#inline-mode").click();
  await page.locator("#inline-rich").waitFor();
  await page.locator("#inline-cancel").click();
  assert.equal((await native()).content, normalized);
  // The visual table editor already exists in the context menu.
  await page.locator("#preview table td").first().click({ button: "right" });
  await page.locator("#menu-table").click();
  await page.locator("#table-grid").waitFor();
  assert.equal(await page.locator("#table-grid input").count(), 12);
  await page.locator("#inline-cancel").click();
  await page
    .getByRole("button", { name: "可视化编辑", exact: true })
    .first()
    .click({ timeout: 60000 });
  await page.locator("#flow-grid").waitFor();
  await page
    .getByRole("textbox", { name: "节点文字 C", exact: true })
    .fill("目录修改");
  await page.locator("#flow-direction").focus();
  await page.locator("#inline-apply").click();
  await waitFor(
    async () => (await native()).content.includes("目录修改"),
    "demo flow applied",
  );
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () => (await native()).content === normalized,
    "demo flow undo exact",
  );
  await page.locator("#read-mode").click();
  await page
    .getByRole("button", { name: "可视化编辑", exact: true })
    .nth(1)
    .click({ timeout: 60000 });
  const surface = page.locator(".diagram-edit-surface");
  const editGraphText = async (before, after) => {
    const target = surface
      .getByRole("button", { name: "编辑图中文字：" + before, exact: true })
      .first();
    await target.click();
    const input = surface.getByRole("textbox");
    const a = await target.boundingBox(),
      b = await input.boundingBox();
    assert(Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2);
    await input.fill(after);
    if (before === "双击打开文档")
      await surface.screenshot({
        path: path.join(root, "sequence-inline-text.png"),
      });
    await input.press("Enter");
    await surface
      .getByRole("button", { name: "编辑图中文字：" + after, exact: true })
      .first()
      .waitFor();
  };
  await editGraphText("用户", "读者");
  await editGraphText("双击打开文档", "双击编辑文档");
  await editGraphText("外部编辑器保存后自动刷新", "保存后刷新");
  await page.locator("#flow-undo").click();
  await surface
    .getByRole("button", { name: "编辑图中文字：外部编辑器保存后自动刷新" })
    .waitFor();
  await page.locator("#flow-redo").click();
  await surface
    .getByRole("button", { name: "编辑图中文字：保存后刷新" })
    .waitFor();
  assert.equal((await native()).content, normalized);
  await page.locator("#inline-apply").click();
  const expected = normalized
    .replace("participant U as 用户", "participant U as 读者")
    .replace("U->>M: 双击打开文档", "U->>M: 双击编辑文档")
    .replace(
      "Note over M,F: 外部编辑器保存后自动刷新",
      "Note over M,F: 保存后刷新",
    );
  await waitFor(
    async () => (await native()).content === expected,
    "sequence edits preserve all surrounding source",
  );
  await page.locator("#split-mode").click();
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () => (await native()).content === normalized,
    "sequence document undo",
  );
  await page.locator("#read-mode").click();
  await page
    .getByRole("button", { name: "可视化编辑", exact: true })
    .nth(1)
    .click({ timeout: 60000 });
  await editGraphText("读取内容", "取消的修改");
  const actorHit = (actor) =>
    surface
      .getByRole("button", { name: "编辑图中文字：" + actor, exact: true })
      .first();
  await page.getByRole("button", { name: "添加参与者", exact: true }).click();
  await actorHit("新参与者 1").waitFor();
  await page.getByRole("button", { name: "添加消息", exact: true }).click();
  await actorHit("用户").click();
  await actorHit("新参与者 1").click();
  await surface
    .getByRole("button", { name: "编辑图中文字：新消息", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "添加备注", exact: true }).click();
  await actorHit("文件").click();
  await surface
    .getByRole("button", { name: "编辑图中文字：新备注", exact: true })
    .waitFor();
  await page.screenshot({ path: path.join(root, "sequence-edit.png") });
  await page.locator("#inline-cancel").click();
  assert.equal((await native()).content, normalized);
  assert(
    await page
      .getByRole("button", { name: "加载网络图片", exact: true })
      .isVisible(),
  );
  await page.locator('#preview a[href="#fn-1"]').click();
  assert.match(await page.locator("#fn-1").innerText(), /脚注的正文/);
  await settings();
  await page.locator("#setting-double-click-edit").check();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("mdmd.settings")).schemaVersion,
    ),
    16,
  );
  await page.locator("#settings-close").click();
  await heading.dblclick();
  await page.locator("#inline-rich").waitFor();
  await page.locator("#inline-cancel").click();
  await idle();
  assert.equal((await native()).dirty, false, "clean demo before restart");
  page = await restart();
  await open();
  await settings();
  assert(await page.locator("#setting-double-click-edit").isChecked());
  // Simulate storage failure: setting and persisted value must both remain true.
  await page.evaluate(() => {
    window.savedSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw Error("full");
    };
  });
  await page.locator("#setting-double-click-edit").click();
  assert(await page.locator("#setting-double-click-edit").isChecked());
  await page.evaluate(() => {
    Storage.prototype.setItem = window.savedSetItem;
  });
  await page.locator("#setting-double-click-edit").uncheck();
  await page.locator("#settings-close").click();
  // Version 14 records migrate to off without rewriting on load.
  const legacy = await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem("mdmd.settings"));
    value.schemaVersion = 14;
    delete value.doubleClickEdit;
    const raw = JSON.stringify(value);
    localStorage.setItem("mdmd.settings", raw);
    return raw;
  });
  page = await restart();
  await open();
  await settings();
  assert.equal(
    await page.locator("#setting-double-click-edit").isChecked(),
    false,
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("mdmd.settings")),
    legacy,
  );
  await page.locator("#settings-close").click();
  await page.locator("#preview h1").first().dblclick();
  assert.equal(await page.locator(".inline-editor").count(), 0);
  assert.equal((await native()).content, normalized);
  assert.equal(await readFile(file, "utf8"), normalized);
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: demo compatibility and newline recovery, table and flow drafts, directly edit sequence actor/message/note, add participant/message/note, apply/cancel/undo/redo and source preservation.",
  );
  return page;
}
