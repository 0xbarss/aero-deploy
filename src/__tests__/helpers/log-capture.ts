import { Writable } from "node:stream";

export interface LogEntry {
  level: number;
  event?: string;
  code?: string;
  statusCode?: number;
  [key: string]: unknown;
}

export interface LogCapture {
  stream: Writable;
  entries: () => LogEntry[];
}

/** Collects the JSON lines a Fastify logger writes, so tests can look at them. */
export function captureLogs(): LogCapture {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(
        ...chunk
          .toString()
          .split("\n")
          .filter((line) => line !== ""),
      );
      callback();
    },
  });
  return { stream, entries: () => lines.map((line) => JSON.parse(line) as LogEntry) };
}

export async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return condition();
}
