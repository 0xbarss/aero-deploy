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

The version check and download endpoints are not implemented yet.
