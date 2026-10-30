import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  COMMAND_TIMEOUTS,
  DEFAULT_TIMEOUT,
  type ClientState,
  type GuiUpdate,
  type Introspection,
  type RamCommand,
  type RamMessage,
  type RamState,
} from "./types";

export const SINGLE_SLOT_MESSAGE =
  "The Robotics Backend didn't respond. It accepts only one client. " +
  "Close any Unibotics/Robotics Academy browser tab and try again.";

export type RamErrorKind = "error" | "timeout" | "closed" | "unreachable" | "busy";

export class RamError extends Error {
  constructor(
    message: string,
    readonly kind: RamErrorKind,
    readonly command?: string,
  ) {
    super(message);
    this.name = "RamError";
  }
}

export interface RamClientEvents {
  stateChanged: (state: ClientState, previous: ClientState) => void;
  introspection: (info: Introspection) => void;
  update: (update: GuiUpdate) => void;
  connectionClosed: (reason: string) => void;
  error: (error: Error) => void;
  /** Every frame in/out, for logging. */
  message: (direction: "in" | "out", message: RamMessage) => void;
}

interface Pending {
  command: string;
  resolve: (msg: RamMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface RamClientOptions {
  timeouts?: Partial<Record<RamCommand, number>>;
  defaultTimeout?: number;
}

/** Minimal typed event emitter (no dependency on node's untyped EventEmitter). */
class Emitter<E extends { [K in keyof E]: (...args: any[]) => void }> {
  private listeners: { [K in keyof E]?: Set<E[K]> } = {};

  on<K extends keyof E>(event: K, fn: E[K]): () => void {
    (this.listeners[event] ??= new Set()).add(fn);
    return () => this.listeners[event]?.delete(fn);
  }

  protected emit<K extends keyof E>(event: K, ...args: Parameters<E[K]>): void {
    for (const fn of this.listeners[event] ?? []) {
      try {
        fn(...args);
      } catch (err) {
        // A misbehaving listener must never break the protocol loop.
        console.error(`RamClient listener for ${String(event)} threw`, err);
      }
    }
  }
}

/**
 * Client for the Robotics Application Manager websocket.
 *
 * - Requests are correlated by id: `ack` resolves, `error` rejects.
 * - State is tracked from unsolicited `state-changed` events, not from acks.
 * - Never reconnects on its own: RAM accepts a single client, and a reconnect loop
 *   would fight a browser tab for the slot.
 */
export class RamClient extends Emitter<RamClientEvents> {
  private ws?: WebSocket;
  private pending = new Map<string, Pending>();
  private _state: ClientState = "disconnected";
  private _introspection?: Introspection;
  private readonly timeouts: Partial<Record<RamCommand, number>>;
  private readonly defaultTimeout: number;

  constructor(options: RamClientOptions = {}) {
    super();
    this.timeouts = { ...COMMAND_TIMEOUTS, ...options.timeouts };
    this.defaultTimeout = options.defaultTimeout ?? DEFAULT_TIMEOUT;
  }

  get state(): ClientState {
    return this._state;
  }

  get introspection(): Introspection | undefined {
    return this._introspection;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Open the socket and perform the RAM `connect` handshake. */
  async connect(url: string): Promise<void> {
    if (this.ws) {
      throw new RamError("Already connected (or connecting). Disconnect first.", "error", "connect");
    }
    this._introspection = undefined;
    const timeout = this.timeouts.connect ?? this.defaultTimeout;

    await this.openSocket(url, timeout);
    this.setState("idle");

    try {
      await this.request("connect", null);
    } catch (err) {
      const noResponse =
        err instanceof RamError && (err.kind === "timeout" || err.kind === "closed") && !this._introspection;
      this.close("connect failed");
      if (noResponse) {
        throw new RamError(SINGLE_SLOT_MESSAGE, "busy", "connect");
      }
      throw err;
    }
  }

  private openSocket(url: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url, { handshakeTimeout: timeout });
      this.ws = ws;

      const fail = (err: RamError) => {
        if (settled) {
          return;
        }
        settled = true;
        this.ws = undefined;
        ws.removeAllListeners();
        ws.on("error", () => {});
        ws.terminate();
        reject(err);
      };

      ws.once("open", () => {
        settled = true;
        ws.on("close", (code, reason) => this.handleClose(`${code}${reason.length ? ` ${reason}` : ""}`));
        resolve();
      });
      ws.on("message", (raw) => this.handleFrame(raw.toString()));
      ws.on("error", (err: NodeJS.ErrnoException) => {
        if (!settled) {
          const detail = err.code ?? err.message;
          fail(
            new RamError(
              `Can't reach the Robotics Backend at ${url} (${detail}). Is the ra-proto container running?`,
              "unreachable",
              "connect",
            ),
          );
        } else {
          this.emit("error", err);
        }
      });
      ws.once("close", () => fail(new RamError(SINGLE_SLOT_MESSAGE, "busy", "connect")));
    });
  }

