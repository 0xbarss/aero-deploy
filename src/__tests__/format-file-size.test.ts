import { describe, expect, it } from "vitest";
import { formatFileSize } from "../format-file-size.js";

describe("formatFileSize", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024, "1.0 MB"],
    [Math.round(24.5 * 1024 * 1024), "24.5 MB"],
    [3 * 1024 * 1024 * 1024, "3.0 GB"],
  ])("formats %d bytes as %s", (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});
