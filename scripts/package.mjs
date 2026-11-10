import {
  mkdir,
  copyFile,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const release = fileURLToPath(new URL("../../../release/", import.meta.url));
const output = (name) => path.join(release, name);
const psQuote = (value) => "'" + value.replaceAll("'", "''") + "'";
await mkdir(release, { recursive: true });
await copyFile("src-tauri/target/release/mdmd.exe", output("MDMD.exe"));
await copyFile("README.md", output("使用说明.md"));
// The bundled example is editable: updating the app must not overwrite user work.
await copyFile(
  "examples/欢迎使用MDMD.md",
  output("欢迎使用MDMD.md"),
  constants.COPYFILE_EXCL,
).catch((error) => {
  if (error.code !== "EEXIST") throw error;
});
await copyFile("config/engine-licenses.txt", output("第三方渲染资源许可.txt"));
await copyFile("packaging/LICENSE-tauri.txt", output("安装模板许可.txt"));
await copyFile("LICENSE", output("LICENSE"));
await copyFile("THIRD_PARTY_NOTICES.txt", output("THIRD_PARTY_NOTICES.txt"));
const bytes = await readFile(output("MDMD.exe"));
const files = [
  "MDMD.exe",
  "使用说明.md",
  "欢迎使用MDMD.md",
  "第三方渲染资源许可.txt",
  "安装模板许可.txt",
  "LICENSE",
  "THIRD_PARTY_NOTICES.txt",
];
if (process.argv.includes("--installer")) {
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  const directory = "src-tauri/target/release/bundle/nsis";
  const expected = `MDMD_${version}_x64-setup.exe`;
  if (!(await readdir(directory)).includes(expected))
    throw new Error(`Missing ${expected}`);
  const installer = `MDMD-${version}-x64-setup.exe`;
  await copyFile(`${directory}/${expected}`, output(installer));
  const zip = `MDMD-${version}-x64-portable.zip`;
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -LiteralPath ${files.map((f) => psQuote(output(f))).join(",")} -DestinationPath ${psQuote(output(zip))} -Force`,
    ],
    { windowsHide: true, stdio: "inherit" },
  );
  files.push(installer, zip);
}
const hashes = await Promise.all(
  files.map(
    async (name) =>
      `${createHash("sha256")
        .update(await readFile(output(name)))
        .digest("hex")}  ${name}\n`,
  ),
);
await writeFile(output("SHA256.txt"), hashes.join(""));
console.log(
  `Ready: ${output("MDMD.exe")} (${(bytes.length / 1024 / 1024).toFixed(1)} MiB)`,
);
