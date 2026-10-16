export interface AppConfig {
  host: string;
  port: number;
}

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly variable: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;

function parsePort(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be an integer between 1 and 65535, got "${raw}"`, "PORT");
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? DEFAULT_HOST,
    port: parsePort(env.PORT),
  };
}
