import type { ClientState, GuiUpdate } from "../ram/types";

/** The subset of RamClient the bridge needs (keeps it testable). */
export interface GuiTransport {
  readonly state: ClientState;
  on(event: "stateChanged", fn: (state: ClientState) => void): () => void;
  on(event: "update", fn: (update: GuiUpdate) => void): () => void;
  sendGui(payload: string): void;
}

const STOP_STATES: readonly ClientState[] = ["disconnected", "idle", "connected", "world_ready"];

/**
 * Web GUI handshake, ported from react_frontend WebGUIContainer.tsx:
 *  - in tools_ready / application_running, send gui:"start" every second until the first update;
 *  - ack every update.
 *
 * This lives in the extension host on purpose: the robot program's WebGUI thread waits for
 * acks, so they must keep flowing whether or not a panel is open or rendering.
 */
export class WebGuiBridge {
  private timer?: ReturnType<typeof setInterval>;
  private disposers: (() => void)[] = [];
  private listeners = new Set<(update: GuiUpdate) => void>();
  private count = 0;
  private windowStart = Date.now();
  private _rate = 0;

  constructor(
    private readonly transport: GuiTransport,
    private readonly intervalMs = 1000,
  ) {
    this.disposers.push(
      transport.on("stateChanged", (s) => this.onState(s)),
      transport.on("update", (u) => this.onUpdate(u)),
    );
    this.onState(transport.state);
  }

  /** Updates per second over the last measurement window. */
  get rate(): number {
    return this._rate;
  }

  get handshaking(): boolean {
    return this.timer !== undefined;
  }

  onUpdateReceived(fn: (update: GuiUpdate) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    this.stopHandshake();
    this.disposers.forEach((d) => d());
    this.listeners.clear();
  }

  private onState(state: ClientState): void {
    if (state === "tools_ready" || state === "application_running") {
      this.startHandshake();
    } else if (STOP_STATES.includes(state)) {
      this.stopHandshake();
      this._rate = 0;
    }
  }

  private startHandshake(): void {
    this.stopHandshake();
    const tick = () => {
      if (STOP_STATES.includes(this.transport.state)) {
        this.stopHandshake();
      } else {
        this.transport.sendGui("start");
      }
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
  }

  private stopHandshake(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private onUpdate(update: GuiUpdate): void {
    this.stopHandshake();
    this.measure();
    for (const fn of this.listeners) {
      try {
        fn(update);
      } catch (err) {
        console.error("Web GUI update listener threw", err);
      }
    }
    this.transport.sendGui("ack");
  }

  private measure(): void {
    this.count++;
    const now = Date.now();
    const elapsed = now - this.windowStart;
    if (elapsed >= 1000) {
      this._rate = (this.count * 1000) / elapsed;
      this.count = 0;
      this.windowStart = now;
    }
  }
}
