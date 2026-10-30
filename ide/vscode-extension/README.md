# Robotics Academy for VS Code (prototype)

A prototype that runs the **Follow Line** exercise from VS Code instead of the Robotics Academy web
page. It talks to a locally running `robotics-backend` container.

- Native controls for the lifecycle: Connect → Launch → Run / Pause / Resume / Stop → Stop World.
- Gazebo and Console (noVNC) and the Follow Line Web GUI (camera, lap time, car on the circuit map)
  open as editor tabs you can drag, split, or move to a new window.
- Your code stays local. Run zips it with the exercise helpers and sends it to the backend, the same
  way the web page does.
- A Follow Line-specific sidebar card with current/best/last lap, a mini-map, and **Restart run**.

Protocol details that differ from the original spec are in [NOTES.md](NOTES.md).

## Your normal VS Code is not touched

All development runs in an **isolated VS Code instance**:

- `--user-data-dir=.vscode-dev/user-data` and `--extensions-dir=.vscode-dev/extensions`, both inside
  this folder and git-ignored.
- `--extensionDevelopmentPath=<this folder>`, so the extension is loaded, never installed.
- `--disable-extensions` (other extensions are off; this one still loads).

Nothing is installed into your default profile, nothing is written to `~/.vscode` or
`~/Library/Application Support/Code`, and `npm run package` only produces a `.vsix` in `dist/`.
Don't install that file into your normal profile.

## Prerequisites

