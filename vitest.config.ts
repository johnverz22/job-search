import { defineConfig } from 'vitest/config';

// web/ has its own Vitest config (jsdom); keep the root run to the backend tests.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
