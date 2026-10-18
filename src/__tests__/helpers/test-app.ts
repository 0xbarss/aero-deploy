import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { buildApp } from "../../app.js";

export interface TestApp {
  app: FastifyInstance;
  uploadDir: string;
  close: () => Promise<void>;
}

export async function createTestApp(
  pool: Pool,
  options: { maxUploadBytes?: number; adminToken?: string; uploadToken?: string } = {},
): Promise<TestApp> {
  const uploadDir = await mkdtemp(join(tmpdir(), "aero-uploads-"));
  const app = await buildApp({
    logger: false,
    pool,
    uploadDir,
    maxUploadBytes: options.maxUploadBytes ?? 10 * 1024 * 1024,
    adminToken: options.adminToken,
    uploadToken: options.uploadToken,
  });
  return {
    app,
    uploadDir,
    close: async () => {
      await app.close();
      await rm(uploadDir, { recursive: true, force: true });
    },
  };
}
