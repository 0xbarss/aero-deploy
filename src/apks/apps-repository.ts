import type { Pool } from "pg";
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
