import { describe, expect, it } from "vitest";
import { buildContentDisposition } from "../apks/content-disposition.js";

describe("buildContentDisposition", () => {
  it("passes a plain file name through in both parameters", () => {
    expect(buildContentDisposition("app-debug.apk")).toBe(
      "attachment; filename=\"app-debug.apk\"; filename*=UTF-8''app-debug.apk",
    );
  });

  it("replaces non-ASCII characters in the fallback and percent-encodes them in filename*", () => {
    expect(buildContentDisposition("uygulama-çğ.apk")).toBe(
      "attachment; filename=\"uygulama-__.apk\"; filename*=UTF-8''uygulama-%C3%A7%C4%9F.apk",
    );
  });

  it("uses one fallback character per code point outside the basic plane", () => {
    expect(buildContentDisposition("🙂.apk")).toBe(
      "attachment; filename=\"_.apk\"; filename*=UTF-8''%F0%9F%99%82.apk",
    );
  });

  it("keeps quotes and backslashes from breaking out of the quoted fallback", () => {
    expect(buildContentDisposition('a"b\\c.apk')).toBe(
      "attachment; filename=\"a_b_c.apk\"; filename*=UTF-8''a%22b%5Cc.apk",
    );
  });

  it("replaces percent signs in the fallback so it is not decoded twice", () => {
    expect(buildContentDisposition("100%.apk")).toBe(
      "attachment; filename=\"100_.apk\"; filename*=UTF-8''100%25.apk",
    );
  });

  it("percent-encodes the characters encodeURIComponent leaves alone in filename*", () => {
    expect(buildContentDisposition("a'b(1)*.apk")).toContain(
      "filename*=UTF-8''a%27b%281%29%2A.apk",
    );
  });
});
