import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ForbiddenError } from '../../lib/errors.js';
import { pageQuery } from '../../lib/pagination.js';
import { created, ok } from '../../lib/response.js';
import { normalizeIndianPhone, validate } from '../../lib/validate.js';
import { authenticate, requireApprovedSeller, requirePermission, requireSeller, requireStaff, requireTradingSeller } from '../../middleware/auth.js';
import { authLimiter, uploadLimiter } from '../../middleware/rateLimit.js';
import * as auth from '../auth/auth.service.js';
import { verifyAccessToken } from '../auth/token.service.js';
import * as categories from '../catalog/category.service.js';
import { Category } from '../catalog/category.model.js';
import { PRODUCT_MODULES } from '../catalog/module.model.js';
import { Product } from '../catalog/product.model.js';
import * as schemas from '../catalog/catalog.schemas.js';
import * as products from '../catalog/product.service.js';
import * as stock from '../catalog/stock.service.js';
import { Order } from '../orders/order.model.js';
import * as orders from '../orders/order.service.js';
import { istDate } from '../../lib/istTime.js';
import { DOCUMENT_TYPES, MODULE_REQUEST_STATUSES, SELLER_STATUSES, Seller } from './seller.model.js';
import { MAX_DOCUMENT_MB, readDocument, saveDocument } from './documents.js';
import { notify } from '../notifications/notification.service.js';
import * as payouts from './payout.service.js';
import * as sellers from './seller.service.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const phone = z.string().transform((v, c) => {
    const p = normalizeIndianPhone(v);
    if (!p) c.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' });
    return p;
});
const password = z.string().min(10, 'Use at least 10 characters').max(200);
const otp = z.string().regex(/^\d{4,8}$/, 'Enter the OTP you received');
const istDay = (d, end = false) => (d ? new Date(`${d}T${end ? '23:59:59.999' : '00:00:00.000'}+05:30`) : undefined);
const dateQuery = { from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() };

// ─── Auth: /auth/seller ───

/**
 * The seller dashboard is a web app on this domain. Its refresh token lives
 * in its own httpOnly cookie (separate from the admin panel's), scoped to
 * these routes; a native client sending `X-Client: mobile` gets it in the body.
 */
const COOKIE = 'nm_srt';
const cookieOptions = () => ({
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/api/v1/auth/seller',
    maxAge: env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000
});
const meta = (req) => ({ userAgent: req.get('user-agent'), ip: req.ip });
const isMobile = (req) => req.get('x-client') === 'mobile';

/** Cookie-carrying requests from a browser must come from this site (CSRF guard). */
const trustedOrigin = (req, _res, next) => {
    const origin = req.get('origin');
    if (!origin) return next();
    const self = `${req.protocol}://${req.get('host')}`;
    if (origin === self || env.CORS_ORIGINS.includes(origin)) return next();
    return next(new ForbiddenError('Request from an untrusted site'));
};

const sendSession = (req, res, { refreshToken, ...session }, message) => {
    res.cookie(COOKIE, refreshToken, cookieOptions());
    ok(res, isMobile(req) ? { ...session, refreshToken } : session, message);
};

export const sellerAuthRoutes = Router();

sellerAuthRoutes.post('/signup/request-otp', authLimiter, validate(z.object({ phone })), async (req, res) => {
    ok(res, await auth.requestSellerSignupOtp(req.body.phone), 'OTP sent');
});

/** Step 2: checks the OTP on its own and returns a 30-minute token for the onboarding form. */
sellerAuthRoutes.post('/signup/verify-otp', authLimiter, validate(z.object({ phone, otp })), async (req, res) => {
    ok(res, await auth.verifySellerSignupOtp(req.body), 'Mobile number verified');
});

/** Step 3: the onboarding form, allowed only with the token from verify-otp. */
sellerAuthRoutes.post(
    '/signup',
    trustedOrigin,
    authLimiter,
    validate(
        z.object({
            signupToken: z.string().min(20, 'Verify your mobile number first').max(2000),
            businessName: z.string().trim().min(2).max(120),
            ownerName: z.string().trim().min(2).max(80),
            email: z.string().trim().email(),
            password
        })
    ),
    async (req, res) => {
        sendSession(req, res, await auth.registerSeller(req.body, meta(req)), 'Account created');
    }
);

