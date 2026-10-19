# AeroDeploy

![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-ES2022-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)
![Author](https://img.shields.io/badge/author-0xbarss-lightgrey)

AeroDeploy is a Fastify service for a local network. A build script uploads each new Android APK to it, the files stay on the server's disk with their metadata in PostgreSQL, and a browser dashboard lists the releases for download on any device.

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
- the server records `versionName`, `versionCode`, file size, SHA-256 checksum, upload time and release notes for each build;
- the dashboard at `/` lists every release with a download link and a QR code, so a phone can install a build by scanning it.

## Architecture & Design

```text
 build machine                     server (LAN)                          device
 ┌──────────────────┐   POST       ┌────────────────────────────┐  GET    ┌────────────────┐
 │ Gradle / shell   │  /upload     │ Fastify                    │  /      │ phone browser  │
 │ scripts/         │ ───────────► │  routes ─► validation (zod)│ ◄────── │ opens          │
 │ upload-apk.ts    │  multipart   │         ─► storage ─► disk │         │ dashboard      │
 │ or curl          │              │         ─► repository ──┐  │  GET    │ downloads APK  │
 └──────────────────┘              │                         ▼  │ /api/* │                │
                                   │                  PostgreSQL│ ◄────── │                │
                                   └────────────────────────────┘         └────────────────┘
```

**Components**

- `apks/routes.ts` holds the APK endpoints (upload, list, latest, download, delete). `apks/apps-routes.ts` holds the app list and rename endpoints. `apks/apk-manifest.ts` and `apks/zip-reader.ts` read the APK binary. `apks/storage.ts` streams uploads to disk, `apks/repository.ts` runs the SQL.
- `db/migrate.ts` is a small SQL migration runner. Migrations are `<timestamp>_<name>.up.sql` and `.down.sql` pairs, applied in name order, one transaction each. There is no ORM; queries use the `pg` driver directly.
- `admin-auth.ts` provides the bearer token check shared by the admin and upload routes.
- `error-handler.ts` turns every failure, including unknown routes and router-level errors, into one JSON error shape.
- `public/` holds the dashboard: plain HTML, CSS and ES modules served by `@fastify/static`.

**Upload lifecycle**

1. The multipart body is read part by part. The `apk` file is piped to a temporary file `.upload-<uuid>.tmp` inside `UPLOAD_DIR`, so memory use does not grow with file size.
2. After the stream ends, the server checks that the size limit was not hit and that the file starts with the ZIP signature (an APK is a ZIP archive).
3. The APK's `AndroidManifest.xml` and `resources.arsc` are parsed to read the package name, `versionCode`, `versionName` and app label. Any client-sent version fields are validated against the manifest. The temporary file is renamed to `<versionCode>-<uuid>.apk` and the row is inserted.
4. If any step fails, the temporary or renamed file is removed and no row is written. A duplicate `versionCode` within the same app is detected by the unique constraint and answered with `409`.

**Download.** The file name in the `Content-Disposition` header is computed per request as `<app-slug>-<versionName>-<versionCode>.apk`. The file is opened first and its size is read from the open handle, then streamed to the client. A file that was removed from disk is reported as `apk_file_missing`.

**Logging.** Logs are structured JSON. `request.rejected` (warn) records the status and error code of a refused request without the submitted values. `request.failed` (error) records an unexpected failure; the client only sees `Internal server error`. A client that disconnects during an upload is logged as `request.rejected` with code `request_aborted`.

**Security model.** AeroDeploy has no TLS and is meant for a trusted network. Read routes (list, latest, download, app list) are open. Two optional bearer tokens protect mutations: `ADMIN_TOKEN` for `DELETE /api/apks/:id` and `PATCH /api/apps/:id`, and `UPLOAD_TOKEN` for `POST /api/apks/upload`. Tokens are compared as SHA-256 digests with `timingSafeEqual` and are never logged. `downloadUrl` is built from the request's `Host` header, which is acceptable under that assumption.

## Key Features

| Domain    | Feature                                                                                                    |
| :-------- | :--------------------------------------------------------------------------------------------------------- |
| Upload    | Streamed multipart ingestion with a configurable size limit (`MAX_UPLOAD_MB`, default 200)                 |
| Upload    | Identity read from the APK manifest (package, version, label); client-sent fields validated against it     |
| Upload    | SHA-256 computed during streaming; response, database row, stored file and downloaded bytes agree          |
| Upload    | A failed upload leaves no file and no database row                                                         |
| Release   | Highest `versionCode` wins; `releaseNotes` is `null` when none were given                                  |
| Release   | Per-app versioning: the same `versionCode` can exist in two apps                                           |
| App       | Apps created from the manifest label, a client field, or the package name; case-insensitive unique         |
| App       | Rename via `PATCH /api/apps/:id` with admin token                                                          |
| Download  | File named `<app-slug>-<versionName>-<versionCode>.apk`, computed per request                              |
| Download  | Streamed file with `Content-Length` and `Content-Disposition`; missing file reported as `apk_file_missing` |
| Delete    | `DELETE /api/apks/:id` removes the row and the file, behind `ADMIN_TOKEN`                                  |
| Dashboard | Read-only release list, details panel, QR code, upload form, app filter, rename and delete — all at `/`    |
| Storage   | Files stored as `<versionCode>-<uuid>.apk`; the database keeps the path relative to `UPLOAD_DIR`           |
| Build     | `scripts/upload-apk.ts` returns exit code 1 on any failure so a build step can stop                        |
| Errors    | One JSON shape for every error, including unknown routes and malformed URLs                                |
| Data      | Plain SQL migrations with a down file for each up file                                                     |

## Repository Structure

```text
aero-deploy/
├── migrations/             SQL migrations (*.up.sql, *.down.sql)
├── docker/initdb/          Creates the aerodeploy_test database on first start
├── public/                 Dashboard served at / (HTML, CSS, ES modules)
│   └── vendor/             Vendored QR code generator (uqr, MIT)
├── scripts/
│   ├── upload-apk.ts       Command line uploader for build scripts
│   └── backfill-sha256.ts  One-time checksum backfill utility
├── src/
│   ├── server.ts           Entry point: config, pool, listen, shutdown
│   ├── app.ts              buildApp(): Fastify instance and plugins
│   ├── config.ts           Environment variables and their defaults
│   ├── admin-auth.ts       Bearer token check for admin and upload routes
│   ├── errors.ts           Typed API errors
│   ├── error-handler.ts    JSON error shape and rejection logging
│   ├── format-file-size.ts
│   ├── apks/               Routes, storage, repository, manifest reader, validation
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

### Open the dashboard

Open `http://<server-ip>:3000/` in a browser on the same network. The dashboard lists releases, shows per-app "Latest" badges, a details panel with checksums and release notes, a QR code per download link, and an upload form with drag-and-drop, progress and cancel. When two or more apps have releases, an app filter sits above the list. The details panel has "Rename app" and "Delete release" actions, both behind the admin token typed into a confirmation dialog.

### Upload with curl

```bash
curl -X POST http://localhost:3000/api/apks/upload \
  -F "apk=@app/build/outputs/apk/debug/app-debug.apk" \
  -F "releaseNotes=Nightly build"
```

The server reads `versionName`, `versionCode` and the package name from the APK's `AndroidManifest.xml`. Those fields are optional; when sent, they must agree with the manifest or the upload is rejected with `422 manifest_mismatch`.

### Upload from a build step

```bash
npm run upload -- app/build/outputs/apk/debug/app-debug.apk --notes "Nightly build"
```

`--version-name` and `--version-code` are optional. Given, they are sent to the server for validation against the APK manifest; omitted, they are read from the APK itself.

`npm run` starts in the aero-deploy directory, so a relative APK path is resolved from there. To call the script from another project, run `tsx` directly and keep your own working directory:

```bash
AERODEPLOY_URL=http://192.168.1.20:3000 \
  /path/to/aero-deploy/node_modules/.bin/tsx /path/to/aero-deploy/scripts/upload-apk.ts \
  app/build/outputs/apk/debug/app-debug.apk
```

Keep `versionCode` increasing: `latest` returns the highest one, so a lower code uploaded later is stored but never offered as an update.

### Download a release

```bash
curl http://192.168.1.20:3000/api/apks/latest
curl -OJ http://192.168.1.20:3000/api/apks/download/3
```

A phone can also scan the QR code in the dashboard to open the download link in its browser. Android shows its own install dialog; "Install unknown apps" must be allowed for the browser once.

### Rename an app

```bash
curl -X PATCH http://localhost:3000/api/apps/1 \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name": "My App"}'
```

### Delete a release

```bash
curl -X DELETE http://localhost:3000/api/apks/3 \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

### Backfill checksums (one-time)

```bash
npm run backfill:sha256
```

Hashes every stored APK whose release row has no `sha256` yet. Safe to run more than once.

## API Reference

All responses are JSON except the APK download. Errors always have this shape:

```json
{ "success": false, "error": { "code": "validation_error", "message": "..." } }
```

### `GET /api/health`

Returns `200` with `{ "success": true, "data": { "status": "ok" } }`. It does not query the database.

### `POST /api/apks/upload`

`multipart/form-data`.

| Field          | Required | Notes                                                                                    |
| :------------- | :------- | :--------------------------------------------------------------------------------------- |
| `apk`          | yes      | File name must end in `.apk`; content must be a valid APK (ZIP with AndroidManifest.xml) |
| `versionName`  | no       | When sent, must match the APK manifest (1-50 characters, no NUL bytes)                   |
| `versionCode`  | no       | When sent, must match the APK manifest (positive integer up to 2147483647)               |
| `packageName`  | no       | When sent, must match the APK manifest                                                   |
| `appName`      | no       | Used only when the upload creates a new app                                              |
| `releaseNotes` | no       | Up to 10000 characters, no NUL bytes                                                     |

If `UPLOAD_TOKEN` is set, the request needs `Authorization: Bearer <token>`; the admin token also works when both are set.

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
    "fileSize": "24.5 MB",
    "appId": 1,
    "appName": "My App",
    "packageName": "com.example.myapp",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
```

### `GET /api/apks`

Lists releases newest `versionCode` first. Query parameters: `limit` (default 50, max 200), `offset`, `appId`, `packageName`. An unknown app returns an empty page.

`200` response:

```json
{
  "success": true,
  "data": [
    {
      "id": 3,
      "appId": 1,
      "appName": "My App",
      "versionName": "1.1.0",
      "versionCode": 4,
      "fileName": "4-uuid.apk",
      "fileSize": 102400,
      "sha256": "...",
      "releaseNotes": "Bug fixes",
      "createdAt": "2026-10-19T12:00:00.000Z",
      "downloadUrl": "http://192.168.1.20:3000/api/apks/download/3"
    }
  ],
  "pagination": { "total": 42, "limit": 50, "offset": 0 }
}
```

### `GET /api/apks/latest`

Returns the release with the highest `versionCode`. Accepts `appId` or `packageName` filter. If more than one app has releases and no filter is given, returns `400 app_required`. An unknown app returns `404 no_releases`.

```json
{
  "success": true,
  "data": {
    "id": 3,
    "versionName": "1.1.0",
    "versionCode": 4,
    "releaseNotes": "Bug fixes",
    "fileSize": 102400,
    "sha256": "...",
    "downloadUrl": "http://192.168.1.20:3000/api/apks/download/3"
  }
}
```

`fileSize` is in bytes (a number). `downloadUrl` uses the protocol and `Host` header of the request.

### `GET /api/apks/download/:id`

Streams the file with `Content-Type: application/vnd.android.package-archive`, `Content-Length` and a `Content-Disposition` carrying `<app-slug>-<versionName>-<versionCode>.apk`. `id` must be a positive integer up to 2147483647. `HEAD` works; `Range` requests are not supported.

### `GET /api/apps`

Lists every app in id order with its newest release or `null`.

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "My App",
      "packageName": "com.example.myapp",
      "createdAt": "2026-10-18T10:00:00.000Z",
      "latestRelease": {
        "id": 3,
        "versionName": "1.1.0",
        "versionCode": 4,
        "fileSize": 102400,
        "sha256": "..."
      }
    }
  ]
}
```

### `PATCH /api/apps/:id`

Renames an app. Requires `Authorization: Bearer <ADMIN_TOKEN>`. Body: `{ "name": "..." }` (trimmed, 1-100 code points, no control characters, unique ignoring case).

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "My App Renamed",
    "packageName": "com.example.myapp",
    "createdAt": "2026-10-18T10:00:00.000Z"
  }
}
```

