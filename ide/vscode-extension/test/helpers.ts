import { startMockRam, type MockRam } from "../scripts/mock-ram.mjs";
import { RamClient } from "../src/ram/RamClient";
import type { ClientState } from "../src/ram/types";

export async function mock(delay = 20): Promise<MockRam> {
  // Port 0 = pick a free port, so tests never clash with a real backend.
  return startMockRam({ port: 0, delay, log: () => {} });
}

export function waitForState(client: RamClient, state: ClientState, timeout = 3000): Promise<void> {
  if (client.state === state) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${state} (now ${client.state})`));
    }, timeout);
    const off = client.on("stateChanged", (s) => {
      if (s === state) {
        clearTimeout(t);
        off();
        resolve();
      }
    });
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const WORLD = {
  name: "Simple Circuit",
  scene: { name: "Simple Circuit", type: "gz", ros_version: "ROS2", launch_file_path: "/x.launch.py" },
  robot: [
    {
      name: "F1",
      type: "gz",
      ros_version: "ROS2",
      launch_file_path: "/f1.launch.py",
      entity: "f1",
      start_pose: [53.462, -10.734, 0.004, 0, 0, -1.57],
      extra_config: "mode:=holo sensor:=camera namespace:=f1",
    },
  ],
};
