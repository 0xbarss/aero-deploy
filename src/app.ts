import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { Pool } from "pg";
import { registerAppRoutes } from "./apks/apps-routes.js";
import { registerApkRoutes } from "./apks/routes.js";
import { handleFrameworkError, registerErrorHandling } from "./error-handler.js";
import { lanAddresses } from "./network.js";

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

// The build names its asset files after their contents, so they can be kept for good.
const IMMUTABLE_ASSET = /^\/assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

const MAX_TEXT_FIELD_BYTES = 64 * 1024;
const MAX_TEXT_FIELDS = 10;

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger,
    frameworkErrors: handleFrameworkError,
    trustProxy: true,
  });

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
  app.get("/api/network", () => ({ success: true, data: { addresses: lanAddresses() } }));
  registerApkRoutes(app, {
    pool: options.pool,
    uploadDir: options.uploadDir,
    adminToken: options.adminToken,
    uploadToken: options.uploadToken,
  });
  registerAppRoutes(app, { pool: options.pool, adminToken: options.adminToken });
  await app.register(fastifyStatic, {
    root: PUBLIC_DIR,
    // The dashboard is built with content-addressed asset names, so the files have to be looked
    // up on every request. A rebuilt dashboard is then served without restarting the server.
    wildcard: true,
    index: ["index.html"],
    list: false,
    setHeaders: (reply) => {
      void reply.header("Content-Security-Policy", DASHBOARD_CSP);
      void reply.header("X-Content-Type-Options", "nosniff");
      const url = reply.request.url.split("?")[0] ?? "";
      if (IMMUTABLE_ASSET.test(url)) {
        void reply.header("Cache-Control", "public, max-age=31536000, immutable");
        return;
      }
      // The page itself points at the current assets, so it must never be kept.
      void reply.header("Cache-Control", "no-cache");
    },
  });

  await app.ready();
  return app;
}
