# AeroDeploy

![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-ES2022-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)
![Author](https://img.shields.io/badge/author-0xbarss-lightgrey)

AeroDeploy is a Fastify service for a local network. A build script uploads each new Android APK to it, the files stay on the server's disk with their metadata in PostgreSQL, and a mobile app asks the server for the newest version and downloads it.

## Table of Contents

- [Why AeroDeploy?](#why-aerodeploy)
- [Architecture & Design](#architecture--design)
- [Key Features](#key-features)
- [Repository Structure](#repository-structure)
- [Prerequisites & Installation](#prerequisites--installation)
- [Usage & Examples](#usage--examples)
- [API Reference](#api-reference)
- [CLI Reference](#cli-reference)
- [Configuration](#configuration)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [Author & Contributions](#author--contributions)
- [License & Disclaimer](#license--disclaimer)

## Why AeroDeploy?

During development and in small test groups, every new build has to reach a phone or an emulator. Copying the APK by cable, chat or a shared drive is manual, easy to forget and leaves testers unsure which build they have.

Hosted distribution services solve this, but they need an account, an internet connection and a setup step on every tester's device. AeroDeploy keeps the whole path on your own network:

- the build script pushes the APK with one command, and fails the build step if the upload fails;
- the server records `versionName`, `versionCode`, file size, upload time and release notes for each build;
- the app compares its own `versionCode` with `GET /api/apks/latest` and downloads the file from the same server.

## Architecture & Design

```text
 build machine                     server (LAN)                          device
┌──────────────────┐   POST       ┌────────────────────────────┐  GET    ┌────────────────┐
│ Gradle / shell   │  /upload     │ Fastify                    │ /latest │ mobile app     │
│ scripts/         │ ───────────► │  routes ─► validation (zod)│ ◄────── │ compares       │
│ upload-apk.ts    │  multipart   │         ─► storage ─► disk │         │ versionCode    │
│ or curl          │              │         ─► repository ──┐  │  GET    │                │
└──────────────────┘              │                         ▼  │ /down-  │ downloads and  │
                                  │                  PostgreSQL│ load/:id│ installs APK   │
                                  └────────────────────────────┘ ◄────── └────────────────┘
```

**Components**

- `apks/routes.ts` holds the three APK endpoints. `apks/storage.ts` streams uploads to disk, `apks/repository.ts` runs the SQL, `apks/upload-fields.ts` and `apks/release-id.ts` validate input with zod.
- `db/migrate.ts` is a small SQL migration runner. Migrations are `<timestamp>_<name>.up.sql` and `.down.sql` pairs, applied in name order, one transaction each. There is no ORM; queries use the `pg` driver directly.
- `error-handler.ts` turns every failure, including unknown routes and router-level errors, into one JSON error shape.

**Upload lifecycle**

1. The multipart body is read part by part. The `apk` file is piped to a temporary file `.upload-<uuid>.tmp` inside `UPLOAD_DIR`, so memory use does not grow with file size.
2. After the stream ends, the server checks that the size limit was not hit and that the file starts with the ZIP signature (an APK is a ZIP archive).
3. Text fields are validated. The temporary file is renamed to `<versionCode>-<uuid>.apk` and the row is inserted.
4. If any step fails, the temporary or renamed file is removed and no row is written. A duplicate `versionCode` is detected by the unique constraint and answered with `409`.

**Download.** The file is opened first and its size is read from the open handle, then streamed to the client. A file that was removed from disk is reported as `apk_file_missing`.

**Logging.** Logs are structured JSON. `request.rejected` (warn) records the status and error code of a refused request without the submitted values. `request.failed` (error) records an unexpected failure; the client only sees `Internal server error`. A client that disconnects during an upload is logged as `request.rejected` with code `request_aborted`.

**Security model.** AeroDeploy has no authentication and no TLS. Anyone who can reach the port can upload and download. Run it on a trusted network and do not expose it to the internet. `downloadUrl` is built from the request's `Host` header, which is acceptable under that assumption.

## Key Features

| Domain   | Feature                                                                                              |
| :------- | :--------------------------------------------------------------------------------------------------- |
| Upload   | Streamed multipart ingestion with a configurable size limit (`MAX_UPLOAD_MB`, default 200)           |
| Upload   | Fields may arrive before or after the file; the client file name is reduced to its base name         |
| Upload   | Rejects missing or misnamed files, non-ZIP content, bad version fields, NUL bytes and broken bodies  |
| Upload   | A failed upload leaves no file and no database row                                                   |
| Release  | Highest `versionCode` wins; `releaseNotes` is `null` when none were given                            |
| Download | Streamed file with `Content-Length` and a `Content-Disposition` that carries non-ASCII file names    |
| Storage  | Files are stored as `<versionCode>-<uuid>.apk`; the database keeps the path relative to `UPLOAD_DIR` |
| Build    | `scripts/upload-apk.ts` returns exit code 1 on any failure so a build step can stop                  |
| Errors   | One JSON shape for every error, including unknown routes and malformed URLs                          |
| Data     | Plain SQL migrations with a down file for each up file                                               |

## Repository Structure

```text
aero-deploy/
├── migrations/             SQL migrations (*.up.sql, *.down.sql)
├── docker/initdb/          Creates the aerodeploy_test database on first start
├── scripts/
│   └── upload-apk.ts       Command line uploader for build scripts
├── src/
│   ├── server.ts           Entry point: config, pool, listen, shutdown
│   ├── app.ts              buildApp(): Fastify instance and plugins
│   ├── config.ts           HOST, PORT, DATABASE_URL, UPLOAD_DIR, MAX_UPLOAD_MB
│   ├── errors.ts           Typed API errors
│   ├── error-handler.ts    JSON error shape and rejection logging
│   ├── format-file-size.ts
│   ├── apks/               Routes, storage, repository, validation
│   ├── db/                 Pool and migration runner (library and CLI)
│   └── __tests__/          Vitest suites and helpers
├── docker-compose.yml      PostgreSQL 16 for local development and tests
├── .env.example
└── package.json
```

## Prerequisites & Installation

- Node.js 22 or newer
- PostgreSQL 16, either through the included `docker-compose.yml` (needs Docker) or an existing server

```bash
npm install
cp .env.example .env        # change the database password
docker compose up -d        # skip if you use your own PostgreSQL
npm run migrate
npm run dev                 # or: npm run build && npm start
```

`docker compose up -d` starts PostgreSQL 16 with two databases, `aerodeploy` and `aerodeploy_test`. Credentials come from `.env`. The test database is created only when the data volume is first initialized; `docker compose down -v` removes the volume so it can be created again.

With your own PostgreSQL, create the two databases yourself and put their URLs in `DATABASE_URL` and `TEST_DATABASE_URL`.

The server listens on `HOST:PORT` (default `0.0.0.0:3000`) and stores APK files in `UPLOAD_DIR` (default `uploads`, relative to the working directory). Back that directory up together with the database: the rows point at the files.

## Usage & Examples

### Check that the server runs

```bash
curl http://localhost:3000/api/health
```

### Upload with curl

```bash
curl -X POST http://localhost:3000/api/apks/upload \
  -F "apk=@app/build/outputs/apk/debug/app-debug.apk" \
  -F "versionName=1.0.0" \
  -F "versionCode=1" \
  -F "releaseNotes=Nightly build"
```

### Upload from a build step

```bash
npm run upload -- app/build/outputs/apk/debug/app-debug.apk \
  --version-name 1.0.0 --version-code 1 --notes "Nightly build"
```

`npm run` starts in the aero-deploy directory, so a relative APK path is resolved from there. To call the script from another project, run `tsx` directly and keep your own working directory:

```bash
AERODEPLOY_URL=http://192.168.1.20:3000 \
  /path/to/aero-deploy/node_modules/.bin/tsx /path/to/aero-deploy/scripts/upload-apk.ts \
  app/build/outputs/apk/debug/app-debug.apk --version-name 1.0.0 --version-code 1
```

Keep `--version-code` increasing: `latest` returns the highest one, so a lower code uploaded later is stored but never offered as an update.

### Check for an update and download it

```bash
curl http://192.168.1.20:3000/api/apks/latest
curl -OJ http://192.168.1.20:3000/api/apks/download/3
```

A client app calls `latest` on start, compares `versionCode` with its own, and if the server's is higher downloads `downloadUrl` and starts the install.

## API Reference

All responses are JSON except the APK download. Errors always have this shape:

```json
{ "success": false, "error": { "code": "validation_error", "message": "..." } }
```

### `GET /api/health`

Returns `200` with `{ "success": true, "data": { "status": "ok" } }`. It does not query the database.

### `POST /api/apks/upload`

`multipart/form-data`.

| Field          | Required | Notes                                                       |
| :------------- | :------- | :---------------------------------------------------------- |
| `apk`          | yes      | File name must end in `.apk`; content must be a ZIP archive |
| `versionName`  | yes      | 1 to 50 characters, no NUL bytes                            |
| `versionCode`  | yes      | Positive integer up to 2147483647, unique                   |
| `releaseNotes` | no       | Up to 10000 characters, no NUL bytes                        |

`201` response:

```json
{
  "success": true,
  "message": "APK successfully uploaded and registered",
  "data": {
    "id": 1,
    "versionName": "1.0.2",
    "versionCode": 3,
    "fileName": "app-debug.apk",
    "fileSize": "24.5 MB"
  }
}
```

### `GET /api/apks/latest`

Returns the release with the highest `versionCode`:

```json
{
  "success": true,
  "data": {
    "id": 3,
    "versionName": "1.1.0",
    "versionCode": 4,
    "releaseNotes": "Bug fixes and performance improvements",
    "downloadUrl": "http://192.168.1.20:3000/api/apks/download/3"
  }
}
```

`downloadUrl` uses the protocol and `Host` header of the request. If a proxy rewrites `Host`, the URL uses the rewritten value.

### `GET /api/apks/download/:id`

Streams the file with `Content-Type: application/vnd.android.package-archive`, `Content-Length` and a `Content-Disposition` carrying the original file name. `id` must be a positive integer up to 2147483647. `HEAD` works; `Range` requests are not supported.

### Error codes

| Status | Code                  | Cause                                                                  |
| :----- | :-------------------- | :--------------------------------------------------------------------- |
| 400    | `validation_error`    | Missing or invalid field or file, not an APK, malformed multipart body |
| 400    | `bad_request`         | Malformed URL or other client error raised by Fastify                  |
| 400    | `request_aborted`     | The client closed the connection during an upload                      |
| 404    | `not_found`           | Unknown route                                                          |
| 404    | `no_releases`         | `latest` was called before any upload                                  |
| 404    | `release_not_found`   | No release has that `id`                                               |
| 404    | `apk_file_missing`    | The release is registered but its file is gone from disk               |
| 406    | `bad_request`         | The upload body is not `multipart/form-data`                           |
| 409    | `version_code_exists` | `versionCode` is already registered                                    |
| 413    | `file_too_large`      | The file is larger than `MAX_UPLOAD_MB`                                |
| 413    | `payload_too_large`   | More than one file or more than 10 text fields in an upload            |
| 500    | `internal_error`      | Unexpected failure; the cause is only in the server log                |

## CLI Reference

```text
npm run upload -- <apk-path> --version-name <name> --version-code <n> [--notes <text>] [--server <url>]
```

| Option               | Required | Notes                                                                        |
| :------------------- | :------- | :--------------------------------------------------------------------------- |
| `<apk-path>`         | yes      | Path to the APK                                                              |
| `--version-name <v>` | yes      | Up to 50 characters                                                          |
| `--version-code <n>` | yes      | Positive integer, must be unique                                             |
| `--notes <text>`     | no       | Release notes                                                                |
| `--server <url>`     | no       | Server address; falls back to `AERODEPLOY_URL`, then `http://localhost:3000` |

The file is sent in chunks, so its size does not affect memory use.

| Exit code | Meaning                                                                                                            |
| :-------- | :----------------------------------------------------------------------------------------------------------------- |
| 0         | Uploaded                                                                                                           |
| 1         | The file is missing, the server is unreachable, or the server rejected the upload; the reason is printed to stderr |
| 2         | Invalid arguments; the usage text is printed to stderr                                                             |

| Script                 | Purpose                              |
| :--------------------- | :----------------------------------- |
| `npm run dev`          | Start with file watching             |
| `npm run build`        | Compile to `dist/`                   |
| `npm start`            | Run the compiled build               |
| `npm run migrate`      | Apply pending migrations             |
| `npm run migrate:down` | Revert the latest migration          |
| `npm test`             | Run the test suite                   |
| `npm run lint`         | Run ESLint                           |
| `npm run typecheck`    | Run the TypeScript compiler, no emit |
| `npm run format:check` | Check formatting                     |

## Configuration

| Variable            | Default            | Purpose                               |
| :------------------ | :----------------- | :------------------------------------ |
| `HOST`, `PORT`      | `0.0.0.0`, `3000`  | Address the server listens on         |
| `DATABASE_URL`      | required           | PostgreSQL connection string          |
| `UPLOAD_DIR`        | `uploads`          | Directory for uploaded APK files      |
| `MAX_UPLOAD_MB`     | `200`              | Largest accepted upload, in megabytes |
| `TEST_DATABASE_URL` | required for tests | Database the tests may wipe           |
| `AERODEPLOY_URL`    | none               | Default server for the upload script  |

`POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` are read by `docker compose` only. Error messages about configuration never include the database URL, since it contains the password.

## Testing & Quality Assurance

```bash
npm test
npm run lint && npm run typecheck && npm run format:check && npm run build
```

The tests need a real PostgreSQL. Set `TEST_DATABASE_URL` in `.env`; the suite fails at the first database test if it is missing. Integration tests drop and recreate the `public` schema of that database, so never point it at data you care about. Test files run one after another because they share the database.

The suite covers:

- config parsing, the size formatter and the `Content-Disposition` builder;
- the migration runner, including rollback and the resulting schema;
- upload, latest and download endpoints, including bad fields, bad file content, duplicate versions, oversized files, malformed multipart bodies, clients that disconnect, and the files and rows left behind after each failure;
- the upload script against a running app, including exit codes and memory use with large files;
- the error shape for unknown routes and malformed URLs, and the rejection log entries.

## Troubleshooting & FAQ

1. **`DATABASE_URL is required`.** The server and the migrate commands read `.env` through the npm scripts. Run `npm run dev`, `npm start` or `npm run migrate`, or export the variables yourself when calling `node` directly.
2. **`ECONNREFUSED` on port 5432.** PostgreSQL is not running. With Docker, check `docker compose ps` and start it with `docker compose up -d`.
3. **Tests fail with `TEST_DATABASE_URL is required`, or the database does not exist.** Set the variable in `.env`. With Docker the test database is created only on first start of the volume; run `docker compose down -v` and `docker compose up -d` to create it.
4. **`409 version_code_exists`.** That `versionCode` is already registered. Use a higher number; codes cannot be reused because the column is unique.
5. **`413 file_too_large`.** Raise `MAX_UPLOAD_MB` and restart the server.
6. **`400 apk file is required` with curl.** `-F "apk=app.apk"` sends the text `app.apk`. Use `-F "apk=@app.apk"` to send the file.
7. **`400 apk file is not a valid APK archive`.** The file does not start with the ZIP signature. Check that the path points at the built APK and not at a log or an empty file.
8. **`latest` still returns an older version.** `latest` picks the highest `versionCode`, not the newest upload. Check the codes with `psql`.
9. **`downloadUrl` contains `localhost`.** The request was made through `localhost`. Call the server by its LAN address, or keep a proxy from rewriting `Host`.
10. **`404 apk_file_missing`.** The file was removed from `UPLOAD_DIR` but the row remains. Restore the file, or delete the row in `apk_releases` and upload that build again. There is no delete endpoint.
11. **`EADDRINUSE`.** Another process uses the port. Change `PORT`.
12. **An Android app cannot download from the server.** Android 9 and newer block plain `http://` traffic unless the app allows it in its network security configuration, and installing an APK needs the "install unknown apps" permission for the app that starts the install. This is device behavior and is not something the server can change.
13. **A server crash during an upload.** The temporary file `.upload-<uuid>.tmp` stays in `UPLOAD_DIR`. It is not served and can be deleted when the server is stopped.

## Author & Contributions

Created and maintained by `0xbarss`. Issues and pull requests are welcome. Please keep each change small, add or update tests, make sure lint, typecheck, format check, tests and build pass, and write single-line commit messages in the form `<type>: <subject>`.

## License & Disclaimer

Released under the MIT License; see `LICENSE`.

AeroDeploy has no authentication or encryption. It is meant for a network you control and is provided as is, without warranty. Do not expose it to the internet and do not use it to distribute builds that must stay confidential on a shared network.
