import type { Deadline } from "./deadline.js";
import {
  BinaryFormatError,
  CHUNK_STRING_POOL,
  readChunkHeader,
  translateRangeErrors,
} from "./binary-format.js";
import { StringPool } from "./string-pool.js";

const CHUNK_TABLE = 0x0002;
const CHUNK_PACKAGE = 0x0200;
const CHUNK_TYPE = 0x0201;
const NO_ENTRY = 0xffffffff;
const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const ENTRY_FLAG_COMPLEX = 0x0001;
const ENTRY_FLAG_COMPACT = 0x0008;
// Sparse and 16-bit offset entry arrays are newer layouts that are not read
const TYPE_FLAGS_UNSUPPORTED = 0x03;
const CONFIG_OFFSET = 20;
const MAX_REFERENCE_DEPTH = 4;

interface PackageChunk {
  id: number;
  offset: number;
  headerSize: number;
  end: number;
}

/** Looks up string resources in `resources.arsc`, using only the default (unqualified) configuration. */
export class ResourceTable {
  private constructor(
    private readonly data: Buffer,
    private readonly strings: StringPool,
    private readonly packages: PackageChunk[],
    private readonly deadline: Deadline,
  ) {}

  /** Throws BinaryFormatError on bad data. */
  static parse(data: Buffer, deadline: Deadline): ResourceTable {
    return translateRangeErrors(() => {
      const table = readChunkHeader(data, 0);
      if (table.type !== CHUNK_TABLE) {
        throw new BinaryFormatError("Not an Android resource table");
      }
      let strings: StringPool | null = null;
      const packages: PackageChunk[] = [];
      let offset = table.headerSize;
      while (offset < table.size) {
        deadline.check();
        const chunk = readChunkHeader(data, offset, table.size);
        if (chunk.type === CHUNK_STRING_POOL && strings === null) {
          strings = StringPool.parse(data, offset);
        } else if (chunk.type === CHUNK_PACKAGE) {
          packages.push({
            id: data.readUInt32LE(offset + 8),
            offset,
            headerSize: chunk.headerSize,
            end: offset + chunk.size,
          });
        }
        offset += chunk.size;
      }
      if (strings === null) {
        throw new BinaryFormatError("Resource table has no string pool");
      }
      return new ResourceTable(data, strings, packages, deadline);
    });
  }

  /** Null when the resource is missing, is not a string, or only exists for other configurations. */
  resolveString(resourceId: number): string | null {
    return translateRangeErrors(() => this.resolve(resourceId, 0));
  }

  private resolve(resourceId: number, depth: number): string | null {
    const packageId = resourceId >>> 24;
    const typeId = (resourceId >>> 16) & 0xff;
    const entryIndex = resourceId & 0xffff;

    for (const chunkPackage of this.packages) {
      if (chunkPackage.id !== packageId) {
        continue;
      }
      let offset = chunkPackage.offset + chunkPackage.headerSize;
      while (offset < chunkPackage.end) {
        this.deadline.check();
        const chunk = readChunkHeader(this.data, offset, chunkPackage.end);
        if (
          chunk.type === CHUNK_TYPE &&
          this.data.readUInt8(offset + 8) === typeId &&
          this.isDefaultConfig(offset, chunk.headerSize)
        ) {
          return this.readEntry(offset, chunk, entryIndex, depth);
        }
        offset += chunk.size;
      }
    }
    return null;
  }

  private isDefaultConfig(chunkOffset: number, headerSize: number): boolean {
    const configSize = this.data.readUInt32LE(chunkOffset + CONFIG_OFFSET);
    if (configSize < 4 || CONFIG_OFFSET + configSize > headerSize) {
      return false;
    }
    // The default configuration has every qualifier field set to zero
    for (let index = 4; index < configSize; index += 1) {
      if (this.data.readUInt8(chunkOffset + CONFIG_OFFSET + index) !== 0) {
        return false;
      }
    }
    return true;
  }

  private readEntry(
    chunkOffset: number,
    chunk: { headerSize: number; size: number },
    entryIndex: number,
    depth: number,
  ): string | null {
    const flags = this.data.readUInt8(chunkOffset + 9);
    const entryCount = this.data.readUInt32LE(chunkOffset + 12);
    const entriesStart = this.data.readUInt32LE(chunkOffset + 16);
    if ((flags & TYPE_FLAGS_UNSUPPORTED) !== 0 || entryIndex >= entryCount) {
      return null;
    }
    const chunkEnd = chunkOffset + chunk.size;
    const offsetPosition = chunkOffset + chunk.headerSize + entryIndex * 4;
    if (offsetPosition + 4 > chunkEnd) {
      throw new BinaryFormatError("Entry offsets are larger than their chunk");
    }
    const entryOffset = this.data.readUInt32LE(offsetPosition);
    if (entryOffset === NO_ENTRY) {
      return null;
    }
    const entryPosition = chunkOffset + entriesStart + entryOffset;
    if (entryPosition + 16 > chunkEnd) {
      throw new BinaryFormatError("Entry lies outside its chunk");
    }
    const entryFlags = this.data.readUInt16LE(entryPosition + 2);
    if ((entryFlags & (ENTRY_FLAG_COMPLEX | ENTRY_FLAG_COMPACT)) !== 0) {
      return null;
    }
    const valuePosition = entryPosition + this.data.readUInt16LE(entryPosition);
    if (valuePosition + 8 > chunkEnd) {
      throw new BinaryFormatError("Entry value lies outside its chunk");
    }
    const type = this.data.readUInt8(valuePosition + 3);
    const value = this.data.readUInt32LE(valuePosition + 4);
    if (type === TYPE_STRING) {
      return this.strings.get(value);
    }
    if (type === TYPE_REFERENCE && depth < MAX_REFERENCE_DEPTH) {
      return this.resolve(value, depth + 1);
    }
    return null;
  }
}
