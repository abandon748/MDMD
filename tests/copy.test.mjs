import assert from "node:assert/strict";
import { writeFile, readFile, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { tableCsv } from "../src/csv.ts";
import { testClipboardEdit } from "./clipboard-edit.test.mjs";
export async function testCopy({ page, root, dialog, waitFor }) {
  await testClipboardEdit({ page, root, dialog, waitFor });
  const file = path.join(root, "复制.md"),
    table = '| Name | Value |\n| --- | --- |\n| **中文** | a,"b" |\n',
    source = "# Copy\n\n" + table;
  assert.equal(
    tableCsv(table),
    '\ufeff"Name","Value"\r\n"**中文**","a,""b"""\r\n',
  );
  await writeFile(file, source);
  await page
    .locator((await page.locator("#home").isVisible()) ? "#home-open" : "#open")
    .click();
  await dialog(file);
  await page.locator("#open:not(:disabled)").waitFor();
  await page.locator("#output-open").click();
  const ready = path.join(root, "copy-ready"),
    expected = path.join(root, "copy-expected.txt");
  await writeFile(expected, source);
  const clipboard = promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.resolve("tests/feedback-clipboard.ps1"),
      "-ExpectedFilePath",
      expected,
      "-ReadyFilePath",
      ready,
    ],
    { windowsHide: true, timeout: 30000 },
  ).then(
    (v) => ({ v }),
    (e) => ({ e }),
  );
  await waitFor(async () => {
    try {
      await access(ready);
      return true;
    } catch {
      return false;
    }
  }, "clipboard saved");
  await page.locator("#output-markdown").click();
  await waitFor(
    async () =>
      /已复制/.test(await page.locator("#output-message").innerText()),
    "copy Markdown",
  );
  const clip = await clipboard;
  if (clip.e) throw clip.e;
  assert.equal(JSON.parse(clip.v.stdout).restored, true);
  await page.evaluate(() => {
    window.realWriteText = navigator.clipboard.writeText;
    window.realWrite = navigator.clipboard.write;
    navigator.clipboard.writeText = async (text) => {
      window.copiedText = text;
    };
    navigator.clipboard.write = async (items) => {
      window.copiedHtml = await (await items[0].getType("text/html")).text();
      window.copiedPlain = await (await items[0].getType("text/plain")).text();
    };
  });
  await page.locator("#output-html-copy").click();
  await waitFor(
    async () => await page.evaluate(() => !!window.copiedText),
    "HTML copied",
  );
  assert.match(await page.evaluate(() => window.copiedText), /<!doctype html>/);
  await page.locator("#output-rich").click();
  await waitFor(
    async () => await page.evaluate(() => !!window.copiedHtml),
    "rich copied",
  );
  assert.match(await page.evaluate(() => window.copiedHtml), /<table/);
  assert.match(await page.evaluate(() => window.copiedPlain), /中文/);
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject("denied");
  });
  await page.locator("#output-markdown").click();
  await waitFor(
    async () =>
      /处理失败/.test(await page.locator("#output-message").innerText()),
    "denied clipboard",
  );
  await page.evaluate(() => {
    navigator.clipboard.writeText = window.realWriteText;
    navigator.clipboard.write = window.realWrite;
  });
  await page.locator("#output-csv").click();
  await dialog("", true);
  await waitFor(
    async () => /取消/.test(await page.locator("#output-message").innerText()),
    "CSV cancelled",
  );
  const csv = path.join(root, "table.csv");
  await page.locator("#output-csv").click();
  await dialog(csv);
  await waitFor(
    async () =>
      /已导出/.test(await page.locator("#output-message").innerText()),
    "CSV saved",
  );
  assert.equal(await readFile(csv, "utf8"), tableCsv(table));
  assert.equal(await readFile(file, "utf8"), source);
  await page.locator("#output-close").click();
  await page.locator("#home-back").click();
  await page.locator("#home-open:not(:disabled)").waitFor();
  console.log(
    "PASS: real Markdown clipboard with restoration, HTML/rich payload contracts, denied clipboard recovery, CSV quoting/BOM/cancel/save and source preservation. Rich clipboard OS handoff is mocked.",
  );
  return page;
}
