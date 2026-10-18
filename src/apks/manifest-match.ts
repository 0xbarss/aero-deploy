import { InvalidApkError, ManifestMismatchError } from "../errors.js";
import type { ApkManifestInfo } from "./apk-manifest.js";

// Matches the length of apk_releases.version_name
const MAX_VERSION_NAME_LENGTH = 50;

export interface ClaimedIdentity {
  versionName: string | null;
  versionCode: number | null;
  packageName: string | null;
}

/**
 * The version name to store: the manifest's, or its version code as text when the manifest has
 * none. Throws InvalidApkError when it would not fit the column.
 */
export function effectiveVersionName(info: ApkManifestInfo): string {
  const name = info.versionName ?? String(info.versionCode);
  if (name.includes("\u0000") || Array.from(name).length > MAX_VERSION_NAME_LENGTH) {
    throw new InvalidApkError(
      `Manifest versionName must be at most ${MAX_VERSION_NAME_LENGTH} characters and contain no NUL bytes`,
    );
  }
  return name;
}

/** Throws ManifestMismatchError when a field the client sent disagrees with the APK itself. */
export function assertFieldsMatchManifest(claimed: ClaimedIdentity, info: ApkManifestInfo): void {
  const differences: string[] = [];
  if (claimed.versionName !== null && claimed.versionName !== effectiveVersionName(info)) {
    differences.push(
      `versionName is "${claimed.versionName}" but the APK declares "${effectiveVersionName(info)}"`,
    );
  }
  if (claimed.versionCode !== null && claimed.versionCode !== info.versionCode) {
    differences.push(
      `versionCode is ${claimed.versionCode} but the APK declares ${info.versionCode}`,
    );
  }
  if (claimed.packageName !== null && claimed.packageName !== info.packageName) {
    differences.push(
      `packageName is "${claimed.packageName}" but the APK declares "${info.packageName}"`,
    );
  }
  if (differences.length > 0) {
    throw new ManifestMismatchError(`Fields do not match the APK: ${differences.join("; ")}`);
  }
}
