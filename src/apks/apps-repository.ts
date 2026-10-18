import type { Pool } from "pg";

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

/** The default app is the one without a package name; the migrations always create it. */
export async function findDefaultApp(pool: Pool): Promise<App> {
  const result = await pool.query<AppRow>(
    "SELECT id, name, package_name FROM apps WHERE package_name IS NULL",
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("the default app is missing; run the database migrations");
  }
  return { id: row.id, name: row.name, packageName: row.package_name };
}

export async function countApps(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>("SELECT count(*) FROM apps");
  return Number(result.rows[0]?.count);
}
