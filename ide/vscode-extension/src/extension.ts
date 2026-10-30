import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("roboticsAcademy.hello", () => {
      void vscode.window.showInformationMessage("Hello from Robotics Academy (prototype)!");
    }),
  );
}

export function deactivate(): void {}
