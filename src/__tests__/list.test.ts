import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateUp } from "../db/migrate.js";
import { fakeApk } from "./helpers/multipart.js";
import { seedApp, seedRelease, sha256Hex } from "./helpers/seed-release.js";
import { createTestApp, type TestApp } from "./helpers/test-app.js";
import {
  clearReleasesAndExtraApps,
  createTestPool,
  resetDatabase,
} from "./helpers/test-database.js";

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

interface ListItem {
  id: number;
  appId: number;
  appName: string;
  versionName: string;
  versionCode: number;
  fileName: string;
  fileSize: number;
  sha256: string | null;
  releaseNotes: string | null;
  createdAt: string;
  downloadUrl: string;
}

interface ListBody {
  success: boolean;
  data: ListItem[];
  pagination: { limit: number; offset: number; total: number };
}

function list(query = "", headers: Record<string, string> = {}) {
  return testApp.app.inject({ method: "GET", url: `/api/apks${query}`, headers });
}

async function seedCodes(...codes: number[]): Promise<void> {
  for (const versionCode of codes) {
    await seedRelease(pool, testApp.uploadDir, { versionCode });
  }
}

describe("GET /api/apks", () => {
  it("returns an empty page when nothing has been uploaded", async () => {
    const response = await list();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: [],
      pagination: { limit: 50, offset: 0, total: 0 },
    });
  });

  it("describes each release with the fields the Android client needs", async () => {
    const content = fakeApk(4096);
    const { release } = await seedRelease(pool, testApp.uploadDir, {
      versionCode: 4,
      versionName: "1.1.0",
      fileName: "app-debug.apk",
      releaseNotes: "Bug fixes and performance improvements",
      content,
    });

    const response = await list("", { host: "192.168.1.20:3000" });

    expect(response.statusCode).toBe(200);
    const body = response.json<ListBody>();
    expect(body.data).toEqual([
      {
        id: release.id,
        appId: release.appId,
        appName: "Default App",
        versionName: "1.1.0",
        versionCode: 4,
        fileName: "app-debug.apk",
        fileSize: content.length,
        sha256: sha256Hex(content),
        releaseNotes: "Bug fixes and performance improvements",
        createdAt: release.createdAt.toISOString(),
        downloadUrl: `http://192.168.1.20:3000/api/apks/download/${release.id}`,
      },
    ]);
    expect(body.pagination).toEqual({ limit: 50, offset: 0, total: 1 });
  });

  it("does not expose the stored file path", async () => {
    await seedCodes(1);

    const response = await list();

    expect(response.body).not.toContain("filePath");
    expect(response.body).not.toContain("seed.apk");
    expect(response.body).not.toContain(testApp.uploadDir);
  });

  it("uses https in downloadUrl when X-Forwarded-Proto says https", async () => {
    const content = fakeApk(4096);
    const { release } = await seedRelease(pool, testApp.uploadDir, {
      versionCode: 1,
      content,
    });

    const response = await list("", {
      host: "abc123.ngrok.io",
      "x-forwarded-proto": "https",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ListBody>();
    expect(body.data[0]?.downloadUrl).toBe(
      `https://abc123.ngrok.io/api/apks/download/${release.id}`,
    );
  });

  it("uses the X-Forwarded-Host header when present", async () => {
    await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    const response = await list("", {
      host: "localhost:3000",
      "x-forwarded-host": "abc123.ngrok.io",
      "x-forwarded-proto": "https",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ListBody>();
    expect(body.data[0]?.downloadUrl).toContain("abc123.ngrok.io");
  });

  it("lists releases newest versionCode first", async () => {
    await seedCodes(2, 9, 5);

    const response = await list();

    expect(response.json<ListBody>().data.map((item) => item.versionCode)).toEqual([9, 5, 2]);
  });

  it("returns null for the hash of a release stored before checksums existed", async () => {
    await seedRelease(pool, testApp.uploadDir, { versionCode: 1, sha256: null });

    const response = await list();

    expect(response.json<ListBody>().data[0]?.sha256).toBeNull();
  });

  describe("pagination", () => {
    beforeEach(async () => {
      await seedCodes(1, 2, 3, 4, 5);
    });

    it("applies limit and offset and reports the total", async () => {
      const response = await list("?limit=2&offset=1");

      const body = response.json<ListBody>();
      expect(body.data.map((item) => item.versionCode)).toEqual([4, 3]);
      expect(body.pagination).toEqual({ limit: 2, offset: 1, total: 5 });
    });

    it("returns an empty page past the end but keeps the total", async () => {
      const response = await list("?offset=10");

      const body = response.json<ListBody>();
      expect(body.data).toEqual([]);
      expect(body.pagination).toEqual({ limit: 50, offset: 10, total: 5 });
    });

    it("accepts the maximum limit of 200", async () => {
      const response = await list("?limit=200");

      expect(response.statusCode).toBe(200);
      expect(response.json<ListBody>().pagination.limit).toBe(200);
    });

    it.each([
      ["limit", "0"],
      ["limit", "201"],
      ["limit", "-1"],
      ["limit", "abc"],
      ["limit", "1.5"],
      ["limit", ""],
      ["offset", "-1"],
      ["offset", "abc"],
      ["offset", "1.5"],
      ["offset", "99999999999"],
      ["offset", ""],
    ])("rejects %s=%j with 400", async (name, value) => {
      const response = await list(`?${name}=${value}`);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        success: false,
        error: { code: "validation_error" },
      });
    });

    it("rejects a repeated parameter with 400", async () => {
      const response = await list("?limit=1&limit=2");

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "validation_error" } });
    });
  });

  describe("with several apps", () => {
    let shopId: number;
    let notesId: number;

    beforeEach(async () => {
      shopId = await seedApp(pool, { name: "My Shop", packageName: "com.example.shop" });
      notesId = await seedApp(pool, { name: "Notes", packageName: "com.example.notes" });
      await seedRelease(pool, testApp.uploadDir, { appId: shopId, versionCode: 1 });
      await seedRelease(pool, testApp.uploadDir, { appId: shopId, versionCode: 2 });
      await seedRelease(pool, testApp.uploadDir, { appId: notesId, versionCode: 1 });
    });

    it("names the app of each release", async () => {
      const response = await list();

      const names = response
        .json<ListBody>()
        .data.map((item) => `${item.appName}:${item.versionCode}`)
        .sort();
      expect(names).toEqual(["Notes:1", "My Shop:1", "My Shop:2"].sort());
    });

    it("filters by appId and counts only that app in the total", async () => {
      const response = await list(`?appId=${shopId}`);

      const body = response.json<ListBody>();
      expect(body.data.map((item) => item.versionCode)).toEqual([2, 1]);
      expect(body.data.every((item) => item.appId === shopId)).toBe(true);
      expect(body.pagination.total).toBe(2);
    });

    it("filters by packageName", async () => {
      const response = await list("?packageName=com.example.notes");

      const body = response.json<ListBody>();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.appId).toBe(notesId);
      expect(body.pagination.total).toBe(1);
    });

    it("combines both filters", async () => {
      const match = await list(`?appId=${shopId}&packageName=com.example.shop`);
      const mismatch = await list(`?appId=${shopId}&packageName=com.example.notes`);

      expect(match.json<ListBody>().pagination.total).toBe(2);
      expect(mismatch.json<ListBody>().pagination.total).toBe(0);
    });

    it("combines a filter with pagination", async () => {
      const response = await list(`?appId=${shopId}&limit=1&offset=1`);

      const body = response.json<ListBody>();
      expect(body.data.map((item) => item.versionCode)).toEqual([1]);
      expect(body.pagination).toEqual({ limit: 1, offset: 1, total: 2 });
    });

    it("returns an empty list for an unknown app", async () => {
      const byId = await list("?appId=9999");
      const byPackage = await list("?packageName=com.example.unknown");

      expect(byId.statusCode).toBe(200);
      expect(byId.json<ListBody>().data).toEqual([]);
      expect(byPackage.json<ListBody>().pagination.total).toBe(0);
    });

    it.each(["abc", "0", "-1", "1.5", "99999999999", ""])(
      "rejects appId=%j with 400",
      async (id) => {
        const response = await list(`?appId=${id}`);

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: { code: "validation_error" } });
      },
    );

    it("rejects an empty packageName with 400", async () => {
      const response = await list("?packageName=");

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "validation_error" } });
    });

    it("treats a package name with SQL syntax as plain text", async () => {
      const response = await list(`?packageName=${encodeURIComponent("x' OR '1'='1")}`);

      expect(response.statusCode).toBe(200);
      expect(response.json<ListBody>().data).toEqual([]);
    });
  });
});
