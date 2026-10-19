import { describe, expect, it } from "vitest";
import { formatFileSize as formatServerFileSize } from "../../../src/format-file-size";
import {
  confirmationNote,
  filterableApps,
  formatFileSize,
  isApkFileName,
  isLoopbackHost,
  isRenameChange,
  latestReleaseIds,
  matchesVersionName,
  phoneUrl,
  progressLabel,
  shareableOrigin,
  shortHash,
  successorOf,
  uploadSummary,
} from "../format";
import { apiErrorMessage, downloadFailure, errorCode } from "../api";

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

describe("errorCode", () => {
  it("reads the code of the error envelope", () => {
    expect(errorCode({ success: false, error: { code: "release_not_found" } })).toBe(
      "release_not_found",
    );
  });

  it.each([null, "text", {}, { error: null }, { error: { code: 7 } }])(
    "returns null for %j",
    (body) => {
      expect(errorCode(body)).toBeNull();
    },
  );
});

describe("filterableApps", () => {
  it("keeps apps that have a release and sorts them by name", () => {
    const apps = [
      { id: 3, name: "Zebra", latestRelease: { id: 9 } },
      { id: 1, name: "Default App", latestRelease: null },
      { id: 2, name: "apple", latestRelease: { id: 4 } },
    ];

    expect(filterableApps(apps).map((app) => app.id)).toEqual([2, 3]);
  });

  it("returns an empty list when no app has a release", () => {
    expect(filterableApps([{ id: 1, name: "A", latestRelease: null }])).toEqual([]);
  });
});

describe("successorOf", () => {
  const releases = [
    { id: 10, versionCode: 12 },
    { id: 11, versionCode: 14 },
    { id: 12, versionCode: 13 },
  ];

  it("picks the highest version code among the other releases", () => {
    expect(successorOf(11, releases)).toEqual({ id: 12, versionCode: 13 });
  });

  it("ignores the release itself even when it is not the highest", () => {
    expect(successorOf(10, releases)).toEqual({ id: 11, versionCode: 14 });
  });

  it("returns null when nothing else is left", () => {
    expect(successorOf(10, [{ id: 10, versionCode: 12 }])).toBeNull();
    expect(successorOf(10, [])).toBeNull();
  });
});

describe("matchesVersionName", () => {
  it("accepts the exact version name, ignoring surrounding spaces", () => {
    expect(matchesVersionName("1.2.0-debug", "1.2.0-debug")).toBe(true);
    expect(matchesVersionName("  1.2.0-debug ", "1.2.0-debug")).toBe(true);
  });

  it.each(["", "1.2.0", "1.2.0-DEBUG", "1.2.0-debug extra"])("rejects %j", (typed) => {
    expect(matchesVersionName(typed, "1.2.0-debug")).toBe(false);
  });

  it("never matches an empty version name", () => {
    expect(matchesVersionName("", "")).toBe(false);
  });
});

describe("confirmationNote", () => {
  const release = { versionName: "1.0.60", versionCode: 60 };

  it("names the release that becomes the latest", () => {
    const next = { versionName: "1.0.59", versionCode: 59 };

    expect(confirmationNote("My Shop", true, next)).toBe(
      "1.0.59 (59) will become the latest release of My Shop.",
    );
  });

  it("warns when the app is left without releases", () => {
    expect(confirmationNote("My Shop", true, null)).toBe("My Shop will have no releases left.");
  });

  it("says nothing about the latest release when another release is the latest", () => {
    expect(confirmationNote("My Shop", false, null)).toBeNull();
    expect(release.versionName).toBe("1.0.60");
  });
});

describe("isApkFileName", () => {
  it.each(["app.apk", "APP.APK", "my app v2.apk", "  app.apk "])("accepts %j", (name) => {
    expect(isApkFileName(name)).toBe(true);
  });

  it.each(["", ".apk", "app", "app.apk.txt", "app.apks", "notes.txt"])("rejects %j", (name) => {
    expect(isApkFileName(name)).toBe(false);
  });
});

describe("uploadSummary", () => {
  it("names what the server detected in the APK", () => {
    const data = {
      appName: "My Shop",
      versionName: "1.2.0",
      versionCode: 12,
      fileSize: 25690112,
    };

    expect(uploadSummary(data)).toBe("Uploaded My Shop 1.2.0 (12), 24.5 MB.");
  });
});

