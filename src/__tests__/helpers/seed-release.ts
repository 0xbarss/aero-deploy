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
}

/** Writes an APK file into `uploadDir` and registers it, the way a finished upload would. */
export async function seedRelease(
  pool: Pool,
  uploadDir: string,
  options: SeedOptions,
): Promise<{ release: ApkRelease; content: Buffer }> {
  const content = options.content ?? fakeApk();
  const storedName = `${options.versionCode}-seed.apk`;
  await writeFile(join(uploadDir, storedName), content);
  const release = await insertRelease(pool, {
    versionName: options.versionName ?? `1.0.${options.versionCode}`,
    versionCode: options.versionCode,
    fileName: options.fileName ?? "app-debug.apk",
    filePath: storedName,
    fileSize: content.length,
    releaseNotes: options.releaseNotes ?? null,
  });
  return { release, content };
}
