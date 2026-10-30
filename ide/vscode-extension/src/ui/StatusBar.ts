import * as vscode from "vscode";
import type { Controller } from "../Controller";
import type { ClientState } from "../ram/types";

const LABELS: Record<ClientState, string> = {
  disconnected: "$(debug-disconnect) RA: Disconnected",
  idle: "$(plug) RA: Idle",
  connected: "$(plug) RA: Connected",
  world_ready: "$(globe) RA: World ready",
  tools_ready: "$(tools) RA: Tools ready",
  application_running: "$(play) RA: Running",
  paused: "$(debug-pause) RA: Paused",
};

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem("roboticsAcademy.state", vscode.StatusBarAlignment.Left, 100);
  private readonly sub: vscode.Disposable;

  constructor(private readonly controller: Controller) {
    this.item.name = "Robotics Academy";
    this.item.command = "roboticsAcademy.showControls";
    this.sub = controller.onDidChange(() => this.render());
    this.render();
    this.item.show();
  }

  private render(): void {
    const c = this.controller;
    this.item.text = c.busy ? `$(loading~spin) RA: ${c.busy}` : LABELS[c.state];
    const version = c.version ? `\nRobotics Backend ${c.version}` : "";
    this.item.tooltip = `Robotics Academy: ${c.state}${version}\nClick to open the exercise controls`;
  }

  dispose(): void {
    this.sub.dispose();
    this.item.dispose();
  }
}
