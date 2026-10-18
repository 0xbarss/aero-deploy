import { InvalidApkError } from "../errors.js";
import { BinaryFormatError } from "./binary-format.js";
import { parseBinaryXml, type AttributeValue, type XmlElement } from "./binary-xml.js";
import { Deadline } from "./deadline.js";
import { ResourceTable } from "./resource-table.js";
import { ZipArchive } from "./zip-reader.js";

const MANIFEST_ENTRY = "AndroidManifest.xml";
const RESOURCE_TABLE_ENTRY = "resources.arsc";
const ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android";
const MAX_INT4 = 2_147_483_647;
// Matches the length of apps.package_name
const MAX_PACKAGE_NAME_LENGTH = 255;

interface AndroidAttribute {
  id: number;
  name: string;
}

const LABEL: AndroidAttribute = { id: 0x01010001, name: "label" };
const DEBUGGABLE: AndroidAttribute = { id: 0x0101000f, name: "debuggable" };
const MIN_SDK: AndroidAttribute = { id: 0x0101020c, name: "minSdkVersion" };
const TARGET_SDK: AndroidAttribute = { id: 0x01010270, name: "targetSdkVersion" };
const VERSION_CODE: AndroidAttribute = { id: 0x0101021b, name: "versionCode" };
const VERSION_NAME: AndroidAttribute = { id: 0x0101021c, name: "versionName" };

export interface ApkManifestInfo {
  packageName: string;
  /** Null when the manifest has no literal versionName */
  versionName: string | null;
  versionCode: number;
  /** The label in the default language; null when absent or not resolvable */
  appLabel: string | null;
  debuggable: boolean;
  minSdk: number | null;
  targetSdk: number | null;
}

export interface ApkReadLimits {
  /** Largest accepted size of AndroidManifest.xml after decompression */
  maxManifestBytes: number;
  /** Largest accepted size of resources.arsc after decompression */
  maxResourceTableBytes: number;
  timeoutMs: number;
}

const DEFAULT_LIMITS: ApkReadLimits = {
  maxManifestBytes: 4 * 1024 * 1024,
  maxResourceTableBytes: 32 * 1024 * 1024,
  timeoutMs: 5_000,
};

/**
 * Reads the identity of an APK from its manifest. Only AndroidManifest.xml and, for a label that
 * is a string resource, resources.arsc are loaded. Throws InvalidApkError for anything unreadable.
 */
export async function readApkManifest(
  filePath: string,
  limits: Partial<ApkReadLimits> = {},
): Promise<ApkManifestInfo> {
  const settings = { ...DEFAULT_LIMITS, ...limits };
  const deadline = new Deadline(settings.timeoutMs);
  const archive = await ZipArchive.open(filePath, deadline);
  try {
    const manifestBytes = await archive.readEntry(MANIFEST_ENTRY, settings.maxManifestBytes);
    if (manifestBytes === null) {
      throw new InvalidApkError(`APK has no ${MANIFEST_ENTRY}`);
    }
    const elements = parseManifest(manifestBytes, deadline);

    const manifest = elements[0];
    if (manifest?.name !== "manifest") {
      throw new InvalidApkError(`${MANIFEST_ENTRY} does not start with a manifest element`);
    }
    const application = elements.find((element) => element.name === "application");
    const usesSdk = elements.find((element) => element.name === "uses-sdk");

    const label = application === undefined ? undefined : attributeValue(application, LABEL);
    return {
      packageName: readPackageName(manifest),
      versionName: readVersionName(manifest),
      versionCode: readVersionCode(manifest),
      appLabel: await resolveLabel(label, archive, settings.maxResourceTableBytes, deadline),
      debuggable: application !== undefined && isTrue(attributeValue(application, DEBUGGABLE)),
      minSdk: usesSdk === undefined ? null : intValue(attributeValue(usesSdk, MIN_SDK)),
      targetSdk: usesSdk === undefined ? null : intValue(attributeValue(usesSdk, TARGET_SDK)),
    };
  } finally {
    await archive.close();
  }
}

function parseManifest(bytes: Buffer, deadline: Deadline): XmlElement[] {
  try {
    return parseBinaryXml(bytes, deadline);
  } catch (error) {
    if (error instanceof BinaryFormatError) {
      throw new InvalidApkError(`${MANIFEST_ENTRY} is not valid binary XML`, { cause: error });
    }
    throw error;
  }
}

function attributeValue(
  element: XmlElement,
  attribute: AndroidAttribute,
): AttributeValue | undefined {
  // The resource map id is authoritative; the name only counts when the file has no id for it
  return element.attributes.find((candidate) =>
    candidate.resourceId === null
      ? candidate.namespace === ANDROID_NAMESPACE && candidate.name === attribute.name
      : candidate.resourceId === attribute.id,
  )?.value;
}

function readPackageName(manifest: XmlElement): string {
  const value = manifest.attributes.find(
    (candidate) => candidate.namespace === null && candidate.name === "package",
  )?.value;
  if (
    value?.kind !== "string" ||
    value.value.length === 0 ||
    value.value.length > MAX_PACKAGE_NAME_LENGTH ||
    value.value.includes("\u0000")
  ) {
    throw new InvalidApkError("Manifest has no valid package name");
  }
  return value.value;
}

function readVersionCode(manifest: XmlElement): number {
  const code = intValue(attributeValue(manifest, VERSION_CODE));
  if (code === null || code < 1 || code > MAX_INT4) {
    throw new InvalidApkError(`Manifest versionCode must be between 1 and ${MAX_INT4}`);
  }
  return code;
}

function readVersionName(manifest: XmlElement): string | null {
  const value = attributeValue(manifest, VERSION_NAME);
  return value?.kind === "string" && value.value.length > 0 ? value.value : null;
}

function intValue(value: AttributeValue | undefined): number | null {
  if (value?.kind === "int") {
    return value.value;
  }
  if (value?.kind === "string" && /^\d+$/.test(value.value)) {
    return Number(value.value);
  }
  return null;
}

function isTrue(value: AttributeValue | undefined): boolean {
  if (value?.kind === "boolean") {
    return value.value;
  }
  return value?.kind === "int" && value.value !== 0;
}

async function resolveLabel(
  value: AttributeValue | undefined,
  archive: ZipArchive,
  maxResourceTableBytes: number,
  deadline: Deadline,
): Promise<string | null> {
  if (value?.kind === "string") {
    return nonEmpty(value.value);
  }
  if (value?.kind !== "reference") {
    return null;
  }
  const tableBytes = await archive.readEntry(RESOURCE_TABLE_ENTRY, maxResourceTableBytes);
  if (tableBytes === null) {
    return null;
  }
  try {
    const resolved = ResourceTable.parse(tableBytes, deadline).resolveString(value.resourceId);
    return resolved === null ? null : nonEmpty(resolved);
  } catch (error) {
    // A label that cannot be resolved is not fatal; the caller falls back to the package name
    if (error instanceof BinaryFormatError) {
      return null;
    }
    throw error;
  }
}

function nonEmpty(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}
