#!/usr/bin/env node
// Launches an ISOLATED VS Code instance for developing the extension.
// Everything VS Code writes goes to ./.vscode-dev/ — the user's normal profile is never touched.
//
// Usage: npm run dev [-- --watch] [-- --with-extensions] [-- <folder to open>]
//   --watch            keep esbuild running in watch mode after launching
//   --with-extensions  don't pass --disable-extensions (e.g. to use the Python extension
//                      installed into .vscode-dev/extensions)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devDir = path.join(extDir, ".vscode-dev");
const userDataDir = path.join(devDir, "user-data");
const extensionsDir = path.join(devDir, "extensions");

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const withExtensions = args.includes("--with-extensions");
const folderArg = args.find((a) => !a.startsWith("--"));
const workspace = path.resolve(folderArg ?? path.join(extDir, "sample-workspace", "follow_line"));

export function findCode() {
  const onPath = spawnSync(process.platform === "win32" ? "where" : "which", ["code"], { encoding: "utf8" });
  if (onPath.status === 0 && onPath.stdout.trim()) {
    return onPath.stdout.trim().split(/\r?\n/)[0];
  }
  const candidates = [
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    path.join(process.env.HOME ?? "", "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"),
  ];
  return candidates.find((c) => fs.existsSync(c));
}

const code = findCode();
if (!code) {
  console.error(
    "Could not find VS Code. Install it in /Applications, or put the `code` command on PATH yourself.\n" +
      "(This script will not install the shell command for you.)",
  );
  process.exit(1);
}

// Build first so dist/ exists before VS Code loads the extension.
const build = spawnSync(process.execPath, [path.join(extDir, "esbuild.mjs")], { cwd: extDir, stdio: "inherit" });
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

// Seed isolated settings (only inside .vscode-dev, only if missing).
const settingsFile = path.join(userDataDir, "User", "settings.json");
if (!fs.existsSync(settingsFile)) {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(
    settingsFile,
    JSON.stringify(
      {
        "telemetry.telemetryLevel": "off",
        "workbench.startupEditor": "none",
        "update.mode": "none",
        "extensions.autoUpdate": false,
        "security.workspace.trust.enabled": false,
      },
      null,
      2,
    ),
  );
}
fs.mkdirSync(extensionsDir, { recursive: true });

// VS Code creates "<user-data-dir>/<version>-main.sock"; macOS caps unix socket paths at 103 bytes.
if (process.platform === "darwin" && path.join(userDataDir, "1.99-main.sock").length > 103) {
  console.warn(
    `Warning: ${userDataDir} is a deep path; VS Code may fail with "listen EINVAL ... main.sock".\n` +
      "Clone the repo to a shorter path if the dev instance doesn't open.",
  );
}

const codeArgs = [
  `--user-data-dir=${userDataDir}`,
  `--extensions-dir=${extensionsDir}`,
  `--extensionDevelopmentPath=${extDir}`,
  ...(withExtensions ? [] : ["--disable-extensions"]),
  "--new-window",
  workspace,
];

const quote = (s) => (/[\s"']/.test(s) ? JSON.stringify(s) : s);
console.log(`\n> ${[code, ...codeArgs].map(quote).join(" ")}\n`);

const child = spawn(code, codeArgs, { stdio: "inherit" });
child.on("exit", (status) => {
  if (status) {
    process.exit(status);
  }
  if (watch) {
    console.log("Watching for changes (Ctrl+C to stop). Use 'Developer: Reload Window' in the dev instance to pick them up.");
    spawn(process.execPath, [path.join(extDir, "esbuild.mjs"), "--watch"], { cwd: extDir, stdio: "inherit" });
  }
});
