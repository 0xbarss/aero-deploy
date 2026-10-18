import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../scripts/upload-apk.js";
import { migrateUp } from "../db/migrate.js";
import { fakeApk } from "./helpers/multipart.js";
import { readFixture, SHOP } from "./helpers/fixtures.js";
import { sha256Hex } from "./helpers/seed-release.js";
import { createTestApp, type TestApp } from "./helpers/test-app.js";
import { createTestPool, resetDatabase } from "./helpers/test-database.js";

let pool: Pool;
let testApp: TestApp;
let serverUrl: string;
let workDir: string;

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
  await testApp.app.listen({ host: "127.0.0.1", port: 0 });
  serverUrl = `http://127.0.0.1:${(testApp.app.server.address() as AddressInfo).port}`;
  workDir = await mkdtemp(join(tmpdir(), "aero-script-"));
});

afterEach(async () => {
  await testApp.close();
  await rm(workDir, { recursive: true, force: true });
});

async function writeApk(name = "app-debug.apk", content?: Buffer): Promise<string> {
  const path = join(workDir, name);
  await writeFile(path, content ?? (await readFixture(SHOP.fixture)));
  return path;
}

async function runScript(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, env, {
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

async function releaseCount(): Promise<number> {
  const result = await pool.query<{ count: string }>("SELECT count(*) FROM apk_releases");
  return Number(result.rows[0]?.count);
}

describe("upload script", () => {
  it("uploads the file with its version fields and exits 0", async () => {
    const content = await readFixture(SHOP.fixture);
    const apk = await writeApk("app-debug.apk", content);

    const result = await runScript([
      apk,
      "--version-name",
      "1.2.0",
      "--version-code",
      "12",
      "--notes",
      "Nightly build",
      "--server",
      serverUrl,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("app-debug.apk");
    expect(result.stdout).toContain("1.2.0");
    expect(result.stderr).toBe("");

    const rows = await pool.query<{
      version_name: string;
      version_code: number;
      file_name: string;
      release_notes: string | null;
      file_path: string;
    }>("SELECT * FROM apk_releases");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      version_name: "1.2.0",
      version_code: 12,
      file_name: "app-debug.apk",
      release_notes: "Nightly build",
    });
    const stored = await readFile(join(testApp.uploadDir, rows.rows[0]?.file_path ?? "missing"));
    expect(stored.equals(content)).toBe(true);
  });

  it("prints the SHA-256 the server returned, on its own line", async () => {
    const content = await readFixture(SHOP.fixture);
    const apk = await writeApk("app-debug.apk", content);

    const result = await runScript([
      apk,
      "--version-name",
      "1.2.0",
      "--version-code",
      "12",
      "--server",
      serverUrl,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout.split("\n")).toContain(`SHA-256 ${sha256Hex(content)}`);
    const row = await pool.query<{ sha256: string }>("SELECT sha256 FROM apk_releases");
    expect(row.rows[0]?.sha256).toBe(sha256Hex(content));
  });

  it("still reports the upload when the server response has no hash", async () => {
    const apk = await writeApk();
    const older = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(201, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            success: true,
            data: {
              id: 7,
              versionName: "1.0.0",
              versionCode: 1,
              fileName: "app-debug.apk",
              fileSize: "4.0 KB",
            },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => older.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = older.address() as AddressInfo;

      const result = await runScript([
        apk,
        "--version-name",
        "1.2.0",
        "--version-code",
        "12",
        "--server",
        `http://127.0.0.1:${port}`,
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("as release 7");
      expect(result.stdout).not.toContain("SHA-256");
    } finally {
      await new Promise<void>((resolve) => older.close(() => resolve()));
    }
  });

  it("sends file names and notes with spaces, quotes, newlines and non-ASCII text unchanged", async () => {
    const apk = await writeApk("my app (1).apk");
    const notes = 'Line one\nLine "two"\r\n--boundary-like text, çğ ü 🙂';

    const result = await runScript([
      apk,
      "--version-name",
      "1.2.0",
      "--version-code",
      "12",
      "--notes",
      notes,
      "--server",
      serverUrl,
    ]);

    expect(result.code).toBe(0);
    const row = await pool.query<{
      file_name: string;
      version_name: string;
      release_notes: string;
    }>("SELECT file_name, version_name, release_notes FROM apk_releases");
    expect(row.rows[0]).toEqual({
      file_name: "my app (1).apk",
      version_name: "1.2.0",
      release_notes: notes,
    });
  });

  it("treats the release notes as optional", async () => {
    const apk = await writeApk();

    const result = await runScript([
      apk,
      "--version-name",
      "1.2.0",
      "--version-code",
      "12",
      "--server",
      serverUrl,
    ]);

    expect(result.code).toBe(0);
    const row = await pool.query<{ release_notes: string | null }>(
      "SELECT release_notes FROM apk_releases",
    );
    expect(row.rows[0]?.release_notes).toBeNull();
  });

  it("reads the server address from AERODEPLOY_URL, with a trailing slash", async () => {
    const apk = await writeApk();

    const result = await runScript([apk, "--version-name", "1.2.0", "--version-code", "12"], {
      AERODEPLOY_URL: `${serverUrl}/`,
    });

    expect(result.code).toBe(0);
    expect(await releaseCount()).toBe(1);
  });

  it("prefers --server over AERODEPLOY_URL", async () => {
    const apk = await writeApk();

    const result = await runScript(
      [apk, "--version-name", "1.2.0", "--version-code", "12", "--server", serverUrl],
      { AERODEPLOY_URL: "http://127.0.0.1:1" },
    );

    expect(result.code).toBe(0);
  });

  describe("fails with exit code 1 and a readable message", () => {
    it("on a duplicate versionCode, naming the server's error code", async () => {
      const apk = await writeApk();
      const args = [apk, "--version-name", "1.2.0", "--version-code", "12", "--server", serverUrl];
      expect((await runScript(args)).code).toBe(0);

      const result = await runScript(args);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("409");
      expect(result.stderr).toContain("version_code_exists");
      expect(result.stderr).toContain("versionCode 12 is already registered");
      expect(await releaseCount()).toBe(1);
    });

    it("when the server rejects the file, passing on the server's message", async () => {
      const apk = await writeApk("app.apk", Buffer.from("not an archive"));

      const result = await runScript([
        apk,
        "--version-name",
        "1.2.0",
        "--version-code",
        "12",
        "--server",
        serverUrl,
      ]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("validation_error");
      expect(result.stderr).toContain("not a valid APK archive");
    });

    it("when the server cannot be reached", async () => {
      const apk = await writeApk();
      await testApp.app.close();

      const result = await runScript([
        apk,
        "--version-name",
        "1.2.0",
        "--version-code",
        "12",
        "--server",
        serverUrl,
      ]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Could not reach");
      expect(result.stderr).toContain(serverUrl);
      expect(result.stderr).toContain("ECONNREFUSED");
      expect(result.stderr.match(/ECONNREFUSED/g)).toHaveLength(1);
    });

    it("when the server rejects the file as too large", async () => {
      await testApp.close();
      testApp = await createTestApp(pool, { maxUploadBytes: 1024 });
      await testApp.app.listen({ host: "127.0.0.1", port: 0 });
      serverUrl = `http://127.0.0.1:${(testApp.app.server.address() as AddressInfo).port}`;
      const apk = await writeApk("big.apk", fakeApk(512 * 1024));

      const result = await runScript([
        apk,
        "--version-name",
        "1.2.0",
        "--version-code",
        "12",
        "--server",
        serverUrl,
      ]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("413");
      expect(result.stderr).toContain("file_too_large");
      expect(await releaseCount()).toBe(0);
    });

    it("when the apk file does not exist, without contacting the server", async () => {
      const result = await runScript([
        join(workDir, "missing.apk"),
        "--version-name",
        "1.2.0",
        "--version-code",
        "12",
        "--server",
        serverUrl,
      ]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("missing.apk");
      expect(result.stderr).toContain("not found");
      expect(await releaseCount()).toBe(0);
    });

    it("when the apk path is a directory", async () => {
      const result = await runScript([
        workDir,
        "--version-name",
        "1.2.0",
        "--version-code",
        "12",
        "--server",
        serverUrl,
      ]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("not a file");
    });
  });

  describe("fails with exit code 2 and the usage text on bad arguments", () => {
    it("with no arguments", async () => {
      const result = await runScript([]);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain("Usage:");
    });

    it("without --version-code", async () => {
      const apk = await writeApk();

      const result = await runScript([apk, "--version-name", "1.0.0", "--server", serverUrl]);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain("--version-code");
      expect(await releaseCount()).toBe(0);
    });

    it("without --version-name", async () => {
      const apk = await writeApk();

      const result = await runScript([apk, "--version-code", "1", "--server", serverUrl]);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain("--version-name");
    });

    it.each(["abc", "0", "-1", "1.5", ""])("with --version-code=%j", async (versionCode) => {
      const apk = await writeApk();

      const result = await runScript([
        apk,
        "--version-name",
        "1.0.0",
        "--version-code",
        versionCode,
        "--server",
        serverUrl,
      ]);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain("--version-code");
      expect(await releaseCount()).toBe(0);
    });

    it("with an unknown option", async () => {
      const apk = await writeApk();

      const result = await runScript([apk, "--bogus", "x"]);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain("--bogus");
    });

    it("with more than one apk path", async () => {
      const apk = await writeApk();

      const result = await runScript([apk, apk, "--version-name", "1", "--version-code", "1"]);

      expect(result.code).toBe(2);
    });

    it.each(["localhost:3000", "ftp://localhost", "not a url"])(
      "with --server=%j",
      async (server) => {
        const apk = await writeApk();

        const result = await runScript([
          apk,
          "--version-name",
          "1.0.0",
          "--version-code",
          "1",
          "--server",
          server,
        ]);

        expect(result.code).toBe(2);
        expect(result.stderr).toContain("--server");
      },
    );
  });

  it("prints the usage text on stdout and exits 0 for --help", async () => {
    const result = await runScript(["--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stderr).toBe("");
  });
});
