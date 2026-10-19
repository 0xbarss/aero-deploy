import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { probeDownload } from "../../public/download.js";
import { migrateUp } from "../db/migrate.js";
import { fakeApk } from "./helpers/multipart.js";
import { seedRelease } from "./helpers/seed-release.js";
import { createTestApp, type TestApp } from "./helpers/test-app.js";
import {
  clearReleasesAndExtraApps,
  createTestPool,
  resetDatabase,
} from "./helpers/test-database.js";

let pool: Pool;
let testApp: TestApp;
let origin: string;

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
  origin = await testApp.app.listen({ host: "127.0.0.1", port: 0 });
});

afterEach(async () => {
  await testApp.close();
});

function downloadUrl(id: number | string): string {
  return `${origin}/api/apks/download/${id}`;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (address === null || typeof address === "string") {
    throw new Error("no port was assigned");
  }
  return address.port;
}

describe("probeDownload against the server", () => {
  it("accepts a release whose file is there", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, {
      versionCode: 1,
      content: fakeApk(4 * 1024 * 1024),
    });

    await expect(probeDownload(downloadUrl(release.id))).resolves.toEqual({ ok: true });
  });

  it("reports a file that is gone from the disk", async () => {
    const { release } = await seedRelease(pool, testApp.uploadDir, { versionCode: 1 });
    await rm(join(testApp.uploadDir, release.filePath));

    const result = await probeDownload(downloadUrl(release.id));

    expect(result).toMatchObject({
      ok: false,
      status: 404,
      body: { success: false, error: { code: "apk_file_missing" } },
    });
  });

  it("reports an unknown release", async () => {
    const result = await probeDownload(downloadUrl(99999));

    expect(result).toMatchObject({
      ok: false,
      status: 404,
      body: { error: { code: "release_not_found" } },
    });
  });

  it("reports a bad release id", async () => {
    const result = await probeDownload(downloadUrl("abc"));

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      body: { error: { code: "validation_error" } },
    });
  });

  it("says the server cannot be reached when nothing answers", async () => {
    const port = await unusedPort();

    await expect(probeDownload(`http://127.0.0.1:${port}/api/apks/download/1`)).rejects.toThrow(
      "Cannot reach the server. Check that it is running, then try again.",
    );
  });
});

describe("probeDownload with a stand-in for fetch", () => {
  it("asks with GET and drops the body once the headers have arrived", async () => {
    let cancelled = false;
    let method: string | undefined;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const stub = (_input: string | URL | Request, init?: RequestInit) => {
      method = init?.method ?? "GET";
      return Promise.resolve(new Response(body, { status: 200 }));
    };

    const result = await probeDownload("http://server.test/api/apks/download/1", stub);

    expect(result).toEqual({ ok: true });
    expect(method).toBe("GET");
    expect(cancelled).toBe(true);
  });

  it("returns no body for an error page that is not JSON", async () => {
    const stub = () => Promise.resolve(new Response("<html>Bad gateway</html>", { status: 502 }));

    const result = await probeDownload("http://server.test/api/apks/download/1", stub);

    expect(result).toEqual({ ok: false, status: 502, body: null });
  });
});
