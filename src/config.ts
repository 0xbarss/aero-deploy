import { resolve } from "node:path";

export interface AppConfig {
  host: string;
  port: number;
}

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly variable: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
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

/** Error messages never include the URL itself, since it carries the database password. */
export function loadDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  variable = "DATABASE_URL",
): string {
  const raw = env[variable]?.trim();
  if (!raw) {
    throw new ConfigError(`${variable} is required`, variable);
  }
  let protocol: string;
  try {
    protocol = new URL(raw).protocol;
  } catch (error) {
    throw new ConfigError(`${variable} is not a valid URL`, variable, { cause: error });
  }
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    throw new ConfigError(`${variable} must start with postgres:// or postgresql://`, variable);
  }
  return raw;
}

function readOptionalToken(env: NodeJS.ProcessEnv, variable: string): string | undefined {
  const token = env[variable]?.trim();
  return token === undefined || token === "" ? undefined : token;
}

/** A blank value counts as not set, so a bare `ADMIN_TOKEN=` line in `.env` leaves admin routes off. */
export function loadAdminToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return readOptionalToken(env, "ADMIN_TOKEN");
}

/** A blank value counts as not set, so a bare `UPLOAD_TOKEN=` line in `.env` leaves uploads open. */
export function loadUploadToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return readOptionalToken(env, "UPLOAD_TOKEN");
}

export interface StorageConfig {
  uploadDir: string;
  maxUploadBytes: number;
}

const DEFAULT_UPLOAD_DIR = "uploads";
const DEFAULT_MAX_UPLOAD_MB = 200;

export function loadStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const rawDir = env.UPLOAD_DIR ?? DEFAULT_UPLOAD_DIR;
  if (rawDir.trim() === "") {
    throw new ConfigError("UPLOAD_DIR must not be empty", "UPLOAD_DIR");
  }

  const rawMax = env.MAX_UPLOAD_MB;
  const maxMb = rawMax === undefined ? DEFAULT_MAX_UPLOAD_MB : Number(rawMax);
  if (rawMax?.trim() === "" || !Number.isInteger(maxMb) || maxMb < 1) {
    throw new ConfigError(
      `MAX_UPLOAD_MB must be a positive integer, got "${rawMax}"`,
      "MAX_UPLOAD_MB",
    );
  }

  return { uploadDir: resolve(rawDir), maxUploadBytes: maxMb * 1024 * 1024 };
}
