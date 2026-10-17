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

Upload, version check and download endpoints are not implemented yet.
