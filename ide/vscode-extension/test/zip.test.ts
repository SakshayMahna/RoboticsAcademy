import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { Exercise } from "../src/exercise/Exercise";
import { buildCodeZip, ZIP_DATA_URL_PREFIX } from "../src/exercise/zip";

async function unzip(dataUrl: string): Promise<JSZip> {
  return JSZip.loadAsync(dataUrl.slice(ZIP_DATA_URL_PREFIX.length), { base64: true });
}

describe("buildCodeZip", () => {
  it("puts student files and helpers at the zip root; helpers win", async () => {
    const zip = await buildCodeZip(
      [
        { path: "main.py", content: "import HAL" },
        { path: "util.py", content: "x = 1" },
        { path: "HAL.py", content: "STUDENT COPY" },
      ],
      [
        { path: "HAL.py", content: "REAL HAL" },
        { path: "WebGUI.py", content: "REAL GUI" },
        { path: "hal_interfaces/general/camera.py", content: "cam" },
      ],
    );

    expect(zip.dataUrl.startsWith("data:application/zip;base64,")).toBe(true);
    expect(zip.shadowed).toEqual(["HAL.py"]);
    expect(zip.files).toEqual(["HAL.py", "WebGUI.py", "hal_interfaces/general/camera.py", "main.py", "util.py"]);

    const z = await unzip(zip.dataUrl);
    expect(await z.file("HAL.py")!.async("string")).toBe("REAL HAL");
    expect(await z.file("main.py")!.async("string")).toBe("import HAL");
    expect(await z.file("hal_interfaces/general/camera.py")!.async("string")).toBe("cam");
  });
});

describe("Exercise.buildRun (follow_line)", () => {
  const exercisesRoot = path.resolve(__dirname, "..", "exercises");

  function project(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-proj-"));
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }

  it("builds the run_application payload with helpers and common packages", async () => {
    const ex = Exercise.load(exercisesRoot, "follow_line");
    const dir = project({ "main.py": "import HAL\n", "pid.py": "", "notes.txt": "", "typings/HAL.pyi": "" });
    const { data, zip } = await ex.buildRun(dir, undefined, false);

    expect(data.entrypoint).toEqual(["/workspace/code/main.py"]);
    expect(data.linter).toEqual([]);
    expect(data.code.startsWith(ZIP_DATA_URL_PREFIX)).toBe(true);
    for (const f of ["main.py", "pid.py", "HAL.py", "WebGUI.py", "lap.py", "Frequency.py", "hal_interfaces/general/motors.py", "gui_interfaces/general/measuring_threading_gui_harmonic.py", "console_interfaces/general/console.py"]) {
      expect(zip.files).toContain(f);
    }
    expect(zip.files).not.toContain("notes.txt");
    expect(zip.files.some((f) => f.startsWith("typings/"))).toBe(false);
  });

  it("uses the given entrypoint and lints it when asked", async () => {
    const ex = Exercise.load(exercisesRoot, "follow_line");
    const dir = project({ "main.py": "", "v2.py": "" });
    const { data } = await ex.buildRun(dir, "v2.py", true);
    expect(data.entrypoint).toEqual(["/workspace/code/v2.py"]);
    expect(data.linter).toEqual(["v2.py"]);
  });

  it("fails clearly when the entrypoint is missing", async () => {
    const ex = Exercise.load(exercisesRoot, "follow_line");
    await expect(ex.buildRun(project({ "other.py": "" }), undefined, false)).rejects.toThrow(/main.py/);
  });

  it("has the launch payload RAM validates", () => {
    const ex = Exercise.load(exercisesRoot, "follow_line");
    const w = ex.launchWorldData();
    expect(w.scene).toMatchObject({ type: "gz", launch_file_path: expect.any(String) });
    for (const r of w.robot) {
      expect(r).toMatchObject({ type: "gz", launch_file_path: expect.any(String), entity: "f1", extra_config: expect.any(String) });
      expect(r.start_pose).toHaveLength(6);
    }
    expect(ex.prepareToolsData()).toEqual({
      tools: ["console", "simulator", "web_gui"],
      config: { gzsim: "/opt/jderobot/Launchers/visualization/simple_circuit.config" },
    });
  });
});
