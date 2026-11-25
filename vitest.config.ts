import { defineConfig } from 'vitest/config';

// The DB-backed suites TRUNCATE shared tables, so test files must not run in parallel against one database.
export default defineConfig({ test: { fileParallelism: false } });
