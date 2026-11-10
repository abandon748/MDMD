// Measured local baseline; timings include CDP discovery and are not cold-disk guarantees.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { chromium } from "playwright-core";
const exec = promisify(execFile);
const root = path.resolve(`test-results/release-${Date.now()}`);
await mkdir(root, { recursive: true });
const executable = path.resolve("../../release/MDMD.exe");
const samples = [],
  errors = [];
const wait = async (fn) => {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Timed out");
};
const server = net.createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
await new Promise((r) => server.close(r));
const profile = path.join(root, "webview");
let environment;
for (const units of [5 * 1024, 100 * 1024, 1024 * 1024, 2 * 1024 * 1024]) {
  const block =
    "# 标题\n\n" +
    "This is a local Markdown baseline. ".repeat(25) +
    "\n\n```text\ncode sample\n```\n\n";
  const content = block.repeat(Math.ceil(units / block.length)).slice(0, units);
  const file = path.join(root, `文档 ${units}.md`);
  await writeFile(file, content);
  for (let iteration = 0; iteration < 3; iteration++) {
    let browser;
    const start = performance.now();
    const app = spawn(executable, [file], {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        MDMD_DATA_DIR: path.join(root, "app-data"),
        WEBVIEW2_USER_DATA_FOLDER: profile,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      },
    });
    try {
      await wait(async () => {
        try {
          return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
        } catch {
          return false;
        }
      });
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      let page;
      await wait(() => {
        page = browser
          .contexts()
          .flatMap((c) => c.pages())
          .find((p) => /tauri|localhost/.test(p.url()));
        return !!page;
      });
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.locator("#document-settings:not([disabled])").waitFor();
      const readyMs = performance.now() - start;
      let manualMs = null;
      if (units > 1024 * 1024) {
        assert.match(
          await page.locator("#refresh").innerText(),
          /内容较大|large/,
        );
        const manualStart = performance.now();
        await page.locator("#refresh").click();
        await page.locator("#preview h1").first().waitFor();
        manualMs = performance.now() - manualStart;
      } else await page.locator("#preview h1").first().waitFor();
      const renderedMs = performance.now() - start;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      const { metrics } = await cdp.send("Performance.getMetrics");
      const version = await cdp.send("Browser.getVersion");
      const dpr = await page.evaluate(() => devicePixelRatio);
      environment = {
        browser: version.product,
        userAgent: version.userAgent,
        dpr,
      };
      const parent = JSON.parse(
        (
          await exec(
            "powershell.exe",
            [
              "-NoProfile",
              "-Command",
              `Get-Process -Id ${app.pid} | Select-Object WorkingSet64,PeakWorkingSet64 | ConvertTo-Json -Compress`,
            ],
            { windowsHide: true },
          )
        ).stdout,
      );
      samples.push({
        utf16Units: units,
        utf8Bytes: Buffer.byteLength(content),
        iteration,
        profile: units === 5120 && iteration === 0 ? "fresh" : "reused",
        readyMs: Math.round(readyMs),
        renderedMs: Math.round(renderedMs),
        manualMs: manualMs === null ? null : Math.round(manualMs),
        jsHeapBytes: metrics.find((m) => m.name === "JSHeapUsedSize")?.value,
        nativeProcess: parent,
      });
      if (units === 5120 && iteration === 0) {
        for (const size of [
          { width: 850, height: 560 },
          { width: 1320, height: 860 },
          { width: 1920, height: 1080 },
        ]) {
          await page.setViewportSize(size);
          await page.locator("#document-settings").click();
          await page.locator("#settings-appearance").click();
          for (const theme of ["light", "dark"]) {
            await page.locator(`#theme-${theme}`).check();
            assert(await page.locator("#settings-close").isVisible());
            const bounds = await page.locator("#settings-close").boundingBox();
            assert(
              bounds.x >= 0 &&
                bounds.y >= 0 &&
                bounds.x + bounds.width <= size.width &&
                bounds.y + bounds.height <= size.height,
            );
            const overflow = await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            );
            assert(!overflow, "No whole-page horizontal overflow");
            await page.screenshot({
              path: path.join(root, `settings-${size.width}-${theme}.png`),
            });
          }
          await page.locator("#settings-close").click();
        }
        await page.locator("#document-settings").click();
        await page.locator("#settings-general").click();
        await page.locator("#release-guide summary").click();
        assert.equal(
          await page.locator("#release-version").innerText(),
          "v0.2.0",
        );
        await page.locator("#setting-language").selectOption("en");
        await wait(
          async () =>
            (await page.locator("#release-guide summary").innerText()) ===
            "Installation and updates",
        );
        assert.match(
          await page.locator("#release-guide").innerText(),
          /No online update source/,
        );
        await page.screenshot({ path: path.join(root, "update-guide-en.png") });
        await page.locator("#setting-language").selectOption("zh-CN");
        await page.locator("#settings-close").click();
      }
      console.log(
        `Measured ${units} units run ${iteration + 1}: ready=${Math.round(readyMs)}ms rendered=${Math.round(renderedMs)}ms`,
      );
    } finally {
      await browser?.close();
      if (app.exitCode === null && app.signalCode === null) app.kill();
      await wait(() => app.exitCode !== null || app.signalCode !== null);
    }
  }
}
assert.deepEqual(errors, []);
const hardware = JSON.parse(
  (
    await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1; @{OS=$os.Caption;Build=$os.BuildNumber;CPU=$cpu.Name;RAMKiB=$os.TotalVisibleMemorySize} | ConvertTo-Json -Compress",
      ],
      { windowsHide: true },
    )
  ).stdout,
);
const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
const medians = [...new Set(samples.map((s) => s.utf16Units))].map((units) => {
  const rows = samples.filter((s) => s.utf16Units === units);
  return {
    utf16Units: units,
    readyMs: median(rows.map((s) => s.readyMs)),
    renderedMs: median(rows.map((s) => s.renderedMs)),
    manualMs:
      rows[0].manualMs === null ? null : median(rows.map((s) => s.manualMs)),
  };
});
await writeFile(
  path.join(root, "results.json"),
  JSON.stringify(
    {
      environment: { ...environment, ...hardware },
      samples,
      medians,
      errors,
      limitations:
        "One Windows host; first profile fresh then reused. Includes CDP/poll overhead. CSS viewport layout tests, not multiple physical DPI or clean VM. JS heap excludes browser/native total.",
    },
    null,
    2,
  ),
);
console.log(`PASS: release baseline and layout. Evidence: ${root}`);
