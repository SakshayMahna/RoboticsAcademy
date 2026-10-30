// Robotics Application Manager (RAM) websocket protocol. See NOTES.md for verified details.

export type RamState =
  | "idle"
  | "connected"
  | "world_ready"
  | "tools_ready"
  | "application_running"
  | "paused";

/** RAM states plus the extension-level "no socket" state. */
export type ClientState = RamState | "disconnected";

export type RamCommand =
  | "connect"
  | "launch_world"
  | "prepare_tools"
  | "run_application"
  | "pause"
  | "resume"
  | "terminate_application"
  | "terminate_tools"
  | "terminate_world"
  | "disconnect";

export interface RamMessage {
  id?: string;
  command: string;
  data?: unknown;
}

export interface Introspection {
  robotics_backend_version?: string;
  ros_version?: string;
  // Sic: RAM spells it "avaliable".
  gpu_avaliable?: string;
}

export interface LaunchFileConfig {
  name: string;
  type: string;
  ros_version: string;
  launch_file_path: string;
}

export interface RobotConfig extends LaunchFileConfig {
  entity: string;
  start_pose: number[];
  extra_config: string;
}

export interface WorldConfig {
  name: string;
  scene: LaunchFileConfig & { tools_config?: Record<string, string> };
  robot: RobotConfig[];
}

export interface RunApplicationData {
  entrypoint: string[];
  linter: string[];
  code: string;
}

/** Payload of an `update` frame (already JSON-parsed by RAM's web GUI bridge). */
export type GuiUpdate = Record<string, unknown>;

export const RUNNABLE_STATES: readonly ClientState[] = ["tools_ready", "application_running", "paused"];
export const TOOLS_UP_STATES: readonly ClientState[] = ["tools_ready", "application_running", "paused"];

/** Per-command reply timeouts (ms). Gazebo under Rosetta is slow. */
export const COMMAND_TIMEOUTS: Partial<Record<RamCommand, number>> = {
  connect: 15_000,
  launch_world: 180_000,
  prepare_tools: 180_000,
  run_application: 60_000,
};
export const DEFAULT_TIMEOUT = 30_000;
