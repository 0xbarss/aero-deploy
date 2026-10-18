import { DatabaseError, type Pool } from "pg";
import { ConflictError } from "../errors.js";
import { appNameCandidates, type AppNameSource } from "./app-naming.js";

export interface App {
  id: number;
  name: string;
  packageName: string | null;
}

interface AppRow {
  id: number;
  name: string;
  package_name: string | null;
}

function toApp(row: AppRow): App {
  return { id: row.id, name: row.name, packageName: row.package_name };
}

/**
 * Counts the apps that have at least one release. The default app, which exists from the first
 * migration, does not count until it holds one, so a single real app stays unambiguous.
 */
export async function countAppsWithReleases(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(DISTINCT app_id) FROM apk_releases",
  );
  return Number(result.rows[0]?.count);
}

async function findAppByPackage(pool: Pool, packageName: string): Promise<App | undefined> {
  const result = await pool.query<AppRow>(
    "SELECT id, name, package_name FROM apps WHERE package_name = $1",
    [packageName],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : toApp(row);
}

/**
 * Returns the app with the APK's package name, creating it when it does not exist. A new app
 * takes the first free name from appNameCandidates. Each insert is one statement, so two uploads
 * of a new package racing each other end up with the same app instead of an error.
 */
export async function findOrCreateAppByPackage(pool: Pool, source: AppNameSource): Promise<App> {
  const existing = await findAppByPackage(pool, source.packageName);
  if (existing !== undefined) {
    return existing;
  }

  for (const name of appNameCandidates(source)) {
    const created = await pool.query<AppRow>(
      `INSERT INTO apps (name, package_name) VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING id, name, package_name`,
      [name, source.packageName],
    );
    const row = created.rows[0];
    if (row !== undefined) {
      return toApp(row);
    }
    // Nothing was inserted: either another upload created this package first, or the name is taken
    const raced = await findAppByPackage(pool, source.packageName);
    if (raced !== undefined) {
      return raced;
    }
  }
  throw new ConflictError(
    "app_name_exists",
    `No free app name was found for package ${source.packageName}`,
  );
}

const UNIQUE_VIOLATION = "23505";

/** An app as the apps API shows it. */
export interface AppDetails extends App {
  createdAt: Date;
}

export interface LatestReleaseSummary {
  id: number;
  versionName: string;
  versionCode: number;
  fileSize: number;
  sha256: string | null;
  createdAt: Date;
}

export interface AppWithLatestRelease extends AppDetails {
  latestRelease: LatestReleaseSummary | null;
}

interface AppWithLatestReleaseRow extends AppRow {
  created_at: Date;
  release_id: number | null;
  version_name: string | null;
  version_code: number | null;
  file_size: string | null;
  sha256: string | null;
  release_created_at: Date | null;
}

function toLatestRelease(row: AppWithLatestReleaseRow): LatestReleaseSummary | null {
  if (
    row.release_id === null ||
    row.version_name === null ||
    row.version_code === null ||
    row.file_size === null ||
    row.release_created_at === null
  ) {
    return null;
  }
  return {
    id: row.release_id,
    versionName: row.version_name,
    versionCode: row.version_code,
    // BIGINT arrives as a string; APK sizes stay far below Number.MAX_SAFE_INTEGER
    fileSize: Number(row.file_size),
    sha256: row.sha256,
    createdAt: row.release_created_at,
  };
}

/** Every app in id order, each with its release that has the highest version code. */
export async function listAppsWithLatestRelease(pool: Pool): Promise<AppWithLatestRelease[]> {
  const result = await pool.query<AppWithLatestReleaseRow>(
    `SELECT a.id, a.name, a.package_name, a.created_at,
            r.id AS release_id, r.version_name, r.version_code, r.file_size, r.sha256,
            r.created_at AS release_created_at
       FROM apps a
       LEFT JOIN LATERAL (
         SELECT * FROM apk_releases WHERE app_id = a.id
          ORDER BY version_code DESC, id DESC LIMIT 1
       ) r ON true
      ORDER BY a.id`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    packageName: row.package_name,
    createdAt: row.created_at,
    latestRelease: toLatestRelease(row),
  }));
}

/** Renames an app; undefined when it does not exist. App names are unique ignoring case. */
export async function renameApp(
  pool: Pool,
  id: number,
  name: string,
): Promise<AppDetails | undefined> {
  try {
    const result = await pool.query<AppRow & { created_at: Date }>(
      "UPDATE apps SET name = $2 WHERE id = $1 RETURNING id, name, package_name, created_at",
      [id, name],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : { id: row.id, name: row.name, packageName: row.package_name, createdAt: row.created_at };
  } catch (error) {
    if (error instanceof DatabaseError && error.code === UNIQUE_VIOLATION) {
      throw new ConflictError("app_name_exists", `An app named "${name}" already exists`, {
        cause: error,
      });
    }
    throw error;
  }
}