  /** Send a command and wait for its `ack`. Rejects with RamError on `error`, timeout, or close. */
  request(command: RamCommand, data: unknown = null): Promise<RamMessage> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new RamError("Not connected to the Robotics Backend.", "closed", command));
    }
    const id = randomUUID();
    const timeoutMs = this.timeouts[command] ?? this.defaultTimeout;

    return new Promise<RamMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RamError(`'${command}' timed out after ${Math.round(timeoutMs / 1000)} s.`, "timeout", command));
      }, timeoutMs);
      this.pending.set(id, { command, resolve, reject, timer });
      this.sendFrame({ id, command, data });
    });
  }

  /** Fire-and-forget message to the exercise web GUI server (RAM never acks these). */
  sendGui(payload: string): void {
    if (this.isOpen) {
      this.sendFrame({ id: randomUUID(), command: "gui", data: payload });
    }
  }

  /** Politely leave (RAM → idle) and close the socket. */
  async disconnect(): Promise<void> {
    if (!this.ws) {
      return;
    }
    try {
      await this.request("disconnect", null);
    } catch {
      // Closing anyway.
    }
    this.close("disconnected by user");
  }

  /** Close the socket immediately. Pending requests are rejected. */
  close(reason = "closed"): void {
    const ws = this.ws;
    if (!ws) {
      return;
    }
    ws.removeAllListeners("close");
    ws.on("error", () => {});
    ws.close();
    this.handleClose(reason);
  }

  private sendFrame(msg: RamMessage): void {
    this.emit("message", "out", msg);
    this.ws?.send(JSON.stringify(msg));
  }

  private handleFrame(raw: string): void {
    let msg: RamMessage;
    try {
      msg = JSON.parse(raw) as RamMessage;
    } catch {
      this.emit("error", new Error(`Unparseable frame from RAM: ${raw.slice(0, 120)}`));
      return;
    }
    this.emit("message", "in", msg);

    const pending = msg.id ? this.pending.get(msg.id) : undefined;
    if (pending && (msg.command === "ack" || msg.command === "error")) {
      this.pending.delete(msg.id!);
      clearTimeout(pending.timer);
      if (msg.command === "ack") {
        pending.resolve(msg);
      } else {
        pending.reject(new RamError(errorText(msg.data), "error", pending.command));
      }
      return;
    }

    switch (msg.command) {
      case "state-changed": {
        const state = (msg.data as { state?: RamState } | undefined)?.state;
        if (state) {
          this.setState(state);
        }
        break;
      }
      case "introspection":
        this._introspection = (msg.data ?? {}) as Introspection;
        this.emit("introspection", this._introspection);
        break;
      case "update": {
        const update = (msg.data as { update?: GuiUpdate } | undefined)?.update;
        if (update && typeof update === "object") {
          this.emit("update", update);
        }
        break;
      }
      case "error":
        // Error without a matching pending request (e.g. it arrived after our timeout).
        this.emit("error", new RamError(errorText(msg.data), "error"));
        break;
      default:
        break;
    }
  }

  private handleClose(reason: string): void {
    this.ws = undefined;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new RamError(`Connection closed before '${p.command}' finished.`, "closed", p.command));
      this.pending.delete(id);
    }
    const wasConnected = this._state !== "disconnected";
    this.setState("disconnected");
    if (wasConnected) {
      this.emit("connectionClosed", reason);
    }
  }

  private setState(state: ClientState): void {
    const previous = this._state;
    if (previous === state) {
      return;
    }
    this._state = state;
    this.emit("stateChanged", state, previous);
  }
}

function errorText(data: unknown): string {
  if (data && typeof data === "object" && "message" in data) {
    return String((data as { message: unknown }).message);
  }
  return typeof data === "string" ? data : JSON.stringify(data);
}
