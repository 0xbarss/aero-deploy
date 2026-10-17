// Anything outside printable ASCII, plus the characters that end or escape a quoted string
const FALLBACK_UNSAFE = /[^\x20-\x7e]|["\\%]/gu;

/** encodeURIComponent leaves these unescaped, but RFC 5987 does not allow them in filename*. */
function encodeExtendedValue(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function buildContentDisposition(fileName: string): string {
  const fallback = fileName.replace(FALLBACK_UNSAFE, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeExtendedValue(fileName)}`;
}
