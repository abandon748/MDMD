import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export async function testTitleFormat({
  page,
  root,
  dialog,
  restart,
  waitFor,
  nativeTitle,
}) {
  const raw = () => page.evaluate(() => localStorage.getItem("mdmd.settings"));
  const stored = async () => JSON.parse(await raw());
  const ready = () => page.locator("#home-open:not([disabled])").waitFor();
  const settings = async () => {
    await page
      .locator(
        (await page.locator("#home").isVisible())
          ? "#home-settings"
          : "#document-settings",
      )
      .click();
    await page.locator("#settings-general").click();
  };
  const close = () => page.locator("#settings-close").click();
  const select = async (value) => {
    await page.locator("#setting-title-format").selectOption(value);
    await page.locator("#setting-title-format:not([disabled])").waitFor();
  };
  const title = (expected) =>
    waitFor(
      async () => (await nativeTitle()) === expected,
      `native title: ${expected}`,
    );
  const load = async (value) => {
    await page.evaluate(
      (value) =>
        value === null
          ? localStorage.removeItem("mdmd.settings")
          : localStorage.setItem("mdmd.settings", value),
      value,
    );
    await page.reload();
    await ready();
  };
  await ready();
  await title("MDMD");
  await settings();
  assert.equal(await raw(), null);
  assert.equal(
    await page.locator("#setting-title-format").inputValue(),
    "path",
  );
  assert.deepEqual(
    await page.locator("#setting-title-format option").allTextContents(),
    ["路径 + 文件名", "仅文件名"],
  );
  await page.keyboard.press("Escape");
  assert.equal(await raw(), null);
  await settings();
  await select("name");
  assert.equal((await stored()).schemaVersion, 16);
  assert.equal((await stored()).titleFormat, "name");
  await title("MDMD");
  const base = await stored();
  await close();
  // Read-only legacy migration: format is new; old CSS and other settings survive.
  const legacy = {
    ...base,
    schemaVersion: 9,
    theme: "dark",
    customCss: { enabled: true, source: "h1 { color: #123456; }" },
  };
  delete legacy.titleFormat;
  await load(JSON.stringify(legacy));
  await settings();
  assert.equal(await raw(), JSON.stringify(legacy));
  assert.equal(
    await page.locator("#setting-title-format").inputValue(),
    "path",
  );
  await select("name");
  assert.deepEqual((await stored()).customCss, legacy.customCss);
  assert.equal((await stored()).theme, "dark");
  await close();
  const dir = path.join(root, "title-fixtures");
  await mkdir(path.join(dir, "子目录"), { recursive: true });
  const file = path.join(dir, "中文 空格.md");
  const original = "# 标题测试\n\n正文。\n";
  await writeFile(file, original);
  await page.locator("#home-open").click();
  await dialog(file);
  await page.locator("#preview h1").waitFor();
  await title("中文 空格.md — MDMD");
  await page.locator("#split-mode").click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n标题草稿");
  await title("● 中文 空格.md — MDMD");
  const draft = await page.locator(".cm-line").allTextContents();
  await page.evaluate(() => {
    window.titleNode = document.querySelector("#preview h1");
  });
  await settings();
  await select("path");
  await title(`● ${file} — MDMD`);
  assert.equal(await page.locator("#filepath").textContent(), file);
  assert.deepEqual(await page.locator(".cm-line").allTextContents(), draft);
  assert(
    await page.evaluate(
      () => window.titleNode === document.querySelector("#preview h1"),
    ),
  );
  assert.equal(await readFile(file, "utf8"), original);
  // Storage failure must restore the native title, dropdown and old record.
  const before = await raw();
  await page.evaluate(() => {
    window.titleSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "mdmd.settings")
        throw new DOMException("test quota", "QuotaExceededError");
      return window.titleSet.call(this, k, v);
    };
  });
  await select("name");
  assert.match(await page.locator("#settings-message").innerText(), /保存失败/);
  assert.equal(await raw(), before);
  assert.equal(
    await page.locator("#setting-title-format").inputValue(),
    "path",
  );
  await title(`● ${file} — MDMD`);
  await page.evaluate(() => {
    Storage.prototype.setItem = window.titleSet;
  });
  // Native application failure never writes a new preference.
  await page.evaluate(() => {
    window.titleFetch = window.fetch;
    window.titleFailureInjected = false;
    window.fetch = (input, init) => {
      if (
        String(input) ===
        window.__TAURI_INTERNALS__.convertFileSrc("set_title_format", "ipc")
      ) {
        window.titleFailureInjected = true;
        return Promise.resolve(
          new Response(JSON.stringify("test native failure"), {
            headers: {
              "Content-Type": "application/json",
              "Tauri-Response": "error",
            },
          }),
        );
      }
      return window.titleFetch(input, init);
    };
  });
  await select("name");
  assert.match(await page.locator("#settings-message").innerText(), /未完成/);
  assert.equal(await raw(), before);
  await title(`● ${file} — MDMD`);
  await page.evaluate(() => {
    window.fetch = window.titleFetch;
  });
  await select("name");
  await title("● 中文 空格.md — MDMD");
  const invalid = await page.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke("set_title_format", {
        format: "arbitrary",
      });
      return false;
    } catch {
      return true;
    }
  });
  assert(invalid);
  await title("● 中文 空格.md — MDMD");
  await page.setViewportSize({ width: 640, height: 720 });
  assert(await page.locator("#setting-title-format").isVisible());
  assert(
    await page
      .locator("#settings-dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  const selectGeometry = await page
    .locator("#setting-title-format")
    .evaluate((e) => {
      const box = e.getBoundingClientRect(),
        row = e.parentElement.getBoundingClientRect();
      return { height: box.height, right: box.right, rowRight: row.right };
    });
  assert(selectGeometry.height >= 32);
  assert(Math.abs(selectGeometry.right - selectGeometry.rowRight) < 2);
  await page.screenshot({
    path: path.join(root, "title-format-general-640.png"),
  });
  await close();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await title("中文 空格.md — MDMD");
  await page.locator("#save-as").click();
  await dialog("", true);
  await title("中文 空格.md — MDMD");
  await settings();
  await select("path");
  await close();
  const renamed = path.join(dir, "子目录", "另存.md");
  await page.locator("#save-as").click();
  await dialog(renamed);
  await title(`${renamed} — MDMD`);
  assert.equal(await readFile(renamed, "utf8"), original);
  await page.locator("#home-back").click();
  await ready();
  await title("MDMD");
  for (const format of ["name", "path"]) {
    await settings();
    await select(format);
    await close();
    const persistent = await raw();
    page = await restart();
    await ready();
    assert.equal(await raw(), persistent);
    await title("MDMD");
    await page.locator("#home-open").click();
    await dialog(renamed);
    await title(`${format === "path" ? renamed : "另存.md"} — MDMD`);
    await page.locator("#home-back").click();
    await ready();
  }
  // Invalid current records remain untouched; explicit correction is permitted.
  for (const value of [undefined, null, 42, "other"]) {
    const broken = JSON.stringify({ ...base, titleFormat: value });
    await load(broken);
    await settings();
    assert.equal(await raw(), broken);
    assert.equal(
      await page.locator("#setting-title-format").inputValue(),
      "path",
    );
    assert.match(
      await page.locator("#settings-message").innerText(),
      /读取失败/,
    );
    await close();
  }
  await load('{"schemaVersion":99}');
  await settings();
  assert(await page.locator("#setting-title-format").isDisabled());
  assert.equal(await raw(), '{"schemaVersion":99}');
  await close();
  await load(null);
  await page.setViewportSize({ width: 1320, height: 860 });
  console.log("Title format evidence:", root);
  console.log(
    "PASS: path/name defaults, real native title + dirty/undo/save-as/cancel/home, scoped state preservation, schema9 migration and CSS retention, storage/native failure rollback and retry, invalid IPC/records and future protection, narrow general settings, actual process restart in both formats.",
  );
  return page;
}
