# aero-deploy

Local network service for uploading Android APK builds and letting devices check for and download newer versions.

## Usage

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

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

Upload, version check and download endpoints are not implemented yet.
