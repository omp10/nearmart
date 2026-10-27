import { describe, expect, it } from 'vitest';
import { api, createStaff, loginCustomer, loginStaff, PASSWORD } from './helpers.js';

describe('staff login', () => {
    it('signs in with email and password and sets an httpOnly refresh cookie', async () => {
        const staff = await createStaff();
        const res = await api().post('/api/v1/auth/staff/login').send({ email: staff.email, password: PASSWORD });

        expect(res.status).toBe(200);
        expect(res.body.data.refreshToken).toBeUndefined();
        expect(res.body.data.user).toMatchObject({ email: staff.email, isSuperAdmin: true });
        expect(res.body.data.user.permissions.staff).toContain('delete');
        const cookie = res.headers['set-cookie'].find((c) => c.startsWith('nm_rt='));
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    });

    it('gives the same error for unknown email and wrong password', async () => {
        const staff = await createStaff();
        const wrong = await api().post('/api/v1/auth/staff/login').send({ email: staff.email, password: 'nope' });
        const unknown = await api().post('/api/v1/auth/staff/login').send({ email: 'x@nearmart.test', password: 'nope' });
        expect(wrong.status).toBe(401);
        expect(unknown.status).toBe(401);
        expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('refreshes from the cookie', async () => {
        const staff = await createStaff();
        const { cookie } = await loginStaff(staff);
        const res = await api().post('/api/v1/auth/refresh').set('Cookie', cookie).send({});
        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toBeTruthy();
        expect(res.body.data.refreshToken).toBeUndefined();
    });

    it('returns the refresh token in the body for the mobile staff app', async () => {
        const staff = await createStaff();
        const login = await api().post('/api/v1/auth/staff/login').set('X-Client', 'mobile').send({ email: staff.email, password: PASSWORD });
        expect(login.status).toBe(200);
        expect(login.body.data.refreshToken).toBeTruthy();

        const refreshed = await api().post('/api/v1/auth/refresh').set('X-Client', 'mobile').send({ refreshToken: login.body.data.refreshToken });
        expect(refreshed.status).toBe(200);
        expect(refreshed.body.data.accessToken).toBeTruthy();
        expect(refreshed.body.data.refreshToken).toBeTruthy();
        expect(refreshed.body.data.refreshToken).not.toBe(login.body.data.refreshToken);
    });

    it('allows several concurrent staff sessions', async () => {
        const staff = await createStaff();
        const a = await loginStaff(staff);
        const b = await loginStaff(staff);
        for (const s of [a, b]) {
            const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${s.token}`);
            expect(me.status).toBe(200);
        }
    });

    it('changing the password ends existing sessions', async () => {
        const staff = await createStaff();
        const { token } = await loginStaff(staff);
        await api()
            .post('/api/v1/auth/staff/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-password' })
            .expect(200);
        const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
        expect(me.status).toBe(401);
    });
});

describe('staff management permissions', () => {
    it('rejects customers and unauthenticated callers', async () => {
        expect((await api().get('/api/v1/admin/staff')).status).toBe(401);
        const customer = await loginCustomer();
        const res = await api().get('/api/v1/admin/staff').set('Authorization', `Bearer ${customer.accessToken}`);
        expect(res.status).toBe(403);
    });

    it('lets a super admin create an ops user with filtered permissions', async () => {
        const { token } = await loginStaff(await createStaff());
        const res = await api()
            .post('/api/v1/admin/staff')
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Packer',
                email: 'packer@nearmart.test',
                password: 'packer-password-1',
                role: 'ops',
                modules: ['grocery'],
                permissions: { orders: ['view', 'update', 'fly'], bogus: ['view'] }
            });
        expect(res.status).toBe(201);
        expect(res.body.data.permissions).toEqual({ orders: ['view', 'update'] });
        expect(res.body.data.isSuperAdmin).toBe(false);
    });

    it('stops a sub-admin from escalating their own or others’ access', async () => {
        const sub = await createStaff({ isSuperAdmin: false, permissions: { staff: ['view', 'create', 'update'] } });
        const { token } = await loginStaff(sub);

        const self = await api()
            .patch(`/api/v1/admin/staff/${sub._id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ permissions: { orders: ['view'] } });
        expect(self.status).toBe(403);

        const grant = await api()
            .post('/api/v1/admin/staff')
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'X', email: 'x@nearmart.test', password: 'x-password-123', role: 'ops',
                permissions: { orders: ['delete'] }
            });
        expect(grant.status).toBe(403);
    });

    it('denies sections the sub-admin was not granted', async () => {
        const sub = await createStaff({ isSuperAdmin: false, permissions: { orders: ['view'] } });
        const { token } = await loginStaff(sub);
        const res = await api().get('/api/v1/admin/staff').set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
    });

    it('deactivating a staff member ends their sessions immediately', async () => {
        const admin = await loginStaff(await createStaff());
        const ops = await createStaff({ role: 'ops', isSuperAdmin: false });
        const opsSession = await loginStaff(ops);

        await api()
            .patch(`/api/v1/admin/staff/${ops._id}`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ isActive: false })
            .expect(200);

        const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${opsSession.token}`);
        expect(me.status).toBe(401);
        const refresh = await api().post('/api/v1/auth/refresh').set('Cookie', opsSession.cookie).send({});
        expect(refresh.status).toBe(401);
    });
});
