// Follow Line specific parsing, ported from exercises/follow_line/frontend/helpers/*.js.

export interface FollowLineFrame {
  /** data: URL for the camera image, if this update carried one. */
  image?: string;
  /** Run time in seconds as reported by lap.py (elapsed time since the program started). */
  lapSeconds?: number;
  /** Car pose in world coordinates. */
  pose?: [number, number];
}

export interface FrequencyInfo {
  brain?: number;
  gui?: number;
  rtf?: number;
}

/** Port of showLapTimeFollowLine.js. Input is Python's str(timedelta), e.g. "0:01:02.345678", or "0". */
export function parseLapSeconds(lap: unknown): number | undefined {
  if (typeof lap !== "string" || lap === "") {
    return undefined;
  }
  const parts = lap.split(":");
  if (parts.length !== 3) {
    const n = Number(lap);
    return Number.isFinite(n) ? n : undefined;
  }
  const [h, m, s] = parts.map(Number);
  if (![h, m, s].every(Number.isFinite)) {
    return undefined;
  }
  return h * 3600 + m * 60 + s;
}

/** Same display as the web frontend: whole seconds + two decimals, e.g. "62.34". */
export function formatLap(seconds: number): string {
  const whole = Math.floor(seconds);
  const cs = Math.floor((seconds - whole) * 100 + 1e-6);
  return `${whole}.${String(cs).padStart(2, "0")}`;
}

/** "(x, y)" → [x, y] */
export function parsePose(map: unknown): [number, number] | undefined {
  if (typeof map !== "string" || map.length < 3) {
    return undefined;
  }
  const nums = map
    .slice(1, -1)
    .split(",")
    .map((v) => parseFloat(v));
  if (nums.length < 2 || !Number.isFinite(nums[0]) || !Number.isFinite(nums[1])) {
    return undefined;
  }
  return [nums[0], nums[1]];
}

const CIRCUIT_TRANSFORMS: Record<string, { scaleX: number; offsetX: number; scaleY: number; offsetY: number }> = {
  default: { scaleY: 1.25, offsetY: 77, scaleX: -2.6, offsetX: 151 },
  montmelo: { scaleY: 2.1, offsetY: 77, scaleX: -1.3, offsetX: 151 },
  montreal: { scaleY: 0.685, offsetY: 77, scaleX: -0.48, offsetX: 151 },
  ngb: { scaleY: 1.5, offsetY: 77, scaleX: -1.495, offsetX: 151 },
  monaco: { scaleY: 1.25, offsetY: 77, scaleX: -2.6, offsetX: 151 },
};

/** Base size (px) of the circuit overlay the transforms were tuned for. */
export const CIRCUIT_MAP_SIZE = { width: 300, height: 150 };

/** Port of showCarPositionFollowLine.js: world pose → pixel offset in a 300x150 circuit image. */
export function carPixel(circuit: string, pose: [number, number]): [number, number] {
  const t = CIRCUIT_TRANSFORMS[circuit] ?? CIRCUIT_TRANSFORMS.default;
  return [Math.round(pose[0]) * t.scaleX + t.offsetX, Math.round(pose[1]) * t.scaleY + t.offsetY];
}

/** Turns a raw RAM `update` payload into either a frame or frequency info. */
export function parseUpdate(update: Record<string, unknown>): { frame?: FollowLineFrame; freq?: FrequencyInfo } {
  if ("brain" in update || "rtf" in update) {
    return { freq: { brain: num(update.brain), gui: num(update.gui), rtf: num(update.rtf) } };
  }
  const frame: FollowLineFrame = {};
  if (typeof update.image === "string" && update.image) {
    try {
      const img = JSON.parse(update.image) as { image?: string; shape?: unknown };
      if (img.image && Array.isArray(img.shape)) {
        // The web frontend uses the png prefix even though WebGUI.py sends JPEG; browsers sniff it.
        frame.image = `data:image/png;base64,${img.image}`;
      }
    } catch {
      // ignore malformed image payloads
    }
  }
  frame.lapSeconds = parseLapSeconds(update.lap);
  frame.pose = parsePose(update.map);
  return { frame };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export interface LapSnapshot {
  /** Time on the current lap (s). */
  current?: number;
  /** Last completed lap (s). */
  last?: number;
  /** Best completed lap this session (s). */
  best?: number;
  laps: number;
}

/**
 * lap.py only reports elapsed run time, it never signals a completed lap. We detect laps
 * from the pose: the car must first leave the start area (ARM_DISTANCE) and then come back
 * to it (FINISH_DISTANCE).
 */
export class LapTracker {
  static readonly ARM_DISTANCE = 15;
  static readonly FINISH_DISTANCE = 4;

  private lapStart = 0;
  private lastElapsed = 0;
  private armed = false;
  private snapshot: LapSnapshot = { laps: 0 };

  constructor(private readonly start: [number, number]) {}

  get value(): LapSnapshot {
    return { ...this.snapshot };
  }

  /** Call when a new program run starts. Keeps best lap. */
  newRun(): void {
    this.lapStart = 0;
    this.lastElapsed = 0;
    this.armed = false;
    this.snapshot = { best: this.snapshot.best, laps: 0 };
  }

  resetBest(): void {
    this.snapshot.best = undefined;
  }

  /** Returns true if the snapshot changed. */
  feed(frame: FollowLineFrame): boolean {
    const elapsed = frame.lapSeconds;
    if (elapsed === undefined) {
      return false;
    }
    if (elapsed + 0.5 < this.lastElapsed) {
      // Timer went backwards: the program was restarted.
      this.newRun();
    }
    this.lastElapsed = elapsed;

    if (frame.pose) {
      const d = Math.hypot(frame.pose[0] - this.start[0], frame.pose[1] - this.start[1]);
      if (!this.armed && d > LapTracker.ARM_DISTANCE) {
        this.armed = true;
      } else if (this.armed && d < LapTracker.FINISH_DISTANCE) {
        const lap = elapsed - this.lapStart;
        this.lapStart = elapsed;
        this.armed = false;
        this.snapshot.last = lap;
        this.snapshot.laps++;
        if (this.snapshot.best === undefined || lap < this.snapshot.best) {
          this.snapshot.best = lap;
        }
      }
    }
    this.snapshot.current = elapsed - this.lapStart;
    return true;
  }
}
