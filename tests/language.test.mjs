import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export async function testLanguage({ page, root, dialog, restart, waitFor }) {
  const raw = () => page.evaluate(() => localStorage.getItem("mdmd.settings"));
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
    await page.locator("#setting-language").selectOption(value);
    await page.locator("#setting-language:not([disabled])").waitFor();
  };
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
  const systemLocale = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("set_ui_language", {
      language: "system",
    }),
  );
  assert(["zh-CN", "en"].includes(systemLocale));
  assert.equal(await page.locator("html").getAttribute("lang"), systemLocale);
  await settings();
  assert.equal(await raw(), null);
  assert.equal(await page.locator("#setting-language").inputValue(), "system");
  assert.deepEqual(
    await page
      .locator("#setting-language option")
      .evaluateAll((nodes) => nodes.map((n) => n.value)),
    ["system", "zh-CN", "en"],
  );
  await select("en");
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(
    await page.locator("#settings-section-title").innerText(),
    "General",
  );
  assert.match(await page.locator("#home-open").innerText(), /Open file/);
  assert.equal(await page.locator("#settings-message").innerText(), "Saved");
  const base = JSON.parse(await raw());
  assert.equal(base.language, "en");
  assert.equal(base.schemaVersion, 16);
  await page.screenshot({ path: path.join(root, "language-en-general.png") });
  await page.setViewportSize({ width: 640, height: 720 });
  assert(
    await page
      .locator("#settings-dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  assert(await page.locator("#setting-language").isVisible());
  await page.screenshot({
    path: path.join(root, "language-en-general-640.png"),
  });
  await close();
  await page.setViewportSize({ width: 1320, height: 860 });
  await page.screenshot({ path: path.join(root, "language-en-home.png") });
  await page.locator("#home-new").click();
  await dialog("", true, [
    "-ExpectedTitle",
    "New Markdown file",
    "-ExpectedFileName",
    "Untitled.md",
  ]);
  await ready();
  await page.locator("#home-folder").click();
  await dialog("", true, ["-ExpectedTitle", "Open Markdown folder"]);
  await ready();
  page = await restart();
  await ready();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.deepEqual(JSON.parse(await raw()), base);
  // Names and document contents deliberately overlap UI message keys.
  const file = path.join(root, "设置.md"),
    original = "# 设置\n\n## 默认\n\n今天 收藏\n\n```text\n打开文件\n```\n";
  await writeFile(file, original);
  await page.locator("#home-open").click();
  await dialog(file, false, ["-ExpectedTitle", "Open Markdown file"]);
  await page.locator("#preview h1").waitFor();
  assert.equal(await page.locator("#filename").innerText(), "设置.md");
  assert.equal(await page.locator("#preview h1").innerText(), "设置");
  await page.locator("#split-mode").click();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n草稿保留");
  await waitFor(
    async () =>
      (await page.locator("#preview").innerText()).includes("草稿保留"),
    "draft preview",
  );
  const draft = await page.locator(".cm-line").allTextContents();
  await page.locator(".outline-toggle:not([hidden])").first().click();
  await page.evaluate(() => {
    window.languageHeading = document.querySelector("#preview h1");
  });
  await settings();
  await select("zh-CN");
  assert.equal(
    await page.locator("#settings-section-title").innerText(),
    "通用",
  );
  assert.equal(
    await page.locator("#save-status").innerText(),
    "有未保存的修改",
  );
  assert.deepEqual(await page.locator(".cm-line").allTextContents(), draft);
  assert(
    await page.evaluate(
      () => window.languageHeading === document.querySelector("#preview h1"),
    ),
  );
  assert.equal(
    await page
      .locator(".outline-toggle:not([hidden])")
      .first()
      .getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(await readFile(file, "utf8"), original);
  const before = await raw();
  await page.evaluate(() => {
    window.languageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "mdmd.settings")
        throw new DOMException("test quota", "QuotaExceededError");
      return window.languageSet.call(this, k, v);
    };
  });
  await select("en");
  assert.equal(await raw(), before);
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
  assert.match(await page.locator("#settings-message").innerText(), /保存失败/);
  await page.evaluate(() => {
    Storage.prototype.setItem = window.languageSet;
  });
  await close();
  await page.locator("#save-as").click();
  await dialog("", true, ["-ExpectedTitle", "另存 Markdown 文件"]);
  await settings();
  await page.evaluate(() => {
    window.languageFetch = window.fetch;
    window.fetch = (input, init) =>
      String(input) ===
      window.__TAURI_INTERNALS__.convertFileSrc("set_ui_language", "ipc")
        ? Promise.resolve(
            new Response(JSON.stringify("test native failure"), {
              headers: {
                "Content-Type": "application/json",
                "Tauri-Response": "error",
              },
            }),
          )
        : window.languageFetch(input, init);
  });
  await select("en");
  assert.equal(await raw(), before);
  assert.equal(await page.locator("#setting-language").inputValue(), "zh-CN");
  assert.match(
    await page.locator("#settings-message").innerText(),
    /语言未应用/,
  );
  await page.evaluate(() => {
    window.fetch = window.languageFetch;
  });
  await select("en");
  assert.equal(
    await page.locator("#save-status").innerText(),
    "Unsaved changes",
  );
  await page.locator("#settings-shortcuts").click();
  assert.equal(await page.locator("#shortcut-list .shortcut-row").count(), 22);
  await page.locator("#shortcut-save").click();
  await page.keyboard.press("Control+o");
  assert.match(
    await page.locator("#shortcut-message").innerText(),
    /Open file/,
  );
  await page.keyboard.press("Escape");
  await close();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () => (await page.locator("#save-status").innerText()) === "Saved",
    "undo survives language switch",
  );
  await page.locator("#home-back").click();
  await ready();
  // Focus re-resolves system UI language without persisting an effective locale.
  await settings();
  await select("system");
  const systemRaw = await raw();
  await page.evaluate(() => {
    window.languageFetch = window.fetch;
    window.languageSystemMock = "en";
    window.fetch = (input, init) =>
      String(input) ===
      window.__TAURI_INTERNALS__.convertFileSrc("set_ui_language", "ipc")
        ? Promise.resolve(
            new Response(JSON.stringify(window.languageSystemMock), {
              headers: {
                "Content-Type": "application/json",
                "Tauri-Response": "ok",
              },
            }),
          )
        : window.languageFetch(input, init);
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(
    async () => (await page.locator("html").getAttribute("lang")) === "en",
    "system English",
  );
  await page.locator("#setting-language:not([disabled])").waitFor();
  assert.equal(await raw(), systemRaw);
  await page.evaluate(() => {
    window.languageSystemMock = "zh-CN";
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(
    async () => (await page.locator("html").getAttribute("lang")) === "zh-CN",
    "system Chinese",
  );
  await page.locator("#setting-language:not([disabled])").waitFor();
  assert.equal(await raw(), systemRaw);
  await page.evaluate(() => {
    window.fetch = window.languageFetch;
  });
  await select("zh-CN");
  await close();
  page = await restart();
  await ready();
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
  // The preference is only written on explicit changes, including legacy migration.
  const legacy = { ...base, schemaVersion: 10, language: undefined };
  await load(JSON.stringify(legacy));
  await settings();
  assert.equal(await page.locator("#setting-language").inputValue(), "system");
  assert.equal(await raw(), JSON.stringify(legacy));
  await select("en");
  assert.deepEqual(JSON.parse(await raw()), base);
  await close();
  for (const language of [undefined, null, "fr", 1]) {
    const broken = JSON.stringify({ ...base, language });
    await load(broken);
    await settings();
    assert.equal(await raw(), broken);
    assert.equal(
      await page.locator("#setting-language").inputValue(),
      "system",
    );
    assert(
      await page
        .locator("#settings-message")
        .evaluate((e) => e.classList.contains("settings-error")),
    );
    await close();
  }
  await load('{"schemaVersion":99}');
  await settings();
  assert(await page.locator("#setting-language").isDisabled());
  assert.equal(await raw(), '{"schemaVersion":99}');
  await close();
  assert(
    await page.evaluate(async () => {
      try {
        await window.__TAURI_INTERNALS__.invoke("set_ui_language", {
          language: "fr",
        });
        return false;
      } catch {
        return true;
      }
    }),
  );
  await load(null);
  await writeFile(
    path.join(root, "language-results.json"),
    JSON.stringify(
      {
        systemLocale,
        passed: true,
        coverage: [
          "English/Chinese immediate UI and restart",
          "native titles and default filename",
          "draft/undo/preview/outline/name preservation",
          "storage/native failure rollback",
          "system focus resolution without writes",
          "schema10 read-only migration",
          "invalid/future records",
          "narrow layout",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: language selection, actual process restart, native dialogs, state preservation, failures, system refresh, settings migration and narrow layout.",
  );
  console.log("Language evidence:", root);
  return page;
}
