import { Router } from 'express';
import { created, ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { allowedModules, authenticate, requireAdmin, requirePermission, requireStaff } from '../../middleware/auth.js';
import * as schemas from './catalog.schemas.js';
import * as categories from './category.service.js';
import { listModules, updateModule } from './module.service.js';
import * as products from './product.service.js';
import * as stock from './stock.service.js';

/**
 * Catalogue and inventory management for the web panel. Admins see every
 * module; ops users the same endpoints, limited to their assigned modules.
 */
const router = Router();
router.use(authenticate, requireStaff());

const ctx = (req) => ({ allowedModules: allowedModules(req), actor: { kind: 'staff', id: req.auth.id } });

// ─── Modules ───

router.get('/modules', requirePermission('catalog', 'view'), async (req, res) => {
    const scope = allowedModules(req);
    const rows = await listModules();
    ok(res, scope ? rows.filter((m) => scope.includes(m.key)) : rows);
});

router.patch(
    '/modules/:key',
    requireAdmin,
    requirePermission('catalog', 'update'),
    validate(schemas.moduleUpdateSchema),
    async (req, res) => {
        const key = schemas.moduleKey.parse(req.params.key);
        ok(res, await updateModule(key, req.body), 'Module updated');
    }
);

// ─── Categories ───

router.get('/categories', requirePermission('catalog', 'view'), async (req, res) => {
    const module = schemas.moduleKey.parse(req.query.module);
    products.assertModule(allowedModules(req), module);
    ok(res, await categories.getTree(module));
});

router.post('/categories', requirePermission('catalog', 'create'), validate(schemas.categoryCreateSchema), async (req, res) => {
    products.assertModule(allowedModules(req), req.body.module);
    created(res, await categories.createCategory(req.body), 'Category created');
});

router.patch('/categories/:id', requirePermission('catalog', 'update'), validate(schemas.categoryUpdateSchema), async (req, res) => {
    const current = await categories.getCategory(req.params.id);
    products.assertModule(allowedModules(req), current.module);
    ok(res, await categories.updateCategory(req.params.id, req.body), 'Category updated');
});

router.delete('/categories/:id', requirePermission('catalog', 'delete'), async (req, res) => {
    const current = await categories.getCategory(req.params.id);
    products.assertModule(allowedModules(req), current.module);
    await categories.deleteCategory(req.params.id);
    ok(res, null, 'Category deleted');
});

// ─── Products ───

router.get('/products', requirePermission('catalog', 'view'), validate(schemas.productListQuery, 'query'), async (req, res) => {
    ok(res, await products.listProducts(req.validatedQuery, ctx(req)));
});

router.get('/products/:id', requirePermission('catalog', 'view'), async (req, res) => {
    ok(res, await products.getProduct(req.params.id, ctx(req)));
});

router.post('/products', requirePermission('catalog', 'create'), validate(schemas.productCreateSchema), async (req, res) => {
    created(res, await products.createProduct(req.body, ctx(req)), 'Product created');
});

router.patch('/products/:id', requirePermission('catalog', 'update'), validate(schemas.productUpdateSchema), async (req, res) => {
    ok(res, await products.updateProduct(req.params.id, req.body, ctx(req)), 'Product updated');
});

router.delete('/products/:id', requirePermission('catalog', 'delete'), async (req, res) => {
    await products.deleteProduct(req.params.id, ctx(req));
    ok(res, null, 'Product deleted');
});

// ─── Inventory ───

router.get('/inventory', requirePermission('inventory', 'view'), validate(schemas.inventoryListQuery, 'query'), async (req, res) => {
    ok(res, await products.listInventory(req.validatedQuery, ctx(req)));
});

router.get('/inventory/movements', requirePermission('inventory', 'view'), validate(schemas.movementQuery, 'query'), async (req, res) => {
    ok(res, await stock.listMovements({ ...req.validatedQuery, modules: allowedModules(req) }));
});

const variantRoute = '/inventory/:productId/variants/:variantId';

/** Loads the product first so ops users can only touch their own modules. */
const checkVariantAccess = async (req) => {
    schemas.objectId.parse(req.params.variantId);
    await products.getProduct(req.params.productId, ctx(req));
};

router.post(`${variantRoute}/adjust`, requirePermission('inventory', 'update'), validate(schemas.stockAdjustSchema), async (req, res) => {
    await checkVariantAccess(req);
    const result = await stock.adjustStock({ ...req.params, ...req.body, actor: ctx(req).actor });
    ok(res, result, 'Stock updated');
});

router.put(`${variantRoute}/stock`, requirePermission('inventory', 'update'), validate(schemas.stockSetSchema), async (req, res) => {
    await checkVariantAccess(req);
    const result = await stock.setStock({ ...req.params, ...req.body, reason: 'adjustment', actor: ctx(req).actor });
    ok(res, result, 'Stock updated');
});

router.patch(`${variantRoute}/threshold`, requirePermission('inventory', 'update'), validate(schemas.thresholdSchema), async (req, res) => {
    await products.setLowStockThreshold({ ...req.params, threshold: req.body.threshold }, ctx(req));
    ok(res, null, 'Low-stock alert level updated');
});

export default router;
