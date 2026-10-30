import path from "node:path";
import * as vscode from "vscode";
import { Exercise } from "./exercise/Exercise";
import { carPixel, LapTracker, parseUpdate, type FollowLineFrame, type FrequencyInfo, type LapSnapshot } from "./exercise/followLine";
import { WebGuiBridge } from "./exercise/WebGuiBridge";
import type { Log } from "./log";
import { RamClient, RamError } from "./ram/RamClient";
import { RUNNABLE_STATES, type ClientState, type RamCommand } from "./ram/types";

export interface Frame extends FollowLineFrame {
  /** Car position on the 300x150 circuit map. */
  carPx?: [number, number];
}

interface RunTarget {
  projectDir: string;
  entrypoint?: string;
}

/**
 * Owns the RAM connection and the exercise lifecycle. UI pieces (status bar, control view,
 * panels) only read from here and call its actions.
 */
export class Controller implements vscode.Disposable {
  readonly client = new RamClient();
  readonly bridge: WebGuiBridge;
  readonly laps: LapTracker;

  /** Short description of the operation in progress, if any. */
  busy?: string;
  /** Web GUI rendering on/off. Acks continue either way. */
  displayEnabled = true;
  lastFrame?: Frame;
  freq?: FrequencyInfo;

  private lastRun?: RunTarget;
  private userClosing = false;
  private disposables: vscode.Disposable[] = [];

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fires on state/busy/lap/display changes (not on every frame). */
  readonly onDidChange = this._onDidChange.event;
  private readonly _onFrame = new vscode.EventEmitter<Frame>();
  readonly onFrame = this._onFrame.event;

  constructor(
    readonly exercise: Exercise,
    private readonly log: Log,
  ) {
    this.bridge = new WebGuiBridge(this.client);
    this.laps = new LapTracker(exercise.startPose);

    this.client.on("message", (dir, msg) => {
      if ((msg.command === "gui" || msg.command === "update") && !this.config.get<boolean>("logGuiTraffic")) {
        return;
      }
      log.frame(dir, msg);
    });
    this.client.on("stateChanged", (state, prev) => {
      log.info(`State: ${prev} → ${state}`);
      void vscode.commands.executeCommand("setContext", "roboticsAcademy.state", state);
      if (state === "tools_ready" && prev !== "tools_ready") {
        this.lastFrame = undefined;
      }
      this._onDidChange.fire();
    });
    this.client.on("introspection", (info) => {
      log.info(
        `Robotics Backend ${this.version ?? "?"}, ROS ${info.ros_version?.trim() ?? "?"}, GPU ${info.gpu_avaliable?.trim() ?? "?"}`,
      );
      this._onDidChange.fire();
    });
    this.client.on("connectionClosed", (reason) => {
      log.warn(`Connection closed (${reason})`);
      if (!this.userClosing && !this.busy) {
        void vscode.window
          .showWarningMessage("Connection to the Robotics Backend was closed.", "Reconnect", "Show Log")
          .then((choice) => {
            if (choice === "Reconnect") {
              void vscode.commands.executeCommand("roboticsAcademy.connect");
            } else if (choice === "Show Log") {
              log.show();
            }
          });
      }
    });
    this.client.on("error", (err) => log.error(err.message));
    this.bridge.onUpdateReceived((update) => this.onUpdate(update));

    void vscode.commands.executeCommand("setContext", "roboticsAcademy.state", this.client.state);
  }

  get state(): ClientState {
    return this.client.state;
  }

  get version(): string | undefined {
    return this.client.introspection?.robotics_backend_version?.trim();
  }

