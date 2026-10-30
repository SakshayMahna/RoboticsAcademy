#!/usr/bin/env node
// Mock Robotics Application Manager for tests and offline UI work.
//
//   node scripts/mock-ram.mjs [--port=7164] [--delay=800] [--quiet]
//
// Implements the RAM state machine, the single-client rule, and the web GUI
// start/ack loop (updates are only sent while the client keeps acking).
// Point the extension at it with the setting  roboticsAcademy.ramUrl = ws://127.0.0.1:7164
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import JSZip from "jszip";
import { WebSocketServer } from "ws";

const TRANSITIONS = {
  connect: { from: ["idle"], to: "connected" },
  launch_world: { from: ["connected"], to: "world_ready" },
  prepare_tools: { from: ["world_ready"], to: "tools_ready" },
  run_application: { from: ["tools_ready", "paused", "application_running"], to: "application_running" },
  pause: { from: ["application_running"], to: "paused" },
  resume: { from: ["paused"], to: "application_running" },
  terminate_application: { from: ["tools_ready", "application_running", "paused"], to: "tools_ready" },
  terminate_tools: { from: ["tools_ready"], to: "world_ready" },
  terminate_world: { from: ["world_ready"], to: "connected" },
  disconnect: { from: "*", to: "idle" },
};

// Commands that take a while on the real backend.
const SLOW = new Set(["launch_world", "prepare_tools", "run_application"]);

export async function startMockRam({ port = 7164, delay = 800, updateHz = 10, log = console.log } = {}) {
  const wss = new WebSocketServer({ port, host: "127.0.0.1" });
  await new Promise((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });
  const actualPort = wss.address().port;
  log(`[mock-ram] listening on ws://127.0.0.1:${actualPort} (delay ${delay} ms)`);
  log("Listening on port 7163 for clients..  (mock)");

  let client = null;
  const received = [];

  wss.on("connection", (ws) => {
    if (client) {
      log("[mock-ram] rejecting extra client (single-client rule)");
      ws.close(1000, "");
      return;
    }
    client = ws;
    log("[mock-ram] client connected");
    const session = new Session(ws, { delay, updateHz, log, received });
    ws.on("message", (raw) => session.onMessage(raw.toString()));
    ws.on("close", () => {
      log("[mock-ram] client disconnected");
      session.dispose();
      client = null;
    });
  });

  return {
    port: actualPort,
    url: `ws://127.0.0.1:${actualPort}`,
    received,
    close: () =>
      new Promise((resolve) => {
        for (const ws of wss.clients) {
          ws.terminate();
        }
        wss.close(() => resolve());
      }),
  };
}

class Session {
  constructor(ws, { delay, updateHz, log, received }) {
    this.ws = ws;
    this.delay = delay;
    this.log = log;
    this.received = received;
    this.state = "idle";
    this.guiStarted = false; // got gui:"start" from the frontend
    this.guiAcked = true; // last update was acked
    this.runStart = 0;
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.lastFreq = 0;
    this.frame = 0;
    this.timer = setInterval(() => this.tick(), 1000 / updateHz);
  }

  dispose() {
    clearInterval(this.timer);
  }

  send(msg) {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  setState(state) {
    this.state = state;
    this.send({ id: randomUUID(), command: "state-changed", data: { state } });
  }

  async onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.log(`[mock-ram] bad frame: ${raw.slice(0, 80)}`);
      return;
    }
    this.received.push(msg);
    const shown = JSON.stringify(msg, (k, v) => (k === "code" && typeof v === "string" ? `${v.slice(0, 60)}…` : v));
    if (msg.command !== "gui") {
      this.log(`[mock-ram] <- ${shown}`);
    }

    if (msg.command === "gui") {
      if (msg.data === "start") {
        this.guiStarted = true;
      } else if (msg.data === "ack") {
        this.guiAcked = true;
      }
      return; // RAM never acks gui messages
    }

    const t = TRANSITIONS[msg.command];
    if (!t) {
      return this.error(msg, `Unknown command ${msg.command}`);
    }
    if (t.from !== "*" && !t.from.includes(this.state)) {
      return this.error(msg, `Can't trigger event ${msg.command} from state ${this.state}!`);
    }

    try {
      if (SLOW.has(msg.command)) {
        await new Promise((r) => setTimeout(r, this.delay));
      }
      await this.apply(msg);
    } catch (err) {
      return this.error(msg, String(err.message ?? err));
    }

