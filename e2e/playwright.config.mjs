import { defineConfig, devices } from '@playwright/test';
import { PANEL } from './config.mjs';

/**
 * End-to-end tests: a real browser drives the admin panel against the real
 * API and a throwaway MongoDB. The customer side is played through the API,
 * the way the mobile app would.
 *
 * The spec files share one database and build on a little shared setup, so
 * they run one at a time in name order.
 */
export default defineConfig({
    testDir: './tests',
    fullyParallel: false,
    workers: 1,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    retries: process.env.CI ? 1 : 0,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: PANEL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata'
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'node servers/stack.mjs',
        url: PANEL,
        timeout: 180_000,
        reuseExistingServer: false,
        stdout: 'pipe',
        stderr: 'pipe'
    }
});
