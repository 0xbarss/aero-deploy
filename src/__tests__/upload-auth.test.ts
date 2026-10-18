import { readdir } from "node:fs/promises";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { migrateUp } from "../db/migrate.js";
import { readFixture, SHOP } from "./helpers/fixtures.js";
import { captureLogs } from "./helpers/log-capture.js";
import { fakeApk, multipartBody } from "./helpers/multipart.js";
import { seedRelease } from "./helpers/seed-release.js";
import { createTestApp, type TestApp } from "./helpers/test-app.js";
import {
  clearReleasesAndExtraApps,
  createTestPool,
  resetDatabase,
} from "./helpers/test-database.js";

interface ErrorBody {
  error: { code: string; message: string };
}

const UPLOAD_TOKEN = "test-upload-token-5d20c8";
const ADMIN_TOKEN = "test-admin-token-7f3a91";

let pool: Pool;
let testApp: TestApp | undefined;

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
});

afterEach(async () => {
  await testApp?.close();
  testApp = undefined;
});

async function startApp(options: { uploadToken?: string; adminToken?: string }): Promise<TestApp> {
  testApp = await createTestApp(pool, options);
  return testApp;
}

async function uploadShop(
  app: TestApp,
  authorization?: string,
  content?: Buffer,
): Promise<{ statusCode: number; json: () => unknown }> {
  const { payload, headers } = multipartBody([
    { name: "apk", filename: "shop.apk", content: content ?? (await readFixture(SHOP.fixture)) },
  ]);
  return app.app.inject({
    method: "POST",
    url: "/api/apks/upload",
    payload,
    headers: authorization === undefined ? headers : { ...headers, authorization },
  });
}

async function releaseCount(): Promise<number> {
  const result = await pool.query<{ count: string }>("SELECT count(*) FROM apk_releases");
  return Number(result.rows[0]?.count);
}

async function appCount(): Promise<number> {
  const result = await pool.query<{ count: string }>("SELECT count(*) FROM apps");
  return Number(result.rows[0]?.count);
}

describe("POST /api/apks/upload with an upload token configured", () => {
  it("accepts the upload token as a bearer token", async () => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN });

    const response = await uploadShop(app, `Bearer ${UPLOAD_TOKEN}`);

    expect(response.statusCode).toBe(201);
    expect(await releaseCount()).toBe(1);
  });

  it("accepts the scheme in any letter case", async () => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN });

    const response = await uploadShop(app, `bEaReR ${UPLOAD_TOKEN}`);

    expect(response.statusCode).toBe(201);
  });

  it("rejects a request without an Authorization header with 401 unauthorized", async () => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN });

    const response = await uploadShop(app);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ success: false, error: { code: "unauthorized" } });
  });

  it("names the upload token in the message, not the admin token", async () => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN });

    const body = (await uploadShop(app)).json() as ErrorBody;

    expect(body.error.message).toContain("upload token");
    expect(body.error.message).not.toContain("admin");
  });

  it.each([
    ["a wrong token", "Bearer wrong-token"],
    ["a prefix of the token", `Bearer ${UPLOAD_TOKEN.slice(0, -1)}`],
    ["the token with extra characters", `Bearer ${UPLOAD_TOKEN}x`],
    ["an empty token", "Bearer "],
    ["another scheme", `Basic ${UPLOAD_TOKEN}`],
    ["the bare token", UPLOAD_TOKEN],
  ])("rejects %s with 401 and stores nothing", async (_label, authorization) => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN });

    const response = await uploadShop(app, authorization);

    expect(response.statusCode).toBe(401);
    expect(await releaseCount()).toBe(0);
    expect(await appCount()).toBe(1);
    expect(await readdir(app.uploadDir)).toEqual([]);
  });

  it("checks the token before the body, so a bad body from an unknown caller still gets 401", async () => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN });

    const notMultipart = await app.app.inject({
      method: "POST",
      url: "/api/apks/upload",
      payload: "not a form",
      headers: { "content-type": "text/plain" },
    });
    const notAnApk = await uploadShop(app, undefined, Buffer.from("plain text, not a zip"));
    const brokenApk = await uploadShop(app, undefined, fakeApk());

    for (const response of [notMultipart, notAnApk, brokenApk]) {
      expect(response.statusCode).toBe(401);
      expect((response.json() as ErrorBody).error.code).toBe("unauthorized");
    }
  });

  it("still validates the body once the token is accepted", async () => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN });

    const response = await uploadShop(app, `Bearer ${UPLOAD_TOKEN}`, fakeApk());

    expect(response.statusCode).toBe(422);
    expect((response.json() as ErrorBody).error.code).toBe("invalid_apk");
  });

  it("leaves reading routes open", async () => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN });
    const { release } = await seedRelease(pool, app.uploadDir, { versionCode: 1 });

    const list = await app.app.inject({ method: "GET", url: "/api/apks" });
    const latest = await app.app.inject({ method: "GET", url: "/api/apks/latest" });
    const download = await app.app.inject({
      method: "GET",
      url: `/api/apks/download/${release.id}`,
    });
    const apps = await app.app.inject({ method: "GET", url: "/api/apps" });

    expect([list.statusCode, latest.statusCode, download.statusCode, apps.statusCode]).toEqual([
      200, 200, 200, 200,
    ]);
  });

  it("does not let the upload token delete a release", async () => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN, adminToken: ADMIN_TOKEN });
    const { release } = await seedRelease(pool, app.uploadDir, { versionCode: 1 });

    const response = await app.app.inject({
      method: "DELETE",
      url: `/api/apks/${release.id}`,
      headers: { authorization: `Bearer ${UPLOAD_TOKEN}` },
    });

    expect(response.statusCode).toBe(401);
    expect(await releaseCount()).toBe(1);
  });

  it("does not let the upload token delete a release when no admin token is set", async () => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN });
    const { release } = await seedRelease(pool, app.uploadDir, { versionCode: 1 });

    const response = await app.app.inject({
      method: "DELETE",
      url: `/api/apks/${release.id}`,
      headers: { authorization: `Bearer ${UPLOAD_TOKEN}` },
    });

    expect(response.statusCode).toBe(403);
    expect(await releaseCount()).toBe(1);
  });
});

