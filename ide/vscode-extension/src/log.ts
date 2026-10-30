import * as vscode from "vscode";
import type { RamMessage } from "./ram/types";

const LONG_KEYS = new Set(["code", "image"]);
const MAX = 80;

/** JSON with large payloads (zip, base64 images) cut to ~80 chars. */
export function truncateForLog(msg: unknown): string {
  return JSON.stringify(msg, (key, value) => {
    if (typeof value === "string" && value.length > MAX && LONG_KEYS.has(key)) {
      return `${value.slice(0, MAX)}…(${value.length} chars)`;
    }
    return value;
  });
}

export class Log implements vscode.Disposable {
  readonly channel = vscode.window.createOutputChannel("Robotics Academy", { log: true });

  info(text: string): void {
    this.channel.info(text);
  }

  warn(text: string): void {
    this.channel.warn(text);
  }

  error(text: string): void {
    this.channel.error(text);
  }

  frame(direction: "in" | "out", msg: RamMessage): void {
    this.channel.info(`${direction === "out" ? "→" : "←"} ${truncateForLog(msg)}`);
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
