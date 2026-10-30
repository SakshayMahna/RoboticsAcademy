import * as vscode from "vscode";
import type { Controller, Frame } from "../Controller";
import { formatLap } from "../exercise/followLine";
import { page, readyWebviews } from "../ui/html";

export const WEBGUI_VIEW_TYPE = "roboticsAcademy.webgui";

/**
 * Follow Line web GUI: camera image, lap time and car position on the circuit map.
 * Only renders; the start/ack handshake lives in the extension host (WebGuiBridge), so
 * closing this panel or switching the display off never stalls the robot program.
 */
export class WebGuiPanel implements vscode.Disposable {
  private static current?: WebGuiPanel;

  private readonly panel: vscode.WebviewPanel;
  private readonly subs: vscode.Disposable[] = [];
  private statusTimer: ReturnType<typeof setInterval>;

  static show(controller: Controller, extensionUri: vscode.Uri, column = vscode.ViewColumn.Beside): WebGuiPanel {
    if (WebGuiPanel.current) {
      WebGuiPanel.current.panel.reveal(column);
      return WebGuiPanel.current;
    }
    WebGuiPanel.current = new WebGuiPanel(controller, extensionUri, column);
    return WebGuiPanel.current;
  }

  private constructor(
    private readonly controller: Controller,
    extensionUri: vscode.Uri,
    column: vscode.ViewColumn,
  ) {
    const media = vscode.Uri.joinPath(extensionUri, "exercises", controller.exercise.manifest.id, "media");
    this.panel = vscode.window.createWebviewPanel(WEBGUI_VIEW_TYPE, `${controller.exercise.title} · Web GUI`, column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist"), vscode.Uri.joinPath(extensionUri, "webview"), media],
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "robot.svg");
    const circuit = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "default_circuit.png")).toString();
    this.panel.webview.html = page({
      webview: this.panel.webview,
      extensionUri,
      script: "webgui",
      title: "Web GUI",
      init: { circuit },
      body: `<div id="root" class="webgui">
  <img id="camera" alt="Camera" class="hidden">
  <div id="waiting" class="placeholder"><p>Waiting for the robot program…</p></div>
  <div id="paused" class="placeholder hidden"><p>Paused display</p><small>Updates are still acknowledged, the car is unaffected.</small></div>
  <div id="minimap" class="minimap"><img id="circuit" alt="Circuit"><div id="car" class="car hidden"></div></div>
  <div id="lap" class="lap hidden"></div>
  <div id="stats" class="stats"></div>
</div>`,
    });

    this.subs.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((m: { type: string }) => {
        if (m.type === "ready") {
          readyWebviews.add(WEBGUI_VIEW_TYPE);
          this.postStatus();
          if (controller.lastFrame) {
            this.postFrame(controller.lastFrame);
          }
        } else if (m.type === "toggle") {
          controller.toggleDisplay();
        }
      }),
      controller.onFrame((f) => this.postFrame(f)),
      controller.onDidChange(() => this.postStatus()),
    );
    this.statusTimer = setInterval(() => this.postStatus(), 1000);
  }

  private postFrame(f: Frame): void {
    if (!this.controller.displayEnabled || !this.panel.visible) {
      return;
    }
    void this.panel.webview.postMessage({
      type: "frame",
      image: f.image,
      lap: f.lapSeconds !== undefined ? formatLap(f.lapSeconds) : undefined,
      car: f.carPx,
    });
  }

  private postStatus(): void {
    const c = this.controller;
    void this.panel.webview.postMessage({
      type: "status",
      state: c.state,
      display: c.displayEnabled,
      rate: c.bridge.rate,
      freq: c.freq,
      hasFrame: Boolean(c.lastFrame?.image),
    });
  }

  dispose(): void {
    WebGuiPanel.current = undefined;
    clearInterval(this.statusTimer);
    this.subs.forEach((s) => s.dispose());
    this.panel.dispose();
  }
}
