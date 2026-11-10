import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import path from "node:path";
const exec = promisify(execFile);
export async function registryTest(
  id,
  operation,
  name = "Default",
  value = "",
) {
  const { stdout } = await exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.resolve("tests/integration-registry.ps1"),
      "-TestId",
      id,
      "-Operation",
      operation,
      "-Name",
      name,
      "-Value",
      value,
    ],
    { windowsHide: true, timeout: 20000 },
  );
  return stdout.trim();
}
export async function testIntegration({
  page,
  root,
  restart,
  waitFor,
  integrationId,
}) {
  const registry = (...args) => registryTest(integrationId, ...args);
  const production = await registry("production");
  const ready = () => page.locator("#home-open:not([disabled])").waitFor();
  const idle = () =>
    page
      .locator('#integration-dialog[aria-busy="false"]')
      .waitFor({ state: "attached" });
  const click = async (id) => {
    await page.locator(`#${id}`).click();
    await idle();
  };
  const status = (id) => page.locator(`#${id}`).innerText();
  const invoke = (action) =>
    page.evaluate(
      (action) =>
        window.__TAURI_INTERNALS__.invoke("system_integration", { action }),
      action,
    );
  const raw = () => page.evaluate(() => localStorage.getItem("mdmd.settings"));
  await ready();
  const original = await raw();
  await page.locator("#home-association-manage").click();
  await idle();
  assert.equal(await status("integration-menu-status"), "未安装");
  assert.equal(await status("integration-association-status"), "未关联");
  await page.locator("#integration-close").focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "integration-refresh",
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "integration-close",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "home-association-manage",
  );
  assert.equal(await registry("snapshot"), "");
  await page.locator("#home-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#integration-manage").click();
  await idle();
  await registry("control", "FailAfter", "3");
  await click("integration-add-menu");
  assert.match(await status("integration-message"), /回滚/);
  assert.equal(await registry("snapshot"), "");
  await registry("control", "FailAfter");
  await click("integration-add-menu");
  assert.equal(await status("integration-menu-status"), "已安装");
  const installed = await registry("snapshot");
  const command = JSON.parse(installed).find(
    (e) => e.Key.endsWith("\\command") && e.Name === "",
  ).Value;
  assert.match(command, /^".+\.exe" "%1"$/i);
  await invoke("add-menu");
  assert.equal(await registry("snapshot"), installed);
  await registry("control", "FailAfter", "3");
  await click("integration-remove-menu");
  assert.match(await status("integration-message"), /回滚/);
  assert.equal(await registry("snapshot"), installed);
  await registry("control", "FailAfter");
  await registry("conflict");
  const conflict = await registry("snapshot");
  await click("integration-refresh");
  assert.equal(await status("integration-menu-status"), "配置冲突");
  await click("integration-remove-menu");
  assert.match(await status("integration-message"), /原配置/);
  assert.equal(await registry("snapshot"), conflict);
  await registry("partial");
  await click("integration-refresh");
  assert.equal(await status("integration-menu-status"), "配置不完整");
  await click("integration-add-menu");
  assert.equal(await registry("snapshot"), installed);
  await registry("extra");
  await click("integration-remove-menu");
  assert.equal(await status("integration-menu-status"), "未安装");
  assert(
    JSON.parse(await registry("snapshot")).some(
      (e) => e.Name === "Foreign.Value",
    ),
  );
  await click("integration-add-menu");
  await registry("control", "FailAfter", "4");
  const before = await registry("snapshot");
  await click("integration-set");
  assert.match(await status("integration-message"), /回滚/);
  assert.equal(await registry("snapshot"), before);
  await registry("control", "FailAfter");
  await registry("stale", "Default", path.join(root, "removed", "mdmd.exe"));
  await click("integration-refresh");
  assert.equal(await status("integration-association-status"), "旧路径已失效");
  assert.equal(await status("integration-set"), "修复关联并选择默认应用");
  const stale = await registry("snapshot");
  await registry("control", "FailAfter", "4");
  await click("integration-set");
  assert.match(await status("integration-message"), /回滚/);
  assert.equal(await registry("snapshot"), stale);
  await registry("control", "FailAfter");
  await registry("control", "LaunchFailure", "1");
  await click("integration-set");
  assert.match(await status("integration-message"), /手动打开/);
  assert.equal(await status("integration-association-status"), "待系统选择");
  await registry("control", "LaunchFailure");
  await click("integration-set");
  assert.equal(await status("integration-association-status"), "待系统选择");
  const registered = await registry("snapshot");
  assert.equal(await status("integration-set"), "在 Windows 中选择默认应用");
  assert.match(await status("integration-message"), /点击 .md → 选择 MDMD/);
  assert.match(
    await status("integration-message"),
    /关闭或取消不会更改默认应用/,
  );
  const application = JSON.parse(registered).filter((e) =>
    e.Key.includes("\\Applications\\mdmd.exe"),
  );
  assert(
    application.some((e) => e.Name === "FriendlyAppName" && e.Value === "MDMD"),
  );
  const currentExe = await status("integration-executable");
  const appIcons = JSON.parse(registered).filter(
    (e) => e.Name === "ApplicationIcon",
  );
  assert.equal(
    appIcons.length,
    2,
    "Settings and ProgID chooser both have application icons",
  );
  assert(appIcons.every((e) => e.Value === `"${currentExe}",0`));
  assert(
    JSON.parse(registered).some(
      (e) =>
        e.Key.endsWith("\\MDMD.Markdown\\Application") &&
        e.Name === "ApplicationName" &&
        e.Value === "MDMD",
    ),
  );
  // Upgrade the same installation's old registration without taking over defaults.
  await registry("legacy-icons");
  const legacy = await registry("snapshot");
  await click("integration-refresh");
  assert.equal(await status("integration-association-status"), "配置不完整");
  assert.equal(await status("integration-set"), "修复关联并选择默认应用");
  await registry("control", "FailAfter", "17");
  await click("integration-set");
  assert.match(await status("integration-message"), /回滚/);
  assert.equal(
    await registry("snapshot"),
    legacy,
    "new icon metadata rolls back too",
  );
  await registry("control", "FailAfter");
  await click("integration-set");
  assert.equal(await registry("snapshot"), registered);
  assert.equal(await status("integration-association-status"), "待系统选择");
  assert(
    application.some(
      (e) => e.Key.endsWith("\\DefaultIcon") && e.Value === `"${currentExe}",0`,
    ),
  );
  assert(
    application.some(
      (e) => e.Key.endsWith("\\command") && e.Value === `"${currentExe}" "%1"`,
    ),
  );
  // Closing/reopening Windows Settings is simulated by leaving Default unchanged.
  await click("integration-close");
  await page.locator("#settings-close").click();
  assert.equal(await status("home-association-status"), "待系统选择");
  page = await restart();
  await ready();
  await page.locator("#home-association-manage").click();
  await idle();
  assert.equal(await status("integration-menu-status"), "已安装");
  assert.equal(await status("integration-association-status"), "待系统选择");
  assert.equal(await registry("snapshot"), registered);
  await registry("control", "Default", "MDMD");
  await click("integration-refresh");
  assert.equal(await status("home-association-status"), "已关联");
  await click("integration-remove");
  assert.match(await status("integration-message"), /选择其他应用/);
  assert.equal(await registry("snapshot"), registered);
  await registry("control", "Default", "unknown");
  await click("integration-remove");
  assert.match(await status("integration-message"), /无法确定/);
  assert.equal(await registry("snapshot"), registered);
  await registry("control", "Default", "other");
  await registry("control", "FailAfter", "4");
  await click("integration-remove");
  assert.match(await status("integration-message"), /回滚/);
  assert.equal(await registry("snapshot"), registered);
  await registry("control", "FailAfter");
  await click("integration-remove");
  await click("integration-remove-menu");
  const remaining = JSON.parse(await registry("snapshot"));
  assert(remaining.every((e) => e.Name.startsWith("Foreign.")));
  await invoke("remove-association");
  await invoke("remove-menu");
  await click("integration-close");
  assert.equal(
    await raw(),
    original,
    "registry state is never saved in localStorage",
  );
  await page.locator("#home-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#setting-language").selectOption("en");
  await page.locator("#setting-language:not([disabled])").waitFor();
  await page.locator("#integration-manage").click();
  await idle();
  assert.equal(await status("integration-title"), "System integration");
  assert.equal(await status("integration-menu-status"), "Not installed");
  await page.setViewportSize({ width: 640, height: 720 });
  assert(
    await page
      .locator("#integration-dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  await page.screenshot({ path: path.join(root, "integration-en-640.png") });
  await click("integration-close");
  await page.locator("#setting-language").selectOption("zh-CN");
  await page.locator("#setting-language:not([disabled])").waitFor();
  await page.locator("#settings-appearance").click();
  await page.locator('input[name="theme"][value="dark"]').check();
  await page.locator("#settings-general").click();
  await page.locator("#integration-manage").click();
  await idle();
  await page.setViewportSize({ width: 1320, height: 860 });
  await page.screenshot({ path: path.join(root, "integration-dark.png") });
  await click("integration-close");
  await page.locator("#settings-close").click();
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  await page.reload();
  await ready();
  await page.locator("#home-association-manage").click();
  await idle();
  await page.screenshot({ path: path.join(root, "integration-light.png") });
  await click("integration-close");
  assert.equal(
    await registry("production"),
    production,
    "real default/menu registration unchanged",
  );
  await writeFile(
    path.join(root, "integration-results.json"),
    JSON.stringify(
      {
        passed: true,
        isolatedRegistry: integrationId,
        command,
        productionUnchanged: true,
        windowsSettingsSelection: "simulated; manual end-to-end pending",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: system integration native registry add/remove, idempotence, rollback, conflict/partial recovery, foreign values, restart, shared UI, focus, language and small/dark layout; real registry unchanged.",
  );
  return page;
}
