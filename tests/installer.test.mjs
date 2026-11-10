// Exercises the actual release installer. Refuses to run over an existing installation.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  access,
  chmod,
  rename,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import net from "node:net";
import { chromium } from "playwright-core";
import { registryTest } from "./integration.test.mjs";
const exec = promisify(execFile);
const root = path.resolve(`test-results/install-${Date.now()}`);
await mkdir(root, { recursive: true });
const destination = path.join(root, "中文 空格 安装");
const installed = path.join(destination, "mdmd.exe");
const id = randomUUID();
const env = {
  ...process.env,
  MDMD_INTEGRATION_TEST_ID: id,
  MDMD_DATA_DIR: path.join(root, "app-data"),
  WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
};
const setup = path.resolve("../../release/MDMD-0.2.0-x64-setup.exe");
const ps = async (mode, pid) =>
  (
    await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.resolve("tests/installer-state.ps1"),
        "-Mode",
        mode,
        ...(pid ? ["-AppProcessId", String(pid)] : []),
      ],
      { windowsHide: true, timeout: 20000 },
    )
  ).stdout;
const state = async () => JSON.parse(await ps("read"));
assert.deepEqual(
  await state(),
  { Version: null, Location: null, Uninstall: null },
  "Existing installation must not be used for tests",
);
const production = await registryTest(id, "production");
const hash = async (p) =>
  createHash("sha256")
    .update(await readFile(p))
    .digest("hex");
