import * as vscode from "vscode";
import type { Exercise } from "./exercise/Exercise";

/**
 * Creates a student project from exercises/<id>/template: main.py plus editor stubs.
 * Helper files are not copied; they're injected on Run.
 */
export async function newProject(exercise: Exercise, extensionUri: vscode.Uri): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: `Create ${exercise.title} project here`,
    title: `New ${exercise.title} project: pick an (empty) folder`,
  });
  const dest = picked?.[0];
  if (!dest) {
    return;
  }

  const template = vscode.Uri.joinPath(extensionUri, "exercises", exercise.manifest.id, "template");
  const files = await listFiles(template);
  const existing: string[] = [];
  for (const rel of files) {
    if (await exists(vscode.Uri.joinPath(dest, rel))) {
      existing.push(rel);
    }
  }
  if (existing.length) {
    const choice = await vscode.window.showWarningMessage(
      `${existing.join(", ")} already exist in ${dest.fsPath}.`,
      { modal: true },
      "Overwrite",
      "Keep mine",
    );
    if (!choice) {
      return;
    }
    if (choice === "Keep mine") {
      files.splice(0, files.length, ...files.filter((f) => !existing.includes(f)));
    }
  }
  for (const rel of files) {
    await vscode.workspace.fs.copy(vscode.Uri.joinPath(template, rel), vscode.Uri.joinPath(dest, rel), { overwrite: true });
  }

  const open = await vscode.window.showInformationMessage(
    `Created ${exercise.title} project in ${dest.fsPath}.`,
    "Open Project",
    "Open in New Window",
  );
  if (open) {
    await vscode.commands.executeCommand("vscode.openFolder", dest, { forceNewWindow: open === "Open in New Window" });
  }
}

async function listFiles(dir: vscode.Uri, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (type === vscode.FileType.Directory) {
      out.push(...(await listFiles(vscode.Uri.joinPath(dir, name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