sellerAuthRoutes.post('/login', trustedOrigin, authLimiter, validate(z.object({ login: z.string().trim().min(3).max(120), password: z.string().min(1).max(200) })), async (req, res) => {
    sendSession(req, res, await auth.sellerLogin(req.body, meta(req)), 'Signed in');
});

sellerAuthRoutes.post('/refresh', trustedOrigin, validate(z.object({ refreshToken: z.string().optional() })), async (req, res) => {
    const { kind, ...session } = await auth.refreshSession(req.body.refreshToken || req.cookies?.[COOKIE], meta(req));
    if (kind !== 'seller') throw new ForbiddenError('Seller account required');
    // The profile comes back too, so a reloaded dashboard needs no second call.
    const { sub } = verifyAccessToken(session.accessToken);
    sendSession(req, res, { ...session, seller: await sellers.getSellerMe(sub) }, 'Session refreshed');
});

sellerAuthRoutes.post('/logout', trustedOrigin, validate(z.object({ refreshToken: z.string().optional() })), async (req, res) => {
    await auth.logout(req.body.refreshToken || req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
    ok(res, null, 'Signed out');
});

sellerAuthRoutes.post('/forgot/request-otp', authLimiter, validate(z.object({ phone })), async (req, res) => {
    ok(res, await auth.requestSellerResetOtp(req.body.phone), 'If this number has a seller account, an OTP has been sent');
});

sellerAuthRoutes.post('/forgot/reset', authLimiter, validate(z.object({ phone, otp, password })), async (req, res) => {
    await auth.resetSellerPassword(req.body);
    ok(res, null, 'Password changed. Please sign in.');
});

sellerAuthRoutes.post('/change-password', authenticate, requireSeller, validate(z.object({ currentPassword: z.string().min(1), newPassword: password })), async (req, res) => {
    await auth.changeSellerPassword(req.auth.id, req.body);
    res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
    ok(res, null, 'Password changed. Please sign in again.');
});

// ─── Seller dashboard: /seller ───

const text = (max) => z.string().trim().max(max);
const applicationSchema = z
    .object({
        businessName: z.string().trim().min(2).max(120),
        ownerName: z.string().trim().min(2).max(80),
        legal: z.object({ gstin: text(20), pan: text(12), fssai: text(20) }).partial(),
        store: z.object({ description: text(1000), logo: text(500), cover: text(500), timings: text(200), supportPhone: text(20) }).partial(),
        address: z
            .object({
                line1: text(200),
                line2: text(200),
                landmark: text(120),
                city: text(80),
                state: text(80),
                pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit pincode'),
                lat: z.number().min(-90).max(90).nullable(),
                lng: z.number().min(-180).max(180).nullable()
            })
            .partial(),
        bank: z.object({ accountName: text(120), accountNumber: z.string().trim().regex(/^\d{6,20}$|^$/, 'Account number is 6–20 digits'), ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$|^$/, 'Enter a valid IFSC'), upiId: text(60) }).partial(),
        modules: z.array(z.object({ key: z.enum(PRODUCT_MODULES), categories: z.array(objectId).max(50).optional() })).max(PRODUCT_MODULES.length)
    })
    .partial();

const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOCUMENT_MB * 1024 * 1024, files: 1 } });

export const sellerAppRoutes = Router();
sellerAppRoutes.use(authenticate, requireSeller);

const sellerCtx = (req) => ({ sellerId: req.auth.id, allowedModules: req.auth.modules, actor: { kind: 'seller', id: req.auth.id }, by: { kind: 'seller', id: req.auth.id } });

sellerAppRoutes.get('/me', async (req, res) => {
    ok(res, await sellers.getSellerMe(req.auth.id));
});

sellerAppRoutes.patch('/application', validate(applicationSchema), async (req, res) => {
    ok(res, await sellers.updateApplication(req.auth.id, req.body), 'Saved');
});

sellerAppRoutes.post('/application/submit', async (req, res) => {
    ok(res, await sellers.submitApplication(req.auth.id), 'Application sent for approval');
});

/** Shops and their top-level categories, for the "where do you want to sell" step. */
sellerAppRoutes.get('/catalog/modules', async (_req, res) => {
    const rows = await Category.find({ module: { $in: PRODUCT_MODULES }, parent: null, isActive: true }).select('module name image').sort({ sortOrder: 1, name: 1 }).lean();
    ok(res, PRODUCT_MODULES.map((key) => ({ key, categories: rows.filter((c) => c.module === key).map((c) => ({ id: String(c._id), name: c.name, image: c.image })) })));
});