### `DELETE /api/apks/:id`

Deletes a release and its stored file. Requires `Authorization: Bearer <ADMIN_TOKEN>`. Returns `204` with no body. A release deleted twice is `404` the second time.

### Error codes

| Status | Code                  | Cause                                                              |
| :----- | :-------------------- | :----------------------------------------------------------------- |
| 400    | `validation_error`    | Missing or invalid field or file, bad id, bad rename body          |
| 400    | `app_required`        | `latest` was called with several apps and no filter                |
| 400    | `bad_request`         | Malformed URL or other client error raised by Fastify              |
| 400    | `request_aborted`     | The client closed the connection during an upload                  |
| 401    | `unauthorized`        | Missing or wrong admin/upload token                                |
| 403    | `admin_disabled`      | Admin routes used while the server has no `ADMIN_TOKEN`            |
| 404    | `not_found`           | Unknown route                                                      |
| 404    | `no_releases`         | `latest` was called before any upload for that app                 |
| 404    | `release_not_found`   | No release has that `id`                                           |
| 404    | `apk_file_missing`    | The release is registered but its file is gone from disk           |
| 404    | `app_not_found`       | No app has that `id`                                               |
| 406    | `bad_request`         | The upload body is not `multipart/form-data`                       |
| 409    | `version_code_exists` | `versionCode` is already registered in that app                    |
| 409    | `app_name_exists`     | Another app already has that name (ignoring case)                  |
| 413    | `file_too_large`      | The file is larger than `MAX_UPLOAD_MB`                            |
| 413    | `payload_too_large`   | More than one file or more than 10 text fields in an upload        |
| 422    | `invalid_apk`         | Not a valid APK: broken manifest, missing package, bad versionCode |
| 422    | `manifest_mismatch`   | A sent version or package field disagrees with the APK manifest    |
| 500    | `internal_error`      | Unexpected failure; the cause is only in the server log            |

