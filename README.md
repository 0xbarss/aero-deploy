# aero-deploy

Local network service for uploading Android APK builds and letting devices check for and download newer versions.

## Usage

Requires Node.js 22 or newer.

```bash
npm install
cp .env.example .env
docker compose up -d
npm run migrate
npm run dev
```

`docker compose up -d` starts PostgreSQL 16 with two databases: `aerodeploy` and `aerodeploy_test`. Credentials come from `.env`. The test database is only created the first time the volume is initialized; run `docker compose down -v` to recreate it.

The server listens on `HOST:PORT` (default `0.0.0.0:3000`).

```bash
curl http://localhost:3000/api/health
```

## Uploading an APK

```bash
curl -X POST http://localhost:3000/api/apks/upload \
  -F "apk=@app/build/outputs/apk/debug/app-debug.apk" \
  -F "versionName=1.0.0" \
  -F "versionCode=1" \
  -F "releaseNotes=Nightly build"
```

| Field          | Required | Notes                                          |
| :------------- | :------- | :--------------------------------------------- |
| `apk`          | yes      | File name must end in `.apk`, content is a ZIP |
| `versionName`  | yes      | Up to 50 characters                            |
| `versionCode`  | yes      | Positive integer, must be unique               |
| `releaseNotes` | no       | Up to 10000 characters                         |

A successful upload returns `201` with `{ "success": true, "message": "...", "data": { ... } }`. Errors return `{ "success": false, "error": { "code": "...", "message": "..." } }`:

| Status | Code                  | Cause                                               |
| :----- | :-------------------- | :-------------------------------------------------- |
| 400    | `validation_error`    | Missing or invalid field, or the file is not an APK |
| 409    | `version_code_exists` | `versionCode` is already registered                 |
| 413    | `file_too_large`      | File is larger than `MAX_UPLOAD_MB`                 |

Files are stored in `UPLOAD_DIR` as `<versionCode>-<uuid>.apk`; the database keeps the original file name and the stored name.

## Checking for the latest version

```bash
curl http://localhost:3000/api/apks/latest
```

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

`releaseNotes` is `null` when none were uploaded. `downloadUrl` is built from the `Host` header of the request, so a device that reaches the server at a LAN address gets a URL it can use. If the server sits behind a proxy that rewrites `Host`, the URL will use the rewritten value. When nothing has been uploaded yet, the response is `404` with code `no_releases`.

## Downloading an APK

```bash
curl -OJ http://localhost:3000/api/apks/download/3
```

The file is streamed with `Content-Type: application/vnd.android.package-archive`, a `Content-Length` and a `Content-Disposition` carrying the original file name. Range requests are not supported.

| Status | Code                | Cause                                                        |
| :----- | :------------------ | :----------------------------------------------------------- |
| 400    | `validation_error`  | `id` is not a positive integer                               |
| 404    | `release_not_found` | No release has that `id`                                     |
| 404    | `apk_file_missing`  | The release is registered but its file is gone from the disk |

## Configuration

| Variable            | Default            | Purpose                               |
| :------------------ | :----------------- | :------------------------------------ |
| `HOST`, `PORT`      | `0.0.0.0`, `3000`  | Address the server listens on         |
| `DATABASE_URL`      | required           | PostgreSQL connection string          |
| `UPLOAD_DIR`        | `uploads`          | Directory for uploaded APK files      |
| `MAX_UPLOAD_MB`     | `200`              | Largest accepted upload, in megabytes |
| `TEST_DATABASE_URL` | required for tests | Database the tests may wipe           |

## Scripts

| Script                 | Purpose                              |
| :--------------------- | :----------------------------------- |
| `npm run dev`          | Start with file watching             |
| `npm run build`        | Compile to `dist/`                   |
| `npm start`            | Run the compiled build               |
| `npm test`             | Run the test suite                   |
| `npm run lint`         | Run ESLint                           |
| `npm run typecheck`    | Run the TypeScript compiler, no emit |
| `npm run format:check` | Check formatting                     |

## Notes

Migrations live in `migrations/` as `<timestamp>_<name>.up.sql` and `.down.sql` pairs. Integration tests drop and recreate the `public` schema of `TEST_DATABASE_URL`, so never point it at a database you care about.
