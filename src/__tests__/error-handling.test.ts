import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { captureLogs } from "./helpers/log-capture.js";
import { fakeApk, multipartBody } from "./helpers/multipart.js";
import { createTestApp } from "./helpers/test-app.js";
import { createTestPool } from "./helpers/test-database.js";

let pool: Pool;

beforeAll(() => {
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
});

describe("router errors", () => {
  it("sends a URL with broken percent-encoding in the error envelope", async () => {
    const testApp = await createTestApp(pool);
    try {
      const response = await testApp.app.inject({
        method: "GET",
        url: "/api/apks/download/%E0%A4%A",
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        success: false,
        error: { code: "bad_request", message: "Request URL is not valid" },
      });
    } finally {
      await testApp.close();
    }
  });
});

describe("logging of rejected requests", () => {
  async function appWithLogs() {
    const logs = captureLogs();
    const testApp = await createTestApp(pool);
    await testApp.app.close();
    const app = await buildApp({
      logger: { level: "info", stream: logs.stream },
      pool,
      uploadDir: testApp.uploadDir,
      maxUploadBytes: 64 * 1024,
    });
    return { app, logs, close: testApp.close };
  }

  it("logs the status and error code of a rejected upload without the submitted values", async () => {
    const { app, logs, close } = await appWithLogs();
    try {
      const { payload, headers } = multipartBody([
        { name: "apk", filename: "app.apk", content: fakeApk() },
        { name: "versionCode", value: "3" },
        { name: "releaseNotes", value: "needle-4f9a" },
      ]);
      const response = await app.inject({
        method: "POST",
        url: "/api/apks/upload",
        payload,
        headers,
      });

      expect(response.statusCode).toBe(400);
      const rejected = logs.entries().filter((entry) => entry.event === "request.rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ level: 40, statusCode: 400, code: "validation_error" });
      expect(JSON.stringify(logs.entries())).not.toContain("needle-4f9a");
    } finally {
      await app.close();
      await close();
    }
  });

  it("logs a rejection that does not come from our own error types", async () => {
    const { app, logs, close } = await appWithLogs();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/apks/upload",
        payload: { versionName: "1.0.0" },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(logs.entries().filter((entry) => entry.event === "request.rejected")).toHaveLength(1);
    } finally {
      await app.close();
      await close();
    }
  });

  it("does not log unknown routes as rejected requests", async () => {
    const { app, logs, close } = await appWithLogs();
    try {
      const response = await app.inject({ method: "GET", url: "/api/nope" });

      expect(response.statusCode).toBe(404);
      expect(logs.entries().filter((entry) => entry.event === "request.rejected")).toEqual([]);
    } finally {
      await app.close();
      await close();
    }
  });
});
