import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateUp } from "../db/migrate.js";
import { fakeApk } from "./helpers/multipart.js";
import { seedRelease } from "./helpers/seed-release.js";
import { createTestApp, type TestApp } from "./helpers/test-app.js";
import { createTestPool, resetDatabase } from "./helpers/test-database.js";

let pool: Pool;
let testApp: TestApp;

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
  testApp = await createTestApp(pool);
});

afterEach(async () => {
  await testApp.close();
});

function download(id: string) {
  return testApp.app.inject({ method: "GET", url: `/api/apks/download/${id}` });
}

describe("GET /api/apks/download/:id", () => {
  it("streams the stored file with APK headers", async () => {
    const { release, content } = await seedRelease(pool, testApp.uploadDir, {
      versionCode: 3,
      fileName: "app-debug.apk",
      content: fakeApk(8192),
    });

    const response = await download(String(release.id));

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/vnd.android.package-archive");
    expect(response.headers["content-length"]).toBe(String(content.length));
    expect(response.headers["content-disposition"]).toBe(
      "attachment; filename=\"app-debug.apk\"; filename*=UTF-8''app-debug.apk",
    );
    expect(response.rawPayload.equals(content)).toBe(true);
  });

  it("serves the file belonging to the requested id", async () => {
    const first = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });
    const second = await seedRelease(pool, testApp.uploadDir, { versionCode: 2 });

    const response = await download(String(first.release.id));

    expect(response.rawPayload.equals(first.content)).toBe(true);
    expect(response.rawPayload.equals(second.content)).toBe(false);
  });

  it("keeps unusual characters in the original file name out of the header syntax", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, {
      versionCode: 1,
      fileName: 'my "app" çğ.apk',
    });

    const response = await download(String(release.id));

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toBe(
      "attachment; filename=\"my _app_ __.apk\"; filename*=UTF-8''my%20%22app%22%20%C3%A7%C4%9F.apk",
    );
  });

  it("returns 404 when no release has that id", async () => {
    const response = await download("42");

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      success: false,
      error: { code: "release_not_found", message: "Release 42 not found" },
    });
  });

  it.each(["abc", "0", "-1", "1.5", "1e3", "99999999999"])("rejects id=%j with 400", async (id) => {
    const response = await download(id);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "validation_error" },
    });
  });

  it("returns a clear error when the row exists but the file is gone", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });
    await rm(join(testApp.uploadDir, release.filePath));

    const response = await download(String(release.id));

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      success: false,
      error: {
        code: "apk_file_missing",
        message: `The file for release ${release.id} is no longer on the server`,
      },
    });
    expect(response.body).not.toContain(testApp.uploadDir);
  });
});
