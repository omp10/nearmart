import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globalSetup: ['./test/globalSetup.js'],
        setupFiles: ['./test/setup.js'],
        // One in-memory MongoDB shared by all files; run them one at a time.
        fileParallelism: false,
        testTimeout: 20_000,
        hookTimeout: 120_000
    }
});
