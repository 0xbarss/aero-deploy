import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvalidApkError } from "../errors.js";
import { readApkManifest } from "../apks/apk-manifest.js";
import { Deadline } from "../apks/deadline.js";
import { ZipArchive } from "../apks/zip-reader.js";
import { buildZip, type ZipEntrySpec } from "./helpers/zip-builder.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/apks/${name}.apk`, import.meta.url));
}

let directory: string;
let counter = 0;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "apk-manifest-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function writeApk(entries: ZipEntrySpec[]): Promise<string> {
  counter += 1;
  const filePath = path.join(directory, `test-${counter}.apk`);
  await writeFile(filePath, buildZip(entries));
  return filePath;
}

async function fixtureEntry(apk: string, entry: string): Promise<Buffer> {
  const archive = await ZipArchive.open(fixture(apk), new Deadline(60_000));
  try {
    const bytes = await archive.readEntry(entry, 1024 * 1024);
    if (bytes === null) {
      throw new Error(`fixture ${apk} has no ${entry}`);
    }
    return bytes;
  } finally {
    await archive.close();
  }
}

async function expectInvalid(promise: Promise<unknown>, message: RegExp): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(InvalidApkError);
  expect((error as InvalidApkError).statusCode).toBe(422);
  expect((error as InvalidApkError).code).toBe("invalid_apk");
  expect((error as InvalidApkError).message).toMatch(message);
}

describe("readApkManifest on real APKs", () => {
  it("reads a debug build with a literal label", async () => {
    expect(await readApkManifest(fixture("debug-literal"))).toEqual({
      packageName: "com.example.shop.debug",
      versionName: "1.2.0-debug",
      versionCode: 12,
      appLabel: "My Shop Debug",
      debuggable: true,
      minSdk: 24,
      targetSdk: 34,
    });
  });

  it("resolves a string resource label to the default language", async () => {
    expect(await readApkManifest(fixture("release-resource"))).toEqual({
      packageName: "com.example.shop",
      versionName: "1.2.0",
      versionCode: 12,
      appLabel: "My Shop",
      debuggable: false,
      minSdk: 24,
      targetSdk: 34,
    });
  });

  it("returns null for the label and sdk levels when the manifest has none", async () => {
    expect(await readApkManifest(fixture("no-label"))).toEqual({
      packageName: "com.example.bare",
      versionName: "0.3",
      versionCode: 3,
      appLabel: null,
      debuggable: false,
      minSdk: null,
      targetSdk: null,
    });
  });
});

describe("readApkManifest rejects invalid files", () => {
  it("rejects a ZIP without AndroidManifest.xml", async () => {
    await expectInvalid(readApkManifest(fixture("no-manifest")), /AndroidManifest\.xml/);
  });

  it("rejects a file that is not a ZIP", async () => {
    counter += 1;
    const filePath = path.join(directory, `plain-${counter}.apk`);
    await writeFile(filePath, "PK-less content");
    await expectInvalid(readApkManifest(filePath), /ZIP/);
  });

  it("rejects a manifest that is plain text XML", async () => {
    const xml = Buffer.from('<manifest package="com.example.text" />');
    const filePath = await writeApk([{ name: "AndroidManifest.xml", data: xml }]);
    await expectInvalid(readApkManifest(filePath), /binary XML/);
  });

  it("rejects a manifest that is cut off", async () => {
    const manifest = await fixtureEntry("release-resource", "AndroidManifest.xml");
    const filePath = await writeApk([
      { name: "AndroidManifest.xml", data: manifest.subarray(0, manifest.length - 60) },
    ]);
    await expectInvalid(readApkManifest(filePath), /binary XML/);
  });

  it("rejects a manifest with random bytes after a valid header", async () => {
    const manifest = Buffer.from(await fixtureEntry("debug-literal", "AndroidManifest.xml"));
    for (let index = 40; index < manifest.length; index += 1) {
      manifest[index] = (index * 37) % 251;
    }
    const filePath = await writeApk([{ name: "AndroidManifest.xml", data: manifest }]);
    await expectInvalid(readApkManifest(filePath), /binary XML|package|versionCode/);
  });

  it("rejects a manifest above the size limit", async () => {
    const filePath = await writeApk([
      { name: "AndroidManifest.xml", data: Buffer.alloc(8 * 1024 * 1024), deflate: true },
    ]);
    await expectInvalid(readApkManifest(filePath), /too large/);
  });

  it("applies a custom manifest size limit", async () => {
    await expectInvalid(
      readApkManifest(fixture("release-resource"), { maxManifestBytes: 100 }),
      /too large/,
    );
  });

  it("rejects an APK that takes longer than the timeout", async () => {
    await expectInvalid(readApkManifest(fixture("release-resource"), { timeoutMs: 0 }), /too long/);
  });

  it("rejects a manifest without a package name", async () => {
    const manifest = Buffer.from(await fixtureEntry("debug-literal", "AndroidManifest.xml"));
    // Same-length rename so every offset in the file stays valid
    const renamed = renameString(manifest, "package", "pkgname");
    const filePath = await writeApk([{ name: "AndroidManifest.xml", data: renamed }]);
    await expectInvalid(readApkManifest(filePath), /package/);
  });

  it("rejects a manifest without a version code", async () => {
    const manifest = Buffer.from(await fixtureEntry("debug-literal", "AndroidManifest.xml"));
    // Same-length rename of the attribute name; the resource map entry is blanked too
    const renamed = renameString(manifest, "versionCode", "versionCodX");
    blankResourceId(renamed, 0x0101021b);
    const filePath = await writeApk([{ name: "AndroidManifest.xml", data: renamed }]);
    await expectInvalid(readApkManifest(filePath), /versionCode/);
  });

  it("rejects a version code of zero", async () => {
    const manifest = Buffer.from(await fixtureEntry("debug-literal", "AndroidManifest.xml"));
    patchVersionCode(manifest, 12, 0);
    const filePath = await writeApk([{ name: "AndroidManifest.xml", data: manifest }]);
    await expectInvalid(readApkManifest(filePath), /versionCode/);
  });

  it("rejects a negative version code", async () => {
    const manifest = Buffer.from(await fixtureEntry("debug-literal", "AndroidManifest.xml"));
    patchVersionCode(manifest, 12, 0xffffffff);
    const filePath = await writeApk([{ name: "AndroidManifest.xml", data: manifest }]);
    await expectInvalid(readApkManifest(filePath), /versionCode/);
  });
});

