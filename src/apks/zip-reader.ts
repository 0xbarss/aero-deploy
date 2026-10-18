import { open, type FileHandle } from "node:fs/promises";
import { crc32, inflateRawSync } from "node:zlib";
import { InvalidApkError } from "../errors.js";
import type { Deadline } from "./deadline.js";

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_RECORD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const MAX_COMMENT_SIZE = 0xffff;
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const FLAG_ENCRYPTED = 0x1;

interface CentralEntry {
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Random-access reader for one ZIP file. Only the central directory and the entries that are
 * asked for are loaded. ZIP64 archives are rejected.
 */
export class ZipArchive {
  private constructor(
    private readonly handle: FileHandle,
    private readonly fileSize: number,
    private readonly centralDirectory: Buffer,
    private readonly deadline: Deadline,
  ) {}

  static async open(filePath: string, deadline: Deadline): Promise<ZipArchive> {
    deadline.check();
    const handle = await open(filePath, "r");
    try {
      const { size } = await handle.stat();
      const centralDirectory = await readCentralDirectory(handle, size);
      return new ZipArchive(handle, size, centralDirectory, deadline);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.handle.close();
  }

  /** Returns null when there is no such entry; throws InvalidApkError when the entry is unreadable. */
  async readEntry(name: string, maxBytes: number): Promise<Buffer | null> {
    const entry = this.findEntry(name);
    if (entry === null) {
      return null;
    }
    this.deadline.check();

    if ((entry.flags & FLAG_ENCRYPTED) !== 0) {
      throw new InvalidApkError(`${name} is encrypted`);
    }
    if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATED) {
      throw new InvalidApkError(`${name} uses unsupported compression method ${entry.method}`);
    }
    if (entry.uncompressedSize > maxBytes || entry.compressedSize > maxBytes) {
      throw new InvalidApkError(`${name} is too large (limit ${maxBytes} bytes)`);
    }

    const compressed = await this.readCompressedData(name, entry);
    const data = decompress(name, entry, compressed);
    if (crc32(data) !== entry.crc) {
      throw new InvalidApkError(`${name} failed its CRC check`);
    }
    return data;
  }

  private findEntry(wanted: string): CentralEntry | null {
    const directory = this.centralDirectory;
    let position = 0;
    while (position < directory.length) {
      this.deadline.check();
      if (
        directory.length - position < CENTRAL_HEADER_SIZE ||
        directory.readUInt32LE(position) !== CENTRAL_SIGNATURE
      ) {
        throw new InvalidApkError("ZIP central directory is damaged");
      }
      const nameLength = directory.readUInt16LE(position + 28);
      const extraLength = directory.readUInt16LE(position + 30);
      const commentLength = directory.readUInt16LE(position + 32);
      const nameStart = position + CENTRAL_HEADER_SIZE;
      const next = nameStart + nameLength + extraLength + commentLength;
      if (next > directory.length) {
        throw new InvalidApkError("ZIP central directory is damaged");
      }
      if (directory.toString("latin1", nameStart, nameStart + nameLength) === wanted) {
        return {
          flags: directory.readUInt16LE(position + 8),
          method: directory.readUInt16LE(position + 10),
          crc: directory.readUInt32LE(position + 16),
          compressedSize: directory.readUInt32LE(position + 20),
          uncompressedSize: directory.readUInt32LE(position + 24),
          localHeaderOffset: directory.readUInt32LE(position + 42),
        };
      }
      position = next;
    }
    return null;
  }

  private async readCompressedData(name: string, entry: CentralEntry): Promise<Buffer> {
    if (entry.localHeaderOffset + LOCAL_HEADER_SIZE > this.fileSize) {
      throw new InvalidApkError(`${name} starts outside the file`);
    }
    const header = Buffer.alloc(LOCAL_HEADER_SIZE);
    await readExactly(this.handle, header, entry.localHeaderOffset);
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new InvalidApkError(`${name} has a damaged local header`);
    }
    const dataStart =
      entry.localHeaderOffset +
      LOCAL_HEADER_SIZE +
      header.readUInt16LE(26) +
      header.readUInt16LE(28);
    if (dataStart + entry.compressedSize > this.fileSize) {
      throw new InvalidApkError(`${name} data lies outside the file`);
    }
    const compressed = Buffer.alloc(entry.compressedSize);
    await readExactly(this.handle, compressed, dataStart);
    return compressed;
  }
}

async function readCentralDirectory(handle: FileHandle, fileSize: number): Promise<Buffer> {
  if (fileSize < END_RECORD_SIZE) {
    throw new InvalidApkError("File is not a ZIP archive");
  }
  const tailLength = Math.min(fileSize, END_RECORD_SIZE + MAX_COMMENT_SIZE);
  const tailStart = fileSize - tailLength;
  const tail = Buffer.alloc(tailLength);
  await readExactly(handle, tail, tailStart);

  for (let position = tailLength - END_RECORD_SIZE; position >= 0; position -= 1) {
    if (
      tail.readUInt32LE(position) !== END_SIGNATURE ||
      position + END_RECORD_SIZE + tail.readUInt16LE(position + 20) !== tailLength
    ) {
      continue;
    }
    const entryCount = tail.readUInt16LE(position + 10);
    const size = tail.readUInt32LE(position + 12);
    const offset = tail.readUInt32LE(position + 16);
    if (entryCount === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
      throw new InvalidApkError("ZIP64 archives are not supported");
    }
    if (size > MAX_CENTRAL_DIRECTORY_BYTES) {
      throw new InvalidApkError("ZIP central directory is too large");
    }
    if (offset + size > tailStart + position) {
      throw new InvalidApkError("ZIP central directory lies outside the file");
    }
    const directory = Buffer.alloc(size);
    await readExactly(handle, directory, offset);
    return directory;
  }
  throw new InvalidApkError("File is not a ZIP archive");
}

async function readExactly(handle: FileHandle, target: Buffer, position: number): Promise<void> {
  if (target.length === 0) {
    return;
  }
  const { bytesRead } = await handle.read(target, 0, target.length, position);
  if (bytesRead !== target.length) {
    throw new InvalidApkError("ZIP archive is cut off");
  }
}

function decompress(name: string, entry: CentralEntry, compressed: Buffer): Buffer {
  if (entry.method === METHOD_STORED) {
    if (compressed.length !== entry.uncompressedSize) {
      throw new InvalidApkError(`${name} has inconsistent sizes`);
    }
    return compressed;
  }
  if (entry.uncompressedSize === 0) {
    return Buffer.alloc(0);
  }
  let data: Buffer;
  try {
    // The declared size doubles as the output cap, so a stream that expands further is refused
    data = inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new InvalidApkError(`${name} is larger than its declared size`, { cause: error });
    }
    throw new InvalidApkError(`${name} could not be decompressed`, { cause: error });
  }
  if (data.length !== entry.uncompressedSize) {
    throw new InvalidApkError(`${name} does not match its declared size`);
  }
  return data;
}
