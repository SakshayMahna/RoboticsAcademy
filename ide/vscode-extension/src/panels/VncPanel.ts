import * as vscode from "vscode";
import type { Controller } from "../Controller";
import { TOOLS_UP_STATES } from "../ram/types";
import { page, readyWebviews } from "../ui/html";

// Same query as jderobot-ide-interface's VncViewer.
const NOVNC_PATH = "vnc.html?resize=remote&autoconnect=true&reconnect=true";

export interface VncPanelSpec {
  viewType: string;
  title: string;
  port: number;
}

/** A noVNC iframe in an editor tab. One instance per viewType; reshown if already open. */
export class VncPanel implements vscode.Disposable {
  private static readonly open = new Map<string, VncPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly subs: vscode.Disposable[] = [];
  private url?: string;

  static show(
    spec: VncPanelSpec,
    controller: Controller,
    extensionUri: vscode.Uri,
    column: vscode.ViewColumn = vscode.ViewColumn.Beside,
  ): VncPanel {
    const existing = VncPanel.open.get(spec.viewType);
    if (existing) {
      existing.panel.reveal(column);
      return existing;
    }
    const p = new VncPanel(spec, controller, extensionUri, column);
    VncPanel.open.set(spec.viewType, p);
    return p;
  }

  private constructor(
    private readonly spec: VncPanelSpec,
    private readonly controller: Controller,
    extensionUri: vscode.Uri,
    column: vscode.ViewColumn,
  ) {
    const host = vscode.workspace.getConfiguration("roboticsAcademy").get<string>("host", "127.0.0.1");
    this.panel = vscode.window.createWebviewPanel(spec.viewType, spec.title, column, {
      enableScripts: true,
      // Keep the VNC session alive when the tab is hidden or dragged to another group/window.
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist"), vscode.Uri.joinPath(extensionUri, "webview")],
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "robot.svg");
    this.panel.webview.html = page({
      webview: this.panel.webview,
      extensionUri,
      script: "vnc",
      title: spec.title,
      frameSrc: [...new Set([`http://${host}:*`, "http://127.0.0.1:*", "http://localhost:*"])],
      init: { title: spec.title, port: spec.port },
      body: `<div id="placeholder" class="placeholder"><div class="spinner"></div><p id="placeholder-text">Waiting for tools…</p></div>
<iframe id="vnc" class="hidden" title="${spec.title}" allow="clipboard-read; clipboard-write"></iframe>
<button id="reload" class="floating" title="Reload ${spec.title}">↻</button>`,
    });

    this.subs.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((m: { type: string }) => {
        if (m.type === "ready") {
          readyWebviews.add(spec.viewType);
          this.url = undefined;
          void this.sync();
        } else if (m.type === "reload") {
          void this.panel.webview.postMessage({ type: "reload" });
        }
      }),
      controller.onDidChange(() => void this.sync()),
    );
  }

  private async sync(): Promise<void> {
    const up = TOOLS_UP_STATES.includes(this.controller.state);
    let url: string | undefined;
    if (up) {
      const host = vscode.workspace.getConfiguration("roboticsAcademy").get<string>("host", "127.0.0.1");
      const external = await vscode.env.asExternalUri(vscode.Uri.parse(`http://${host}:${this.spec.port}/`));
      url = `${external.toString(true).replace(/\/$/, "")}/${NOVNC_PATH}`;
    }
    const message =
      this.controller.state === "disconnected"
        ? "Not connected. Use Robotics Academy: Connect."
        : this.controller.state === "connected" || this.controller.state === "idle"
          ? "Waiting for tools… (Launch Exercise World)"
          : "Waiting for tools…";
    const key = url ?? message;
    if (key === this.url) {
      return;
    }
    this.url = key;
    void this.panel.webview.postMessage({ type: "state", url, message });
  }

  dispose(): void {
    VncPanel.open.delete(this.spec.viewType);
    this.subs.forEach((s) => s.dispose());
    this.panel.dispose();
  }
}
