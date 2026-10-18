import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateUp } from "../db/migrate.js";
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

interface AppItem {
  id: number;
  name: string;
  packageName: string | null;
  createdAt: string;
  latestRelease: {
    id: number;
    versionName: string;
    versionCode: number;
    fileSize: number;
    sha256: string | null;
    createdAt: string;
  } | null;
}

function listApps() {
  return testApp.app.inject({ method: "GET", url: "/api/apps" });
}

function rename(id: number | string, payload: unknown) {
  return testApp.app.inject({
    method: "PATCH",
    url: `/api/apps/${id}`,
    payload: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
}

async function appName(id: number): Promise<string | undefined> {
  const result = await pool.query<{ name: string }>("SELECT name FROM apps WHERE id = $1", [id]);
  return result.rows[0]?.name;
}

describe("GET /api/apps", () => {
  it("lists the default app with no release", async () => {
    const response = await listApps();

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: AppItem[] }>();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([
      {
        id: await defaultAppId(pool),
        name: "Default App",
        packageName: null,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) as string,
        latestRelease: null,
      },
    ]);
  });

  it("lists every app in id order, each with its newest release", async () => {
    const shopId = await seedApp(pool, { name: "Zulu Shop", packageName: "com.example.shop" });
    const notesId = await seedApp(pool, { name: "Alpha Notes", packageName: "com.example.notes" });
    await seedRelease(pool, testApp.uploadDir, { appId: shopId, versionCode: 12 });
    const newest = await seedRelease(pool, testApp.uploadDir, {
      appId: shopId,
      versionCode: 14,
      versionName: "1.4.0",
    });
    await seedRelease(pool, testApp.uploadDir, { appId: shopId, versionCode: 13 });

    const response = await listApps();

    const data = response.json<{ data: AppItem[] }>().data;
    expect(data.map((item) => item.id)).toEqual([await defaultAppId(pool), shopId, notesId]);
    const shop = data.find((item) => item.id === shopId);
    expect(shop).toEqual({
      id: shopId,
      name: "Zulu Shop",
      packageName: "com.example.shop",
      createdAt: expect.any(String) as string,
      latestRelease: {
        id: newest.release.id,
        versionName: "1.4.0",
        versionCode: 14,
        fileSize: newest.content.length,
        sha256: sha256Hex(newest.content),
        createdAt: newest.release.createdAt.toISOString(),
      },
    });
    expect(data.find((item) => item.id === notesId)?.latestRelease).toBeNull();
  });

  it("keeps a missing checksum as null", async () => {
    const appId = await seedApp(pool, { name: "Old", packageName: "com.example.old" });
    await seedRelease(pool, testApp.uploadDir, { appId, versionCode: 1, sha256: null });

    const data = (await listApps()).json<{ data: AppItem[] }>().data;

    expect(data.find((item) => item.id === appId)?.latestRelease?.sha256).toBeNull();
  });

  it("does not expose file names or paths", async () => {
    const appId = await seedApp(pool, { name: "Shop", packageName: "com.example.shop" });
    await seedRelease(pool, testApp.uploadDir, { appId, versionCode: 1 });

    const response = await listApps();

    expect(response.body).not.toContain("filePath");
    expect(response.body).not.toContain("file_path");
    expect(response.body).not.toContain(testApp.uploadDir);
  });
});

describe("PATCH /api/apps/:id", () => {
  let shopId: number;

  beforeEach(async () => {
    shopId = await seedApp(pool, { name: "My Shop", packageName: "com.example.shop" });
  });

  it("renames the app and returns it", async () => {
    const response = await rename(shopId, { name: "Corner Shop" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        id: shopId,
        name: "Corner Shop",
        packageName: "com.example.shop",
        createdAt: expect.any(String) as string,
      },
    });
    expect(await appName(shopId)).toBe("Corner Shop");
  });

  it("shows the new name in the list", async () => {
    await rename(shopId, { name: "Corner Shop" });

    const data = (await listApps()).json<{ data: AppItem[] }>().data;
    expect(data.find((item) => item.id === shopId)?.name).toBe("Corner Shop");
  });

  it("trims the name", async () => {
    const response = await rename(shopId, { name: "  Corner Shop \t" });

    expect(response.json<{ data: { name: string } }>().data.name).toBe("Corner Shop");
  });

  it("renames the default app", async () => {
    const id = await defaultAppId(pool);

    const response = await rename(id, { name: "Field Tool" });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { packageName: string | null } }>().data.packageName).toBeNull();
    expect(await appName(id)).toBe("Field Tool");
  });

  it("lets an app change only the case of its own name", async () => {
    const response = await rename(shopId, { name: "my shop" });

    expect(response.statusCode).toBe(200);
    expect(await appName(shopId)).toBe("my shop");
  });

  it("accepts a name of exactly 100 characters, counted as code points", async () => {
    expect((await rename(shopId, { name: "x".repeat(100) })).statusCode).toBe(200);
    expect((await rename(shopId, { name: "🙂".repeat(100) })).statusCode).toBe(200);
    expect(await appName(shopId)).toBe("🙂".repeat(100));
  });

  it("answers 409 app_name_exists when another app has the name, ignoring case", async () => {
    await seedApp(pool, { name: "Notes", packageName: "com.example.notes" });

    const response = await rename(shopId, { name: "nOTES" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ success: false, error: { code: "app_name_exists" } });
    expect(await appName(shopId)).toBe("My Shop");
  });

  it("answers 404 app_not_found for an app that does not exist", async () => {
    const response = await rename(shopId + 1000, { name: "Anything" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ success: false, error: { code: "app_not_found" } });
  });

  it.each(["abc", "0", "-1", "1.5", "99999999999"])("rejects the id %j with 400", async (id) => {
    const response = await rename(id, { name: "Anything" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "validation_error" } });
  });

  it.each([
    ["no name", {}],
    ["an empty name", { name: "" }],
    ["a blank name", { name: "   " }],
    ["a name that is not text", { name: 123 }],
    ["a null name", { name: null }],
    ["a name of 101 characters", { name: "x".repeat(101) }],
    ["a NUL byte", { name: "a\u0000b" }],
    ["a line break", { name: "a\nb" }],
    ["a body that is not an object", ["Corner Shop"]],
    ["a body that is a string", "Corner Shop"],
  ])("rejects %s with 400 and changes nothing", async (_label, payload) => {
    const response = await rename(shopId, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false, error: { code: "validation_error" } });
    expect(await appName(shopId)).toBe("My Shop");
  });

  it("rejects a request without a body with 400", async () => {
    const response = await testApp.app.inject({ method: "PATCH", url: `/api/apps/${shopId}` });

    expect(response.statusCode).toBe(400);
    expect(await appName(shopId)).toBe("My Shop");
  });

  it("leaves the package name and the releases alone", async () => {
    await seedRelease(pool, testApp.uploadDir, { appId: shopId, versionCode: 12 });

    await rename(shopId, { name: "Corner Shop" });

    const app = await pool.query<{ package_name: string }>(
      "SELECT package_name FROM apps WHERE id = $1",
      [shopId],
    );
    expect(app.rows[0]?.package_name).toBe("com.example.shop");
    const releases = await pool.query<{ count: string }>(
      "SELECT count(*) FROM apk_releases WHERE app_id = $1",
      [shopId],
    );
    expect(Number(releases.rows[0]?.count)).toBe(1);
  });
});
