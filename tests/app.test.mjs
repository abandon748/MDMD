import { testSidebarLayout } from "./sidebar-layout.test.mjs";
import { testUiFocus } from "./ui-focus.test.mjs";
import { testDemoCompat } from "./demo-compat.test.mjs";
import { testInlineMode } from "./inline-mode.test.mjs";
import { testEnhancements } from "./enhancements.test.mjs";
import { testRichEdit } from "./rich-edit.test.mjs";
import { testInlineSwitch } from "./inline-switch.test.mjs";
import { testInlineInput } from "./inline-input.test.mjs";
import { testPreviewSearch } from "./preview-search.test.mjs";
import { testExtensions } from "./extensions.test.mjs";
import { testTasks } from "./tasks.test.mjs";
import { testVersions } from "./versions.test.mjs";
import { testCopy } from "./copy.test.mjs";
import { testPrint } from "./print.test.mjs";
import { testOutput } from "./output.test.mjs";
import { testFlowEdit } from "./flow-edit.test.mjs";
import { testDiagrams } from "./diagrams.test.mjs";
import { testMath } from "./math.test.mjs";
import { testSyntax } from "./syntax.test.mjs";
import { testAttachments } from "./attachments.test.mjs";
import { testSnippets } from "./snippets.test.mjs";
import { testFormatEdit } from "./format-edit.test.mjs";
import { testAutoSave } from "./autosave.test.mjs";
import { testTableEdit } from "./table-edit.test.mjs";
import { testInlineEdit } from "./inline-edit.test.mjs";
import { testExternalEdit } from "./external-edit.test.mjs";
import { testSessionSave } from "./session-save.test.mjs";
import { testFeedback } from "./feedback.test.mjs";
import { engineFixture, testEngines, testEngineLive } from "./engines.test.mjs";
import { chromium } from "playwright-core";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  unlink,
  rename,
  rmdir,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import net from "node:net";
import { testTheme } from "./theme.test.mjs";
import { testTypography, defaultTypography } from "./typography.test.mjs";
import { testStatistics } from "./statistics.test.mjs";
import { testLanguage } from "./language.test.mjs";
import { testLinkPreview } from "./link-preview.test.mjs";
import { testIntegration, registryTest } from "./integration.test.mjs";
import { randomUUID } from "node:crypto";
import { testAppIcon } from "./app-icon.test.mjs";
import { testTitleFormat } from "./title-format.test.mjs";
import { testCustomCss } from "./custom-css.test.mjs";
import { testAppearance } from "./appearance.test.mjs";
import { testSplitBreaks } from "./split-breaks.test.mjs";
import { testOutlineLayout } from "./outline-layout.test.mjs";
import { testShortcuts } from "./shortcuts.test.mjs";
import { testVisibility } from "./navigation-visibility.test.mjs";

const run = promisify(execFile);
const sidebarRun = process.argv.includes("--sidebar-layout");
const uiFocusRun = process.argv.includes("--ui-focus");
const demoRun = process.argv.includes("--demo-compat");
const inlineModeRun = process.argv.includes("--inline-mode");
const enhancementsRun = process.argv.includes("--enhancements");
const richRun = process.argv.includes("--rich-edit");
const switchRun = process.argv.includes("--inline-switch");
const inputRun = process.argv.includes("--inline-input");
const searchRun = process.argv.includes("--search");
const extensionsRun = process.argv.includes("--extensions");
const tasksRun = process.argv.includes("--tasks");
const versionsRun = process.argv.includes("--versions");
const copyRun = process.argv.includes("--copy");
const printRun = process.argv.includes("--print");
const outputRun = process.argv.includes("--output");
const flowRun = process.argv.includes("--flow-edit");
const diagramsRun = process.argv.includes("--diagrams");
const mathRun = process.argv.includes("--math");
const syntaxRun = process.argv.includes("--syntax");
const attachmentsRun = process.argv.includes("--attachments");
const snippetsRun = process.argv.includes("--snippets");
const formatOnly = process.argv.includes("--format-only");
const formatRun = formatOnly || process.argv.includes("--format");
const autoOnly = process.argv.includes("--autosave-only");
const autoRun =
  autoOnly || process.argv.includes("--autosave") || (formatRun && !formatOnly);
const tableOnly = process.argv.includes("--table-edit-only");
const tableRun =
  tableOnly || process.argv.includes("--table-edit") || (autoRun && !autoOnly);
const inlineOnly = process.argv.includes("--inline-edit-only");
const inlineRun =
  inlineOnly ||
  process.argv.includes("--inline-edit") ||
  (tableRun && !tableOnly);
const externalOnly = process.argv.includes("--external-edit-only");
const externalRun =
  process.argv.includes("--external-edit") ||
  externalOnly ||
  (inlineRun && !inlineOnly);
const sessionOnly = process.argv.includes("--session-save-only");
const sessionRun =
  process.argv.includes("--session-save") ||
  sessionOnly ||
  (externalRun && !externalOnly);
const feedbackOnly = process.argv.includes("--feedback-only");
const feedbackRun =
  process.argv.includes("--feedback") ||
  feedbackOnly ||
  (sessionRun && !sessionOnly);
const enginesLive = process.argv.includes("--engines-live");
const enginesOnly = process.argv.includes("--engines-only") || enginesLive;
const enginesRun =
  process.argv.includes("--engines") ||
  enginesOnly ||
  (feedbackRun && !feedbackOnly);
const fixture =
  enginesRun ||
  syntaxRun ||
  mathRun ||
  diagramsRun ||
  flowRun ||
  outputRun ||
  demoRun ||
  enhancementsRun
    ? await engineFixture()
    : null;
const appIconOnly = process.argv.includes("--app-icon-only");
const appIconRun =
  process.argv.includes("--app-icon") ||
  appIconOnly ||
  (enginesRun && !enginesOnly);
const integrationOnly = process.argv.includes("--integration-only");
const integrationRun =
  process.argv.includes("--integration") ||
  integrationOnly ||
  (appIconRun && !appIconOnly);
const integrationId = randomUUID();
const linkPreviewOnly = process.argv.includes("--link-preview-only");
const linkPreviewRun =
  process.argv.includes("--link-preview") ||
  linkPreviewOnly ||
  (integrationRun && !integrationOnly);
const languageOnly = process.argv.includes("--language-only");
const languageRun =
  process.argv.includes("--language") ||
  languageOnly ||
  (linkPreviewRun && !linkPreviewOnly);
const titleFormatOnly = process.argv.includes("--title-format-only");
const titleFormatRun =
  process.argv.includes("--title-format") ||
  titleFormatOnly ||
  (languageRun && !languageOnly);
const customCssRun =
  process.argv.includes("--custom-css") || (titleFormatRun && !titleFormatOnly);
const appearanceOnly = process.argv.includes("--appearance-only");
const appearanceRun =
  process.argv.includes("--appearance") || appearanceOnly || customCssRun;
const splitBreaksRun =
  process.argv.includes("--split-breaks") || (appearanceRun && !appearanceOnly);
const outlineLayoutRun =
  process.argv.includes("--outline-layout") || splitBreaksRun;
const shortcutsRun = process.argv.includes("--shortcuts") || outlineLayoutRun;
const visibilityRun = process.argv.includes("--visibility") || shortcutsRun;
const statisticsRun = process.argv.includes("--statistics") || visibilityRun;
const typographyRun = process.argv.includes("--typography") || statisticsRun;
const themeRun = process.argv.includes("--theme") || typographyRun;
const favoritesRun = process.argv.includes("--favorites") || themeRun;
const historyRun = process.argv.includes("--history") || favoritesRun;
const outlineRun = process.argv.includes("--outline") || historyRun;
const navigationRun = process.argv.includes("--navigation") || outlineRun;
const folderRun = process.argv.includes("--folder") || navigationRun;
const settingsRun =
  enhancementsRun ||
  inlineModeRun ||
  demoRun ||
  appearanceOnly ||
  inputRun ||
  switchRun ||
  uiFocusRun ||
  richRun ||
  sidebarRun ||
  searchRun ||
  extensionsRun ||
  tasksRun ||
  versionsRun ||
  copyRun ||
  printRun ||
  outputRun ||
  flowRun ||
  diagramsRun ||
  mathRun ||
  syntaxRun ||
  attachmentsRun ||
  snippetsRun ||
  formatOnly ||
  autoOnly ||
  tableOnly ||
  process.argv.includes("--settings") ||
  folderRun ||
  titleFormatOnly ||
  languageOnly ||
  linkPreviewOnly ||
  integrationOnly ||
  appIconOnly ||
  enginesOnly ||
  feedbackOnly ||
  sessionOnly ||
  externalOnly ||
  inlineOnly;
const homeRun = process.argv.includes("--home") || settingsRun;
const root = path.resolve("test-results", `run-${Date.now()}`);
await mkdir(root, { recursive: true });
const file = path.join(root, "中文 测试.md");
const original =
  "\ufeff# 中文文档\r\n\r\nHello **MDMD**\r\n\r\n## 安全预览\r\n\r\n<script>window.injected = true</script>\r\n\r\n![本地图片](pixel.png)\r\n";
