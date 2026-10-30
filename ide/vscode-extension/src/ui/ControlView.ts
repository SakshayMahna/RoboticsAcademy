import * as vscode from "vscode";
import type { Controller } from "../Controller";
import { CIRCUIT_MAP_SIZE } from "../exercise/followLine";
import { page, readyWebviews } from "./html";

export const CONTROL_VIEW_ID = "roboticsAcademy.control";

/** Commands the control view may trigger. Anything else posted by the webview is ignored. */
const ALLOWED = new Set([
  "connect",
  "disconnect",
  "reconnect",
  "launchWorld",
  "stopWorld",
  "run",
  "pause",
  "resume",
  "stopApp",
  "restartRun",
  "showGazebo",
  "showConsole",
  "showWebGui",
  "toggleWebGui",
  "openLayout",
  "resetBestLap",
  "newProject",
  "showLog",
]);

/** Sidebar: connection, exercise, app controls, panels and the Follow Line lap card. */
export class ControlView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly subs: vscode.Disposable[] = [];
  private lastCarPost = 0;

  constructor(
    private readonly controller: Controller,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.subs.push(
      controller.onDidChange(() => this.post()),
      controller.onFrame((f) => {
        // Mini-map at ~5 Hz is plenty for a sidebar.
        const now = Date.now();
        if (this.view?.visible && f.carPx && now - this.lastCarPost > 200) {
          this.lastCarPost = now;
          void this.view.webview.postMessage({ type: "car", car: f.carPx });
        }
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, "exercises", this.controller.exercise.manifest.id, "media");
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist"), vscode.Uri.joinPath(this.extensionUri, "webview"), media],
    };
    view.webview.html = page({
      webview: view.webview,
      extensionUri: this.extensionUri,
      script: "control",
      title: "Robotics Academy",
      init: {
        circuit: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "default_circuit.png")).toString(),
        mapSize: CIRCUIT_MAP_SIZE,
      },
      body: `<div id="app"></div>`,
    });
    view.webview.onDidReceiveMessage((m: { type: string; command?: string }) => {
      if (m.type === "ready") {
        readyWebviews.add(CONTROL_VIEW_ID);
        this.post();
      } else if (m.type === "command" && m.command && ALLOWED.has(m.command)) {
        void vscode.commands.executeCommand(`roboticsAcademy.${m.command}`);
      }
    });
    view.onDidChangeVisibility(() => view.visible && this.post());
  }

  private post(): void {
    if (!this.view) {
      return;
    }
    const c = this.controller;
    void this.view.webview.postMessage({
      type: "state",
      state: c.state,
      busy: c.busy,
      version: c.version,
      ros: c.client.introspection?.ros_version?.trim(),
      exercise: { title: c.exercise.title, world: c.exercise.worldName },
      lap: c.lap,
      display: c.displayEnabled,
      hasProject: Boolean(vscode.workspace.workspaceFolders?.length),
    });
  }

  dispose(): void {
    this.subs.forEach((s) => s.dispose());
  }
}
