import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvalidApkError } from "../errors.js";
import { Deadline } from "../apks/deadline.js";
import { ZipArchive } from "../apks/zip-reader.js";
import { buildZip, type ZipEntrySpec } from "./helpers/zip-builder.js";

const LIMIT = 1024 * 1024;
const noDeadline = (): Deadline => new Deadline(60_000);

let directory: string;
let counter = 0;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "zip-reader-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function writeArchive(bytes: Buffer): Promise<string> {
  counter += 1;
  const filePath = path.join(directory, `archive-${counter}.zip`);
  await writeFile(filePath, bytes);
  return filePath;
}

async function readEntry(
  entries: ZipEntrySpec[] | Buffer,
  name: string,
  options: { comment?: string; limit?: number } = {},
): Promise<Buffer | null> {
  const bytes = Buffer.isBuffer(entries)
    ? entries
    : buildZip(entries, options.comment === undefined ? {} : { comment: options.comment });
  const archive = await ZipArchive.open(await writeArchive(bytes), noDeadline());
  try {
    return await archive.readEntry(name, options.limit ?? LIMIT);
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
  expect((error as InvalidApkError).message).toMatch(message);
}

describe("ZipArchive.readEntry", () => {
  it("reads a stored entry", async () => {
    const data = Buffer.from("stored bytes");
    expect(await readEntry([{ name: "a.txt", data }], "a.txt")).toEqual(data);
  });

  it("reads a deflated entry", async () => {
    const data = Buffer.from("deflate me ".repeat(100));
    expect(await readEntry([{ name: "a.txt", data, deflate: true }], "a.txt")).toEqual(data);
  });

  it("picks the requested entry out of several", async () => {
    const entries = [
      { name: "first.txt", data: Buffer.from("one") },
      { name: "second.txt", data: Buffer.from("two"), deflate: true },
      { name: "third.txt", data: Buffer.from("three") },
    ];
    expect(await readEntry(entries, "second.txt")).toEqual(Buffer.from("two"));
  });

  it("returns null when the entry does not exist", async () => {
    expect(await readEntry([{ name: "a.txt", data: Buffer.from("x") }], "b.txt")).toBeNull();
  });

  it("returns an empty buffer for an empty entry", async () => {
    expect(await readEntry([{ name: "a.txt", data: Buffer.alloc(0) }], "a.txt")).toEqual(
      Buffer.alloc(0),
    );
  });

  it("finds the end of central directory behind an archive comment", async () => {
    const data = Buffer.from("with comment");
    const entries = [{ name: "a.txt", data }];
    expect(await readEntry(entries, "a.txt", { comment: "c".repeat(300) })).toEqual(data);
  });

  it("reads an entry that sits behind a large entry", async () => {
    const entries = [
      { name: "padding.bin", data: Buffer.alloc(20 * 1024 * 1024) },
      { name: "a.txt", data: Buffer.from("after padding") },
    ];
    expect(await readEntry(entries, "a.txt")).toEqual(Buffer.from("after padding"));
  });

  it("does not read a large entry it was not asked for", async () => {
    const entries = [
      { name: "padding.bin", data: Buffer.alloc(20 * 1024 * 1024) },
      { name: "a.txt", data: Buffer.from("small") },
    ];
    expect(await readEntry(entries, "a.txt", { limit: 1024 })).toEqual(Buffer.from("small"));
  });
});

describe("ZipArchive rejects broken archives", () => {
  it("rejects an empty file", async () => {
    await expectInvalid(readEntry(Buffer.alloc(0), "a.txt"), /not a ZIP/i);
  });

  it("rejects a file that is not a ZIP", async () => {
    await expectInvalid(readEntry(Buffer.from("this is plain text, not an archive"), "a"), /ZIP/);
  });

  it("rejects an archive cut off before its central directory", async () => {
    const whole = buildZip([{ name: "a.txt", data: Buffer.from("x".repeat(500)) }]);
    await expectInvalid(readEntry(whole.subarray(0, 200), "a.txt"), /ZIP/);
  });

  it("rejects an entry larger than the limit", async () => {
    const data = Buffer.alloc(2048, 1);
    await expectInvalid(
      readEntry([{ name: "a.txt", data }], "a.txt", { limit: 1024 }),
      /too large/,
    );
  });

  it("rejects a deflated entry that expands past the limit", async () => {
    const data = Buffer.alloc(8 * 1024 * 1024);
    const entries = [{ name: "a.txt", data, deflate: true }];
    await expectInvalid(readEntry(entries, "a.txt", { limit: 1024 * 1024 }), /too large/);
  });

  it("rejects a deflated stream that expands past its declared size", async () => {
    // The declared uncompressed size is patched to 10 bytes while the stream holds 3000
    const bytes = buildZip([{ name: "a.txt", data: Buffer.alloc(3000), deflate: true }]);
    const centralStart = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(10, centralStart + 24);
    await expectInvalid(readEntry(bytes, "a.txt"), /larger than its declared size/);
  });

  it("rejects a deflated stream that ends before its declared size", async () => {
    const bytes = buildZip([{ name: "a.txt", data: Buffer.alloc(3000), deflate: true }]);
    const centralStart = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(5000, centralStart + 24);
    await expectInvalid(readEntry(bytes, "a.txt"), /does not match its declared size/);
  });

  it("rejects an entry whose CRC does not match", async () => {
    const entries = [{ name: "a.txt", data: Buffer.from("payload"), crc: 12345 }];
    await expectInvalid(readEntry(entries, "a.txt"), /CRC/);
  });

  it("rejects an encrypted entry", async () => {
    const entries = [{ name: "a.txt", data: Buffer.from("payload"), flags: 1 }];
    await expectInvalid(readEntry(entries, "a.txt"), /encrypted/);
  });

  it("rejects an unsupported compression method", async () => {
    const entries = [{ name: "a.txt", data: Buffer.from("payload"), method: 12 }];
    await expectInvalid(readEntry(entries, "a.txt"), /compression method 12/);
  });

  it("rejects an entry whose data runs past the end of the file", async () => {
    const bytes = buildZip([{ name: "a.txt", data: Buffer.from("payload") }]);
    const centralStart = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(1_000_000, centralStart + 20);
    bytes.writeUInt32LE(1_000_000, centralStart + 24);
    await expectInvalid(readEntry(bytes, "a.txt"), /outside the file/);
  });

  it("rejects an entry whose local header offset is outside the file", async () => {
    const bytes = buildZip([{ name: "a.txt", data: Buffer.from("payload") }]);
    const centralStart = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(0x7fffffff, centralStart + 42);
    await expectInvalid(readEntry(bytes, "a.txt"), /outside the file/);
  });

  it("rejects an archive that stops after its deadline", async () => {
    const bytes = buildZip([{ name: "a.txt", data: Buffer.from("x") }]);
    const filePath = await writeArchive(bytes);
    await expectInvalid(ZipArchive.open(filePath, new Deadline(0)), /too long/);
  });
});
