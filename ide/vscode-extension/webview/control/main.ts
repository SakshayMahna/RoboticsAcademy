import { $, init, onMessage, vscode } from "../shared";

const { circuit, mapSize } = init<{ circuit: string; mapSize: { width: number; height: number } }>();

type State = "disconnected" | "idle" | "connected" | "world_ready" | "tools_ready" | "application_running" | "paused";

interface Lap {
  current?: number;
  last?: number;
  best?: number;
  laps: number;
}

interface StateMsg {
  type: "state";
  state: State;
  busy?: string;
  version?: string;
  ros?: string;
  exercise: { title: string; world: string };
  lap: Lap;
  display: boolean;
  hasProject: boolean;
}

const LABEL: Record<State, string> = {
  disconnected: "Disconnected",
  idle: "Idle",
  connected: "Connected",
  world_ready: "World ready",
  tools_ready: "Tools ready",
  application_running: "Running",
  paused: "Paused",
};

const DOT: Partial<Record<State, string>> = {
  connected: "ok",
  world_ready: "ok",
  tools_ready: "ok",
  application_running: "run",
  paused: "warn",
};

/** When each button is enabled. `always` buttons ignore the busy flag too. */
const ENABLED: Record<string, (s: State) => boolean> = {
  connect: (s) => s === "disconnected",
  disconnect: (s) => s !== "disconnected",
  reconnect: () => true,
  launchWorld: (s) => ["disconnected", "idle", "connected", "world_ready"].includes(s),
  stopWorld: (s) => ["world_ready", "tools_ready", "application_running", "paused"].includes(s),
  run: (s) => ["tools_ready", "application_running", "paused"].includes(s),
  pause: (s) => s === "application_running",
  resume: (s) => s === "paused",
  stopApp: (s) => s === "application_running" || s === "paused",
  restartRun: (s) => ["tools_ready", "application_running", "paused"].includes(s),
};
const ALWAYS = new Set(["showGazebo", "showConsole", "showWebGui", "toggleWebGui", "openLayout", "resetBestLap", "newProject", "showLog"]);

const btn = (command: string, label: string, title: string, secondary = false) =>
  `<button class="ctl${secondary ? " secondary" : ""}" data-cmd="${command}" title="${title}">${label}</button>`;

$("app").innerHTML = `
<div class="section">
  <h3>Connection</h3>
  <div class="state"><span id="dot" class="dot"></span><span id="state">Disconnected</span></div>
  <div class="meta" id="backend">Robotics Backend: not connected</div>
  <div class="row">
    ${btn("connect", "Connect", "Connect to the local Robotics Backend")}
    ${btn("disconnect", "Disconnect", "Disconnect (RAM tears the world down)", true)}
    ${btn("reconnect", "Reconnect", "Disconnect and connect again", true)}
  </div>
  <div class="busy hidden" id="busy"></div>
</div>
<div class="section">
  <h3>Exercise</h3>
  <div class="meta"><strong id="title"></strong><br>World: <span id="world"></span></div>
  <div class="row">
    ${btn("launchWorld", "Launch", "Launch the exercise world and tools")}
    ${btn("stopWorld", "Stop World", "Stop app, tools and world", true)}
  </div>
</div>
<div class="section">
  <h3>Application</h3>
  <div class="row">
    ${btn("run", "▶ Run", "Zip your project and run it in the backend")}
    ${btn("pause", "❚❚ Pause", "Pause the program and the simulation", true)}
    ${btn("resume", "▶ Resume", "Resume", true)}
    ${btn("stopApp", "■ Stop App", "Stop the program (world keeps running)", true)}
    ${btn("restartRun", "↻ Restart run", "Stop and run again with your latest saved code", true)}
  </div>
  <div class="meta hidden" id="noproject">Open a project folder to run code. ${btn("newProject", "New project…", "Create a Follow Line project", true)}</div>
</div>
<div class="section">
  <h3>Panels</h3>
  <div class="row">
    ${btn("showGazebo", "Gazebo", "Show the Gazebo view", true)}
    ${btn("showConsole", "Console", "Show the program console", true)}
    ${btn("showWebGui", "Web GUI", "Show the Follow Line web GUI", true)}
    ${btn("toggleWebGui", "Web GUI: on", "Turn web GUI rendering on/off (the car is never affected)", true)}
  </div>
  <div class="row">${btn("openLayout", "Open exercise layout", "Code left, Gazebo top-right, Web GUI bottom-right", true)}</div>
</div>
<div class="section">
  <h3>Lap timer</h3>
  <div class="lapcard">
    <div><div class="k">Current lap</div><div class="v" id="cur">–</div></div>
    <div><div class="k">Best lap</div><div class="v best" id="best">–</div></div>
    <div><div class="k">Last lap</div><div class="v" id="last">–</div></div>
    <div><div class="k">Laps this run</div><div class="v" id="laps">0</div></div>
  </div>
  <div class="minimap side"><img id="circuit" alt="Circuit map"><div id="car" class="car hidden"></div></div>
  <div class="row">${btn("resetBestLap", "Reset best", "Forget the best lap", true)} ${btn("showLog", "Show log", "Open the Robotics Academy output channel", true)}</div>
</div>`;

$<HTMLImageElement>("circuit").src = circuit;

document.querySelectorAll<HTMLButtonElement>("button[data-cmd]").forEach((b) =>
  b.addEventListener("click", () => vscode.postMessage({ type: "command", command: b.dataset.cmd })),
);

const fmt = (s?: number) => (s === undefined ? "–" : `${s.toFixed(2)} s`);

onMessage<StateMsg | { type: "car"; car: [number, number] }>((m) => {
  if (m.type === "car") {
    const car = $("car");
    // Pixel coordinates are for a 300x150 map; the sidebar map is scaled, so use percentages.
    car.style.left = `${(m.car[0] / mapSize.width) * 100}%`;
    car.style.top = `${(m.car[1] / mapSize.height) * 100}%`;
    car.classList.remove("hidden");
    return;
  }
  $("state").textContent = LABEL[m.state];
  $("dot").className = `dot ${DOT[m.state] ?? ""}`;
  $("backend").textContent = m.version
    ? `Robotics Backend ${m.version}${m.ros ? ` · ROS 2 ${m.ros}` : ""}`
    : "Robotics Backend: not connected";
  $("title").textContent = m.exercise.title;
  $("world").textContent = m.exercise.world;
  $("busy").textContent = m.busy ?? "";
  $("busy").classList.toggle("hidden", !m.busy);
  $("noproject").classList.toggle("hidden", m.hasProject);

  document.querySelectorAll<HTMLButtonElement>("button[data-cmd]").forEach((b) => {
    const cmd = b.dataset.cmd!;
    if (ALWAYS.has(cmd)) {
      return;
    }
    const enabled = ENABLED[cmd]?.(m.state) ?? true;
    b.disabled = Boolean(m.busy) || !enabled || (cmd === "run" || cmd === "restartRun" ? !m.hasProject : false);
  });
  const toggle = document.querySelector<HTMLButtonElement>('button[data-cmd="toggleWebGui"]')!;
  toggle.textContent = `Web GUI: ${m.display ? "on" : "off"}`;

  $("cur").textContent = fmt(m.lap.current);
  $("best").textContent = fmt(m.lap.best);
  $("last").textContent = fmt(m.lap.last);
  $("laps").textContent = String(m.lap.laps);
  if (!["application_running", "paused"].includes(m.state) && m.lap.current === undefined) {
    $("car").classList.add("hidden");
  }
});

vscode.postMessage({ type: "ready" });
