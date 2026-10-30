// Runs inside an isolated VS Code (see scripts/integration.mjs) against the mock RAM and
// drives the extension through its real commands.
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { startMockRam } from "../../scripts/mock-ram.mjs";
import type { ExtensionApi } from "../../src/extension";
import { RamClient, RamError, SINGLE_SLOT_MESSAGE } from "../../src/ram/RamClient";
import type { ClientState } from "../../src/ram/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, cond: () => boolean, timeout = 5000): Promise<void> {
  const end = Date.now() + timeout;
  while (!cond()) {
    if (Date.now() > end) {
      throw new Error(`timed out waiting for: ${what}`);
    }
    await sleep(50);
  }
}

const exec = (cmd: string, ...args: unknown[]) => vscode.commands.executeCommand(`roboticsAcademy.${cmd}`, ...args);

function webviewTabs(): string[] {
  return vscode.window.tabGroups.all.flatMap((g) =>
    g.tabs.filter((t) => t.input instanceof vscode.TabInputWebview).map((t) => (t.input as vscode.TabInputWebview).viewType),
  );
}

export async function run(): Promise<void> {
  const log = (s: string) => console.log(`[it] ${s}`);
  const ram = await startMockRam({ port: 0, delay: 100, log: () => {} });
  try {
    await vscode.workspace.getConfiguration("roboticsAcademy").update("ramUrl", ram.url, vscode.ConfigurationTarget.Global);

    const ext = vscode.extensions.getExtension<ExtensionApi>("jderobot.robotics-academy-proto");
    assert.ok(ext, "extension present");
    const api = await ext.activate();
    const c = api.controller;
    const is = (s: ClientState) => () => c.state === s;

    // F1: connect + version
    await exec("connect");
    assert.equal(c.state, "connected");
    assert.equal(c.version, "mock");
    log("connect ok, version " + c.version);

    // single slot: a second client is told why it can't connect
    const intruder = new RamClient();
    const err = (await intruder.connect(ram.url).catch((e: unknown) => e)) as RamError;
    assert.equal(err.kind, "busy");
    assert.equal(err.message, SINGLE_SLOT_MESSAGE);
    log("single-slot message ok");

    // F2: launch → tools_ready
    await exec("launchWorld");
    assert.equal(c.state, "tools_ready");
    log("launch ok");

    // F5/F6 panels
    await exec("showGazebo");
    await exec("showConsole");
    await exec("showWebGui");
    await until("3 panels", () => webviewTabs().length >= 3);
    const tabs = webviewTabs().join(",");
    for (const vt of ["roboticsAcademy.gazebo", "roboticsAcademy.console", "roboticsAcademy.webgui"]) {
      assert.ok(tabs.includes(vt), `${vt} open (have ${tabs})`);
    }
    await until("panel scripts ran", () =>
      ["roboticsAcademy.gazebo", "roboticsAcademy.console", "roboticsAcademy.webgui"].every((v) => api.readyWebviews.has(v)),
    );
    await exec("showControls");
    await until("control view script ran", () => api.readyWebviews.has("roboticsAcademy.control"));
    log("panels ok: " + tabs);

    // F3: run main.py from the editor
    const folder = vscode.workspace.workspaceFolders![0].uri;
    const main = vscode.Uri.joinPath(folder, "main.py");
    const doc = await vscode.window.showTextDocument(main, { viewColumn: vscode.ViewColumn.One });
    await doc.edit((e) => e.insert(new vscode.Position(0, 0), "# edited\n")); // dirty: must be auto-saved
    await exec("run", main);
    assert.equal(c.state, "application_running");
    assert.equal(doc.document.isDirty, false, "dirty file saved before run");
    const runMsg = ram.received.filter((m) => m.command === "run_application").at(-1)!;
    const data = runMsg.data as { entrypoint: string[]; linter: string[]; code: string };
    assert.deepEqual(data.entrypoint, ["/workspace/code/main.py"]);
    assert.deepEqual(data.linter, []);
    assert.ok(data.code.startsWith("data:application/zip;base64,"));
    log("run ok");

    // F6: frames flow, acks keep flowing with display off and with the panel closed
    await until("first frame", () => Boolean(c.lastFrame?.image));
    assert.ok(c.lastFrame!.carPx, "car position");
    await sleep(1500);
    assert.ok(c.bridge.rate > 5, `update rate ${c.bridge.rate}`);
    await exec("toggleWebGui");
    assert.equal(c.displayEnabled, false);
    const before = ram.received.filter((m) => m.data === "ack").length;
    await sleep(1200);
    const acked = ram.received.filter((m) => m.data === "ack").length - before;
    assert.ok(acked > 6, `acks continue with display off (${acked})`);
    await exec("toggleWebGui");
    for (const g of vscode.window.tabGroups.all) {
      for (const t of g.tabs) {
        if (t.input instanceof vscode.TabInputWebview && t.input.viewType.includes("webgui")) {
          await vscode.window.tabGroups.close(t);
        }
      }
    }
    const before2 = ram.received.filter((m) => m.data === "ack").length;
    await sleep(1200);
    assert.ok(ram.received.filter((m) => m.data === "ack").length - before2 > 6, "acks continue with panel closed");
    log(`web gui ok (rate ${c.bridge.rate.toFixed(1)}/s)`);

    // F3: pause / resume / stop; F7 restart
    await exec("pause");
    assert.equal(c.state, "paused");
    await exec("resume");
    assert.equal(c.state, "application_running");
    await exec("restartRun");
    assert.equal(c.state, "application_running");
    assert.equal(ram.received.filter((m) => m.command === "run_application").length, 2);
    await exec("stopApp");
    assert.equal(c.state, "tools_ready");
    await exec("restartRun"); // from tools_ready
    assert.equal(c.state, "application_running");
    await exec("pause");
    await exec("restartRun"); // from paused
    assert.equal(c.state, "application_running");
    log("pause/resume/stop/restart ok");

    // F7: lap tracking (mock does a lap every 20 s; just check the timer runs)
    await until("lap timer", () => (c.lap.current ?? 0) > 0.5, 4000);
    log(`lap current ${c.lap.current?.toFixed(2)}`);

    // F8 layout
    await exec("openLayout");
    await until("3 editor groups", () => vscode.window.tabGroups.all.length === 3);
    log("layout ok");

    // An error reply must not throw out of the command
    await exec("resume"); // invalid from running → error notification, state unchanged
    assert.equal(c.state, "application_running");

    // F2 teardown
    await exec("stopWorld");
    assert.equal(c.state, "connected");
    await exec("disconnect");
    assert.equal(c.state, "disconnected");
    log("teardown ok");

    // Reconnect
    await exec("reconnect");
    await until("reconnected", is("connected"));
    await exec("disconnect");

    // Extension reports busy when someone else holds the slot
    const holder = new RamClient();
    await holder.connect(ram.url);
    await exec("connect");
    assert.equal(c.state, "disconnected");
    await holder.disconnect();
    log("busy backend handled");
    log("ALL PASSED");
  } finally {
    await vscode.workspace.getConfiguration("roboticsAcademy").update("ramUrl", undefined, vscode.ConfigurationTarget.Global);
    await ram.close();
  }
}
