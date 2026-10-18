import type { Pool } from "pg";
import { loadDatabaseUrl } from "../../config.js";
import { createPool } from "../../db/pool.js";

export function createTestPool(): Pool {
  const url = loadDatabaseUrl(process.env, "TEST_DATABASE_URL");
  return createPool(url, (error) => {
    throw error;
  });
}

/** Wipes everything in the public schema. Only call this with a pool from `createTestPool`. */
export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

/** Empties the releases and removes every app except the default one. */
export async function clearReleasesAndExtraApps(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE apk_releases RESTART IDENTITY");
  await pool.query("DELETE FROM apps WHERE package_name IS NOT NULL");
}
