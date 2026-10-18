import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { migrateUp } from "../db/migrate.js";
import { readFixture, SHOP } from "./helpers/fixtures.js";
import { captureLogs } from "./helpers/log-capture.js";
import { fakeApk, multipartBody } from "./helpers/multipart.js";
import { defaultAppId, seedApp, seedRelease } from "./helpers/seed-release.js";
import { createTestApp, type TestApp } from "./helpers/test-app.js";
import {
  clearReleasesAndExtraApps,
  createTestPool,
  resetDatabase,
} from "./helpers/test-database.js";

interface ErrorBody {
  error: { code: string };
}

const TOKEN = "test-admin-token-7f3a91";

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
  testApp = await createTestApp(pool, { adminToken: TOKEN });
});

afterEach(async () => {
  await testApp.close();
});

function remove(id: string | number, authorization: string | null = `Bearer ${TOKEN}`) {
  return testApp.app.inject({
    method: "DELETE",
    url: `/api/apks/${id}`,
    headers: authorization === null ? {} : { authorization },
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function releaseCount(): Promise<number> {
  const result = await pool.query<{ count: string }>("SELECT count(*) FROM apk_releases");
  return Number(result.rows[0]?.count);
}

describe("DELETE /api/apks/:id", () => {
  it("removes the row and the stored file and answers 204 with no body", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 3 });
    const filePath = join(testApp.uploadDir, release.filePath);
    expect(await exists(filePath)).toBe(true);

    const response = await remove(release.id);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(await releaseCount()).toBe(0);
    expect(await exists(filePath)).toBe(false);
  });

  it("makes the release disappear from the list and the download", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 3 });
    await remove(release.id);

    const list = await testApp.app.inject({ method: "GET", url: "/api/apks" });
    const download = await testApp.app.inject({
      method: "GET",
      url: `/api/apks/download/${release.id}`,
    });

    expect(list.json<{ pagination: { total: number } }>().pagination.total).toBe(0);
    expect(download.statusCode).toBe(404);
    expect(download.json<ErrorBody>().error.code).toBe("release_not_found");
  });

  it("leaves other releases and their files alone", async () => {
    const keep = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });
    const drop = await seedRelease(pool, testApp.uploadDir, { versionCode: 2 });

    await remove(drop.release.id);

    const rows = await pool.query<{ id: number }>("SELECT id FROM apk_releases");
    expect(rows.rows.map((row) => row.id)).toEqual([keep.release.id]);
    expect(await exists(join(testApp.uploadDir, keep.release.filePath))).toBe(true);
  });

  it("makes latest fall back to the next highest versionCode of the same app", async () => {
    await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });
    await seedRelease(pool, testApp.uploadDir, { versionCode: 5 });
    const newest = await seedRelease(pool, testApp.uploadDir, { versionCode: 9 });

    await remove(newest.release.id);

    const latest = await testApp.app.inject({ method: "GET", url: "/api/apks/latest" });
    expect(latest.statusCode).toBe(200);
    expect(latest.json<{ data: { versionCode: number } }>().data.versionCode).toBe(5);
  });

  it("does not touch the latest release of another app", async () => {
    const shop = await seedApp(pool, { name: "Shop", packageName: "com.example.shop" });
    const other = await seedApp(pool, { name: "Other", packageName: "com.example.other" });
    await seedRelease(pool, testApp.uploadDir, { versionCode: 7, appId: shop });
    const doomed = await seedRelease(pool, testApp.uploadDir, { versionCode: 20, appId: other });

    await remove(doomed.release.id);

    const latest = await testApp.app.inject({
      method: "GET",
      url: `/api/apks/latest?appId=${shop}`,
    });
    expect(latest.json<{ data: { versionCode: number } }>().data.versionCode).toBe(7);
    const emptied = await testApp.app.inject({
      method: "GET",
      url: `/api/apks/latest?appId=${other}`,
    });
    expect(emptied.statusCode).toBe(404);
    expect(emptied.json<ErrorBody>().error.code).toBe("no_releases");
  });

  it("keeps the app, even when its last release is deleted", async () => {
    const appId = await seedApp(pool, { name: "Shop", packageName: "com.example.shop" });
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1, appId });

    await remove(release.id);

    const apps = await pool.query("SELECT id FROM apps WHERE id = $1", [appId]);
    expect(apps.rowCount).toBe(1);
  });

  it("allows the same versionCode to be uploaded again afterwards", async () => {
    const { payload, headers } = multipartBody([
      { name: "apk", filename: "app.apk", content: await readFixture(SHOP.fixture) },
    ]);
    const first = await testApp.app.inject({
      method: "POST",
      url: "/api/apks/upload",
      payload,
      headers,
    });
    expect(first.statusCode).toBe(201);

    await remove(first.json<{ data: { id: number } }>().data.id);

    const second = await testApp.app.inject({
      method: "POST",
      url: "/api/apks/upload",
      payload,
      headers,
    });
    expect(second.statusCode).toBe(201);
    expect(second.json<{ data: { versionCode: number } }>().data.versionCode).toBe(
      SHOP.versionCode,
    );
  });

  it("answers 404 release_not_found for an unknown id and changes nothing", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    const response = await remove(release.id + 100);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      success: false,
      error: { code: "release_not_found", message: `Release ${release.id + 100} not found` },
    });
    expect(await releaseCount()).toBe(1);
  });

  it("answers 404 when the same release is deleted twice", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    expect((await remove(release.id)).statusCode).toBe(204);
    expect((await remove(release.id)).statusCode).toBe(404);
  });

  it.each(["abc", "0", "-1", "1.5", "99999999999"])(
    "rejects the id %j with 400 validation_error",
    async (id) => {
      const response = await remove(id);

      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error.code).toBe("validation_error");
    },
  );
});