sellerAppRoutes.post('/documents', uploadLimiter, documentUpload.single('file'), async (req, res) => {
    const type = z.enum(DOCUMENT_TYPES).parse(req.body?.type ?? req.query.type);
    const saved = await saveDocument(req.auth.id, req.file);
    created(res, await sellers.addDocument(req.auth.id, { type, ...saved, name: String(req.file?.originalname ?? '').slice(0, 120) }), 'Document uploaded');
});

sellerAppRoutes.delete('/documents/:docId', async (req, res) => {
    ok(res, await sellers.removeDocument(req.auth.id, objectId.parse(req.params.docId)), 'Document removed');
});

sellerAppRoutes.get('/documents/:docId', async (req, res) => {
    const seller = await Seller.findById(req.auth.id).select('documents').lean();
    const doc = seller?.documents.find((d) => String(d._id) === req.params.docId);
    const { buffer, mimeType } = await readDocument(req.auth.id, doc?.file ?? '');
    res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(buffer);
});

sellerAppRoutes.post('/modules', validate(z.object({ key: z.enum(PRODUCT_MODULES), categories: z.array(objectId).max(50).optional() })), async (req, res) => {
    ok(res, await sellers.requestModule(req.auth.id, req.body), 'Request sent for approval');
});

sellerAppRoutes.post('/store/open', requireApprovedSeller, validate(z.object({ isOpen: z.boolean() })), async (req, res) => {
    ok(res, await sellers.setOpen(req.auth.id, req.body.isOpen), req.body.isOpen ? 'Store is open' : 'Store is closed');
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

sellerAppRoutes.put(
    '/store/hours',
    requireTradingSeller,
    validate(
        z.object({
            hours: z.array(z.object({ day: z.number().int().min(0).max(6), open: hhmm, close: hhmm })).max(21).optional(),
            holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).optional()
        })
    ),
    async (req, res) => {
        ok(res, await sellers.setHours(req.auth.id, req.body), 'Opening hours saved');
    }
);

sellerAppRoutes.get('/adjustments', requireTradingSeller, validate(z.object({ ...pageQuery }), 'query'), async (req, res) => {
    ok(res, await payouts.listAdjustments(req.auth.id, req.validatedQuery));
});

// Everything below needs an approved store.

sellerAppRoutes.get('/dashboard', requireTradingSeller, async (req, res) => {
    const sellerId = req.auth.id;
    const match = { 'seller.id': new mongoose.Types.ObjectId(sellerId) };
    const today = new Date(`${istDate()}T00:00:00.000+05:30`);
    const [todayRows, open, lowStock, products, balance] = await Promise.all([
        Order.aggregate([
            { $match: { ...match, createdAt: { $gte: today }, status: { $nin: ['pending_payment', 'cancelled'] } } },
            { $group: { _id: null, orders: { $sum: 1 }, salesPaise: { $sum: '$pricing.subtotalPaise' } } }
        ]),
        Order.aggregate([{ $match: { ...match, status: { $in: ['placed', 'accepted', 'packing', 'ready', 'dispatched'] } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        Product.aggregate([
            { $match: { seller: match['seller.id'], isActive: true } },
            { $unwind: '$variants' },
            { $match: { 'variants.isActive': true, $expr: { $lte: ['$variants.stockQty', '$variants.lowStockThreshold'] } } },
            { $count: 'n' }
        ]),
        Product.countDocuments({ seller: match['seller.id'] }),
        payouts.balanceFor(sellerId)
    ]);
    ok(res, {
        today: { orders: todayRows[0]?.orders ?? 0, salesPaise: todayRows[0]?.salesPaise ?? 0 },
        openOrders: Object.fromEntries(open.map((o) => [o._id, o.n])),
        lowStockVariants: lowStock[0]?.n ?? 0,
        products,
        balance
    });
});

// Catalogue: only in approved shops, and inside the categories the seller was approved for.

sellerAppRoutes.get('/catalog/categories', requireApprovedSeller, async (req, res) => {
    const module = z.enum(PRODUCT_MODULES).parse(req.query.module);
    products.assertModule(req.auth.modules, module);
    ok(res, await categories.getTree(module));
});

const assertCategoryAllowed = async (sellerId, module, categoryId) => {
    const seller = await Seller.findById(sellerId).select('modules').lean();
    const entry = seller?.modules.find((m) => m.key === module && m.status === 'approved');
    if (!entry) throw new ForbiddenError(`You are not approved to sell in ${module}`);
    if (!entry.categories?.length || !categoryId) return;
    const category = await Category.findById(categoryId).select('ancestors').lean();
    const path = [...(category?.ancestors ?? []), category?._id].map(String);
    if (!entry.categories.some((c) => path.includes(String(c)))) throw new ForbiddenError('You are not approved to sell in this category');
};

const sellerProductFields = (body) => {
    const { isFeatured, seller, sellerName, sellerHidden, sellerZones, review, ...rest } = body;
    return rest;
};

sellerAppRoutes.get('/products', requireApprovedSeller, validate(schemas.productListQuery, 'query'), async (req, res) => {
    ok(res, await products.listProducts(req.validatedQuery, sellerCtx(req)));
});

sellerAppRoutes.get('/products/:id', requireApprovedSeller, async (req, res) => {
    ok(res, await products.getProduct(req.params.id, sellerCtx(req)));
});

sellerAppRoutes.post('/products', requireApprovedSeller, validate(schemas.productCreateSchema), async (req, res) => {
    await assertCategoryAllowed(req.auth.id, req.body.module, req.body.category);
    const [seller, config] = await Promise.all([Seller.findById(req.auth.id).select('businessName zones').lean(), sellers.getConfig()]);
    const product = await products.createProduct(
        { ...sellerProductFields(req.body), sellerZones: seller.zones ?? [], review: { status: config.reviewNewProducts ? 'pending' : 'approved', note: '' } },
        { ...sellerCtx(req), seller }
    );
    await sellers.syncVisibility(req.auth.id);
    created(res, product, config.reviewNewProducts ? 'Product added. Nearmart will review it before customers see it.' : 'Product added');
});

sellerAppRoutes.patch('/products/:id', requireApprovedSeller, validate(schemas.productUpdateSchema), async (req, res) => {
    const current = await products.getProduct(req.params.id, sellerCtx(req));
    if (req.body.category) await assertCategoryAllowed(req.auth.id, current.module, req.body.category);
    const updated = await products.updateProduct(req.params.id, sellerProductFields(req.body), sellerCtx(req));
    if (current.review?.status === 'rejected') {
        await Product.updateOne({ _id: updated._id }, { $set: { 'review.status': 'pending' } });
        updated.review.status = 'pending';
        return ok(res, updated, 'Product updated and sent back to Nearmart for review');
    }
    ok(res, updated, 'Product updated');
});

sellerAppRoutes.delete('/products/:id', requireApprovedSeller, async (req, res) => {
    await products.deleteProduct(req.params.id, sellerCtx(req));
    ok(res, null, 'Product deleted');
});

sellerAppRoutes.get('/inventory', requireApprovedSeller, validate(schemas.inventoryListQuery, 'query'), async (req, res) => {
    ok(res, await products.listInventory(req.validatedQuery, sellerCtx(req)));
});

const variantRoute = '/inventory/:productId/variants/:variantId';
const checkVariant = async (req) => {
    schemas.objectId.parse(req.params.variantId);
    await products.getProduct(req.params.productId, sellerCtx(req));
};

sellerAppRoutes.post(`${variantRoute}/adjust`, requireApprovedSeller, validate(schemas.stockAdjustSchema), async (req, res) => {
    await checkVariant(req);
    ok(res, await stock.adjustStock({ ...req.params, ...req.body, actor: sellerCtx(req).actor }), 'Stock updated');
});

sellerAppRoutes.put(`${variantRoute}/stock`, requireApprovedSeller, validate(schemas.stockSetSchema), async (req, res) => {
    await checkVariant(req);
    ok(res, await stock.setStock({ ...req.params, ...req.body, reason: 'adjustment', actor: sellerCtx(req).actor }), 'Stock updated');
});

sellerAppRoutes.patch(`${variantRoute}/threshold`, requireApprovedSeller, validate(schemas.thresholdSchema), async (req, res) => {
    await products.setLowStockThreshold({ ...req.params, threshold: req.body.threshold }, sellerCtx(req));
    ok(res, null, 'Low-stock alert level updated');
});

// Orders: sellers confirm, pack and hand over; riders and the store do the rest.

const SELLER_MOVES = ['accepted', 'packing', 'ready'];

sellerAppRoutes.get(
    '/orders',
    requireTradingSeller,
    validate(z.object({ ...pageQuery, ...dateQuery, status: z.enum(['open', 'placed', 'accepted', 'packing', 'ready', 'dispatched', 'delivered', 'cancelled']).optional(), q: z.string().trim().max(40).optional() }), 'query'),
    async (req, res) => {
        const { from, to, ...rest } = req.validatedQuery;
        ok(res, await orders.listSellerOrders(req.auth.id, { ...rest, from: istDay(from), to: istDay(to, true) }));
    }
);

sellerAppRoutes.get('/orders/:id', requireTradingSeller, async (req, res) => {
    ok(res, await orders.getSellerOrder(req.auth.id, req.params.id));
});

sellerAppRoutes.post('/orders/:id/status', requireTradingSeller, validate(z.object({ status: z.enum(SELLER_MOVES), note: z.string().trim().max(300).optional() })), async (req, res) => {
    await orders.advanceStatus(req.params.id, { to: req.body.status, note: req.body.note, ...sellerCtx(req), allowedModules: null });
    ok(res, await orders.getSellerOrder(req.auth.id, req.params.id), 'Order updated');
});

sellerAppRoutes.post('/orders/:id/items/:lineId/unavailable', requireTradingSeller, validate(z.object({ note: z.string().trim().max(200).optional() })), async (req, res) => {
    await orders.markItemUnavailable(req.params.id, req.params.lineId, { note: req.body.note, ...sellerCtx(req), allowedModules: null });
    ok(res, await orders.getSellerOrder(req.auth.id, req.params.id), 'Item marked unavailable');
});

sellerAppRoutes.post('/orders/:id/cancel', requireTradingSeller, validate(z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) })), async (req, res) => {
    await orders.cancelOrder(req.params.id, { reason: req.body.reason, ...sellerCtx(req), allowedModules: null, allowed: ['placed', 'accepted', 'packing'] });
    ok(res, await orders.getSellerOrder(req.auth.id, req.params.id), 'Order cancelled');
});

// Money

sellerAppRoutes.get('/earnings', requireTradingSeller, validate(z.object({ ...pageQuery, ...dateQuery }), 'query'), async (req, res) => {
    const { from, to, ...rest } = req.validatedQuery;
    ok(res, await payouts.sellerEarnings(req.auth.id, { ...rest, from: istDay(from), to: istDay(to, true) }));
});

sellerAppRoutes.get('/payouts', requireTradingSeller, validate(z.object({ ...pageQuery }), 'query'), async (req, res) => {
    ok(res, await payouts.listPayouts({ ...req.validatedQuery, sellerId: req.auth.id }));
});

sellerAppRoutes.get('/payouts/:id', requireTradingSeller, async (req, res) => {
    ok(res, await payouts.getPayout(req.params.id, { sellerId: req.auth.id }));
});

/** Commission rates that apply to this seller, per approved shop. */
sellerAppRoutes.get('/commission', requireTradingSeller, async (req, res) => {
    const [seller, config] = await Promise.all([Seller.findById(req.auth.id).select('commission modules').lean(), sellers.getConfig()]);
    ok(res, {
        payoutHoldDays: config.payoutHoldDays,
        modules: seller.modules.filter((m) => m.status === 'approved').map((m) => ({ key: m.key, ...sellers.commissionFor(seller, m.key, config) }))
    });
});

// ─── Admin: /admin/sellers ───

export const adminSellerRoutes = Router();
adminSellerRoutes.use(authenticate, requireStaff());

const by = (req) => req.auth.id;

adminSellerRoutes.get('/config', requirePermission('sellers', 'view'), async (_req, res) => {
    ok(res, await sellers.getConfig());
});

const commissionValue = z.object({ percent: z.number().min(0).max(100).optional(), fixedFeePaise: z.number().int().min(0).max(100000).optional() });

adminSellerRoutes.put(
    '/config',
    requirePermission('sellers', 'update'),
    validate(
        z.object({
            commission: z.record(z.enum(PRODUCT_MODULES), commissionValue).optional(),
            payoutHoldDays: z.number().int().min(0).max(60).optional(),
            acceptAlertMinutes: z.number().int().min(1).max(240).optional(),
            reviewNewProducts: z.boolean().optional()
        })
    ),
    async (req, res) => {
        ok(res, await sellers.updateConfig(req.body), 'Commission settings saved');
    }
);

// Product review queue (registered before "/:id").
adminSellerRoutes.get(
    '/products/review',
    requirePermission('sellers', 'view'),
    validate(z.object({ ...pageQuery, status: z.enum(['pending', 'rejected', 'approved']).default('pending') }), 'query'),
    async (req, res) => {
        const { status, page, limit } = req.validatedQuery;
        const filter = { seller: { $ne: null }, 'review.status': status };
        const [items, total] = await Promise.all([
            Product.find(filter).select('name brand module images seller sellerName review variants.label variants.pricePaise createdAt').sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
            Product.countDocuments(filter)
        ]);
        ok(res, { items, page, limit, total, pages: Math.ceil(total / limit) });
    }
);

adminSellerRoutes.post(
    '/products/:productId/review',
    requirePermission('sellers', 'update'),
    validate(z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).optional() })),
    async (req, res) => {
        const product = await Product.findOneAndUpdate(
            { _id: objectId.parse(req.params.productId), seller: { $ne: null } },
            { $set: { review: { status: req.body.decision, note: req.body.note ?? '' } } },
            { new: true }
        ).lean();
        if (!product) throw new ForbiddenError('Only marketplace sellers’ products are reviewed');
        notify(
            { ownerKind: 'seller', ownerId: product.seller },
            {
                title: req.body.decision === 'approved' ? `${product.name} is live` : `${product.name} needs changes`,
                body: req.body.note || (req.body.decision === 'approved' ? 'Customers can now see and buy it.' : 'Edit it and Nearmart will look again.'),
                type: 'seller.product.review',
                data: { productId: String(product._id) }
            }
        ).catch(() => {});
        ok(res, product, req.body.decision === 'approved' ? 'Product approved' : 'Product sent back');
    }
);

