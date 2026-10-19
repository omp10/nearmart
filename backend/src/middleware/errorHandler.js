import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { NotFoundError } from '../lib/errors.js';

export const notFound = (req, _res, next) => next(new NotFoundError(`Route not found: ${req.method} ${req.path}`));

/**
 * Turns any thrown error into the standard `{ success: false, message }` body.
 * Only errors marked `expose` (AppError and the cases mapped below) show their
 * message; everything else is logged and answered with a generic 500.
 */
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
    let status = err.statusCode || err.status || 500;
    let message = err.expose ? err.message : 'Something went wrong';
    let details = err.details;

    if (err instanceof multer.MulterError) {
        status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        message = err.code === 'LIMIT_FILE_SIZE' ? `File is too large (max ${env.UPLOAD_MAX_IMAGE_MB}MB)` : err.message;
    } else if (err instanceof ZodError) {
        // A schema parsed inline in a handler (route params and the like).
        status = 400;
        details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        message = details[0]?.message || 'Invalid request';
    } else if (err instanceof mongoose.Error.ValidationError) {
        status = 400;
        message = Object.values(err.errors)[0]?.message || 'Invalid data';
        details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    } else if (err instanceof mongoose.Error.CastError) {
        status = 400;
        message = `Invalid ${err.path}`;
    } else if (err?.code === 11000) {
        status = 409;
        message = `${Object.keys(err.keyValue || {})[0] || 'Value'} already exists`;
    } else if (err?.type === 'entity.parse.failed') {
        status = 400;
        message = 'Malformed JSON body';
    } else if (err?.type === 'entity.too.large') {
        status = 413;
        message = 'Request body is too large';
    }

    if (status >= 500) {
        logger.error({ err, reqId: req.id, path: req.originalUrl }, 'Unhandled error');
    }

    res.status(status).json({
        success: false,
        message,
        ...(err.expose && err.code ? { code: err.code } : {}),
        ...(details ? { details } : {}),
        ...(req.id ? { requestId: req.id } : {})
    });
};