describe("readApkManifest label resolution", () => {
  it("returns a null label when the label is a resource and resources.arsc is missing", async () => {
    const manifest = await fixtureEntry("release-resource", "AndroidManifest.xml");
    const filePath = await writeApk([{ name: "AndroidManifest.xml", data: manifest }]);
    expect((await readApkManifest(filePath)).appLabel).toBeNull();
  });

  it("returns a null label when resources.arsc cannot be parsed", async () => {
    const manifest = await fixtureEntry("release-resource", "AndroidManifest.xml");
    const filePath = await writeApk([
      { name: "AndroidManifest.xml", data: manifest },
      { name: "resources.arsc", data: Buffer.from("not a resource table at all") },
    ]);
    expect((await readApkManifest(filePath)).appLabel).toBeNull();
  });

  it("returns a null label when resources.arsc is cut off", async () => {
    const manifest = await fixtureEntry("release-resource", "AndroidManifest.xml");
    const table = await fixtureEntry("release-resource", "resources.arsc");
    const filePath = await writeApk([
      { name: "AndroidManifest.xml", data: manifest },
      { name: "resources.arsc", data: table.subarray(0, table.length - 100) },
    ]);
    expect((await readApkManifest(filePath)).appLabel).toBeNull();
  });

  it("returns a null label when the entry index is past the end of the table", async () => {
    const manifest = Buffer.from(await fixtureEntry("release-resource", "AndroidManifest.xml"));
    patchReference(manifest, 0x7f020001, 0x7f020009);
    const table = await fixtureEntry("release-resource", "resources.arsc");
    const filePath = await writeApk([
      { name: "AndroidManifest.xml", data: manifest },
      { name: "resources.arsc", data: table },
    ]);
    expect((await readApkManifest(filePath)).appLabel).toBeNull();
  });

  it("returns a null label when the referenced package is not in the table", async () => {
    const manifest = Buffer.from(await fixtureEntry("release-resource", "AndroidManifest.xml"));
    patchReference(manifest, 0x7f020001, 0x7e020001);
    const table = await fixtureEntry("release-resource", "resources.arsc");
    const filePath = await writeApk([
      { name: "AndroidManifest.xml", data: manifest },
      { name: "resources.arsc", data: table },
    ]);
    expect((await readApkManifest(filePath)).appLabel).toBeNull();
  });

  it("follows the label to the other string when the reference is patched to it", async () => {
    const manifest = Buffer.from(await fixtureEntry("release-resource", "AndroidManifest.xml"));
    patchReference(manifest, 0x7f020001, 0x7f020000);
    const table = await fixtureEntry("release-resource", "resources.arsc");
    const filePath = await writeApk([
      { name: "AndroidManifest.xml", data: manifest },
      { name: "resources.arsc", data: table },
    ]);
    expect((await readApkManifest(filePath)).appLabel).toBe("Unused");
  });

  it("does not use a localized value when the table has no default configuration", async () => {
    const manifest = await fixtureEntry("release-resource", "AndroidManifest.xml");
    const table = Buffer.from(await fixtureEntry("release-resource", "resources.arsc"));
    // Give the default string chunk a locale ("de"), leaving only qualified chunks
    const defaultChunks = findTypeChunks(table, 2).filter((chunk) => isDefaultConfig(table, chunk));
    expect(defaultChunks).toHaveLength(1);
    const [defaultChunk] = defaultChunks;
    if (defaultChunk === undefined) {
      throw new Error("fixture has no default string chunk");
    }
    table.write("de", defaultChunk + 20 + 8, "latin1");
    const filePath = await writeApk([
      { name: "AndroidManifest.xml", data: manifest },
      { name: "resources.arsc", data: table },
    ]);
    expect((await readApkManifest(filePath)).appLabel).toBeNull();
  });

  it("rejects a resources.arsc above the size limit", async () => {
    const manifest = await fixtureEntry("release-resource", "AndroidManifest.xml");
    const filePath = await writeApk([
      { name: "AndroidManifest.xml", data: manifest },
      { name: "resources.arsc", data: Buffer.alloc(2 * 1024 * 1024), deflate: true },
    ]);
    await expectInvalid(
      readApkManifest(filePath, { maxResourceTableBytes: 1024 * 1024 }),
      /too large/,
    );
  });

  it("does not read resources.arsc when the label is a literal", async () => {
    const manifest = await fixtureEntry("debug-literal", "AndroidManifest.xml");
    const filePath = await writeApk([
      { name: "AndroidManifest.xml", data: manifest },
      { name: "resources.arsc", data: Buffer.alloc(2 * 1024 * 1024), deflate: true },
    ]);
    const info = await readApkManifest(filePath, { maxResourceTableBytes: 1024 });
    expect(info.appLabel).toBe("My Shop Debug");
  });
});

