/**
 * Errors a service can throw to produce a specific HTTP response. Anything
 * else that escapes a handler is treated as a 500 and its message is hidden.
 */
export class AppError extends Error {
    constructor(message, statusCode = 500, details = undefined) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.details = details;
        this.expose = true;
    }
}

export class ValidationError extends AppError {
    constructor(message = 'Invalid request', details) {
        super(message, 400, details);
    }
}

export class AuthError extends AppError {
    /** @param {string} [code] machine-readable reason a client may act on */
    constructor(message = 'Authentication required', code = undefined) {
        super(message, 401);
        this.code = code;
    }
}

export class ForbiddenError extends AppError {
    constructor(message = 'You do not have permission to do this') {
        super(message, 403);
    }
}

export class NotFoundError extends AppError {
    constructor(message = 'Not found') {
        super(message, 404);
    }
}

export class ConflictError extends AppError {
    constructor(message = 'Conflict') {
        super(message, 409);
    }
}

export class TooManyRequestsError extends AppError {
    constructor(message = 'Too many requests') {
        super(message, 429);
    }
}