  get lap(): LapSnapshot {
    return this.laps.value;
  }

  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("roboticsAcademy");
  }

  // ---------------------------------------------------------------- connection

  async connect(): Promise<void> {
    if (this.state !== "disconnected") {
      vscode.window.showInformationMessage(`Already connected (${this.state}).`);
      return;
    }
    const url = this.config.get<string>("ramUrl", "ws://127.0.0.1:7163");
    await this.withBusy("Connecting…", `Connecting to the Robotics Backend at ${url}…`, async () => {
      this.log.info(`Connecting to ${url}`);
      await this.client.connect(url);
    });
    if (this.state !== "disconnected") {
      vscode.window.setStatusBarMessage(`Robotics Backend ${this.version ?? ""} connected`, 4000);
    }
  }

  async disconnect(): Promise<void> {
    this.userClosing = true;
    try {
      await this.client.disconnect();
    } finally {
      this.userClosing = false;
      this._onDidChange.fire();
    }
  }

  /**
   * RAM treats any socket close as `disconnect` (tears the world down and restarts itself),
   * so reconnecting always starts from a fresh `connected`. Retries with backoff while RAM
   * comes back up; never loops beyond that.
   */
  async reconnect(): Promise<void> {
    if (this.state !== "disconnected") {
      await this.disconnect();
    }
    const url = this.config.get<string>("ramUrl", "ws://127.0.0.1:7163");
    const delays = [0, 2000, 5000, 10000];
    await this.withBusy("Reconnecting…", `Reconnecting to ${url}…`, async (progress) => {
      for (let i = 0; i < delays.length; i++) {
        if (delays[i]) {
          progress.report({ message: `retrying in ${delays[i] / 1000} s (attempt ${i + 1}/${delays.length})` });
          await new Promise((r) => setTimeout(r, delays[i]));
        }
        try {
          await this.client.connect(url);
          return;
        } catch (err) {
          const retryable = err instanceof RamError && (err.kind === "unreachable" || err.kind === "busy");
          this.log.warn(`Reconnect attempt ${i + 1} failed: ${(err as Error).message}`);
          if (!retryable || i === delays.length - 1) {
            throw err;
          }
        }
      }
    });
  }

  // ------------------------------------------------------------------- world

  async launchWorld(): Promise<void> {
    if (this.state === "disconnected") {
      await this.connect();
      if (this.state === "disconnected") {
        return;
      }
    }
    if (RUNNABLE_STATES.includes(this.state)) {
      vscode.window.showInformationMessage("The exercise world is already running.");
      return;
    }
    await this.withBusy(
      "Launching world…",
      "Launching world… (this can take a minute under emulation)",
      async (progress) => {
        if (this.state === "connected") {
          progress.report({ message: `Starting ${this.exercise.worldName} in Gazebo` });
          await this.client.request("launch_world", this.exercise.launchWorldData());
        }
        if (this.state === "world_ready") {
          progress.report({ message: "Starting tools (Gazebo view, console, web GUI)" });
          await this.client.request("prepare_tools", this.exercise.prepareToolsData());
        }
      },
    );
  }

  async stopWorld(): Promise<void> {
    await this.withBusy("Stopping world…", "Stopping world…", async () => {
      const ladder: [ClientState[], RamCommand][] = [
        [["application_running", "paused"], "terminate_application"],
        [["tools_ready"], "terminate_tools"],
        [["world_ready"], "terminate_world"],
      ];
      for (const [from, command] of ladder) {
        if (from.includes(this.state)) {
          await this.ignoreInvalidTransition(this.client.request(command));
        }
      }
    });
  }

  // --------------------------------------------------------------------- app

  async run(target?: vscode.Uri): Promise<void> {
    const runTarget = this.resolveRunTarget(target);
    if (!runTarget) {
      return;
    }
    await this.startRun(runTarget);
  }

  async restartRun(): Promise<void> {
    const runTarget = this.lastRun ?? this.resolveRunTarget();
    if (!runTarget) {
      return;
    }
    if (this.state === "application_running" || this.state === "paused") {
      await this.withBusy("Stopping app…", undefined, () => this.client.request("terminate_application"));
    }
    await this.startRun(runTarget);
  }

  async pause(): Promise<void> {
    await this.withBusy("Pausing…", undefined, () => this.client.request("pause"));
  }

  async resume(): Promise<void> {
    await this.withBusy("Resuming…", undefined, () => this.client.request("resume"));
  }

  async stopApp(): Promise<void> {
    await this.withBusy("Stopping app…", undefined, () => this.client.request("terminate_application"));
  }

  private async startRun(runTarget: RunTarget): Promise<void> {
    if (!RUNNABLE_STATES.includes(this.state)) {
      vscode.window.showWarningMessage("Launch the exercise world first (tools must be ready before running code).");
      return;
    }
    await this.saveDirty(runTarget.projectDir);
    const lint = this.config.get<boolean>("lintOnRun", false);
    const { data, zip } = await this.exercise.buildRun(runTarget.projectDir, runTarget.entrypoint, lint);
    if (zip.shadowed.length) {
      const msg = `Your project has ${zip.shadowed.join(", ")}, which the exercise provides. Your copy was not sent.`;
      this.log.warn(msg);
      void vscode.window.showWarningMessage(msg);
    }
    this.log.info(`Run ${data.entrypoint[0]} (${zip.files.length} files: ${zip.files.filter((f) => !f.includes("/")).join(", ")}, …)`);
    this.lastRun = runTarget;
    this.laps.newRun();
    await this.withBusy("Starting app…", `Running ${path.basename(data.entrypoint[0])}…`, () =>
      this.client.request("run_application", data),
    );
  }

  /** Project = workspace folder of the given/active file (else the first folder). */
  private resolveRunTarget(target?: vscode.Uri): RunTarget | undefined {
    const file = target ?? vscode.window.activeTextEditor?.document.uri;
    const folder =
      (file && vscode.workspace.getWorkspaceFolder(file)) ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showErrorMessage(
        "Open a Follow Line project folder first (Robotics Academy: New Follow Line Project).",
      );
      return undefined;
    }
    const projectDir = folder.uri.fsPath;
    let entrypoint: string | undefined;
    if (file?.scheme === "file" && file.fsPath.endsWith(".py") && path.dirname(file.fsPath) === projectDir) {
      const name = path.basename(file.fsPath);
      if (!this.exercise.helperNames.includes(name)) {
        entrypoint = name;
      }
    }
    return { projectDir, entrypoint };
  }

  private async saveDirty(projectDir: string): Promise<void> {
    const dirty = vscode.workspace.textDocuments.filter(
      (d) => d.isDirty && d.uri.scheme === "file" && d.uri.fsPath.startsWith(projectDir + path.sep),
    );
    await Promise.all(dirty.map((d) => d.save()));
  }

  // ----------------------------------------------------------------- web GUI

  toggleDisplay(): void {
    this.displayEnabled = !this.displayEnabled;
    this.log.info(`Web GUI display ${this.displayEnabled ? "on" : "off"} (acks continue)`);
    this._onDidChange.fire();
  }

  resetBestLap(): void {
    this.laps.resetBest();
    this._onDidChange.fire();
  }

  private lastLapFire = 0;

  private onUpdate(update: Record<string, unknown>): void {
    const { frame, freq } = parseUpdate(update);
    if (freq) {
      this.freq = freq;
      this._onDidChange.fire();
      return;
    }
    if (!frame) {
      return;
    }
    const out: Frame = { ...frame };
    if (frame.pose) {
      out.carPx = carPixel(this.exercise.manifest.circuit ?? "default", frame.pose);
    }
    // Keep the previous image if this update carried none (WebGUI.py only sends changed frames).
    out.image ??= this.lastFrame?.image;
    this.lastFrame = out;
    if (this.laps.feed(frame)) {
      const now = Date.now();
      if (now - this.lastLapFire > 200) {
        this.lastLapFire = now;
        this._onDidChange.fire();
      }
    }
    this._onFrame.fire(out);
  }

  // ----------------------------------------------------------------- helpers

  private async ignoreInvalidTransition<T>(p: Promise<T>): Promise<void> {
    try {
      await p;
    } catch (err) {
      if (err instanceof RamError && err.kind === "error" && /can't trigger|invalid/i.test(err.message)) {
        this.log.info(`Ignored: ${err.message}`);
        return;
      }
      throw err;
    }
  }

  private async withBusy<T>(
    label: string,
    notification: string | undefined,
    fn: (progress: vscode.Progress<{ message?: string }>) => Promise<T>,
  ): Promise<T | undefined> {
    if (this.busy) {
      void vscode.window.showInformationMessage(`Busy: ${this.busy}`);
      return undefined;
    }
    this.busy = label;
    this._onDidChange.fire();
    try {
      if (notification) {
        return await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: notification },
          fn,
        );
      }
      return await fn({ report: () => {} });
    } finally {
      this.busy = undefined;
      this._onDidChange.fire();
    }
  }

  dispose(): void {
    this.bridge.dispose();
    this.userClosing = true;
    void this.client.close("extension deactivated");
    this._onDidChange.dispose();
    this._onFrame.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
