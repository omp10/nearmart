import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { logger } from './lib/logger.js';
import { expireUnpaidBookings } from './modules/laundry/booking.service.js';
import { expireUnpaidOrders } from './modules/orders/order.service.js';

const start = async () => {
    await connectDB();
    const server = createApp().listen(env.PORT, env.HOST, () => {
        logger.info(`Nearmart API listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
    });

    // Cancels online orders whose payment window has passed. Runs in this
    // process; with several API instances, move it to a single scheduler.
    const expiryTimer = setInterval(() => {
        expireUnpaidOrders().catch((err) => logger.error({ err: err.message }, 'Unpaid order expiry failed'));
        expireUnpaidBookings().catch((err) => logger.error({ err: err.message }, 'Unpaid booking expiry failed'));
    }, 60_000);

    const shutdown = (signal) => {
        logger.info(`${signal} received, shutting down`);
        clearInterval(expiryTimer);
        server.close(async () => {
            await disconnectDB();
            process.exit(0);
        });
        // Don't hang forever on a stuck connection.
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
};

process.on('unhandledRejection', (err) => {
    logger.fatal({ err }, 'Unhandled promise rejection');
    process.exit(1);
});

start().catch((err) => {
    logger.fatal({ err }, 'Failed to start');
    process.exit(1);
});
