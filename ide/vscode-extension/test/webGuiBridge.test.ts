import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockRam } from "../scripts/mock-ram.mjs";
import { WebGuiBridge, type GuiTransport } from "../src/exercise/WebGuiBridge";
import { RamClient } from "../src/ram/RamClient";
import type { ClientState, GuiUpdate } from "../src/ram/types";
import { mock, sleep, WORLD } from "./helpers";

/** Hand-driven transport for timer-level tests. */
class FakeTransport implements GuiTransport {
  state: ClientState = "connected";
  sent: string[] = [];
  private stateFns = new Set<(s: ClientState) => void>();
  private updateFns = new Set<(u: GuiUpdate) => void>();

  on(event: "stateChanged", fn: (state: ClientState) => void): () => void;
  on(event: "update", fn: (update: GuiUpdate) => void): () => void;
  on(event: "stateChanged" | "update", fn: any): () => void {
    const set = event === "stateChanged" ? this.stateFns : this.updateFns;
    set.add(fn);
    return () => set.delete(fn);
  }
  sendGui(payload: string): void {
    this.sent.push(payload);
  }
  setState(s: ClientState): void {
    this.state = s;
    this.stateFns.forEach((f) => f(s));
  }
  update(u: GuiUpdate = { lap: "0" }): void {
    this.updateFns.forEach((f) => f(u));
  }
}

describe("WebGuiBridge handshake (timers)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends start every second until the first update, then stops", () => {
    const t = new FakeTransport();
    const b = new WebGuiBridge(t);
    expect(t.sent).toEqual([]);

    t.setState("tools_ready");
    vi.advanceTimersByTime(3000);
    expect(t.sent.filter((s) => s === "start").length).toBe(4); // immediate + 3 ticks
    expect(b.handshaking).toBe(true);

    t.update();
    expect(b.handshaking).toBe(false);
    const before = t.sent.length;
    vi.advanceTimersByTime(5000);
    expect(t.sent.length).toBe(before);
    b.dispose();
  });

  it("acks every update, even with no listeners (display off / panel closed)", () => {
    const t = new FakeTransport();
    const b = new WebGuiBridge(t);
    t.setState("application_running");
    t.sent = [];
    for (let i = 0; i < 5; i++) {
      t.update();
    }
    expect(t.sent).toEqual(["ack", "ack", "ack", "ack", "ack"]);

    const off = b.onUpdateReceived(() => {
      throw new Error("bad listener");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    t.update();
    expect(t.sent.at(-1)).toBe("ack");
    off();
    b.dispose();
  });

  it("stops the start timer when the state drops below tools_ready", () => {
    const t = new FakeTransport();
    const b = new WebGuiBridge(t);
    t.setState("tools_ready");
    t.setState("world_ready");
    t.sent = [];
    vi.advanceTimersByTime(5000);
    expect(t.sent).toEqual([]);
    expect(b.handshaking).toBe(false);
    b.dispose();
  });

  it("restarts the handshake for a new run", () => {
    const t = new FakeTransport();
    const b = new WebGuiBridge(t);
    t.setState("application_running");
    t.update();
    expect(b.handshaking).toBe(false);
    t.setState("tools_ready"); // stop app
    expect(b.handshaking).toBe(true);
    b.dispose();
  });
});

describe("WebGuiBridge against mock RAM", () => {
  let server: MockRam | undefined;
  let client: RamClient | undefined;
  afterEach(async () => {
    client?.close();
    await server?.close();
  });

  it("keeps updates flowing via acks with nobody rendering", async () => {
    server = await mock();
    client = new RamClient();
    const bridge = new WebGuiBridge(client);
    let updates = 0;
    client.on("update", () => updates++);

    await client.connect(server.url);
    await client.request("launch_world", WORLD);
    await client.request("prepare_tools", { tools: ["web_gui"], config: {} });
    const zip = "data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=="; // empty zip
    // An empty zip has no entrypoint, so the mock refuses it; check the error path, then run a real one.
    await expect(client.request("run_application", { entrypoint: ["/workspace/code/main.py"], linter: [], code: zip })).rejects.toThrow(
      /User code not found/,
    );

    const JSZip = (await import("jszip")).default;
    const z = new JSZip();
    z.file("main.py", "print('hi')");
    const code = "data:application/zip;base64," + (await z.generateAsync({ type: "base64" }));
    await client.request("run_application", { entrypoint: ["/workspace/code/main.py"], linter: [], code });

    await sleep(1500);
    expect(updates).toBeGreaterThan(5); // ~10 Hz, only possible if acks are flowing
    expect(bridge.handshaking).toBe(false);
    const acks = server.received.filter((m) => m.command === "gui" && m.data === "ack").length;
    expect(acks).toBeGreaterThanOrEqual(updates - 1);
    bridge.dispose();
  });
});
