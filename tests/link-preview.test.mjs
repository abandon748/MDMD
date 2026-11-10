import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import path from "node:path";

export async function testLinkPreview({
  page,
  root,
  dialog,
  restart,
  waitFor,
}) {
  const requests = [];
  let recovered = false;
  const server = createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Set-Cookie", "secret=must-not-return");
    if (req.url === "/redirect" || req.url === "/loop") {
      res.writeHead(302, { Location: req.url === "/loop" ? "/loop" : "/good" });
      return res.end();
    }
    if (req.url === "/failure" && !recovered) {
      res.writeHead(503);
      return res.end("not ready");
    }
    if (req.url === "/binary") res.setHeader("Content-Type", "application/pdf");
    if (req.url === "/large") return res.end("x".repeat(1024 * 1024 + 1));
    if (req.url === "/empty") return res.end("<p>No metadata</p>");
    if (req.url === "/timeout") return; // WinHTTP receive timeout; socket closed in finally.
    const html = `<html><head><title>Fallback title</title><meta property="og:title" content="网页 &amp; 标题"><meta name="description" content="摘要 &lt;b&gt;纯文本&lt;/b&gt;"></head><body><script>window.hoverInjected=true</script><img src="http://127.0.0.1:${server.address().port}/forbidden-image"></body></html>`;
    if (req.url === "/slow") return setTimeout(() => res.end(html), 1300);
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const dir = path.join(root, "preview-docs"),
    file = path.join(dir, "main.md");
  await mkdir(path.join(dir, "子目录"), { recursive: true });
  await writeFile(
    path.join(dir, "子目录", "目标.md"),
    "\ufeff# 本地标题\n\n第一段 **加粗** ![不加载](secret.png)\n\n## 重名\n\n第一处摘录\n\n## 重名\n\n第二处摘录\n",
  );
  await writeFile(path.join(dir, "empty.md"), "");
  await writeFile(path.join(dir, "bad.md"), Buffer.from([255, 0]));
  await writeFile(path.join(dir, "large.md"), "x".repeat(256 * 1024 + 1));
  await writeFile(path.join(root, "outside.md"), "# 不允许摘录");
  await symlink(
    path.join(dir, "子目录"),
    path.join(dir, "junction"),
    "junction",
  );
  const links = {
    local: "子目录/目标.md",
    duplicate: "子目录/目标.md#重名",
    missingAnchor: "子目录/目标.md#不存在",
    self: "#当前标题",
    selfFile: "main.md#当前标题",
    missing: "missing.md",
    empty: "empty.md",
    encoding: "bad.md",
    bigLocal: "large.md",
    outside: "../outside.md",
    junction: "junction/目标.md",
    web: `${url}/good?q=1#fragment`,
    redirect: `${url}/redirect`,
    loop: `${url}/loop`,
    failure: `${url}/failure`,
    binary: `${url}/binary`,
    bigWeb: `${url}/large`,
    noMeta: `${url}/empty`,
    slow: `${url}/slow`,
    timeout: `${url}/timeout`,
    mail: "mailto:test@example.com",
  };
  const original =
    "# 当前标题\n\n当前正文\n\n" +
    Object.entries(links)
      .map(([name, href]) => `[${name}](${href})`)
      .join(" · ") +
    "\n";
  await writeFile(file, original);
  const ready = () => page.locator("#home-open:not([disabled])").waitFor();
  const raw = () => page.evaluate(() => localStorage.getItem("mdmd.settings"));
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
  const load = async (value) => {
    await page.evaluate(
      (v) =>
        v === null
          ? localStorage.removeItem("mdmd.settings")
          : localStorage.setItem("mdmd.settings", v),
      value,
    );
    await page.reload();
    await ready();
  };
  const open = async () => {
    await page.locator("#home-open").click();
    await dialog(file);
    await page.locator("#preview h1").waitFor();
  };
  const hover = async (name) => {
    console.log("Preview check:", name);
    await page.keyboard.press("Escape");
    await page.mouse.move(2, 2);
    await page
      .locator("#preview a")
      .filter({ hasText: new RegExp(`^${name}$`) })
      .hover();
    await page.locator("#link-preview:not([hidden])").waitFor();
    await waitFor(
      async () =>
        !/正在加载|Loading/.test(
          await page.locator("#link-preview-content").innerText(),
        ),
      `preview ${name}`,
    );
  };
  const content = () => page.locator("#link-preview-content").innerText();
  try {
    await ready();
    await settings();
    assert.equal(await raw(), null);
    assert(await page.locator("#setting-link-preview").isChecked());
    await page.locator("#setting-language").selectOption("zh-CN");
    await page.locator("#setting-language:not([disabled])").waitFor();
    const base = JSON.parse(await raw());
    assert.equal(base.schemaVersion, 16);
    assert.equal(base.linkPreview, true);
    await close();
    await open();
    const history = await readFile(
      path.join(root, "app-data", "history.json"),
      "utf8",
    );
    assert.equal(
      requests.length,
      0,
      "opening a document must not prefetch links",
    );
    await hover("local");
    assert.equal(
      await page.locator("#link-preview-title").innerText(),
      "本地标题",
    );
    assert.match(await content(), /第一段 加粗/);
    assert(!/secret.png/.test(await content()));
    await page.locator("#link-preview-content").hover();
    await page.waitForTimeout(250);
    assert(await page.locator("#link-preview").isVisible());
    await page.screenshot({ path: path.join(root, "link-preview-local.png") });
    await page.keyboard.press("Escape");
    assert(await page.locator("#link-preview").isHidden());
    await hover("duplicate");
    assert.equal(await page.locator("#link-preview-title").innerText(), "重名");
    assert(
      (await content()).indexOf("第一处") < (await content()).indexOf("第二处"),
    );
    await hover("missingAnchor");
    assert.match(
      await page.locator("#link-preview-note").innerText(),
      /未找到/,
    );
    await hover("self");
    assert.equal(
      await page.locator("#link-preview-title").innerText(),
      "当前标题",
    );
    for (const [name, expected] of [
      ["missing", /不存在/],
      ["empty", /为空/],
      ["encoding", /UTF-8/],
      ["bigLocal", /过大/],
      ["outside", /目录内/],
      ["junction", /目录内/],
    ]) {
      await hover(name);
      assert.match(await content(), expected, name);
    }
    await hover("missing");
    await writeFile(path.join(dir, "missing.md"), "# 重试恢复\n\n新内容");
    await page.locator("#link-preview-retry").click();
    await waitFor(
      async () => (await content()).includes("新内容"),
      "local retry",
    );
    await hover("web");
    assert.equal(
      await page.locator("#link-preview-title").innerText(),
      "网页 & 标题",
    );
    assert.equal(await content(), "摘要 <b>纯文本</b>");
    assert.equal(await page.locator("#link-preview-content b").count(), 0);
    assert.equal(await page.evaluate(() => window.hoverInjected), undefined);
    assert(requests.some((r) => r.url === "/good?q=1"));
    assert(!requests.some((r) => r.url.includes("forbidden")));
    await page.screenshot({ path: path.join(root, "link-preview-web.png") });
    await hover("redirect");
    assert.equal(
      await page.locator("#link-preview-title").innerText(),
      "网页 & 标题",
    );
    for (const [name, expected] of [
      ["loop", /重定向/],
      ["failure", /返回错误/],
      ["binary", /类型/],
      ["bigWeb", /过大/],
      ["noMeta", /没有可用/],
      ["timeout", /超时/],
    ]) {
      await hover(name);
      assert.match(await content(), expected, name);
      assert(await page.locator("#link-preview-retry").isVisible());
    }
    await hover("failure");
    recovered = true;
    await page.locator("#link-preview-retry").click();
    await waitFor(async () => (await content()).includes("摘要"), "web retry");
    for (const r of requests)
      for (const h of ["cookie", "authorization", "referer"])
        assert.equal(r.headers[h], undefined, h);
    // A slower native response must never replace a newer target's result.
    await page.keyboard.press("Escape");
    await page.mouse.move(2, 2);
    await page.getByRole("link", { name: "slow", exact: true }).hover();
    await waitFor(
      () => requests.some((r) => r.url === "/slow"),
      "slow native request started",
    );
    await hover("local");
    assert.equal(
      await page.locator("#link-preview-title").innerText(),
      "本地标题",
    );
    await page.waitForTimeout(200);
    assert.equal(
      await page.locator("#link-preview-title").innerText(),
      "本地标题",
    );
    await page.keyboard.press("Escape");
    await page.mouse.move(2, 2);
    await page.getByRole("link", { name: "local", exact: true }).focus();
    await page.locator("#link-preview:not([hidden])").waitFor();
    await page.locator("#link-preview-close").click();
    assert(await page.locator("#link-preview").isHidden());
    await page.getByRole("link", { name: "mail", exact: true }).hover();
    await page.waitForTimeout(600);
    assert(await page.locator("#link-preview").isHidden());
    assert.equal(await readFile(file, "utf8"), original);
    assert.equal(
      await readFile(path.join(root, "app-data", "history.json"), "utf8"),
      history,
    );
    assert.equal(await page.locator("#filename").innerText(), "main.md");
    await page.locator("#split-mode").click();
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n\n草稿摘录");
    await waitFor(
      async () =>
        (await page.locator("#preview").innerText()).includes("草稿摘录"),
      "draft rendered",
    );
    await hover("self");
    assert.match(await content(), /草稿摘录/);
    await hover("selfFile");
    assert.match(await content(), /草稿摘录/);
    assert.equal(await readFile(file, "utf8"), original);
    await page.keyboard.press("Escape");
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+z");
    await waitFor(
      async () => (await page.locator("#save-status").innerText()) === "已保存",
      "undo preview draft",
    );
    await page.locator("#read-mode").click();
    const slowCount = requests.filter((r) => r.url === "/slow").length;
    await page.getByRole("link", { name: "slow", exact: true }).hover();
    await waitFor(
      () => requests.filter((r) => r.url === "/slow").length > slowCount,
      "request before disabling",
    );
    await settings();
    await page.locator("#setting-link-preview").uncheck();
    await close();
    assert.equal(JSON.parse(await raw()).linkPreview, false);
    const count = requests.length;
    await page.getByRole("link", { name: "web", exact: true }).hover();
    await page.waitForTimeout(600);
    assert(await page.locator("#link-preview").isHidden());
    assert.equal(requests.length, count);
    await page.waitForTimeout(1000);
    assert(await page.locator("#link-preview").isHidden());
    page = await restart();
    await ready();
    await settings();
    assert(!(await page.locator("#setting-link-preview").isChecked()));
    const before = await raw();
    await page.evaluate(() => {
      window.previewSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === "mdmd.settings")
          throw new DOMException("quota", "QuotaExceededError");
        return window.previewSet.call(this, k, v);
      };
    });
    await page.locator("#setting-link-preview").click();
    assert.equal(await raw(), before);
    assert(!(await page.locator("#setting-link-preview").isChecked()));
    assert.match(
      await page.locator("#settings-message").innerText(),
      /保存失败/,
    );
    await page.evaluate(() => {
      Storage.prototype.setItem = window.previewSet;
    });
    await page.locator("#setting-link-preview").check();
    await page.locator("#setting-language").selectOption("en");
    await page.locator("#setting-language:not([disabled])").waitFor();
    await page.screenshot({
      path: path.join(root, "link-preview-general.png"),
    });
    await page.locator("#settings-appearance").click();
    await page.locator("#theme-dark").check();
    await close();
    await open();
    await page.setViewportSize({ width: 640, height: 720 });
    await hover("local");
    const bounds = await page.locator("#link-preview").boundingBox();
    assert(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 640 &&
        bounds.y + bounds.height <= 720,
    );
    assert.match(
      await page.locator("#link-preview-note").innerText(),
      /Preview only/,
    );
    await page.screenshot({ path: path.join(root, "link-preview-en-640.png") });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1320, height: 860 });
    await page.mouse.move(2, 2);
    const switchingCount = requests.filter((r) => r.url === "/slow").length;
    await page.getByRole("link", { name: "slow", exact: true }).hover();
    await waitFor(
      () => requests.filter((r) => r.url === "/slow").length > switchingCount,
      "request before home",
    );
    await page.locator("#home-back").click();
    await ready();
    await page.waitForTimeout(1600);
    assert(await page.locator("#link-preview").isHidden());
    const legacy = JSON.stringify({
      ...base,
      schemaVersion: 11,
      linkPreview: undefined,
    });
    await load(legacy);
    await settings();
    assert(await page.locator("#setting-link-preview").isChecked());
    assert.equal(await raw(), legacy);
    await page.locator("#setting-link-preview").uncheck();
    assert.equal(JSON.parse(await raw()).schemaVersion, 16);
    await close();
    for (const linkPreview of [undefined, null, "false", 1]) {
      const bad = JSON.stringify({ ...base, linkPreview });
      await load(bad);
      await settings();
      assert.equal(await raw(), bad);
      assert(await page.locator("#setting-link-preview").isChecked());
      assert(
        await page
          .locator("#settings-message")
          .evaluate((e) => e.classList.contains("settings-error")),
      );
      await close();
    }
    await load('{"schemaVersion":99}');
    await settings();
    assert(await page.locator("#setting-link-preview").isDisabled());
    await close();
    await load(null);
    await writeFile(
      path.join(root, "link-preview-results.json"),
      JSON.stringify(
        {
          passed: true,
          requests,
          coverage: [
            "real native HTTP metadata/redirect/timeout/type/size/retry",
            "no cookies/credentials/referrer/scripts/subresources",
            "local UTF8/limits/empty/missing/junction/root boundary",
            "duplicate/missing/self anchors",
            "hover/keyboard/escape/card interaction",
            "stale responses",
            "no prefetch/history/write",
            "restart/storage failure/schema11 migration/invalid/future records",
            "English narrow viewport",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: link preview native HTTP/local files, failure/retry, stale results, keyboard, persistence/migration and narrow layout.",
    );
    console.log("Link preview evidence:", root);
    return page;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
