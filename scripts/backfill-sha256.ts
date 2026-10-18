import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Pool } from "pg";
import {
  findReleasesWithoutHash,
  setReleaseHash,
  type ApkRelease,
} from "../src/apks/repository.js";
import { loadDatabaseUrl, loadStorageConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE = `Usage: backfill-sha256

Computes the SHA-256 of every stored APK whose release has no checksum yet.
Releases that already have a checksum are not touched.

Reads DATABASE_URL and UPLOAD_DIR from the environment (or .env when started with npm).
A release is skipped, and reported on stderr, when its file is missing, is not a file, lies
outside UPLOAD_DIR, or has a size different from the one recorded at upload.

Exit codes: 0 every release was hashed or none needed it, 1 a release was skipped or the
database could not be used, 2 invalid arguments.`;

export interface ScriptIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface BackfillSummary {
  hashed: number;
  skipped: number;
}

/** Thrown for argument problems; `run` turns it into the usage exit code. */
class UsageError extends Error {}

/** A release that cannot be hashed; the message says why. */
class SkipRelease extends Error {}

function readArguments(argv: string[]): "help" | "run" {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { help: { type: "boolean", short: "h" } },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
  if (parsed.values.help) {
    return "help";
  }
  if (parsed.positionals.length > 0) {
    throw new UsageError("this command takes no arguments");
  }
  return "run";
}

function resolveInside(uploadDir: string, filePath: string): string {
  const root = resolve(uploadDir);
  const target = resolve(root, filePath);
  const fromRoot = relative(root, target);
  if (fromRoot === "" || fromRoot.startsWith(`..${sep}`) || fromRoot === "..") {
    throw new SkipRelease("stored path is outside the upload directory");
  }
  return target;
}

async function checkFile(path: string, expectedSize: number): Promise<void> {
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      throw new SkipRelease("stored path is not a file");
    }
    size = info.size;
  } catch (error) {
    if (error instanceof SkipRelease) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SkipRelease("file not found");
    }
    throw new SkipRelease(
      `cannot read file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (size !== expectedSize) {
    throw new SkipRelease(`file size is ${size} bytes, the release recorded ${expectedSize}`);
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function hashRelease(release: ApkRelease, uploadDir: string): Promise<string> {
  const path = resolveInside(uploadDir, release.filePath);
  await checkFile(path, release.fileSize);
  try {
    return await hashFile(path);
  } catch (error) {
    throw new SkipRelease(
      `cannot read file: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}

/** Hashes the stored file of every release that has no checksum and records the result. */
export async function backfillSha256(
  pool: Pool,
  uploadDir: string,
  io: ScriptIo,
): Promise<BackfillSummary> {
  const pending = await findReleasesWithoutHash(pool);
  if (pending.length === 0) {
    io.stdout("No releases without a checksum.");
    return { hashed: 0, skipped: 0 };
  }

  const summary: BackfillSummary = { hashed: 0, skipped: 0 };
  for (const release of pending) {
    const label = `release ${release.id} (${release.fileName})`;
    try {
      const sha256 = await hashRelease(release, uploadDir);
      if (await setReleaseHash(pool, release.id, sha256)) {
        summary.hashed += 1;
        io.stdout(`Hashed ${label}: ${sha256}`);
      }
    } catch (error) {
      if (!(error instanceof SkipRelease)) {
        throw error;
      }
      summary.skipped += 1;
      io.stderr(`Skipped ${label}: ${error.message}`);
    }
  }
  io.stdout(`Hashed: ${summary.hashed}, skipped: ${summary.skipped}`);
  return summary;
}

export async function run(argv: string[], env: NodeJS.ProcessEnv, io: ScriptIo): Promise<number> {
  let mode: "help" | "run";
  try {
    mode = readArguments(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`error: ${error.message}`);
      io.stderr(USAGE);
      return EXIT_USAGE;
    }
    throw error;
  }
  if (mode === "help") {
    io.stdout(USAGE);
    return EXIT_OK;
  }

  let pool: Pool | undefined;
  try {
    const databaseUrl = loadDatabaseUrl(env);
    const { uploadDir } = loadStorageConfig(env);
    pool = createPool(databaseUrl, (error) => {
      io.stderr(`database connection error: ${error.message}`);
    });
    const summary = await backfillSha256(pool, uploadDir, io);
    return summary.skipped === 0 ? EXIT_OK : EXIT_FAILED;
  } catch (error) {
    io.stderr(`error: ${describeError(error)}`);
    return EXIT_FAILED;
  } finally {
    await pool?.end();
  }
}

function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    const first = error.errors[0] as unknown;
    return first instanceof Error ? describeError(first) : error.message;
  }
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (error.message === "" && code !== undefined) {
      return code;
    }
    return code === undefined || error.message.includes(code)
      ? error.message
      : `${code} ${error.message}`;
  }
  return String(error);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await run(process.argv.slice(2), process.env, {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
}
