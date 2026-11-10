import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, unlink, rename } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

export async function testExternalEdit({
  page,
  root,
  dialog,
  waitFor,
  restart,
}) {
  const dir = path.join(root, "external editor 中文");
  await mkdir(dir);
  const helper = path.join(dir, "editor helper.exe");
  const source = path.join(dir, "helper.cs");
  await writeFile(
    source,
    `using System; using System.IO; using System.Reflection; using System.Text;
class Editor { static void Main(string[] args) {
 string own=Assembly.GetExecutingAssembly().Location;
 File.WriteAllText(own+".args", args.Length+"\\n"+Convert.ToBase64String(Encoding.UTF8.GetBytes(args.Length==1?args[0]:"")));
 if(args.Length==1 && File.Exists(own+".replace")) { File.WriteAllText(args[0],File.ReadAllText(own+".replace"),new UTF8Encoding(false)); File.Delete(own+".replace"); }
} }`,
  );
  await run(
    path.join(
      process.env.SystemRoot,
      "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
    ),
    ["/nologo", "/target:winexe", `/out:${helper}`, source],
    { windowsHide: true },
  );
  const file = path.join(dir, "中文 & 空格.md");
  const content = Array.from(
    { length: 60 },
    (_, i) => `## Heading ${i + 1}\n\nParagraph ${i + 1} 😀\n\n`,
  ).join("");
  await writeFile(file, content);
  const config = path.join(root, "app-data/external-editor.json");
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  const state = (value) =>
    waitFor(
      async () =>
        (await page.locator("#save-status").getAttribute("data-state")) ===
        value,
      value,
    );
  const text = () => page.locator(".cm-content").innerText();
  async function pick(file) {
    await page
      .locator(
        (await page.locator("#home").isVisible()) ? "#home-open" : "#open",
      )
      .click();
    await dialog(file);
    await idle();
  }
  async function options() {
    await page
      .locator(
        (await page.locator("#home").isVisible())
          ? "#home-settings"
          : "#document-settings",
      )
      .click();
    await page.locator("#settings-general").click();
    await page.locator("#external-options").click();
    await page.locator("#external-choose:not(:disabled)").waitFor();
  }
  async function choose(file, cancel = false) {
    await page.locator("#external-choose").click();
    await dialog(file, cancel);
    await page.locator("#external-close:not(:disabled)").waitFor();
  }
  async function close() {
    await page.locator("#external-close").click();
    await page.waitForFunction(
      () => document.activeElement.id === "external-options",
    );
    await page.locator("#settings-close").click();
  }
  async function called() {
    await waitFor(async () => {
      try {
        return (await readFile(helper + ".args", "utf8")).startsWith("1\n");
      } catch {
        return false;
      }
    }, "external process called");
    const [count, encoded] = (await readFile(helper + ".args", "utf8")).split(
      "\n",
    );
    assert.equal(count, "1");
    assert.equal(Buffer.from(encoded, "base64").toString("utf8"), file);
    await unlink(helper + ".args");
  }
  await pick(file);
  await options();
  assert.match(
    await page.locator("#external-path").innerText(),
    /notepad\.exe/i,
  );
  await choose("", true);
  await assert.rejects(readFile(config));
  await choose(
    path.resolve(
      process.env.MDMD_TEST_EXE || "src-tauri/target/debug/mdmd.exe",
    ),
  );
  assert.match(await page.locator("#external-message").innerText(), /自身/);
  await choose(helper);
  const selected = await readFile(config, "utf8");
  assert.match(
    await page.locator("#external-path").innerText(),
    /editor helper\.exe/,
  );
  await page.setViewportSize({ width: 640, height: 720 });
  await page.screenshot({ path: path.join(root, "external-options-640.png") });
  await page.setViewportSize({ width: 1320, height: 860 });
  await close();
  await page.keyboard.press("F4");
  await idle();
  await called();
  assert.equal(await readFile(file, "utf8"), content);

  // Split view: bounded keyboard/reset/drag cancel, reading anchor and direct caret mapping.
  await page.locator("#split-mode").click();
  const divider = page.locator("#divider");
  await divider.focus();
  await page.keyboard.press("Home");
  assert.equal(await divider.getAttribute("aria-valuenow"), "25");
  await page.keyboard.press("End");
  assert.equal(await divider.getAttribute("aria-valuenow"), "75");
  await divider.dblclick();
  assert.equal(await divider.getAttribute("aria-valuenow"), "50");
  const box = await divider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 30);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await divider.getAttribute("aria-valuenow"), "50");
  await page.locator("#sync-scroll").uncheck();
  const heading = page.locator("#preview h2").nth(25);
  await heading.evaluate((e) => e.scrollIntoView({ block: "start" }));
  const before = await heading.evaluate(
    (e) =>
      e.getBoundingClientRect().top -
      document.querySelector("#preview-scroll").getBoundingClientRect().top,
  );
  await page.locator("#read-mode").click();
  await waitFor(
    async () =>
      Math.abs(
        (await heading.evaluate(
          (e) =>
            e.getBoundingClientRect().top -
            document.querySelector("#preview-scroll").getBoundingClientRect()
              .top,
        )) - before,
      ) < 4,
    "reading anchor",
  );
  await page.locator("#document-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#setting-double-click-edit").check();
  await page.locator("#settings-close").click();
  await heading.dblclick();
  assert(
    await page.locator("#inline-rich").isVisible(),
    "double click enters visual editing",
  );
  await page.locator("#inline-cancel").click();
  await page.locator("#document-settings").click();
  await page.locator("#settings-general").click();
  await page.locator("#setting-double-click-edit").uncheck();
  await page.locator("#settings-close").click();
  await page.locator("#split-mode").click();
  await page.locator(".cm-content").focus();
  await page.keyboard.insertText("本地草稿");
  await state("dirty");
  const draft = await text();
  await page.locator("#external-edit").click();
  assert(await page.locator("button[value=discard]").isHidden());
  await page.locator("button[value=cancel]").click();
  await idle();
  assert.equal(await text(), draft);
  assert.equal(await readFile(file, "utf8"), content);
  await page.locator("#external-edit").click();
  await page.locator("button[value=save]").click();
  await idle();
  await called();
  assert((await readFile(file, "utf8")).includes("本地草稿"));
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await state("dirty");
  await page.keyboard.press("Control+y");
  await state("saved");

  // A real launched program writes a new disk version; reload is always explicit.
  await writeFile(helper + ".replace", "# External writer\nnew disk text");
  await page.keyboard.press("F4");
  await idle();
  await called();
  await state("conflict");
  assert.equal(await text(), draft);
  await page.locator("#external-edit").click();
  await idle();
  assert.match(await page.locator("#error-text").innerText(), /磁盘文件已变化/);
  await assert.rejects(readFile(helper + ".args"));
  // CodeMirror virtualizes long documents; DOM fill only selects rendered lines.
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("local conflict draft");
  await waitFor(
    async () => (await text()) === "local conflict draft",
    "replace full source",
  );
  await state("conflict");
  await page.locator("#reload").click();
  await page.locator("button[value=cancel]").click();
  await idle();
  assert.equal(await text(), "local conflict draft");
  await page.locator("#external-edit").click();
  await page.locator("button[value=save]").click();
  await idle();
  assert.equal(await text(), "local conflict draft");
  await assert.rejects(readFile(helper + ".args"));
  assert.equal(
    await readFile(file, "utf8"),
    "# External writer\nnew disk text",
  );
  await page.locator("#reload").click();
  await page.locator("button[value=discard]").click();
  await idle();
  await state("saved");
  assert.match(await text(), /External writer/);
  await page.screenshot({ path: path.join(root, "external-reloaded.png") });

  await rename(helper, helper + ".missing");
  await page.keyboard.press("F4");
  await idle();
  assert.match(await page.locator("#error-text").innerText(), /不可用/);
  await rename(helper + ".missing", helper);
  await options();
  await rename(config, config + ".saved");
  await mkdir(config);
  await page.locator("#external-default").click();
  await page.locator("#external-close:not(:disabled)").waitFor();
  assert.equal(await page.locator("#external-path").innerText(), helper);
  const { rmdir } = await import("node:fs/promises");
  await rmdir(config);
  await rename(config + ".saved", config);
  assert.equal(await readFile(config, "utf8"), selected);
  await close();
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  page = await restart();
  await pick(file);
  await options();
  assert.equal(await page.locator("#external-path").innerText(), helper);
  await page.locator("#external-default").click();
  await page.locator("#external-close:not(:disabled)").waitFor();
  assert.match(
    await page.locator("#external-path").innerText(),
    /notepad\.exe/i,
  );
  assert.equal(JSON.parse(await readFile(config, "utf8")).executable, null);
  await choose(helper);
  assert.equal(await page.locator("#external-path").innerText(), helper);
  await close();
  await page.locator("#new").click();
  await idle();
  await page.locator("#external-edit").click();
  await page.locator("button[value=save]").click();
  await dialog("", true);
  await idle();
  await state("unsaved");
  await assert.rejects(readFile(helper + ".args"));
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await writeFile(config, '{"version":99,"executable":null}');
  page = await restart();
  await pick(file);
  await options();
  assert.match(await page.locator("#external-message").innerText(), /版本/);
  await page.locator("#external-default").click();
  await page.locator("#external-close:not(:disabled)").waitFor();
  assert.equal(
    await readFile(config, "utf8"),
    '{"version":99,"executable":null}',
  );
  await close();
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  await unlink(config);
  await page.evaluate(() => localStorage.removeItem("mdmd.settings"));
  page = await restart();
  console.log(
    "PASS: split anchor/caret/ratio/reset/drag cancel, external EXE picker/cancel/self rejection, real argv-safe launch and external write, dirty save/cancel/conflict/reload protection, missing EXE, real config write rollback, process restart/future schema/unsaved cancel.",
  );
  console.log("External edit evidence:", root);
  return page;
}
