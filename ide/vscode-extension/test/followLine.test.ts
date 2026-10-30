import { describe, expect, it } from "vitest";
import { carPixel, formatLap, LapTracker, parseLapSeconds, parsePose, parseUpdate } from "../src/exercise/followLine";

describe("follow line parsing", () => {
  it("parses Python timedelta strings like the web frontend", () => {
    expect(parseLapSeconds("0:01:02.345678")).toBeCloseTo(62.345678);
    expect(parseLapSeconds("0:00:05")).toBe(5);
    expect(parseLapSeconds("0")).toBe(0);
    expect(parseLapSeconds("")).toBeUndefined();
    expect(formatLap(62.345678)).toBe("62.34");
    expect(formatLap(5)).toBe("5.00");
  });

  it("parses poses and maps them like showCarPositionFollowLine.js", () => {
    expect(parsePose("(53.46, -10.73)")).toEqual([53.46, -10.73]);
    expect(parsePose("")).toBeUndefined();
    // Original: x = round(53.46) * -2.6 + 151, y = round(-10.73) * 1.25 + 77
    expect(carPixel("default", [53.46, -10.73])).toEqual([53 * -2.6 + 151, -11 * 1.25 + 77]);
  });

  it("splits frames from frequency messages", () => {
    expect(parseUpdate({ brain: 50, gui: 12.5, rtf: 0.6, fps: 10, lat: 0 }).freq).toEqual({ brain: 50, gui: 12.5, rtf: 0.6 });
    const { frame } = parseUpdate({ image: JSON.stringify({ image: "AAA", shape: [1, 1, 3] }), lap: "0:00:01.5", map: "(1, 2)" });
    expect(frame).toEqual({ image: "data:image/png;base64,AAA", lapSeconds: 1.5, pose: [1, 2] });
    expect(parseUpdate({ image: JSON.stringify({ image: "", shape: "" }), lap: "", map: "" }).frame?.image).toBeUndefined();
  });
});

describe("LapTracker", () => {
  const start: [number, number] = [53.462, -10.734];

  function drive(t: LapTracker, from: number, to: number, period: number) {
    for (let s = from; s <= to; s += 0.1) {
      const th = (s / period) * 2 * Math.PI;
      t.feed({ lapSeconds: s, pose: [53.462 * Math.cos(th), -10.734 + 45 * Math.sin(th)] });
    }
  }

  it("detects completed laps from the pose and keeps the best", () => {
    const t = new LapTracker(start);
    drive(t, 0, 41, 20);
    expect(t.value.laps).toBe(2);
    expect(t.value.best).toBeGreaterThan(19);
    expect(t.value.best).toBeLessThan(21);
  });

  it("keeps the best lap across runs, and can reset it", () => {
    const t = new LapTracker(start);
    drive(t, 0, 21, 20);
    const best = t.value.best;
    expect(best).toBeDefined();
    drive(t, 0, 5, 20); // timer restarted = new run
    expect(t.value.laps).toBe(0);
    expect(t.value.best).toBe(best);
    t.resetBest();
    expect(t.value.best).toBeUndefined();
  });
});
