import { describe, expect, it } from "vitest";
import { appNameCandidates } from "../apks/app-naming.js";

const base = { requestedName: null, label: "My Shop", packageName: "com.example.shop" };

describe("appNameCandidates", () => {
  it("starts with the label, then the debug or package variant, then the package name", () => {
    expect(appNameCandidates({ ...base, debuggable: false })).toEqual([
      "My Shop",
      "My Shop (com.example.shop)",
      "com.example.shop",
    ]);
    expect(appNameCandidates({ ...base, debuggable: true })).toEqual([
      "My Shop",
      "My Shop (debug)",
      "com.example.shop",
    ]);
  });

  it("prefers a requested name over the label", () => {
    expect(appNameCandidates({ ...base, requestedName: "Shop Tool", debuggable: false })[0]).toBe(
      "Shop Tool",
    );
  });

  it.each([null, "", "   ", "\u0000\u0007"])(
    "falls back to the package name for the label %j",
    (label) => {
      expect(appNameCandidates({ ...base, label, debuggable: false })).toEqual([
        "com.example.shop",
      ]);
    },
  );

  it("removes control characters and surrounding whitespace", () => {
    expect(appNameCandidates({ ...base, label: "  My\u0000 Sh\nop ", debuggable: false })[0]).toBe(
      "My Shop",
    );
  });

  it("cuts a long name to 100 characters", () => {
    const [first] = appNameCandidates({ ...base, label: "x".repeat(150), debuggable: false });
    expect(first).toBe("x".repeat(100));
  });

  it("keeps the suffix whole and the result within 100 characters", () => {
    const candidates = appNameCandidates({ ...base, label: "x".repeat(150), debuggable: true });
    expect(candidates[1]).toBe(`${"x".repeat(100 - " (debug)".length)} (debug)`);
    expect(candidates[1]).toHaveLength(100);
  });

  it("does not split a character outside the basic plane", () => {
    const [first] = appNameCandidates({ ...base, label: "🙂".repeat(120), debuggable: false });
    expect(Array.from(first ?? "")).toHaveLength(100);
    expect(first).toBe("🙂".repeat(100));
  });

  it("never offers the same name twice", () => {
    const candidates = appNameCandidates({ ...base, label: null, debuggable: true });
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("ends with the package name", () => {
    const candidates = appNameCandidates({ ...base, requestedName: "A", debuggable: false });
    expect(candidates.at(-1)).toBe("com.example.shop");
  });
});
