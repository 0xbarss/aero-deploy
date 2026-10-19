import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers/test-app.js";
import { createTestPool } from "./helpers/test-database.js";

const PUBLIC_DIR = join(import.meta.dirname, "..", "..", "public");
const WEB_DIR = join(import.meta.dirname, "..", "..", "web");
const WEB_SRC = join(WEB_DIR, "src");

/** The files the dashboard is built from, as text. */
async function readWebSource(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const parts: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      parts.push(await readWebSource(path));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      parts.push(await readFile(path, "utf8"));
    }
  }
  return parts.join("\n");
}

/** The hue and the chroma of a hex colour. */
function hexToHsl(hex: string): { h: number; chroma: number } {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) {
    return { h: 0, chroma: 0 };
  }
  // Chroma relative to the brightness of the colour, so a near-black with a blue tinge
  // still counts as gray.
  const chroma = (max - min) / (max + min + 1);
  const delta = max - min;
  let hue: number;
  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  return { h: hue * 60, chroma };
}

/** Whether a hue sits within fifteen degrees of another one. */
function angleWithin(hue: number, other: number): boolean {
  const difference = Math.abs(((hue - other + 540) % 360) - 180);
  return difference <= 15;
}

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
    expect(response.body).toContain("<title>AeroDeploy");
    expect(response.body).toMatch(/<div id="root"><\/div>/);
  });

  it("answers HEAD / without a body", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "HEAD", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
  });

  it("serves the built script and stylesheet with the right content type", async () => {
    const app = await createApp();
    const page = await app.inject({ method: "GET", url: "/" });
    const script = page.body.match(/src="(\/assets\/[^"]+\.js)"/);
    const style = page.body.match(/href="(\/assets\/[^"]+\.css)"/);

    expect(script).not.toBeNull();
    expect(style).not.toBeNull();

    const scriptResponse = await app.inject({ method: "GET", url: String(script?.[1]) });
    expect(scriptResponse.statusCode).toBe(200);
    expect(scriptResponse.headers["content-type"]).toMatch(/javascript/);

    const styleResponse = await app.inject({ method: "GET", url: String(style?.[1]) });
    expect(styleResponse.statusCode).toBe(200);
    expect(styleResponse.headers["content-type"]).toMatch(/^text\/css/);
  });

  it("serves the self-hosted fonts", async () => {
    const app = await createApp();
    const sheet = await app.inject({ method: "GET", url: "/fonts/fonts.css" });

    expect(sheet.statusCode).toBe(200);
    expect(sheet.headers["content-type"]).toMatch(/^text\/css/);
    expect(sheet.body).toContain("/fonts/space-grotesk.woff2");
    expect(sheet.body).toContain("/fonts/inter.woff2");
    expect(sheet.body).toContain("/fonts/jetbrains-mono.woff2");

    const font = await app.inject({ method: "GET", url: "/fonts/space-grotesk.woff2" });
    expect(font.statusCode).toBe(200);
    expect(font.headers["content-type"]).toMatch(/font/);
  });

  it("serves the same bytes that are in the public directory", async () => {
    const app = await createApp();
    const page = await app.inject({ method: "GET", url: "/" });
    const script = String(page.body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]);

    const response = await app.inject({ method: "GET", url: script });

    expect(response.body).toBe(await readFile(join(PUBLIC_DIR, script), "utf8"));
  });

  it("loads nothing from other hosts", async () => {
    const html = await readFile(join(PUBLIC_DIR, "index.html"), "utf8");
    const css = await readFile(
      join(
        PUBLIC_DIR,
        "assets",
        (await readdir(join(PUBLIC_DIR, "assets"))).find((name) => name.endsWith(".css")) ?? "",
      ),
      "utf8",
    );

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
    const response = await app.inject({ method: "GET", url: "/assets/" });

    expect(response.statusCode).toBe(404);
  });

  it("serves the page whether or not tokens are configured, and never includes them", async () => {
    const app = await createApp({ adminToken: "admin-secret-1", uploadToken: "upload-secret-1" });
    const page = await app.inject({ method: "GET", url: "/" });
    const assets = await readdir(join(PUBLIC_DIR, "assets"));
    const scripts = await Promise.all(
      assets
        .filter((name) => name.endsWith(".js"))
        .map(async (name) => (await app.inject({ method: "GET", url: `/assets/${name}` })).body),
    );

    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain("admin-secret-1");
    expect(page.body).not.toContain("upload-secret-1");
    for (const script of scripts) {
      expect(script).not.toContain("secret");
    }
  });

  it("keeps the hashed assets in the browser cache and the page out of it", async () => {
    const app = await createApp();
    const page = await app.inject({ method: "GET", url: "/" });
    const script = String(page.body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]);

    const asset = await app.inject({ method: "GET", url: script });
    expect(asset.headers["cache-control"]).toContain("immutable");

    expect(page.headers["cache-control"]).toContain("no-cache");
  });
});

