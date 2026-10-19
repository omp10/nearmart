import { Router } from 'express';
import { ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { NotFoundError } from '../../lib/errors.js';
import { publicProductQuery, moduleKey } from './catalog.schemas.js';
import { getTree } from './category.service.js';
import { inactiveModuleKeys, listModules } from './module.service.js';
import * as catalog from './catalog.public.service.js';

/** Browsing endpoints for the customer app. No sign-in needed. */
const router = Router();

router.get('/modules', async (_req, res) => {
    const rows = await listModules({ activeOnly: true });
    ok(res, rows.map(({ key, name, description, image }) => ({ key, name, description, image })));
});

router.get('/categories', async (req, res) => {
    const module = moduleKey.parse(req.query.module);
    if ((await inactiveModuleKeys()).includes(module)) throw new NotFoundError('This section is not available');
    const strip = (nodes) =>
        nodes.map(({ _id, name, slug, image, description, children }) => ({
            id: String(_id),
            name,
            slug,
            image,
            description,
            children: strip(children)
        }));
    ok(res, strip(await getTree(module, { activeOnly: true })));
});

router.get('/products', validate(publicProductQuery, 'query'), async (req, res) => {
    ok(res, await catalog.listPublicProducts(req.validatedQuery));
});

router.get('/products/:idOrSlug', async (req, res) => {
    ok(res, await catalog.getPublicProduct(req.params.idOrSlug));
});

router.get('/brands', async (req, res) => {
    const module = req.query.module ? moduleKey.parse(req.query.module) : undefined;
    ok(res, await catalog.listBrands(module));
});

export default router;