## CLI Reference

### Upload script

```text
npm run upload -- <apk-path> [--version-name <name>] [--version-code <n>] [--notes <text>] [--server <url>]
```

| Option               | Required | Notes                                                                        |
| :------------------- | :------- | :--------------------------------------------------------------------------- |
| `<apk-path>`         | yes      | Path to the APK                                                              |
| `--version-name <v>` | no       | Expected version name; sent for validation against the APK manifest          |
| `--version-code <n>` | no       | Expected version code; sent for validation against the APK manifest          |
| `--notes <text>`     | no       | Release notes                                                                |
| `--server <url>`     | no       | Server address; falls back to `AERODEPLOY_URL`, then `http://localhost:3000` |

The file is sent in chunks, so its size does not affect memory use.

| Exit code | Meaning                                                                                                            |
| :-------- | :----------------------------------------------------------------------------------------------------------------- |
| 0         | Uploaded                                                                                                           |
| 1         | The file is missing, the server is unreachable, or the server rejected the upload; the reason is printed to stderr |
| 2         | Invalid arguments; the usage text is printed to stderr                                                             |

### Backfill script

```text
npm run backfill:sha256
```

Reads `DATABASE_URL` and `UPLOAD_DIR` from the environment. Takes no arguments.

| Exit code | Meaning                                                             |
| :-------- | :------------------------------------------------------------------ |
| 0         | Every release was hashed, or none needed it                         |
| 1         | At least one release was skipped, or the database could not be used |
| 2         | Invalid arguments                                                   |

