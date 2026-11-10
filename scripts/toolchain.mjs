import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
const cargoBin = path.join(homedir(), ".cargo", "bin");
process.env.PATH = cargoBin + path.delimiter + process.env.PATH;
const [tool, ...args] = process.argv.slice(2);
const child =
  tool === "cargo"
    ? spawn(
        path.join(
          cargoBin,
          process.platform === "win32" ? "cargo.exe" : "cargo",
        ),
        args,
        { cwd: "src-tauri", stdio: "inherit" },
      )
    : spawn(
        process.execPath,
        ["node_modules/@tauri-apps/cli/tauri.js", ...args],
        { stdio: "inherit" },
      );
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
