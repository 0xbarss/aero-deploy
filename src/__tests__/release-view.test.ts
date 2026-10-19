import { describe, expect, it } from "vitest";
import { formatFileSize as formatServerFileSize } from "../format-file-size.js";
import {
  apiErrorMessage,
  formatFileSize,
  latestReleaseIds,
  shortHash,
} from "../../public/release-view.js";

describe("formatFileSize", () => {
  it.each([0, 1, 1023, 1024, 1536, 1048575, 1048576, 25690112, 1073741824, 5497558138880, 1e15])(
    "matches the upload response for %d bytes",
    (bytes) => {
      expect(formatFileSize(bytes)).toBe(formatServerFileSize(bytes));
    },
  );

  it("shows 25690112 bytes as 24.5 MB", () => {
    expect(formatFileSize(25690112)).toBe("24.5 MB");
  });
});

describe("shortHash", () => {
  const hash = "9f2c4be1a07d55c3e8f1d2a6b40c93e7a1b5d8f20c4e6a9b3d7f1e2c8a5b41ea";

  it("keeps the first 12 characters", () => {
    expect(shortHash(hash)).toBe("9f2c4be1a07d");
  });

  it("returns null when the release has no checksum", () => {
    expect(shortHash(null)).toBeNull();
  });

  it("returns a value shorter than 12 characters unchanged", () => {
    expect(shortHash("abc")).toBe("abc");
  });
});

describe("latestReleaseIds", () => {
  it("collects the latest release id of every app", () => {
    const apps = [
      { id: 1, latestRelease: { id: 7 } },
      { id: 2, latestRelease: { id: 12 } },
    ];

    expect(latestReleaseIds(apps)).toEqual(new Set([7, 12]));
  });

  it("skips apps without a release", () => {
    const apps = [
      { id: 1, latestRelease: null },
      { id: 2, latestRelease: { id: 5 } },
    ];

    expect(latestReleaseIds(apps)).toEqual(new Set([5]));
  });

  it("returns an empty set for no apps", () => {
    expect(latestReleaseIds([])).toEqual(new Set());
  });
});

describe("apiErrorMessage", () => {
  it("uses the message from the error envelope", () => {
    const body = { success: false, error: { code: "no_releases", message: "No APK yet" } };

    expect(apiErrorMessage(404, body)).toBe("No APK yet");
  });

  it.each([
    ["no body", null],
    ["a body that is not an object", "Bad Gateway"],
    ["an object without an error", { success: false }],
    ["an error without a message", { success: false, error: { code: "x" } }],
    ["a message that is not text", { success: false, error: { message: 42 } }],
    ["an empty message", { success: false, error: { message: "" } }],
  ])("falls back to the status for %s", (_name, body) => {
    expect(apiErrorMessage(502, body)).toBe("The server answered HTTP 502.");
  });
});
