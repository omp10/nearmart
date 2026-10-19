import crypto from 'node:crypto';

export const slugify = (text) =>
    String(text ?? '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'item';

/**
 * A slug not yet used by `Model` within `scope` (e.g. `{ module }`). Falls
 * back to a short random suffix after a few numbered tries.
 */
export const uniqueSlug = async (Model, text, scope = {}, excludeId = null) => {
    const base = slugify(text);
    const taken = (slug) =>
        Model.exists({ ...scope, slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });

    if (!(await taken(base))) return base;
    for (let n = 2; n <= 5; n += 1) {
        if (!(await taken(`${base}-${n}`))) return `${base}-${n}`;
    }
    return `${base}-${crypto.randomBytes(3).toString('hex')}`;
};
