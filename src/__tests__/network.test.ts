import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { lanAddresses } from "../network.js";
import { createTestApp, type TestApp } from "./helpers/test-app.js";
import { createTestPool } from "./helpers/test-database.js";

describe("lanAddresses", () => {
  it("lists no address that only this machine can use", () => {
    for (const address of lanAddresses()) {
      expect(address).not.toBe("127.0.0.1");
      expect(address).not.toBe("0.0.0.0");
      expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    }
  });

  it("puts the addresses of a home network before the others", () => {
    const addresses = lanAddresses();
    const ranks = addresses.map((address) => {
      if (address.startsWith("192.168.")) {
        return 0;
      }
      if (address.startsWith("10.")) {
        return 1;
      }
      return 2;
    });

    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("lists no address twice", () => {
    const addresses = lanAddresses();

    expect(new Set(addresses).size).toBe(addresses.length);
  });
});

describe("GET /api/network", () => {
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

  async function createApp() {
    const testApp = await createTestApp(pool);
    testApps.push(testApp);
    return testApp.app;
  }

  it("answers with the addresses of the server", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/network" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: { addresses: lanAddresses() } });
  });

  it("is open, so the dashboard can ask for it without a token", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/network" });

    expect(response.statusCode).toBe(200);
  });
});
