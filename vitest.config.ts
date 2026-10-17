import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    // All database tests share one database, so test files must not run at the same time
    fileParallelism: false,
  },
});
