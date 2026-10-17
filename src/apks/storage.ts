import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PayloadTooLargeError, ValidationError } from "../errors.js";

// An APK is a ZIP archive, so it starts with the ZIP local file header signature
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MAX_FILE_NAME_LENGTH = 255;

export interface StoredUpload {
  path: string;
  originalName: string;
  size: number;
}

/** Busboy streams do not throw on the size limit, they stop early and set `truncated`. */
export type UploadStream = Readable & { truncated?: boolean };

function sanitizeFileName(clientFileName: string): string {
  const name = posix.basename(clientFileName.replaceAll("\\", "/")).trim();
  if (!name.toLowerCase().endsWith(".apk") || name.length <= ".apk".length) {
    throw new ValidationError("apk file name must end with .apk");
  }
  if (name.length > MAX_FILE_NAME_LENGTH) {
    throw new ValidationError(`apk file name must be at most ${MAX_FILE_NAME_LENGTH} characters`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new ValidationError("apk file name contains control characters");
  }
  return name;
}

async function startsWithZipSignature(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(ZIP_SIGNATURE.length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead === buffer.length && buffer.equals(ZIP_SIGNATURE);
  } finally {
    await handle.close();
  }
}

/** Streams the upload into a temporary file inside `uploadDir`; the caller finalizes or removes it. */
export async function saveUpload(
  file: UploadStream,
  clientFileName: string,
  uploadDir: string,
): Promise<StoredUpload> {
  const originalName = sanitizeFileName(clientFileName);
  const path = join(uploadDir, `.upload-${randomUUID()}.tmp`);
  try {
    await pipeline(file, createWriteStream(path));
    if (file.truncated) {
      throw new PayloadTooLargeError("apk file exceeds the maximum upload size");
    }
    if (!(await startsWithZipSignature(path))) {
      throw new ValidationError("apk file is not a valid APK archive");
    }
    const { size } = await stat(path);
    return { path, originalName, size };
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
}

/** Moves the temporary file to its final name and returns that name relative to `uploadDir`. */
export async function finalizeUpload(
  stored: StoredUpload,
  versionCode: number,
  uploadDir: string,
): Promise<string> {
  const storedName = `${versionCode}-${randomUUID()}.apk`;
  await rename(stored.path, join(uploadDir, storedName));
  return storedName;
}
