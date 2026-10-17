import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateUp } from "../db/migrate.js";
import { fakeApk, multipartBody, type MultipartPart } from "./helpers/multipart.js";
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

function upload(parts: MultipartPart[]) {
  const { payload, headers } = multipartBody(parts);
  return testApp.app.inject({ method: "POST", url: "/api/apks/upload", payload, headers });
}

function validFields(overrides: Record<string, string> = {}): MultipartPart[] {
  const fields = { versionName: "1.0.2", versionCode: "3", ...overrides };
  return Object.entries(fields).map(([name, value]) => ({ name, value }));
}

async function releaseCount(): Promise<number> {
  const result = await pool.query<{ count: string }>("SELECT count(*) FROM apk_releases");
  return Number(result.rows[0]?.count);
}

describe("POST /api/apks/upload", () => {
  it("stores the file, records the release and returns 201", async () => {
    const content = fakeApk(4096);
    const response = await upload([
      { name: "apk", filename: "app-debug.apk", content },
      ...validFields({ releaseNotes: "Bug fixes" }),
    ]);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      success: true,
      message: "APK successfully uploaded and registered",
      data: {
        id: 1,
        versionName: "1.0.2",
        versionCode: 3,
        fileName: "app-debug.apk",
        fileSize: "4.0 KB",
      },
    });

    const row = await pool.query<{
      file_name: string;
      file_path: string;
      file_size: string;
      release_notes: string | null;
    }>("SELECT file_name, file_path, file_size, release_notes FROM apk_releases");
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toMatchObject({
      file_name: "app-debug.apk",
      file_size: String(content.length),
      release_notes: "Bug fixes",
    });

    const stored = await readFile(join(testApp.uploadDir, row.rows[0]?.file_path ?? "missing"));
    expect(stored.equals(content)).toBe(true);
    expect(await readdir(testApp.uploadDir)).toHaveLength(1);
  });

  it("accepts text fields sent after the file, as curl does", async () => {
    const response = await upload([
      { name: "apk", filename: "app.apk", content: fakeApk() },
      ...validFields(),
    ]);

    expect(response.statusCode).toBe(201);
  });

  it("accepts text fields sent before the file", async () => {
    const response = await upload([
      ...validFields(),
      { name: "apk", filename: "app.apk", content: fakeApk() },
    ]);

    expect(response.statusCode).toBe(201);
  });

  it("treats releaseNotes as optional", async () => {
    await upload([{ name: "apk", filename: "app.apk", content: fakeApk() }, ...validFields()]);

    const row = await pool.query<{ release_notes: string | null }>(
      "SELECT release_notes FROM apk_releases",
    );
    expect(row.rows[0]?.release_notes).toBeNull();
  });

  it("keeps only the base name of the client file name and stays inside the upload dir", async () => {
    const response = await upload([
      { name: "apk", filename: "../../evil.apk", content: fakeApk() },
      ...validFields(),
    ]);

    expect(response.statusCode).toBe(201);
    expect(response.json<{ data: { fileName: string } }>().data.fileName).toBe("evil.apk");
    const files = await readdir(testApp.uploadDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^3-[0-9a-f-]{36}\.apk$/);
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
      expect(await readdir(testApp.uploadDir)).toEqual([]);
    }

    it("missing apk file", async () => {
      await expectRejected(validFields(), 400, "validation_error");
    });

    it("missing versionName", async () => {
      await expectRejected(
        [
          { name: "apk", filename: "app.apk", content: fakeApk() },
          { name: "versionCode", value: "3" },
        ],
        400,
        "validation_error",
      );
    });

    it.each(["abc", "0", "-1", "1.5", "", "99999999999"])("versionCode=%j", async (versionCode) => {
      await expectRejected(
        [{ name: "apk", filename: "app.apk", content: fakeApk() }, ...validFields({ versionCode })],
        400,
        "validation_error",
      );
    });

    it("versionName longer than 50 characters", async () => {
      await expectRejected(
        [
          { name: "apk", filename: "app.apk", content: fakeApk() },
          ...validFields({ versionName: "x".repeat(51) }),
        ],
        400,
        "validation_error",
      );
    });

    it("a file name that does not end in .apk", async () => {
      await expectRejected(
        [{ name: "apk", filename: "app.zip", content: fakeApk() }, ...validFields()],
        400,
        "validation_error",
      );
    });

    it("content that is not a ZIP archive", async () => {
      await expectRejected(
        [
          { name: "apk", filename: "app.apk", content: Buffer.from("just some text") },
          ...validFields(),
        ],
        400,
        "validation_error",
      );
    });

    it("a file sent under the wrong field name", async () => {
      await expectRejected(
        [{ name: "file", filename: "app.apk", content: fakeApk() }, ...validFields()],
        400,
        "validation_error",
      );
    });

    it("a duplicate versionCode", async () => {
      const first = await upload([
        { name: "apk", filename: "first.apk", content: fakeApk() },
        ...validFields(),
      ]);
      expect(first.statusCode).toBe(201);

      const second = await upload([
        { name: "apk", filename: "second.apk", content: fakeApk() },
        ...validFields({ versionName: "1.0.3" }),
      ]);

      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({
        success: false,
        error: { code: "version_code_exists" },
      });
      expect(await releaseCount()).toBe(1);
      expect(await readdir(testApp.uploadDir)).toHaveLength(1);
    });
  });

  it("returns 413 and removes the partial file when the upload is too large", async () => {
    await testApp.close();
    testApp = await createTestApp(pool, { maxUploadBytes: 1024 });

    const response = await upload([
      { name: "apk", filename: "big.apk", content: fakeApk(8192) },
      ...validFields(),
    ]);

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
