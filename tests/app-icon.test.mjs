import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdir, writeFile, readFile, unlink, readdir } from "node:fs/promises";
import path from "node:path";
import { registryTest } from "./integration.test.mjs";
const exec = promisify(execFile);
export function ico(red, green, blue) {
  const side = 32,
    pixels = side * side * 4,
    mask = side * 4,
    bytes = Buffer.alloc(22 + 40 + pixels + mask);
  bytes.writeUInt16LE(1, 2);
  bytes.writeUInt16LE(1, 4);
  bytes[6] = side;
  bytes[7] = side;
  bytes.writeUInt16LE(1, 10);
  bytes.writeUInt16LE(32, 12);
  bytes.writeUInt32LE(bytes.length - 22, 14);
  bytes.writeUInt32LE(22, 18);
  bytes.writeUInt32LE(40, 22);
  bytes.writeInt32LE(side, 26);
  bytes.writeInt32LE(side * 2, 30);
  bytes.writeUInt16LE(1, 34);
  bytes.writeUInt16LE(32, 36);
  bytes.writeUInt32LE(pixels, 42);
  for (let i = 62; i < 62 + pixels; i += 4) {
    bytes[i] = blue;
    bytes[i + 1] = green;
    bytes[i + 2] = red;
    bytes[i + 3] = 255;
  }
  return bytes;
}
export async function testAppIcon({
  page,
  root,
  dialog,
  restart,
  waitFor,
  integrationId,
  processId,
}) {
  const data = path.join(root, "app-data", "appearance"),
    shortcutRoot = path.join(data, "test-shortcuts"),
    record = path.join(data, "icon.json"),
    fail = path.join(data, "icon-test-failure");
  const exe = path.resolve(
    process.env.MDMD_TEST_EXE || "src-tauri/target/debug/mdmd.exe",
  );
  const native = async (operation) =>
    JSON.parse(
      (
        await exec(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            path.resolve("tests/app-icon-native.ps1"),
            "-Operation",
            operation,
            "-Root",
            shortcutRoot,
            "-Executable",
            exe,
            "-AppProcessId",
            String(processId()),
          ],
          { windowsHide: true, timeout: 20000 },
        )
      ).stdout.trim() || "null",
    );
  const registry = (...args) => registryTest(integrationId, ...args);
  const production = await registry("production");
  const invoke = (action) =>
    page.evaluate(
      (action) =>
        window.__TAURI_INTERNALS__.invoke("system_integration", { action }),
      action,
    );
  const ready = () => page.locator("#home-open:not([disabled])").waitFor();
  const settings = async () => {
    await page.locator("#home-settings").click();
    await page.locator("#settings-general").click();
  };
  const idle = () =>
    waitFor(
      async () =>
        !(await page.locator("#app-icon-message").innerText()).includes(
          "正在应用",
        ),
      "icon operation",
    );
  const select = async (file, cancel = false) => {
    await page.locator("#app-icon-change").click();
    await dialog(file, cancel, ["-ExpectedTitle", "选择应用图标"]);
    await idle();
  };
  const reset = async () => {
    await page.locator("#app-icon-reset").click();
    await idle();
  };
  const text = () => page.locator("#app-icon-message").innerText();
  const raw = () => readFile(record, "utf8").catch(() => null);
  const restartHome = async () => {
    page = await restart();
    await ready();
    await settings();
    await idle();
  };
  const red = path.join(root, "中文 红色.ico"),
    blue = path.join(root, "蓝色.ico"),
    bad = path.join(root, "损坏.ico"),
    large = path.join(root, "过大.ico");
  await writeFile(red, ico(221, 34, 85));
  await writeFile(blue, ico(30, 100, 220));
  await writeFile(bad, "not ico");
  await writeFile(large, Buffer.alloc(2 * 1024 * 1024 + 1));
  await ready();
  await native("create");
  await settings();
  await idle();
  const original = (await native("native")).Color;
  const expectedIcon =
    "data:image/x-icon;base64," +
    (await readFile("src-tauri/icons/icon.ico")).toString("base64");
  assert.equal(
    await page.locator("#home-app-icon").getAttribute("src"),
    expectedIcon,
  );
  assert.equal(
    await page.locator("#document-app-icon").getAttribute("src"),
    expectedIcon,
  );
  await page.screenshot({ path: path.join(root, "default-icon.png") });
  assert.equal(await raw(), null);
  assert(await page.locator("#app-icon-reset").isDisabled());
  await select("", true);
  assert.match(await text(), /已取消/);
  assert.equal(await raw(), null);
  for (const [file, expected] of [
    [bad, /有效的 ICO/],
    [large, /2 MiB/],
  ]) {
    await select(file);
    assert.match(await text(), expected);
    assert.equal(await raw(), null);
    assert.equal((await native("native")).Color, original);
  }
  await select(path.resolve("src-tauri/icons/icon.ico"));
  assert.equal((await native("native")).Color, original);
  await reset();
  await select(red);
  assert.equal((await native("native")).Color, "FFDD2255");
  assert.equal(
    await registry("snapshot"),
    "",
    "choosing icon never registers associations",
  );
  const saved = JSON.parse(await raw()),
    asset = path.join(data, "icons", `${saved.file}.ico`);
  assert.deepEqual(await readFile(asset), await readFile(red));
  const links = await native("read");
  assert.equal(links.length, 4);
  assert(
    links
      .filter((l) => l.Target.toLowerCase() === exe.toLowerCase())
      .every(
        (l) =>
          l.Icon.startsWith(asset) &&
          l.Arguments === '"中文 文件.md"' &&
          l.Description === "keep description",
      ),
  );
  const foreign = links.find(
    (l) => !l.Target.toLowerCase().endsWith("mdmd.exe"),
  );
  await invoke("add-menu");
  await invoke("set-default");
  assert(
    JSON.parse(await registry("snapshot"))
      .filter(
        (e) =>
          e.Name === "Icon" ||
          e.Name === "ApplicationIcon" ||
          e.Key.endsWith("\\DefaultIcon"),
      )
      .every((e) => e.Value.includes(saved.file)),
  );
  await unlink(red);
  await restartHome();
  assert.equal((await native("native")).Color, "FFDD2255");
  assert.deepEqual(JSON.parse(await raw()), saved);
  await page.screenshot({ path: path.join(root, "app-icon-custom.png") });
  await reset();
  assert.equal((await native("native")).Color, original);
  assert.equal(JSON.parse(await raw()).file, null);
  const resetIcons = JSON.parse(await registry("snapshot")).filter(
    (e) =>
      e.Name === "Icon" ||
      e.Name === "ApplicationIcon" ||
      e.Key.endsWith("\\DefaultIcon"),
  );
  assert.equal(resetIcons.length, 5);
  assert(resetIcons.every((e) => e.Value === `"${exe}",0`));
  assert(
    (await native("read"))
      .filter((l) => l.Target.toLowerCase() === exe.toLowerCase())
      .every((l) => l.Icon.toLowerCase() === exe.toLowerCase() + ",0"),
  );
  const oldRecord = await raw(),
    oldRegistry = await registry("snapshot"),
    oldLinks = await native("read");
  for (const stage of ["window", "registry", "shortcut", "persist"]) {
    await writeFile(fail, stage);
    await select(blue);
    assert.match(await text(), /恢复/);
    assert.equal(await raw(), oldRecord);
    assert.equal(await registry("snapshot"), oldRegistry);
    assert.deepEqual(await native("read"), oldLinks);
    assert.equal((await native("native")).Color, original);
    await unlink(fail);
  }
  await native("readonly");
  await select(blue);
  assert.match(await text(), /快捷方式/);
  assert.equal(await raw(), oldRecord);
  await native("writable");
  await select(blue);
  assert.equal((await native("native")).Color, "FF1E64DC");
  const blueRecord = JSON.parse(await raw());
  await unlink(path.join(data, "icons", `${blueRecord.file}.ico`));
  await restartHome();
  assert.match(await text(), /丢失或损坏/);
  assert(await page.locator("#app-icon-change").isDisabled());
  await reset();
  await writeFile(
    path.join(data, "icons", `${blueRecord.file}.ico`),
    "corrupt cache",
  );
  await select(blue);
  assert.equal((await native("native")).Color, "FF1E64DC");
  await reset();
  const broken = "broken icon settings".repeat(300);
  await writeFile(record, broken);
  await restartHome();
  assert.match(await text(), /损坏/);
  assert.equal(await raw(), broken);
  await invoke("refresh");
  await reset();
  assert((await readdir(data)).some((n) => n.startsWith("icon-invalid-")));
  await writeFile(path.join(data, "icon.pending"), "interrupted");
  await restartHome();
  assert.match(await text(), /未完成/);
  await reset();
  await writeFile(record, JSON.stringify({ schema: 99, file: null }));
  await restartHome();
  assert.match(await text(), /更高版本/);
  assert(await page.locator("#app-icon-change").isDisabled());
  assert(await page.locator("#app-icon-reset").isDisabled());
  await writeFile(record, oldRecord);
  await restartHome();
  await page.locator("#setting-language").selectOption("en");
  await page.locator("#setting-language:not([disabled])").waitFor();
  assert.equal(await page.locator("#app-icon-change").innerText(), "Change…");
  await page.setViewportSize({ width: 640, height: 720 });
  await page.locator("#app-icon-change").scrollIntoViewIfNeeded();
  assert(
    await page
      .locator("#settings-content")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  await page.screenshot({ path: path.join(root, "app-icon-en-640.png") });
  await page.setViewportSize({ width: 1320, height: 860 });
  await page.locator("#setting-language").selectOption("zh-CN");
  await page.locator("#setting-language:not([disabled])").waitFor();
  await page.locator("#settings-appearance").click();
  await page.locator("#theme-dark").check();
  await page.locator("#settings-general").click();
  await page.screenshot({ path: path.join(root, "app-icon-dark.png") });
  assert.deepEqual(
    (await native("read")).find((l) => l.Path === foreign.Path),
    foreign,
  );
  await invoke("remove-menu");
  await invoke("remove-association");
  await page.locator("#settings-close").click();
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  await page.reload();
  await ready();
  assert.equal(await registry("production"), production);
  await writeFile(
    path.join(root, "app-icon-results.json"),
    JSON.stringify(
      {
        passed: true,
        executable: exe,
        originalColor: original,
        customColors: ["FFDD2255", "FF1E64DC"],
        matchingShortcuts: 3,
        foreignShortcutPreserved: true,
        productionRegistryUnchanged: true,
        settingsFolder: data,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: native ICO pixels, file picker cancellation/validation, copied asset/restart/reset, isolated registry and real COM shortcuts, rollback at four stages, read-only shortcut, missing/corrupt/pending/future recovery, language/narrow/dark UI. Icon evidence: ${root}`,
  );
  return page;
}
