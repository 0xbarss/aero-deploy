import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  ConfigError,
  loadAdminToken,
  loadConfig,
  loadDatabaseUrl,
  loadStorageConfig,
} from "../config.js";

describe("loadConfig", () => {
  it("falls back to defaults when nothing is set", () => {
    expect(loadConfig({})).toEqual({ host: "0.0.0.0", port: 3000 });
  });

  it("reads HOST and PORT from the environment", () => {
    expect(loadConfig({ HOST: "127.0.0.1", PORT: "8080" })).toEqual({
      host: "127.0.0.1",
      port: 8080,
    });
  });

  it.each(["abc", "-1", "0", "65536", "30.5", ""])("rejects PORT=%j", (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(ConfigError);
  });
});

describe("loadDatabaseUrl", () => {
  it("reads DATABASE_URL by default", () => {
    expect(loadDatabaseUrl({ DATABASE_URL: "postgres://u:p@localhost:5432/db" })).toBe(
      "postgres://u:p@localhost:5432/db",
    );
  });

  it("reads a custom variable name", () => {
    const env = { TEST_DATABASE_URL: "postgres://u:p@localhost:5432/test" };
    expect(loadDatabaseUrl(env, "TEST_DATABASE_URL")).toBe("postgres://u:p@localhost:5432/test");
  });

  it.each([undefined, "", "   "])("rejects a missing value %j", (value) => {
    const error = (() => {
      try {
        loadDatabaseUrl({ DATABASE_URL: value });
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).variable).toBe("DATABASE_URL");
  });

  it("rejects a value that is not a postgres url", () => {
    expect(() => loadDatabaseUrl({ DATABASE_URL: "mysql://localhost/db" })).toThrow(ConfigError);
    expect(() => loadDatabaseUrl({ DATABASE_URL: "not a url" })).toThrow(ConfigError);
  });
});

describe("loadStorageConfig", () => {
  it("falls back to ./uploads and 200 MB", () => {
    expect(loadStorageConfig({})).toEqual({
      uploadDir: resolve("uploads"),
      maxUploadBytes: 200 * 1024 * 1024,
    });
  });

  it("reads UPLOAD_DIR and MAX_UPLOAD_MB", () => {
    expect(loadStorageConfig({ UPLOAD_DIR: "/srv/apks", MAX_UPLOAD_MB: "50" })).toEqual({
      uploadDir: "/srv/apks",
      maxUploadBytes: 50 * 1024 * 1024,
    });
  });

  it.each(["abc", "0", "-5", "1.5", ""])("rejects MAX_UPLOAD_MB=%j", (value) => {
    expect(() => loadStorageConfig({ MAX_UPLOAD_MB: value })).toThrow(ConfigError);
  });

  it("rejects an empty UPLOAD_DIR", () => {
    expect(() => loadStorageConfig({ UPLOAD_DIR: "  " })).toThrow(ConfigError);
  });
});

describe("loadAdminToken", () => {
  it("returns undefined when ADMIN_TOKEN is not set", () => {
    expect(loadAdminToken({})).toBeUndefined();
  });

  it.each(["", "   "])("treats a blank value %j as not set", (value) => {
    expect(loadAdminToken({ ADMIN_TOKEN: value })).toBeUndefined();
  });

  it("returns the token without surrounding whitespace", () => {
    expect(loadAdminToken({ ADMIN_TOKEN: "  s3cret-token \n" })).toBe("s3cret-token");
  });
});
