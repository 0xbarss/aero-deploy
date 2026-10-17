import { Pool } from "pg";

export function createPool(databaseUrl: string, onIdleError: (error: Error) => void): Pool {
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on("error", onIdleError);
  return pool;
}
