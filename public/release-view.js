const SIZE_UNITS = ["KB", "MB", "GB", "TB"];

/** Same rounding and unit names as the size string in the upload response. */
export function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}

/** The first 12 characters of a checksum, or null when the release has none. */
export function shortHash(sha256) {
  return sha256 === null ? null : sha256.slice(0, 12);
}

/**
 * Ids of the releases to badge as "Latest": the newest release of each app, as GET /api/apps
 * reports it. The release list is paged, so the badge cannot be worked out from one page.
 * @param {ReadonlyArray<{ latestRelease: { id: number } | null }>} apps
 * @returns {Set<number>}
 */
export function latestReleaseIds(apps) {
  const ids = new Set();
  for (const app of apps) {
    if (app.latestRelease !== null) {
      ids.add(app.latestRelease.id);
    }
  }
  return ids;
}

/**
 * The message of the server's error envelope, or a plain line naming the status.
 * @param {number} status
 * @param {unknown} body
 * @returns {string}
 */
export function apiErrorMessage(status, body) {
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body;
    if (typeof error === "object" && error !== null && "message" in error) {
      const { message } = error;
      if (typeof message === "string" && message !== "") {
        return message;
      }
    }
  }
  return `The server answered HTTP ${status}.`;
}

/** The code of the server's error envelope, or null when the body has none. */
function apiErrorCode(body) {
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body;
    if (typeof error === "object" && error !== null && "code" in error) {
      return typeof error.code === "string" ? error.code : null;
    }
  }
  return null;
}

/**
 * Apps worth offering in the filter: those with at least one release, sorted by name.
 * @template {{ name: string, latestRelease: unknown }} T
 * @param {ReadonlyArray<T>} apps
 * @returns {T[]}
 */
export function filterableApps(apps) {
  return apps
    .filter((app) => app.latestRelease !== null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * Query string for GET /api/apks.
 * @param {number | null} appId
 * @param {number} limit
 * @param {number} offset
 */
export function releasesQuery(appId, limit, offset) {
  const query = `limit=${limit}&offset=${offset}`;
  return appId === null ? query : `${query}&appId=${appId}`;
}

/**
 * The release that becomes the latest once `releaseId` is gone: the highest version code among
 * the others, or null when there is none.
 * @template {{ id: number, versionCode: number }} T
 * @param {number} releaseId
 * @param {ReadonlyArray<T>} releases
 * @returns {T | null}
 */
export function successorOf(releaseId, releases) {
  let best = null;
  for (const release of releases) {
    if (release.id !== releaseId && (best === null || release.versionCode > best.versionCode)) {
      best = release;
    }
  }
  return best;
}

/** Whether the text typed to confirm a delete is the release's version name. */
export function matchesVersionName(typed, versionName) {
  return versionName !== "" && typed.trim() === versionName;
}

/**
 * What the delete confirmation says about the latest release, or null when the release being
 * deleted is not the latest.
 * @param {string} appName
 * @param {boolean} isLatest
 * @param {{ versionName: string, versionCode: number } | null} successor
 * @returns {string | null}
 */
export function confirmationNote(appName, isLatest, successor) {
  if (!isLatest) {
    return null;
  }
  if (successor === null) {
    return `${appName} will have no releases left.`;
  }
  return `${successor.versionName} (${successor.versionCode}) will become the latest release of ${appName}.`;
}

/**
 * @param {number} status
 * @param {unknown} body
 * @returns {string}
 */
export function deleteFailureMessage(status, body) {
  return status === 404 ? "This release was already removed." : apiErrorMessage(status, body);
}

/**
 * What to tell the user when the check before a download fails, and whether the release itself
 * is gone (so the list is out of date).
 * @param {number} status
 * @param {unknown} body
 * @returns {{ message: string, releaseRemoved: boolean }}
 */
export function downloadFailure(status, body) {
  const code = apiErrorCode(body);
  if (status === 404 && code === "apk_file_missing") {
    return {
      message:
        "The file for this release is no longer on the server. Delete the release, then upload the build again.",
      releaseRemoved: false,
    };
  }
  if (status === 404 && code === "release_not_found") {
    return { message: "This release was already removed.", releaseRemoved: true };
  }
  return { message: apiErrorMessage(status, body), releaseRemoved: false };
}

/** Whether a file name looks like an APK; the server still checks the content. */
export function isApkFileName(name) {
  return /^.+\.apk$/i.test(name.trim());
}

/**
 * What the upload response says was detected in the APK.
 * @param {{ appName: string, versionName: string, versionCode: number, fileSize: string }} data
 */
export function uploadSummary(data) {
  return `Uploaded ${data.appName} ${data.versionName} (${data.versionCode}), ${data.fileSize}.`;
}

/**
 * @param {number} loaded bytes sent so far
 * @param {number} total bytes to send, or 0 when unknown
 */
export function progressLabel(loaded, total) {
  if (!(total > 0)) {
    return "Uploading…";
  }
  if (loaded >= total) {
    return "Processing on the server…";
  }
  return `Uploading… ${Math.floor((loaded / total) * 100)}%`;
}

/** The parsed JSON, or null when the text is not JSON (for example a proxy's error page). */
export function parseJsonBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Whether a phone could follow `url`. False for loopback addresses, which a phone would resolve
 * to itself, and for text that is not an absolute URL.
 * @param {string} url
 * @returns {boolean}
 */
export function isReachableFromPhone(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  if (hostname === "" || hostname === "localhost" || hostname.endsWith(".localhost")) {
    return false;
  }
  if (hostname === "0.0.0.0" || hostname === "[::1]" || hostname === "[::]") {
    return false;
  }
  return !/^127\.\d+\.\d+\.\d+$/.test(hostname);
}