adminSellerRoutes.get(
    '/',
    requirePermission('sellers', 'view'),
    validate(z.object({ ...pageQuery, status: z.enum(SELLER_STATUSES).optional(), q: z.string().trim().max(60).optional() }), 'query'),
    async (req, res) => {
        ok(res, await sellers.listSellers(req.validatedQuery));
    }
);

adminSellerRoutes.get('/:id', requirePermission('sellers', 'view'), async (req, res) => {
    ok(res, await sellers.getSellerAdmin(objectId.parse(req.params.id)));
});

adminSellerRoutes.get('/:id/documents/:docId', requirePermission('sellers', 'view'), async (req, res) => {
    const seller = await Seller.findById(objectId.parse(req.params.id)).select('documents').lean();
    const doc = seller?.documents.find((d) => String(d._id) === req.params.docId);
    const { buffer, mimeType } = await readDocument(req.params.id, doc?.file ?? '');
    res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(buffer);
});

adminSellerRoutes.post(
    '/:id/approve',
    requirePermission('sellers', 'update'),
    validate(z.object({ modules: z.array(z.enum(PRODUCT_MODULES)).optional(), commissionPercent: z.number().min(0).max(100).nullable().optional(), fixedFeePaise: z.number().int().min(0).nullable().optional(), note: z.string().trim().max(300).optional() })),
    async (req, res) => {
        ok(res, await sellers.approveSeller(objectId.parse(req.params.id), req.body, by(req)), 'Seller approved');
    }
);

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });

