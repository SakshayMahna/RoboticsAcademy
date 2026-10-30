import fs from "node:fs";
import path from "node:path";
import type { RunApplicationData, WorldConfig } from "../ram/types";
import { buildCodeZip, collectStudentFiles, collectTree, type CodeZip, type ZipEntry } from "./zip";

/** Shape of exercises/<id>/exercise.json — the seed of a future manifest format. */
export interface ExerciseManifest {
  id: string;
  title: string;
  world: WorldConfig;
  tools: string[];
  tools_config: Record<string, string>;
  /** Files from exercises/<id>/helpers/ injected at the zip root on Run. */
  helpers: string[];
  /** Packages from exercises/common/ injected on Run (the web frontend's common.zip). */
  common: string[];
  entrypoint: string;
  circuit?: string;
  panels: { gazebo?: number; console?: number; webgui?: boolean };
}

export interface RunPayload {
  data: RunApplicationData;
  zip: CodeZip;
}

export class Exercise {
  readonly dir: string;

  private constructor(
    readonly manifest: ExerciseManifest,
    private readonly exercisesRoot: string,
  ) {
    this.dir = path.join(exercisesRoot, manifest.id);
  }

  static load(exercisesRoot: string, id: string): Exercise {
    const file = path.join(exercisesRoot, id, "exercise.json");
    if (!fs.existsSync(file)) {
      throw new Error(`Exercise '${id}' not found (${file}). Only follow_line is bundled in the prototype.`);
    }
    return new Exercise(JSON.parse(fs.readFileSync(file, "utf8")) as ExerciseManifest, exercisesRoot);
  }

  get title(): string {
    return this.manifest.title;
  }

  get worldName(): string {
    return this.manifest.world.name;
  }

  get startPose(): [number, number] {
    const p = this.manifest.world.robot[0]?.start_pose ?? [0, 0];
    return [p[0], p[1]];
  }

  get helperNames(): string[] {
    return this.manifest.helpers;
  }

  launchWorldData(): WorldConfig {
    return this.manifest.world;
  }

  prepareToolsData(): { tools: string[]; config: Record<string, string> } {
    return { tools: this.manifest.tools, config: this.manifest.tools_config };
  }

  async helperEntries(): Promise<ZipEntry[]> {
    const out: ZipEntry[] = [];
    for (const name of this.manifest.helpers) {
      out.push({ path: name, content: await fs.promises.readFile(path.join(this.dir, "helpers", name)) });
    }
    for (const pkg of this.manifest.common) {
      out.push(...(await collectTree(path.join(this.exercisesRoot, "common", pkg), pkg)));
    }
    return out;
  }

  /**
   * Builds the run_application payload from the project folder.
   * @param entrypoint file name in the project root (falls back to the manifest entrypoint)
   */
  async buildRun(projectDir: string, entrypoint: string | undefined, lint: boolean): Promise<RunPayload> {
    const student = await collectStudentFiles(projectDir);
    const ep = entrypoint ?? this.manifest.entrypoint;
    if (!student.some((f) => f.path === ep)) {
      throw new Error(`Entrypoint '${ep}' not found in ${projectDir}.`);
    }
    if (this.manifest.helpers.includes(ep)) {
      throw new Error(`'${ep}' is a helper file name and can't be the entrypoint.`);
    }
    const zip = await buildCodeZip(student, await this.helperEntries());
    return {
      zip,
      data: {
        entrypoint: [`/workspace/code/${ep}`],
        linter: lint ? [ep] : [],
        code: zip.dataUrl,
      },
    };
  }
}
