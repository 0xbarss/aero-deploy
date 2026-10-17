import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers/test-app.js";
import { createTestPool } from "./helpers/test-database.js";

describe("app", () => {
  let pool: Pool;
  const testApps: TestApp[] = [];

  beforeAll(() => {
    pool = createTestPool();
  });

  afterEach(async () => {
    await Promise.all(testApps.splice(0).map((testApp) => testApp.close()));
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createApp() {
    const testApp = await createTestApp(pool);
    testApps.push(testApp);
    return testApp.app;
  }

  it("answers GET /api/health", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: { status: "ok" } });
  });

  it("returns a 404 error envelope for unknown routes", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      success: false,
      error: { code: "not_found", message: "Route GET /api/nope not found" },
    });
  });
});
