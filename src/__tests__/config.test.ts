import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../config.js";

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
