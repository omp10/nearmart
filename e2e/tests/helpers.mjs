import { expect } from '@playwright/test';
import { ADMIN, API, OTP } from '../config.mjs';

/** A short unique suffix so specs never collide on names. */
export const uid = () => Math.random().toString(36).slice(2, 7);

/** Signs in through the panel's login form. */
export const login = async (page, { email = ADMIN.email, password = ADMIN.password } = {}) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
};

/** Accepts the next window.confirm() the page shows. */
export const acceptConfirms = (page) => page.on('dialog', (d) => d.accept());

/** Thin JSON client for the API, as the mobile app or a script would use it. */
export const apiClient = (request, token) => {
    const call = async (method, path, body) => {
        const res = await request.fetch(`${API}${path}`, {
            method,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            data: body
        });
        const json = await res.json();
        if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${json.message}`);
        return json.data;
    };
    return {
        get: (p) => call('GET', p),
        post: (p, b) => call('POST', p, b ?? {}),
        put: (p, b) => call('PUT', p, b ?? {}),
        patch: (p, b) => call('PATCH', p, b ?? {})
    };
};

export const adminApi = async (request) => {
    const { accessToken } = await apiClient(request).post('/auth/staff/login', { email: ADMIN.email, password: ADMIN.password });
    return apiClient(request, accessToken);
};

/** Signs a customer in with OTP (the test server uses a fixed code) and returns their API client. */
export const customerApi = async (request, phone, name = 'E2E Customer') => {
    const anon = apiClient(request);
    await anon.post('/auth/customer/request-otp', { phone });
    const { accessToken } = await anon.post('/auth/customer/verify-otp', { phone, otp: OTP, name });
    return apiClient(request, accessToken);
};

/** A random valid Indian mobile number. */
export const phone = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

const MODULE_TABS = { global: 'Global', grocery: 'Grocery', produce: 'Produce', laundry: 'Laundry', electronics: 'Electric' };

/** The sidebar's module tab for a module key. */
export const moduleTab = (page, key) =>
    page.getByRole('radiogroup', { name: 'Module' }).getByRole('radio', { name: MODULE_TABS[key], exact: true });

export const pickModule = (page, key) => moduleTab(page, key).click();
