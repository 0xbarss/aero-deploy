import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateUp } from "../db/migrate.js";
import { formatFileSize } from "../format-file-size.js";
import { BARE, readFixture, SHOP, SHOP_DEBUG, type FixtureName } from "./helpers/fixtures.js";
import { fakeApk, multipartBody, type MultipartPart } from "./helpers/multipart.js";
import { defaultAppId, seedApp, seedRelease, sha256Hex } from "./helpers/seed-release.js";
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

function upload(parts: MultipartPart[]) {
  const { payload, headers } = multipartBody(parts);
  return testApp.app.inject({ method: "POST", url: "/api/apks/upload", payload, headers });
}

async function uploadFixture(
  fixture: FixtureName,
  fields: Record<string, string> = {},
  fileName = "app-debug.apk",
) {
  return upload([
    { name: "apk", filename: fileName, content: await readFixture(fixture) },
    ...Object.entries(fields).map(([name, value]) => ({ name, value })),
  ]);
}

async function releaseCount(): Promise<number> {
  const result = await pool.query<{ count: string }>("SELECT count(*) FROM apk_releases");
  return Number(result.rows[0]?.count);
}

interface AppRow {
  id: number;
  name: string;
  package_name: string | null;
}

async function appRows(): Promise<AppRow[]> {
  const result = await pool.query<AppRow>(
    "SELECT id, name, package_name FROM apps WHERE package_name IS NOT NULL ORDER BY id",
  );
  return result.rows;
}

