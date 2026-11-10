import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export async function testCustomCss({ page, root, dialog, restart, waitFor }) {
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
    await page.locator("#settings-appearance").click();
  };
  const edit = () => page.locator("#css-edit").click();
  const close = () => page.locator("#settings-close").click();
  const apply = () => page.locator("#css-apply").click();
  const source = (value) => page.locator("#css-source").fill(value);
  const enabled = (value) => page.locator("#css-enabled").setChecked(value);
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
  const shot = (name) =>
    page.screenshot({ path: path.join(root, `custom-css-${name}.png`) });
  const style = (selector, property) =>
    page
      .locator(selector)
      .evaluate((e, k) => getComputedStyle(e).getPropertyValue(k), property);
  await ready();
  await page.setViewportSize({ width: 1320, height: 860 });
  await settings();
  assert.equal(await raw(), null);
  assert(!(await page.locator("#setting-custom-css").isChecked()));
  await edit();
  assert.equal(await page.locator("#css-source").inputValue(), "");
  await source("h1 { color: red; }");
  await enabled(true);
  await page.keyboard.press("Escape");
  assert(await page.locator("#css-dialog").isHidden());
  assert(await page.locator("#settings-dialog").isVisible());
  assert.equal(await raw(), null);
  await edit();
  await source("h1 { color: #123456; }");
  await enabled(true);
  await apply();
  assert.equal((await stored()).schemaVersion, 16);
  assert.deepEqual((await stored()).customCss, {
    enabled: true,
    source: "h1 { color: #123456; }",
  });
  assert.notEqual(await style("#home h1", "color"), "rgb(18, 52, 86)");
  const base = await stored();
  await close();
  // schema 8 is migrated without rewriting or resetting existing appearance.
  const { customCss, ...legacy } = base;
  legacy.schemaVersion = 8;
  legacy.appearance.corners = "square";
  await load(JSON.stringify(legacy));
  await settings();
  assert.equal(await raw(), JSON.stringify(legacy));
  assert(!(await page.locator("#setting-custom-css").isChecked()));
  await edit();
  await source("h1 { color: #123456; }");
  await enabled(true);
  await apply();
  assert.deepEqual((await stored()).appearance, legacy.appearance);
  await close();
  const data = path.join(root, "custom-css-fixtures");
  await mkdir(data);
  const file = path.join(data, "样式.md");
  const original =
    "# 自定义样式\n\n正文段落。\n\n## 二级\n\n```js\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n|1|2|\n";
  await writeFile(file, original);
  await page.locator("#home-open").click();
  await dialog(file);
  await page.locator("#preview h1").waitFor();
  assert.equal(await style("#preview h1", "color"), "rgb(18, 52, 86)");
  const toolbarColor = await style("#document-settings", "color");
  await page.locator("#split-mode").click();
  const editorColor = await style(".cm-content", "color");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nCSS 草稿");
  await waitFor(
    async () =>
      (await page.locator("#preview").innerText()).includes("CSS 草稿"),
    "draft preview",
  );
  const draft = await page.locator(".cm-line").allTextContents();
  await page.evaluate(() => {
    window.cssPreviewNode = document.querySelector("#preview h1");
  });
  await settings();
  await edit();
  const valid =
    "/* 正文局部样式 */\n.markdown-body { background-color: #f0f4f8; }\nh1, h2 { color: #654321; }\np { font-size: 22px; }\npre { border: 2px solid #123456; border-radius: 12px; }\n@media (max-width: 900px) { h1 { color: #abcdef; } }";
  await source(valid);
  await apply();
  assert(
    await page.locator("#css-dialog").isHidden(),
    await page.locator("#css-message").textContent(),
  );
  await close();
  assert.equal(
    await style("#preview", "background-color"),
    "rgb(240, 244, 248)",
  );
  assert.equal(await style("#preview h1", "color"), "rgb(101, 67, 33)");
  assert.equal(await style("#preview pre", "border-radius"), "12px");
  assert.equal(
    await style(".corner-preview-samples pre", "border-radius"),
    "0px",
    "custom document CSS must not affect settings sample",
  );
  assert.equal(await style("#document-settings", "color"), toolbarColor);
  assert.equal(await style(".cm-content", "color"), editorColor);
  assert(
    await page.evaluate(
      () => window.cssPreviewNode === document.querySelector("#preview h1"),
    ),
  );
  assert.deepEqual(await page.locator(".cm-line").allTextContents(), draft);
  assert.equal(await readFile(file, "utf8"), original);
  await page.setViewportSize({ width: 850, height: 650 });
  await waitFor(
    async () => (await style("#preview h1", "color")) === "rgb(171, 205, 239)",
    "media applies",
  );
  await shot("preview-850");
  await settings();
  await edit();
  await page.locator("#css-source").focus();
  await page.keyboard.press("Shift+Tab");
  assert(
    await page
      .locator("#css-apply")
      .evaluate((e) => e === document.activeElement),
  );
  await page.keyboard.press("Tab");
  assert(
    await page
      .locator("#css-source")
      .evaluate((e) => e === document.activeElement),
  );
  assert(
    await page
      .locator("#css-dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  await shot("editor-850");
  const before = await raw();
  const bad = [
    "not css",
    "h1 { nonsense: foo; }",
    "@import 'https://example.com/x.css';",
    "p { background-color: url(https://example.com/x); }",
    "h1 { position: fixed; }",
    "p { --escape: red; }",
    "@font-face { font-family: bad; src: local(Arial); }",
    "@keyframes x { from { color: red; } }",
    "p { color: red; span { color: blue; } }",
    "p::before { color: red; }",
    "p { color: r\\65 d; }",
    "</style><script>window.cssInjected=1</script>",
    "@media all {".repeat(5) + "p { color: red; }" + "}".repeat(5),
    "." + "x".repeat(1024) + " { color: red; }",
    "x".repeat(32769),
    Array.from({ length: 201 }, () => "p { color: red; }").join("\n"),
  ];
  const requests = [];
  page.on("request", (r) => {
    if (r.url().includes("example.com")) requests.push(r.url());
  });
  for (const css of bad) {
    // Programmatically set over-limit input to exercise the application boundary too.
    await page.locator("#css-source").evaluate((e, v) => {
      e.value = v;
    }, css);
    await apply();
    assert(await page.locator("#css-dialog").isVisible(), css);
    assert.match(await page.locator("#css-message").innerText(), /CSS 未应用/);
    assert.equal(await raw(), before);
    assert.equal(await style("#preview h1", "color"), "rgb(171, 205, 239)");
  }
  assert.equal(requests.length, 0);
  assert.equal(await page.evaluate(() => window.cssInjected), undefined);
  await source("* { color: #112233 !important; }");
  await page.evaluate(() => {
    window.cssSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "mdmd.settings")
        throw new DOMException("test quota", "QuotaExceededError");
      return window.cssSet.call(this, k, v);
    };
  });
  await apply();
  assert.match(await page.locator("#css-message").innerText(), /保存失败/);
  assert.equal(await raw(), before);
  await page.locator("#css-cancel").click();
  await page.locator("#setting-custom-css").click();
  assert(await page.locator("#setting-custom-css").isChecked());
  await page.evaluate(() => {
    Storage.prototype.setItem = window.cssSet;
  });
  await edit();
  await source("* { color: #112233 !important; }");
  await apply();
  // Even universal !important selectors cannot reach the recovery controls.
  assert.equal(await style("#preview h1", "color"), "rgb(17, 34, 51)");
  assert.notEqual(await style("#settings-title", "color"), "rgb(17, 34, 51)");
  await edit();
  await page.locator("#css-default").click();
  await page.locator("#css-cancel").click();
  assert.equal(
    (await stored()).customCss.source,
    "* { color: #112233 !important; }",
  );
  await page.locator("#setting-custom-css").uncheck();
  assert.equal(
    (await stored()).customCss.source,
    "* { color: #112233 !important; }",
  );
  assert.notEqual(await style("#preview h1", "color"), "rgb(17, 34, 51)");
  await page.locator("#setting-custom-css").check();
  await edit();
  await source(".markdown-body { display: none; }");
  await apply();
  assert(await page.locator("#preview").isHidden());
  await page.locator("#setting-custom-css").uncheck();
  assert(await page.locator("#preview").isVisible());
  await edit();
  await source("* { color: #112233 !important; }");
  await enabled(true);
  await apply();
  await close();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () =>
      !(await page.locator(".cm-content").innerText()).includes("CSS 草稿"),
    "undo retained",
  );
  await page.locator("#home-back").click();
  if (await page.locator("#confirm-dialog").isVisible())
    await page.locator("button[value=discard]").click();
  await ready();
  const persistent = await raw();
  page = await restart();
  await ready();
  assert.equal(await raw(), persistent);
  await page.locator("#home-open").click();
  await dialog(file);
  await page.locator("#preview h1").waitFor();
  assert.equal(await style("#preview h1", "color"), "rgb(17, 34, 51)");
  await page.locator("#home-back").click();
  await ready();
  const invalid = {
    ...(await stored()),
    theme: "dark",
    customCss: { enabled: true, source: "h1 { position: fixed; }" },
  };
  const text = JSON.stringify(invalid);
  await load(text);
  await settings();
  assert(await page.locator("#theme-dark").isChecked());
  assert(!(await page.locator("#setting-custom-css").isChecked()));
  assert.match(
    await page.locator("#settings-message").innerText(),
    /CSS 已停用/,
  );
  assert.equal(await raw(), text);
  await page.locator("#setting-custom-css").click();
  assert(!(await page.locator("#setting-custom-css").isChecked()));
  assert.equal(await raw(), text);
  await edit();
  assert.equal(
    await page.locator("#css-source").inputValue(),
    invalid.customCss.source,
  );
  await page.locator("#css-default").click();
  await apply();
  assert.deepEqual((await stored()).customCss, { enabled: false, source: "" });
  assert.equal((await stored()).theme, "dark");
  await close();
  for (const css of [
    { enabled: "yes", source: "" },
    { enabled: true, source: null },
    { enabled: false, source: "x".repeat(32769) },
  ]) {
    const rawInvalid = JSON.stringify({ ...base, customCss: css });
    await load(rawInvalid);
    await settings();
    assert.equal(await raw(), rawInvalid);
    assert.match(
      await page.locator("#settings-message").innerText(),
      /读取失败/,
    );
    assert(!(await page.locator("#setting-custom-css").isChecked()));
    await close();
  }
  await load('{"schemaVersion":99}');
  await settings();
  for (const id of ["css-edit", "setting-custom-css"])
    assert(await page.locator(`#${id}`).isDisabled());
  assert.equal(await raw(), '{"schemaVersion":99}');
  await close();
  await load(null);
  console.log("Custom CSS evidence:", root);
  console.log(
    "PASS: scoped CSS/root/list/media, draft apply/cancel/reset/disable, style+storage rollback, denied rules/resources/escapes and limits, no network/script, editor+file+undo preservation, focus/narrow dialog, schema8 migration, invalid CSS recovery without other settings loss, actual EXE restart, future schema preservation.",
  );
  return page;
}
