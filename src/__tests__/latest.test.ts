import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateUp } from "../db/migrate.js";
import { seedApp, seedRelease, sha256Hex } from "./helpers/seed-release.js";
import { createTestApp, type TestApp } from "./helpers/test-app.js";
import {
  clearReleasesAndExtraApps,
  createTestPool,
  resetDatabase,
} from "./helpers/test-database.js";
import { fakeApk } from "./helpers/multipart.js";

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
  await clearReleasesAndExtraApps(pool);
  testApp = await createTestApp(pool);
});

afterEach(async () => {
  await testApp.close();
});

interface LatestData {
  id: number;
  versionCode: number;
  releaseNotes: string | null;
  sha256: string | null;
  fileSize: number;
  downloadUrl: string;
}

function latest(query = "", headers: Record<string, string> = {}) {
  return testApp.app.inject({ method: "GET", url: `/api/apks/latest${query}`, headers });
}

describe("GET /api/apks/latest", () => {
  it("returns the release with the highest versionCode", async () => {
    await seedRelease(pool, testApp.uploadDir, { versionCode: 2, versionName: "1.0.1" });
    const content = fakeApk(4096);
    await seedRelease(pool, testApp.uploadDir, {
      versionCode: 5,
      versionName: "1.2.0",
      releaseNotes: "Bug fixes and performance improvements",
      content,
    });
    await seedRelease(pool, testApp.uploadDir, { versionCode: 3, versionName: "1.1.0" });

    const response = await latest("", { host: "192.168.1.20:3000" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        id: 2,
        versionName: "1.2.0",
        versionCode: 5,
        fileSize: content.length,
        sha256: sha256Hex(content),
        releaseNotes: "Bug fixes and performance improvements",
        downloadUrl: "http://192.168.1.20:3000/api/apks/download/2",
      },
    });
  });

  it("returns null release notes when none were given", async () => {
    await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    const response = await latest();

    expect(response.json<{ data: LatestData }>().data.releaseNotes).toBeNull();
  });

  it("returns a null sha256 for a release stored before checksums existed", async () => {
    await seedRelease(pool, testApp.uploadDir, { versionCode: 1, sha256: null });

    const response = await latest();

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: LatestData }>().data.sha256).toBeNull();
  });

  it("builds downloadUrl from the host the client used", async () => {
    await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    const response = await latest("", { host: "build-box.local:8080" });

    expect(response.json<{ data: LatestData }>().data.downloadUrl).toBe(
      "http://build-box.local:8080/api/apks/download/1",
    );
  });

  it("returns a 404 error envelope when no release exists", async () => {
    const response = await latest();

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      success: false,
      error: { code: "no_releases", message: "No APK has been uploaded yet" },
    });
  });

  describe("with an empty default app next to one app that has releases", () => {
    it("does not ask for an app", async () => {
      const shopId = await seedApp(pool, { name: "My Shop", packageName: "com.example.shop" });
      await seedRelease(pool, testApp.uploadDir, { appId: shopId, versionCode: 12 });

      const response = await latest();

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: LatestData }>().data.versionCode).toBe(12);
    });
  });

  describe("with several apps", () => {
    let shopId: number;
    let notesId: number;

    beforeEach(async () => {
      shopId = await seedApp(pool, { name: "My Shop", packageName: "com.example.shop" });
      notesId = await seedApp(pool, { name: "Notes", packageName: "com.example.notes" });
      await seedRelease(pool, testApp.uploadDir, { appId: shopId, versionCode: 12 });
      await seedRelease(pool, testApp.uploadDir, { appId: notesId, versionCode: 3 });
    });

    it("returns the newest release of the app selected by appId", async () => {
      const response = await latest(`?appId=${notesId}`);

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: LatestData }>().data.versionCode).toBe(3);
    });

    it("returns the newest release of the app selected by packageName", async () => {
      const response = await latest("?packageName=com.example.shop");

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: LatestData }>().data.versionCode).toBe(12);
    });

    it("asks for an app when no filter is given", async () => {
      const response = await latest();

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        success: false,
        error: { code: "app_required" },
      });
    });

    it("returns no_releases for an app that has none", async () => {
      const emptyId = await seedApp(pool, { name: "Empty", packageName: "com.example.empty" });

      const response = await latest(`?appId=${emptyId}`);

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: "no_releases" } });
    });

    it("returns no_releases for a package name nobody uploaded", async () => {
      const response = await latest("?packageName=com.example.unknown");

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: "no_releases" } });
    });

    it.each(["abc", "0", "-1", "1.5", "99999999999", ""])(
      "rejects appId=%j with 400",
      async (id) => {
        const response = await latest(`?appId=${id}`);

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: { code: "validation_error" } });
      },
    );

    it("rejects an empty packageName with 400", async () => {
      const response = await latest("?packageName=");

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "validation_error" } });
    });
  });
});