adminSellerRoutes.post('/:id/reject', requirePermission('sellers', 'update'), validate(reasonSchema), async (req, res) => {
    ok(res, await sellers.rejectSeller(objectId.parse(req.params.id), req.body, by(req)), 'Application returned to the seller');
});

adminSellerRoutes.post('/:id/suspend', requirePermission('sellers', 'update'), validate(reasonSchema), async (req, res) => {
    ok(res, await sellers.suspendSeller(objectId.parse(req.params.id), req.body, by(req)), 'Seller suspended');
});

adminSellerRoutes.post(
    '/:id/modules/:key',
    requirePermission('sellers', 'update'),
    validate(z.object({ decision: z.enum(MODULE_REQUEST_STATUSES.filter((s) => s !== 'pending')), note: z.string().trim().max(300).optional() })),
    async (req, res) => {
        const key = z.enum(PRODUCT_MODULES).parse(req.params.key);
        ok(res, await sellers.decideModule(objectId.parse(req.params.id), key, { approve: req.body.decision === 'approved', note: req.body.note }, by(req)), 'Saved');
    }
);

adminSellerRoutes.get('/:id/adjustments', requirePermission('payouts', 'view'), validate(z.object({ ...pageQuery }), 'query'), async (req, res) => {
    ok(res, await payouts.listAdjustments(objectId.parse(req.params.id), req.validatedQuery));
});

