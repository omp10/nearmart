import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { api, createStaff, loginCustomer, loginStaff, PASSWORD } from './helpers.js';
import { MAX_FAILED_LOGINS } from '../src/modules/auth/auth.service.js';

afterAll(() => fs.rm(path.resolve(process.env.UPLOAD_STORAGE_ROOT), { recursive: true, force: true }));

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

describe('tokens', () => {
    it('rejects an unsigned ("alg: none") token carrying a real account id', async () => {
        const session = await loginCustomer();
        const claims = JSON.parse(Buffer.from(session.accessToken.split('.')[1], 'base64url'));
        const forged = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.`;
        expect((await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    });

    it('rejects a token signed with another key', async () => {
        const session = await loginCustomer();
        const [h, p] = session.accessToken.split('.');
        const sig = crypto.createHmac('sha256', 'not-the-secret').update(`${h}.${p}`).digest('base64url');
        expect((await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${h}.${p}.${sig}`)).status).toBe(401);
    });
});

describe('staff login lockout', () => {
    it('locks an account after repeated wrong passwords; a reset unlocks it', async () => {
        const admin = await createStaff();
        const target = await createStaff({ isSuperAdmin: false, role: 'ops', email: 'packer@nearmart.test' });
        for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
            await api().post('/api/v1/auth/staff/login').send({ email: target.email, password: 'wrong-password' }).expect(401);
        }
        const locked = await api().post('/api/v1/auth/staff/login').send({ email: target.email, password: PASSWORD });
        expect(locked.status).toBe(429);
        expect(locked.body.message).toMatch(/Try again in \d+ minute/);

        const { token } = await loginStaff(admin);
        await api().post(`/api/v1/admin/staff/${target._id}/reset-password`).set('Authorization', `Bearer ${token}`).send({ password: 'a-fresh-password-1' }).expect(200);
        expect((await api().post('/api/v1/auth/staff/login').send({ email: target.email, password: 'a-fresh-password-1' })).status).toBe(200);
    });

    it('a successful login clears the failure count', async () => {
        const staff = await createStaff();
        for (let i = 0; i < MAX_FAILED_LOGINS - 1; i += 1) {
            await api().post('/api/v1/auth/staff/login').send({ email: staff.email, password: 'nope' });
        }
        await loginStaff(staff);
        await api().post('/api/v1/auth/staff/login').send({ email: staff.email, password: 'nope' }).expect(401);
        expect((await api().post('/api/v1/auth/staff/login').send({ email: staff.email, password: PASSWORD })).status).toBe(200);
    });
});

describe('cross-site requests', () => {
    it('refuses cookie refresh and logout from another site, accepts same-site and app calls', async () => {
        const staff = await createStaff();
        const { cookie } = await loginStaff(staff);
        const evil = await api().post('/api/v1/auth/refresh').set('Cookie', cookie).set('Origin', 'https://evil.example').send({});
        expect(evil.status).toBe(403);
        const evilLogout = await api().post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', 'https://evil.example').send({});
        expect(evilLogout.status).toBe(403);

        // No Origin (mobile app, curl) is fine; the cookie is still valid after the refused attempts.
        expect((await api().post('/api/v1/auth/refresh').set('Cookie', cookie).send({})).status).toBe(200);
    });
});

describe('uploads', () => {
    const upload = async (buffer, contentType, filename = 'x') => {
        const { token } = await loginStaff(await createStaff());
        return api().post('/api/v1/uploads/image?folder=banners').set('Authorization', `Bearer ${token}`).attach('file', buffer, { filename, contentType });
    };

    it('re-encodes an animated GIF to WebP and drops appended bytes', async () => {
        const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f00' } }).gif().toBuffer();
        const withPayload = Buffer.concat([gif, Buffer.from('<script>alert(1)</script>')]);
        const res = await upload(withPayload, 'image/gif', 'a.gif');
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data.mimeType).toBe('image/webp');
        const stored = await fs.readFile(path.resolve(process.env.UPLOAD_STORAGE_ROOT, res.body.data.path));
        expect(stored.includes('<script>')).toBe(false);
    });

    it('rejects contents that do not match the declared type', async () => {
        const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).png().toBuffer();
        const res = await upload(png, 'image/gif', 'fake.gif');
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/do not match/);
    });

    it('rejects images whose header claims enormous dimensions', async () => {
        // A minimal PNG header claiming 30000×30000 pixels: tiny file, huge decode.
        const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer();
        png.writeUInt32BE(30000, 16);
        png.writeUInt32BE(30000, 20);
        const res = await upload(png, 'image/png', 'bomb.png');
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/too large|not a valid image/);
    });
});

describe('video uploads (banner clips)', () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
    const send = (token, buffer, contentType, folder = 'banners') =>
        api().post(`/api/v1/uploads/video?folder=${folder}`).set('Authorization', `Bearer ${token}`).attach('file', buffer, { filename: 'clip', contentType });

    it('stores a real MP4 for staff and serves it as a banner video', async () => {
        const { token } = await loginStaff(await createStaff());
        const res = await send(token, mp4, 'video/mp4');
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data.path).toMatch(/^banners\/.+\.mp4$/);

        const banner = await api().post('/api/v1/admin/banners').set('Authorization', `Bearer ${token}`).send({ title: 'Clip', image: '/uploads/a.webp', video: res.body.data.url });
        expect(banner.status, JSON.stringify(banner.body)).toBe(201);
        const live = await api().get('/api/v1/banners');
        expect(live.body.data.find((b) => b.title === 'Clip').video).toBe(res.body.data.url);
    });

    it('rejects non-video bytes, other types, other folders and customers', async () => {
        const { token } = await loginStaff(await createStaff());
        expect((await send(token, Buffer.from('<script>alert(1)</script>'.repeat(4)), 'video/mp4')).status).toBe(400);
        expect((await send(token, mp4, 'video/quicktime')).status).toBe(400);
        expect((await send(token, mp4, 'video/mp4', 'catalog')).status).toBe(400);
        const customer = await loginCustomer();
        expect((await send(customer.accessToken, mp4, 'video/mp4')).status).toBe(403);
    });
});
