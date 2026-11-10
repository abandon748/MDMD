import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";

export async function testSessionSave({
  page,
  root,
  dialog,
  waitFor,
  restart,
}) {
  const dir = path.join(root, "session-save");
  await mkdir(dir);
  const file = path.join(dir, "会话.md"),
    original = "# 原文\n磁盘基线 😀";
  await writeFile(file, original);
  const state = async (value) =>
    waitFor(
      async () =>
        (await page.locator("#save-status").getAttribute("data-state")) ===
        value,
      `session state ${value}`,
    );
  const idle = () => page.locator("#open:not(:disabled)").waitFor();
  const text = () => page.locator(".cm-content").innerText();
  async function edit(value) {
    await page.locator(".cm-content").fill(value);
  }
  async function fault(command, mode) {
    await page.evaluate(
      ({ command, mode }) => {
        window.sessionFetch = window.fetch;
        window.sessionHit = false;
        window.sessionDelivered = false;
        window.fetch = async (input, init) => {
          if (
            String(input) !==
            window.__TAURI_INTERNALS__.convertFileSrc(command, "ipc")
          )
            return window.sessionFetch(input, init);
          window.sessionHit = true;
          if (mode === "fail")
            return new Response(JSON.stringify("session test failure"), {
              headers: {
                "Content-Type": "application/json",
                "Tauri-Response": "error",
              },
            });
          const response = await window.sessionFetch(input, init);
          if (mode === "lost")
            return new Response(
              JSON.stringify("session acknowledgement lost"),
              {
                headers: {
                  "Content-Type": "application/json",
                  "Tauri-Response": "error",
                },
              },
            );
          await new Promise((resolve) => {
            window.sessionRelease = resolve;
          });
          window.sessionDelivered = true;
          return response;
        };
      },
      { command, mode },
    );
  }
  async function restore() {
    await page.evaluate(() => {
      window.fetch = window.sessionFetch;
      window.sessionRelease?.();
      delete window.sessionRelease;
    });
  }
  const hit = () => page.waitForFunction(() => window.sessionHit);
  await page.locator("#home-open").click();
  await dialog(file);
  await idle();
  await page.locator("#split-mode").click();
  await state("saved");
  const initial = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("document_state"),
  );

  // Reloading the WebView must not redefine the saved baseline as the dirty draft.
  await edit("draft before refresh");
  await state("dirty");
  await page.reload();
  await idle();
  await page.locator("#split-mode").click();
  await state("dirty");
  assert.equal(await text(), "draft before refresh");
  await edit("another draft");
  await state("dirty");
  await edit("draft before refresh");
  await state("dirty");
  await edit(original);
  await state("saved");
  assert.equal(await readFile(file, "utf8"), original);

  // Reject before commit and after commit (lost ACK); Save retries the latest text.
  for (const mode of ["fail", "lost"]) {
    await fault("document_edit", mode);
    await edit(`retry ${mode} 😀`);
    await state("sync-error");
    assert.notEqual(await readFile(file, "utf8"), `retry ${mode} 😀`);
    if (mode === "fail") {
      await page.locator("#home-back").click();
      await idle();
      assert(await page.locator("#home").isHidden());
      assert(await page.locator("#confirm-dialog").isHidden());
      await state("sync-error");
    }
    await restore();
    await page.locator("#save").click();
    await state("saved");
    assert.equal(await readFile(file, "utf8"), `retry ${mode} 😀`);
  }

  // A save waits for outstanding editor ACK; while saving, no input/switch can race.
  await fault("document_edit", "hold");
  await edit("queued earlier revision");
  await hit();
  await page.waitForFunction(() => typeof window.sessionRelease === "function");
  await edit("queued latest revision");
  await state("syncing");
  await page.locator("#save").click();
  assert(await page.locator("#open").isDisabled());
  assert.notEqual(await readFile(file, "utf8"), "queued latest revision");
  await restore();
  await state("saved");
  assert.equal(await readFile(file, "utf8"), "queued latest revision");
  await edit("save held");
  await state("dirty");
  await fault("document_action", "hold");
  await page.locator("#save").click();
  await hit();
  await state("saving");
  assert(await page.locator("#home-back").isDisabled());
  await page.locator(".cm-content").focus();
  await page.keyboard.insertText("MUST NOT INSERT");
  assert.equal(await text(), "save held");
  // Request arrival precedes the native response; release only once the held
  // response has installed its resolver (otherwise restore loses the release).
  await page.waitForFunction(() => typeof window.sessionRelease === "function");
  await restore();
  await state("saved");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await state("dirty");
  await page.keyboard.press("Control+y");
  await state("saved");

  // Native commit succeeded but its response was lost: reconcile, do not claim success.
  await edit("saved but response lost");
  await state("dirty");
  await fault("document_action", "lost");
  await page.locator("#save").click();
  await state("save-error");
  assert.equal(await readFile(file, "utf8"), "saved but response lost");
  await restore();
  await page.locator("#save-as").click();
  await dialog("", true);
  await state("save-error");
  assert.match(
    await page.locator("#save-indicator").getAttribute("class"),
    /failure/,
  );
  await page.screenshot({
    path: path.join(root, "session-save-unconfirmed.png"),
  });
  await page.locator("#save").click();
  await state("saved");

  // Actual backup-directory failure retains bytes, revision, path and a retryable buffer.
  const blocked = path.join(dir, "blocked");
  await mkdir(blocked);
  const blockedFile = path.join(blocked, "blocked.md");
  await writeFile(blockedFile, "old");
  await writeFile(path.join(blocked, ".mdmd-backups"), "block directory");
  await page.locator("#open").click();
  await dialog(blockedFile);
  await idle();
  await edit("retained on failure");
  await state("dirty");
  await page.locator("#save").click();
  await state("save-error");
  assert.equal(await readFile(blockedFile, "utf8"), "old");
  assert.equal(await text(), "retained on failure");
  await page.locator("#save-as").click();
  await dialog("", true);
  await state("save-error");
  await unlink(path.join(blocked, ".mdmd-backups"));
  await page.locator("#save").click();
  await state("saved");
  assert.equal(await readFile(blockedFile, "utf8"), "retained on failure");

  // Late disk polling from before Save As must not label the new target conflicted.
  await writeFile(blockedFile, "outside writer");
  await state("conflict");
  await fault("check_disk", "hold");
  await hit();
  await page.waitForFunction(() => typeof window.sessionRelease === "function");
  const copy = path.join(dir, "copy.md");
  await page.locator("#save-as").click();
  await dialog(copy);
  await state("saved");
  await restore();
  await page.waitForFunction(() => window.sessionDelivered);
  await page.waitForFunction(
    () => document.querySelector("#save-status").dataset.state === "saved",
  );
  assert.equal(await readFile(blockedFile, "utf8"), "outside writer");
  assert.equal(await readFile(copy, "utf8"), "retained on failure");

  await fault("check_disk", "fail");
  await state("disk-error");
  assert(await page.locator("#notice").isVisible());
  await page.screenshot({ path: path.join(root, "session-disk-unknown.png") });
  await restore();
  await state("saved");
  await unlink(copy);
  await state("conflict");
  await page.locator("#reload").click();
  await idle();
  await state("conflict");
  assert.equal(await text(), "retained on failure");
  await writeFile(copy, "retained on failure");
  await state("saved");

  // Stale ownership and revision never write to the new document through IPC.
  const denied = await page.evaluate(async (old) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const now = await invoke("document_state");
    const results = await Promise.allSettled([
      invoke("document_edit", {
        id: old.id,
        revision: old.revision + 1,
        content: "stale",
      }),
      invoke("document_action", {
        id: now.id,
        revision: now.revision + 1,
        name: "save",
        discard: false,
      }),
    ]);
    return results.map((r) => r.status);
  }, initial);
  assert.deepEqual(denied, ["rejected", "rejected"]);
  assert.equal(await readFile(copy, "utf8"), "retained on failure");

  // Untitled Save cancellation must abort the requested transition.
  await page.locator("#new").click();
  await idle();
  await state("unsaved");
  await edit("untitled draft");
  await state("dirty");
  await page.locator("#home-back").click();
  await page.locator("button[value=save]").click();
  await dialog("", true);
  await idle();
  await state("dirty");
  assert.equal(await text(), "untitled draft");
  await page.locator("#home-back").click();
  await page.locator("button[value=cancel]").click();
  await idle();
  await state("dirty");
  await page.locator("#home-back").click();
  await page.locator("button[value=discard]").click();
  await page.locator("#home-open:not(:disabled)").waitFor();

  const mixed = path.join(dir, "mixed.md");
  await writeFile(mixed, "a\r\nb\nc");
  await page.locator("#home-open").click();
  await dialog(mixed);
  await idle();
  await state("read-only");
  assert(await page.locator("#save").isDisabled());
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  page = await restart();
  console.log(
    "PASS: session dirty baseline after WebView reload, latest-revision ACK/retry before and after native commit, save serialization/input guard/undo, backup failure/cancel/retry, stale disk response/unknown/deleted state, stale session/revision rejection, untitled cancel/discard and read-only status.",
  );
  console.log("Session/save evidence:", root);
  return page;
}