adminSellerRoutes.post(
    '/:id/adjustments',
    requirePermission('payouts', 'create'),
    validate(z.object({ amountPaise: z.number().int().refine((n) => n !== 0, 'Enter an amount other than 0').refine((n) => Math.abs(n) <= 10_000_000, 'Too large'), reason: z.string().trim().min(3, 'Give a reason').max(300), orderId: objectId.optional() })),
    async (req, res) => {
        created(res, await payouts.addAdjustment(objectId.parse(req.params.id), req.body, req.auth.id), 'Adjustment added');
    }
);

adminSellerRoutes.delete('/:id/adjustments/:adjustmentId', requirePermission('payouts', 'update'), async (req, res) => {
    await payouts.removeAdjustment(objectId.parse(req.params.id), objectId.parse(req.params.adjustmentId));
    ok(res, null, 'Adjustment removed');
});

adminSellerRoutes.patch(
    '/:id',
    requirePermission('sellers', 'update'),
    validate(
        z.object({
            commission: z
                .object({
                    percent: z.number().min(0).max(100).nullable(),
                    fixedFeePaise: z.number().int().min(0).nullable(),
                    byModule: z.record(z.enum(PRODUCT_MODULES), z.object({ percent: z.number().min(0).max(100).nullable(), fixedFeePaise: z.number().int().min(0).nullable() }).partial())
                })
                .partial()
                .optional(),
            zones: z.array(objectId).optional(),
            isActive: z.boolean().optional()
        })
    ),
    async (req, res) => {
        ok(res, await sellers.updateSellerAdmin(objectId.parse(req.params.id), req.body), 'Seller updated');
    }
);

