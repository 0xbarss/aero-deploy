import { randomBytes } from "node:crypto";

export type MultipartPart =
  { name: string; value: string } | { name: string; filename: string; content: Buffer };

const BOUNDARY = "----aerodeploytestboundary";

export function multipartBody(parts: MultipartPart[]): {
  payload: Buffer;
  headers: { "content-type": string };
} {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if ("filename" in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            "Content-Type: application/vnd.android.package-archive\r\n\r\n",
        ),
        part.content,
        Buffer.from("\r\n"),
      );
    } else {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`),
      );
    }
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

/** Bytes that start with the ZIP signature every APK has, followed by random content. */
export function fakeApk(size = 2048): Buffer {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), randomBytes(size)]);
}
