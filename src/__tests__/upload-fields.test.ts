import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors.js";
import { parseUploadFields } from "../apks/upload-fields.js";

describe("parseUploadFields", () => {
  it("accepts a name, a code and notes with line breaks and non-ASCII text", () => {
    expect(
      parseUploadFields({
        versionName: "1.0.2",
        versionCode: "3",
        releaseNotes: "Düzeltmeler\nPerformans iyileştirmeleri",
      }),
    ).toEqual({
      versionName: "1.0.2",
      versionCode: 3,
      packageName: null,
      appName: null,
      releaseNotes: "Düzeltmeler\nPerformans iyileştirmeleri",
    });
  });

  it("needs no field at all", () => {
    expect(parseUploadFields({})).toEqual({
      versionName: null,
      versionCode: null,
      packageName: null,
      appName: null,
      releaseNotes: null,
    });
  });

  it("accepts packageName and appName and trims them", () => {
    expect(
      parseUploadFields({ packageName: " com.example.shop ", appName: " My Shop " }),
    ).toMatchObject({ packageName: "com.example.shop", appName: "My Shop" });
  });

  it("treats a blank appName as not sent", () => {
    expect(parseUploadFields({ appName: "   " }).appName).toBeNull();
  });

  it("accepts an appName longer than 100 characters, which the app naming cuts", () => {
    expect(parseUploadFields({ appName: "x".repeat(150) }).appName).toBe("x".repeat(150));
  });

  it.each([
    ["versionName", ""],
    ["versionName", "x".repeat(51)],
    ["versionName", "1\u00002"],
    ["versionCode", ""],
    ["versionCode", "abc"],
    ["versionCode", "0"],
    ["versionCode", "99999999999"],
    ["packageName", ""],
    ["packageName", "x".repeat(256)],
    ["packageName", "a\u0000b"],
    ["appName", "a\u0000b"],
    ["appName", "x".repeat(1001)],
    ["releaseNotes", "a\u0000b"],
  ])("rejects %s=%j", (field, value) => {
    expect(() => parseUploadFields({ [field]: value })).toThrow(ValidationError);
  });
});
