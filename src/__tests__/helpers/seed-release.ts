import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { insertRelease, type ApkRelease } from "../../apks/repository.js";
import { fakeApk } from "./multipart.js";

export interface SeedOptions {
  versionCode: number;
  versionName?: string;
  fileName?: string;
  releaseNotes?: string | null;
  content?: Buffer;
  /** Defaults to the default app, the one without a package name. */
  appId?: number;
  /** Defaults to the hash of `content`; pass null to seed a release from before checksums existed. */
  sha256?: string | null;
}

export function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function defaultAppId(pool: Pool): Promise<number> {
  const result = await pool.query<{ id: number }>("SELECT id FROM apps WHERE package_name IS NULL");
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("the default app is missing; run the migrations first");
  }
  return row.id;
}

export interface SeedAppOptions {
  name: string;
  packageName?: string | null;
}

/** Creates an extra app directly in SQL, since the API has no way to create one yet. */
export async function seedApp(pool: Pool, options: SeedAppOptions): Promise<number> {
  const result = await pool.query<{ id: number }>(
    "INSERT INTO apps (name, package_name) VALUES ($1, $2) RETURNING id",
    [options.name, options.packageName ?? null],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("insert into apps returned no row");
  }
  return row.id;
}

/** Writes an APK file into `uploadDir` and registers it, the way a finished upload would. */
export async function seedRelease(
  pool: Pool,
  uploadDir: string,
  options: SeedOptions,
): Promise<{ release: ApkRelease; content: Buffer }> {
  const content = options.content ?? fakeApk();
  const appId = options.appId ?? (await defaultAppId(pool));
  const storedName = `${appId}-${options.versionCode}-seed.apk`;
  await writeFile(join(uploadDir, storedName), content);
  const release = await insertRelease(pool, {
    appId,
    versionName: options.versionName ?? `1.0.${options.versionCode}`,
    versionCode: options.versionCode,
    fileName: options.fileName ?? "app-debug.apk",
    filePath: storedName,
    fileSize: content.length,
    sha256: options.sha256 === undefined ? sha256Hex(content) : options.sha256,
    releaseNotes: options.releaseNotes ?? null,
  });
  return { release, content };
}
