import { describe, expect, it } from 'vitest';
import { api, loginCustomer } from './helpers.js';
import { Otp } from '../src/modules/auth/otp.model.js';
import { User } from '../src/modules/users/user.model.js';
import { RefreshToken } from '../src/modules/auth/refreshToken.model.js';

const PHONE = '9876543210';

describe('customer OTP login', () => {
    it('creates the account on first verify and stores only a hash of the code', async () => {
        const otpRes = await api().post('/api/v1/auth/customer/request-otp').send({ phone: '+91 98765 43210' });
        expect(otpRes.status).toBe(200);
        const code = otpRes.body.data.devOtp;
        expect(code).toMatch(/^\d{6}$/);

        const stored = await Otp.findOne({ phone: PHONE }).lean();
        expect(stored.codeHash).not.toContain(code);

        const res = await api().post('/api/v1/auth/customer/verify-otp').send({ phone: PHONE, otp: code, name: 'Asha' });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ isNewUser: true, needsName: false, user: { phone: PHONE, name: 'Asha' } });
        expect(res.body.data.refreshToken).toBeTruthy();

        const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
        expect(me.status).toBe(200);
        expect(me.body.data.phone).toBe(PHONE);
    });

    it('rejects an invalid phone number', async () => {
        const res = await api().post('/api/v1/auth/customer/request-otp').send({ phone: '12345' });
        expect(res.status).toBe(400);
    });

    it('accepts each code only once', async () => {
        const { body } = await api().post('/api/v1/auth/customer/request-otp').send({ phone: PHONE });
        const first = await api().post('/api/v1/auth/customer/verify-otp').send({ phone: PHONE, otp: body.data.devOtp });
        const second = await api().post('/api/v1/auth/customer/verify-otp').send({ phone: PHONE, otp: body.data.devOtp });
        expect(first.status).toBe(200);
        expect(second.status).toBe(401);
    });

    it('locks the code after too many wrong attempts', async () => {
        const { body } = await api().post('/api/v1/auth/customer/request-otp').send({ phone: PHONE });
        const wrong = body.data.devOtp === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i += 1) {
            await api().post('/api/v1/auth/customer/verify-otp').send({ phone: PHONE, otp: wrong });
        }
        const res = await api().post('/api/v1/auth/customer/verify-otp').send({ phone: PHONE, otp: body.data.devOtp });
        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/too many/i);
    });

    it('limits OTP requests per window', async () => {
        for (let i = 0; i < 3; i += 1) {
            expect((await api().post('/api/v1/auth/customer/request-otp').send({ phone: PHONE })).status).toBe(200);
        }
        const res = await api().post('/api/v1/auth/customer/request-otp').send({ phone: PHONE });
        expect(res.status).toBe(429);
    });

    it('signs the previous device out when the account signs in again', async () => {
        const first = await loginCustomer(PHONE);
        await Otp.deleteMany({});
        const second = await loginCustomer(PHONE);

        const oldAccess = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${first.accessToken}`);
        expect(oldAccess.status).toBe(401);
        const oldRefresh = await api().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken });
        expect(oldRefresh.status).toBe(401);

        const current = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${second.accessToken}`);
        expect(current.status).toBe(200);
    });

    it('blocks a deactivated account', async () => {
        const session = await loginCustomer(PHONE);
        await User.updateOne({ phone: PHONE }, { isActive: false });
        const res = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${session.accessToken}`);
        expect(res.status).toBe(401);
    });
});

describe('refresh token rotation', () => {
    it('issues a new refresh token and rejects the old one', async () => {
        const session = await loginCustomer(PHONE);
        const r1 = await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });
        expect(r1.status).toBe(200);
        expect(r1.body.data.refreshToken).not.toBe(session.refreshToken);

        // Right after rotation a reuse is treated as a concurrent-tab race: refused, nothing revoked.
        const race = await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });
        expect(race.status).toBe(401);
        expect(race.body.code).toBe('REFRESH_RACE');

        // Later, a reused token is a replay: the whole session family is revoked, including the new token.
        await RefreshToken.updateMany({ revokedAt: { $ne: null } }, { $set: { revokedAt: new Date(Date.now() - 60_000) } });
        const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });
        expect(replay.status).toBe(401);
        expect(replay.body.code).toBeUndefined();
        const r2 = await api().post('/api/v1/auth/refresh').send({ refreshToken: r1.body.data.refreshToken });
        expect(r2.status).toBe(401);
    });

    it('logout revokes the refresh token', async () => {
        const session = await loginCustomer(PHONE);
        await api().post('/api/v1/auth/logout').send({ refreshToken: session.refreshToken }).expect(200);
        const res = await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });
        expect(res.status).toBe(401);
    });
});
