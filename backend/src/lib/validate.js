import { ValidationError } from './errors.js';

/**
 * Parses req[part] with a zod schema and replaces it with the parsed value,
 * so handlers only ever see validated, coerced input.
 *
 * Express 5 makes req.query a getter, so the parsed query is stored on
 * req.validatedQuery instead of being assigned back.
 */
export const validate = (schema, part = 'body') => (req, _res, next) => {
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
        const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        return next(new ValidationError(details[0]?.message || 'Invalid request', details));
    }
    if (part === 'query') {
        req.validatedQuery = result.data;
    } else {
        req[part] = result.data;
    }
    return next();
};

/** Indian 10-digit mobile number; accepts +91 / 91 / 0 prefixes and spaces. */
export const normalizeIndianPhone = (value) => {
    const digits = String(value ?? '').replace(/\D/g, '');
    const local = digits.length === 12 && digits.startsWith('91')
        ? digits.slice(2)
        : digits.length === 11 && digits.startsWith('0')
            ? digits.slice(1)
            : digits;
    return /^[6-9]\d{9}$/.test(local) ? local : null;
};
