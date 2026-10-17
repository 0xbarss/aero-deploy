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
      releaseNotes: "Düzeltmeler\nPerformans iyileştirmeleri",
    });
  });

  it("rejects a NUL byte in versionName, which PostgreSQL cannot store", () => {
    expect(() => parseUploadFields({ versionName: "1\u00002", versionCode: "3" })).toThrow(
      ValidationError,
    );
  });

  it("rejects a NUL byte in releaseNotes", () => {
    expect(() =>
      parseUploadFields({ versionName: "1.0.2", versionCode: "3", releaseNotes: "a\u0000b" }),
    ).toThrow(ValidationError);
  });
});
