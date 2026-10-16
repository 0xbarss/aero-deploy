import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp({ logger: true });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ event: "server.start_failed", err: error });
  process.exit(1);
}