describe("POST /api/apks/upload with both tokens configured", () => {
  it("accepts the admin token as well", async () => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN, adminToken: ADMIN_TOKEN });

    const response = await uploadShop(app, `Bearer ${ADMIN_TOKEN}`);

    expect(response.statusCode).toBe(201);
  });

  it("still accepts the upload token", async () => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN, adminToken: ADMIN_TOKEN });

    const response = await uploadShop(app, `Bearer ${UPLOAD_TOKEN}`);

    expect(response.statusCode).toBe(201);
  });

  it("rejects a token that is neither", async () => {
    const app = await startApp({ uploadToken: UPLOAD_TOKEN, adminToken: ADMIN_TOKEN });

    const response = await uploadShop(app, "Bearer something-else");

    expect(response.statusCode).toBe(401);
    expect(await releaseCount()).toBe(0);
  });
});

describe("POST /api/apks/upload without an upload token configured", () => {
  it("stays open: no header needed", async () => {
    const app = await startApp({});

    const response = await uploadShop(app);

    expect(response.statusCode).toBe(201);
  });

  it("ignores an Authorization header that does not match anything", async () => {
    const app = await startApp({});

    const response = await uploadShop(app, "Bearer anything");

    expect(response.statusCode).toBe(201);
  });

  it("stays open when only an admin token is configured", async () => {
    const app = await startApp({ adminToken: ADMIN_TOKEN });

    const response = await uploadShop(app);

    expect(response.statusCode).toBe(201);
  });
});

describe("upload token handling in logs", () => {
  it("does not write the submitted or the configured token to the logs", async () => {
    const logs = captureLogs();
    const base = await createTestApp(pool);
    await base.app.close();
    testApp = base;
    const app = await buildApp({
      logger: { level: "debug", stream: logs.stream },
      pool,
      uploadDir: base.uploadDir,
      maxUploadBytes: 64 * 1024,
      uploadToken: UPLOAD_TOKEN,
    });
    const { payload, headers } = multipartBody([
      { name: "apk", filename: "shop.apk", content: await readFixture(SHOP.fixture) },
    ]);

    await app.inject({
      method: "POST",
      url: "/api/apks/upload",
      payload,
      headers: { ...headers, authorization: "Bearer submitted-secret-91c2" },
    });
    await app.inject({
      method: "POST",
      url: "/api/apks/upload",
      payload,
      headers: { ...headers, authorization: `Bearer ${UPLOAD_TOKEN}` },
    });
    await app.close();

    const text = JSON.stringify(logs.entries());
    expect(text).not.toContain("submitted-secret-91c2");
    expect(text).not.toContain(UPLOAD_TOKEN);
  });
});
