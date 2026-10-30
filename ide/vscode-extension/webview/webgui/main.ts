import { $, init, onMessage, vscode } from "../shared";

const { circuit } = init<{ circuit: string }>();
const camera = $<HTMLImageElement>("camera");
const waiting = $("waiting");
const paused = $("paused");
const lap = $("lap");
const car = $("car");
const stats = $("stats");
$<HTMLImageElement>("circuit").src = circuit;

let frames = 0;
let fps = 0;
setInterval(() => {
  fps = frames;
  frames = 0;
}, 1000);

interface Frame {
  type: "frame";
  image?: string;
  lap?: string;
  car?: [number, number];
}
interface Status {
  type: "status";
  state: string;
  display: boolean;
  rate: number;
  freq?: { brain?: number; gui?: number; rtf?: number };
  hasFrame: boolean;
}

onMessage<Frame | Status>((m) => {
  if (m.type === "frame") {
    frames++;
    if (m.image && camera.src !== m.image) {
      camera.src = m.image;
      camera.classList.remove("hidden");
      waiting.classList.add("hidden");
    }
    if (m.lap !== undefined) {
      lap.textContent = `${m.lap} s`;
      lap.classList.remove("hidden");
    }
    if (m.car) {
      car.style.left = `${m.car[0]}px`;
      car.style.top = `${m.car[1]}px`;
      car.classList.remove("hidden");
    }
  } else if (m.type === "status") {
    paused.classList.toggle("hidden", m.display);
    camera.style.opacity = m.display ? "1" : "0.15";
    if (!m.hasFrame) {
      camera.classList.add("hidden");
      waiting.classList.toggle("hidden", !m.display);
      lap.classList.add("hidden");
      car.classList.add("hidden");
    }
    const parts = [`${fps} fps shown`, `${m.rate.toFixed(1)} upd/s`];
    if (m.freq?.brain !== undefined) {
      parts.push(`brain ${m.freq.brain} Hz`);
    }
    if (m.freq?.rtf !== undefined) {
      parts.push(`RTF ${m.freq.rtf}`);
    }
    stats.textContent = parts.join(" · ");
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "d" && !e.metaKey && !e.ctrlKey) {
    vscode.postMessage({ type: "toggle" });
  }
});
vscode.postMessage({ type: "ready" });
