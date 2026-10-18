import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { backfillSha256, run } from "../../scripts/backfill-sha256.js";
import { findReleaseById, findReleasesWithoutHash, setReleaseHash } from "../apks/repository.js";
import { fakeApk } from "./helpers/multipart.js";
import { defaultAppId, seedRelease, sha256Hex } from "./helpers/seed-release.js";
import { createTestPool, resetDatabase } from "./helpers/test-database.js";
import { migrateUp } from "../db/migrate.js";

let pool: Pool;
let uploadDir: string;

beforeAll(async () => {
  pool = createTestPool();
  await resetDatabase(pool);
  await migrateUp(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE apk_releases RESTART IDENTITY");
  uploadDir = await mkdtemp(join(tmpdir(), "aero-backfill-"));
});

afterEach(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

function collectIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (line: string) => out.push(line), stderr: (line: string) => err.push(line) },
    stdout: () => out.join("\n"),
    stderr: () => err.join("\n"),
  };
}

async function storedHash(id: number): Promise<string | null | undefined> {
  return (await findReleaseById(pool, id))?.sha256;
}

describe("release hash queries", () => {
  it("lists only releases without a hash, lowest id first", async () => {
    const first = await seedRelease(pool, uploadDir, { versionCode: 1, sha256: null });
    await seedRelease(pool, uploadDir, { versionCode: 2 });
    const third = await seedRelease(pool, uploadDir, { versionCode: 3, sha256: null });

    const pending = await findReleasesWithoutHash(pool);

    expect(pending.map((release) => release.id)).toEqual([first.release.id, third.release.id]);
  });

  it("stores a hash on a release that has none", async () => {
    const { release } = await seedRelease(pool, uploadDir, { versionCode: 1, sha256: null });
    const hash = sha256Hex(Buffer.from("x"));

    expect(await setReleaseHash(pool, release.id, hash)).toBe(true);

    expect(await storedHash(release.id)).toBe(hash);
  });

  it("does not overwrite a hash that is already stored", async () => {
    const { release, content } = await seedRelease(pool, uploadDir, { versionCode: 1 });

    expect(await setReleaseHash(pool, release.id, sha256Hex(Buffer.from("other")))).toBe(false);

    expect(await storedHash(release.id)).toBe(sha256Hex(content));
  });

  it("returns false for an unknown release", async () => {
    expect(await setReleaseHash(pool, 999, sha256Hex(Buffer.from("x")))).toBe(false);
  });
});

