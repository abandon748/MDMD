import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, unlink, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
export async function engineFixture() {
  const specs = JSON.parse(await readFile("config/engines.lock.json", "utf8"));
  const cache = path.resolve("test-results/engine-fixtures");
  await mkdir(cache, { recursive: true });
  const files = new Map();
  for (const spec of specs)
    for (const file of spec.files) {
      if (files.has(file.sha256)) continue;
      let bytes;
      try {
        bytes = await readFile(path.join(cache, file.sha256));
      } catch {
        try {
          bytes = await readFile(
            path.join(
              "test-results/dev-03-engines-2026-10-24/download-fixtures",
              file.sha256,
            ),
          );
        } catch {
          const r = await fetch(file.url);
          assert(r.ok, file.url);
          bytes = Buffer.from(await r.arrayBuffer());
        }
      }
      assert.equal(bytes.length, file.bytes);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        file.sha256,
      );
      await writeFile(path.join(cache, file.sha256), bytes);
      files.set(file.sha256, bytes);
    }
  const control = { mode: "ok", requests: 0, specs };
  const server = createServer((req, res) => {
    control.requests++;
    const bytes = files.get(req.url.slice(1));
    if (!bytes || control.mode === "http") {
      res.writeHead(503);
      res.end();
      return;
    }
    if (control.mode === "corrupt") {
      res.end(Buffer.alloc(bytes.length, 32));
      return;
    }
    if (control.mode === "short") {
      res.end(bytes.subarray(0, 10));
      return;
    }
    if (control.mode === "slow") {
      res.writeHead(200);
      res.write(bytes.subarray(0, 1));
      setTimeout(() => res.end(bytes.subarray(1)), 1500).unref();
      return;
    }
    res.end(bytes);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return Object.assign(control, {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  });
}
export async function testEngines({
  page,
  root,
  restart,
  engineFixture: fixture,
}) {
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("ENGINE CONSOLE:", msg.text());
  });
  const wait = async (fn, label) => {
    for (let i = 0; i < 600; i++) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("Timed out: " + label);
  };
  const invoke = (command, args = {}) =>
    page.evaluate(
      ([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a),
      [command, args],
    );
  async function open() {
    await page.locator("#home-settings").click();
    await page.locator("#settings-general").click();
    await page.locator("#engines-manage").click();
    await idle();
  }
  async function idle() {
    await wait(
      () => page.locator("#engines-refresh").isEnabled(),
      "engines idle",
    );
  }
  async function download(id) {
    await page.locator(`#engine-${id}-download`).click();
    await idle();
    console.log(
      "ENGINE",
      id,
      new Date().toISOString(),
      await page.locator(`#engine-${id}-status`).innerText(),
      await page.locator(`#engine-${id}-error`).innerText(),
    );
  }
  async function ready(id) {
    assert.equal(
      await page.locator(`#engine-${id}-status`).innerText(),
      "已就绪",
      id,
    );
  }
  await open();
  assert.equal(await page.locator(".engine-row").count(), 5);
  for (const s of fixture.specs)
    assert.equal(
      await page.locator(`#engine-${s.id}-status`).innerText(),
      "未安装",
    );
  await assert.rejects(
    () => invoke("engine_action", { action: "download", id: "../../bad" }),
    /engine-id/,
  );
  await assert.rejects(
    () => invoke("engine_action", { action: "delete", id: "highlight" }),
    /engine-action/,
  );
  for (const s of fixture.specs) {
    await download(s.id);
    await ready(s.id);
  }
  await page.screenshot({ path: path.join(root, "engines-ready.png") });
  const cache = path.join(root, "app-data", "engines"),
    blob = path.join(cache, "blobs", fixture.specs[0].files[0].sha256);
  const before = await readFile(blob),
    names = await readdir(cache);
  for (const mode of ["http", "short", "corrupt"]) {
    fixture.mode = mode;
    await download("highlight");
    await ready("highlight");
    assert((await page.locator("#engine-highlight-error").innerText()).length);
    assert.deepEqual(await readFile(blob), before);
  }
  fixture.mode = "slow";
  await page.locator("#engine-highlight-download").click();
  await assert.rejects(
    () => invoke("engine_action", { action: "download", id: "katex" }),
    /engine-busy/,
  );
  await page.locator("#engines-cancel").click();
  await idle();
  await ready("highlight");
  assert.match(
    await page.locator("#engine-highlight-error").innerText(),
    /取消/,
  );
  fixture.mode = "ok";
  await writeFile(path.join(cache, "test-failure"), "commit");
  await download("highlight");
  await ready("highlight");
  assert.match(
    await page.locator("#engine-highlight-error").innerText(),
    /保存失败/,
  );
  await unlink(path.join(cache, "test-failure"));
  await page.evaluate(() => {
    const native = window.fetch;
    window.restoreEngineInvoke = () => {
      window.fetch = native;
    };
    window.fetch = async (input, init) => {
      const response = await native(input, init);
      if (
        String(input) !==
        window.__TAURI_INTERNALS__.convertFileSrc("engine_assets", "ipc")
      )
        return response;
      const value = await response.clone().json();
      if (
        !Array.isArray(value) ||
        !value.some((f) => f.path.includes("highlight"))
      )
        return response;
      value.find((f) => f.kind === "js").content = btoa(
        "window.hljs={highlight(){throw Error('load-test')}}",
      );
      return new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json", "Tauri-Response": "ok" },
      });
    };
  });
  await page.locator("#engines-refresh").click();
  await idle();
  assert.equal(
    await page.locator("#engine-highlight-status").innerText(),
    "失败",
  );
  await page.evaluate(() => {
    window.restoreEngineInvoke();
    delete window.restoreEngineInvoke;
  });
  await writeFile(blob, "bad");
  await page.locator("#engines-refresh").click();
  await idle();
  assert.equal(
    await page.locator("#engine-highlight-status").innerText(),
    "失败",
  );
  await assert.rejects(
    () => invoke("engine_assets", { id: "highlight" }),
    /engine-integrity/,
  );
  await download("highlight");
  await ready("highlight");
  assert.deepEqual(await readFile(blob), before);
  fixture.mode = "slow";
  await page.locator("#engine-highlight-download").click();
  await page.locator("#engines-close").click();
  await page.locator("#engines-manage").click();
  await idle();
  await ready("highlight");
  fixture.mode = "ok";
  assert.deepEqual((await readdir(cache)).sort(), names.sort());
  await page.locator("#engines-close").click();
  await page.locator("#settings-close").click();
  const requests = fixture.requests;
  fixture.mode = "http";
  page = await restart();
  await open();
  for (const s of fixture.specs) await ready(s.id);
  assert.equal(fixture.requests, requests, "offline checks must not download");
  await page.locator("#engines-close").click();
  await page.locator("#setting-language").selectOption("en");
  await page.locator("#engines-manage").click();
  await idle();
  assert.equal(
    await page.locator("#engines-title").innerText(),
    "Rendering engines",
  );
  assert.equal(
    await page.locator("#engine-highlight-status").innerText(),
    "Ready",
  );
  await page.setViewportSize({ width: 640, height: 720 });
  assert(
    await page
      .locator("#engines-dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  );
  await page.screenshot({ path: path.join(root, "engines-en-640.png") });
  await page.setViewportSize({ width: 1320, height: 860 });
  await page.locator("#engines-close").click();
  await page.locator("#setting-language").selectOption("zh-CN");
  await page.locator("#settings-close").click();
  fixture.mode = "ok";
  console.log(
    "PASS: engines pinned real assets, four sandbox render probes, whitelist, download/error/size/hash/retry, cancellation/busy/close, commit failure preservation, corruption/repair, offline restart, English UI.",
  );
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  page = await restart();
  return page;
}

export async function testEngineLive({ page, root }) {
  await page.locator("#home-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#engines-manage").click();
  await page.locator("#engine-highlight-download:not(:disabled)").waitFor();
  await page.locator("#engine-highlight-download").click();
  await page.waitForFunction(
    () => document.querySelector("#engines-refresh")?.disabled === false,
    {},
    { timeout: 120000 },
  );
  const result = await page.locator("#engine-highlight-status").innerText();
  const error = await page.locator("#engine-highlight-error").innerText();
  await writeFile(
    path.join(root, "engines-live-result.json"),
    JSON.stringify({ result, error }, null, 2),
  );
  assert.equal(result, "已就绪", error);
  await page.locator("#engines-close").click();
  await page.locator("#settings-close").click();
  console.log(
    "PASS: native fixed-source HTTPS download, SHA-256 verification and highlight render probe.",
  );
  return page;
}
