import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

const UP_SUFFIX = ".up.sql";
const DOWN_SUFFIX = ".down.sql";

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly migration: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MigrationError";
  }
}

async function listMigrations(dir: string): Promise<string[]> {
  const files = await readdir(dir);
  const names = files
    .filter((file) => file.endsWith(UP_SUFFIX))
    .map((file) => file.slice(0, -UP_SUFFIX.length))
    .sort();
  for (const name of names) {
    if (!files.includes(`${name}${DOWN_SUFFIX}`)) {
      throw new MigrationError(`${name} has no ${name}${DOWN_SUFFIX} file`, name);
    }
  }
  return names;
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
}

async function runInTransaction(
  pool: Pool,
  name: string,
  sql: string,
  bookkeepingSql: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(bookkeepingSql, [name]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    const reason = error instanceof Error ? error.message : String(error);
    throw new MigrationError(`migration ${name} failed: ${reason}`, name, { cause: error });
  } finally {
    client.release();
  }
}

/** Applies pending migrations in name order, one transaction each, and returns their names. */
export async function migrateUp(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const names = await listMigrations(dir);
  await ensureMigrationsTable(pool);
  const applied = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const appliedNames = new Set(applied.rows.map((row) => row.name));
  const pending = names.filter((name) => !appliedNames.has(name));

  for (const name of pending) {
    const sql = await readFile(`${dir}/${name}${UP_SUFFIX}`, "utf8");
    await runInTransaction(pool, name, sql, "INSERT INTO schema_migrations (name) VALUES ($1)");
  }
  return pending;
}

/** Reverts the most recently applied migration and returns its name, or null if none applied. */
export async function migrateDown(pool: Pool, dir = MIGRATIONS_DIR): Promise<string | null> {
  await ensureMigrationsTable(pool);
  const latest = await pool.query<{ name: string }>(
    "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1",
  );
  const name = latest.rows[0]?.name;
  if (name === undefined) {
    return null;
  }

  let sql: string;
  try {
    sql = await readFile(`${dir}/${name}${DOWN_SUFFIX}`, "utf8");
  } catch (error) {
    throw new MigrationError(`cannot read ${name}${DOWN_SUFFIX}`, name, { cause: error });
  }
  await runInTransaction(pool, name, sql, "DELETE FROM schema_migrations WHERE name = $1");
  return name;
}
