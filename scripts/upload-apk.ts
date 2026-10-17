import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { basename, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

const DEFAULT_SERVER = "http://localhost:3000";
const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE = `Usage: upload-apk <apk-path> --version-name <name> --version-code <number> [options]

Uploads a built APK to an AeroDeploy server.

Options:
  --version-name <name>   Version name, e.g. 1.0.2 (required)
  --version-code <n>      Positive integer, unique per release (required)
  --notes <text>          Release notes
  --server <url>          Server address (default: $AERODEPLOY_URL, then ${DEFAULT_SERVER})
  -h, --help              Show this text

Exit codes: 0 uploaded, 1 upload failed, 2 invalid arguments.`;

export interface ScriptIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

interface UploadRequest {
  apkPath: string;
  versionName: string;
  versionCode: string;
  notes: string | undefined;
  server: string;
}

/** Thrown for argument problems; `run` turns it into the usage exit code. */
class UsageError extends Error {}

const uploadedSchema = z.object({
  data: z.object({
    id: z.number(),
    versionName: z.string(),
    versionCode: z.number(),
    fileName: z.string(),
    fileSize: z.string(),
  }),
});

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

function readArguments(argv: string[], env: NodeJS.ProcessEnv): UploadRequest | "help" {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "version-name": { type: "string" },
        "version-code": { type: "string" },
        notes: { type: "string" },
        server: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }

  const { values, positionals } = parsed;
  if (values.help) {
    return "help";
  }
  const [apkPath, ...extra] = positionals;
  if (apkPath === undefined) {
    throw new UsageError("the apk path is required");
  }
  if (extra.length > 0) {
    throw new UsageError("only one apk path can be uploaded at a time");
  }

  const versionName = values["version-name"]?.trim();
  if (!versionName) {
    throw new UsageError("--version-name is required");
  }
  const versionCode = values["version-code"];
  if (versionCode === undefined) {
    throw new UsageError("--version-code is required");
  }
  if (!/^[1-9]\d*$/.test(versionCode)) {
    throw new UsageError("--version-code must be a positive integer");
  }

  return {
    apkPath,
    versionName,
    versionCode,
    notes: values.notes,
    server: normalizeServer(values.server ?? env.AERODEPLOY_URL ?? DEFAULT_SERVER),
  };
}

function normalizeServer(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new UsageError(`--server must be an http or https URL, got "${raw}"`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(`--server must be an http or https URL, got "${raw}"`);
  }
  return raw.replace(/\/+$/, "");
}

async function checkApkFile(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() ? undefined : `${path} is not a file`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return `apk file not found: ${path}`;
    }
    return `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function describeNetworkError(error: unknown): string {
  const source = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (source instanceof Error) {
    const code = (source as NodeJS.ErrnoException).code;
    if (source.message === "") {
      return code ?? "unknown error";
    }
    return code === undefined || source.message.includes(code)
      ? source.message
      : `${code} ${source.message}`;
  }
  return String(source);
}

function quoteHeaderValue(value: string): string {
  return value.replace(/["\\\r\n]/g, "_");
}

/**
 * Builds the multipart body by hand because FormData with a file buffers the whole file in
 * memory and rewrites line breaks in text fields to CRLF. The file is read in chunks.
 */
async function* multipartBody(
  boundary: string,
  fields: [name: string, value: string][],
  filePath: string,
): AsyncGenerator<Buffer> {
  for (const [name, value] of fields) {
    yield Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );
  }
  yield Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="apk"; filename="${quoteHeaderValue(basename(filePath))}"\r\n` +
      "Content-Type: application/vnd.android.package-archive\r\n\r\n",
  );
  for await (const chunk of createReadStream(filePath)) {
    yield chunk as Buffer;
  }
  yield Buffer.from(`\r\n--${boundary}--\r\n`);
}

interface UploadResponse {
  status: number;
  statusText: string;
  ok: boolean;
  body: string;
}

/** Sends the body as it is read, so memory use does not grow with the file size. */
function postStream(
  url: URL,
  headers: http.OutgoingHttpHeaders,
  body: AsyncIterable<Buffer>,
): Promise<UploadResponse> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolvePromise, reject) => {
    const req = transport.request(url, { method: "POST", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        resolvePromise({
          status,
          statusText: res.statusMessage ?? "",
          ok: status >= 200 && status < 300,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    pipeline(Readable.from(body), req).catch(reject);
  });
}

async function upload(request: UploadRequest, io: ScriptIo): Promise<number> {
  const fields: [string, string][] = [
    ["versionName", request.versionName],
    ["versionCode", request.versionCode],
  ];
  if (request.notes !== undefined) {
    fields.push(["releaseNotes", request.notes]);
  }
  const boundary = `aerodeploy-${randomUUID()}`;

  let response: UploadResponse;
  try {
    response = await postStream(
      new URL(`${request.server}/api/apks/upload`),
      { "content-type": `multipart/form-data; boundary=${boundary}` },
      multipartBody(boundary, fields, request.apkPath),
    );
  } catch (error) {
    io.stderr(`Could not reach ${request.server}: ${describeNetworkError(error)}`);
    return EXIT_FAILED;
  }

  const text = response.body;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }

  if (response.ok) {
    const uploaded = uploadedSchema.safeParse(body);
    if (uploaded.success) {
      const { id, versionName, versionCode, fileName, fileSize } = uploaded.data.data;
      io.stdout(
        `Uploaded ${fileName} (version ${versionName}, code ${versionCode}, ${fileSize}) as release ${id}`,
      );
    } else {
      io.stdout(`Uploaded ${basename(request.apkPath)} (HTTP ${response.status})`);
    }
    return EXIT_OK;
  }

  const failure = errorSchema.safeParse(body);
  if (failure.success) {
    const { code, message } = failure.data.error;
    io.stderr(`Upload failed (HTTP ${response.status} ${code}): ${message}`);
  } else {
    io.stderr(`Upload failed (HTTP ${response.status} ${response.statusText})`);
  }
  return EXIT_FAILED;
}

export async function run(argv: string[], env: NodeJS.ProcessEnv, io: ScriptIo): Promise<number> {
  let request: UploadRequest | "help";
  try {
    request = readArguments(argv, env);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`error: ${error.message}`);
      io.stderr(USAGE);
      return EXIT_USAGE;
    }
    throw error;
  }

  if (request === "help") {
    io.stdout(USAGE);
    return EXIT_OK;
  }

  const fileProblem = await checkApkFile(request.apkPath);
  if (fileProblem !== undefined) {
    io.stderr(`error: ${fileProblem}`);
    return EXIT_FAILED;
  }
  return upload(request, io);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await run(process.argv.slice(2), process.env, {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
}
