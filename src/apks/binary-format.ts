/** Thrown when Android binary XML or a resource table is malformed. */
export class BinaryFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export interface ChunkHeader {
  type: number;
  headerSize: number;
  size: number;
}

export const CHUNK_STRING_POOL = 0x0001;

/** `limit` is the end of the enclosing chunk; the new chunk must fit inside it. */
export function readChunkHeader(data: Buffer, offset: number, limit = data.length): ChunkHeader {
  if (offset < 0 || offset + 8 > limit) {
    throw new BinaryFormatError("Chunk header is cut off");
  }
  const header = {
    type: data.readUInt16LE(offset),
    headerSize: data.readUInt16LE(offset + 2),
    size: data.readUInt32LE(offset + 4),
  };
  if (header.headerSize < 8 || header.size < header.headerSize || offset + header.size > limit) {
    throw new BinaryFormatError("Chunk size is invalid");
  }
  return header;
}

/** Reads past the end of the buffer throw RangeError; report them as format errors instead. */
export function translateRangeErrors<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof RangeError) {
      throw new BinaryFormatError("Data is cut off", { cause: error });
    }
    throw error;
  }
}