await writeFile(file, original);
// Existing Moye recovery data must survive MDMD saves unchanged.
const legacyBackup = path.join(root, ".moye-backups", "旧版本.bak");
const legacyTemp = path.join(root, ".moye-recovery.tmp");
await mkdir(path.dirname(legacyBackup));
await writeFile(legacyBackup, original);
await writeFile(legacyTemp, "未恢复的旧草稿");
await writeFile(
  path.join(root, "pixel.png"),
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const server = net.createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
await new Promise((r) => server.close(r));
function startApp() {
  const child = spawn(
    path.resolve(
      process.env.MDMD_TEST_EXE ||
        process.env.MOYE_TEST_EXE ||
        "src-tauri/target/debug/mdmd.exe",
    ),
    homeRun ? [] : [file],
    {
      windowsHide: true,
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
        WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
        MDMD_DATA_DIR: path.join(root, "app-data"),
        MDMD_INTEGRATION_TEST_ID: integrationId,
        ...(fixture && !enginesLive
          ? { MDMD_ENGINE_TEST_URL: fixture.url }
          : {}),
      },
      stdio: "ignore",
    },
  );
  child.on("error", (e) => {
    console.error(e);
  });
  return child;
}
let app = startApp();
let browser;
async function waitFor(check, label) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
async function dialog(filePath, cancel = false, extra = []) {
  await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.resolve("tests/native-dialog.ps1"),
      "-AppProcessId",
      String(app.pid),
      ...(cancel ? ["-Cancel"] : ["-FilePath", filePath]),
      ...extra,
    ],
    { timeout: 20000, windowsHide: true },
  );
}
async function closeWindow() {
  await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.resolve("tests/native-dialog.ps1"),
      "-AppProcessId",
      String(app.pid),
      "-CloseWindow",
    ],
    { timeout: 10000, windowsHide: true },
  );
}
const errors = [];
async function connectPage() {
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
    } catch {
      return false;
    }
  }, "WebView2 debugging endpoint");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page;
  await waitFor(async () => {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => /tauri|localhost/.test(p.url()));
    return !!page;
  }, "application page");
  page.on("pageerror", (e) => errors.push(String(e)));
  return page;
}
try {
  let page = await connectPage();
  for (const test of [
    ...(enhancementsRun ? [testEnhancements] : []),
    ...(inlineModeRun ? [testInlineMode] : []),
    ...(demoRun ? [testDemoCompat] : []),
    ...(inputRun ? [testInlineInput] : []),
    ...(switchRun ? [testInlineSwitch] : []),
    ...(richRun ? [testRichEdit] : []),
    ...(uiFocusRun ? [testUiFocus] : []),
    ...(diagramsRun ? [testDiagrams] : []),
    ...(flowRun ? [testFlowEdit] : []),
    ...(outputRun ? [testOutput] : []),
    ...(printRun ? [testPrint] : []),
    ...(copyRun ? [testCopy] : []),
    ...(versionsRun ? [testVersions] : []),
    ...(tasksRun ? [testTasks] : []),
    ...(extensionsRun ? [testExtensions] : []),
    ...(searchRun ? [testPreviewSearch] : []),
    ...(mathRun ? [testMath] : []),
    ...(syntaxRun ? [testSyntax] : []),
    ...(attachmentsRun ? [testAttachments] : []),
    ...(snippetsRun ? [testSnippets] : []),
    ...(formatRun ? [testFormatEdit] : []),
    ...(autoRun ? [testAutoSave] : []),
    ...(tableRun ? [testTableEdit] : []),
    ...(inlineRun ? [testInlineEdit] : []),
    ...(sidebarRun ? [testSidebarLayout] : []),
    ...(externalRun ? [testExternalEdit] : []),
    ...(sessionRun ? [testSessionSave] : []),
    ...(feedbackRun ? [testFeedback] : []),
    ...(enginesRun ? [enginesLive ? testEngineLive : testEngines] : []),
    ...(appIconRun ? [testAppIcon] : []),
    ...(integrationRun ? [testIntegration] : []),
    ...(linkPreviewRun ? [testLinkPreview] : []),
    ...(languageRun ? [testLanguage] : []),
    ...(titleFormatRun ? [testTitleFormat] : []),
    ...(customCssRun ? [testCustomCss] : []),
    ...(appearanceRun ? [testAppearance] : []),
    ...(splitBreaksRun ? [testSplitBreaks] : []),
    ...(outlineLayoutRun ? [testOutlineLayout] : []),
    ...(shortcutsRun ? [testShortcuts] : []),
    ...(visibilityRun ? [testVisibility] : []),
    ...(statisticsRun ? [testStatistics] : []),
    ...(typographyRun ? [testTypography] : []),
    ...(themeRun ? [testTheme] : []),
  ]) {
    page = await test({
      page,
      root,
      integrationId,
      engineFixture: fixture,
      processId: () => app.pid,
      dialog,
      waitFor,
      nativeTitle: async () => {
        const { stdout } = await run(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); (Get-Process -Id ${app.pid}).MainWindowTitle`,
          ],
          { windowsHide: true },
        );
        return stdout.trim();
      },
      restart: async () => {
        await closeWindow();
        await waitFor(() => app.exitCode !== null, "theme process exit");
        await browser.close().catch(() => {});
        await waitFor(async () => {
          try {
            await fetch(`http://127.0.0.1:${port}/json/version`);
            return false;
          } catch {
            return true;
          }
        }, "theme old endpoint closed");
        app = startApp();
        return connectPage();
      },
    });
  }
  if (process.argv.includes("--focused")) {
    assert.deepEqual(errors, []);
    console.log(
      "PASS: focused feature chain; shared regressions skipped explicitly.",
    );
  } else {
    if (favoritesRun) {
      const store = path.join(root, "app-data", "favorites.json"),
        historyStore = path.join(root, "app-data", "history.json");
      const dir = path.join(root, "收藏甲"),
        other = path.join(root, "收藏乙"),
        empty = path.join(dir, "空目录");
      await mkdir(empty, { recursive: true });
      await mkdir(other);
      const a = path.join(dir, "同名.md"),
        b = path.join(other, "同名.md");
      await writeFile(a, "# 收藏甲\n原文");
      await writeFile(b, "# 收藏乙");
      const rows = () => page.locator("#favorites-list .favorite-open");
      async function idle() {
        await waitFor(
          () => page.locator("#open").isEnabled(),
          "favorites idle",
        );
      }
      async function pick(file) {
        await page
          .locator(
            (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
          )
          .click();
        await dialog(file);
        await idle();
        assert.equal(
          await page.locator("#filepath").getAttribute("title"),
          file,
        );
      }
      async function openFavorite(file, kind = "file") {
        const index = (
          await rows().evaluateAll((ns) =>
            ns.map((n) => n.dataset.kind + ":" + n.dataset.path),
          )
        ).indexOf(kind + ":" + file);
        assert(index >= 0);
        await rows().nth(index).click();
      }
      async function removeFavorite(file) {
        const index = (
          await rows().evaluateAll((ns) => ns.map((n) => n.dataset.path))
        ).indexOf(file);
        assert(index >= 0);
        await page
          .locator("#favorites-list .favorite-remove")
          .nth(index)
          .click();
        await idle();
      }
      async function stop() {
        await closeWindow();
        await waitFor(() => app.exitCode !== null, "favorites exit");
        await browser.close().catch(() => {});
        await waitFor(async () => {
          try {
            await fetch(`http://127.0.0.1:${port}/json/version`);
            return false;
          } catch {
            return true;
          }
        }, "favorites endpoint exit");
      }
      async function restart() {
        app = startApp();
        page = await connectPage();
        await page.locator("#home-favorites:not([disabled])").waitFor();
      }
      async function favoriteTab() {
        await page.locator("#tab-favorites").click();
      }
      await page.locator("#home-favorites:not([disabled])").click();
      assert(
        (await page.locator("#favorites-list").innerText()).includes(
          "暂无收藏",
        ),
      );
      assert(await page.locator("#favorite-file").isDisabled());
      assert(await page.locator("#favorite-folder").isDisabled());
      assert(await page.locator("#panes").isHidden());
      assert(
        await page
          .locator(".sidebar-bottom")
          .evaluate(
            (e) => e.getBoundingClientRect().bottom > innerHeight - 100,
          ),
      );
      await page.screenshot({
        path: path.resolve("test-results/favorites-empty.png"),
      });
      await page.locator("#folder-home").click();
      await page.locator("#home").waitFor({ state: "visible" });
      await pick(a);
      await page.locator(".doc-title").click({ button: "right" });
      await page.locator("#favorite-menu").waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      assert(await page.locator("#favorite-menu").isHidden());
      assert.equal(await readFile(store, "utf8").catch(() => null), null);
      await page.locator(".doc-title").click({ button: "right" });
      await page.locator("#menu-favorite-file").click();
      await idle();
      await favoriteTab();
      assert.equal(await rows().count(), 1);
      const first = await readFile(store, "utf8");
      await page.evaluate(async () => {
        const invoke = window.__TAURI_INTERNALS__.invoke,
          s = await invoke("document_state");
        await invoke("favorite_action", {
          id: s.id,
          revision: s.revision,
          action: "file",
          kind: "file",
          entry: "C:\\untrusted.md",
        });
      });
      assert.equal(await readFile(store, "utf8"), first);
      await page.locator(".doc-title").click({ button: "right" });
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await idle();
      assert.equal(await rows().count(), 2);
      await pick(b);
      await favoriteTab();
      await page.locator("#favorite-file").click();
      await idle();
      assert.deepEqual(
        await rows().evaluateAll((ns) => ns.map((n) => n.dataset.path)),
        [b, dir, a],
      );
      assert.equal(
        await page
          .locator("#favorites-list [aria-current]")
          .getAttribute("data-path"),
        b,
      );
      await page.screenshot({
        path: path.resolve("test-results/favorites-populated.png"),
      });
      const stable = await readFile(store, "utf8");
      await openFavorite(a);
      await idle();
      assert.equal(await page.locator("#filepath").getAttribute("title"), a);
      assert.equal(await readFile(store, "utf8"), stable);
      await page.locator("#split-mode").click();
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.insertText("\n收藏草稿");
      const draft = await page.locator(".cm-content").innerText();
      await openFavorite(a);
      assert(await page.locator("#confirm-dialog").isHidden());
      assert.equal(await page.locator(".cm-content").innerText(), draft);
      await openFavorite(b);
      await page.locator("button[value=cancel]").click();
      await idle();
      assert.equal(await readFile(store, "utf8"), stable);
      await rename(b, b + ".moved");
      await openFavorite(b);
      await page.locator("button[value=discard]").click();
      await idle();
      assert.equal(await page.locator(".cm-content").innerText(), draft);
      assert(await page.locator(".favorite-error").isVisible());
      assert.equal(await readFile(store, "utf8"), stable);
      await page.screenshot({
        path: path.resolve("test-results/favorites-missing.png"),
      });
      await rename(b + ".moved", b);
      await writeFile(a, "外部冲突");
      await openFavorite(b);
      await page.locator("button[value=save]").click();
      await idle();
      assert.equal(await page.locator(".cm-content").innerText(), draft);
      await writeFile(a, "# 收藏甲\n原文");
      await openFavorite(b);
      await page.locator("button[value=save]").click();
      await idle();
      assert.equal(await page.locator("#filepath").getAttribute("title"), b);
      assert.equal(await page.locator(".favorite-error").count(), 0);
      assert((await readFile(a, "utf8")).includes("收藏草稿"));
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.insertText("\n目录浏览保留草稿");
      const folderDraft = await page.locator(".cm-content").innerText(),
        historyBefore = await readFile(historyStore, "utf8");
      await openFavorite(dir, "folder");
      await idle();
      assert.equal(
        await page.locator("#folder-path").getAttribute("title"),
        dir,
      );
      assert(await page.locator("#folder-up").isDisabled());
      assert(await page.locator("#confirm-dialog").isHidden());
      assert.equal(await page.locator(".cm-content").innerText(), folderDraft);
      assert.equal(await readFile(historyStore, "utf8"), historyBefore);
      await favoriteTab();
      await rename(dir, dir + ".moved");
      await openFavorite(dir, "folder");
      await idle();
      assert(await page.locator(".favorite-error").isVisible());
      assert.equal(await page.locator(".cm-content").innerText(), folderDraft);
      assert.equal(
        await page.locator("#folder-path").getAttribute("title"),
        dir,
      );
      await rename(dir + ".moved", dir);
      await openFavorite(dir, "folder");
      await idle();
      await page
        .locator("#folder-directories button", { hasText: "空目录" })
        .click();
      await idle();
      await page
        .locator("#folder-panel")
        .click({ button: "right", position: { x: 20, y: 20 } });
      await page.locator("#menu-favorite-folder").click();
      await idle();
      await favoriteTab();
      await openFavorite(empty, "folder");
      await idle();
      assert.equal(
        await page.locator("#folder-empty").innerText(),
        "此文件夹为空",
      );
      assert.equal(await page.locator(".cm-content").innerText(), folderDraft);
      await favoriteTab();
      await removeFavorite(b);
      await removeFavorite(dir);
      assert.equal(await readFile(b, "utf8"), "# 收藏乙");
      assert.equal(await page.locator(".cm-content").innerText(), folderDraft);
      assert.equal(await readFile(historyStore, "utf8"), historyBefore);
      const beforeFailure = await readFile(store, "utf8");
      await rename(store, store + ".saved");
      await mkdir(store);
      await page.locator("#favorite-file").click();
      await idle();
      assert(
        (await page.locator("#favorites-warning").innerText()).includes(
          "已保留原列表",
        ),
      );
      assert.equal(await rows().count(), 2);
      assert.equal(await readFile(store + ".saved", "utf8"), beforeFailure);
      await page.screenshot({
        path: path.resolve("test-results/favorites-write-failure.png"),
      });
      await rmdir(store);
      await rename(store + ".saved", store);
      await page.locator("#favorite-file").click();
      await idle();
      assert.equal(await rows().count(), 3);
      const afterAdd = await readFile(store, "utf8");
      await rename(store, store + ".saved");
      await mkdir(store);
      await removeFavorite(b);
      assert.equal(await rows().count(), 3);
      await rmdir(store);
      await rename(store + ".saved", store);
      assert.equal(await readFile(store, "utf8"), afterAdd);
      await removeFavorite(b);
      assert.equal(await rows().count(), 2);
      assert(await page.locator("#favorites-warning").isHidden());
      const denied = await page.evaluate(async (root) => {
        const invoke = window.__TAURI_INTERNALS__.invoke,
          s = await invoke("document_state");
        let count = 0;
        for (const request of [
          { id: "stale", revision: s.revision, action: "file", kind: "file" },
          {
            id: s.id,
            revision: s.revision,
            action: "remove",
            kind: "file",
            entry: root,
          },
        ]) {
          try {
            await invoke("favorite_action", request);
          } catch {
            count++;
          }
        }
        try {
          await invoke("navigate_folder", {
            id: s.id,
            revision: s.revision,
            action: "favorite",
            entry: root,
          });
        } catch {
          count++;
        }
        return count;
      }, root);
      assert.equal(denied, 3);
      await page.locator("#home-back").click();
      await page.locator("button[value=discard]").click();
      await page.locator("#home").waitFor({ state: "visible" });
      await stop();
      await restart();
      await page.locator("#home-favorites").click();
      assert.deepEqual(
        await rows().evaluateAll((ns) => ns.map((n) => n.dataset.path)),
        [empty, a],
      );
      assert.equal(
        await page.locator("#favorites-list [aria-current]").count(),
        0,
      );
      await openFavorite(empty, "folder");
      await idle();
      assert(await page.locator("#panes").isHidden());
      assert.equal(
        await page.locator("#folder-welcome-title").innerText(),
        "此文件夹为空",
      );
      await favoriteTab();
      await openFavorite(a);
      await idle();
      assert.equal(await page.locator("#filepath").getAttribute("title"), a);
      await removeFavorite(empty);
      await removeFavorite(a);
      assert(
        (await page.locator("#favorites-list").innerText()).includes(
          "暂无收藏",
        ),
      );
      assert((await readFile(a, "utf8")).includes("收藏草稿"));
      await stop();
      const entries = Array.from({ length: 40 }, (_, i) => ({
        kind: i % 2 ? "file" : "folder",
        path: path.join(root, "很长的收藏名称-" + i + "-".repeat(50)),
        addedAt: 1000 + i,
      }));
      await writeFile(store, JSON.stringify({ schemaVersion: 1, entries }));
      await restart();
      await page.locator("#home-favorites").click();
      assert.equal(
        await rows().first().getAttribute("data-path"),
        entries[39].path,
      );
      for (const [width, height] of [
        [1320, 860],
        [850, 560],
      ]) {
        await page.setViewportSize({ width, height });
        assert(
          await page
            .locator("#favorites-list")
            .evaluate(
              (e) =>
                e.scrollHeight > e.clientHeight &&
                e.scrollWidth <= e.clientWidth + 1,
            ),
        );
        await page.screenshot({
          path: path.resolve(`test-results/favorites-${width}.png`),
        });
      }
      await stop();
      for (const raw of [
        "{bad",
        JSON.stringify({ schemaVersion: 99, entries: [] }),
      ]) {
        await writeFile(store, raw);
        await restart();
        await page.locator("#home-favorites").click();
        assert(
          (await page.locator("#favorites-warning").innerText()).includes(
            "暂停变更",
          ),
        );
        await pick(a);
        await favoriteTab();
        assert(await page.locator("#favorite-file").isDisabled());
        const rejected = await page.evaluate(async () => {
          const invoke = window.__TAURI_INTERNALS__.invoke,
            s = await invoke("document_state");
          try {
            await invoke("favorite_action", {
              id: s.id,
              revision: s.revision,
              action: "file",
              kind: "file",
            });
            return false;
          } catch {
            return true;
          }
        });
        assert(rejected);
        assert.equal(await readFile(store, "utf8"), raw);
        await stop();
      }
      await writeFile(store, JSON.stringify({ schemaVersion: 1, entries: [] }));
      await writeFile(
        historyStore,
        JSON.stringify({ schemaVersion: 1, entries: [] }),
      );
      await restart();
      assert.deepEqual(errors, []);
      console.log(
        "PASS: favorites empty/home/context menu cancel and keyboard, file/folder add/dedup/stable sort/current marker, reopen/cancel/conflict/missing retry and draft preservation, directory root/empty/no implicit open, remove without file deletion, real add/remove write failure rollback and retry, restricted IPC, actual restart, long-list layout, corrupt/future records protected.",
      );
    }
    if (historyRun) {
      const historyFile = path.join(root, "app-data", "history.json");
      const a = path.join(root, "历史甲", "同名.md");
      const b = path.join(root, "历史乙", "同名.md");
      const c = path.join(root, "未登记.md");
      await mkdir(path.dirname(a));
      await mkdir(path.dirname(b));
      await writeFile(a, "# 历史甲\n原文");
      await writeFile(b, "# 历史乙");
      await writeFile(c, "# 未登记");
      const historyRows = () => page.locator("#history-list button");
      // Paths, rather than duplicate labels, identify the tested row.
      async function clickHistory(filePath) {
        const index = (
          await historyRows().evaluateAll((nodes) =>
            nodes.map((n) => n.dataset.path),
          )
        ).indexOf(filePath);
        assert(index >= 0, filePath + " registered");
        await historyRows().nth(index).click();
      }
      async function waitPath(filePath) {
        await waitFor(
          async () =>
            (await page.locator("#filepath").getAttribute("title")) ===
              filePath && !(await page.locator("#open").isDisabled()),
          "history opened " + filePath,
        );
      }
      async function pick(filePath) {
        await page
          .locator(
            (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
          )
          .click();
        await dialog(filePath);
        await waitPath(filePath);
      }
      async function stop() {
        await closeWindow();
        await waitFor(() => app.exitCode !== null, "history process exit");
        await browser.close().catch(() => {});
        await waitFor(async () => {
          try {
            await fetch(`http://127.0.0.1:${port}/json/version`);
            return false;
          } catch {
            return true;
          }
        }, "history endpoint closed");
      }
      async function restart() {
        app = startApp();
        page = await connectPage();
        await page.locator("#home-history:not([disabled])").waitFor();
      }
      await page.locator("#home-history:not([disabled])").click();
      assert(
        (await page.locator("#history-list").innerText()).includes(
          "暂无历史记录",
        ),
      );
      assert(await page.locator("#panes").isHidden());
      await page.locator("#folder-home").click();
      await page.locator("#home").waitFor({ state: "visible" });
      await pick(a);
      await pick(b);
      await page.locator("#tab-history").click();
      assert.deepEqual(
        await historyRows().evaluateAll((nodes) =>
          nodes.map((n) => n.dataset.path),
        ),
        [b, a],
      );
      assert.equal(
        await page
          .locator("#history-list [aria-current]")
          .getAttribute("data-path"),
        b,
      );
      await clickHistory(a);
      await waitPath(a);
      assert.equal(await historyRows().first().getAttribute("data-path"), a);
      await page.locator("#split-mode").click();
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.insertText("\n历史未保存草稿");
      const draft = await page.locator(".cm-content").innerText();
      const before = await readFile(historyFile, "utf8");
      await clickHistory(a);
      assert(await page.locator("#confirm-dialog").isHidden());
      assert.equal(await page.locator(".cm-content").innerText(), draft);
      await clickHistory(b);
      await page.locator("#confirm-dialog[open]").waitFor();
      await page.locator("button[value=cancel]").click();
      await waitPath(a);
      assert.equal(await readFile(historyFile, "utf8"), before);
      await rename(b, b + ".moved");
      await clickHistory(b);
      await page.locator("button[value=discard]").click();
      await page.locator("#history-list .history-error").waitFor();
      await waitPath(a);
      assert.equal(await page.locator(".cm-content").innerText(), draft);
      assert.equal(await readFile(historyFile, "utf8"), before);
      await page.screenshot({
        path: path.resolve("test-results/history-missing.png"),
      });
      await rename(b + ".moved", b);
      await writeFile(a, "外部冲突");
      await clickHistory(b);
      await page.locator("button[value=save]").click();
      await page.locator("#error:not([hidden])").waitFor();
      await waitPath(a);
      assert.equal(await page.locator(".cm-content").innerText(), draft);
      assert.equal(await readFile(historyFile, "utf8"), before);
      await writeFile(a, "# 历史甲\n原文");
      await clickHistory(b);
      await page.locator("button[value=save]").click();
      await waitPath(b);
      assert((await readFile(a, "utf8")).includes("历史未保存草稿"));
      assert.equal(
        await page.locator("#history-list .history-error").count(),
        0,
      );
      const saved = await readFile(historyFile, "utf8");
      await page.locator("#open").click();
      await dialog("", true);
      await waitPath(b);
      assert.equal(await readFile(historyFile, "utf8"), saved);
      const unregistered = await page.evaluate(async (path) => {
        const invoke = window.__TAURI_INTERNALS__.invoke,
          s = await invoke("document_state");
        try {
          await invoke("document_action", {
            id: s.id,
            revision: s.revision,
            name: "open-history",
            discard: false,
            entry: path,
          });
          return false;
        } catch {
          return true;
        }
      }, c);
      assert(unregistered);
      // A real filesystem replacement failure must not roll back a successful open.
      await rename(historyFile, historyFile + ".saved");
      await mkdir(historyFile);
      await pick(c);
      await page.locator("#tab-history").click();
      assert(
        (await page.locator("#history-warning").innerText()).includes(
          "未能保存",
        ),
      );
      assert.equal(await historyRows().first().getAttribute("data-path"), c);
      assert.equal(await readFile(historyFile + ".saved", "utf8"), saved);
      await page.screenshot({
        path: path.resolve("test-results/history-write-failure.png"),
      });
      await rmdir(historyFile);
      await rename(historyFile + ".saved", historyFile);
      await page.locator("#history-retry").click();
      await page.locator("#history-warning").waitFor({ state: "hidden" });
      assert.equal(
        JSON.parse(await readFile(historyFile, "utf8")).entries[0].path,
        c,
      );
      await stop();
      await restart();
      await page.locator("#home-history").click();
      assert.deepEqual(
        await historyRows().evaluateAll((nodes) =>
          nodes.map((n) => n.dataset.path),
        ),
        [c, b, a],
      );
      assert.equal(
        await page.locator("#history-list [aria-current]").count(),
        0,
      );
      await clickHistory(b);
      await waitPath(b);
      assert.equal(
        await page
          .locator("#history-list [aria-current]")
          .getAttribute("data-path"),
        b,
      );
      const dates = await page.evaluate(() => {
        const now = new Date();
        return [
          now.getTime(),
          new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - 1,
            12,
          ).getTime(),
          new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - 5,
            12,
          ).getTime(),
        ];
      });
      await stop();
      const seeded = [
        { path: a, openedAt: dates[0] },
        { path: b, openedAt: dates[1] },
        ...Array.from({ length: 35 }, (_, i) => ({
          path: path.join(root, "旧文档 " + i + ".md"),
          openedAt: dates[2] - i,
        })),
      ];
      await writeFile(
        historyFile,
        JSON.stringify({ schemaVersion: 1, entries: seeded }),
      );
      await restart();
      await page.locator("#home-history").click();
      const groups = await page.locator("#history-list h3").allTextContents();
      assert.equal(groups[0], "今天");
      assert.equal(groups[1], "昨天");
      assert.match(groups[2], /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(groups.length, 3);
      for (const [width, height] of [
        [1320, 860],
        [850, 560],
      ]) {
        await page.setViewportSize({ width, height });
        assert(
          await page
            .locator("#history-list")
            .evaluate(
              (e) =>
                e.scrollHeight > e.clientHeight &&
                e.scrollWidth <= e.clientWidth + 1,
            ),
        );
        await page.screenshot({
          path: path.resolve("test-results/history-" + width + ".png"),
        });
      }
      await clickHistory(a);
      await waitPath(a);
      assert.equal(
        (
          await historyRows().evaluateAll((nodes) =>
            nodes.map((n) => n.dataset.path),
          )
        ).filter((p) => p === a).length,
        1,
      );
      await stop();
      for (const raw of [
        "{broken",
        JSON.stringify({ schemaVersion: 99, entries: [] }),
      ]) {
        await writeFile(historyFile, raw);
        await restart();
        await page.locator("#home-history").click();
        assert(
          (await page.locator("#history-warning").innerText()).includes(
            "暂停写入",
          ),
        );
        assert(await page.locator("#history-retry").isHidden());
        await pick(c);
        await page.locator("#tab-history").click();
        assert.equal(await readFile(historyFile, "utf8"), raw);
        assert.equal(await historyRows().first().getAttribute("data-path"), c);
        await stop();
      }
      await writeFile(
        historyFile,
        JSON.stringify({ schemaVersion: 1, entries: [] }),
      );
      await restart();
      assert.deepEqual(errors, []);
      console.log(
        "PASS: history empty/home entry, successful-open MRU/dedup/same-name paths/current marker, current dirty no-op, cancel/save/conflict/missing-file preservation and retry, unregistered IPC rejection, real persistence write failure/retry, actual restart, seeded local date groups/scroll layout, corrupt/future schema preservation.",
      );
    }
    if (outlineRun) {
      const outlineFile = path.join(root, "分级 重名大纲.md");
      const plainFile = path.join(root, "无标题.md");
      const emptyFile = path.join(root, "空大纲.md");
      const hugeFile = path.join(root, "延迟大纲.md");
      const filler = Array.from({ length: 12 }, (_, i) => "正文段落 " + i).join(
        "\n\n",
      );
      const sections = [
        "### 孤立三级",
        "# 一级",
        "## 重复",
        "### 三级",
        "#### 四级",
        "##### 五级",
        "###### 六级",
        "## 重复",
        "#### 跳级",
        "#",
        "## **加粗**与\`代码\`",
        "Setext 标题\n----------",
      ];
      const source =
        filler +
        "\n\n" +
        sections.map((h) => h + "\n\n" + filler).join("\n\n") +
        "\n\n\`\`\`md\n# 代码中的假标题\n\`\`\`\n";
      await writeFile(outlineFile, source);
      await writeFile(plainFile, "普通文字\n\n~~~md\n# 不是真标题\n~~~\n");
      await writeFile(emptyFile, "");
      await writeFile(hugeFile, "# 延迟标题\n\n" + "x".repeat(1024 * 1024 + 1));
      const labels = page.locator("#outline .outline-label");
      const rows = page.locator("#outline .outline-row");
      const currentHeading = page.locator(
        "#outline .outline-label[aria-current=location]",
      );
      async function openOutline(filePath, expectedCount) {
        await page
          .locator(
            (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
          )
          .click();
        await dialog(filePath);
        await waitFor(
          async () =>
            (await page.locator("#filepath").getAttribute("title")) ===
            filePath,
          "opened outline file",
        );
        await page.locator("#document-view").waitFor({ state: "visible" });
        await page.locator("#tab-outline").click();
        await waitFor(
          async () => (await labels.count()) === expectedCount,
          "outline count " + expectedCount,
        );
      }
      await openOutline(outlineFile, 12);
      assert.deepEqual(await labels.allTextContents(), [
        "孤立三级",
        "一级",
        "重复",
        "三级",
        "四级",
        "五级",
        "六级",
        "重复",
        "跳级",
        "无标题",
        "加粗与代码",
        "Setext 标题",
      ]);
      assert.deepEqual(
        await rows.evaluateAll((nodes) =>
          nodes.map((n) => Number(n.dataset.level)),
        ),
        [3, 1, 2, 3, 4, 5, 6, 2, 4, 1, 2, 2],
      );
      assert.deepEqual(
        await rows.evaluateAll((nodes) =>
          nodes.map(
            (n) =>
              n.parentElement.parentElement.parentElement
                ?.querySelector(":scope > .outline-row")
                ?.getAttribute("data-level") || null,
          ),
        ),
        [null, null, "1", "2", "3", "4", "5", "1", "2", null, "1", "1"],
      );
      await page.locator("#preview-scroll").evaluate((e) => (e.scrollTop = 0));
      await waitFor(
        async () => (await currentHeading.count()) === 0,
        "no current before first heading",
      );
      const readingLine = await labels.nth(3).getAttribute("data-line");
      await page.locator("#line-" + readingLine).evaluate((e) => {
        const scroller = document.getElementById("preview-scroll");
        scroller.scrollTop +=
          e.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          24;
      });
      await waitFor(
        async () =>
          (await currentHeading.getAttribute("data-line")) === readingLine,
        "reading scroll follow",
      );
      const sourceBefore = await readFile(outlineFile, "utf8");
      const duplicateLines = [
        await labels.nth(2).getAttribute("data-line"),
        await labels.nth(7).getAttribute("data-line"),
      ];
      assert.notEqual(...duplicateLines);
      for (const i of [2, 7, 6, 11]) {
        await labels.nth(i).click();
        await waitFor(
          async () =>
            (await currentHeading.getAttribute("data-line")) ===
            (await labels.nth(i).getAttribute("data-line")),
          "clicked heading",
        );
        const line = await labels.nth(i).getAttribute("data-line");
        assert(
          await page
            .locator("#line-" + line)
            .evaluate(
              (e) =>
                Math.abs(
                  e.getBoundingClientRect().top -
                    document
                      .getElementById("preview-scroll")
                      .getBoundingClientRect().top -
                    24,
                ) < 2,
            ),
        );
      }
      const parentToggle = rows.nth(1).locator(".outline-toggle");
      await labels.nth(6).click();
      await parentToggle.focus();
      await page.keyboard.press("Space");
      assert.equal(await parentToggle.getAttribute("aria-expanded"), "false");
      assert(await labels.nth(6).isHidden());
      assert(
        await rows
          .nth(1)
          .evaluate((e) => e.classList.contains("contains-current")),
      );
      assert.equal(await page.locator("#preview h6").count(), 1);
      await page.screenshot({
        path: path.resolve("test-results/outline-collapsed.png"),
      });
      const scrollBeforeCollapse = await page
        .locator("#preview-scroll")
        .evaluate((e) => e.scrollTop);
      await page.keyboard.press("Enter");
      assert(await labels.nth(6).isVisible());
      assert.equal(
        await page.locator("#preview-scroll").evaluate((e) => e.scrollTop),
        scrollBeforeCollapse,
      );
      await parentToggle.click();
      await page.locator("#refresh").click();
      await waitFor(
        async () =>
          (await parentToggle.getAttribute("aria-expanded")) === "false",
        "collapse preserved on refresh",
      );
      await page.locator("#tab-files").click();
      await page.locator("#tab-outline").click();
      assert.equal(await parentToggle.getAttribute("aria-expanded"), "false");
      await page.locator("#open").click();
      await dialog("", true);
      assert.equal(await parentToggle.getAttribute("aria-expanded"), "false");
      await parentToggle.click();
      // Track real preview scroll, even with split scrolling disabled; never steal focus.
      await page.locator("#split-mode").click();
      await page.locator("#sync-scroll").uncheck();
      await page.locator("#refresh").focus();
      for (const i of [3, 7]) {
        const line = await labels.nth(i).getAttribute("data-line");
        await page.locator("#line-" + line).evaluate((e) => {
          const scroller = document.getElementById("preview-scroll");
          scroller.scrollTop +=
            e.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top -
            24;
        });
        await waitFor(
          async () => (await currentHeading.getAttribute("data-line")) === line,
          "scroll follows heading",
        );
        assert(
          await page
            .locator("#refresh")
            .evaluate((e) => e === document.activeElement),
        );
      }
      await page
        .locator("#preview-scroll")
        .evaluate((e) => (e.scrollTop = e.scrollHeight));
      await waitFor(
        async () => (await currentHeading.innerText()) === "Setext 标题",
        "bottom follows last heading",
      );
      for (const [width, height] of [
        [1320, 860],
        [850, 560],
      ]) {
        await page.setViewportSize({ width, height });
        await labels.nth(6).click();
        assert(
          await page
            .locator("#outline")
            .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        );
        await page.screenshot({
          path: path.resolve("test-results/outline-" + width + ".png"),
        });
      }
      await page.setViewportSize({ width: 1320, height: 860 });
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+Home");
      await page.keyboard.insertText("新增段落\n\n");
      await waitFor(
        async () =>
          Number(await labels.nth(2).getAttribute("data-line")) ===
          Number(duplicateLines[0]) + 2,
        "updated source mapping",
      );
      await labels.nth(2).click();
      await page.locator("#open").click();
      await page.locator("#confirm-dialog[open]").waitFor();
      await page.locator("button[value=cancel]").click();
      assert(
        (await page.locator(".cm-content").innerText()).startsWith("新增段落"),
      );
      assert.equal(await readFile(outlineFile, "utf8"), sourceBefore);
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.insertText("\n## 新增标题\n");
      await waitFor(
        async () => (await labels.count()) === 13,
        "heading insertion",
      );
      assert.equal(await labels.last().innerText(), "新增标题");
      await page.keyboard.press("Control+z");
      await waitFor(
        async () => (await labels.count()) === 12,
        "heading removal undo",
      );
      await page.locator("#home-back").click();
      await page.locator("#confirm-dialog[open]").waitFor();
      await page.locator("button[value=discard]").click();
      await page.locator("#home").waitFor({ state: "visible" });
      await openOutline(plainFile, 0);
      assert.equal(
        await page.locator("#outline").innerText(),
        "此文档没有标题",
      );
      assert.equal(await page.locator("#heading-count").innerText(), "0");
      await page.screenshot({
        path: path.resolve("test-results/outline-empty.png"),
      });
      const shortFile = path.join(root, "短文同屏标题.md");
      await writeFile(shortFile, "# 首个\n## 中间\n### 最后\n");
      await openOutline(shortFile, 3);
      await labels.nth(1).click();
      await waitFor(
        async () => (await currentHeading.innerText()) === "中间",
        "short document explicit target",
      );
      await page.setViewportSize({ width: 1200, height: 800 });
      assert.equal(await currentHeading.innerText(), "中间");
      await page.setViewportSize({ width: 1320, height: 860 });
      await openOutline(emptyFile, 0);
      assert.equal(
        await page.locator("#outline").innerText(),
        "此文档没有标题",
      );
      await openOutline(hugeFile, 0);
      assert((await page.locator("#outline").innerText()).includes("点击刷新"));
      await page.locator("#refresh").click();
      await waitFor(
        async () => (await labels.count()) === 1,
        "manual large preview outline",
      );
      await openOutline(outlineFile, 12);
      assert.equal(await parentToggle.getAttribute("aria-expanded"), "true");
      await page.locator("#split-mode").click();
      await page.locator("#sync-scroll").check();
      await page.locator("#home-back").click();
      await page.locator("#home").waitFor({ state: "visible" });
      assert.deepEqual(errors, []);
      console.log(
        "PASS: H1-H6 hierarchy/skipped levels/Setext, duplicate source-line jumps, empty headings/documents, keyboard collapse/current ancestor, refresh/tab/cancel preservation, preview scroll tracking/focus, source line updates/heading edit/undo, large-document manual refresh, responsive outline.",
      );
    }
    if (settingsRun) {
      await page.locator("#home-settings:not([disabled])").waitFor();
      assert.equal(
        await page.evaluate(() => localStorage.getItem("mdmd.settings")),
        null,
      );
      await page.locator("#home-settings").click();
      await page.locator("#settings-general").click();
      const modal = page.locator("#settings-dialog");
      assert(await page.locator("#setting-wordcount").isChecked());
      assert.equal(
        await page.locator(".settings-nav button:disabled").count(),
        0,
      );
      assert.equal(
        await page.locator(".settings-nav [aria-current=page]").innerText(),
        "通用",
      );
      for (const [width, height] of [
        [1320, 860],
        [850, 560],
        [640, 720],
      ]) {
        await page.setViewportSize({ width, height });
        // General settings now scroll; verify the control is reachable rather
        // than requiring every setting to fit on the first screen.
        await page.locator("#setting-wordcount").scrollIntoViewIfNeeded();
        const layout = await modal.evaluate((dialog) => {
          const box = dialog.getBoundingClientRect();
          const close = dialog
            .querySelector("#settings-close")
            .getBoundingClientRect();
          const control = dialog
            .querySelector("#setting-wordcount")
            .getBoundingClientRect();
          return {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            overflow: dialog.scrollWidth > dialog.clientWidth,
            closeBottom: close.bottom,
            controlBottom: control.bottom,
          };
        });
        console.log(
          "Settings layout:",
          JSON.stringify({ width, height, ...layout }),
        );
        assert(
          layout.left >= 0 &&
            layout.top >= 0 &&
            layout.right <= width &&
            layout.bottom <= height,
        );
        assert(
          !layout.overflow &&
            layout.closeBottom <= height &&
            layout.controlBottom <= height,
        );
        await page.screenshot({
          path: path.resolve(`test-results/settings-${width}.png`),
        });
      }
      await page.setViewportSize({ width: 1320, height: 860 });
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        assert(await modal.evaluate((e) => e.contains(document.activeElement)));
      }
      await page.locator("#settings-close").focus();
      await page.keyboard.press("Shift+Tab");
      assert(
        await page
          .locator("#setting-link-preview")
          .evaluate((e) => e === document.activeElement),
      );
      for (const key of [
        "Control+o",
        "Control+n",
        "Control+s",
        "Control+f",
        "F3",
      ])
        await page.keyboard.press(key);
      assert(await modal.evaluate((e) => e.open));
      assert(await page.locator("#home").isVisible());
      await page.locator("#setting-wordcount").uncheck();
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("mdmd.settings")),
        ),
        {
          schemaVersion: 16,
          taskStrike: true,
          doubleClickEdit: false,
          toolbarVisibility: {
            modes: true,
            external: true,
            format: true,
            insert: true,
          },
          autoSave: false,
          linkPreview: true,
          language: "system",
          titleFormat: "path",
          customCss: { enabled: false, source: "" },
          appearance: { palette: "default", corners: "rounded", custom: [] },
          shortcuts: {
            scheme: "mdmd",
            overrides: { mdmd: {}, typora: {}, obsidian: {} },
          },
          navigation: { history: true, favorites: true, files: true },
          showWordCount: false,
          theme: "system",
          typography: defaultTypography,
        },
      );
      await page.keyboard.press("Escape");
      assert(await modal.isHidden());
      assert(
        await page
          .locator("#home-settings")
          .evaluate((e) => e === document.activeElement),
      );
      await page.locator("#home-open").click();
      await dialog(file);
      await page.locator("#document-view").waitFor({ state: "visible" });
      assert(await page.locator("#wordcount").isHidden());
      await page.locator("#document-settings").click();
      await page.locator("#settings-general").click();
      assert(!(await page.locator("#setting-wordcount").isChecked()));
      await page.locator("#setting-wordcount").check();
      await page.locator("#settings-close").click();
      assert(await page.locator("#wordcount").isVisible());
      assert(
        await page
          .locator("#document-settings")
          .evaluate((e) => e === document.activeElement),
      );
      await page.locator("#split-mode").click();
      const editor = page.locator(".cm-content");
      await editor.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.insertText("\n设置期间草稿");
      const draft = await editor.innerText();
      await page.keyboard.press("Control+,");
      await page.locator("#settings-general").click();
      await modal.waitFor({ state: "visible" });
      await page.locator("#setting-wordcount").uncheck();
      await page.keyboard.press("Escape");
      assert.equal(await editor.innerText(), draft);
      assert(await editor.evaluate((e) => e === document.activeElement));
      assert((await page.locator("#filename").innerText()).startsWith("●"));
      assert.equal(await readFile(file, "utf8"), original);
      await page.keyboard.press("Control+,");
      await page.locator("#settings-general").click();
      await closeWindow();
      await page.locator("#confirm-dialog[open]").waitFor();
      assert(await modal.isHidden());
      await page.locator("button[value=cancel]").click();
      assert.equal(await editor.innerText(), draft);
      await page.locator("#home-back").click();
      await page.locator("button[value=discard]").click();
      await page.locator("#home").waitFor({ state: "visible" });

      // Restart the actual EXE with the same isolated WebView2 profile.
      await closeWindow();
      await waitFor(() => app.exitCode !== null, "settings first process exit");
      await browser.close().catch(() => {});
      await waitFor(async () => {
        try {
          await fetch(`http://127.0.0.1:${port}/json/version`);
          return false;
        } catch {
          return true;
        }
      }, "old debugging endpoint closed");
      app = startApp();
      page = await connectPage();
      await page.locator("#home-settings:not([disabled])").waitFor();
      await page.keyboard.press("Control+,");
      await page.locator("#settings-general").click();
      assert(!(await page.locator("#setting-wordcount").isChecked()));
      // Inject a storage write failure, not a simulated success response.
      await page.evaluate(() => {
        window.savedSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "mdmd.settings")
            throw new DOMException("test quota", "QuotaExceededError");
          return window.savedSetItem.call(this, key, value);
        };
      });
      await page.locator("#setting-wordcount").click();
      assert(!(await page.locator("#setting-wordcount").isChecked()));
      assert(
        (await page.locator("#settings-message").innerText()).includes(
          "保存失败",
        ),
      );
      assert.equal(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("mdmd.settings")).showWordCount,
        ),
        false,
      );
      await page.screenshot({
        path: path.resolve("test-results/settings-save-failure.png"),
      });
      await page.evaluate(() => {
        Storage.prototype.setItem = window.savedSetItem;
        delete window.savedSetItem;
      });
      await page.locator("#setting-wordcount").check();
      assert.equal(
        await page.locator("#settings-message").innerText(),
        "已保存",
      );
      await page.keyboard.press("Escape");
      await page.evaluate(() =>
        localStorage.setItem("mdmd.settings", "{broken"),
      );
      await page.reload();
      await page.locator("#home-settings:not([disabled])").waitFor();
      await page.locator("#home-settings").click();
      await page.locator("#settings-general").click();
      assert(
        (await page.locator("#settings-message").innerText()).includes(
          "读取失败",
        ),
      );
      assert(await page.locator("#setting-wordcount").isChecked());
      assert.equal(
        await page.evaluate(() => localStorage.getItem("mdmd.settings")),
        "{broken",
      );
      await page.locator("#setting-wordcount").uncheck();
      assert.equal(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("mdmd.settings")).showWordCount,
        ),
        false,
      );
      await page.keyboard.press("Escape");
      const future = JSON.stringify({
        schemaVersion: 99,
        showWordCount: false,
      });
      await page.evaluate(
        (value) => localStorage.setItem("mdmd.settings", value),
        future,
      );
      await page.reload();
      await page.locator("#home-settings:not([disabled])").waitFor();
      await page.locator("#home-settings").click();
      await page.locator("#settings-general").click();
      assert(await page.locator("#setting-wordcount").isDisabled());
      assert(
        (await page.locator("#settings-message").innerText()).includes(
          "版本暂不支持",
        ),
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem("mdmd.settings")),
        future,
      );
      await page.keyboard.press("Escape");
      await page.evaluate(() =>
        localStorage.setItem(
          "mdmd.settings",
          JSON.stringify({ schemaVersion: 1, showWordCount: true }),
        ),
      );
      await page.reload();
      await page.locator("#home-settings:not([disabled])").waitFor();
      assert.equal(await readFile(file, "utf8"), original);
      console.log(
        "PASS: settings entry/layout/focus/shortcuts, immediate shared counter visibility, dirty document preservation/close guard, real process restart persistence, write failure rollback/retry, corrupt record recovery, future schema protection.",
      );
    }
    if (folderRun) {
      await page.setViewportSize({ width: 1320, height: 860 });
      await page.locator("#home-folder:not([disabled])").waitFor();
      const emptyRoot = path.join(root, "空 目录");
      const mixedRoot = path.join(root, "中文 文件夹");
      await mkdir(emptyRoot);
      await mkdir(mixedRoot);
      await mkdir(path.join(mixedRoot, "子目录"));
      await writeFile(path.join(mixedRoot, "子目录", "不递归.md"), "nested");
      await writeFile(path.join(mixedRoot, "说明.txt"), "not listed");
      await page.locator("#home-folder").click();
      assert(await page.locator("#home-open").isDisabled());
      await dialog("", true);
      await waitFor(
        () => page.locator("#home-folder").isEnabled(),
        "folder cancel",
      );
      assert(await page.locator("#home").isVisible());
      assert(
        await page
          .locator("#home-folder")
          .evaluate((e) => e === document.activeElement),
      );
      assert.deepEqual(await readdir(emptyRoot), []);

      // Controlled backend rejection verifies UI rollback; filesystem errors are separately exercised in Rust.
      await page.evaluate(() => {
        window.folderOriginalFetch = window.fetch;
        window.folderFailureInjected = false;
        window.fetch = (input, init) => {
          if (
            String(input) ===
            window.__TAURI_INTERNALS__.convertFileSrc("select_folder", "ipc")
          ) {
            window.folderFailureInjected = true;
            return Promise.resolve(
              new Response(JSON.stringify("无法读取文件夹：模拟读取失败"), {
                headers: {
                  "Content-Type": "application/json",
                  "Tauri-Response": "error",
                },
              }),
            );
          }
          return window.folderOriginalFetch(input, init);
        };
      });
      await page.locator("#home-folder").click();
      await page.locator("#error:not([hidden])").waitFor();
      assert(
        (await page.locator("#error-text").innerText()).includes(
          "模拟读取失败",
        ),
      );
      assert(await page.locator("#home").isVisible());
      assert(await page.evaluate(() => window.folderFailureInjected));
      await page.screenshot({
        path: path.resolve("test-results/folder-failure.png"),
      });
      await page.evaluate(() => {
        window.fetch = window.folderOriginalFetch;
        delete window.folderOriginalFetch;
      });

      await page.locator("#home-folder").click();
      await dialog(emptyRoot);
      await page.locator("#folder-welcome:not([hidden])").waitFor();
      assert(await page.locator("#error").isHidden());
      assert.equal(
        await page.locator("#folder-empty").innerText(),
        "此文件夹为空",
      );
      assert.equal(await page.locator("#folder-path").innerText(), emptyRoot);
      assert.equal(await page.locator("#folder-files button").count(), 0);
      assert(await page.locator("#panes").isHidden());
      assert(await page.locator("#save").isDisabled());
      assert(await page.locator("#document-view footer").isHidden());
      assert(
        await page
          .locator("#folder-home")
          .evaluate((e) => e === document.activeElement),
      );
      await page.keyboard.press("Control+s");
      await page.keyboard.press("Control+n");
      await page.keyboard.press("F3");
      assert(await page.locator("#folder-welcome").isVisible());
      assert.deepEqual(await readdir(emptyRoot), []);
      await page.screenshot({
        path: path.resolve("test-results/folder-empty.png"),
      });
      await page.locator("#folder-home").click();
      await page.locator("#home").waitFor({ state: "visible" });
      await page.locator("#home-folder").click();
      await dialog(mixedRoot);
      await page.locator("#folder-welcome:not([hidden])").waitFor();
      assert.equal(
        await page.locator("#folder-empty").innerText(),
        "此文件夹中没有 Markdown 文件",
      );
      await page.locator("#folder-home").click();
      await page.locator("#home").waitFor({ state: "visible" });
      const firstFile = path.join(mixedRoot, "A.MD");
      await writeFile(firstFile, "# 目录中的文档\n正文");
      await writeFile(path.join(mixedRoot, "b.markdown"), "# 第二篇");
      await writeFile(path.join(mixedRoot, "c.mdown"), "# 第三篇");
      await writeFile(path.join(mixedRoot, "gone.md"), "deleted later");
      await writeFile(
        path.join(mixedRoot, "invalid.md"),
        Buffer.from([0xff, 0xfe]),
      );
      await page.locator("#home-folder").click();
      await dialog(mixedRoot);
      await page.locator("#folder-welcome:not([hidden])").waitFor();
      assert.deepEqual(
        await page.locator("#folder-files .file-name").allTextContents(),
        ["A.MD", "b.markdown", "c.mdown", "gone.md", "invalid.md"],
      );
      assert(await page.locator("#panes").isHidden());
      for (const [width, height] of [
        [1320, 860],
        [850, 560],
      ]) {
        await page.setViewportSize({ width, height });
        const layout = await page.locator(".workspace").evaluate((e) => ({
          overflow: e.scrollWidth > e.clientWidth,
          right: e.getBoundingClientRect().right,
          height: e.clientHeight,
        }));
        assert(!layout.overflow && layout.right <= width && layout.height > 0);
        await page.screenshot({
          path: path.resolve(`test-results/folder-${width}.png`),
        });
      }
      await page.setViewportSize({ width: 1320, height: 860 });
      const item = (name) =>
        page.locator("#folder-files button").filter({
          has: page.locator(".file-name", {
            hasText: new RegExp(`^${name.replaceAll(".", "\\.")}$`),
          }),
        });
      await item("A.MD").click();
      await waitFor(
        () =>
          page
            .locator("#preview h1")
            .innerText()
            .then((s) => s === "目录中的文档"),
        "folder file open",
      );
      assert(await page.locator("#folder-welcome").isHidden());
      assert.equal(
        await page
          .locator("#folder-files [aria-current=page] .file-name")
          .innerText(),
        "A.MD",
      );
      await page.locator("#tab-outline").click();
      assert(await page.locator("#outline").isVisible());
      await page.locator("#tab-files").click();
      await unlink(path.join(mixedRoot, "gone.md"));
      await item("gone.md").click();
      await page.locator("#error:not([hidden])").waitFor();
      assert.equal(
        await page.locator("#preview h1").innerText(),
        "目录中的文档",
      );
      await item("invalid.md").click();
      await waitFor(
        () =>
          page
            .locator("#error-text")
            .innerText()
            .then((s) => /UTF|编码/.test(s)),
        "invalid folder document",
      );
      assert.equal(await page.locator("#filepath").innerText(), firstFile);
      await page.locator("#split-mode").click();
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.insertText("\n保留目录草稿");
      await item("b.markdown").click();
      await page.locator("#confirm-dialog[open]").waitFor();
      await page.locator("button[value=cancel]").click();
      assert(
        (await page.locator(".cm-content").innerText()).includes(
          "保留目录草稿",
        ),
      );
      assert.equal(await readFile(firstFile, "utf8"), "# 目录中的文档\n正文");
      await item("b.markdown").click();
      await page.locator("#confirm-dialog[open]").waitFor();
      await page.locator("button[value=save]").click();
      await waitFor(
        () =>
          page
            .locator("#preview h1")
            .innerText()
            .then((s) => s === "第二篇"),
        "save and switch folder file",
      );
      assert((await readFile(firstFile, "utf8")).includes("保留目录草稿"));
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.insertText("\n放弃这段");
      await item("c.mdown").click();
      await page.locator("#confirm-dialog[open]").waitFor();
      await page.locator("button[value=discard]").click();
      await waitFor(
        () =>
          page
            .locator("#preview h1")
            .innerText()
            .then((s) => s === "第三篇"),
        "discard and switch folder file",
      );
      assert.equal(
        await readFile(path.join(mixedRoot, "b.markdown"), "utf8"),
        "# 第二篇",
      );
      await page.screenshot({
        path: path.resolve("test-results/folder-reading.png"),
      });
      await page.locator("#home-back").click();
      await page.locator("#home").waitFor({ state: "visible" });
      assert.equal(await page.locator("#folder-files button").count(), 0);
      assert(await page.locator("#tab-files").isDisabled());
      assert.deepEqual(errors, []);
      console.log(
        "PASS: native folder selection/cancel, injected read failure/retry, empty/non-Markdown states, shallow filtering/order, no auto-open, file selection/current marker, missing/invalid files preserve document, dirty cancel/save/discard, clear folder on home.",
      );
    }
    if (navigationRun) {
      const navRoot = path.join(root, "导航 根目录");
      const child = path.join(navRoot, "中文 子目录");
      const deep = path.join(child, "更深一层");
      const gone = path.join(child, "失效目录");
      const outsideRoot = path.join(root, "根外目录");
      await mkdir(deep, { recursive: true });
      await mkdir(gone);
      await mkdir(outsideRoot);
      await writeFile(path.join(navRoot, "同名.md"), "# 根目录文档");
      const currentFile = path.join(child, "同名.md");
      await writeFile(currentFile, "# 子目录文档\n原文");
      for (let index = 0; index < 40; index++)
        await writeFile(
          path.join(child, `item-${String(index).padStart(2, "0")}.md`),
          "# 条目",
        );
      await writeFile(path.join(deep, "另一篇.md"), "# 深层文档");
      await writeFile(path.join(outsideRoot, "外部.md"), "# 外部文件");
      await symlink(
        outsideRoot,
        path.join(navRoot, "不可进入的链接"),
        "junction",
      );
      const sub = (name) =>
        page.locator("#folder-directories button").filter({ hasText: name });
      const fileRow = (name) =>
        page
          .locator("#folder-files button")
          .filter({ has: page.locator(".file-name", { hasText: name }) });
      async function expectFolder(expected) {
        await waitFor(
          () =>
            page
              .locator("#folder-path")
              .innerText()
              .then((value) => value === expected),
          "directory " + expected,
        );
        await waitFor(
          () =>
            page
              .locator("#folder-panel")
              .getAttribute("aria-busy")
              .then((value) => value === "false"),
          "navigation idle",
        );
      }
      await page.locator("#home-folder").click();
      await dialog(navRoot);
      await expectFolder(navRoot);
      assert.equal(await page.locator("#folder-directories button").count(), 1);
      assert(await page.locator("#folder-up").isDisabled());
      assert(await page.locator("#folder-locate").isDisabled());
      const bounds = await page.evaluate(async () => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        const s = await invoke("document_state");
        const rejected = [];
        for (const [action, entry] of [
          ["up", null],
          ["child", ".."],
          ["child", "C:\\Windows"],
        ]) {
          try {
            await invoke("navigate_folder", {
              id: s.id,
              revision: s.revision,
              action,
              entry,
            });
            rejected.push(false);
          } catch {
            rejected.push(true);
          }
        }
        return rejected;
      });
      assert.deepEqual(bounds, [true, true, true]);
      await sub("中文 子目录").click();
      await expectFolder(child);
      assert(await page.locator("#folder-welcome").isVisible());
      await fileRow("同名.md").click();
      await waitFor(
        () =>
          page
            .locator("#preview h1")
            .innerText()
            .then((s) => s === "子目录文档"),
        "nested file open",
      );
      await page.locator("#split-mode").click();
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.insertText("\n未保存的导航草稿");
      const draft = await page.locator(".cm-content").innerText();
      await sub("更深一层").click();
      await expectFolder(deep);
      assert(await page.locator("#confirm-dialog").isHidden());
      assert.equal(await page.locator(".cm-content").innerText(), draft);
      assert.equal(await page.locator("#filepath").innerText(), currentFile);
      assert.equal(
        await page.locator("#folder-files [aria-current=page]").count(),
        0,
      );
      await fileRow("另一篇.md").click();
      await page.locator("#confirm-dialog[open]").waitFor();
      await page.locator("button[value=cancel]").click();
      await expectFolder(deep);
      assert.equal(await page.locator(".cm-content").innerText(), draft);
      await page.locator("#folder-locate").click();
      await expectFolder(child);
      assert(
        await page
          .locator("#folder-files [aria-current=page]")
          .evaluate((e) => e === document.activeElement),
      );
      assert(
        await page.locator("#folder-scroll").evaluate((e) => e.scrollTop > 0),
      );
      assert(
        await page
          .locator("#folder-files [aria-current=page]")
          .evaluate((e) => {
            const row = e.getBoundingClientRect(),
              list = document
                .getElementById("folder-scroll")
                .getBoundingClientRect();
            return row.top >= list.top && row.bottom <= list.bottom;
          }),
      );
      assert.equal(await page.locator(".cm-content").innerText(), draft);
      assert.equal(await readFile(currentFile, "utf8"), "# 子目录文档\n原文");
      await page.locator("#folder-up").click();
      await expectFolder(navRoot);
      assert.equal(
        await page.locator("#folder-files [aria-current=page]").count(),
        0,
      );
      assert(
        await sub("中文 子目录").evaluate((e) => e === document.activeElement),
      );
      assert(await page.locator("#folder-up").isDisabled());
      await page.locator("#folder-locate").click();
      await expectFolder(child);

      // Replace a previously listed directory by an actual Windows junction: navigation must reject it.
      await rmdir(gone);
      await symlink(outsideRoot, gone, "junction");
      await sub("失效目录").click();
      await page.locator("#error:not([hidden])").waitFor();
      assert((await page.locator("#error-text").innerText()).includes("链接"));
      await expectFolder(child);
      assert.equal(await page.locator(".cm-content").innerText(), draft);
      await page.screenshot({
        path: path.resolve("test-results/navigation-link-failure.png"),
      });
      await rename(deep, deep + "-暂移");
      await sub("更深一层").click();
      await waitFor(
        () =>
          page
            .locator("#error-text")
            .innerText()
            .then((s) => s.includes("无法读取")),
        "missing directory error",
      );
      await expectFolder(child);
      await rename(deep + "-暂移", deep);
      await sub("更深一层").click();
      await expectFolder(deep);
      assert(await page.locator("#error").isHidden());
      await rename(currentFile, currentFile + ".暂移");
      await page.locator("#folder-locate").click();
      await page.locator("#error:not([hidden])").waitFor();
      await expectFolder(deep);
      assert.equal(await page.locator(".cm-content").innerText(), draft);
      await rename(currentFile + ".暂移", currentFile);
      await page.locator("#folder-locate").click();
      await expectFolder(child);
      assert(await page.locator("#error").isHidden());
      for (const [width, height] of [
        [1320, 860],
        [850, 560],
      ]) {
        await page.setViewportSize({ width, height });
        assert(await page.locator("#folder-up").isVisible());
        assert(await page.locator("#folder-locate").isVisible());
        assert(
          await page
            .locator(".workspace")
            .evaluate((e) => e.scrollWidth <= e.clientWidth),
        );
        await page.screenshot({
          path: path.resolve(`test-results/navigation-${width}.png`),
        });
      }
      await page.setViewportSize({ width: 1320, height: 860 });
      const savedOutside = path.join(outsideRoot, "另存后的文件.md");
      await page.locator("#save-as").click();
      await dialog(savedOutside);
      await waitFor(
        () =>
          page
            .locator("#filepath")
            .innerText()
            .then((s) => s === savedOutside),
        "save outside root",
      );
      await page.locator("#folder-locate").click();
      await expectFolder(outsideRoot);
      assert(await page.locator("#folder-up").isDisabled());
      assert.equal(
        await page
          .locator("#folder-files [aria-current=page] .file-name")
          .innerText(),
        "另存后的文件.md",
      );
      assert(
        (await readFile(savedOutside, "utf8")).includes("未保存的导航草稿"),
      );
      await page.locator("#home-back").click();
      await page.locator("#home").waitFor({ state: "visible" });

      const plainText = path.join(outsideRoot, "单独打开.txt");
      await writeFile(plainText, "# 文本定位");
      await page.locator("#home-open").click();
      await dialog(plainText);
      await page.locator("#document-view").waitFor({ state: "visible" });
      await page.locator("#tab-files").click();
      await page.locator("#folder-locate").click();
      await expectFolder(outsideRoot);
      assert.equal(
        await page
          .locator("#folder-files [aria-current=page] .file-name")
          .innerText(),
        "单独打开.txt",
      );
      assert(await page.locator("#folder-up").isDisabled());
      await page.screenshot({
        path: path.resolve("test-results/navigation-locate.png"),
      });
      await page.locator("#home-back").click();
      await page.locator("#home").waitFor({ state: "visible" });
      assert.deepEqual(errors, []);
      console.log(
        "PASS: nested navigation/root guard/IPC traversal rejection, real junction filtering and substitution rejection, dirty content preserved/no prompt, file-switch cancel, parent focus, current-file locate, missing directory/file failure and retry, external Save As root reset, standalone txt locate, responsive controls.",
      );
    }
    if (homeRun) {
      await page.locator("#home-open:not([disabled])").waitFor();
      assert(await page.locator("#document-view").isHidden());
      assert.equal(await page.locator(".home-name h1").innerText(), "MDMD");
      await waitFor(
        async () =>
          (await page.locator("#home-version").innerText()) === "v0.2.0",
        "app version",
      );
      assert.equal(await page.locator(".home-paper").count(), 1);
      assert.equal(
        await page.locator(".home-button-grid button:disabled").count(),
        0,
      );
      assert(!/升级|购买|已绑定/.test(await page.locator("#home").innerText()));
      for (const [width, height] of [
        [1320, 860],
        [850, 560],
        [640, 720],
        [400, 640],
      ]) {
        await page.setViewportSize({ width, height });
        const layout = await page.locator("#home").evaluate((home) => ({
          overflow: home.scrollWidth > home.clientWidth,
          buttonsFit: [...home.querySelectorAll("button")].every((button) => {
            if (button.hidden) return true;
            const box = button.getBoundingClientRect();
            return (
              box.left >= 0 &&
              box.right <= home.clientWidth &&
              button.scrollWidth <= button.clientWidth
            );
          }),
          openBottom: home.querySelector("#home-open").getBoundingClientRect()
            .bottom,
          footerBottom: home
            .querySelector(".home-footer")
            .getBoundingClientRect().bottom,
        }));
        console.log(
          "Home layout:",
          JSON.stringify({ width, height, ...layout }),
        );
        await page.screenshot({
          path: path.resolve(`test-results/home-${width}.png`),
        });
        assert.equal(layout.overflow, false);
        assert.equal(layout.buttonsFit, true);
        if (width >= 850) assert(layout.openBottom <= height);
        if (width === 1320) assert(layout.footerBottom <= height);
      }
      await page.setViewportSize({ width: 1320, height: 860 });
      await page.locator("#home-settings").click();
      await page.locator("#settings-appearance").click();
      const previousTheme = await page
        .locator('input[name="theme"]:checked')
        .inputValue();
      await page.locator("#theme-dark").check();
      await page.locator("#settings-general").click();
      const previousLanguage = await page
        .locator("#setting-language")
        .inputValue();
      await page.locator("#setting-language").selectOption("en");
      await page.locator("#setting-language:not([disabled])").waitFor();
      await page.locator("#settings-close").click();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "dark",
      );
      assert.equal(
        await page.locator("#home-title").innerText(),
        "A fresh page.\nA new idea.",
      );
      assert(
        !/[\u4e00-\u9fff]/.test(await page.locator("#home").innerText()),
        "all home copy translated",
      );
      for (const width of [1320, 640, 400]) {
        await page.setViewportSize({ width, height: 860 });
        assert(
          await page
            .locator("#home")
            .evaluate((home) => home.scrollWidth <= home.clientWidth),
        );
        await page.locator("#home-settings").scrollIntoViewIfNeeded();
        assert(await page.locator("#home-settings").isVisible());
        await page.screenshot({
          path: path.join(root, `home-dark-en-${width}.png`),
        });
      }
      await page.setViewportSize({ width: 1320, height: 860 });
      await page.locator("#home-settings").click();
      await page.locator("#settings-general").click();
      await page.locator("#setting-language").selectOption(previousLanguage);
      await page.locator("#setting-language:not([disabled])").waitFor();
      await page.locator("#settings-appearance").click();
      await page.locator(`#theme-${previousTheme}`).check();
      await page.locator("#settings-close").click();
      for (const entry of ["home-history", "home-favorites"]) {
        await page.locator(`#${entry}`).click();
        await page.locator("#folder-welcome").waitFor({ state: "visible" });
        await page.locator("#folder-home").click();
        await page.locator("#home").waitFor({ state: "visible" });
      }
      await page.locator("#home-association-manage").click();
      await page.locator("#integration-dialog").waitFor({ state: "visible" });
      await page.locator("#integration-close").click();
      assert(
        await page
          .locator("#home-association-manage")
          .evaluate((e) => e === document.activeElement),
      );
      await page.locator("#home-open").focus();
      await page.keyboard.press("Control+s");
      await page.keyboard.press("F3");
      assert(await page.locator("#home").isVisible());
      await page.keyboard.press("Control+o");
      assert(await page.locator("#home-open").isDisabled());
      await dialog("", true);
      await waitFor(
        () => page.locator("#home-open").isEnabled(),
        "home picker cancel",
      );
      assert(
        await page
          .locator("#home-open")
          .evaluate((e) => e === document.activeElement),
      );
      const beforeCancel = (await readdir(root)).sort();
      await page.locator("#home-new").click();
      assert(await page.locator("#home-new").isDisabled());
      assert(await page.locator("#home-open").isDisabled());
      await dialog("", true, ["-ExpectedFileName", "未命名.md"]);
      await waitFor(() => page.locator("#home-new").isEnabled(), "new cancel");
      assert(await page.locator("#home").isVisible());
      assert(
        await page
          .locator("#home-new")
          .evaluate((e) => e === document.activeElement),
      );
      assert.deepEqual((await readdir(root)).sort(), beforeCancel);

      const newRoot = path.join(root, "new-file");
      await mkdir(newRoot);
      const created = path.join(newRoot, "首页 新建.md");
      await page.keyboard.press("Control+n");
      await dialog(path.join(newRoot, "首页 新建"));
      await page.locator("#document-view").waitFor({ state: "visible" });
      await waitFor(() => page.locator("#home-back").isEnabled(), "new ready");
      assert(await page.locator(".editor-pane").isVisible());
      assert(
        await page
          .locator(".cm-content")
          .evaluate((e) => e === document.activeElement),
      );
      assert.equal(await page.locator("#filename").innerText(), "首页 新建.md");
      assert.equal(await page.locator("#filepath").innerText(), created);
      assert.equal(await page.locator("#save-status").innerText(), "已保存");
      assert.equal(await page.locator("#encoding").innerText(), "UTF-8");
      assert.equal(await page.locator("#line-ending").innerText(), "LF");
      assert.equal((await readFile(created)).length, 0);
      await page.screenshot({
        path: path.resolve("test-results/home-new-editor.png"),
      });
      const createdContent = "# 首页新建\n\n中文 😀\n";
      await page.keyboard.insertText(createdContent);
      await page.keyboard.press("Control+s");
      await waitFor(
        async () => (await readFile(created, "utf8")) === createdContent,
        "new save",
      );
      await waitFor(() => page.locator("#home-back").isEnabled(), "new saved");
      await page.locator("#home-back").click();
      await page.locator("#home").waitFor({ state: "visible" });
      await page.locator("#home-open").click();
      await dialog(created);
      await page.locator("#preview h1").waitFor();
      assert.equal(await page.locator("#preview h1").innerText(), "首页新建");
      await page.locator("#home-back").click();
      await page.locator("#home").waitFor({ state: "visible" });

      await page.locator("#home-new").click();
      await dialog(created, false, ["-ConfirmOverwrite"]);
      await page.locator("#error").waitFor({ state: "visible" });
      assert(
        (await page.locator("#error-text").innerText()).includes("已存在"),
      );
      assert(await page.locator("#home").isVisible());
      assert.equal(await readFile(created, "utf8"), createdContent);
      assert(
        await page
          .locator("#home-new")
          .evaluate((e) => e === document.activeElement),
      );
      await page.screenshot({
        path: path.resolve("test-results/home-new-collision.png"),
      });
      await page.locator("#dismiss-error").click();
      const invalidNew = path.join(newRoot, "不支持.txt");
      const beforeInvalid = (await readdir(newRoot)).sort();
      await page.locator("#home-new").click();
      await dialog(invalidNew);
      await page.locator("#error").waitFor({ state: "visible" });
      assert(
        (await page.locator("#error-text").innerText()).includes("扩展名"),
      );
      assert(await page.locator("#home").isVisible());
      assert.deepEqual((await readdir(newRoot)).sort(), beforeInvalid);
      // A subsequent valid choice clears the error and enters an editable empty file.
      const retry = path.join(newRoot, "重新选择.MD");
      await page.locator("#home-new").click();
      await dialog(retry);
      await page.locator("#document-view").waitFor({ state: "visible" });
      assert.equal((await readFile(retry)).length, 0);
      assert(await page.locator("#error").isHidden());
      assert(await page.locator(".editor-pane").isVisible());
      await page.locator("#home-back").click();
      await page.locator("#home").waitFor({ state: "visible" });
      console.log(
        "PASS: home new default name, cancel/no writes/focus, Ctrl+N, extension/rejection, empty UTF-8/LF, edit/save/reopen, collision despite system Yes, retry.",
      );
      const invalidHome = path.join(root, "首页非UTF8.md");
      await writeFile(invalidHome, Buffer.from([255, 254, 65, 0]));
      await page.locator("#home-open").click();
      await dialog(invalidHome);
      await page.locator("#error").waitFor({ state: "visible" });
      assert((await page.locator("#error-text").innerText()).includes("UTF-8"));
      assert(await page.locator("#home").isVisible());
      await page.locator("#dismiss-error").click();
      const oversized = path.join(root, "超限.md");
      await writeFile(oversized, Buffer.alloc(20 * 1024 * 1024 + 1, 65));
      await page.locator("#home-open").click();
      await dialog(oversized);
      await page.locator("#error").waitFor({ state: "visible" });
      assert((await page.locator("#error-text").innerText()).includes("20 MB"));
      assert(await page.locator("#home").isVisible());
      const empty = path.join(root, "空白 文档.md");
      await writeFile(empty, "");
      await page.locator("#home-open").click();
      await dialog(empty);
      await page.locator("#document-view").waitFor({ state: "visible" });
      assert(await page.locator("#home").isHidden());
      assert.equal(await page.locator("#filename").innerText(), "空白 文档.md");
      assert(await page.locator(".editor-pane").isHidden());
      assert(await page.locator("#error").isHidden());
      await page.locator("#home-back").click();
      await page.locator("#home").waitFor({ state: "visible" });
      await page.locator("#home-open").click();
      await dialog(file);
      await page.locator("#document-view").waitFor({ state: "visible" });
      assert(await page.locator(".editor-pane").isHidden());
      console.log(
        "PASS: home layout/resize/version, deferred controls disabled, Ctrl+O/cancel/focus, invalid/oversized rejection, empty file, home return, open into reading.",
      );
    }
    await page.locator("#preview h1").waitFor();
    assert.equal(await page.locator("#preview h1").innerText(), "中文文档");
    assert.equal(await page.title(), "MDMD Markdown");
    assert.equal(await page.locator(".brand strong").innerText(), "MDMD");
    const nativeTitle = async () => {
      const { stdout } = await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); (Get-Process -Id ${app.pid}).MainWindowTitle`,
        ],
        { windowsHide: true },
      );
      return stdout.trim();
    };
    assert.equal(await nativeTitle(), `${file} — MDMD`);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await waitFor(
      () =>
        page
          .locator("#preview img")
          .evaluate((e) => e.complete && e.naturalWidth > 0),
      "local image",
    );
    await page.locator("#read-mode").click();
    assert(await page.locator(".editor-pane").isHidden());
    await page.keyboard.press("F3");
    assert(await page.locator(".editor-pane").isVisible());
    const cm = page.locator(".cm-content");
    await cm.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n保存中文与 emoji 😀");
    await waitFor(
      async () =>
        (await page.locator("#save-status").innerText()).includes("未保存"),
      "dirty state",
    );
    await page.keyboard.press("Control+s");
    await waitFor(
      async () => (await readFile(file, "utf8")).includes("保存中文"),
      "save",
    );
    const saved = await readFile(file, "utf8");
    assert(saved.startsWith("\ufeff"));
    assert(!saved.replaceAll("\r\n", "").includes("\n"));
    const backups = await readdir(path.join(root, ".mdmd-backups"));
    assert.equal(backups.length, 1);
    assert.equal(
      await readFile(path.join(root, ".mdmd-backups", backups[0]), "utf8"),
      original,
    );
    assert.equal(await readFile(legacyBackup, "utf8"), original);
    assert.equal(await readFile(legacyTemp, "utf8"), "未恢复的旧草稿");
    // A copied legacy .bak remains an ordinary UTF-8 Markdown document.
    const recovered = path.join(root, "旧备份恢复.md");
    await writeFile(recovered, await readFile(legacyBackup));
    await cm.click();
    await page.keyboard.press("Control+z");
    await waitFor(
      async () =>
        (await page.locator("#save-status").innerText()).includes("未保存"),
      "undo after save",
    );
    await page.keyboard.press("Control+y");
    await waitFor(
      async () => (await page.locator("#save-status").innerText()) === "已保存",
      "redo to saved content",
    );
    await cm.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n必须保留的草稿");
    await page.locator("#new").click();
    await page.locator("#confirm-dialog[open]").waitFor();
    await page.locator("button[value=cancel]").click();
    assert((await cm.innerText()).includes("必须保留"));
    await writeFile(file, "# 外部修改\n不可覆盖");
    await page.locator("#notice").waitFor({ state: "visible" });
    await page.locator("#save").click();
    await page.locator("#error").waitFor({ state: "visible" });
    assert.equal(await readFile(file, "utf8"), "# 外部修改\n不可覆盖");
    const copy = path.join(root, "另存 副本.md");
    await page.locator("#save-as").click();
    await dialog(copy);
    await waitFor(async () => {
      try {
        return (await readFile(copy, "utf8")).includes("必须保留");
      } catch {
        return false;
      }
    }, "Save As");
    assert.equal(await readFile(file, "utf8"), "# 外部修改\n不可覆盖");
    await page.locator("#open").click();
    await dialog(file);
    await waitFor(
      async () =>
        (await page.locator("#preview").innerText()).includes("外部修改"),
      "native Open",
    );
    const invalid = path.join(root, "invalid.md");
    await writeFile(invalid, Buffer.from([255, 254, 65, 0]));
    await page.locator("#open").click();
    await dialog(invalid);
    await page.locator("#error").waitFor({ state: "visible" });
    assert((await page.locator("#preview").innerText()).includes("外部修改"));
    assert((await page.locator("#error-text").innerText()).includes("UTF-8"));
    await page.locator("#open").click();
    await dialog("", true);
    await waitFor(() => page.locator("#open").isEnabled(), "cancel picker");
    assert((await page.locator("#preview").innerText()).includes("外部修改"));
    await page.locator("#open").click();
    await dialog(recovered);
    await waitFor(
      async () =>
        (await page.locator("#preview h1").innerText()) === "中文文档",
      "legacy backup recovery",
    );
    await page.locator("#open").click();
    await dialog(path.resolve("examples/欢迎使用MDMD.md"));
    await waitFor(
      async () =>
        (await page.locator("#preview h1").innerText()).includes("安静"),
      "example",
    );
    await page.locator("#divider").focus();
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await page.locator("#divider").getAttribute("aria-valuenow"),
      "48",
    );
    await page.keyboard.press("ArrowRight");
    await page.screenshot({ path: path.resolve("test-results/editor.png") });
    // Exercise native close interception with a dirty document, without saving the example.
    await cm.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n临时修改");
    if (homeRun) {
      await page.locator("#home-back").click();
      await page.locator("#confirm-dialog[open]").waitFor();
      await page.locator("button[value=cancel]").click();
      assert((await cm.innerText()).includes("临时修改"));
      assert(await page.locator("#home").isHidden());
    }
    await closeWindow();
    await page.locator("#confirm-dialog[open]").waitFor();
    await page.locator("button[value=cancel]").click();
    assert((await cm.innerText()).includes("临时修改"));
    assert.deepEqual(errors, []);
    if (homeRun) {
      await page.locator("#home-back").click();
      await page.locator("#confirm-dialog[open]").waitFor();
      await page.locator("button[value=discard]").click();
      await page.locator("#home").waitFor({ state: "visible" });
      await page.locator("#home-open").click();
      await dialog(file);
      await page.locator("#document-view").waitFor({ state: "visible" });
      await page.locator("#split-mode").click();
      await cm.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.insertText("\n返回首页前保存");
      await page.locator("#home-back").click();
      await page.locator("#confirm-dialog[open]").waitFor();
      await page.locator("button[value=save]").click();
      await page.locator("#home").waitFor({ state: "visible" });
      assert((await readFile(file, "utf8")).includes("返回首页前保存"));
      await closeWindow();
      await waitFor(async () => app.exitCode !== null, "home window exit");
      assert.deepEqual(errors, []);
      console.log(
        "PASS: unsaved home cancel/discard/save, clean home window close.",
      );
    } else {
      await closeWindow();
      await page.locator("#confirm-dialog[open]").waitFor();
      await page.locator("button[value=discard]").click();
      await waitFor(async () => app.exitCode !== null, "application exit");
    }
    console.log(
      "PASS: MDMD page/native title/brand, legacy recovery preservation/open, native Open/Save As/cancel, preview/images/XSS, split mode, UTF-8 BOM/CRLF save, backup, conflict, unsaved prompts, window close.",
    );
    console.log(`Screenshot: ${path.resolve("test-results/editor.png")}`);
  }
} catch (error) {
  const failedPage = browser
    ?.contexts()
    .flatMap((context) => context.pages())[0];
  if (failedPage)
    await failedPage
      .screenshot({
        path: path.resolve("test-results/folder-test-failure.png"),
      })
      .catch(() => {});
  throw error;
} finally {
  fixture?.close();
  if (browser) await browser.close().catch(() => {});
  if (app.exitCode === null) app.kill();
  await registryTest(integrationId, "cleanup");
}
