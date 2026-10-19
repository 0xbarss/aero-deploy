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
