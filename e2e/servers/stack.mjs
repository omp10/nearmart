/**
 * Brings up everything the end-to-end tests need, in order:
 * a throwaway MongoDB → seed the test super admin → the API → the admin panel.
 * Playwright starts this as its web server and waits for the panel's URL.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN, API_PORT, PANEL_PORT, SERVER_ENV } from '../config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '../../backend');
const admin = path.resolve(here, '../../admin');
const require = createRequire(path.join(backend, 'package.json'));
const { MongoMemoryServer } = require('mongodb-memory-server');

const children = [];
const shutdown = async (code = 0) => {
    for (const child of children) child.kill();
    await mongo?.stop().catch(() => {});
    process.exit(code);
};
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

const waitFor = async (url, label, ms = 120_000) => {
    const start = Date.now();
    for (;;) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {
            /* not up yet */
        }
        if (Date.now() - start > ms) {
            console.error(`${label} did not start`);
            await shutdown(1);
        }
        await new Promise((r) => setTimeout(r, 500));
    }
};

const mongo = await MongoMemoryServer.create();
const env = { ...process.env, ...SERVER_ENV, MONGO_URI: mongo.getUri('nearmart-e2e') };

const seeded = spawnSync(process.execPath, ['scripts/seed-admin.js'], {
    cwd: backend,
    env: { ...env, SEED_ADMIN_EMAIL: ADMIN.email, SEED_ADMIN_PASSWORD: ADMIN.password, SEED_ADMIN_NAME: ADMIN.name },
    encoding: 'utf8'
});
if (seeded.status !== 0) {
    console.error(seeded.stdout, seeded.stderr);
    await shutdown(1);
}

const api = spawn(process.execPath, ['src/server.js'], { cwd: backend, env, stdio: ['ignore', 'inherit', 'inherit'] });
children.push(api);
api.on('exit', (code) => code && shutdown(code));
await waitFor(`http://127.0.0.1:${API_PORT}/api/v1/health`, 'API');

const panel = spawn(process.execPath, [path.join(admin, 'node_modules/vite/bin/vite.js'), '--port', String(PANEL_PORT), '--strictPort'], {
    cwd: admin,
    env: { ...process.env, API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    stdio: ['ignore', 'inherit', 'inherit']
});
children.push(panel);
await waitFor(`http://localhost:${PANEL_PORT}/`, 'Admin panel');
console.log('E2E stack ready');
