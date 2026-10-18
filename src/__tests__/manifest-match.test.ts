import { describe, expect, it } from "vitest";
import { InvalidApkError, ManifestMismatchError } from "../errors.js";
import type { ApkManifestInfo } from "../apks/apk-manifest.js";
import { assertFieldsMatchManifest, effectiveVersionName } from "../apks/manifest-match.js";

const info: ApkManifestInfo = {
  packageName: "com.example.shop",
  versionName: "1.2.0",
  versionCode: 12,
  appLabel: "My Shop",
  debuggable: false,
  minSdk: 24,
  targetSdk: 34,
};

const none = { versionName: null, versionCode: null, packageName: null };

describe("effectiveVersionName", () => {
  it("uses the manifest versionName", () => {
    expect(effectiveVersionName(info)).toBe("1.2.0");
  });

  it("uses the version code as text when the manifest has no versionName", () => {
    expect(effectiveVersionName({ ...info, versionName: null })).toBe("12");
  });

  it("accepts a versionName of exactly 50 characters", () => {
    const name = "v".repeat(50);
    expect(effectiveVersionName({ ...info, versionName: name })).toBe(name);
  });

  it("rejects a versionName longer than 50 characters", () => {
    expect(() => effectiveVersionName({ ...info, versionName: "v".repeat(51) })).toThrow(
      InvalidApkError,
    );
  });

  it("rejects a versionName with a NUL byte", () => {
    expect(() => effectiveVersionName({ ...info, versionName: "1\u00002" })).toThrow(
      InvalidApkError,
    );
  });
});

describe("assertFieldsMatchManifest", () => {
  it("accepts fields that are absent", () => {
    expect(() => assertFieldsMatchManifest(none, info)).not.toThrow();
  });

  it("accepts fields that agree with the APK", () => {
    expect(() =>
      assertFieldsMatchManifest(
        { versionName: "1.2.0", versionCode: 12, packageName: "com.example.shop" },
        info,
      ),
    ).not.toThrow();
  });

  function mismatch(
    fields: Parameters<typeof assertFieldsMatchManifest>[0],
  ): ManifestMismatchError {
    try {
      assertFieldsMatchManifest(fields, info);
    } catch (error) {
      if (error instanceof ManifestMismatchError) {
        return error;
      }
      throw error;
    }
    throw new Error("expected a ManifestMismatchError");
  }

  it("names both values for a versionCode that differs", () => {
    const error = mismatch({ ...none, versionCode: 5 });
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe("manifest_mismatch");
    expect(error.message).toContain("versionCode");
    expect(error.message).toContain("5");
    expect(error.message).toContain("12");
  });

  it("names both values for a versionName that differs", () => {
    const error = mismatch({ ...none, versionName: "9.9.9" });
    expect(error.message).toContain("versionName");
    expect(error.message).toContain("9.9.9");
    expect(error.message).toContain("1.2.0");
  });

  it("names both values for a packageName that differs, and compares case-sensitively", () => {
    const error = mismatch({ ...none, packageName: "com.example.Shop" });
    expect(error.message).toContain("packageName");
    expect(error.message).toContain("com.example.Shop");
    expect(error.message).toContain("com.example.shop");
  });

  it("reports every field that differs in one error", () => {
    const error = mismatch({ versionName: "9", versionCode: 5, packageName: "com.other" });
    expect(error.message).toContain("versionName");
    expect(error.message).toContain("versionCode");
    expect(error.message).toContain("packageName");
  });

  it("compares a sent versionName with the version code text when the manifest has none", () => {
    const bare = { ...info, versionName: null };
    expect(() => assertFieldsMatchManifest({ ...none, versionName: "12" }, bare)).not.toThrow();
    expect(() => assertFieldsMatchManifest({ ...none, versionName: "1.2.0" }, bare)).toThrow(
      ManifestMismatchError,
    );
  });
});
