const SIZE_UNITS = ["KB", "MB", "GB", "TB"];

/** Same rounding and unit names as the size string in the upload response. */
export function formatFileSize(bytes: number): string {
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
export function shortHash(sha256: string | null): string | null {
  return sha256 === null ? null : sha256.slice(0, 12);
}

/** Ids of the releases to badge as "Latest", as GET /api/apps reports them. */
export function latestReleaseIds(apps: { latestRelease: { id: number } | null }[]): Set<number> {
  const ids = new Set<number>();
  for (const app of apps) {
    if (app.latestRelease !== null) {
      ids.add(app.latestRelease.id);
    }
  }
  return ids;
}

/** Apps worth offering in the filter: those with at least one release, sorted by name. */
export function filterableApps<T extends { name: string; latestRelease: unknown }>(apps: T[]): T[] {
  return apps
    .filter((app) => app.latestRelease !== null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * The release that becomes the latest once `releaseId` is gone: the highest version code among
 * the others, or null when there is none.
 */
export function successorOf<T extends { id: number; versionCode: number }>(
  releaseId: number,
  releases: T[],
): T | null {
  let best: T | null = null;
  for (const release of releases) {
    if (release.id !== releaseId && (best === null || release.versionCode > best.versionCode)) {
      best = release;
    }
  }
  return best;
}

/** Whether the text typed to confirm a delete is the release's version name. */
export function matchesVersionName(typed: string, versionName: string): boolean {
  return versionName !== "" && typed.trim() === versionName;
}

/**
 * What the delete confirmation says about the latest release, or null when the release being
 * deleted is not the latest.
 */
export function confirmationNote(
  appName: string,
  isLatest: boolean,
  successor: { versionName: string; versionCode: number } | null,
): string | null {
  if (!isLatest) {
    return null;
  }
  if (successor === null) {
    return `${appName} will have no releases left.`;
  }
  return `${successor.versionName} (${successor.versionCode}) will become the latest release of ${appName}.`;
}

/** How many builds the install desk offers at once. */
export const DESK_TARGETS = 4;

/** The builds the install desk offers, in the order the ledger lists them. */
export function deskTargets<T>(releases: readonly T[], limit: number = DESK_TARGETS): T[] {
  return releases.slice(0, limit);
}

/**
 * The build the install desk shows: the one that was picked, or the first one it knows about when
 * that one was deleted or filtered away.
 */
export function pickDeskTarget<T extends { id: number }>(
  targets: readonly T[],
  selectedId: number | null,
): T | null {
  if (targets.length === 0) {
    return null;
  }
  const picked = targets.find((release) => release.id === selectedId);
  return picked ?? targets[0] ?? null;
}

/** The command that fetches a release file to the machine it runs on. */
export function installCommand(url: string): string {
  return `curl -OJ ${url}`;
}

/** The host an install link points at, or null when the link cannot be read. */
export function installHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Whether a typed app name is worth sending: not blank and not the name the app already has. */
export function isRenameChange(typed: string, currentName: string): boolean {
  const name = typed.trim();
  return name !== "" && name !== currentName;
}

/** Whether a file name looks like an APK; the server still checks the content. */
export function isApkFileName(name: string): boolean {
  return /^.+\.apk$/i.test(name.trim());
}

/** What the upload response says was detected in the APK. */
export function uploadSummary(data: {
  appName: string;
  versionName: string;
  versionCode: number;
  fileSize: number;
}): string {
  return `Uploaded ${data.appName} ${data.versionName} (${data.versionCode}), ${formatFileSize(data.fileSize)}.`;
}

/**
 * The label of the upload progress bar.
 * @param loaded bytes sent so far
 * @param total bytes to send, or 0 when unknown
 */
export function progressLabel(loaded: number, total: number): string {
  if (!(total > 0)) {
    return "Uploading…";
  }
  if (loaded >= total) {
    return "Processing on the server…";
  }
  return `Uploading… ${Math.floor((loaded / total) * 100)}%`;
}

/**
 * Whether a host name is one that only this machine can reach. A phone would resolve it to
 * itself, so a link that uses it is of no use on another device.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (host === "0.0.0.0" || host === "[::1]" || host === "[::]") {
    return true;
  }
  return /^127\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * The link to hand to a phone.
 *
 * A link built from the address the dashboard was opened with points at the server only when
 * that address is reachable from another device. When it is not, the same link is rebuilt on
 * one of the server's own network addresses, so a phone on the same network can follow it.
 */
export function phoneUrl(url: string, addresses: string[]): { url: string; rewritten: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, rewritten: false };
  }
  if (!isLoopbackHost(parsed.hostname) || addresses.length === 0) {
    return { url, rewritten: false };
  }
  const address = addresses[0];
  if (address === undefined) {
    return { url, rewritten: false };
  }
  parsed.hostname = address;
  return { url: parsed.toString(), rewritten: true };
}

/** The address a phone on the same network can use, if the page was opened on a local one. */
export function shareableOrigin(origin: string, addresses: string[]): string {
  const rewritten = phoneUrl(origin, addresses);
  return rewritten.rewritten ? new URL(rewritten.url).origin : origin;
}

/** The address a phone on the same network can use to reach this server. */
export function lanOrigin(): string {
  return window.location.origin;
}

/** The date and time of a release, in the reader's own locale. */
export function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/** The date of a release, without the time of day. */
export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}

/** How long ago a release was uploaded, in a compact form. */
export function formatRelative(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.35, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let value = seconds;
  for (const [size, unit] of units) {
    if (Math.abs(value) < size) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
        -Math.round(value),
        unit,
      );
    }
    value /= size;
  }
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    -Math.round(value),
    "year",
  );
}

/** Copies text to the clipboard, falling back to a hidden field on plain HTTP on the LAN. */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    const copied = await navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
    if (copied) {
      return true;
    }
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.className = "offscreen";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

/**
 * Asks the server for the file and drops the answer as soon as the headers arrive, so a missing
 * file can be reported before the browser starts a download.
 */
export async function probeDownload(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetchFn(url, { method: "GET" });
  } catch {
    throw new Error("Cannot reach the server. Check that it is running, then try again.");
  }
  if (response.ok) {
    await response.body?.cancel();
    return { ok: true };
  }
  const body: unknown = await response.json().catch(() => null);
  return { ok: false, status: response.status, body };
}
