import * as vscode from "vscode";
import { Controller } from "./Controller";
import { Exercise } from "./exercise/Exercise";
import { Log } from "./log";
import { VncPanel, type VncPanelSpec } from "./panels/VncPanel";
import { WebGuiPanel } from "./panels/WebGuiPanel";
import { newProject } from "./project";
import { RamError } from "./ram/RamClient";
import { ControlView, CONTROL_VIEW_ID } from "./ui/ControlView";
import { readyWebviews } from "./ui/html";
import { StatusBar } from "./ui/StatusBar";

/** Exposed for the integration test (test/integration). */
export interface ExtensionApi {
  controller: Controller;
  readyWebviews: ReadonlySet<string>;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi | undefined {
  const log = new Log();
  context.subscriptions.push(log);

  const exerciseId = vscode.workspace.getConfiguration("roboticsAcademy").get<string>("exercise", "follow_line");
  let exercise: Exercise;
  try {
    exercise = Exercise.load(vscode.Uri.joinPath(context.extensionUri, "exercises").fsPath, exerciseId);
  } catch (err) {
    log.error(String(err));
    void vscode.window.showErrorMessage(`Robotics Academy: ${(err as Error).message}`);
    return undefined;
  }

  const controller = new Controller(exercise, log);
  const controlView = new ControlView(controller, context.extensionUri);
  context.subscriptions.push(
    controller,
    new StatusBar(controller),
    controlView,
    vscode.window.registerWebviewViewProvider(CONTROL_VIEW_ID, controlView),
  );

  const panels = exercise.manifest.panels;
  const gazebo: VncPanelSpec = { viewType: "roboticsAcademy.gazebo", title: "Gazebo", port: panels.gazebo ?? 6080 };
  const console_: VncPanelSpec = { viewType: "roboticsAcademy.console", title: "Console", port: panels.console ?? 6082 };

  /** Every command goes through here: errors become notifications, never unhandled rejections. */
  const register = (id: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(`roboticsAcademy.${id}`, async (...args: unknown[]) => {
        try {
          await fn(...args);
        } catch (err) {
          reportError(log, id, err);
        }
      }),
    );

  register("hello", () => vscode.window.showInformationMessage("Hello from Robotics Academy (prototype)!"));
  register("connect", () => controller.connect());
  register("disconnect", () => controller.disconnect());
  register("reconnect", () => controller.reconnect());
  register("launchWorld", () => controller.launchWorld());
  register("stopWorld", () => controller.stopWorld());
  register("run", (uri?: vscode.Uri) => controller.run(uri instanceof vscode.Uri ? uri : undefined));
  register("pause", () => controller.pause());
  register("resume", () => controller.resume());
  register("stopApp", () => controller.stopApp());
  register("restartRun", () => controller.restartRun());
  register("newProject", () => newProject(exercise, context.extensionUri));
  register("showGazebo", () => VncPanel.show(gazebo, controller, context.extensionUri));
  register("showConsole", () => VncPanel.show(console_, controller, context.extensionUri));
  register("showWebGui", () => WebGuiPanel.show(controller, context.extensionUri));
  register("toggleWebGui", () => controller.toggleDisplay());
  register("resetBestLap", () => controller.resetBestLap());
  register("showControls", () => vscode.commands.executeCommand("workbench.view.extension.roboticsAcademy"));
  register("showLog", () => log.show());
  register("openLayout", async () => {
    // Code on the left, Gazebo top-right, Web GUI (+ Console tab) bottom-right.
    await vscode.commands.executeCommand("vscode.setEditorLayout", {
      orientation: 0,
      groups: [{ size: 0.5 }, { size: 0.5, groups: [{ size: 0.55 }, { size: 0.45 }] }],
    });
    const folder = vscode.workspace.workspaceFolders?.[0];
    const ep = exercise.manifest.entrypoint;
    // No folder open: show the sample project's code (Run uses the file's directory then).
    const projectUri = folder?.uri ?? vscode.Uri.joinPath(context.extensionUri, "sample-workspace", exercise.manifest.id);
    let failure: string | undefined;
    try {
      await vscode.window.showTextDocument(vscode.Uri.joinPath(projectUri, ep), { viewColumn: vscode.ViewColumn.One, preview: false });
    } catch (err) {
      failure = (err as Error).message;
    }
    VncPanel.show(gazebo, controller, context.extensionUri, vscode.ViewColumn.Two);
    VncPanel.show(console_, controller, context.extensionUri, vscode.ViewColumn.Three);
    WebGuiPanel.show(controller, context.extensionUri, vscode.ViewColumn.Three);
    if (failure !== undefined) {
      const why = `${ep} not found in ${folder ? folder.name : projectUri.fsPath}`;
      log.warn(`[openLayout] Can't open ${ep}: ${why} (${failure})`);
      const choice = await vscode.window.showWarningMessage(
        `Can't open ${ep}: ${why}. Open your exercise folder (e.g. sample-workspace/follow_line) or create one with New Follow Line Project.`,
        "Open Folder…",
        "New Project",
      );
      if (choice === "Open Folder…") {
        await vscode.commands.executeCommand("workbench.action.files.openFolder");
      } else if (choice === "New Project") {
        await newProject(exercise, context.extensionUri);
      }
    }
  });

  log.info(`Robotics Academy prototype active. Exercise: ${exercise.title}.`);
  return { controller, readyWebviews };
}

function reportError(log: Log, command: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const prefix = err instanceof RamError && err.kind === "error" ? "Robotics Backend error: " : "";
  log.error(`[${command}] ${prefix}${message}${err instanceof Error && err.stack && !(err instanceof RamError) ? `\n${err.stack}` : ""}`);
  void vscode.window.showErrorMessage(`${prefix}${message}`, "Show Log").then((choice) => {
    if (choice === "Show Log") {
      log.show();
    }
  });
}

export function deactivate(): void {}
