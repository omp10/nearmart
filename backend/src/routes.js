import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { isDbConnected } from './config/db.js';
import authRoutes from './modules/auth/auth.routes.js';
import catalogAdminRoutes from './modules/catalog/catalog.admin.routes.js';
import catalogPublicRoutes from './modules/catalog/catalog.public.routes.js';
import { adminBannerRoutes, publicBannerRoutes } from './modules/banners/banner.routes.js';
import { adminOfferCardRoutes, publicOfferCardRoutes } from './modules/offers/offerCard.routes.js';
import cartRoutes from './modules/cart/cart.routes.js';
import customerAdminRoutes from './modules/customers/customer.admin.routes.js';
import reportRoutes from './modules/reports/report.routes.js';
import { adminSettingsRoutes, publicSettingsRoutes } from './modules/settings/settings.routes.js';
import couponRoutes from './modules/coupons/coupon.routes.js';
import customerRoutes from './modules/customers/customer.routes.js';
import { adminOrderRoutes, checkoutRoutes, customerOrderRoutes } from './modules/orders/order.routes.js';
import { adminLaundryRoutes, customerLaundryRoutes } from './modules/laundry/laundry.routes.js';
import notificationRoutes from './modules/notifications/notification.routes.js';
import { adminSlotRoutes, publicSlotRoutes } from './modules/slots/slot.routes.js';
import { adminZoneRoutes, serviceabilityRoutes } from './modules/zones/zone.routes.js';
import paymentRoutes from './modules/payments/payment.routes.js';
import staffRoutes from './modules/staff/staff.routes.js';
import uploadRoutes from './modules/uploads/upload.routes.js';
import { adminRiderRoutes, riderAppRoutes } from './modules/riders/rider.routes.js';

/**
 * Everything under /api/v1. Path prefixes by audience, as modules land:
 *   /auth, /notifications, /uploads, /payments  shared
 *   /admin/*                                    admin panel (staff permissions)
 *   /ops/*                                      operations / vendor panel
 *   everything else                             customer app
 */
const router = Router();

router.get('/health', (_req, res) => {
    const db = isDbConnected();
    res.status(db ? 200 : 503).json({ success: db, status: db ? 'up' : 'degraded', db: db ? 'connected' : 'disconnected' });
});

/** The customer API contract (docs/openapi.yaml), for the app team's tooling. */
const OPENAPI_FILE = fileURLToPath(new URL('../../docs/openapi.yaml', import.meta.url));
router.get('/openapi.yaml', (_req, res) => {
    res.type('application/yaml').sendFile(OPENAPI_FILE);
});

router.use('/auth', authRoutes);
router.use('/notifications', notificationRoutes);
router.use('/uploads', uploadRoutes);
router.use('/payments', paymentRoutes);
router.use('/admin/staff', staffRoutes);
router.use('/admin/catalog', catalogAdminRoutes);
router.use('/catalog', catalogPublicRoutes);
router.use('/admin/zones', adminZoneRoutes);
router.use('/admin/slots', adminSlotRoutes);
router.use('/serviceability', serviceabilityRoutes);
router.use('/slots', publicSlotRoutes);
router.use('/me', customerRoutes);
router.use('/cart', cartRoutes);
router.use('/checkout', checkoutRoutes);
router.use('/orders', customerOrderRoutes);
router.use('/admin/orders', adminOrderRoutes);
router.use('/admin/coupons', couponRoutes);
router.use('/laundry', customerLaundryRoutes);
router.use('/admin/laundry', adminLaundryRoutes);
router.use('/admin/settings', adminSettingsRoutes);
router.use('/settings', publicSettingsRoutes);
router.use('/admin/banners', adminBannerRoutes);
router.use('/banners', publicBannerRoutes);
router.use('/admin/offer-cards', adminOfferCardRoutes);
router.use('/offer-cards', publicOfferCardRoutes);
router.use('/admin/customers', customerAdminRoutes);
router.use('/rider', riderAppRoutes);
router.use('/admin/riders', adminRiderRoutes);
router.use('/admin', reportRoutes);

export default router;
