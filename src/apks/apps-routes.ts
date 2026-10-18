import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { NotFoundError } from "../errors.js";
import { parseRenameBody } from "./app-name-field.js";
import { listAppsWithLatestRelease, renameApp } from "./apps-repository.js";
import { parseReleaseId } from "./release-id.js";

export interface AppRoutesOptions {
  pool: Pool;
}

export function registerAppRoutes(app: FastifyInstance, options: AppRoutesOptions): void {
  const { pool } = options;

  app.get("/api/apps", async () => {
    const apps = await listAppsWithLatestRelease(pool);
    return {
      success: true,
      data: apps.map((item) => ({
        id: item.id,
        name: item.name,
        packageName: item.packageName,
        createdAt: item.createdAt.toISOString(),
        latestRelease:
          item.latestRelease === null
            ? null
            : { ...item.latestRelease, createdAt: item.latestRelease.createdAt.toISOString() },
      })),
    };
  });

  app.patch<{ Params: { id: string } }>("/api/apps/:id", async (request) => {
    const id = parseReleaseId(request.params.id);
    const name = parseRenameBody(request.body);
    const renamed = await renameApp(pool, id, name);
    if (renamed === undefined) {
      throw new NotFoundError("app_not_found", `App ${id} not found`);
    }
    return {
      success: true,
      data: {
        id: renamed.id,
        name: renamed.name,
        packageName: renamed.packageName,
        createdAt: renamed.createdAt.toISOString(),
      },
    };
  });
}
