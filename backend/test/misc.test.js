import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { api, createStaff, loginCustomer, loginStaff } from './helpers.js';
import { DeviceToken } from '../src/modules/notifications/deviceToken.model.js';
import { notify } from '../src/modules/notifications/notification.service.js';

afterAll(() => fs.rm(path.resolve(process.env.UPLOAD_STORAGE_ROOT), { recursive: true, force: true }));

describe('platform', () => {
    it('reports health', async () => {
        const res = await api().get('/api/v1/health');
        expect(res.status).toBe(200);
        expect(res.body.db).toBe('connected');
    });

    it('returns JSON 404 for unknown routes', async () => {
        const res = await api().get('/api/v1/nope');
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it('rejects malformed JSON with 400', async () => {
        const res = await api()
            .post('/api/v1/auth/customer/request-otp')
            .set('Content-Type', 'application/json')
            .send('{"phone":');
        expect(res.status).toBe(400);
    });
});

describe('uploads', () => {
    it('stores an image as WebP for staff', async () => {
        const { token } = await loginStaff(await createStaff());
        const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#4a8' } }).png().toBuffer();
        const res = await api()
            .post('/api/v1/uploads/image?folder=catalog')
            .set('Authorization', `Bearer ${token}`)
            .attach('file', png, { filename: 'p.png', contentType: 'image/png' });
        expect(res.status).toBe(201);
        expect(res.body.data.url).toMatch(/^\/uploads\/catalog\/\d{4}-\d{2}\/.+\.webp$/);
        await fs.access(path.resolve(process.env.UPLOAD_STORAGE_ROOT, res.body.data.path));
    });

    it('rejects bytes that are not an image even with an image mimetype', async () => {
        const { token } = await loginStaff(await createStaff());
        const res = await api()
            .post('/api/v1/uploads/image?folder=catalog')
            .set('Authorization', `Bearer ${token}`)
            .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' });
        expect(res.status).toBe(400);
    });

    it('rejects an unknown folder', async () => {
        const { token } = await loginStaff(await createStaff());
        const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).png().toBuffer();
        const res = await api()
            .post('/api/v1/uploads/image?folder=../../etc')
            .set('Authorization', `Bearer ${token}`)
            .attach('file', png, { filename: 'p.png', contentType: 'image/png' });
        expect(res.status).toBe(400);
    });
});

describe('notifications', () => {
    it('keeps one device per customer and lists the inbox', async () => {
        const session = await loginCustomer();
        const auth = { Authorization: `Bearer ${session.accessToken}` };
        await api().post('/api/v1/notifications/devices').set(auth).send({ token: 'a'.repeat(40), platform: 'android' }).expect(200);
        await api().post('/api/v1/notifications/devices').set(auth).send({ token: 'b'.repeat(40), platform: 'android' }).expect(200);
        expect(await DeviceToken.countDocuments({ ownerId: session.user.id })).toBe(1);

        await notify({ ownerKind: 'user', ownerId: session.user.id }, { title: 'Order packed', type: 'order.packed' });
        const inbox = await api().get('/api/v1/notifications').set(auth);
        expect(inbox.body.data).toMatchObject({ total: 1, unread: 1 });

        await api().post(`/api/v1/notifications/${inbox.body.data.items[0]._id}/read`).set(auth).expect(200);
        const after = await api().get('/api/v1/notifications').set(auth);
        expect(after.body.data.unread).toBe(0);
    });
});
