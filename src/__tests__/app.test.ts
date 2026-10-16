import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("app", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function createApp() {
    const app = await buildApp({ logger: false });
    apps.push(app);
    return app;
  }

  it("answers GET /api/health", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: { status: "ok" } });
  });

  it("returns 404 for unknown routes", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/nope" });

    expect(response.statusCode).toBe(404);
  });
});
