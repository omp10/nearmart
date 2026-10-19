import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { api, loginCustomer } from './helpers.js';

const spec = parse(fs.readFileSync(new URL('../../docs/openapi.yaml', import.meta.url), 'utf8'));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((method) => ({ path, method, op: item[method] }))
);

/** Every "$ref" in the document, with where it appears. */
const collectRefs = (node, at = '#', out = []) => {
    if (Array.isArray(node)) node.forEach((v, i) => collectRefs(v, `${at}/${i}`, out));
    else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
            if (k === '$ref') out.push({ ref: v, at });
            else collectRefs(v, `${at}/${k}`, out);
        }
    }
    return out;
};

const resolve = (ref) => ref.replace(/^#\//, '').split('/').reduce((n, key) => n?.[key], spec);

describe('OpenAPI contract', () => {
    it('is a well-formed 3.1 document whose references all resolve', () => {
        expect(spec.openapi).toBe('3.1.0');
        expect(operations.length).toBeGreaterThan(35);
        const broken = collectRefs(spec).filter(({ ref }) => resolve(ref) === undefined);
        expect(broken).toEqual([]);
        for (const { path, method, op } of operations) {
            expect(op.summary, `${method} ${path} needs a summary`).toBeTruthy();
            expect(Object.keys(op.responses ?? {}).length, `${method} ${path} needs responses`).toBeGreaterThan(0);
        }
    });

    it('describes only routes that exist', async () => {
        // Signed in, so routers that authenticate first still reach their 404 for unknown paths.
        const { accessToken } = await loginCustomer();
        const call = (method, url) => api()[method](url).set('Authorization', `Bearer ${accessToken}`).send({});
        const isUnrouted = (res) => res.status === 404 && /^Route not found/.test(res.body.message);

        // The check can tell: a made-up path under an authenticated router is reported.
        expect(isUnrouted(await call('get', '/api/v1/cart/not-a-route'))).toBe(true);

        const missing = [];
        for (const { path, method } of operations) {
            const res = await call(method, `/api/v1${path.replace(/\{[^}]+\}/g, 'aaaaaaaaaaaaaaaaaaaaaaaa')}`);
            if (isUnrouted(res)) missing.push(`${method.toUpperCase()} ${path}`);
        }
        expect(missing).toEqual([]);
    });

    it('marks public operations correctly', async () => {
        // An operation documented as public (security: []) must not demand a token.
        const publicGets = operations.filter(({ op, method, path }) => method === 'get' && Array.isArray(op.security) && op.security.length === 0 && !path.includes('{'));
        for (const { path } of publicGets) {
            const res = await api().get(`/api/v1${path}`);
            expect(res.status, `GET ${path}`).not.toBe(401);
        }
    });

    it('is served for the app team', async () => {
        const res = await api().get('/api/v1/openapi.yaml');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/yaml/);
        expect(res.text).toContain('Nearmart customer API');
    });
});
