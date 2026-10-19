import { Router } from 'express';
import { isDbConnected } from './config/db.js';
import authRoutes from './modules/auth/auth.routes.js';
import catalogAdminRoutes from './modules/catalog/catalog.admin.routes.js';
import catalogPublicRoutes from './modules/catalog/catalog.public.routes.js';
import cartRoutes from './modules/cart/cart.routes.js';
import couponRoutes from './modules/coupons/coupon.routes.js';
import customerRoutes from './modules/customers/customer.routes.js';
import { adminOrderRoutes, checkoutRoutes, customerOrderRoutes } from './modules/orders/order.routes.js';
import notificationRoutes from './modules/notifications/notification.routes.js';
import { adminSlotRoutes, publicSlotRoutes } from './modules/slots/slot.routes.js';
import { adminZoneRoutes, serviceabilityRoutes } from './modules/zones/zone.routes.js';
import paymentRoutes from './modules/payments/payment.routes.js';
import staffRoutes from './modules/staff/staff.routes.js';
import uploadRoutes from './modules/uploads/upload.routes.js';

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

export default router;
