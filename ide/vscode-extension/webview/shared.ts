interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();

export function init<T>(): T {
  return (window as unknown as { __INIT__: T }).__INIT__;
}

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function onMessage<T extends { type: string }>(fn: (msg: T) => void): void {
  window.addEventListener("message", (e: MessageEvent<T>) => fn(e.data));
}
