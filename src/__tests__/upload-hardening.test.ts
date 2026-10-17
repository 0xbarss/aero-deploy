import { readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { migrateUp } from "../db/migrate.js";
import { captureLogs, waitFor } from "./helpers/log-capture.js";
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

async function releaseCount(): Promise<number> {
  const result = await pool.query<{ count: string }>("SELECT count(*) FROM apk_releases");
  return Number(result.rows[0]?.count);
}

function postOverHttp(
  port: number,
  contentType: string,
  body: Buffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/api/apks/upload",
        headers: { "content-type": contentType, "content-length": body.length },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function expectRejectedWith400(payload: Buffer | string, contentType: string) {
  const response = await testApp.app.inject({
    method: "POST",
    url: "/api/apks/upload",
    payload,
    headers: { "content-type": contentType },
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ success: false, error: { code: "validation_error" } });
  expect(await releaseCount()).toBe(0);
  expect(await readdir(testApp.uploadDir)).toEqual([]);
}

describe("NUL bytes in text fields", () => {
  function upload(parts: MultipartPart[]) {
    const { payload, headers } = multipartBody(parts);
    return testApp.app.inject({ method: "POST", url: "/api/apks/upload", payload, headers });
  }

  it.each([
    ["versionName", { versionName: "1\u00002", versionCode: "3" }],
    ["releaseNotes", { versionName: "1.0.2", versionCode: "3", releaseNotes: "a\u0000b" }],
  ])("answers 400 instead of 500 for a NUL byte in %s", async (_field, fields) => {
    const response = await upload([
      { name: "apk", filename: "app.apk", content: fakeApk() },
      ...Object.entries(fields).map(([name, value]) => ({ name, value })),
    ]);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false, error: { code: "validation_error" } });
    expect(await releaseCount()).toBe(0);
    expect(await readdir(testApp.uploadDir)).toEqual([]);
  });
});

describe("malformed multipart bodies", () => {
  const boundary = "xx";
  const contentType = `multipart/form-data; boundary=${boundary}`;
  const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="apk"; filename="a.apk"\r\n\r\n`;

  it("a content type without a boundary", async () => {
    await expectRejectedWith400("x", "multipart/form-data");
  });

  it("a body that ends before the closing boundary", async () => {
    await expectRejectedWith400(
      `--${boundary}\r\nContent-Disposition: form-data; name="versionName"\r\n\r\n1\r\n`,
      contentType,
    );
  });

  // light-my-request never delivers a file part that is cut off mid-file, so this case uses a real socket
  it("a body that ends in the middle of the file part", async () => {
    await testApp.app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = testApp.app.server.address() as AddressInfo;
    const body = Buffer.concat([Buffer.from(fileHeader), fakeApk(512)]);

    const response = await postOverHttp(port, contentType, body);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      error: { code: "validation_error" },
    });
    expect(await releaseCount()).toBe(0);
    expect(await readdir(testApp.uploadDir)).toEqual([]);
  });
});

describe("a client that disconnects during an upload", () => {
  it("removes the partial file and logs a warning instead of a 500-level error", async () => {
    const logs = captureLogs();
    await testApp.close();
    const app = await buildApp({
      logger: { level: "info", stream: logs.stream },
      pool,
      uploadDir: testApp.uploadDir,
      maxUploadBytes: 10 * 1024 * 1024,
    });
    testApp = {
      app,
      uploadDir: testApp.uploadDir,
      close: async () => {
        await app.close();
      },
    };
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;

    const socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => undefined);
    socket.write(
      "POST /api/apks/upload HTTP/1.1\r\nHost: localhost\r\n" +
        "Content-Type: multipart/form-data; boundary=xx\r\nContent-Length: 5000000\r\n\r\n" +
        '--xx\r\nContent-Disposition: form-data; name="apk"; filename="a.apk"\r\n\r\n',
    );
    socket.write(fakeApk(100_000));

    const started = await waitFor(() => readdirSync(testApp.uploadDir).length === 1);
    expect(started).toBe(true);
    socket.destroy();

    const logged = await waitFor(() =>
      logs.entries().some((entry) => entry.event === "request.rejected"),
    );
    expect(logged).toBe(true);
    expect(logs.entries().find((entry) => entry.event === "request.rejected")).toMatchObject({
      level: 40,
      code: "request_aborted",
    });
    expect(logs.entries().filter((entry) => entry.level >= 50)).toEqual([]);
    expect(await readdir(testApp.uploadDir)).toEqual([]);
    expect(await releaseCount()).toBe(0);
  });
});
