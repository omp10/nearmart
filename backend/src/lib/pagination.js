import { z } from 'zod';

export const pageQuery = {
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20)
};

/** Runs a find + count for one page and returns the standard list shape. */
export const paginate = async (Model, filter, { page, limit, sort = { createdAt: -1 }, projection, lean = true }) => {
    const query = Model.find(filter, projection).sort(sort).skip((page - 1) * limit).limit(limit);
    const [items, total] = await Promise.all([lean ? query.lean() : query, Model.countDocuments(filter)]);
    return { items, page, limit, total, pages: Math.ceil(total / limit) };
};

/** Escapes user text for use inside a RegExp. */
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
