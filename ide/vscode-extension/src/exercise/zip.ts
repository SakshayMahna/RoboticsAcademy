import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

export interface ZipEntry {
  /** Path inside the zip, with forward slashes. */
  path: string;
  content: Uint8Array | string;
}

export interface CodeZip {
  dataUrl: string;
  files: string[];
  /** Student files dropped because a helper has the same name. */
  shadowed: string[];
}

export const ZIP_DATA_URL_PREFIX = "data:application/zip;base64,";

/**
 * Builds the run_application zip: student files and helpers at the zip root.
 * Helpers win on name clashes (including student files colliding with a helper package dir).
 */
export async function buildCodeZip(student: ZipEntry[], helpers: ZipEntry[]): Promise<CodeZip> {
  const zip = new JSZip();
  const helperPaths = new Set(helpers.map((h) => h.path));
  const helperRoots = new Set(helpers.map((h) => h.path.split("/")[0]));
  const shadowed: string[] = [];

  for (const f of student) {
    if (helperPaths.has(f.path) || helperRoots.has(f.path.split("/")[0])) {
      shadowed.push(f.path);
      continue;
    }
    zip.file(f.path, f.content);
  }
  for (const h of helpers) {
    zip.file(h.path, h.content);
  }

  const base64 = await zip.generateAsync({ type: "base64", compression: "DEFLATE" });
  const files = Object.keys(zip.files)
    .filter((f) => !zip.files[f].dir)
    .sort();
  return { dataUrl: ZIP_DATA_URL_PREFIX + base64, files, shadowed };
}

/** Student code: *.py files in the project root (non-recursive for the prototype). */
export async function collectStudentFiles(projectDir: string): Promise<ZipEntry[]> {
  const entries = await fs.readdir(projectDir, { withFileTypes: true });
  const out: ZipEntry[] = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".py")) {
      out.push({ path: e.name, content: await fs.readFile(path.join(projectDir, e.name)) });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** All files under `dir`, recursively, with paths relative to `dir` (skips __pycache__). */
export async function collectTree(dir: string, prefix = ""): Promise<ZipEntry[]> {
  const out: ZipEntry[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name === "__pycache__" || e.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await collectTree(full, rel)));
    } else if (e.isFile()) {
      out.push({ path: rel, content: await fs.readFile(full) });
    }
  }
  return out;
}