- macOS on Apple Silicon (tested setup), Node 18+ and VS Code in `/Applications` (the `code` shell
  command isn't required).
- Docker Desktop with **Use Rosetta for x86_64/amd64 emulation** turned on.
- The locally patched image `jderobot/robotics-backend:rosetta-fix`. The stock image deadlocks at the
  tools step under Rosetta.

## Setup

```bash
cd ide/vscode-extension
npm install
npm run build        # extension + webviews → dist/
npm test             # unit tests (mock RAM, no Docker needed)
```

## Run it

1. Start the backend. Close every Unibotics / Robotics Academy browser tab first, because the
   backend accepts only one client.

   ```bash
   scripts/backend.sh --start     # or run the command it prints:
   docker run --rm -it --platform linux/amd64 --name ra-proto \
     -p 6080-6090:6080-6090 -p 7163:7163 \
     jderobot/robotics-backend:rosetta-fix
   ```

   It's ready when the logs show `Listening on port 7163 for clients..`.

2. Launch the isolated VS Code on the sample project:

   ```bash
   npm run dev                    # prints the exact `code` command it ran
   npm run dev -- --watch         # also rebuild on change (then: Developer: Reload Window)
   npm run dev -- /path/to/proj   # open another project folder
   ```

   Or open `ide/vscode-extension` itself in VS Code and press **F5**. `.vscode/launch.json` uses the
   same isolation flags.

### Demo script (about 5 minutes)

1. Click the **Robotics Academy** icon in the activity bar, then **Connect**. The status bar shows
   `RA: Connected` and the sidebar shows the backend version (4.10.3).
2. Click **Launch**. A progress notification shows while Gazebo starts, which takes 10–60 s under
   emulation. The status bar changes to `RA: Tools ready`.
3. Click **Open exercise layout**: `main.py` on the left, Gazebo top-right, Web GUI and Console
   bottom-right. Drag tabs around, or right-click a tab and choose *Move into New Window*. The VNC
   session survives.
4. With `main.py` open, press **▶** in the editor title bar (or **Run** in the sidebar). The car
   drives in Gazebo, the Web GUI shows the camera, lap time and the car dot on the map, and the
   sidebar lap card counts.
5. Toggle the Web GUI with the eye button in its title bar or *Web GUI: on/off* in the sidebar. The
   panel shows "Paused display" and the car keeps going.
6. **Pause** / **Resume**. Edit `main.py` (e.g. `HAL.setV(2)`), then click **Restart run** to stop
   and rerun with the saved code in one step.
7. **Stop App** returns to Tools ready. **Stop World** returns to Connected. **Disconnect**.

Commands are also in the Command Palette under **Robotics Academy:** (Connect, Launch Exercise World,
Run, Pause, Resume, Stop App, Restart Run, Stop World, Show Gazebo/Console/Web GUI, Toggle Web GUI,
Open Exercise Layout, New Follow Line Project, Show Log).

### Your own project

**Robotics Academy: New Follow Line Project** asks for a folder and writes:

- `main.py`, a starter that uses the *real* helper API (`HAL.getImage/setV/setW`, `WebGUI.showImage`).
- `typings/HAL.pyi`, `WebGUI.pyi` and `Frequency.pyi`, plus `pyrightconfig.json`, so Pylance and
  Pyright resolve `import HAL` / `import WebGUI`.

Helper files are **not** copied in. They're added on every Run. On Run, the extension:

- zips all `*.py` files in the project root, plus `HAL.py`, `WebGUI.py`, `lap.py`, `Frequency.py` and
  the `console_/gui_/hal_interfaces` packages (see NOTES.md §3);
- uses the active editor's file as the entrypoint if it's in the project root, otherwise `main.py`;
- auto-saves the project's files first;
- doesn't send your copy of a file named like a helper (e.g. `HAL.py`) and warns you about it.

To get Python language features in the isolated instance, install the Python extension **into the
isolated extensions dir only**, then start dev with extensions enabled:

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --user-data-dir=.vscode-dev/user-data --extensions-dir=.vscode-dev/extensions \
  --install-extension ms-python.python
npm run dev -- --with-extensions
```

## Settings

These are defaults only. The extension never writes your settings.

| Setting | Default | |
|---|---|---|
| `roboticsAcademy.ramUrl` | `ws://127.0.0.1:7163` | RAM websocket |
| `roboticsAcademy.host` | `127.0.0.1` | host for the noVNC panels |
| `roboticsAcademy.exercise` | `follow_line` | only Follow Line is bundled |
| `roboticsAcademy.lintOnRun` | `false` | send `linter: [entrypoint]`. RAM refuses to run on **any** pylint error. |
| `roboticsAcademy.logGuiTraffic` | `false` | also log the ~12 Hz web GUI frames |

## Working offline with the mock backend

```bash
npm run mock-ram                    # ws://127.0.0.1:7164, add --delay=3000 to feel the real latency
```

In the isolated instance, set `"roboticsAcademy.ramUrl": "ws://127.0.0.1:7164"` (Preferences → Settings;
this writes to `.vscode-dev/user-data`). The mock implements the state machine and the single-client
rule. Once the program runs, it streams a synthetic camera image, lap time and a car going round the
map at about 10 Hz, but only while it keeps getting `gui:"ack"`. It has no noVNC, so the Gazebo and
Console panels just fail to load.

## Tests

```bash
npm test                  # unit: RamClient, zip/payloads, Follow Line parsing + laps, web GUI handshake
npm run test:integration  # drives every command inside an isolated VS Code against the mock
```

The integration run opens a VS Code window briefly. Its state goes to `.vscode-dev/{itud,itext,it}`.

## Layout

```
src/
  extension.ts            activation + command registration (all errors → notification + log)
  Controller.ts           lifecycle actions, state, frames, laps
  ram/RamClient.ts        RAM websocket protocol client (ws), types.ts
  exercise/Exercise.ts    loads exercise.json, builds launch/tools/run payloads
  exercise/zip.ts         run zip (student files + helpers, helpers win)
  exercise/WebGuiBridge.ts gui start/ack handshake (extension host, never in a webview)
  exercise/followLine.ts  lap/pose parsing (ported from the web frontend), LapTracker
  panels/                 VncPanel (Gazebo/Console), WebGuiPanel
  ui/                     ControlView (sidebar), StatusBar, html helper
webview/                  plain TS for the webviews (bundled by esbuild)
exercises/follow_line/    exercise.json, helpers/, template/, media/
exercises/common/         vendored console_/gui_/hal_interfaces (npm run sync-helpers)
scripts/                  dev.mjs, mock-ram.mjs, integration.mjs, backend.sh, sync-helpers.mjs
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "The Robotics Backend didn't respond. It accepts only one client…" | A Unibotics / Robotics Academy tab (or another VS Code window) holds the single RAM slot. Close it and click Connect again. |
| "Can't reach the Robotics Backend at ws://127.0.0.1:7163 (ECONNREFUSED)" | The container isn't running or isn't ready yet. Wait for `Listening on port 7163`. |
| Launch hangs at "Starting tools" and RAM logs stop at `Tools transition started` | The wrong image is running. Only `:rosetta-fix` works on Apple Silicon. |
| Launch or tools are slow | Normal under emulation: 10–60 s for the world, 5–30 s for tools. Timeouts are 180 s. |
| Run fails with `User code not found` | The entrypoint isn't in the project root. Open the file you want to run, or keep a `main.py`. |
| Run fails with pylint output | `lintOnRun` is on and RAM refuses to run on any lint error, including import errors. Turn it off. |
| No program output | Output goes to the **Console** panel (port 6082). Don't `docker exec -it` into the container while running: RAM binds the program to the highest `/dev/pts`, so a new PTY steals the output. |
| `/workspace/code` is empty or changed | RAM wipes it on every Run. Your code lives locally. |
| The site's starter (`from GUI import GUI`, `from HAL import HAL`) fails | That template is outdated. Use `import HAL` / `import WebGUI` (the template here does). |
| Gazebo/Console panel stays blank | Run `Developer: Open Webview Developer Tools` and look for CSP or iframe errors. The page is `http://127.0.0.1:6080/vnc.html?...`. Use the ↻ button in the panel's corner to reload. |
| World vanished after `Reload Window` / Reconnect | RAM treats any socket close as Disconnect and tears the world down (NOTES.md §7). Launch again. |
| `npm run dev` window doesn't open, log shows `listen EINVAL … main.sock` | The repo path is too deep for macOS's socket path limit. Clone to a shorter path. |