### npm scripts

| Script                    | Purpose                              |
| :------------------------ | :----------------------------------- |
| `npm run dev`             | Start with file watching             |
| `npm run build`           | Compile to `dist/`                   |
| `npm start`               | Run the compiled build               |
| `npm run migrate`         | Apply pending migrations             |
| `npm run migrate:down`    | Revert the latest migration          |
| `npm run upload`          | Upload an APK from the command line  |
| `npm run backfill:sha256` | Backfill missing checksums           |
| `npm test`                | Run the test suite                   |
| `npm run lint`            | Run ESLint                           |
| `npm run typecheck`       | Run the TypeScript compiler, no emit |
| `npm run format:check`    | Check formatting                     |

## Configuration

| Variable            | Default            | Purpose                                                             |
| :------------------ | :----------------- | :------------------------------------------------------------------ |
| `HOST`, `PORT`      | `0.0.0.0`, `3000`  | Address the server listens on                                       |
| `DATABASE_URL`      | required           | PostgreSQL connection string                                        |
| `UPLOAD_DIR`        | `uploads`          | Directory for uploaded APK files                                    |
| `MAX_UPLOAD_MB`     | `200`              | Largest accepted upload, in megabytes                               |
| `TEST_DATABASE_URL` | required for tests | Database the tests may wipe                                         |
| `AERODEPLOY_URL`    | none               | Default server for the upload script                                |
| `ADMIN_TOKEN`       | none               | Bearer token for admin routes (delete, rename). Unset disables them |
| `UPLOAD_TOKEN`      | none               | Bearer token for uploads. Unset keeps uploads open                  |

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
- the ZIP reader and APK manifest parser, including malformed APKs, size limits, timeouts and fixture APKs;
- upload, latest, list, download and delete endpoints, including bad fields, bad file content, duplicate versions, oversized files, malformed multipart bodies, clients that disconnect, and the files and rows left behind after each failure;
- the apps endpoints: list, rename, case-insensitive uniqueness, validation;
- the admin and upload token contracts, including timing-safe comparison and the check ordering;
- the upload script against a running app, including exit codes and optional version fields;
- the backfill script, including skip conditions and idempotency;
- download file naming, including Unicode slugs and case handling;
- the dashboard helpers and page hosting;
- the error shape for unknown routes and malformed URLs, and the rejection log entries.