const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};
const run = async (exe, args = []) => {
  try {
    await exec(exe, args, {
      env,
      windowsHide: true,
      windowsVerbatimArguments: true,
      timeout: 60000,
    });
    return 0;
  } catch (e) {
    if (typeof e.code !== "number") throw e;
    return e.code;
  }
};
const wait = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timed out");
};
let app, browser;
const stop = async () => {
  await browser?.close();
  browser = null;
  if (app && app.exitCode === null) {
    app.kill();
    await wait(() => app.exitCode !== null || app.signalCode !== null);
  }
  app = null;
};
async function launch(file = []) {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  app = spawn(installed, file, {
    env: {
      ...env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    windowsHide: true,
    stdio: "ignore",
  });
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
  await page
    .locator("#home-settings:not([disabled])")
    .waitFor({ state: "attached" });
  return page;
}
const results = [];
try {
  // Older fixture uses the real previous 0.1.0 EXE and the same installer safety policy.
  const generated = path.resolve("src-tauri/target/release/nsis/x64");
  const old = path.join(root, "old-0.1.0-setup.exe");
  const previous = path.join(root, "previous", "mdmd.exe");
  await mkdir(path.dirname(previous));
  await copyFile(
    "test-results/dev-06-installer-2026-10-26/previous-0.1.0.exe",
    previous,
  );
  let nsi = await readFile(path.join(generated, "installer.nsi"), "utf8");
  nsi = nsi
    .replace('!define VERSION "0.2.0"', '!define VERSION "0.1.0"')
    .replace(
      '!define VERSIONWITHBUILD "0.2.0.0"',
      '!define VERSIONWITHBUILD "0.1.0.0"',
    )
    .replace(
      /!define MAINBINARYSRCPATH ".*"/,
      `!define MAINBINARYSRCPATH "${previous}"`,
    )
    .replace('!define OUTFILE "nsis-output.exe"', `!define OUTFILE "${old}"`);
  await writeFile(path.join(generated, "test-old.nsi"), nsi);
  await exec(
    path.join(process.env.LOCALAPPDATA, "tauri/NSIS/makensis.exe"),
    ["/V2", "test-old.nsi"],
    { cwd: generated, windowsHide: true, timeout: 60000 },
  );
  assert.equal(await run(old, ["/S", "/NS", `/D=${destination}`]), 0);
  assert.equal((await state()).Version, "0.1.0");
  assert.equal((await state()).Location, destination);
  assert.equal(
    await hash(installed),
    await hash("test-results/dev-06-installer-2026-10-26/previous-0.1.0.exe"),
  );
  console.log("Checkpoint", results.length);
  results.push("previous binary clean install");
  const document = path.join(root, "中文 空格.md");
  await writeFile(document, "# 升级保留\n\n正文\n");
  await mkdir(path.join(root, ".mdmd-backups"));
  await writeFile(path.join(root, ".mdmd-backups/keep.bak"), "backup");
  let page = await launch([document]);
  await page.locator("#document-settings").click();
  await page.locator("#settings-appearance").click();
  await page.locator("#theme-dark").check();
  const settings = await page.evaluate(() =>
    localStorage.getItem("mdmd.settings"),
  );
  const history = await readFile(
    path.join(root, "app-data/history.json"),
    "utf8",
  );
  await writeFile(path.join(root, "app-data/keep-cache.bin"), "cache");
  assert.notEqual(await run(setup, ["/S", "/NS", `/D=${destination}`]), 0);
  assert.equal(app.exitCode, null);
  assert.equal((await state()).Version, "0.1.0");
  console.log("Checkpoint", results.length);
  results.push("busy upgrade rejected without terminating old editor");
  await stop();
  assert.equal(
    await run(setup, ["/S", "/NS", "/UPDATE", `/D=${destination}`]),
    0,
  );
  assert.equal((await state()).Version, "0.2.0");
  const installedBytes = await readFile(installed);
  const portableBytes = await readFile("../../release/MDMD.exe");
  const marker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
  const offset = portableBytes.indexOf(marker);
  assert(offset >= 0);
  assert.equal(portableBytes.indexOf(marker, offset + 1), -1);
  const expectedInstalled = Buffer.from(portableBytes);
  expectedInstalled.write("__TAURI_BUNDLE_TYPE_VAR_NSS", offset, "ascii");
  assert(
    installedBytes.equals(expectedInstalled),
    "Only Tauri's documented-in-source bundle-type marker may differ",
  );
  await writeFile(
    path.join(root, "binary-identity.json"),
    JSON.stringify(
      {
        portable: await hash("../../release/MDMD.exe"),
        installed: await hash(installed),
        bundleMarkerOffset: offset,
        otherBytesIdentical: true,
      },
      null,
      2,
    ),
  );
  page = await launch();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("mdmd.settings")),
    settings,
  );
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(
    await readFile(path.join(root, "app-data/history.json"), "utf8"),
    history,
  );
  const invoke = (action) =>
    page.evaluate(
      (action) =>
        window.__TAURI_INTERNALS__.invoke("system_integration", { action }),
      action,
    );
  await invoke("add-menu");
  await registryTest(id, "control", "Default", "other");
  await invoke("set-default");
  await registryTest(id, "extra");
  await page.screenshot({ path: path.join(root, "installed-upgraded.png") });
  assert.notEqual(
    await run(path.join(destination, "uninstall.exe"), [
      "/S",
      `_?=${destination}`,
    ]),
    0,
  );
  assert.equal(app.exitCode, null);
  console.log("Checkpoint", results.length);
  results.push("upgrade preserves settings/history and busy uninstall rejects");
  await stop();
  assert.notEqual(await run(old, ["/S", "/NS", `/D=${destination}`]), 0);
  assert.equal((await state()).Version, "0.2.0");
  assert.equal(await run(setup, ["/S", "/NS", `/D=${destination}`]), 0);
  console.log("Checkpoint", results.length);
  results.push("downgrade rejects; same-version repair succeeds");
  const protectedHash = await hash(installed);
  await chmod(installed, 0o444);
  try {
    assert.notEqual(await run(setup, ["/S", "/NS", `/D=${destination}`]), 0);
    assert.equal(await hash(installed), protectedHash);
  } finally {
    await chmod(installed, 0o666);
  }
  await rename(installed, `${installed}.test-held`);
  try {
    assert.notEqual(
      await run(path.join(destination, "uninstall.exe"), [
        "/S",
        `_?=${destination}`,
      ]),
      0,
    );
    assert.equal((await state()).Version, "0.2.0");
  } finally {
    await rename(`${installed}.test-held`, installed);
  }
  results.push(
    "read-only executable and missing executable refuse safely; retry remains possible",
  );
  // Conflict blocks deletion of both the app and the foreign registration.
  const originalRegistry = await registryTest(id, "snapshot");
  await registryTest(id, "conflict");
  assert.notEqual(
    await run(path.join(destination, "uninstall.exe"), [
      "/S",
      `_?=${destination}`,
    ]),
    0,
  );
  assert(await exists(installed));
  assert((await registryTest(id, "snapshot")).includes("foreign-command"));
  // Recreate only this test UUID namespace via the real application API.
  await registryTest(id, "cleanup");
  page = await launch();
  await invoke("add-menu");
  await registryTest(id, "control", "Default", "other");
  await invoke("set-default");
  await registryTest(id, "extra");
  await stop();
  assert.equal(
    await run(path.join(destination, "uninstall.exe"), [
      "/S",
      `_?=${destination}`,
    ]),
    0,
  );
  assert(!(await exists(installed)));
  assert.equal((await state()).Version, null);
  assert.equal((await state()).Location, null);
  const remaining = await registryTest(id, "snapshot");
  assert(remaining.includes("Foreign.Value"));
  assert(remaining.includes("Foreign.App"));
  assert(!remaining.includes("MDMD.Owner"));
  assert.equal(await readFile(document, "utf8"), "# 升级保留\n\n正文\n");
  assert.equal(
    await readFile(path.join(root, ".mdmd-backups/keep.bak"), "utf8"),
    "backup",
  );
  assert.equal(
    await readFile(path.join(root, "app-data/keep-cache.bin"), "utf8"),
    "cache",
  );
  assert(await exists(path.join(root, "webview")));
  console.log("Checkpoint", results.length);
  results.push(
    "uninstall conflict blocks safely; owned integration removes; foreign values/data/documents/backups survive",
  );
  assert.equal(await run(setup, ["/S", "/NS", `/D=${destination}`]), 0);
  assert((await readFile(installed)).equals(expectedInstalled));
  assert.equal(
    await run(path.join(destination, "uninstall.exe"), [
      "/S",
      `_?=${destination}`,
    ]),
    0,
  );
  assert.equal((await state()).Version, null);
  results.push("fresh final-version installation and uninstall succeed");
  // Fresh final installation has exactly the release binary and supports cancellation.
  const cancel = spawn(setup, ["/NS", `/D=${path.join(root, "cancelled")}`], {
    env,
    windowsHide: false,
    windowsVerbatimArguments: true,
    stdio: "ignore",
  });
  await ps("cancel", cancel.pid);
  await wait(() => cancel.exitCode !== null);
  assert(!(await exists(path.join(root, "cancelled/mdmd.exe"))));
  console.log("Checkpoint", results.length);
  results.push("interactive installer cancel leaves no application");
  const invalid = spawn(path.resolve("../../release/MDMD.exe"), [], {
    env: {
      ...env,
      WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: path.join(root, "missing-runtime"),
    },
    windowsHide: true,
    stdio: "ignore",
  });
  const diagnostic = await ps("startup-error", invalid.pid);
  await wait(() => invalid.exitCode !== null);
  assert.equal(invalid.exitCode, 1);
  assert.match(diagnostic, /WebView2/);
  await writeFile(path.join(root, "runtime-error.txt"), diagnostic);
  console.log("Checkpoint", results.length);
  results.push("missing runtime gives native recovery dialog and nonzero exit");
  assert.equal(await registryTest(id, "production"), production);
  await writeFile(
    path.join(root, "results.json"),
    JSON.stringify(
      { results, productionIntegrationUnchanged: true, originalRegistry },
      null,
      2,
    ),
  );
  console.log(`PASS: ${results.join("; ")}\nEvidence: ${root}`);
} catch (error) {
  console.error("Installer test failure", error);
  throw error;
} finally {
  await stop();
  // A failed test retains its installation and evidence for diagnosis; never remove another install.
  await registryTest(id, "cleanup");
}
