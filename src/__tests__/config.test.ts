import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadDatabaseUrl } from "../config.js";

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
