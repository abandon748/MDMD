import assert from "node:assert/strict";
import { writeFile, readFile, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
const run = promisify(execFile);
export async function testFeedback({ page, root, dialog, restart, waitFor }) {
  const message = () => page.locator("#feedback-message").innerText();
  const preview = () => page.locator("#feedback-preview").inputValue();
  async function open() {
    await page
      .locator(
        (await page.locator("#home").isVisible())
          ? "#home-settings"
          : "#document-settings",
      )
      .click();
    await page.locator("#settings-feedback").click();
  }
  async function close() {
    await page.locator("#settings-close").click();
    await page.waitForFunction(() =>
      /^(home|document)-settings$/.test(document.activeElement.id),
    );
  }
  async function idle() {
    await page.locator("#feedback-export:not(:disabled)").waitFor();
  }
  await open();
  const projectUrl = "https://github.com/abandon748/MDMD";
  await page.locator("#project-open:not(:disabled)").waitFor();
  assert.equal(await page.locator("#project-url").innerText(), projectUrl);
  assert(await page.locator("#project-message").isHidden());
  await page.screenshot({ path: path.join(root, "project-zh.png") });
  assert(await page.locator("#feedback-export").isDisabled());
  assert(!(await page.locator("#feedback-environment").isChecked()));
  const problem = "中文反馈 😀 <script>window.feedbackInjected=true</script>";
  await page.locator("#feedback-problem").fill(problem);
  await page.locator("#feedback-steps").fill("1. 打开文件\n2. 查看内容");
  await page.locator("#feedback-expected").fill("正常显示");
  await page.locator("#feedback-actual").fill("示例问题");
  await idle();
  const report = await preview();
  // Exercise the real button/IPC route without opening a browser during regression.
  await page.evaluate(() => {
    window.projectCalls = [];
    window.projectFetch = window.fetch;
    window.fetch = (input, init) => {
      if (
        String(input) !==
        window.__TAURI_INTERNALS__.convertFileSrc("project_repository", "ipc")
      )
        return window.projectFetch(input, init);
      window.projectCalls.push(JSON.parse(init.body));
      return Promise.resolve(
        new Response(
          JSON.stringify(
            window.projectFail
              ? "attachment-browser"
              : "https://github.com/abandon748/MDMD",
          ),
          {
            headers: {
              "Content-Type": "application/json",
              "Tauri-Response": window.projectFail ? "error" : "ok",
            },
          },
        ),
      );
    };
  });
  await page.locator("#project-open").focus();
  await page.keyboard.press("Enter");
  await waitFor(
    async () =>
      /已请求/.test(await page.locator("#project-message").innerText()),
    "project opens on keyboard activation",
  );
  await page.evaluate(() => {
    window.projectFail = true;
  });
  await page.locator("#project-open").click();
  await waitFor(
    async () =>
      /无法打开/.test(await page.locator("#project-message").innerText()),
    "project browser failure",
  );
  assert.deepEqual(await page.evaluate(() => window.projectCalls), [
    { open: true },
    { open: true },
  ]);
  assert.equal(await preview(), report);
  await page.evaluate(() => {
    window.fetch = window.projectFetch;
    delete window.projectFetch;
    window.projectClipboard = navigator.clipboard.writeText;
    navigator.clipboard.writeText = () =>
      Promise.reject(new Error("copy-failed"));
  });
  await page.locator("#project-copy").click();
  await waitFor(
    async () =>
      /复制失败/.test(await page.locator("#project-message").innerText()),
    "project copy failure",
  );
  assert.equal(await page.locator("#project-url").innerText(), projectUrl);
  assert.equal(await preview(), report);
  await page.evaluate(() => {
    navigator.clipboard.writeText = window.projectClipboard;
    delete window.projectClipboard;
  });
  assert(report.includes(problem));
  assert(!report.includes(root));
  assert(!report.includes("Mozilla"));
  assert.equal(await page.evaluate(() => window.feedbackInjected), undefined);
  assert.equal(
    await page.locator("#feedback-steps").getAttribute("maxlength"),
    "4000",
  );
  await close();
  await open();
  assert.equal(await preview(), report);
  assert(await page.locator("#settings-autosave-note").isHidden());
  await page.locator("#feedback-environment").check();
  assert((await preview()).includes("Mozilla"));
  await page.locator("#feedback-environment").uncheck();
  assert.equal(await preview(), report);
  await page.locator("#feedback-export").click();
  await dialog("", true, [
    "-ExpectedTitle",
    "导出问题反馈",
    "-ExpectedFileName",
    "MDMD-feedback.md",
  ]);
  await idle();
  assert.match(await message(), /取消/);
  assert.equal(await preview(), report);
  const exported = path.join(root, "反馈报告.md");
  await page.locator("#feedback-export").click();
  await dialog(exported);
  await idle();
  assert.match(await message(), /已导出/);
  assert.equal(await readFile(exported, "utf8"), report);
  await page.locator("#feedback-export").click();
  await dialog(exported, false, ["-ConfirmOverwrite"]);
  await idle();
  assert.match(await message(), /已存在/);
  assert.equal(await readFile(exported, "utf8"), report);
  await page.locator("#feedback-export").click();
  await dialog(path.join(root, "wrong.txt"));
  await idle();
  assert.match(await message(), /\.md/);
  await page.evaluate(() => {
    window.feedbackFetch = window.fetch;
    window.fetch = (input, init) =>
      String(input) ===
      window.__TAURI_INTERNALS__.convertFileSrc("export_feedback", "ipc")
        ? Promise.resolve(
            new Response(JSON.stringify("feedback-write"), {
              headers: {
                "Content-Type": "application/json",
                "Tauri-Response": "error",
              },
            }),
          )
        : window.feedbackFetch(input, init);
  });
  await page.locator("#feedback-export").click();
  await idle();
  assert.match(await message(), /失败/);
  assert.equal(await preview(), report);
  await page.evaluate(() => {
    window.fetch = window.feedbackFetch;
    delete window.feedbackFetch;
  });
  async function checkClipboard(button, text) {
    const readyFile = path.join(root, `${button}-clipboard-ready`),
      expectedFile = path.join(root, `${button}-clipboard-expected.txt`);
    await writeFile(expectedFile, text);
    const clipboard = run(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.resolve("tests/feedback-clipboard.ps1"),
        "-ExpectedFilePath",
        expectedFile,
        "-ReadyFilePath",
        readyFile,
      ],
      { windowsHide: true, timeout: 30000 },
    ).then(
      (v) => ({ value: v }),
      (e) => ({ error: e }),
    );
    await waitFor(async () => {
      try {
        await access(readyFile);
        return true;
      } catch {
        return false;
      }
    }, "clipboard snapshot ready");
    await page.locator(`#${button}`).click();
    await idle();
    const clip = await clipboard;
    if (clip.error) throw clip.error;
    assert.deepEqual(JSON.parse(clip.value.stdout), {
      matched: true,
      restored: true,
    });
  }
  await checkClipboard("project-copy", projectUrl);
  assert.match(await page.locator("#project-message").innerText(), /已复制/);
  assert.equal(await preview(), report);
  await checkClipboard("feedback-copy", report);
  assert.match(await message(), /已复制/);
  await page.evaluate(() => {
    window.feedbackClipboard = navigator.clipboard.writeText;
    navigator.clipboard.writeText = () =>
      Promise.reject(new Error("copy-test"));
  });
  await page.locator("#feedback-copy").click();
  await idle();
  assert.match(await message(), /复制失败/);
  await page.evaluate(() => {
    navigator.clipboard.writeText = window.feedbackClipboard;
    delete window.feedbackClipboard;
  });
  await page.screenshot({ path: path.join(root, "feedback-filled.png") });
  await page.locator("#settings-general").click();
  await page.locator("#setting-language").selectOption("en");
  await page.locator("#settings-feedback").click();
  assert.equal(
    await page.locator("#settings-section-title").innerText(),
    "Feedback",
  );
  assert.equal(await page.locator("#feedback-problem").inputValue(), problem);
  assert((await preview()).includes("Problem description"));
  assert.equal(
    await page.locator("#project-title").innerText(),
    "MDMD project & updates",
  );
  assert.equal(
    await page.locator("#project-open").innerText(),
    "Project page ↗",
  );
  await page.locator("#settings-appearance").click();
  assert(await page.locator("#project-title").isHidden());
  await page.locator("#theme-dark").check();
  await page.locator("#settings-feedback").click();
  await waitFor(
    async () =>
      (await page.locator("html").getAttribute("data-theme")) === "dark",
    "project dark theme",
  );
  await page.screenshot({ path: path.join(root, "project-dark-en.png") });
  await page.setViewportSize({ width: 400, height: 720 });
  assert(
    await page
      .locator(".project-info")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  );
  await page.screenshot({ path: path.join(root, "project-dark-en-400.png") });
  await page.setViewportSize({ width: 1320, height: 860 });
  await page.locator("#settings-appearance").click();
  await page.locator("#theme-system").check();
  await page.locator("#settings-feedback").click();
  await page.setViewportSize({ width: 640, height: 720 });
  assert(
    await page
      .locator("#settings-dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  );
  await page.screenshot({ path: path.join(root, "feedback-en-640.png") });
  await page.setViewportSize({ width: 1320, height: 860 });
  await page.locator("#settings-general").click();
  await page.locator("#setting-language").selectOption("zh-CN");
  await close();
  const file = path.join(root, "feedback-document.md");
  const original = "# 保留原文\n";
  await writeFile(file, original);
  await page.locator("#home-open").click();
  await dialog(file);
  await page.locator("#preview h1").waitFor();
  await page.locator("#split-mode").click();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("反馈测试草稿");
  const draft = await page.locator(".cm-content").innerText();
  await open();
  const raw = await page.evaluate(() => localStorage.getItem("mdmd.settings"));
  await page.locator("#feedback-export").click();
  await dialog(path.join(root, "document-feedback"));
  await idle();
  assert.equal(
    await readFile(path.join(root, "document-feedback.md"), "utf8"),
    report,
  );
  assert.equal(await readFile(file, "utf8"), original);
  assert.equal(await page.locator(".cm-content").innerText(), draft);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("mdmd.settings")),
    raw,
  );
  await page.locator("#feedback-clear").click();
  assert.equal(await page.locator("#feedback-problem").inputValue(), "");
  assert(await page.locator("#feedback-copy").isDisabled());
  await page.locator("#feedback-problem").fill("重启后清空");
  await close();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await waitFor(
    async () =>
      !(await page.locator(".cm-content").innerText()).includes("反馈测试草稿"),
    "feedback preserves undo",
  );
  await page.locator("#home-back").click();
  if (await page.locator("#confirm-dialog").isVisible())
    await page.locator("button[value=discard]").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  page = await restart();
  await open();
  assert.equal(await page.locator("#feedback-problem").inputValue(), "");
  await close();
  console.log(
    "PASS: configured GitHub URL, keyboard open IPC/success/failure, real link clipboard with restoration/failure, draft isolation, translated card, dark theme and narrow layout.",
  );
  console.log(
    "PASS: feedback validation/preview/session draft, native export/cancel/extension/collision/retry, real clipboard + restoration/failure, optional environment, English/narrow layout, unchanged document/undo/settings, restart clears draft.",
  );
  console.log("Feedback evidence:", root);
  return page;
}
