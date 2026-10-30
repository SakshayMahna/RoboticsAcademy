# Protocol notes: what differs from (or adds to) the spec

Sources: this repo (read-only), `jderobot-commsmanager@1.1.0`, `jderobot-ide-interface@0.3.21`,
`JdeRobot/RoboticsApplicationManager` (main), and `JdeRobot/RoboticsInfrastructure` `database/worlds.sql`.
Everything below was checked against those sources and against the mock. **Nothing here has been
tested against the live `rosetta-fix` backend yet.** Do the manual test plan in the README before
the demo.

## 1. `launch_world` payload

The spec's config was rebuilt from truncated RAM logs. The real values come from the DB the
site uses (`RoboticsInfrastructure/database/worlds.sql`) and from how `academy/views.py`
(`get_docker_world_data`) shapes them:

| Field | Spec | Verified |
|---|---|---|
| `robot[0].extra_config` | `mode:=holonomic sensor:=camera namespace:=f1` | **`mode:=holo sensor:=camera namespace:=f1`** (robot id 2, "F1 Holonomic Camera") |
| `robot[0].name` | "F1 Holonomic Camera" | same |
| `robot[0].start_pose` | `[53.462, -10.734, 0.004, 0, 0, -1.57]` | same (`worlds_robots` row for world 5) |
| `scene.tools_config` | absent | **present**: the site sends `scene.tools_config = {"gzsim": ".../simple_circuit.config"}` too. RAM ignores it, but `exercise.json` mirrors it. |
| tools | `console, simulator, web_gui` | same (`database/exercises/db.sql`, `exercises_tools` for exercise 1) |

Still worth confirming with a live capture (Chrome DevTools → Network → WS on unibotics.org),
since the site's DB could differ from the repo's.

## 2. noVNC URL

From `VncViewer` in `jderobot-ide-interface@0.3.21`:

```
http://<host>:<port>/vnc.html?resize=remote&autoconnect=true&reconnect=true
```

Ports: Gazebo 6080, RViz 6081, Console 6082 (`react_frontend/src/helpers/tools.tsx`).

## 3. The run zip needs more than the four helpers

For Python, `PlayPause.tsx` merges **`common.zip`** into the code zip before the exercise
helpers. `common.zip` is built by `scripts/develop_academy.sh` from
`common/{console_interfaces,gui_interfaces,hal_interfaces}/<pkg>/` and holds the packages at the
zip root. `HAL.py` and `WebGUI.py` import from them (`hal_interfaces.general.motors`,
`gui_interfaces.general.measuring_threading_gui_harmonic`, …).

The extension vendors them under `exercises/common/` (via `npm run sync-helpers`) and lists them
in `exercise.json` as `"common"`. The zip root ends up as:
`main.py`, your other `*.py`, `HAL.py`, `WebGUI.py`, `lap.py`, `Frequency.py`, `console_interfaces/`, `gui_interfaces/`, `hal_interfaces/`.

(It's possible the backend image already ships these packages. Sending them matches the site either way.)

## 4. Message details

- `CommsManager.send("connect")` omits `data` entirely; we send `"data": null`. RAM does
  `message.data or None`, so `null`, `{}` and missing all behave the same.
- **Acks carry `data: null`.** `ManagerConsumerMessage.response()` passes `message=` instead of
  `data=`, so pydantic drops the "Exercise state changed to …" text.
- `gui` frames have no ack, as the spec says (`process_message` returns early).
- `update.data.update` is already a parsed dict (RAM's `Server.on_message` does `json.loads`).
  Inside it, `image` is still a JSON **string**.
- **Frequency messages come as `update` too**: every 2 s the GUI thread sends
  `{"brain", "gui", "rtf", "fps", "lat"}` with no `image`/`map`/`lap`. The web frontend acks those as
  well, and so do we. The Web GUI panel shows brain Hz and RTF from them.
- `lap` is Python `str(timedelta)` (`"0:00:12.345678"`, no fraction when it's exactly whole) or `"0"`
  before the timer starts. `map` is `str((x, y))`.

## 5. Web GUI handshake semantics

`measuring_threading_gui_harmonic.py` only sends a frame when it has seen `"start"` **and** the
previous frame was acked. That flag lives in the robot program, so **every new run needs a fresh
`"start"`**. The bridge restarts the start-timer on each transition into `tools_ready` /
`application_running` (same as `WebGUIContainer.tsx`).

## 6. Single-client behaviour

RAM's websocket server completes the handshake for a second client and then **immediately sends a
close frame** (`deny_new_connections` → `send_close`). Browsers may show that as "Connecting…"
forever. `RamClient` treats both "socket closed before the connect ack" and "no ack and no
introspection within 15 s" as the slot being taken, and shows the spec's message.

## 7. Any socket close tears the world down

`handle_client_disconnect` enqueues a `disconnect` command, so **dropping the socket is the same as
Disconnect**: app, tools and world are terminated and the manager restarts. Consequences:

- Reconnect can't reattach to a running world. It always starts from `connected`.
- `Developer: Reload Window` in the dev instance kills the world too.
- Connecting right after a disconnect can race the server freeing its slot. `RamClient.disconnect()`
  now waits for the close handshake, and Reconnect retries with 0/2/5/10 s backoff.

## 8. Laps

`lap.py` only measures **elapsed run time** (it has no lap-completion logic, and the web GUI just
shows that number). For the F7 lap card, the extension detects laps from the pose: a lap counts
once the car has been more than 15 m from the start pose and then comes back within 4 m. Best lap
is kept for the session and survives runs. The thresholds haven't been tuned on the real circuit.

## 9. Other deviations from the spec

- **GUI traffic isn't logged by default.** `gui` start/ack and `update` frames come at about 12 Hz and
  would bury the Output channel. Every other frame is logged. Set
  `roboticsAcademy.logGuiTraffic: true` to log those too.
- **Run while paused:** the web frontend sends `resume` if the files haven't changed. The extension
  always sends `run_application`, which is valid from `paused` and restarts with the current code.
  Resume has its own button.
- **Integration test:** `npm run test:integration` runs the installed VS Code with isolated dirs
  under `.vscode-dev/` (`itud`, `itext`, `it/`). It doesn't use `@vscode/test-electron`.
- **macOS socket path limit:** VS Code puts `<version>-main.sock` in the user-data dir, and macOS
  caps that path at about 103 bytes. `.vscode-dev/user-data` (from the spec) fits for this repo's
  location, but a deeper clone may not. `npm run dev` warns when that happens.
