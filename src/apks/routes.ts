import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { ValidationError } from "../errors.js";
import { formatFileSize } from "../format-file-size.js";
import { insertRelease } from "./repository.js";
import { finalizeUpload, saveUpload, type StoredUpload } from "./storage.js";
import { parseUploadFields } from "./upload-fields.js";

export interface ApkRoutesOptions {
  pool: Pool;
  uploadDir: string;
}

async function removeFile(path: string, log: FastifyBaseLogger): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (error) {
    log.warn({ event: "upload.cleanup_failed", path, err: error });
  }
}

export function registerApkRoutes(app: FastifyInstance, options: ApkRoutesOptions): void {
  const { pool, uploadDir } = options;

  app.post("/api/apks/upload", async (request, reply) => {
    const fields = new Map<string, string>();
    let stored: StoredUpload | undefined;
    let currentPath: string | undefined;

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "apk") {
            throw new ValidationError(`unexpected file field "${part.fieldname}"`);
          }
          stored = await saveUpload(part.file, part.filename, uploadDir);
          currentPath = stored.path;
        } else if (typeof part.value === "string") {
          fields.set(part.fieldname, part.value);
        }
      }

      if (stored === undefined) {
        throw new ValidationError("apk file is required");
      }
      const release = parseUploadFields(Object.fromEntries(fields));

      const storedName = await finalizeUpload(stored, release.versionCode, uploadDir);
      currentPath = join(uploadDir, storedName);

      const row = await insertRelease(pool, {
        ...release,
        fileName: stored.originalName,
        filePath: storedName,
        fileSize: stored.size,
      });

      return reply.code(201).send({
        success: true,
        message: "APK successfully uploaded and registered",
        data: {
          id: row.id,
          versionName: row.versionName,
          versionCode: row.versionCode,
          fileName: row.fileName,
          fileSize: formatFileSize(row.fileSize),
        },
      });
    } catch (error) {
      if (currentPath !== undefined) {
        await removeFile(currentPath, request.log);
      }
      throw error;
    }
  });
}
