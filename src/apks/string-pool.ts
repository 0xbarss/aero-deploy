import { BinaryFormatError, CHUNK_STRING_POOL, readChunkHeader } from "./binary-format.js";

const UTF8_FLAG = 0x100;
const POOL_HEADER_SIZE = 28;

/** Strings are decoded on demand, because a resource table can hold tens of thousands. */
export class StringPool {
  private constructor(
    private readonly data: Buffer,
    private readonly count: number,
    private readonly offsetsStart: number,
    private readonly stringsStart: number,
    private readonly chunkEnd: number,
    private readonly isUtf8: boolean,
  ) {}

  static parse(data: Buffer, chunkOffset: number): StringPool {
    const header = readChunkHeader(data, chunkOffset);
    if (header.type !== CHUNK_STRING_POOL || header.headerSize < POOL_HEADER_SIZE) {
      throw new BinaryFormatError("Expected a string pool");
    }
    const count = data.readUInt32LE(chunkOffset + 8);
    const flags = data.readUInt32LE(chunkOffset + 16);
    const stringsStart = chunkOffset + data.readUInt32LE(chunkOffset + 20);
    const offsetsStart = chunkOffset + header.headerSize;
    const chunkEnd = chunkOffset + header.size;
    if (offsetsStart + count * 4 > chunkEnd || stringsStart > chunkEnd) {
      throw new BinaryFormatError("String pool is larger than its chunk");
    }
    return new StringPool(
      data,
      count,
      offsetsStart,
      stringsStart,
      chunkEnd,
      (flags & UTF8_FLAG) !== 0,
    );
  }

  get(index: number): string {
    if (index < 0 || index >= this.count) {
      throw new BinaryFormatError(`String index ${index} is outside the pool`);
    }
    const position = this.stringsStart + this.data.readUInt32LE(this.offsetsStart + index * 4);
    if (position >= this.chunkEnd) {
      throw new BinaryFormatError("String lies outside the pool");
    }
    return this.isUtf8 ? this.readUtf8(position) : this.readUtf16(position);
  }

  private readUtf8(start: number): string {
    // Each string stores its length in characters, then in bytes; both use 1 or 2 bytes
    let position = start;
    if ((this.data.readUInt8(position) & 0x80) !== 0) {
      position += 1;
    }
    position += 1;
    let byteLength = this.data.readUInt8(position);
    position += 1;
    if ((byteLength & 0x80) !== 0) {
      byteLength = ((byteLength & 0x7f) << 8) | this.data.readUInt8(position);
      position += 1;
    }
    return this.decode("utf8", position, position + byteLength);
  }

  private readUtf16(start: number): string {
    // The length in characters is 1 or 2 UTF-16 units; the high bit of the first marks 2
    let position = start;
    let length = this.data.readUInt16LE(position);
    position += 2;
    if ((length & 0x8000) !== 0) {
      length = ((length & 0x7fff) << 16) | this.data.readUInt16LE(position);
      position += 2;
    }
    return this.decode("utf16le", position, position + length * 2);
  }

  private decode(encoding: "utf8" | "utf16le", start: number, end: number): string {
    if (end > this.chunkEnd) {
      throw new BinaryFormatError("String lies outside the pool");
    }
    return this.data.toString(encoding, start, end);
  }
}
