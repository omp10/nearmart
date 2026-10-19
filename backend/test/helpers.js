import request from 'supertest';
import { createApp } from '../src/app.js';
import { Staff } from '../src/modules/staff/staff.model.js';

export const app = createApp();
export const api = () => request(app);

export const PASSWORD = 'correct-horse-battery';

export const createStaff = (overrides = {}) =>
    Staff.create({
        name: 'Test Admin',
        email: `admin${Math.random().toString(36).slice(2, 8)}@nearmart.test`,
        password: PASSWORD,
        role: 'admin',
        isSuperAdmin: true,
        ...overrides
    });

/** Signs a staff member in and returns their access token and refresh cookie. */
export const loginStaff = async (staff) => {
    const res = await api().post('/api/v1/auth/staff/login').send({ email: staff.email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.body.message}`);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('nm_rt='));
    return { token: res.body.data.accessToken, cookie: cookie.split(';')[0], body: res.body };
};

/** Runs the customer OTP flow (console provider exposes the code in tests). */
export const loginCustomer = async (phone = '9876543210', extra = {}) => {
    const otpRes = await api().post('/api/v1/auth/customer/request-otp').send({ phone });
    const res = await api()
        .post('/api/v1/auth/customer/verify-otp')
        .send({ phone, otp: otpRes.body.data.devOtp, ...extra });
    if (res.status !== 200) throw new Error(`customer login failed: ${res.status} ${res.body.message}`);
    return res.body.data;
};