## Troubleshooting & FAQ

1. **`DATABASE_URL is required`.** The server and the migrate commands read `.env` through the npm scripts. Run `npm run dev`, `npm start` or `npm run migrate`, or export the variables yourself when calling `node` directly.
2. **`ECONNREFUSED` on port 5432.** PostgreSQL is not running. With Docker, check `docker compose ps` and start it with `docker compose up -d`.
3. **Tests fail with `TEST_DATABASE_URL is required`, or the database does not exist.** Set the variable in `.env`. With Docker the test database is created only on first start of the volume; run `docker compose down -v` and `docker compose up -d` to create it.
4. **`409 version_code_exists`.** That `versionCode` is already registered in that app. Use a higher number; codes cannot be reused because the column is unique per app.
5. **`413 file_too_large`.** Raise `MAX_UPLOAD_MB` and restart the server.
6. **`400 apk file is required` with curl.** `-F "apk=app.apk"` sends the text `app.apk`. Use `-F "apk=@app.apk"` to send the file.
7. **`422 invalid_apk`.** The file is not a valid APK: missing or broken `AndroidManifest.xml`, missing package name, or a `versionCode` outside 1-2147483647. Check with `aapt dump badging` or `unzip -l` that the manifest is present.
8. **`422 manifest_mismatch`.** A `versionName` or `versionCode` field disagrees with the APK's manifest. Omit the fields to let the server read them from the APK, or correct them to match.
9. **`400 app_required` on `GET /api/apks/latest`.** More than one app has releases and no `appId` or `packageName` filter was given. Pass `?appId=<id>` or `?packageName=<package>`.
10. **`latest` still returns an older version.** `latest` picks the highest `versionCode`, not the newest upload. Check the codes with `psql`.
11. **`downloadUrl` contains `localhost`.** The request was made through `localhost`. Call the server by its LAN address, or keep a proxy from rewriting `Host`.
12. **`404 apk_file_missing`.** The file was removed from `UPLOAD_DIR` but the row remains. Restore the file, delete the release through the dashboard or `DELETE /api/apks/:id`, and upload that build again.
13. **`401 unauthorized` on upload.** The server has `UPLOAD_TOKEN` set. Send the token as `Authorization: Bearer <token>` or set `UPLOAD_TOKEN` in the environment for `npm run upload`. The admin token also works when both are set.
14. **`403 admin_disabled` on delete or rename.** The server has no `ADMIN_TOKEN` set. Set it in `.env` and restart. The token is compared as a SHA-256 digest; it is never logged.
15. **`401 unauthorized` on delete or rename.** The admin token is missing or wrong. Send it as `Authorization: Bearer <ADMIN_TOKEN>`. The upload token does not open admin routes.
16. **`409 app_name_exists` on rename.** Another app already has that name (ignoring case). Choose a different name.
17. **`EADDRINUSE`.** Another process uses the port. Change `PORT`.
18. **Dashboard shows a blank page or fails to load.** Check that the server has `UPLOAD_DIR` readable and that the `public/` directory is present. The dashboard is served from `public/` next to `src/` (or `dist/` when running compiled). Open the browser console for errors.
19. **The dashboard QR code is not shown.** The dashboard was opened through `localhost` or `127.0.0.1`. A phone would resolve that address to itself. Open the dashboard through the server's LAN IP address instead.
20. **A phone cannot install the downloaded APK.** Android 9 and newer block plain `http://` traffic unless the app allows it in its network security configuration, and installing an APK needs the "install unknown apps" permission for the app that starts the install. This is device behavior and is not something the server can change.
21. **A server crash during an upload.** The temporary file `.upload-<uuid>.tmp` stays in `UPLOAD_DIR`. It is not served and can be deleted when the server is stopped.
22. **A download starts but the file is corrupt.** The release's `sha256` can be checked against the file with `sha256sum`. If they differ, the file on disk was modified after upload; delete and re-upload the release.

## Author & Contributions

Created and maintained by `0xbarss`. Issues and pull requests are welcome. Please keep each change small, add or update tests, make sure lint, typecheck, format check, tests and build pass, and write single-line commit messages in the form `<type>: <subject>`.

## License & Disclaimer

Released under the MIT License; see `LICENSE`.

AeroDeploy has no encryption and no required authentication. Read routes are open to anyone who can reach the port. It is meant for a network you control and is provided as is, without warranty. Do not expose it to the internet and do not use it to distribute builds that must stay confidential on a shared network.