describe("progressLabel", () => {
  it("shows the whole percent sent so far", () => {
    expect(progressLabel(0, 100)).toBe("Uploading… 0%");
    expect(progressLabel(439, 1000)).toBe("Uploading… 43%");
  });

  it("switches to processing once everything is sent", () => {
    expect(progressLabel(100, 100)).toBe("Processing on the server…");
    expect(progressLabel(250, 100)).toBe("Processing on the server…");
  });

  it("shows no percent when the total is unknown", () => {
    expect(progressLabel(5, 0)).toBe("Uploading…");
  });
});

describe("downloadFailure", () => {
  const missingFile = {
    success: false,
    error: {
      code: "apk_file_missing",
      message: "The file for release 4 is no longer on the server",
    },
  };

  it("says what to do when the file is gone from the server", () => {
    expect(downloadFailure(404, missingFile)).toEqual({
      message:
        "The file for this release is no longer on the server. Delete the release, then upload the build again.",
      releaseRemoved: false,
    });
  });

  it("says the release is already removed when the release itself is unknown", () => {
    const body = {
      success: false,
      error: { code: "release_not_found", message: "Release 4 not found" },
    };

    expect(downloadFailure(404, body)).toEqual({
      message: "This release was already removed.",
      releaseRemoved: true,
    });
  });

  it("does not treat a 404 without the server's code as a removed release", () => {
    expect(downloadFailure(404, null)).toEqual({
      message: "The server answered HTTP 404.",
      releaseRemoved: false,
    });
  });

  it("uses the server's message for other errors", () => {
    const body = {
      success: false,
      error: { code: "validation_error", message: "Invalid release id" },
    };

    expect(downloadFailure(400, body)).toEqual({
      message: "Invalid release id",
      releaseRemoved: false,
    });
  });

  it("falls back to the status when there is no message", () => {
    expect(downloadFailure(502, null)).toEqual({
      message: "The server answered HTTP 502.",
      releaseRemoved: false,
    });
  });
});

describe("isLoopbackHost", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "app.localhost",
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "[::1]",
    "[::]",
    "localhost.",
  ])("treats %s as an address only this machine can use", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(["192.168.1.20", "10.0.0.5", "172.16.4.9", "deploy.example.com", "deploy-box"])(
    "treats %s as an address another device can use",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe("phoneUrl", () => {
  it("keeps a link that another device can already reach", () => {
    const url = "http://192.168.1.20:3000/api/apks/download/12";

    expect(phoneUrl(url, ["192.168.1.13"])).toEqual({ url, rewritten: false });
  });

  it("builds the link on the server's own address when the page was opened locally", () => {
    const result = phoneUrl("http://localhost:3000/api/apks/download/12", ["192.168.1.13"]);

    expect(result).toEqual({
      url: "http://192.168.1.13:3000/api/apks/download/12",
      rewritten: true,
    });
  });

  it("keeps the port and the path when it rewrites the host", () => {
    const result = phoneUrl("http://127.0.0.1:8080/api/apks/download/3", ["10.0.0.5"]);

    expect(result.url).toBe("http://10.0.0.5:8080/api/apks/download/3");
  });

  it("leaves the link alone when the server has no other address", () => {
    const url = "http://localhost:3000/api/apks/download/12";

    expect(phoneUrl(url, [])).toEqual({ url, rewritten: false });
  });

  it("leaves text that is not a URL alone", () => {
    expect(phoneUrl("not a url", ["192.168.1.13"])).toEqual({
      url: "not a url",
      rewritten: false,
    });
  });
});

describe("shareableOrigin", () => {
  it("gives the network address when the page was opened on a local one", () => {
    expect(shareableOrigin("http://localhost:3000", ["192.168.1.13"])).toBe(
      "http://192.168.1.13:3000",
    );
  });

  it("keeps the address the page was opened with when it is already reachable", () => {
    expect(shareableOrigin("http://192.168.1.20:3000", ["192.168.1.13"])).toBe(
      "http://192.168.1.20:3000",
    );
  });
});

describe("isRenameChange", () => {
  it("accepts a different name", () => {
    expect(isRenameChange("Corner Shop", "My Shop")).toBe(true);
  });

  it("rejects the current name, with or without surrounding spaces", () => {
    expect(isRenameChange("My Shop", "My Shop")).toBe(false);
    expect(isRenameChange("  My Shop \t", "My Shop")).toBe(false);
  });

  it("accepts a change of letter case only, which the server allows for the same app", () => {
    expect(isRenameChange("my shop", "My Shop")).toBe(true);
  });

  it.each(["", "   ", "\t\n"])("rejects the blank name %j", (typed) => {
    expect(isRenameChange(typed, "My Shop")).toBe(false);
  });
});