// ─── Admin: /admin/payouts ───

export const adminPayoutRoutes = Router();
adminPayoutRoutes.use(authenticate, requireStaff());

adminPayoutRoutes.get('/balances', requirePermission('payouts', 'view'), async (_req, res) => {
    ok(res, await payouts.sellerBalances());
});

adminPayoutRoutes.get(
    '/',
    requirePermission('payouts', 'view'),
    validate(z.object({ ...pageQuery, sellerId: objectId.optional(), status: z.enum(['pending', 'paid', 'cancelled']).optional() }), 'query'),
    async (req, res) => {
        ok(res, await payouts.listPayouts(req.validatedQuery));
    }
);

adminPayoutRoutes.get('/sellers/:sellerId/earnings', requirePermission('payouts', 'view'), validate(z.object({ ...pageQuery, ...dateQuery }), 'query'), async (req, res) => {
    const { from, to, ...rest } = req.validatedQuery;
    ok(res, await payouts.sellerEarnings(objectId.parse(req.params.sellerId), { ...rest, from: istDay(from), to: istDay(to, true) }));
});

adminPayoutRoutes.get('/report', requirePermission('payouts', 'view'), validate(z.object({ ...dateQuery }), 'query'), async (req, res) => {
    const { from, to } = req.validatedQuery;
    ok(res, await payouts.commissionReport({ from: istDay(from), to: istDay(to, true) }));
});

adminPayoutRoutes.post('/', requirePermission('payouts', 'create'), validate(z.object({ sellerId: objectId })), async (req, res) => {
    created(res, await payouts.createPayout(req.body.sellerId, { by: req.auth.id }), 'Payout created');
});

adminPayoutRoutes.get('/:id', requirePermission('payouts', 'view'), async (req, res) => {
    ok(res, await payouts.getPayout(req.params.id));
});

adminPayoutRoutes.post(
    '/:id/paid',
    requirePermission('payouts', 'update'),
    validate(z.object({ mode: z.enum(['bank', 'upi', 'cash', 'other']), reference: z.string().trim().max(120).optional(), note: z.string().trim().max(300).optional() })),
    async (req, res) => {
        ok(res, await payouts.markPayoutPaid(objectId.parse(req.params.id), req.body), 'Payout marked paid');
    }
);

adminPayoutRoutes.post('/:id/cancel', requirePermission('payouts', 'update'), async (req, res) => {
    ok(res, await payouts.cancelPayout(objectId.parse(req.params.id)), 'Payout cancelled');
});