describe("POST /api/apks/upload", () => {
  it("reads the identity from the APK, stores the file and returns 201", async () => {
    const content = await readFixture(SHOP.fixture);
    const response = await uploadFixture(SHOP.fixture, { releaseNotes: "Bug fixes" });

    expect(response.statusCode).toBe(201);
    const [app] = await appRows();
    expect(response.json()).toEqual({
      success: true,
      message: "APK successfully uploaded and registered",
      data: {
        id: 1,
        appId: app?.id,
        appName: "My Shop",
        packageName: "com.example.shop",
        versionName: "1.2.0",
        versionCode: 12,
        fileName: "app-debug.apk",
        fileSize: formatFileSize(content.length),
        sha256: sha256Hex(content),
      },
    });

    const row = await pool.query<{
      file_name: string;
      file_path: string;
      file_size: string;
      release_notes: string | null;
      sha256: string | null;
      app_id: number;
    }>("SELECT file_name, file_path, file_size, release_notes, sha256, app_id FROM apk_releases");
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toMatchObject({
      file_name: "app-debug.apk",
      file_size: String(content.length),
      release_notes: "Bug fixes",
      sha256: sha256Hex(content),
      app_id: app?.id,
    });

    const stored = await readFile(join(testApp.uploadDir, row.rows[0]?.file_path ?? "missing"));
    expect(stored.equals(content)).toBe(true);
    expect(await readdir(testApp.uploadDir)).toHaveLength(1);
  });

  it("creates the app with the package name and the label from the APK", async () => {
    await uploadFixture(SHOP.fixture);

    expect(await appRows()).toEqual([
      expect.objectContaining({ name: "My Shop", package_name: "com.example.shop" }),
    ]);
  });

  it("names the stored file after the version code read from the APK", async () => {
    await uploadFixture(SHOP.fixture);

    const files = await readdir(testApp.uploadDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^12-[0-9a-f-]{36}\.apk$/);
  });

  it("accepts text fields sent before the file", async () => {
    const response = await upload([
      { name: "versionCode", value: "12" },
      { name: "apk", filename: "app.apk", content: await readFixture(SHOP.fixture) },
    ]);

    expect(response.statusCode).toBe(201);
  });

  it("accepts version and package fields that agree with the APK", async () => {
    const response = await uploadFixture(SHOP.fixture, {
      versionName: "1.2.0",
      versionCode: "12",
      packageName: "com.example.shop",
    });

    expect(response.statusCode).toBe(201);
  });

  it("treats releaseNotes as optional", async () => {
    await uploadFixture(SHOP.fixture);

    const row = await pool.query<{ release_notes: string | null }>(
      "SELECT release_notes FROM apk_releases",
    );
    expect(row.rows[0]?.release_notes).toBeNull();
  });

  it("keeps only the base name of the client file name and stays inside the upload dir", async () => {
    const response = await uploadFixture(SHOP.fixture, {}, "../../evil.apk");

    expect(response.statusCode).toBe(201);
    expect(response.json<{ data: { fileName: string } }>().data.fileName).toBe("evil.apk");
    expect(await readdir(testApp.uploadDir)).toHaveLength(1);
  });

  it("stores the version code as the version name when the manifest has none", async () => {
    const response = await uploadFixture(BARE.fixture);

    expect(response.statusCode).toBe(201);
    expect(response.json<{ data: { versionName: string } }>().data.versionName).toBe("0.3");
  });

  describe("apps", () => {
    it("uses the package name as the app name when the APK has no label", async () => {
      const response = await uploadFixture(BARE.fixture);

      expect(response.json<{ data: { appName: string } }>().data.appName).toBe("com.example.bare");
    });

    it("adds the release to the existing app with that package name", async () => {
      const appId = await seedApp(pool, { name: "Shop Tool", packageName: SHOP.packageName });

      const response = await uploadFixture(SHOP.fixture, { appName: "Ignored" });

      expect(response.statusCode).toBe(201);
      expect(response.json<{ data: { appId: number; appName: string } }>().data).toMatchObject({
        appId,
        appName: "Shop Tool",
      });
      expect(await appRows()).toHaveLength(1);
    });

    it("uses appName only when the app is created", async () => {
      const response = await uploadFixture(SHOP.fixture, { appName: "Corner Shop" });

      expect(response.json<{ data: { appName: string } }>().data.appName).toBe("Corner Shop");
      expect((await appRows())[0]?.name).toBe("Corner Shop");
    });

    it("cuts a requested app name to 100 characters", async () => {
      await uploadFixture(SHOP.fixture, { appName: "x".repeat(150) });

      expect((await appRows())[0]?.name).toBe("x".repeat(100));
    });

    it("does not put the release in the default app", async () => {
      await uploadFixture(SHOP.fixture);

      const row = await pool.query<{ app_id: number }>("SELECT app_id FROM apk_releases");
      expect(row.rows[0]?.app_id).not.toBe(await defaultAppId(pool));
    });

    it("accepts the same versionCode in two different apps", async () => {
      expect((await uploadFixture(SHOP.fixture)).statusCode).toBe(201);
      expect((await uploadFixture(SHOP_DEBUG.fixture)).statusCode).toBe(201);

      expect(await appRows()).toHaveLength(2);
      expect(await releaseCount()).toBe(2);
    });

    it("adds ' (debug)' when a debuggable build has the name of another app", async () => {
      await seedApp(pool, { name: "my shop debug", packageName: "com.other" });

      const response = await uploadFixture(SHOP_DEBUG.fixture);

      expect(response.statusCode).toBe(201);
      expect(response.json<{ data: { appName: string } }>().data.appName).toBe(
        "My Shop Debug (debug)",
      );
    });

    it("adds the package name in brackets when a release build has the name of another app", async () => {
      await seedApp(pool, { name: "my shop", packageName: "com.other" });

      const response = await uploadFixture(SHOP.fixture);

      expect(response.statusCode).toBe(201);
      expect(response.json<{ data: { appName: string } }>().data.appName).toBe(
        "My Shop (com.example.shop)",
      );
    });

    it("falls back to the package name when every other name is taken", async () => {
      await seedApp(pool, { name: "My Shop", packageName: "com.other.one" });
      await seedApp(pool, { name: "My Shop (com.example.shop)", packageName: "com.other.two" });

      const response = await uploadFixture(SHOP.fixture);

      expect(response.statusCode).toBe(201);
      expect(response.json<{ data: { appName: string } }>().data.appName).toBe("com.example.shop");
    });

    it("creates one app when two uploads of a new package arrive together", async () => {
      const shop = await readFixture(SHOP.fixture);
      const responses = await Promise.all(
        [1, 2].map(() => upload([{ name: "apk", filename: "app.apk", content: shop }])),
      );

      expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
      expect(await appRows()).toHaveLength(1);
      expect(await releaseCount()).toBe(1);
      expect(await readdir(testApp.uploadDir)).toHaveLength(1);
    });

    it("gives two new apps that ask for the same name different names when they arrive together", async () => {
      const responses = await Promise.all([
        uploadFixture(SHOP.fixture, { appName: "Shop" }),
        uploadFixture(SHOP_DEBUG.fixture, { appName: "Shop" }),
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
      const names = (await appRows()).map((row) => row.name);
      expect(names).toHaveLength(2);
      expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(2);
      expect(names).toContain("Shop");
    });
  });

  describe("manifest_mismatch", () => {
    async function expectMismatch(fields: Record<string, string>, ...mentions: string[]) {
      const response = await uploadFixture(SHOP.fixture, fields);

      expect(response.statusCode).toBe(422);
      const body = response.json<{ success: boolean; error: { code: string; message: string } }>();
      expect(body).toMatchObject({ success: false, error: { code: "manifest_mismatch" } });
      for (const text of mentions) {
        expect(body.error.message).toContain(text);
      }
      expect(await releaseCount()).toBe(0);
      expect(await appRows()).toEqual([]);
      expect(await readdir(testApp.uploadDir)).toEqual([]);
    }

    it("for a versionCode that differs, naming both values", async () => {
      await expectMismatch({ versionCode: "5" }, "versionCode", "5", "12");
    });

    it("for a versionName that differs, naming both values", async () => {
      await expectMismatch({ versionName: "9.9.9" }, "versionName", "9.9.9", "1.2.0");
    });

    it("for a packageName that differs, naming both values", async () => {
      await expectMismatch(
        { packageName: "com.example.other" },
        "com.example.other",
        "com.example.shop",
      );
    });

    it("for several fields at once", async () => {
      await expectMismatch(
        { versionCode: "5", versionName: "9.9.9" },
        "versionCode",
        "versionName",
      );
    });
  });

  describe("rejects bad input and leaves nothing behind", () => {
    async function expectRejected(
      parts: MultipartPart[],
      status: number,
      code: string,
    ): Promise<void> {
      const response = await upload(parts);

      expect(response.statusCode).toBe(status);
      expect(response.json<{ success: boolean; error: { code: string } }>()).toMatchObject({
        success: false,
        error: { code },
      });
      expect(await releaseCount()).toBe(0);
      expect(await appRows()).toEqual([]);
      expect(await readdir(testApp.uploadDir)).toEqual([]);
    }

    async function shopApk(): Promise<MultipartPart> {
      return { name: "apk", filename: "app.apk", content: await readFixture(SHOP.fixture) };
    }

    it("missing apk file", async () => {
      await expectRejected([{ name: "versionCode", value: "12" }], 400, "validation_error");
    });

    it.each(["abc", "0", "-1", "1.5", "", "99999999999"])("versionCode=%j", async (versionCode) => {
      await expectRejected(
        [await shopApk(), { name: "versionCode", value: versionCode }],
        400,
        "validation_error",
      );
    });

    it("versionName longer than 50 characters", async () => {
      await expectRejected(
        [await shopApk(), { name: "versionName", value: "x".repeat(51) }],
        400,
        "validation_error",
      );
    });

    it("an empty packageName", async () => {
      await expectRejected(
        [await shopApk(), { name: "packageName", value: "" }],
        400,
        "validation_error",
      );
    });

    it("a file name that does not end in .apk", async () => {
      await expectRejected(
        [{ name: "apk", filename: "app.zip", content: await readFixture(SHOP.fixture) }],
        400,
        "validation_error",
      );
    });

    it("content that is not a ZIP archive", async () => {
      await expectRejected(
        [{ name: "apk", filename: "app.apk", content: Buffer.from("just some text") }],
        400,
        "validation_error",
      );
    });

    it("a file sent under the wrong field name", async () => {
      await expectRejected(
        [{ name: "file", filename: "app.apk", content: await readFixture(SHOP.fixture) }],
        400,
        "validation_error",
      );
    });

    it("a ZIP archive without a manifest", async () => {
      await expectRejected(
        [{ name: "apk", filename: "app.apk", content: await readFixture("no-manifest") }],
        422,
        "invalid_apk",
      );
    });

    it("bytes that only start like a ZIP archive", async () => {
      await expectRejected(
        [{ name: "apk", filename: "app.apk", content: fakeApk() }],
        422,
        "invalid_apk",
      );
    });

    it("a duplicate versionCode within one app", async () => {
      const first = await uploadFixture(SHOP.fixture);
      expect(first.statusCode).toBe(201);

      const second = await uploadFixture(SHOP.fixture);

      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({
        success: false,
        error: { code: "version_code_exists", message: "versionCode 12 is already registered" },
      });
      expect(await releaseCount()).toBe(1);
      expect(await readdir(testApp.uploadDir)).toHaveLength(1);
    });

    it("a duplicate versionCode in an app that already has releases", async () => {
      const appId = await seedApp(pool, { name: "Shop", packageName: SHOP.packageName });
      await seedRelease(pool, testApp.uploadDir, { appId, versionCode: 12 });
      const before = await readdir(testApp.uploadDir);

      const response = await uploadFixture(SHOP.fixture);

      expect(response.statusCode).toBe(409);
      expect(await readdir(testApp.uploadDir)).toEqual(before);
    });
  });

  it("returns 413 and removes the partial file when the upload is too large", async () => {
    await testApp.close();
    testApp = await createTestApp(pool, { maxUploadBytes: 1024 });

    const response = await upload([{ name: "apk", filename: "big.apk", content: fakeApk(8192) }]);

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ success: false, error: { code: "file_too_large" } });
    expect(await releaseCount()).toBe(0);
    expect(await readdir(testApp.uploadDir)).toEqual([]);
  });

  it("returns a 4xx error envelope for a body that is not multipart", async () => {
    const response = await testApp.app.inject({
      method: "POST",
      url: "/api/apks/upload",
      payload: { versionName: "1.0.0" },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(response.json()).toMatchObject({ success: false, error: { code: "bad_request" } });
  });
});
