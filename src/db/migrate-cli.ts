import { loadDatabaseUrl } from "../config.js";
import { migrateDown, migrateUp } from "./migrate.js";
import { createPool } from "./pool.js";

function writeError(message: string): void {
  process.stderr.write(`${message}\n`);
}

const direction = process.argv[2];
if (direction !== "up" && direction !== "down") {
  writeError("usage: migrate-cli <up|down>");
  process.exit(1);
}

const pool = createPool(loadDatabaseUrl(), (error) => {
  writeError(`database connection error: ${error.message}`);
});

try {
  if (direction === "up") {
    const applied = await migrateUp(pool);
    process.stdout.write(
      applied.length === 0
        ? "no pending migrations\n"
        : applied.map((name) => `applied ${name}\n`).join(""),
    );
  } else {
    const reverted = await migrateDown(pool);
    process.stdout.write(reverted === null ? "nothing to revert\n" : `reverted ${reverted}\n`);
  }
} catch (error) {
  writeError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