describe("DELETE /api/apks/:id when the file cannot be removed", () => {
  it("still answers 204 when the file is already gone", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });
    await rm(join(testApp.uploadDir, release.filePath));

    const response = await remove(release.id);

    expect(response.statusCode).toBe(204);
    expect(await releaseCount()).toBe(0);
  });

  describe("with log capture", () => {
    async function appWithLogs() {
      const logs = captureLogs();
      await testApp.app.close();
      const app = await buildApp({
        logger: { level: "info", stream: logs.stream },
        pool,
        uploadDir: testApp.uploadDir,
        maxUploadBytes: 64 * 1024,
        adminToken: TOKEN,
      });
      return { app, logs };
    }

    it("logs a warning and still answers 204 when removal fails", async () => {
      const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });
      // A directory cannot be removed as a file, which makes the removal fail
      await rm(join(testApp.uploadDir, release.filePath));
      await mkdir(join(testApp.uploadDir, release.filePath));
      const { app, logs } = await appWithLogs();

      const response = await app.inject({
        method: "DELETE",
        url: `/api/apks/${release.id}`,
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(response.statusCode).toBe(204);
      expect(await releaseCount()).toBe(0);
      const warning = logs.entries().find((entry) => entry.event === "release.file_removal_failed");
      expect(warning).toMatchObject({ level: 40, releaseId: release.id });
      await app.close();
    });

    it("does not remove a file outside the upload directory", async () => {
      const outside = join(testApp.uploadDir, "..", `outside-${randomUUID()}.apk`);
      await writeFile(outside, fakeApk());
      const appId = await defaultAppId(pool);
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO apk_releases (app_id, version_name, version_code, file_name, file_path, file_size)
         VALUES ($1, '1.0.0', 1, 'app.apk', $2, 10) RETURNING id`,
        [appId, `../${outside.split("/").pop()}`],
      );
      const id = inserted.rows[0]?.id as number;
      const { app, logs } = await appWithLogs();

      try {
        const response = await app.inject({
          method: "DELETE",
          url: `/api/apks/${id}`,
          headers: { authorization: `Bearer ${TOKEN}` },
        });

        expect(response.statusCode).toBe(204);
        expect(await releaseCount()).toBe(0);
        expect(await exists(outside)).toBe(true);
        expect(logs.entries().some((entry) => entry.event === "release.file_removal_skipped")).toBe(
          true,
        );
      } finally {
        await rm(outside, { force: true });
        await app.close();
      }
    });
  });

  it("leaves no temporary files behind in the upload directory", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    await remove(release.id);

    expect(await readdir(testApp.uploadDir)).toEqual([]);
  });
});

describe("DELETE /api/apks/:id authorization", () => {
  async function expectRejected(
    response: Awaited<ReturnType<typeof remove>>,
    status: number,
    code: string,
    releaseId: number,
  ) {
    expect(response.statusCode).toBe(status);
    expect(response.json<ErrorBody>().error.code).toBe(code);
    expect(await releaseCount()).toBe(1);
    const row = await pool.query("SELECT id FROM apk_releases WHERE id = $1", [releaseId]);
    expect(row.rowCount).toBe(1);
  }

  it("rejects a request without an Authorization header with 401 unauthorized", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    await expectRejected(await remove(release.id, null), 401, "unauthorized", release.id);
    expect(await exists(join(testApp.uploadDir, release.filePath))).toBe(true);
  });

  it.each([
    ["a wrong token", "Bearer wrong-token"],
    ["a token that is only a prefix of the real one", `Bearer ${TOKEN.slice(0, -1)}`],
    ["the real token plus extra characters", `Bearer ${TOKEN}x`],
    ["an empty token", "Bearer "],
    ["the token without a scheme", TOKEN],
    ["another scheme", `Basic ${TOKEN}`],
  ])("rejects %s with 401 unauthorized", async (_label, header) => {
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    await expectRejected(await remove(release.id, header), 401, "unauthorized", release.id);
  });

  it("accepts the scheme in any letter case", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    const response = await remove(release.id, `bearer ${TOKEN}`);

    expect(response.statusCode).toBe(204);
  });

  it("checks the token before the id, so an unauthenticated caller learns nothing about ids", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    const unknown = await remove(release.id + 100, null);
    const malformed = await remove("abc", null);

    expect(unknown.statusCode).toBe(401);
    expect(malformed.statusCode).toBe(401);
  });

  it("answers 403 admin_disabled when the server has no ADMIN_TOKEN, whatever the request carries", async () => {
    await testApp.close();
    testApp = await createTestApp(pool);
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    const withHeader = await remove(release.id, "Bearer anything");
    const withoutHeader = await remove(release.id, null);

    await expectRejected(withHeader, 403, "admin_disabled", release.id);
    expect(withoutHeader.statusCode).toBe(403);
    expect(await exists(join(testApp.uploadDir, release.filePath))).toBe(true);
  });

  it("does not write the submitted or the configured token to the logs", async () => {
    const logs = captureLogs();
    await testApp.app.close();
    const app = await buildApp({
      logger: { level: "debug", stream: logs.stream },
      pool,
      uploadDir: testApp.uploadDir,
      maxUploadBytes: 64 * 1024,
      adminToken: TOKEN,
    });
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });

    await app.inject({
      method: "DELETE",
      url: `/api/apks/${release.id}`,
      headers: { authorization: "Bearer submitted-secret-91c2" },
    });
    await app.inject({
      method: "DELETE",
      url: `/api/apks/${release.id}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    await app.close();

    const output = JSON.stringify(logs.entries());
    expect(output).not.toContain("submitted-secret-91c2");
    expect(output).not.toContain(TOKEN);
    expect(
      logs
        .entries()
        .some((entry) => entry.event === "request.rejected" && entry.statusCode === 401),
    ).toBe(true);
  });
});