function renameString(data: Buffer, from: string, to: string): Buffer {
  expect(from).toHaveLength(to.length);
  let replaced = 0;
  for (const encoding of ["utf16le", "utf8"] as const) {
    const needle = Buffer.from(from, encoding);
    const replacement = Buffer.from(to, encoding);
    let position = data.indexOf(needle);
    while (position !== -1) {
      replacement.copy(data, position);
      replaced += 1;
      position = data.indexOf(needle, position + needle.length);
    }
  }
  expect(replaced).toBeGreaterThan(0);
  return data;
}

function blankResourceId(data: Buffer, resourceId: number): void {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(resourceId, 0);
  const position = data.indexOf(needle);
  expect(position).toBeGreaterThan(0);
  data.writeUInt32LE(0, position);
}

function patchVersionCode(data: Buffer, from: number, to: number): void {
  // Res_value for an int: size 8, reserved 0, type 0x10 (int decimal), then the value
  const needle = Buffer.from([0x08, 0x00, 0x00, 0x10, from, 0x00, 0x00, 0x00]);
  const position = data.indexOf(needle);
  expect(position).toBeGreaterThan(0);
  data.writeUInt32LE(to, position + 4);
}

function patchReference(data: Buffer, from: number, to: number): void {
  // Res_value for a reference: size 8, reserved 0, type 0x01, then the resource id
  const needle = Buffer.alloc(8);
  needle.writeUInt32LE(0x01000008, 0);
  needle.writeUInt32LE(from, 4);
  const position = data.indexOf(needle);
  expect(position).toBeGreaterThan(0);
  data.writeUInt32LE(to, position + 4);
}

/** Offsets of the type chunks (0x0201) for one resource type, found by scanning for their header. */
function findTypeChunks(table: Buffer, typeId: number): number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset + 24 < table.length; offset += 4) {
    const headerSize = table.readUInt16LE(offset + 2);
    if (
      table.readUInt16LE(offset) === 0x0201 &&
      headerSize >= 48 &&
      headerSize <= 96 &&
      table.readUInt8(offset + 8) === typeId
    ) {
      offsets.push(offset);
    }
  }
  return offsets;
}

function isDefaultConfig(table: Buffer, chunkOffset: number): boolean {
  const configSize = table.readUInt32LE(chunkOffset + 20);
  return table
    .subarray(chunkOffset + 24, chunkOffset + 20 + configSize)
    .every((byte) => byte === 0);
}
