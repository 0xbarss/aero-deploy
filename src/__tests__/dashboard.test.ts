import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers/test-app.js";
import { createTestPool } from "./helpers/test-database.js";

const PUBLIC_DIR = join(import.meta.dirname, "..", "..", "public");

describe("dashboard hosting", () => {
  let pool: Pool;
  const testApps: TestApp[] = [];

  beforeAll(() => {
    pool = createTestPool();
  });

  afterEach(async () => {
    await Promise.all(testApps.splice(0).map((testApp) => testApp.close()));
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createApp(options: { adminToken?: string; uploadToken?: string } = {}) {
    const testApp = await createTestApp(pool, options);
    testApps.push(testApp);
    return testApp.app;
  }

  it("serves the dashboard page at /", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/html/);
    expect(response.body).toContain("<title>AeroDeploy</title>");
    expect(response.body).toContain('src="/dashboard.js"');
  });

  it("answers HEAD / without a body", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "HEAD", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
  });

  it.each([
    ["/dashboard.js", /javascript/],
    ["/release-view.js", /javascript/],
    ["/upload.js", /javascript/],
    ["/dom.js", /javascript/],
    ["/download.js", /javascript/],
    ["/qr.js", /javascript/],
    ["/vendor/uqr.js", /javascript/],
    ["/dashboard.css", /^text\/css/],
  ])("serves %s with the right content type", async (url, contentType) => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(contentType);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it("serves the same bytes that are in the public directory", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/release-view.js" });

    expect(response.body).toBe(await readFile(join(PUBLIC_DIR, "release-view.js"), "utf8"));
  });

  it("loads nothing from other hosts", async () => {
    const html = await readFile(join(PUBLIC_DIR, "index.html"), "utf8");
    const css = await readFile(join(PUBLIC_DIR, "dashboard.css"), "utf8");

    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i);
    expect(css).not.toMatch(/(?:url\(|@import)\s*["']?(?:https?:)?\/\//i);
  });

  it("restricts the page to its own origin with a content security policy", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/" });
    const policy = String(response.headers["content-security-policy"]);

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("keeps the API routes and their error envelope", async () => {
    const app = await createApp();

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.json()).toEqual({ success: true, data: { status: "ok" } });

    const missingApi = await app.inject({ method: "GET", url: "/api/nope" });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.headers["content-type"]).toMatch(/json/);
    expect(missingApi.json()).toMatchObject({ success: false, error: { code: "not_found" } });
  });

  it("answers an unknown path with the JSON 404 envelope, not the page", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/releases/3" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      success: false,
      error: { code: "not_found", message: "Route GET /releases/3 not found" },
    });
  });

  it("does not serve the page for other methods", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "POST", url: "/" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it.each([
    "/../package.json",
    "/%2e%2e/package.json",
    "/..%2fpackage.json",
    "/%2e%2e%2fpackage.json",
    "/dashboard.js/../../package.json",
    "/.env",
    "/.env.example",
  ])("does not serve files outside the public directory (%s)", async (url) => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).not.toBe(200);
    expect(response.body).not.toContain("aero-deploy");
    expect(response.body).not.toContain("POSTGRES_PASSWORD");
  });

  it("does not list the public directory", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/dashboard.css/" });

    expect(response.statusCode).toBe(404);
  });

  it("serves the page whether or not tokens are configured, and never includes them", async () => {
    const app = await createApp({ adminToken: "admin-secret-1", uploadToken: "upload-secret-1" });
    const page = await app.inject({ method: "GET", url: "/" });
    const script = await app.inject({ method: "GET", url: "/dashboard.js" });

    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain("admin-secret-1");
    expect(page.body).not.toContain("upload-secret-1");
    expect(script.body).not.toContain("secret");
  });

  it.each(["dashboard.js", "release-view.js", "upload.js", "dom.js", "download.js", "qr.js"])(
    "%s never builds markup from strings or evaluates code",
    async (file) => {
      const source = await readFile(join(PUBLIC_DIR, file), "utf8");

      expect(source).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/,
      );
    },
  );

  it("keeps the admin token out of browser storage", async () => {
    const sources = await Promise.all(
      ["dashboard.js", "upload.js"].map((file) => readFile(join(PUBLIC_DIR, file), "utf8")),
    );
    const source = sources.join("\n");

    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
  });

  it("has a place for the upload form in the page", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.body).toContain('id="upload"');
  });

  it("checks that the file is there before it starts a download", async () => {
    const source = await readFile(join(PUBLIC_DIR, "dashboard.js"), "utf8");

    expect(source).toMatch(/probeDownload\(/);
  });

  it("replaces the page content through a helper that skips missing children", async () => {
    // replaceChildren(null) would print the word "null" into the page
    const source = await readFile(join(PUBLIC_DIR, "dashboard.js"), "utf8");

    expect(source).not.toMatch(/root\.replaceChildren\(/);
  });

  it("keeps the licence of the vendored QR generator next to it", async () => {
    const licence = await readFile(join(PUBLIC_DIR, "vendor", "uqr.LICENSE.txt"), "utf8");
    const source = await readFile(join(PUBLIC_DIR, "vendor", "uqr.js"), "utf8");

    expect(licence).toContain("MIT License");
    expect(licence).toContain("Project Nayuki");
    expect(source).toMatch(/^\/\/ uqr 0\.1\.3 \(MIT\)/);
  });

  it("draws the QR code as inline SVG, so the content security policy needs no image source", async () => {
    const app = await createApp();
    const page = await app.inject({ method: "GET", url: "/" });
    const policy = String(page.headers["content-security-policy"]);
    const source = await readFile(join(PUBLIC_DIR, "qr.js"), "utf8");

    expect(policy).not.toMatch(/img-src|data:|blob:/);
    expect(source).toContain("createElementNS");
    expect(source).not.toMatch(/data:image|toDataURL|new Blob|createObjectURL/);
  });

  it("shows the QR code in the details panel", async () => {
    const source = await readFile(join(PUBLIC_DIR, "dashboard.js"), "utf8");

    expect(source).toMatch(/from "\.\/qr\.js"/);
    expect(source).toMatch(/isReachableFromPhone\(/);
  });

  it("builds the details panel through a helper that skips missing children", async () => {
    // append(null) would print the word "null" into the panel
    const source = await readFile(join(PUBLIC_DIR, "dashboard.js"), "utf8");
    const start = source.indexOf("function renderDetails()");
    const body = source.slice(start, source.indexOf("\nfunction ", start + 1));

    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("replaceContent(panel");
    expect(body).not.toMatch(/panel\.append\(/);
  });
});
