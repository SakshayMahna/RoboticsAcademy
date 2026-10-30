import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

export interface PageOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  /** Bundle name under dist/webview/ (vnc, webgui, control). */
  script: string;
  title: string;
  body: string;
  /** Extra CSP frame-src sources (for noVNC iframes). */
  frameSrc?: string[];
  /** Data passed to the page as window.__INIT__. */
  init?: unknown;
}

/** Common webview page: strict CSP, nonce'd bundle, shared base styles. */
export function page(o: PageOptions): string {
  const nonce = randomBytes(16).toString("base64");
  const src = o.webview.asWebviewUri(vscode.Uri.joinPath(o.extensionUri, "dist", "webview", `${o.script}.js`));
  const css = o.webview.asWebviewUri(vscode.Uri.joinPath(o.extensionUri, "webview", "base.css"));
  const csp = [
    "default-src 'none'",
    `img-src ${o.webview.cspSource} data:`,
    `style-src ${o.webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    o.frameSrc?.length ? `frame-src ${o.frameSrc.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  const init = JSON.stringify(o.init ?? {}).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>${o.title}</title>
</head>
<body>
${o.body}
<script nonce="${nonce}">window.__INIT__ = ${init};</script>
<script nonce="${nonce}" src="${src}"></script>
</body>
</html>`;
}

/** viewTypes whose webview script ran to completion (it posts "ready" last). Used by the integration test. */
export const readyWebviews = new Set<string>();
