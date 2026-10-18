import { buildApp } from "./app.js";
import {
  loadAdminToken,
  loadConfig,
  loadDatabaseUrl,
  loadStorageConfig,
  loadUploadToken,
} from "./config.js";
import { createPool } from "./db/pool.js";

const config = loadConfig();
const storage = loadStorageConfig();

const pool = createPool(loadDatabaseUrl(), (error) => {
  app.log.error({ event: "db.idle_client_error", err: error });
});
const app = await buildApp({
  logger: true,
  pool,
  adminToken: loadAdminToken(),
  uploadToken: loadUploadToken(),
  ...storage,
});
app.addHook("onClose", async () => {
  await pool.end();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ event: "server.start_failed", err: error });
  process.exit(1);
}
