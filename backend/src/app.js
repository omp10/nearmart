import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import crypto from 'node:crypto';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { registerBookingPaymentHandlers } from './modules/laundry/booking.service.js';
import { registerOrderPaymentHandlers } from './modules/orders/order.service.js';
import { webhookRouter } from './modules/payments/payment.routes.js';
import { uploadMountPath } from './modules/uploads/storage.service.js';
import routes from './routes.js';

export const createApp = () => {
    registerOrderPaymentHandlers();
    registerBookingPaymentHandlers();
    const app = express();

    app.disable('x-powered-by');
    if (env.TRUST_PROXY) app.set('trust proxy', 1);

    app.use(
        pinoHttp({
            logger,
            genReqId: (req, res) => {
                // Reuse nginx's id when it is well-formed; it ends up in logs and responses.
                const incoming = req.headers['x-request-id'];
                const id = typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
                res.setHeader('x-request-id', id);
                return id;
            },
            autoLogging: { ignore: (req) => req.url === '/api/v1/health' }
        })
    );
    app.use(helmet());
    app.use(
        cors({
            // Mobile apps send no Origin; browsers must be on the list.
            origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
            credentials: true
        })
    );

    // Raw body, so it runs before express.json.
    app.use('/api/v1/payments/webhook', webhookRouter);

    app.use(express.json({ limit: '1mb' }));
    app.use(cookieParser());
    app.use('/api/v1', apiLimiter, routes);

    // Local uploads in development; nginx serves this path in production.
    if (!env.isProduction) {
        app.use(
            uploadMountPath(env.UPLOAD_BASE_URL),
            express.static(env.UPLOAD_STORAGE_ROOT, {
                fallthrough: false,
                index: false,
                // Images are there to be shown by the apps (the customer web build is another origin);
                // helmet's same-origin default would block them.
                setHeaders: (res) => res.set('Cross-Origin-Resource-Policy', 'cross-origin')
            })
        );
    }

    app.use(notFound);
    app.use(errorHandler);
    return app;
};
