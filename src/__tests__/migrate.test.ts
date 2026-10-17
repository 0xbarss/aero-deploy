import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MigrationError, migrateDown, migrateUp } from "../db/migrate.js";
import { createTestPool, resetDatabase } from "./helpers/test-database.js";

let pool: Pool;

beforeAll(() => {
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDatabase(pool);
});

async function tableExists(name: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`public.${name}`],
  );
  return result.rows[0]?.exists ?? false;
}

describe("migration runner", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aero-migrations-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function addMigration(name: string, up: string, down: string | null): Promise<void> {
    await writeFile(join(dir, `${name}.up.sql`), up);
    if (down !== null) {
      await writeFile(join(dir, `${name}.down.sql`), down);
    }
  }

  it("applies pending migrations in name order and records them", async () => {
    await addMigration("20260102000000_create_b", "CREATE TABLE b (id INT);", "DROP TABLE b;");
    await addMigration("20260101000000_create_a", "CREATE TABLE a (id INT);", "DROP TABLE a;");

    const applied = await migrateUp(pool, dir);

    expect(applied).toEqual(["20260101000000_create_a", "20260102000000_create_b"]);
    expect(await tableExists("a")).toBe(true);
    expect(await tableExists("b")).toBe(true);
    const recorded = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    expect(recorded.rows.map((row) => row.name)).toEqual(applied);
  });

  it("applies nothing on a second run", async () => {
    await addMigration("20260101000000_create_a", "CREATE TABLE a (id INT);", "DROP TABLE a;");

    await migrateUp(pool, dir);

    expect(await migrateUp(pool, dir)).toEqual([]);
  });

  it("reverts only the latest migration", async () => {
    await addMigration("20260101000000_create_a", "CREATE TABLE a (id INT);", "DROP TABLE a;");
    await addMigration("20260102000000_create_b", "CREATE TABLE b (id INT);", "DROP TABLE b;");
    await migrateUp(pool, dir);

    const reverted = await migrateDown(pool, dir);

    expect(reverted).toBe("20260102000000_create_b");
    expect(await tableExists("a")).toBe(true);
    expect(await tableExists("b")).toBe(false);
    expect(await migrateUp(pool, dir)).toEqual(["20260102000000_create_b"]);
  });

  it("returns null when there is nothing to revert", async () => {
    expect(await migrateDown(pool, dir)).toBeNull();
  });

  it("rolls back a failing migration and records nothing for it", async () => {
    await addMigration("20260101000000_create_a", "CREATE TABLE a (id INT);", "DROP TABLE a;");
    await addMigration(
      "20260102000000_broken",
      "CREATE TABLE c (id INT); SELECT * FROM missing_table;",
      "DROP TABLE c;",
    );

    await expect(migrateUp(pool, dir)).rejects.toThrow(MigrationError);

    expect(await tableExists("a")).toBe(true);
    expect(await tableExists("c")).toBe(false);
    const recorded = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
    expect(recorded.rows.map((row) => row.name)).toEqual(["20260101000000_create_a"]);
  });

  it("names the failing migration in the error", async () => {
    await addMigration("20260102000000_broken", "SELECT * FROM missing_table;", "SELECT 1;");

    await expect(migrateUp(pool, dir)).rejects.toMatchObject({
      name: "MigrationError",
      migration: "20260102000000_broken",
    });
  });

  it("refuses to apply anything when an up file has no down file", async () => {
    await addMigration("20260101000000_create_a", "CREATE TABLE a (id INT);", "DROP TABLE a;");
    await addMigration("20260102000000_create_b", "CREATE TABLE b (id INT);", null);

    await expect(migrateUp(pool, dir)).rejects.toMatchObject({
      name: "MigrationError",
      migration: "20260102000000_create_b",
    });
    expect(await tableExists("a")).toBe(false);
  });
});

describe("apk_releases migration", () => {
  it("creates the table with the columns from the proposal", async () => {
    await migrateUp(pool);

    const columns = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'apk_releases'
        ORDER BY ordinal_position`,
    );

    expect(columns.rows).toEqual([
      { column_name: "id", data_type: "integer", is_nullable: "NO" },
      { column_name: "version_name", data_type: "character varying", is_nullable: "NO" },
      { column_name: "version_code", data_type: "integer", is_nullable: "NO" },
      { column_name: "file_name", data_type: "character varying", is_nullable: "NO" },
      { column_name: "file_path", data_type: "character varying", is_nullable: "NO" },
      { column_name: "file_size", data_type: "bigint", is_nullable: "NO" },
      { column_name: "release_notes", data_type: "text", is_nullable: "YES" },
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
    ]);
  });

  it("assigns ids and created_at automatically", async () => {
    await migrateUp(pool);

    const inserted = await pool.query<{ id: number; created_at: Date }>(
      `INSERT INTO apk_releases (version_name, version_code, file_name, file_path, file_size)
       VALUES ('1.0.0', 1, 'app.apk', 'uploads/app.apk', 1024)
       RETURNING id, created_at`,
    );

    expect(inserted.rows[0]?.id).toBe(1);
    expect(inserted.rows[0]?.created_at).toBeInstanceOf(Date);
  });

  it("rejects a duplicate version_code", async () => {
    await migrateUp(pool);
    const insert = `INSERT INTO apk_releases (version_name, version_code, file_name, file_path, file_size)
                    VALUES ($1, 7, 'app.apk', $2, 1024)`;
    await pool.query(insert, ["1.0.0", "uploads/a.apk"]);

    await expect(pool.query(insert, ["1.0.1", "uploads/b.apk"])).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("is removed by the down migration", async () => {
    await migrateUp(pool);

    await migrateDown(pool);

    expect(await tableExists("apk_releases")).toBe(false);
  });
});
