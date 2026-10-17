import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateUp } from "../db/migrate.js";
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

describe("GET /api/apks/latest", () => {
  it("returns the release with the highest versionCode", async () => {
    await seedRelease(pool, testApp.uploadDir, { versionCode: 2, versionName: "1.0.1" });
    await seedRelease(pool, testApp.uploadDir, {
      versionCode: 5,
      versionName: "1.2.0",
      releaseNotes: "Bug fixes and performance improvements",
    });
    await seedRelease(pool, testApp.uploadDir, { versionCode: 3, versionName: "1.1.0" });

    const response = await testApp.app.inject({
      method: "GET",
      url: "/api/apks/latest",
      headers: { host: "192.168.1.20:3000" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        id: 2,
        versionName: "1.2.0",
        versionCode: 5,
        releaseNotes: "Bug fixes and performance improvements",
        downloadUrl: "http://192.168.1.20:3000/api/apks/download/2",
      },
    });
  });

  it("returns null release notes when none were given", async () => {
    await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    const response = await testApp.app.inject({ method: "GET", url: "/api/apks/latest" });

    expect(response.json<{ data: { releaseNotes: string | null } }>().data.releaseNotes).toBeNull();
  });

  it("builds downloadUrl from the host the client used", async () => {
    await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    const response = await testApp.app.inject({
      method: "GET",
      url: "/api/apks/latest",
      headers: { host: "build-box.local:8080" },
    });

    expect(response.json<{ data: { downloadUrl: string } }>().data.downloadUrl).toBe(
      "http://build-box.local:8080/api/apks/download/1",
    );
  });

  it("returns a 404 error envelope when no release exists", async () => {
    const response = await testApp.app.inject({ method: "GET", url: "/api/apks/latest" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      success: false,
      error: { code: "no_releases", message: "No APK has been uploaded yet" },
    });
  });
});
