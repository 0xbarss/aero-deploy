import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type FixtureName = "debug-literal" | "release-resource" | "no-label" | "no-manifest";

export function fixturePath(name: FixtureName): string {
  return fileURLToPath(new URL(`../fixtures/apks/${name}.apk`, import.meta.url));
}

export function readFixture(name: FixtureName): Promise<Buffer> {
  return readFile(fixturePath(name));
}

/** What the committed fixture APKs declare in their manifests. */
export const SHOP = {
  fixture: "release-resource",
  packageName: "com.example.shop",
  versionName: "1.2.0",
  versionCode: 12,
  label: "My Shop",
} as const;

export const SHOP_DEBUG = {
  fixture: "debug-literal",
  packageName: "com.example.shop.debug",
  versionName: "1.2.0-debug",
  versionCode: 12,
  label: "My Shop Debug",
} as const;

export const BARE = {
  fixture: "no-label",
  packageName: "com.example.bare",
  versionName: "0.3",
  versionCode: 3,
} as const;
