import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, MigrationError, migrateDown, migrateUp } from "../db/migrate.js";
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

const CREATE_RELEASES = "20261017120000_create_apk_releases";
const ADD_SHA256 = "20261018100000_add_sha256_to_apk_releases";
const CREATE_APPS = "20261018100100_create_apps";
const ADD_APP_ID = "20261018100200_add_app_id_to_apk_releases";

const INSERT_DEFAULT_RELEASE = `INSERT INTO apk_releases
    (app_id, version_name, version_code, file_name, file_path, file_size)
  VALUES ((SELECT id FROM apps WHERE package_name IS NULL), $1, $2, 'app.apk', $3, 1024)`;

async function revertAll(): Promise<void> {
  while ((await migrateDown(pool)) !== null) {
    // keep reverting until nothing is left
  }
}

/** Copies the real migrations up to and including `lastName` into a temporary directory. */
async function copyMigrationsUpTo(dest: string, lastName: string): Promise<void> {
  const timestamp = (name: string): string => name.slice(0, 14);
  for (const file of await readdir(MIGRATIONS_DIR)) {
    if (timestamp(file) <= timestamp(lastName)) {
      await copyFile(join(MIGRATIONS_DIR, file), join(dest, file));
    }
  }
}

describe("apk_releases migrations", () => {
  it("applies the release, checksum, app and app link migrations in order", async () => {
    expect(await migrateUp(pool)).toEqual([CREATE_RELEASES, ADD_SHA256, CREATE_APPS, ADD_APP_ID]);
  });

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
      { column_name: "sha256", data_type: "character", is_nullable: "YES" },
      { column_name: "app_id", data_type: "integer", is_nullable: "NO" },
    ]);
  });

  it("assigns ids and created_at automatically", async () => {
    await migrateUp(pool);

    const inserted = await pool.query<{ id: number; created_at: Date }>(
      `${INSERT_DEFAULT_RELEASE} RETURNING id, created_at`,
      ["1.0.0", 1, "uploads/app.apk"],
    );

    expect(inserted.rows[0]?.id).toBe(1);
    expect(inserted.rows[0]?.created_at).toBeInstanceOf(Date);
  });

  it("stores a 64 character hash and accepts a missing one", async () => {
    await migrateUp(pool);
    const hash = "a".repeat(64);
    const insert = `INSERT INTO apk_releases
        (app_id, version_name, version_code, file_name, file_path, file_size, sha256)
      VALUES ((SELECT id FROM apps WHERE package_name IS NULL), '1.0.0', $1, 'a.apk', 'a', 1, $2)`;

    await pool.query(insert, [1, hash]);
    await pool.query(insert, [2, null]);

    const rows = await pool.query<{ sha256: string | null }>(
      "SELECT sha256 FROM apk_releases ORDER BY version_code",
    );
    expect(rows.rows.map((row) => row.sha256)).toEqual([hash, null]);
  });

  it("rejects a hash longer than 64 characters", async () => {
    await migrateUp(pool);

    await expect(
      pool.query(
        `INSERT INTO apk_releases
           (app_id, version_name, version_code, file_name, file_path, file_size, sha256)
         VALUES ((SELECT id FROM apps WHERE package_name IS NULL), '1.0.0', 1, 'a.apk', 'a', 1, $1)`,
        ["a".repeat(65)],
      ),
    ).rejects.toMatchObject({ code: "22001" });
  });

  it("rejects a duplicate version_code within one app", async () => {
    await migrateUp(pool);
    await pool.query(INSERT_DEFAULT_RELEASE, ["1.0.0", 7, "uploads/a.apk"]);

    await expect(
      pool.query(INSERT_DEFAULT_RELEASE, ["1.0.1", 7, "uploads/b.apk"]),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("allows the same version_code in different apps", async () => {
    await migrateUp(pool);
    await pool.query("INSERT INTO apps (name, package_name) VALUES ('Shop', 'com.example.shop')");
    await pool.query(INSERT_DEFAULT_RELEASE, ["1.0.0", 1, "uploads/a.apk"]);

    await pool.query(
      `INSERT INTO apk_releases (app_id, version_name, version_code, file_name, file_path, file_size)
       VALUES ((SELECT id FROM apps WHERE package_name = 'com.example.shop'), '1.0.0', 1, 'b.apk', 'b', 1)`,
    );

    const count = await pool.query<{ count: string }>("SELECT count(*) FROM apk_releases");
    expect(count.rows[0]?.count).toBe("2");
  });

  it("refuses to delete an app that still has releases", async () => {
    await migrateUp(pool);
    await pool.query(INSERT_DEFAULT_RELEASE, ["1.0.0", 1, "uploads/a.apk"]);

    await expect(pool.query("DELETE FROM apps WHERE package_name IS NULL")).rejects.toMatchObject({
      code: "23503",
    });
  });

  it("refuses a release that points at no app", async () => {
    await migrateUp(pool);

    await expect(
      pool.query(
        `INSERT INTO apk_releases (app_id, version_name, version_code, file_name, file_path, file_size)
         VALUES (9999, '1.0.0', 1, 'a.apk', 'a', 1)`,
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("is removed once every migration is reverted", async () => {
    await migrateUp(pool);

    await revertAll();

    expect(await tableExists("apk_releases")).toBe(false);
    expect(await tableExists("apps")).toBe(false);
  });
});

describe("apps migration", () => {
  it("creates one default app without a package name", async () => {
    await migrateUp(pool);

    const apps = await pool.query<{ name: string; package_name: string | null }>(
      "SELECT name, package_name FROM apps",
    );

    expect(apps.rows).toEqual([{ name: "Default App", package_name: null }]);
  });

  it("assigns ids and created_at automatically", async () => {
    await migrateUp(pool);

    const inserted = await pool.query<{ id: number; created_at: Date }>(
      "INSERT INTO apps (name, package_name) VALUES ('Shop', 'com.example.shop') RETURNING id, created_at",
    );

    expect(inserted.rows[0]?.id).toBeGreaterThan(1);
    expect(inserted.rows[0]?.created_at).toBeInstanceOf(Date);
  });

  it("rejects a duplicate package name", async () => {
    await migrateUp(pool);
    const insert = "INSERT INTO apps (name, package_name) VALUES ($1, 'com.example.shop')";
    await pool.query(insert, ["Shop"]);

    await expect(pool.query(insert, ["Other"])).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects a name that differs only in letter case", async () => {
    await migrateUp(pool);
    await pool.query("INSERT INTO apps (name, package_name) VALUES ('My Shop', 'a.b')");

    await expect(
      pool.query("INSERT INTO apps (name, package_name) VALUES ('my shop', 'c.d')"),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("allows only one app without a package name", async () => {
    await migrateUp(pool);

    await expect(pool.query("INSERT INTO apps (name) VALUES ('Second')")).rejects.toMatchObject({
      code: "23505",
    });
  });
});

describe("app link migration with existing releases", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aero-migrations-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seedOldReleases(): Promise<void> {
    await pool.query(
      `INSERT INTO apk_releases (version_name, version_code, file_name, file_path, file_size)
       VALUES ('1.0.0', 1, 'a.apk', 'a', 1), ('1.1.0', 2, 'b.apk', 'b', 2)`,
    );
  }

  it("moves releases that exist before the migration into the default app", async () => {
    await copyMigrationsUpTo(dir, CREATE_APPS);
    await migrateUp(pool, dir);
    await seedOldReleases();

    expect(await migrateUp(pool)).toEqual([ADD_APP_ID]);

    const rows = await pool.query<{ version_code: number; package_name: string | null }>(
      `SELECT r.version_code, a.package_name
         FROM apk_releases r JOIN apps a ON a.id = r.app_id
        ORDER BY r.version_code`,
    );
    expect(rows.rows).toEqual([
      { version_code: 1, package_name: null },
      { version_code: 2, package_name: null },
    ]);
  });

  it("keeps the hash column empty for releases that exist before the migration", async () => {
    await copyMigrationsUpTo(dir, CREATE_RELEASES);
    await migrateUp(pool, dir);
    await seedOldReleases();

    await migrateUp(pool);

    const rows = await pool.query<{ sha256: string | null }>("SELECT sha256 FROM apk_releases");
    expect(rows.rows.map((row) => row.sha256)).toEqual([null, null]);
  });

  it("drops the old version_code constraint even when it has another name", async () => {
    await copyMigrationsUpTo(dir, CREATE_APPS);
    await migrateUp(pool, dir);
    await pool.query(
      "ALTER TABLE apk_releases RENAME CONSTRAINT apk_releases_version_code_key TO renamed_key",
    );

    await migrateUp(pool);

    await pool.query("INSERT INTO apps (name, package_name) VALUES ('Shop', 'com.example.shop')");
    await pool.query(INSERT_DEFAULT_RELEASE, ["1.0.0", 1, "a"]);
    await expect(
      pool.query(
        `INSERT INTO apk_releases (app_id, version_name, version_code, file_name, file_path, file_size)
         VALUES ((SELECT id FROM apps WHERE package_name = 'com.example.shop'), '1.0.0', 1, 'b.apk', 'b', 1)`,
      ),
    ).resolves.toBeDefined();
  });

  it("does not fail when the old constraint is already gone", async () => {
    await copyMigrationsUpTo(dir, CREATE_APPS);
    await migrateUp(pool, dir);
    await pool.query("ALTER TABLE apk_releases DROP CONSTRAINT apk_releases_version_code_key");

    await expect(migrateUp(pool)).resolves.toEqual([ADD_APP_ID]);
  });

  it("restores the global version_code constraint when reverted", async () => {
    await migrateUp(pool);
    await pool.query(INSERT_DEFAULT_RELEASE, ["1.0.0", 1, "a"]);

    expect(await migrateDown(pool)).toBe(ADD_APP_ID);

    const columns = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE column_name = 'app_id' AND table_name = 'apk_releases'",
    );
    expect(columns.rowCount).toBe(0);
    await expect(
      pool.query(
        "INSERT INTO apk_releases (version_name, version_code, file_name, file_path, file_size) VALUES ('1.0.1', 1, 'b.apk', 'b', 1)",
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("refuses to revert while two apps share a version_code and changes nothing", async () => {
    await migrateUp(pool);
    await pool.query("INSERT INTO apps (name, package_name) VALUES ('Shop', 'com.example.shop')");
    await pool.query(INSERT_DEFAULT_RELEASE, ["1.0.0", 1, "a"]);
    await pool.query(
      `INSERT INTO apk_releases (app_id, version_name, version_code, file_name, file_path, file_size)
       VALUES ((SELECT id FROM apps WHERE package_name = 'com.example.shop'), '1.0.0', 1, 'b.apk', 'b', 1)`,
    );

    await expect(migrateDown(pool)).rejects.toMatchObject({
      name: "MigrationError",
      migration: ADD_APP_ID,
    });

    const columns = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE column_name = 'app_id' AND table_name = 'apk_releases'",
    );
    expect(columns.rowCount).toBe(1);
    const recorded = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [
      ADD_APP_ID,
    ]);
    expect(recorded.rowCount).toBe(1);
  });

  it("can be applied again after a revert without a second default app", async () => {
    await migrateUp(pool);
    await migrateDown(pool);

    await migrateUp(pool);

    const apps = await pool.query("SELECT 1 FROM apps");
    expect(apps.rowCount).toBe(1);
  });
});
