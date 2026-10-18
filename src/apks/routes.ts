import { open, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { AppRequiredError, NotFoundError, ValidationError } from "../errors.js";
import { formatFileSize } from "../format-file-size.js";
import { countApps, findDefaultApp } from "./apps-repository.js";
import { buildContentDisposition } from "./content-disposition.js";
import { translateMultipartError } from "./multipart-errors.js";
import { parseListQuery, parseReleaseFilter } from "./query-params.js";
import { parseReleaseId } from "./release-id.js";
import {
  findLatestRelease,
  findReleaseById,
  insertRelease,
  listReleases,
  type ApkRelease,
  type ApkReleaseWithApp,
} from "./repository.js";
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

function downloadUrl(request: FastifyRequest, releaseId: number): string {
  return `${request.protocol}://${request.host}/api/apks/download/${releaseId}`;
}

function listItem(request: FastifyRequest, release: ApkReleaseWithApp) {
  return {
    id: release.id,
    appId: release.appId,
    appName: release.appName,
    versionName: release.versionName,
    versionCode: release.versionCode,
    fileName: release.fileName,
    fileSize: release.fileSize,
    sha256: release.sha256,
    releaseNotes: release.releaseNotes,
    createdAt: release.createdAt.toISOString(),
    downloadUrl: downloadUrl(request, release.id),
  };
}

function latestView(request: FastifyRequest, release: ApkRelease) {
  return {
    id: release.id,
    versionName: release.versionName,
    versionCode: release.versionCode,
    fileSize: release.fileSize,
    sha256: release.sha256,
    releaseNotes: release.releaseNotes,
    downloadUrl: downloadUrl(request, release.id),
  };
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
      const defaultApp = await findDefaultApp(pool);

      const storedName = await finalizeUpload(stored, release.versionCode, uploadDir);
      currentPath = join(uploadDir, storedName);

      const row = await insertRelease(pool, {
        ...release,
        appId: defaultApp.id,
        sha256: stored.sha256,
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
          sha256: stored.sha256,
        },
      });
    } catch (error) {
      if (currentPath !== undefined) {
        await removeFile(currentPath, request.log);
      }
      throw translateMultipartError(error);
    }
  });

  app.get("/api/apks", async (request) => {
    const { filter, page } = parseListQuery(request.query);
    const { items, total } = await listReleases(pool, filter, page);
    return {
      success: true,
      data: items.map((release) => listItem(request, release)),
      pagination: { limit: page.limit, offset: page.offset, total },
    };
  });

  app.get("/api/apks/latest", async (request) => {
    const filter = parseReleaseFilter(request.query);
    if (
      filter.appId === undefined &&
      filter.packageName === undefined &&
      (await countApps(pool)) > 1
    ) {
      throw new AppRequiredError();
    }
    const release = await findLatestRelease(pool, filter);
    if (release === undefined) {
      throw new NotFoundError("no_releases", "No APK has been uploaded yet");
    }
    return { success: true, data: latestView(request, release) };
  });

  app.get<{ Params: { id: string } }>("/api/apks/download/:id", async (request, reply) => {
    const id = parseReleaseId(request.params.id);
    const release = await findReleaseById(pool, id);
    if (release === undefined) {
      throw new NotFoundError("release_not_found", `Release ${id} not found`);
    }

    // Open first and read the size from the handle, so a file removed in between cannot slip past
    let handle: FileHandle;
    try {
      handle = await open(join(uploadDir, release.filePath), "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        request.log.error({
          event: "download.file_missing",
          releaseId: id,
          path: release.filePath,
        });
        throw new NotFoundError(
          "apk_file_missing",
          `The file for release ${id} is no longer on the server`,
          { cause: error },
        );
      }
      throw error;
    }

    const { size } = await handle.stat();
    return reply
      .header("content-type", "application/vnd.android.package-archive")
      .header("content-length", size)
      .header("content-disposition", buildContentDisposition(release.fileName))
      .send(handle.createReadStream({ autoClose: true }));
  });
}
