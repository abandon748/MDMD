import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  symlink,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { testInsertionPosition } from "./insertion-position.test.mjs";

export async function testAttachments({
  page,
  root,
  dialog,
  waitFor,
  restart,
}) {
  await testInsertionPosition({ page, root, dialog, waitFor });
  const dir = path.join(root, "attachments");
  await mkdir(dir);
  const file = path.join(dir, "附件 中文.md");
  const png = path.join(dir, "图片 空格.png");
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(png, bytes);
  await writeFile(file, "\ufeff# Attachments\r\n\r\n");
  const state = () =>
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("document_state"));
  const expect = (value) =>
    waitFor(async () => (await state()).content === value, "attachment source");
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  const refresh = async () => {
    await page.locator("#refresh").click();
  };
  async function edit(value) {
    await page.locator("#editor .cm-content").fill(value);
    await page.keyboard.press("Control+End");
    await expect(value);
  }
  async function open(value) {
    await page
      .locator(
        (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
      )
      .click();
    await dialog(value);
    await idle();
  }
  async function paste(data = bytes.toString("base64")) {
    await page.locator("#editor .cm-content").evaluate((node, base64) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(
          [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
          "clipboard.png",
          { type: "image/png" },
        ),
      );
      node.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
    }, data);
    await idle();
  }
  await open(file);
  await page.locator("#split-mode").click();
  await edit("# Attachments\n\n");
  await page.locator("#insert-image").click();
  await dialog("", true);
  await idle();
  await expect("# Attachments\n\n");
  assert.deepEqual(await readdir(dir), ["图片 空格.png", "附件 中文.md"]);
  await page.locator("#insert-image").click();
  await dialog(png);
  await idle();
  const first = (await state()).content;
  assert.match(first, /!\[图片\]\(assets\/image-[a-f0-9-]+\.png\)/);
  const assets = path.join(dir, "assets");
  assert.deepEqual(
    await readFile(path.join(assets, (await readdir(assets))[0])),
    bytes,
  );
  await page.keyboard.press("Control+z");
  await expect("# Attachments\n\n");
  await page.keyboard.press("Control+y");
  await expect(first);
  await paste();
  const second = (await state()).content;
  assert.equal((second.match(/!\[/g) || []).length, 2);
  assert.equal((await readdir(assets)).length, 2);
  await page.locator("#save").click();
  await idle();
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" + second.replaceAll("\n", "\r\n"),
  );
  await refresh();
  await waitFor(
    () =>
      page
        .locator("#preview img")
        .first()
        .evaluate((img) => img.naturalWidth === 1),
    "image render",
  );
  await page
    .locator("#preview img")
    .first()
    .evaluate((img) => img.click());
  await page.locator("#image-dialog[open]").waitFor();
  await page.locator("#image-scale").fill("400");
  assert.equal(await page.locator("#image-percent").innerText(), "400%");
  await page.setViewportSize({ width: 640, height: 720 });
  await page.screenshot({
    path: path.join(root, "attachments-viewer-640.png"),
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1320, height: 860 });
  await expect(second);
  // Invalid clipboard, stale native session and junctions never overwrite content/files.
  await paste(Buffer.from("not an image").toString("base64"));
  await expect(second);
  assert.equal((await readdir(assets)).length, 2);
  assert.match(
    await page.evaluate(async (data) => {
      try {
        await window.__TAURI_INTERNALS__.invoke("import_image", {
          id: "stale",
          revision: 0,
          data,
        });
        return "accepted";
      } catch (e) {
        return String(e);
      }
    }, bytes.toString("base64")),
    /stale/,
  );
  await mkdir(path.join(root, "outside-assets"));
  await symlink(
    path.join(root, "outside-assets"),
    path.join(dir, "junction"),
    "junction",
  );
  await writeFile(path.join(root, "outside-assets", "a.md"), "# Outside");
  const linkText =
    "# Links\n\n[child](子目录/目标%20文档.md#目标) [self](#links) [missing](missing.md) [outside](../outside.md) [junction](junction/a.md) [web](https://example.com/a#part)\n";
  await mkdir(path.join(dir, "子目录"));
  await writeFile(
    path.join(dir, "子目录", "目标 文档.md"),
    "# 目标\n\nDestination",
  );
  await edit(linkText);
  await refresh();
  await page.locator("#preview a").filter({ hasText: "child" }).click();
  await page.locator('button[value="cancel"]').click();
  await idle();
  await expect(linkText);
  await page.locator("#save").click();
  await idle();
  for (const label of ["missing", "outside", "junction"]) {
    const id = (await state()).id;
    await page.locator("#preview a").filter({ hasText: label }).click();
    await idle();
    assert.equal((await state()).id, id);
    await expect(linkText);
    assert(await page.locator("#error").isVisible());
  }
  // Dispatch to OS boundary without opening a user's browser during the regression.
  await page.evaluate(() => {
    window.testLinkFetch = window.fetch;
    window.fetch = async (input, init) => {
      if (
        String(input) ===
        window.__TAURI_INTERNALS__.convertFileSrc("open_web_link", "ipc")
      ) {
        window.testLinkUrl = JSON.parse(init.body).url;
        return new Response("null", {
          headers: {
            "Content-Type": "application/json",
            "Tauri-Response": "ok",
          },
        });
      }
      return window.testLinkFetch(input, init);
    };
  });
  await page.locator("#preview a").filter({ hasText: "web" }).click();
  await waitFor(
    () => page.evaluate(() => !!window.testLinkUrl),
    "web dispatch",
  );
  assert.equal(
    await page.evaluate(() => window.testLinkUrl),
    "https://example.com/a#part",
  );
  await page.evaluate(() => {
    window.fetch = window.testLinkFetch;
  });
  assert.match(
    await page.evaluate(async () => {
      const s = await window.__TAURI_INTERNALS__.invoke("document_state");
      try {
        await window.__TAURI_INTERNALS__.invoke("open_web_link", {
          id: s.id,
          url: "file:///C:/bad.exe",
        });
        return "accepted";
      } catch (e) {
        return String(e);
      }
    }),
    /preview-url/,
  );
  await page.locator("#preview a").filter({ hasText: "child" }).click();
  await idle();
  await expect("# 目标\n\nDestination");
  assert.match((await state()).path, /目标 文档\.md$/);
  await open(file);
  // Ordinary inline drafts can import; cancel retains main source and orphan asset intentionally.
  await page.locator("#read-mode").click();
  await refresh();
  await page.locator("#preview h1").click();
  await page.locator("#inline-mode").click();
  await page.locator("#insert-image").click();
  await dialog(png);
  await idle();
  assert.match(
    await page.locator("#inline-source .cm-content").innerText(),
    /assets\/image-/,
  );
  await expect(linkText);
  await page.locator("#inline-cancel").click();
  await expect(linkText);
  assert.equal((await readdir(assets)).length, 3);
  // Imported source uses the same auto-save and external conflict protection.
  await page.locator("#split-mode").click();
  await page.locator("#document-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#setting-autosave").check();
  await page.locator("#settings-close").click();
  await page.locator("#editor .cm-content").focus();
  await page.keyboard.press("Control+End");
  await paste();
  await page.locator('#save-status[data-state="saved"]').waitFor();
  const saved = (await state()).content;
  assert.equal(
    await readFile(file, "utf8"),
    "\ufeff" + saved.replaceAll("\n", "\r\n"),
  );
  await page.locator("#document-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#setting-autosave").uncheck();
  await page.locator("#settings-close").click();
  await paste();
  const conflict = (await state()).content;
  await writeFile(file, "EXTERNAL");
  await page.locator("#save").click();
  await idle();
  await expect(conflict);
  assert.equal(await readFile(file, "utf8"), "EXTERNAL");
  await page.locator("#home-back").click();
  await page.locator('button[value="discard"]').click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  // A blocked assets location and an untitled document do not create a source edit.
  const blocked = path.join(dir, "blocked");
  await mkdir(blocked);
  await writeFile(path.join(blocked, "assets"), "keep");
  await writeFile(path.join(blocked, "a.md"), "# Blocked");
  await open(path.join(blocked, "a.md"));
  await page.locator("#split-mode").click();
  await paste();
  await expect("# Blocked");
  assert.equal(await readFile(path.join(blocked, "assets"), "utf8"), "keep");
  await page.keyboard.press("Control+n");
  await idle();
  await page.locator("#insert-image").click();
  await expect("");
  assert.match(await page.locator("#error-text").innerText(), /先保存/);
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await unlink(path.join(dir, "junction"));
  await page.evaluate(() => localStorage.clear());
  page = await restart();
  console.log(
    "PASS: image dialog cancel/import, clipboard copy, unique attachments, undo/redo, BOM/CRLF save, image viewer, invalid/stale/junction/blocked paths, Markdown links with cancel/failure/reopen, browser dispatch/unsafe scheme rejection, inline cancel and untitled guard. Browser launch itself is not automated.",
  );
  console.log("Attachment evidence:", root);
  return page;
}
