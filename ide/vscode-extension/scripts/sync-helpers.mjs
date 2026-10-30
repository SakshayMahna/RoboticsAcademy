#!/usr/bin/env node
// Copies the Python helpers the web frontend injects on Run into this extension, so the
// extension is self-contained. Sources in the repo are only read, never modified.
//   exercises/follow_line/python_template/*.py      -> exercises/follow_line/helpers/
//   common/<pkg>/<pkg>/** (what common.zip contains) -> exercises/common/<pkg>/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(extDir, "..", "..");
const exercise = JSON.parse(fs.readFileSync(path.join(extDir, "exercises/follow_line/exercise.json"), "utf8"));

const copy = (from, to) => {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, filter: (src) => !src.includes("__pycache__") });
  console.log(`${path.relative(repo, from)} -> ${path.relative(repo, to)}`);
};

const helpersDir = path.join(extDir, "exercises/follow_line/helpers");
fs.mkdirSync(helpersDir, { recursive: true });
for (const f of exercise.helpers) {
  fs.copyFileSync(path.join(repo, "exercises/follow_line/python_template", f), path.join(helpersDir, f));
  console.log(`exercises/follow_line/python_template/${f} -> ${path.relative(repo, path.join(helpersDir, f))}`);
}
for (const pkg of exercise.common) {
  copy(path.join(repo, "common", pkg, pkg), path.join(extDir, "exercises/common", pkg));
}
fs.mkdirSync(path.join(extDir, "exercises/follow_line/media"), { recursive: true });
fs.copyFileSync(
  path.join(repo, "exercises/follow_line/frontend/resources/default_circuit.png"),
  path.join(extDir, "exercises/follow_line/media/default_circuit.png"),
);
console.log("default_circuit.png copied");
