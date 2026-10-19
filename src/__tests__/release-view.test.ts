import { describe, expect, it } from "vitest";
import { formatFileSize as formatServerFileSize } from "../format-file-size.js";
import {
  apiErrorMessage,
  confirmationNote,
  deleteFailureMessage,
  downloadFailure,
  filterableApps,
  formatFileSize,
  isApkFileName,
  isReachableFromPhone,
  latestReleaseIds,
  matchesVersionName,
  parseJsonBody,
  progressLabel,
  releasesQuery,
  shortHash,
  successorOf,
  uploadSummary,
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

describe("releasesQuery", () => {
  it("asks for one page of all apps", () => {
    expect(releasesQuery(null, 50, 0)).toBe("limit=50&offset=0");
  });

  it("adds the app filter", () => {
    expect(releasesQuery(7, 50, 100)).toBe("limit=50&offset=100&appId=7");
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

describe("deleteFailureMessage", () => {
  it("says the release is already gone on 404", () => {
    const body = {
      success: false,
      error: { code: "release_not_found", message: "Release 4 not found" },
    };

    expect(deleteFailureMessage(404, body)).toBe("This release was already removed.");
  });

  it("uses the server's message for other statuses", () => {
    const body = {
      success: false,
      error: { code: "unauthorized", message: "A valid admin token is required" },
    };

    expect(deleteFailureMessage(401, body)).toBe("A valid admin token is required");
  });

  it("falls back to the status when there is no message", () => {
    expect(deleteFailureMessage(500, null)).toBe("The server answered HTTP 500.");
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
    const data = { appName: "My Shop", versionName: "1.2.0", versionCode: 12, fileSize: "24.5 MB" };

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

describe("parseJsonBody", () => {
  it("parses JSON text", () => {
    expect(parseJsonBody('{"success":false}')).toEqual({ success: false });
  });

  it.each(["", "<h1>Bad Gateway</h1>", "{broken"])("returns null for %j", (text) => {
    expect(parseJsonBody(text)).toBeNull();
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

describe("isReachableFromPhone", () => {
  it.each([
    "http://192.168.1.20:3000/api/apks/download/3",
    "http://10.0.0.5/api/apks/download/3",
    "http://172.16.4.9:3000/api/apks/download/3",
    "http://aerodeploy.local:3000/api/apks/download/3",
    "http://deploy-box:3000/api/apks/download/3",
    "https://deploy.example.com/api/apks/download/3",
    "http://[fd00::20]:3000/api/apks/download/3",
  ])("accepts %s", (url) => {
    expect(isReachableFromPhone(url)).toBe(true);
  });

  it.each([
    "http://localhost:3000/api/apks/download/3",
    "http://LOCALHOST:3000/api/apks/download/3",
    "http://app.localhost:3000/api/apks/download/3",
    "http://127.0.0.1:3000/api/apks/download/3",
    "http://127.1.2.3:3000/api/apks/download/3",
    "http://0.0.0.0:3000/api/apks/download/3",
    "http://[::1]:3000/api/apks/download/3",
    "http://localhost.:3000/api/apks/download/3",
  ])("rejects %s, which a phone would resolve to itself", (url) => {
    expect(isReachableFromPhone(url)).toBe(false);
  });

  it.each(["", "not a url", "/api/apks/download/3"])(
    "rejects %j, which is not an absolute URL",
    (url) => {
      expect(isReachableFromPhone(url)).toBe(false);
    },
  );
});