describe("the dashboard source", () => {
  it("never builds markup from strings", async () => {
    const source = await readWebSource(WEB_SRC);

    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
    expect(source).not.toMatch(/\.innerHTML\s*=/);
    expect(source).not.toMatch(/document\.write|\beval\(|new Function\(/);
  });

  it("keeps the admin token out of browser storage", async () => {
    const source = await readWebSource(WEB_SRC);

    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
  });

  it("draws the QR code as inline SVG, so the content security policy needs no image source", async () => {
    const source = await readWebSource(WEB_SRC);

    expect(source).toContain("<svg");
    expect(source).not.toMatch(/data:image|toDataURL|createObjectURL/);
  });

  it("checks that the file is there before it starts a download", async () => {
    const source = await readWebSource(WEB_SRC);

    expect(source).toMatch(/probeDownload\(/);
  });

  it("renames an app with a PATCH request that carries the admin token as a bearer header", async () => {
    const source = await readWebSource(WEB_SRC);

    expect(source).toMatch(/method: "PATCH"/);
    expect(source).toMatch(/Authorization: `Bearer \$\{token\}`/);
  });

  it("has a place for the upload form in the page", async () => {
    const source = await readWebSource(WEB_SRC);

    expect(source).toContain('accept=".apk,application/vnd.android.package-archive"');
    expect(source).toContain("/apks/upload");
  });

  it("keeps the licence of the vendored QR generator next to it", async () => {
    const licence = await readFile(join(WEB_DIR, "src", "vendor", "uqr.LICENSE.txt"), "utf8");
    const source = await readFile(join(WEB_DIR, "src", "vendor", "uqr.js"), "utf8");

    expect(licence).toContain("MIT License");
    expect(licence).toContain("Project Nayuki");
    expect(source).toMatch(/^\/\/ uqr 0\.1\.3 \(MIT\)/);
  });

  it("gives the page a distinct display face, a reading face and a monospace face", async () => {
    const styles = await readFile(join(WEB_SRC, "styles.css"), "utf8");

    expect(styles).toContain('--display: "Space Grotesk"');
    expect(styles).toContain('--body: "Inter"');
    expect(styles).toContain('--mono: "JetBrains Mono"');
  });

  it("puts a working install desk in the hero", async () => {
    const source = await readWebSource(WEB_SRC);

    // The desk is part of the hero, it picks a build and it draws the link as a QR code.
    expect(source).toContain("<InstallDesk");
    expect(source).toContain("Install desk");
    expect(source).toContain("aria-pressed");
    expect(source).toContain("qrDrawing(");
  });

  it("keeps the hero on a reading axis with the desk beside it", async () => {
    const styles = await readFile(join(WEB_SRC, "styles.css"), "utf8");

    // Two tracks, not one centred column.
    expect(styles).toMatch(/\.hero\s*\{\s*grid-template-columns:[^;]*minmax\(0,[^;]*minmax\(0,/);
  });

  it("gives the build machine a command it can run", async () => {
    const source = await readWebSource(WEB_SRC);

    expect(source).toContain("npm run upload --");
  });

  it("keeps the palette to grayscale and a single accent", async () => {
    const styles = await readFile(join(WEB_SRC, "styles.css"), "utf8");
    const colours = styles.match(/#[0-9a-fA-F]{6}\b/g) ?? [];

    expect(colours.length).toBeGreaterThan(5);

    // The accent lime and the red of the delete button are the only chromatic colours.
    const accentHue = 75;
    const dangerHue = 6;
    for (const colour of colours) {
      const { h, chroma } = hexToHsl(colour);
      if (chroma < 0.1) {
        continue;
      }
      const nearAccent = angleWithin(h, accentHue);
      const nearDanger = angleWithin(h, dangerHue);
      expect(
        nearAccent || nearDanger,
        `${colour} is a third hue (${Math.round(h)}°), which breaks the grayscale plus one accent rule`,
      ).toBe(true);
    }
  });

  it("does not wash the page with a purple or indigo gradient", async () => {
    const styles = await readFile(join(WEB_SRC, "styles.css"), "utf8");

    expect(styles).not.toMatch(
      /#[0-9a-f]{6}[0-9a-f]{0,2}\b(?=[^;]*gradient)[^;]*\b(?:indigo|purple|violet)/i,
    );
    expect(styles).not.toMatch(
      /linear-gradient\([^)]*#(?:6|7|8|9|a|b|c|d|e|f)[0-9a-f]{2}[0-9a-f]{2}[0-9a-f]{2}/i,
    );
  });
});
