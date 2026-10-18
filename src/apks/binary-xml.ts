import type { Deadline } from "./deadline.js";
import {
  BinaryFormatError,
  CHUNK_STRING_POOL,
  readChunkHeader,
  translateRangeErrors,
} from "./binary-format.js";
import { StringPool } from "./string-pool.js";

const CHUNK_XML = 0x0003;
const CHUNK_RESOURCE_MAP = 0x0180;
const CHUNK_START_ELEMENT = 0x0102;
const NO_INDEX = 0xffffffff;
const ATTRIBUTE_SIZE = 20;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DECIMAL = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_BOOLEAN = 0x12;

export type AttributeValue =
  | { kind: "string"; value: string }
  | { kind: "int"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "reference"; resourceId: number }
  | { kind: "other" };

export interface XmlAttribute {
  namespace: string | null;
  name: string;
  /** Android attribute id from the file's resource map, when it has one */
  resourceId: number | null;
  value: AttributeValue;
}

export interface XmlElement {
  name: string;
  attributes: XmlAttribute[];
}

/** Returns every element start tag in document order. Throws BinaryFormatError on bad data. */
export function parseBinaryXml(data: Buffer, deadline: Deadline): XmlElement[] {
  return translateRangeErrors(() => {
    const root = readChunkHeader(data, 0);
    if (root.type !== CHUNK_XML) {
      throw new BinaryFormatError("Not Android binary XML");
    }

    let pool: StringPool | null = null;
    let resourceIds: number[] = [];
    const elements: XmlElement[] = [];

    let offset = root.headerSize;
    while (offset < root.size) {
      deadline.check();
      const chunk = readChunkHeader(data, offset, root.size);
      if (chunk.type === CHUNK_STRING_POOL) {
        pool = StringPool.parse(data, offset);
      } else if (chunk.type === CHUNK_RESOURCE_MAP) {
        resourceIds = readResourceMap(data, offset, chunk.headerSize, chunk.size);
      } else if (chunk.type === CHUNK_START_ELEMENT) {
        if (pool === null) {
          throw new BinaryFormatError("Element appears before the string pool");
        }
        elements.push(readElement(data, offset, chunk.headerSize, chunk.size, pool, resourceIds));
      }
      offset += chunk.size;
    }
    return elements;
  });
}

function readResourceMap(data: Buffer, offset: number, headerSize: number, size: number): number[] {
  const ids: number[] = [];
  for (let position = offset + headerSize; position + 4 <= offset + size; position += 4) {
    ids.push(data.readUInt32LE(position));
  }
  return ids;
}

function readElement(
  data: Buffer,
  offset: number,
  headerSize: number,
  size: number,
  pool: StringPool,
  resourceIds: number[],
): XmlElement {
  const extension = offset + headerSize;
  const attributeStart = data.readUInt16LE(extension + 8);
  const attributeSize = data.readUInt16LE(extension + 10);
  const attributeCount = data.readUInt16LE(extension + 12);
  if (attributeSize < ATTRIBUTE_SIZE) {
    throw new BinaryFormatError("Attribute record is too small");
  }
  const attributesStart = extension + attributeStart;
  if (attributesStart + attributeCount * attributeSize > offset + size) {
    throw new BinaryFormatError("Attributes are larger than their element");
  }

  const attributes: XmlAttribute[] = [];
  for (let index = 0; index < attributeCount; index += 1) {
    const position = attributesStart + index * attributeSize;
    const namespaceIndex = data.readUInt32LE(position);
    const nameIndex = data.readUInt32LE(position + 4);
    const resourceId = resourceIds[nameIndex];
    attributes.push({
      namespace: namespaceIndex === NO_INDEX ? null : pool.get(namespaceIndex),
      name: pool.get(nameIndex),
      resourceId: resourceId === undefined || resourceId === 0 ? null : resourceId,
      value: readValue(data, position + 12, pool),
    });
  }
  return { name: pool.get(data.readUInt32LE(extension + 4)), attributes };
}

function readValue(data: Buffer, position: number, pool: StringPool): AttributeValue {
  const type = data.readUInt8(position + 3);
  switch (type) {
    case TYPE_STRING:
      return { kind: "string", value: pool.get(data.readUInt32LE(position + 4)) };
    case TYPE_INT_DECIMAL:
    case TYPE_INT_HEX:
      return { kind: "int", value: data.readInt32LE(position + 4) };
    case TYPE_BOOLEAN:
      return { kind: "boolean", value: data.readUInt32LE(position + 4) !== 0 };
    case TYPE_REFERENCE:
      return { kind: "reference", resourceId: data.readUInt32LE(position + 4) };
    default:
      return { kind: "other" };
  }
}