describe("backfillSha256", () => {
  it("stores the SHA-256 of each file for releases without a hash", async () => {
    const a = await seedRelease(pool, uploadDir, { versionCode: 1, sha256: null });
    const b = await seedRelease(pool, uploadDir, { versionCode: 2, sha256: null });
    const output = collectIo();

    const summary = await backfillSha256(pool, uploadDir, output.io);

    expect(summary).toEqual({ hashed: 2, skipped: 0 });
    expect(await storedHash(a.release.id)).toBe(sha256Hex(a.content));
    expect(await storedHash(b.release.id)).toBe(sha256Hex(b.content));
    expect(output.stdout()).toContain(sha256Hex(a.content));
    expect(output.stdout()).toContain(`release ${b.release.id}`);
    expect(output.stderr()).toBe("");
  });

  it("hashes a file larger than one read chunk correctly", async () => {
    const content = Buffer.concat([fakeApk(0), randomBytes(5 * 1024 * 1024)]);
    const { release } = await seedRelease(pool, uploadDir, {
      versionCode: 1,
      content,
      sha256: null,
    });

    await backfillSha256(pool, uploadDir, collectIo().io);

    expect(await storedHash(release.id)).toBe(sha256Hex(content));
  });

  it("leaves releases that already have a hash alone, without opening their files", async () => {
    const { release } = await seedRelease(pool, uploadDir, { versionCode: 1 });
    await rm(join(uploadDir, release.filePath));
    const output = collectIo();

    const summary = await backfillSha256(pool, uploadDir, output.io);

    expect(summary).toEqual({ hashed: 0, skipped: 0 });
    expect(output.stderr()).toBe("");
    expect(output.stdout()).toContain("No releases without a checksum");
  });

  it("does nothing on a second run", async () => {
    await seedRelease(pool, uploadDir, { versionCode: 1, sha256: null });
    await backfillSha256(pool, uploadDir, collectIo().io);

    expect(await backfillSha256(pool, uploadDir, collectIo().io)).toEqual({
      hashed: 0,
      skipped: 0,
    });
  });

  it("skips a release whose file is missing and still hashes the others", async () => {
    const missing = await seedRelease(pool, uploadDir, { versionCode: 1, sha256: null });
    const present = await seedRelease(pool, uploadDir, { versionCode: 2, sha256: null });
    await rm(join(uploadDir, missing.release.filePath));
    const output = collectIo();

    const summary = await backfillSha256(pool, uploadDir, output.io);

    expect(summary).toEqual({ hashed: 1, skipped: 1 });
    expect(await storedHash(missing.release.id)).toBeNull();
    expect(await storedHash(present.release.id)).toBe(sha256Hex(present.content));
    expect(output.stderr()).toContain(`release ${missing.release.id}`);
    expect(output.stderr()).toContain("file not found");
  });

  it("skips a release whose file size differs from the recorded size", async () => {
    const { release } = await seedRelease(pool, uploadDir, { versionCode: 1, sha256: null });
    await writeFile(join(uploadDir, release.filePath), fakeApk(10));
    const output = collectIo();

    const summary = await backfillSha256(pool, uploadDir, output.io);

    expect(summary).toEqual({ hashed: 0, skipped: 1 });
    expect(await storedHash(release.id)).toBeNull();
    expect(output.stderr()).toContain("size");
  });

  it("skips a release whose path points at a directory", async () => {
    const { release } = await seedRelease(pool, uploadDir, { versionCode: 1, sha256: null });
    await rm(join(uploadDir, release.filePath));
    await mkdir(join(uploadDir, release.filePath));
    const output = collectIo();

    const summary = await backfillSha256(pool, uploadDir, output.io);

    expect(summary).toEqual({ hashed: 0, skipped: 1 });
    expect(output.stderr()).toContain("not a file");
  });

  it("skips a release whose stored path leaves the upload directory", async () => {
    const outside = await mkdtemp(join(tmpdir(), "aero-outside-"));
    try {
      const content = fakeApk(64);
      await writeFile(join(outside, "secret.apk"), content);
      const appId = await defaultAppId(pool);
      await pool.query(
        `INSERT INTO apk_releases (app_id, version_name, version_code, file_name, file_path, file_size)
         VALUES ($1, '1.0.0', 1, 'x.apk', $2, $3)`,
        [appId, `../${outside.split("/").pop() ?? ""}/secret.apk`, content.length],
      );
      const output = collectIo();

      const summary = await backfillSha256(pool, uploadDir, output.io);

      expect(summary).toEqual({ hashed: 0, skipped: 1 });
      expect(output.stderr()).toContain("outside the upload directory");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("backfill-sha256 command", () => {
  function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      UPLOAD_DIR: uploadDir,
      ...overrides,
    };
  }

  it("hashes pending releases from UPLOAD_DIR and exits 0", async () => {
    const { release, content } = await seedRelease(pool, uploadDir, {
      versionCode: 1,
      sha256: null,
    });
    const output = collectIo();

    const code = await run([], env(), output.io);

    expect(code).toBe(0);
    expect(await storedHash(release.id)).toBe(sha256Hex(content));
    expect(output.stdout()).toContain("Hashed: 1, skipped: 0");
  });

  it("exits 0 and says so when nothing needs a hash", async () => {
    const output = collectIo();

    expect(await run([], env(), output.io)).toBe(0);
    expect(output.stdout()).toContain("No releases without a checksum");
  });

  it("exits 1 when a release had to be skipped", async () => {
    const { release } = await seedRelease(pool, uploadDir, { versionCode: 1, sha256: null });
    await rm(join(uploadDir, release.filePath));
    const output = collectIo();

    expect(await run([], env(), output.io)).toBe(1);
    expect(output.stdout()).toContain("Hashed: 0, skipped: 1");
    expect(output.stderr()).toContain(`release ${release.id}`);
  });

  it("prints the usage text and exits 0 for --help", async () => {
    const output = collectIo();

    expect(await run(["--help"], {}, output.io)).toBe(0);
    expect(output.stdout()).toContain("Usage:");
    expect(output.stderr()).toBe("");
  });

  it.each([["--bogus"], ["extra-argument"]])("exits 2 with the usage text for %s", async (arg) => {
    const output = collectIo();

    expect(await run([arg], env(), output.io)).toBe(2);
    expect(output.stderr()).toContain("Usage:");
  });

  it("exits 1 when DATABASE_URL is not set", async () => {
    const output = collectIo();

    expect(await run([], { UPLOAD_DIR: uploadDir }, output.io)).toBe(1);
    expect(output.stderr()).toContain("DATABASE_URL is required");
  });

  it("exits 1 without printing the database password when the database is unreachable", async () => {
    const output = collectIo();

    const code = await run(
      [],
      env({ DATABASE_URL: "postgres://aerodeploy:hunter2-secret@127.0.0.1:1/aerodeploy" }),
      output.io,
    );

    expect(code).toBe(1);
    expect(output.stderr()).not.toContain("hunter2-secret");
    expect(output.stderr()).toContain("ECONNREFUSED");
  });
});