    if (msg.command === "connect") {
      this.send({
        id: randomUUID(),
        command: "introspection",
        data: { robotics_backend_version: "mock\n", ros_version: "humble\n", gpu_avaliable: "OFF" },
      });
    }
    this.setState(t.to);
    this.send({ id: msg.id, command: "ack", data: null });
  }

  async apply(msg) {
    const d = msg.data;
    switch (msg.command) {
      case "launch_world": {
        const need = (o, keys, what) => {
          for (const k of keys) {
            if (o?.[k] === undefined) {
              throw new Error(`Invalid configuration: ${what} missing '${k}'`);
            }
          }
        };
        need(d?.scene, ["type", "launch_file_path"], "scene");
        if (!Array.isArray(d?.robot)) {
          throw new Error("Invalid configuration: robot must be a list");
        }
        d.robot.forEach((r, i) => need(r, ["type", "launch_file_path", "entity", "start_pose", "extra_config"], `robot[${i}]`));
        break;
      }
      case "prepare_tools":
        if (!Array.isArray(d?.tools)) {
          throw new Error("tools must be a list");
        }
        break;
      case "run_application": {
        if (!Array.isArray(d?.entrypoint) || !Array.isArray(d?.linter) || typeof d?.code !== "string") {
          throw new Error("run_application needs entrypoint[], linter[], code");
        }
        if (!d.code.startsWith("data:")) {
          throw new Error("code must be a data URL");
        }
        const zip = await JSZip.loadAsync(d.code.split("base64,")[1], { base64: true });
        const files = Object.keys(zip.files).filter((f) => !zip.files[f].dir);
        this.log(`[mock-ram] zip: ${files.join(", ")}`);
        for (const ep of d.entrypoint) {
          const rel = ep.replace(/^\/workspace\/code\//, "");
          if (!zip.file(rel)) {
            throw new Error("User code not found");
          }
        }
        // New program instance: its GUI server waits for a fresh "start".
        this.guiStarted = false;
        this.guiAcked = true;
        this.runStart = Date.now();
        this.pausedTotal = 0;
        break;
      }
      case "pause":
        this.pausedAt = Date.now();
        break;
      case "resume":
        this.pausedTotal += Date.now() - this.pausedAt;
        break;
      case "terminate_application":
      case "disconnect":
        this.guiStarted = false;
        break;
      default:
        break;
    }
  }

  error(msg, message) {
    this.log(`[mock-ram] -> error: ${message}`);
    this.send({ id: msg.id, command: "error", data: { message } });
  }

  tick() {
    if (this.state !== "application_running" || !this.guiStarted || !this.guiAcked) {
      return;
    }
    const now = Date.now();
    const elapsed = (now - this.runStart - this.pausedTotal) / 1000;
    if (now - this.lastFreq > 2000) {
      this.lastFreq = now;
      this.send({ command: "update", data: { update: { brain: 50, gui: 12.5, rtf: 0.62, fps: 10, lat: 0 } } });
    }
    const theta = (elapsed / 20) * 2 * Math.PI; // one fake lap every 20 s
    const x = 53.462 * Math.cos(theta);
    const y = -10.734 + 45 * Math.sin(theta);
    this.frame++;
    this.guiAcked = false;
    this.send({
      command: "update",
      data: {
        update: {
          image: JSON.stringify({ image: testImage(this.frame).toString("base64"), shape: [120, 160, 3] }),
          lap: timedelta(elapsed),
          map: `(${x}, ${y})`,
        },
      },
    });
  }
}

/** Python str(datetime.timedelta) format, e.g. "0:00:05.123456". */
function timedelta(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const us = Math.floor((seconds % 1) * 1e6);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(us).padStart(6, "0")}`;
}

// --- tiny PNG encoder: a 160x120 frame with a moving yellow line on grey ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function testImage(frame, w = 160, h = 120) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const lineX = Math.round(w / 2 + Math.sin(frame / 8) * (w / 4));
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 3;
      const onLine = y > h / 2 && Math.abs(x - lineX) < 3;
      raw[o] = onLine ? 230 : y < h / 2 ? 120 : 70;
      raw[o + 1] = onLine ? 200 : y < h / 2 ? 160 : 70;
      raw[o + 2] = onLine ? 30 : y < h / 2 ? 210 : 70;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, def) => {
    const a = process.argv.find((x) => x.startsWith(`--${name}=`));
    return a ? Number(a.split("=")[1]) : def;
  };
  const quiet = process.argv.includes("--quiet");
  await startMockRam({ port: arg("port", 7164), delay: arg("delay", 800), log: quiet ? () => {} : console.log });
}
