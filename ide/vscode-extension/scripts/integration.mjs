#!/usr/bin/env node
// Runs test/integration/suite.ts inside an ISOLATED VS Code (user data, extensions and the
// test workspace all live under .vscode-dev/), against an in-process mock RAM.
// Dir names are short on purpose: macOS limits the IPC socket path VS Code creates in the
// user-data dir to ~103 chars.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const extDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devDir = path.join(extDir, ".vscode-dev");

const candidates = [
  process.env.VSCODE_EXECUTABLE,
  "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
  "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
  path.join(process.env.HOME ?? "", "Applications/Visual Studio Code.app/Contents/MacOS/Code"),
].filter(Boolean);
const exe = candidates.find((c) => fs.existsSync(c));
if (!exe) {
  console.error("VS Code executable not found. Set VSCODE_EXECUTABLE.");
  process.exit(1);
}

await import(path.join(extDir, "esbuild.mjs"));
await esbuild.build({
  entryPoints: [path.join(extDir, "test/integration/suite.ts")],
  outfile: path.join(devDir, "it/suite.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode", "bufferutil", "utf-8-validate"],
  logLevel: "warning",
});

// Fresh copy of the sample project so the test can edit/save files.
const workspace = path.join(devDir, "it/workspace");
fs.rmSync(workspace, { recursive: true, force: true });
fs.cpSync(path.join(extDir, "sample-workspace/follow_line"), workspace, { recursive: true });

const args = [
  `--user-data-dir=${path.join(devDir, "itud")}`,
  `--extensions-dir=${path.join(devDir, "itext")}`,
  `--extensionDevelopmentPath=${extDir}`,
  `--extensionTestsPath=${path.join(devDir, "it/suite.js")}`,
  "--disable-extensions",
  "--disable-workspace-trust",
  "--skip-welcome",
  "--skip-release-notes",
  "--new-window",
  workspace,
];
console.log(`> ${exe} ${args.join(" ")}`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(exe, args, { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 1));
