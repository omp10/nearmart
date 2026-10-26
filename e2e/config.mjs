/**
 * Shared settings for the end-to-end stack. Every value here is a throwaway
 * test value for a database that exists only while the tests run.
 */
export const API_PORT = 5055;
export const PANEL_PORT = 5174;
export const API = `http://127.0.0.1:${API_PORT}/api/v1`;
export const PANEL = `http://localhost:${PANEL_PORT}`;

export const ADMIN = { email: 'e2e-admin@nearmart.test', password: 'e2e-admin-password-1', name: 'E2E Admin' };
export const OTP = '123456';

export const SERVER_ENV = {
    NODE_ENV: 'development',
    LOG_LEVEL: 'warn',
    PORT: String(API_PORT),
    HOST: '127.0.0.1',
    CORS_ORIGINS: `http://localhost:${PANEL_PORT}`,
    JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789-0123456789-0123456789',
    JWT_REFRESH_SECRET: 'e2e-refresh-secret-0123456789-0123456789-012345678',
    // The suite signs in far more often than a person would; the API tests cover the limit itself.
    AUTH_RATE_LIMIT_MAX: '1000',
    USE_DEFAULT_OTP: 'true',
    DEFAULT_OTP_CODE: OTP,
    SMS_PROVIDER: 'console',
    UPLOAD_STORAGE_ROOT: '../e2e/.uploads',
    // Online payment needs the real Razorpay; the API tests cover it with a stand-in.
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    RAZORPAY_WEBHOOK_SECRET: '',
    FIREBASE_SERVICE_ACCOUNT: '',
    FIREBASE_SERVICE_ACCOUNT_PATH: ''
};
