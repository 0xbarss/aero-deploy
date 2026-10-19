import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { Pool } from "pg";
import { registerAppRoutes } from "./apks/apps-routes.js";
import { registerApkRoutes } from "./apks/routes.js";
import { handleFrameworkError, registerErrorHandling } from "./error-handler.js";

export interface AppOptions {
  logger?: FastifyServerOptions["logger"];
  pool: Pool;
  uploadDir: string;
  maxUploadBytes: number;
  /** Admin routes are refused while this is undefined. */
  adminToken?: string | undefined;
  /** Uploads are open while this is undefined. */
  uploadToken?: string | undefined;
}

// Both src/ and dist/ sit one level below the project root, next to public/
const PUBLIC_DIR = join(import.meta.dirname, "..", "public");

const DASHBOARD_CSP = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const MAX_TEXT_FIELD_BYTES = 64 * 1024;
const MAX_TEXT_FIELDS = 10;

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger, frameworkErrors: handleFrameworkError });

  registerErrorHandling(app);
  await mkdir(options.uploadDir, { recursive: true });
  await app.register(multipart, {
    limits: {
      fileSize: options.maxUploadBytes,
      files: 1,
      fields: MAX_TEXT_FIELDS,
      fieldSize: MAX_TEXT_FIELD_BYTES,
    },
  });

  app.get("/api/health", () => ({ success: true, data: { status: "ok" } }));
  registerApkRoutes(app, {
    pool: options.pool,
    uploadDir: options.uploadDir,
    adminToken: options.adminToken,
    uploadToken: options.uploadToken,
  });
  registerAppRoutes(app, { pool: options.pool });
  await app.register(fastifyStatic, {
    root: PUBLIC_DIR,
    wildcard: false,
    setHeaders: (reply) => {
      void reply.header("Content-Security-Policy", DASHBOARD_CSP);
      void reply.header("X-Content-Type-Options", "nosniff");
    },
  });

  await app.ready();
  return app;
}
