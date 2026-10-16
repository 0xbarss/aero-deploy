import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

export type AppOptions = Pick<FastifyServerOptions, "logger">;

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(options);

  app.get("/api/health", () => ({ success: true, data: { status: "ok" } }));

  await app.ready();
  return app;
}
