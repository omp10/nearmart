import { afterAll, beforeAll, beforeEach, inject } from 'vitest';

// Set before anything imports src/config/env.js.
Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGO_URI: inject('mongoUri'),
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000',
    JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00',
    USE_DEFAULT_OTP: 'false',
    SMS_PROVIDER: 'console',
    RAZORPAY_KEY_ID: 'rzp_test_dummy',
    RAZORPAY_KEY_SECRET: 'razorpay-test-key-secret',
    RAZORPAY_WEBHOOK_SECRET: 'razorpay-test-webhook-secret',
    SECRETS_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    UPLOAD_STORAGE_ROOT: 'test-uploads'
});

const mongoose = (await import('mongoose')).default;

beforeAll(async () => {
    if (mongoose.connection.readyState === 0) await mongoose.connect(process.env.MONGO_URI);
    await mongoose.syncIndexes();
});

beforeEach(async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
    // Payment gateway credentials are cached in memory; the database was just emptied.
    (await import('../src/modules/payments/gateway.config.js')).resetGatewayCache();
});

afterAll(async () => {
    await mongoose.disconnect();
});
