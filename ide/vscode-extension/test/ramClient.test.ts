import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { MockRam } from "../scripts/mock-ram.mjs";
import { RamClient, RamError, SINGLE_SLOT_MESSAGE } from "../src/ram/RamClient";
import type { ClientState } from "../src/ram/types";
import { mock, waitForState, WORLD } from "./helpers";

let server: MockRam | undefined;
const clients: RamClient[] = [];

function client(opts?: ConstructorParameters<typeof RamClient>[0]): RamClient {
  const c = new RamClient(opts);
  clients.push(c);
  return c;
}

afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await server?.close();
  server = undefined;
});

describe("RamClient", () => {
  it("connects, records introspection and tracks state from state-changed", async () => {
    server = await mock();
    const c = client();
    const states: ClientState[] = [];
    c.on("stateChanged", (s) => states.push(s));

    await c.connect(server.url);

    expect(c.state).toBe("connected");
    expect(c.introspection?.robotics_backend_version).toBe("mock\n");
    expect(states).toEqual(["idle", "connected"]);
    expect(server.received[0]).toMatchObject({ command: "connect", data: null });
    expect(typeof server.received[0].id).toBe("string");
  });

  it("resolves acks by id across the full lifecycle", async () => {
    server = await mock();
    const c = client();
    await c.connect(server.url);
    await c.request("launch_world", WORLD);
    expect(c.state).toBe("world_ready");
    await c.request("prepare_tools", { tools: ["console", "simulator", "web_gui"], config: {} });
    expect(c.state).toBe("tools_ready");
    await c.request("terminate_tools");
    await c.request("terminate_world");
    expect(c.state).toBe("connected");
    await c.disconnect();
    expect(c.state).toBe("disconnected");
  });

  it("rejects on an error reply with the RAM message", async () => {
    server = await mock();
    const c = client();
    await c.connect(server.url);
    const err = await c.request("pause").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RamError);
    expect((err as RamError).kind).toBe("error");
    expect((err as RamError).message).toMatch(/Can't trigger event pause from state connected/);
    expect(c.state).toBe("connected");
  });

  it("times out per command", async () => {
    server = await mock(500);
    const c = client({ timeouts: { launch_world: 50 } });
    await c.connect(server.url);
    const err = (await c.request("launch_world", WORLD).catch((e: unknown) => e)) as RamError;
    expect(err.kind).toBe("timeout");
    expect(err.command).toBe("launch_world");
  });

  it("rejects pending requests and goes disconnected when the socket closes", async () => {
    server = await mock(2000);
    const c = client();
    await c.connect(server.url);
    let closed = "";
    c.on("connectionClosed", (r) => (closed = r));
    const pending = c.request("launch_world", WORLD).catch((e: unknown) => e);
    await server.close();
    const err = (await pending) as RamError;
    expect(err.kind).toBe("closed");
    expect(c.state).toBe("disconnected");
    expect(closed).not.toBe("");
    server = undefined;
  });

  it("explains the single-client limit when the slot is taken (server closes the socket)", async () => {
    server = await mock();
    await client().connect(server.url);
    const second = client();
    const err = (await second.connect(server.url).catch((e: unknown) => e)) as RamError;
    expect(err.kind).toBe("busy");
    expect(err.message).toBe(SINGLE_SLOT_MESSAGE);
    expect(second.state).toBe("disconnected");
  });

  it("explains the single-client limit when the socket opens but nothing answers", async () => {
    const silent = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((r) => silent.once("listening", r));
    const port = (silent.address() as { port: number }).port;
    try {
      const c = client({ timeouts: { connect: 200 } });
      const err = (await c.connect(`ws://127.0.0.1:${port}`).catch((e: unknown) => e)) as RamError;
      expect(err.kind).toBe("busy");
      expect(err.message).toBe(SINGLE_SLOT_MESSAGE);
      expect(c.state).toBe("disconnected");
    } finally {
      silent.clients.forEach((s) => s.terminate());
      await new Promise((r) => silent.close(r));
    }
  });

  it("reports an unreachable backend clearly", async () => {
    const c = client();
    const err = (await c.connect("ws://127.0.0.1:1").catch((e: unknown) => e)) as RamError;
    expect(err.kind).toBe("unreachable");
    expect(err.message).toMatch(/ra-proto/);
  });

  it("can connect again after the slot is freed", async () => {
    server = await mock();
    const a = client();
    await a.connect(server.url);
    await a.disconnect();
    const b = client();
    await b.connect(server.url);
    await waitForState(b, "connected");
  });
});
