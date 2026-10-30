export interface MockRam {
  port: number;
  url: string;
  /** Every frame the mock received, in order. */
  received: { id?: string; command: string; data?: unknown }[];
  close(): Promise<void>;
}
export function startMockRam(options?: {
  port?: number;
  delay?: number;
  updateHz?: number;
  log?: (msg: string) => void;
}): Promise<MockRam>;
export function testImage(frame: number, w?: number, h?: number): Buffer;
