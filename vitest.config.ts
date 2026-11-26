import { defineConfig } from 'vitest/config';

// The DB-backed suites TRUNCATE shared tables, so test files must not run in parallel against one database.
// web/ has its own Vitest config (jsdom); keep the root run to the backend tests.
export default defineConfig({ test: { fileParallelism: false, include: ['tests/**/*.test.ts'] } });
