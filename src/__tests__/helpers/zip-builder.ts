import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntrySpec {
  name: string;
  data: Buffer;
  deflate?: boolean;
  /** Overrides for building deliberately broken archives */
  crc?: number;
  method?: number;
  flags?: number;
}

export interface ZipBuildOptions {
  comment?: string;
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const DOS_DATE_1980_01_01 = 0x21;

/** Builds a small ZIP archive in memory. Not a general writer: no ZIP64, extra fields or data descriptors. */
export function buildZip(entries: ZipEntrySpec[], options: ZipBuildOptions = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const stored = entry.deflate === true ? deflateRawSync(entry.data) : entry.data;
    const method = entry.method ?? (entry.deflate === true ? 8 : 0);
    const flags = entry.flags ?? 0;
    const crc = entry.crc ?? crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(stored.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    parts.push(local, name, stored);
    offset += local.length + name.length + stored.length;
  }

  const centralBytes = Buffer.concat(central);
  const comment = Buffer.from(options.comment ?? "", "utf8");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);

  return Buffer.concat([...parts, centralBytes, end, comment]);
}
